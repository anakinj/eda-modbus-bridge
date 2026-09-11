import { createLogger } from './logger'
import type { CoilResult, ModbusClient, RegisterResult } from './client'
import { io, Socket } from 'socket.io-client'
import tls from 'tls'

const logger = createLogger('cloud')

const MY_ENERVENT_URL = 'https://my.enervent.com'

// my.enervent.com serves only its leaf certificate, so the issuing intermediate has to be supplied
// here for the chain to verify. Refresh from the leaf's AIA extension when the certificate is
// reissued under a different CA:
//   openssl s_client -connect my.enervent.com:443 -servername my.enervent.com </dev/null \
//     | openssl x509 -noout -ext authorityInfoAccess
// Current issuer: C=AT, O=ZeroSSL GmbH, CN=ZeroSSL RSA DV SSL CA 2 (expires 2035-09-23),
// which chains to Sectigo Public Server Authentication Root R46 in Node's bundled root store.
const ZEROSSL_INTERMEDIATE_CA = `-----BEGIN CERTIFICATE-----
MIIGITCCBAmgAwIBAgIRANCpCCVfjlDl8zltERRwKjcwDQYJKoZIhvcNAQEMBQAw
XzELMAkGA1UEBhMCR0IxGDAWBgNVBAoTD1NlY3RpZ28gTGltaXRlZDE2MDQGA1UE
AxMtU2VjdGlnbyBQdWJsaWMgU2VydmVyIEF1dGhlbnRpY2F0aW9uIFJvb3QgUjQ2
MB4XDTI1MDkyNDAwMDAwMFoXDTM1MDkyMzIzNTk1OVowRjELMAkGA1UEBhMCQVQx
FTATBgNVBAoTDFplcm9TU0wgR21iSDEgMB4GA1UEAxMXWmVyb1NTTCBSU0EgRFYg
U1NMIENBIDIwggGiMA0GCSqGSIb3DQEBAQUAA4IBjwAwggGKAoIBgQCnXX3Qm/G+
ujylvYIkhJ53ZZ7XM03vXY03sCnO9VWjwMsV0qCQMlvhuRiJwrm4M5jgGehxIiCR
1qT0AyL2rHTWJR07vjJzuNmp7uoKu3HKwixBk9QuXD5aliO8/EDbzdZDcG/Hm5pC
mOeusLtds/UE/Iq24nw5WpcgZE5Ly+F/yCYDuEa7hXLJAPM5SecJIblG1OQ3ukMl
HHNBbDxBpGWTyDudd0DTed0NTgCPs1t8RZPhW9Gt/8nDwFX0pQ4eHfPEB8c6eNl2
sRr2Afp1YErakR+53yEX2SXc2Kz0fbTlUc+To0ULGcJiWNyZwj//DTZ+M4xxsT2T
qjQ4Xfvm2EUTymrXDrh1Pm/wkBouu860c6eeQfNlKlccUyHOSeKCtPIWreMvH3Be
Ydeu3DwI8lefn/VUhSB2Bbz7hX3qz3oMmtSTmWhTnobyKlx1L2b/oloaqpy1cBc/
QiLRSOptYGPjZtX0pRrTVKQXeP2rPUk0y5q/40WRpugSlHCX6aceWnsCAwEAAaOC
AW8wggFrMB8GA1UdIwQYMBaAFFZzWGSV+ZIasBIqBGJ5oUAViCFJMB0GA1UdDgQW
BBRLvvp2hCNEBLnOvjFv6fUyBv8MVzAOBgNVHQ8BAf8EBAMCAYYwEgYDVR0TAQH/
BAgwBgEB/wIBADATBgNVHSUEDDAKBggrBgEFBQcDATATBgNVHSAEDDAKMAgGBmeB
DAECATBUBgNVHR8ETTBLMEmgR6BFhkNodHRwOi8vY3JsLnNlY3RpZ28uY29tL1Nl
Y3RpZ29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYuY3JsMIGEBggr
BgEFBQcBAQR4MHYwTwYIKwYBBQUHMAKGQ2h0dHA6Ly9jcnQuc2VjdGlnby5jb20v
U2VjdGlnb1B1YmxpY1NlcnZlckF1dGhlbnRpY2F0aW9uUm9vdFI0Ni5wN2MwIwYI
KwYBBQUHMAGGF2h0dHA6Ly9vY3NwLnNlY3RpZ28uY29tMA0GCSqGSIb3DQEBDAUA
A4ICAQCJ/3v2/vdexHsdVyXL9aCTQE01YXl23866TVM/LgRpRW+kneZXXZxP0hy4
GnvlqUcxTq97B6qPdQcQxQxpGne7CRn0nWauzqieMcJzYl3fDC2Q/ANyPhyrbwCI
zx9EsRrgfjvuJCaUMtlfYpKqBUYiPOCPAN0HdrLD5hU6oV1tvWVsUzTA43skC3uH
wQM5YPIk0NDJFw3NhQPOIOwbq09T+SYSEZvsJ3t4sA4H3gh03RETNaAwTcTNS/+u
1tAeQUZZmKQyLWYLyoxvbISp/MFr9xqhDqrpAurYVNeiLJ5+4/WZPml20yNZjcxV
KKqRYdEurl8rmI2toCnCDWiEcTDvoYGtz60eYIt7VJID4DrCjTxAWTWh2T5ag2pK
ryNJGt8BFGLtjeD774SxAFn5MGYBVvEK4LXmCjVX78pb6/0Dceo71dlQUK68yftb
+yTeyoqjwgk2L8vNSrkj6UTkvvqXSONFuVU7bvC0O/9bi5MXBv7QUivMNxDsTtaT
IZO7PsSCRmLraQM2EPBgbNL9lRSEYi4Hj+NicT/e87pbhv88k0oec9xGcnkcvZpN
sJBz78mkZfeFIIjh02e2y9ke/Fqw1FbdhHtU2myaFnX0sRyGLmI/vzXSwyvT+Kxl
Wx8FV64z2PBdwd0vXRaAMXomGC0M1vQa5fBDn4dimzewsSiphQ==
-----END CERTIFICATE-----`

// Combine system root CAs with the missing intermediate cert
const caCerts = [...tls.rootCertificates, ZEROSSL_INTERMEDIATE_CA]

export interface CloudDeviceConfig {
    serialNumber: string
    pin: string
}

// Messages exchanged with the my.enervent.com backend. Only the fields we actually use are typed.
// These ride on Socket.IO "message" packets, i.e. socket.send() / the "message" event.

interface SocketIoMessage {
    type?: string
    dst?: string | null
    data?: unknown
    _id?: number
    _ack?: number
    // Handed out with the login ack; every later message has to echo it back
    sessid?: string
}

// Both the initial dump and subsequent change notifications carry parallel register/value arrays
interface UcpRegisterData {
    type?: string
    registers?: number[]
    data?: number[]
}

interface AuthResponse {
    login?: string
    mac?: string
}

type AckCallback = (payload: unknown) => void

// How long to wait without register changes before reconnecting (in milliseconds)
const CHANGES_TIMEOUT_MS = 60000
// How often to check for stale connections (in milliseconds)
const HEALTH_CHECK_INTERVAL_MS = 15000
// How long to wait for the initial socket connection (in milliseconds)
const CONNECT_TIMEOUT_MS = 20000
// How long to wait for the login response (in milliseconds)
const AUTH_TIMEOUT_MS = 30000
// How long to give the backend to deliver the register dump (in milliseconds)
const DUMP_WAIT_MS = 5000
// How long to wait for a write to be acknowledged (in milliseconds)
const WRITE_TIMEOUT_MS = 10000
// How long to wait for the device model (in milliseconds)
const MODEL_WAIT_MS = 15000
// Coils live above this address in the cloud's flat feature space
const COIL_ADDRESS_OFFSET = 10000
// How long to wait for the unit to stream the coil block (in milliseconds)
const COIL_WAIT_MS = 20000
// How long to let the coil block finish arriving once it starts (in milliseconds)
const COIL_SETTLE_MS = 1500

interface WriteResponse {
    error?: unknown
}

// The backend describes the device with `{type:'command', command:'model'}` - a list of feature
// descriptors, each carrying its Modbus register (`mbreg`, already 10000+ for coils), an access
// flag and bounds. That is the authority on what may be written: RO and NA registers are refused,
// and values are checked against the device's own limits rather than anything hardcoded here.

interface ModelItem {
    mbreg?: string
    access?: string
    bounds?: string
    symbol?: string
}

interface DeviceModel {
    items?: ModelItem[]
}

// The model's access flags are not always right. COIL_M_BOOST is reported NA, yet writing it works
// and the unit echoes the new value back within half a second - verified against the device on
// 2026-09-06. Anything listed here is treated as writable regardless of what the model claims, so
// only add a register after confirming the unit really does apply a write to it.
const ACCESS_OVERRIDES: ReadonlyMap<number, string> = new Map<number, string>([
    [10010, 'RW'], // COIL_M_BOOST, manual boost
])

interface RegisterInfo {
    access: string
    symbol: string
    min?: number
    max?: number
}

export class EnerventCloudClient implements ModbusClient {
    private socket: Socket | null = null
    private deviceMac: string | null = null
    private registers: Map<number, number> = new Map()
    private config: CloudDeviceConfig
    private ackId: number = 1
    private ackCallbacks: Map<number, AckCallback> = new Map()
    private healthCheckInterval: ReturnType<typeof setInterval> | null = null
    private lastChangesTime: number = Date.now()
    private sessionEstablished: boolean = false
    private sessionId: string | null = null
    private pendingWrites: Map<number, { value: number; resolve: () => void }> = new Map()
    private registerInfo: Map<number, RegisterInfo> = new Map()
    private modelResolve: (() => void) | null = null
    private coilSpaceResolve: (() => void) | null = null

    constructor(config: CloudDeviceConfig) {
        this.config = config
    }

    async connect(): Promise<void> {
        logger.info(`Connecting to Enervent cloud for device ${this.config.serialNumber}...`)

        const socket = io(MY_ENERVENT_URL, {
            // The server only sends its leaf certificate, so a custom CA list is required. Sticking
            // to the WebSocket transport also skips the HTTP polling handshake entirely.
            transports: ['websocket'],
            ca: caCerts,
            timeout: CONNECT_TIMEOUT_MS,
            reconnectionDelay: 5000,
            reconnectionDelayMax: 60000,
        })
        this.socket = socket

        socket.on('message', (raw: unknown) => {
            this.handleMessage(raw)
        })

        socket.on('disconnect', (reason) => {
            logger.warn(`Disconnected from Enervent cloud: ${reason}`)
        })

        socket.io.on('reconnect_attempt', (attempt) => {
            logger.info(`Reconnecting to Enervent cloud (attempt ${attempt})...`)
        })

        // The backend keeps no state for us across sockets, so every reconnection needs a fresh
        // login and dump. The initial connection is driven by this method instead.
        socket.on('connect', () => {
            if (!this.sessionEstablished) {
                return
            }

            logger.info('Reconnected, re-establishing session...')
            this.establishSession().catch((error) => {
                logger.error(`Failed to re-establish session: ${String(error)}`)
            })
        })

        // Surface anything the backend sends that we don't handle yet
        socket.onAny((event: string, ...args: unknown[]) => {
            if (event !== 'message') {
                logger.debug(`Unhandled event "${event}": ${JSON.stringify(args).slice(0, 500)}`)
            }
        })

        await new Promise<void>((resolve, reject) => {
            socket.once('connect', () => resolve())
            socket.once('connect_error', (error: Error) => reject(error))
        })

        logger.info('Connected to Enervent cloud')

        await this.establishSession()
        this.sessionEstablished = true
        this.startHealthCheck()
    }

    private async establishSession(): Promise<void> {
        this.sessionId = null
        await this.authenticate()
        await this.requestModel()
        await this.requestDump()
        this.lastChangesTime = Date.now()
    }

    private async authenticate(): Promise<void> {
        logger.info(`Authenticating with serial number ${this.config.serialNumber}...`)

        const payload = await this.sendEventWithAck(
            {
                type: 'backend',
                data: {
                    type: 'auth',
                    cmd: 'loginWithPin',
                    serialnumber: this.config.serialNumber,
                    pin: this.config.pin,
                },
            },
            AUTH_TIMEOUT_MS,
            'Authentication timeout'
        )

        const response = payload as AuthResponse

        if (response.login !== 'ok') {
            throw new Error(`Authentication failed: ${JSON.stringify(payload)}`)
        }

        this.deviceMac = response.mac ?? null
        logger.info(`Authenticated successfully, device MAC: ${this.deviceMac}`)
    }

    private requestModel(): Promise<void> {
        logger.info('Requesting device model...')

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.modelResolve = null
                logger.warn('No device model received, writes will not be validated against it')
                resolve()
            }, MODEL_WAIT_MS)

            this.modelResolve = () => {
                clearTimeout(timeout)
                this.modelResolve = null
                resolve()
            }

            this.sendEvent({
                type: 'ucp',
                dst: this.deviceMac,
                data: { type: 'command', command: 'model' },
            })
        })
    }

    private parseModel(model: DeviceModel): void {
        this.registerInfo.clear()

        for (const item of model.items ?? []) {
            const address = Number.parseInt(item.mbreg ?? '', 10)

            if (Number.isNaN(address)) {
                continue
            }

            const [min, max] = (item.bounds ?? '').split(',').map((bound) => Number.parseInt(bound, 10))

            this.registerInfo.set(address, {
                access: item.access ?? 'NA',
                symbol: item.symbol ?? '',
                min: Number.isNaN(min) ? undefined : min,
                max: Number.isNaN(max) ? undefined : max,
            })
        }

        const writable = [...this.registerInfo.values()].filter((info) => info.access === 'RW').length
        logger.info(`Device model describes ${this.registerInfo.size} registers, ${writable} of them writable`)

        this.modelResolve?.()
    }

    private async requestDump(): Promise<void> {
        logger.info('Requesting register dump...')

        this.sendEvent({
            type: 'ucp',
            dst: this.deviceMac,
            data: { type: 'command', command: 'dump' },
        })

        // Give some time for dump to arrive
        await this.delay(DUMP_WAIT_MS)
        logger.info(`Received ${this.registers.size} registers from dump`)

        await this.waitForCoilSpace()
    }

    // Coils are not part of the dump payload: the unit streams them as changes a few seconds
    // afterwards. Without waiting for them every coil reads as 0, so the first publish would report
    // every mode and switch as off before correcting itself on the next cycle.
    private async waitForCoilSpace(): Promise<void> {
        const alreadyPresent = [...this.registers.keys()].some((address) => address >= COIL_ADDRESS_OFFSET)

        if (!alreadyPresent) {
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    this.coilSpaceResolve = null
                    logger.warn(
                        'No coil values received, mode and switch states may be wrong until the unit reports them'
                    )
                    resolve()
                }, COIL_WAIT_MS)

                this.coilSpaceResolve = () => {
                    clearTimeout(timeout)
                    this.coilSpaceResolve = null
                    resolve()
                }
            })

            // The block arrives in quick succession; let the rest of it land
            await this.delay(COIL_SETTLE_MS)
        }

        const coils = [...this.registers.keys()].filter((address) => address >= COIL_ADDRESS_OFFSET).length
        logger.info(`Received ${coils} coil values`)
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    private startHealthCheck(): void {
        this.lastChangesTime = Date.now()

        this.healthCheckInterval = setInterval(() => {
            const timeSinceLastChanges = Date.now() - this.lastChangesTime
            if (timeSinceLastChanges <= CHANGES_TIMEOUT_MS) {
                return
            }

            // The socket can stay open while the backend silently stops pushing, so incoming data
            // is the only reliable liveness signal. Bounce the connection and let socket.io handle
            // the retry schedule. Reset the timer so this doesn't fire again while it reconnects.
            logger.warn(
                `No register changes received in ${Math.round(timeSinceLastChanges / 1000)} seconds, reconnecting...`
            )
            this.lastChangesTime = Date.now()
            this.socket?.disconnect().connect()
        }, HEALTH_CHECK_INTERVAL_MS)
    }

    private handleMessage(raw: unknown): void {
        // The backend sends JSON strings over the "message" event rather than objects
        let payload: SocketIoMessage

        try {
            payload = typeof raw === 'string' ? (JSON.parse(raw) as SocketIoMessage) : (raw as SocketIoMessage)
        } catch (e) {
            logger.warn(`Failed to parse message payload: ${String(e)}`)
            return
        }

        this.handlePayload(payload)
    }

    private handlePayload(payload: SocketIoMessage): void {
        const modelData = payload.data as { model?: DeviceModel } | undefined

        if (modelData?.model !== undefined) {
            this.parseModel(modelData.model)
        }

        // The login ack carries a session ID that every subsequent message must repeat
        if (payload.sessid) {
            this.sessionId = payload.sessid
        }

        const ucpData = payload.type === 'ucp' ? (payload.data as UcpRegisterData | undefined) : undefined

        // Handle UCP messages with register changes
        if (ucpData?.type === 'changes') {
            this.lastChangesTime = Date.now()

            const registers = ucpData.registers ?? []
            const values = ucpData.data ?? []

            registers.forEach((register, index) => {
                const oldValue = this.registers.get(register)
                this.registers.set(register, values[index])
                if (oldValue !== values[index] && register !== 789) {
                    logger.debug(`Register ${register}: ${oldValue} -> ${values[index]}`)
                }

                if (register >= COIL_ADDRESS_OFFSET) {
                    this.coilSpaceResolve?.()
                }

                // A write is confirmed once the unit echoes the new value back to us
                const pending = this.pendingWrites.get(register)
                if (pending !== undefined && pending.value === values[index]) {
                    pending.resolve()
                }
            })
        }

        // Handle UCP messages with dump data
        if (ucpData?.type === 'dump') {
            const registers = ucpData.registers ?? []
            const values = ucpData.data ?? []

            registers.forEach((register, index) => {
                this.registers.set(register, values[index])
            })

            logger.debug(`Dump received: ${registers.length} registers`)
        }

        // Handle ack callbacks
        if (payload._ack !== undefined) {
            const callback = this.ackCallbacks.get(payload._ack)
            if (callback) {
                callback(payload.data)
                this.ackCallbacks.delete(payload._ack)
            }
        }
    }

    // Resolves once the unit reports the register holding the given value on the changes stream
    private waitForRegisterValue(address: number, value: number, timeoutMs: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingWrites.delete(address)
                reject(new Error(`Timed out waiting for register ${address} to become ${value}`))
            }, timeoutMs)

            this.pendingWrites.set(address, {
                value,
                resolve: () => {
                    clearTimeout(timeout)
                    this.pendingWrites.delete(address)
                    resolve()
                },
            })
        })
    }

    private sendEvent(payload: SocketIoMessage): void {
        if (!this.socket) {
            logger.warn('Not connected to Enervent cloud, dropping outgoing message')
            return
        }

        const message: SocketIoMessage = this.sessionId !== null ? { ...payload, sessid: this.sessionId } : payload
        // The backend expects a serialized payload, not an object. Deliberately not logged: the
        // login frame carries the PIN in cleartext.
        this.socket.send(JSON.stringify(message))
    }

    // Sends a payload and resolves with the backend's reply, correlated by the application-level
    // _id/_ack pair. Drops the pending callback if the reply never arrives.
    private sendEventWithAck(payload: SocketIoMessage, timeoutMs: number, timeoutMessage: string): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const ackId = this.ackId++

            const timeout = setTimeout(() => {
                this.ackCallbacks.delete(ackId)
                reject(new Error(timeoutMessage))
            }, timeoutMs)

            this.ackCallbacks.set(ackId, (response: unknown) => {
                clearTimeout(timeout)
                resolve(response)
            })

            this.sendEvent({ ...payload, _id: ackId })
        })
    }

    async readCoils(address: number, length: number): Promise<CoilResult> {
        const registers = await this.readHoldingRegisters(COIL_ADDRESS_OFFSET + address, length)
        const data = registers.data.map((value) => value === 1)

        logger.debug(`readCoils(${address}, ${length}) => ${JSON.stringify(data)}`)
        return { data }
    }

    async writeCoil(address: number, value: boolean): Promise<void> {
        logger.debug(`writeCoil(${address}, ${value})`)
        // The coils seem to be on 10000+ addresses
        await this.writeRegister(COIL_ADDRESS_OFFSET + address, value ? 1 : 0)
    }

    // Reads are served from the local register cache, so no round trip to the cloud is needed
    readHoldingRegisters(address: number, length: number): Promise<RegisterResult> {
        const data: number[] = []

        for (let i = 0; i < length; i++) {
            const regAddress = address + i
            const value = this.registers.get(regAddress) ?? 0
            data.push(value)
        }

        logger.debug(`readHoldingRegisters(${address}, ${length}) => ${JSON.stringify(data)}`)
        return Promise.resolve({ data })
    }

    async writeRegister(address: number, value: number): Promise<void> {
        const info = this.registerInfo.get(address)
        const label = info?.symbol !== undefined && info.symbol !== '' ? info.symbol : `register ${address}`

        // Refusals are our own decision rather than a device failure, so they resolve instead of
        // rejecting: repeated rejections would trip the ErrorHandler's subsequent error limit and
        // bring the bridge down. Leaving the cache untouched means the next publish cycle reverts
        // the change in Home Assistant on its own.
        if (info === undefined) {
            logger.warn(`Refusing to write ${value} to register ${address}: not described by the device model`)
            return
        }

        const access = ACCESS_OVERRIDES.get(address) ?? info.access

        if (access !== 'RW') {
            logger.warn(`Refusing to write ${value} to ${label} (${address}): the device reports it as ${info.access}`)
            return
        }

        if ((info.min !== undefined && value < info.min) || (info.max !== undefined && value > info.max)) {
            logger.warn(
                `Refusing to write ${value} to ${label} (${address}): outside the device's bounds ${info.min}-${info.max}`
            )
            return
        }

        // Writing a value the unit already holds produces no changes notification, so there would
        // be nothing to confirm against.
        if (this.registers.get(address) === value) {
            logger.debug(`${label} (${address}) already holds ${value}, skipping write`)
            return
        }

        const oldValue = this.registers.get(address)
        logger.info(`writeRegister(${address}) [${label}]: ${oldValue} -> ${value}`)

        // The unit echoing the new value back is the authoritative confirmation. Holding register
        // writes are also acknowledged, but coil writes are not - waiting on the ack alone would
        // fail every mode and switch write even though the device applies them.
        const confirmation = this.waitForRegisterValue(address, value, WRITE_TIMEOUT_MS)

        // Still send with an ack so that an explicit backend error surfaces
        this.sendEventWithAck(
            {
                type: 'ucp',
                dst: this.deviceMac,
                data: {
                    type: 'command',
                    command: 'write',
                    id: address,
                    value,
                },
            },
            WRITE_TIMEOUT_MS,
            `No acknowledgement for write to register ${address}`
        )
            .then((payload) => {
                const response = (payload ?? {}) as WriteResponse

                if (response.error !== undefined) {
                    logger.error(
                        `Backend reported an error writing ${label} (${address}): ${JSON.stringify(response.error)}`
                    )
                }
            })
            .catch(() => {
                // Coil writes are never acknowledged; the changes stream is what confirms them
            })

        await confirmation
    }

    disconnect(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval)
            this.healthCheckInterval = null
        }
        if (this.socket) {
            this.socket.disconnect()
            this.socket = null
        }
    }
}
