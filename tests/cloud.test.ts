import { io } from 'socket.io-client'
import { EnerventCloudClient } from '../app/cloud'
import { FakeSocket } from './fakes/socketIo'

jest.mock('socket.io-client', () => ({ io: jest.fn() }))
// The handshake is chatty, and the tests run it once per case
jest.mock('../app/logger', () => ({
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

// Waits set by the client itself, mirrored here so the tests can step past them
const DUMP_WAIT_MS = 5000
const COIL_SETTLE_MS = 1500
const AUTH_TIMEOUT_MS = 30000
const CHANGES_TIMEOUT_MS = 60000
const HEALTH_CHECK_INTERVAL_MS = 15000

const DEVICE_MAC = '00:11:22:33:44:55'
const SESSION_ID = 'session-1'

// Manual boost is reported NA, which only a write succeeds against because of ACCESS_OVERRIDES
const DEVICE_MODEL = {
    items: [
        { mbreg: '135', access: 'RW', symbol: 'TEMP_TARGET', bounds: '100,300' },
        { mbreg: '50', access: 'RO', symbol: 'VENT_LEVEL_ACTUAL' },
        { mbreg: '10001', access: 'RW', symbol: 'COIL_AWAY', bounds: '0,1' },
        { mbreg: '10010', access: 'NA', symbol: 'COIL_M_BOOST' },
    ],
}

const flush = (): Promise<void> => jest.advanceTimersByTimeAsync(0)

const changes = (registers: number[], values: number[]) => ({
    type: 'ucp',
    data: { type: 'changes', registers, data: values },
})

const clients: EnerventCloudClient[] = []

const newClient = (pin = '54321'): { client: EnerventCloudClient; socket: FakeSocket } => {
    const socket = new FakeSocket()
    ;(io as unknown as jest.Mock).mockReturnValue(socket)

    const client = new EnerventCloudClient({ serialNumber: '1234567890', pin })
    clients.push(client)

    return { client, socket }
}

// The coil block is not part of the dump; the unit streams it as changes afterwards
const connectClient = async (): Promise<{ client: EnerventCloudClient; socket: FakeSocket }> => {
    const { client, socket } = newClient()
    const connecting = client.connect()

    socket.emit('connect')
    await flush()

    socket.receive({ _ack: socket.lastSent()._id, sessid: SESSION_ID, data: { login: 'ok', mac: DEVICE_MAC } })
    await flush()

    socket.receive({ data: { model: DEVICE_MODEL } })
    await flush()

    socket.receive({ type: 'ucp', data: { type: 'dump', registers: [6, 50, 135], data: [12, 45, 200] } })
    await jest.advanceTimersByTimeAsync(DUMP_WAIT_MS)

    socket.receive(changes([10001, 10010], [1, 0]))
    await jest.advanceTimersByTimeAsync(COIL_SETTLE_MS)

    await connecting

    return { client, socket }
}

describe('EnerventCloudClient', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    // Every connected client leaves a health check interval behind
    afterEach(() => {
        clients.splice(0).forEach((client) => client.disconnect())
        jest.useRealTimers()
    })

    describe('connect', () => {
        test('should log in with the configured serial number and PIN', async () => {
            const { socket } = await connectClient()

            expect(socket.sent[0]).toMatchObject({
                type: 'backend',
                data: { type: 'auth', cmd: 'loginWithPin', serialnumber: '1234567890', pin: '54321' },
            })
        })

        test('should repeat the session ID and device MAC on subsequent messages', async () => {
            const { socket } = await connectClient()

            expect(socket.sent[1]).toMatchObject({
                type: 'ucp',
                dst: DEVICE_MAC,
                sessid: SESSION_ID,
                data: { command: 'model' },
            })
            expect(socket.sent[2]).toMatchObject({ data: { command: 'dump' } })
        })

        test('should reject when the backend refuses the login', async () => {
            const { client, socket } = newClient('wrong')
            const connecting = client.connect()

            socket.emit('connect')
            await flush()
            socket.receive({ _ack: socket.lastSent()._id, data: { login: 'failed' } })

            await expect(connecting).rejects.toThrow('Authentication failed')
        })

        test('should reject when the backend never answers the login', async () => {
            const { client, socket } = newClient()
            const connecting = client.connect()

            socket.emit('connect')
            const rejects = expect(connecting).rejects.toThrow('Authentication timeout')
            await jest.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS)

            await rejects
        })
    })

    describe('reads', () => {
        test('should serve holding registers from the dump', async () => {
            const { client } = await connectClient()

            expect(await client.readHoldingRegisters(6, 1)).toEqual({ data: [12] })
            expect(await client.readHoldingRegisters(50, 1)).toEqual({ data: [45] })
        })

        test('should report registers the unit never sent as zero', async () => {
            const { client } = await connectClient()

            expect(await client.readHoldingRegisters(999, 2)).toEqual({ data: [0, 0] })
        })

        test('should read coils from the 10000+ register space', async () => {
            const { client } = await connectClient()

            expect(await client.readCoils(1, 1)).toEqual({ data: [true] })
            expect(await client.readCoils(10, 1)).toEqual({ data: [false] })
        })

        test('should only treat exactly 1 as a set coil', async () => {
            const { client, socket } = await connectClient()

            socket.receive(changes([10001], [2]))

            expect(await client.readCoils(1, 1)).toEqual({ data: [false] })
        })

        test('should apply register changes pushed by the unit', async () => {
            const { client, socket } = await connectClient()

            socket.receive(changes([6, 10010], [130, 1]))

            expect(await client.readHoldingRegisters(6, 1)).toEqual({ data: [130] })
            expect(await client.readCoils(10, 1)).toEqual({ data: [true] })
        })

        test('should survive a message that is not valid JSON', async () => {
            const { client, socket } = await connectClient()

            expect(() => socket.receiveRaw('not json')).not.toThrow()
            expect(await client.readHoldingRegisters(6, 1)).toEqual({ data: [12] })
        })
    })

    describe('liveness', () => {
        test('should bounce the connection when the unit stops sending changes', async () => {
            const { socket } = await connectClient()

            await jest.advanceTimersByTimeAsync(CHANGES_TIMEOUT_MS + HEALTH_CHECK_INTERVAL_MS)

            expect(socket.reconnects).toEqual(1)
        })

        test('should leave the connection alone while changes keep arriving', async () => {
            const { socket } = await connectClient()

            await jest.advanceTimersByTimeAsync(CHANGES_TIMEOUT_MS - HEALTH_CHECK_INTERVAL_MS)
            socket.receive(changes([6], [130]))
            await jest.advanceTimersByTimeAsync(CHANGES_TIMEOUT_MS - HEALTH_CHECK_INTERVAL_MS)

            expect(socket.reconnects).toEqual(0)
        })

        test('should log in again when the socket reconnects', async () => {
            const { socket } = await connectClient()
            const sentBefore = socket.sent.length

            socket.emit('connect')
            await flush()

            expect(socket.sent[sentBefore]).toMatchObject({ data: { cmd: 'loginWithPin' } })
        })
    })

    describe('writes', () => {
        test('should send the write and resolve once the unit echoes the new value back', async () => {
            const { client, socket } = await connectClient()

            const writing = client.writeRegister(135, 210)
            await flush()

            expect(socket.lastSent()).toMatchObject({
                type: 'ucp',
                dst: DEVICE_MAC,
                data: { type: 'command', command: 'write', id: 135, value: 210 },
            })

            socket.receive(changes([135], [210]))
            await writing

            expect(await client.readHoldingRegisters(135, 1)).toEqual({ data: [210] })
        })

        test('should write coils to the 10000+ register space', async () => {
            const { client, socket } = await connectClient()

            const writing = client.writeCoil(10, true)
            await flush()

            expect(socket.lastSent()).toMatchObject({ data: { command: 'write', id: 10010, value: 1 } })

            socket.receive(changes([10010], [1]))
            await writing
        })

        test.each([
            ['a register the device model does not describe', 999, 1],
            ['a register the device reports as read-only', 50, 60],
            ['a value outside the bounds the device reports', 135, 400],
            ['a value the register already holds', 135, 200],
        ])('should not send a write for %s', async (_reason, register, value) => {
            const { client, socket } = await connectClient()
            const sentBefore = socket.sent.length

            await client.writeRegister(register, value)

            expect(socket.sent).toHaveLength(sentBefore)
        })
    })
})
