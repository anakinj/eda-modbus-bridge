import {
    acknowledgeAlarm,
    getAlarmSummary,
    getDeviceInformation,
    getDeviceState,
    getMode,
    getModeSummary,
    getNewestAlarm,
    getReadings,
    getSettings,
    ModbusDeviceType,
    parseDevice,
    redactDevice,
    resetDeviceInformationCache,
    setMode,
    setSetting,
    validateDevice,
} from '../app/modbus'
import type { ModbusClient } from '../app/client'
import { FakeModbusClient } from './fakes/modbusClient'
import { AutomationType, HeatingType } from '../app/enervent'

test('validateDevice', () => {
    expect(validateDevice('/dev/ttyUSB0')).toEqual(true)
    expect(validateDevice('dev/ttyUSB0')).toEqual(false)
    expect(validateDevice('tcp://192.168.1.40:502')).toEqual(true)
    expect(validateDevice('192.168.1.40:502')).toEqual(false)
    expect(validateDevice('cloud://1234567890:54321')).toEqual(true)
    expect(validateDevice('1234567890:54321')).toEqual(false)
    // Without a PIN the device would only fail later, as a login the backend rejects
    expect(validateDevice('cloud://1234567890')).toEqual(false)
    expect(validateDevice('cloud://1234567890:')).toEqual(false)
    expect(validateDevice('cloud://:54321')).toEqual(false)
    expect(validateDevice('cloud://')).toEqual(false)
})

test('redactDevice', () => {
    // The PIN must never reach the logs, the serial number is fine
    expect(redactDevice('cloud://1234567890:54321')).toEqual('cloud://1234567890:<redacted>')
    // Non-cloud devices carry no secret and are left alone
    expect(redactDevice('/dev/ttyUSB0')).toEqual('/dev/ttyUSB0')
    expect(redactDevice('tcp://192.168.1.40:502')).toEqual('tcp://192.168.1.40:502')
})

test('parseDevice', () => {
    expect(parseDevice('/dev/ttyUSB0')).toEqual({
        type: ModbusDeviceType.RTU,
        path: '/dev/ttyUSB0',
    })
    expect(parseDevice('tcp://localhost:502')).toEqual({
        type: ModbusDeviceType.TCP,
        hostname: 'localhost',
        port: 502,
    })
    expect(parseDevice('tcp://127.0.0.1:502')).toEqual({
        type: ModbusDeviceType.TCP,
        hostname: '127.0.0.1',
        port: 502,
    })
    expect(parseDevice('cloud://1234567890:54321')).toEqual({
        type: ModbusDeviceType.CLOUD,
        serialNumber: '1234567890',
        pin: '54321',
    })
})

describe('setSetting', () => {
    let mockClient: ModbusClient

    beforeEach(() => {
        mockClient = {
            readCoils: jest.fn().mockResolvedValue({ data: [] }),
            writeCoil: jest.fn().mockResolvedValue(undefined),
            readHoldingRegisters: jest.fn().mockResolvedValue({ data: [] }),
            writeRegister: jest.fn().mockResolvedValue(undefined),
        }
    })

    describe('holding register settings (numeric)', () => {
        test('should accept string values for numeric settings', async () => {
            await setSetting(mockClient, 'temperatureTarget', '22.5')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(135, 225) // 22.5 * 10
        })

        test('should parse and round decimal values correctly', async () => {
            await setSetting(mockClient, 'temperatureTarget', '22.0')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(135, 220)

            await setSetting(mockClient, 'temperatureTarget', '18.75')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(135, 188) // rounds to 18.8 * 10

            await setSetting(mockClient, 'temperatureTarget', '18.74')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(135, 187) // rounds to 18.7 * 10
        })

        test('should parse integer strings for settings without decimals', async () => {
            await setSetting(mockClient, 'awayVentilationLevel', '50')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(100, 50)

            await setSetting(mockClient, 'overPressureDelay', '30')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(57, 30)
        })

        test('should truncate decimals for integer-only settings', async () => {
            await setSetting(mockClient, 'awayVentilationLevel', '50.5')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(100, 50) // truncates to 50
        })

        test('should reject boolean values for numeric settings', async () => {
            await expect(setSetting(mockClient, 'temperatureTarget', true)).rejects.toThrow(
                'Setting "temperatureTarget" expects a numeric value, got boolean'
            )
        })

        test('should apply registerScale when set', async () => {
            await setSetting(mockClient, 'awayTemperatureReduction', '5')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(101, 50) // 5 * 10
        })

        test('should not scale when registerScale is not set', async () => {
            await setSetting(mockClient, 'awayVentilationLevel', '75')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(100, 75) // no scaling
        })

        test('should enforce min/max validation', async () => {
            await expect(setSetting(mockClient, 'temperatureTarget', '5')).rejects.toThrow('value 5 below minimum 10')
            await expect(setSetting(mockClient, 'temperatureTarget', '35')).rejects.toThrow('value 35 above maximum 30')
        })

        test('should allow values within min/max range', async () => {
            await setSetting(mockClient, 'temperatureTarget', '20')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(135, 200) // 20 * 10
        })

        test('should accept boundary values for min/max', async () => {
            await setSetting(mockClient, 'temperatureTarget', '10')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(135, 100) // 10 * 10

            await setSetting(mockClient, 'temperatureTarget', '30')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(135, 300) // 30 * 10
        })

        test('should handle settings without min/max', async () => {
            await setSetting(mockClient, 'temperatureControlMode', '2')
            expect(mockClient.writeRegister).toHaveBeenCalledWith(136, 2) // no validation, no scaling
        })
    })

    describe('coil settings (boolean)', () => {
        test('should accept boolean values for coil settings', async () => {
            await setSetting(mockClient, 'coolingAllowed', true)
            expect(mockClient.writeCoil).toHaveBeenCalledWith(52, true)

            await setSetting(mockClient, 'heatingAllowed', false)
            expect(mockClient.writeCoil).toHaveBeenCalledWith(54, false)
        })

        test('should reject string values for coil settings', async () => {
            await expect(setSetting(mockClient, 'coolingAllowed', '1')).rejects.toThrow(
                'Setting "coolingAllowed" expects a boolean value, got string'
            )
        })
    })

    describe('unknown settings', () => {
        test('should reject unknown setting names', async () => {
            await expect(setSetting(mockClient, 'nonExistentSetting', '123')).rejects.toThrow(
                'Unknown setting "nonExistentSetting"'
            )
        })
    })
})

describe('device operations', () => {
    // A Pingvin with EDA automation, DC fans, CW cooling and EDE heating
    const DEVICE_REGISTERS = {
        154: 1, // cooling type, CW
        171: 3, // heating type, EDE/MDE
        596: 0,
        597: 0, // device family, Pingvin
        598: 12345, // serial number
        599: 217, // software version 2.17, i.e. EDA automation
        640: 1, // Modbus address
    }
    const DEVICE_COILS = {
        16: true, // EC (DC) fans
    }
    // MD automation unlocks eco mode and the fan speed readings
    const MD_AUTOMATION = { 599: 176 }

    const device = (registers: Record<number, number> = {}, coils: Record<number, boolean> = {}) =>
        new FakeModbusClient({ ...DEVICE_REGISTERS, ...registers }, { ...DEVICE_COILS, ...coils })

    beforeEach(() => resetDeviceInformationCache())

    describe('getDeviceInformation', () => {
        test('should describe the unit', async () => {
            const client = device()

            expect(await getDeviceInformation(client)).toEqual({
                softwareVersion: 2.17,
                automationType: AutomationType.EDA,
                fanType: 'EC',
                coolingTypeInstalled: 'CW',
                heatingTypeInstalled: HeatingType.EDE,
                modelType: 'Pingvin',
                modelName: 'Pingvin eco EDE/MDE - CW',
                serialNumber: 12345,
                modbusAddress: 1,
            })
        })

        test('should report AC fans when the motor type coil is off', async () => {
            const client = device({}, { 16: false })

            expect((await getDeviceInformation(client)).fanType).toEqual('AC')
        })

        test('should refuse to identify a device that reports no software version', async () => {
            await expect(getDeviceInformation(new FakeModbusClient())).rejects.toThrow('refusing to identify it')
            // Nothing bogus was cached, a working device still identifies
            expect(await getDeviceInformation(device())).toMatchObject({ modelType: 'Pingvin' })
        })

        test('should only read the device once', async () => {
            const client = device()

            await getDeviceInformation(client)
            const readsAfterFirstCall = client.registerReads.length
            await getDeviceInformation(client)

            expect(client.registerReads.length).toEqual(readsAfterFirstCall)
        })
    })

    describe('getModeSummary', () => {
        test('should report the state of each mode coil', async () => {
            const client = device(
                {},
                {
                    3: true, // overPressure
                    10: true, // manualBoost
                }
            )

            expect(await getModeSummary(client)).toEqual({
                away: false,
                longAway: false,
                overPressure: true,
                maxHeating: false,
                maxCooling: false,
                manualBoost: true,
            })
        })

        test('should include eco on MD automation only', async () => {
            const client = device(MD_AUTOMATION, { 40: true })

            expect(await getModeSummary(client)).toMatchObject({ eco: true })
        })
    })

    describe('getMode', () => {
        test('should read the coil belonging to the mode', async () => {
            const client = device({}, { 2: true })

            expect(await getMode(client, 'longAway')).toEqual(true)
            expect(client.coilReads).toContainEqual([2, 1])
        })

        test('should reject unknown modes', async () => {
            await expect(getMode(new FakeModbusClient(), 'nonExistentMode')).rejects.toThrow('Unknown mode')
        })
    })

    describe('setMode', () => {
        test('should disable the other modes when enabling one', async () => {
            const client = device()

            await setMode(client, 'away', true)

            expect(client.coilWrites).toEqual([
                [1, true],
                [2, false],
                [3, false],
                [6, false],
                [7, false],
                [10, false],
            ])
        })

        test('should leave the other modes alone when disabling one', async () => {
            const client = device()

            await setMode(client, 'away', false)

            expect(client.coilWrites).toEqual([[1, false]])
        })

        test('should reject unknown modes', async () => {
            await expect(setMode(new FakeModbusClient(), 'nonExistentMode', true)).rejects.toThrow('Unknown mode')
        })
    })

    describe('getReadings', () => {
        const READING_REGISTERS = {
            6: 12, // fresh air 1.2
            7: 180, // supply air after heat recovery 18.0
            8: 205, // supply air 20.5
            9: 45, // waste air 4.5
            10: 210, // exhaust air 21.0
            11: 215, // exhaust air before heat recovery 21.5
            13: 42, // exhaust air humidity
            29: 80, // heat recovery supply side
            30: 75, // heat recovery exhaust side
            31: 100, // heat recovery temperature difference supply side 10.0
            32: 90, // heat recovery temperature difference exhaust side 9.0
            35: 38, // 48 hour mean exhaust humidity
            45: 4, // temperature control state, heating
            46: 220, // room temperature average 22.0
            47: 205, // cascade Sp
            48: 10, // cascade P
            49: 5, // cascade I
            50: 45, // ventilation level actual
            53: 50, // ventilation level target
            56: 120, // over pressure time left
        }

        test('should read every sensor', async () => {
            const client = device(READING_REGISTERS)

            expect(await getReadings(client)).toEqual({
                freshAirTemperature: 1.2,
                supplyAirTemperatureAfterHeatRecovery: 18,
                supplyAirTemperature: 20.5,
                wasteAirTemperature: 4.5,
                exhaustAirTemperature: 21,
                exhaustAirHumidity: 42,
                heatRecoverySupplySide: 80,
                heatRecoveryExhaustSide: 75,
                heatRecoveryTemperatureDifferenceSupplySide: 10,
                heatRecoveryTemperatureDifferenceExhaustSide: 9,
                mean48HourExhaustHumidity: 38,
                temperatureControlState: 'HEATING',
                cascadeSp: 205,
                cascadeP: 10,
                cascadeI: 5,
                overPressureTimeLeft: 120,
                ventilationLevelActual: 45,
                ventilationLevelTarget: 50,
                roomTemperatureAvg: 22,
                exhaustAirTemperatureBeforeHeatRecovery: 21.5,
            })
        })

        test('should report the return water temperature on EDW units instead', async () => {
            const client = device({ ...READING_REGISTERS, 171: 1, 12: 300 })
            const readings = await getReadings(client)

            expect(readings).toMatchObject({ returnWaterTemperature: 30 })
            expect(readings).not.toHaveProperty('exhaustAirTemperatureBeforeHeatRecovery')
        })

        test('should include the control panel and fan speed readings on MD automation', async () => {
            const client = device({ ...MD_AUTOMATION, ...READING_REGISTERS, 1: 215, 2: 220, 3: 1500, 4: 1400 })

            expect(await getReadings(client)).toMatchObject({
                controlPanel1Temperature: 21.5,
                controlPanel2Temperature: 22,
                supplyFanSpeed: 1500,
                exhaustFanSpeed: 1400,
            })
        })

        test('should include configured analog sensors', async () => {
            const client = device({ ...READING_REGISTERS, 104: 1, 23: 450 })

            expect(await getReadings(client)).toMatchObject({ analogInputCo21: 450 })
        })
    })

    describe('getSettings', () => {
        const SETTING_REGISTERS = {
            54: 80, // supply fan over pressure
            55: 70, // exhaust fan over pressure
            57: 30, // over pressure delay
            100: 50, // away ventilation level
            101: 20, // away temperature reduction 2.0
            102: 40, // long away ventilation level
            103: 30, // long away temperature reduction 3.0
            135: 210, // temperature target 21.0
            136: 1, // temperature control mode
        }
        const SETTING_COILS = {
            12: false, // summer night cooling allowed
            18: true, // away heating allowed
            19: false, // away cooling allowed
            20: true, // long away heating allowed
            21: false, // long away cooling allowed
            52: true, // cooling allowed
            54: true, // heating allowed
            55: true, // defrosting allowed
        }

        test('should read every setting', async () => {
            const client = device(SETTING_REGISTERS, SETTING_COILS)

            expect(await getSettings(client)).toEqual({
                overPressureDelay: 30,
                awayVentilationLevel: 50,
                awayTemperatureReduction: 2,
                longAwayVentilationLevel: 40,
                longAwayTemperatureReduction: 3,
                temperatureTarget: 21,
                temperatureControlMode: 1,
                coolingAllowed: true,
                heatingAllowed: true,
                awayCoolingAllowed: false,
                awayHeatingAllowed: true,
                longAwayCoolingAllowed: false,
                longAwayHeatingAllowed: true,
                defrostingAllowed: true,
                summerNightCoolingAllowed: false,
                supplyFanOverPressure: 80,
                exhaustFanOverPressure: 70,
            })
        })

        test('should skip the heating and cooling permissions on legacy EDA units', async () => {
            const client = device({ ...SETTING_REGISTERS, 599: 201 }, SETTING_COILS)
            const settings = await getSettings(client)

            expect(settings).not.toHaveProperty('coolingAllowed')
            expect(settings).not.toHaveProperty('awayHeatingAllowed')
        })

        test('should include eco on MD automation', async () => {
            const client = device({ ...MD_AUTOMATION, ...SETTING_REGISTERS }, { ...SETTING_COILS, 40: true })

            expect(await getSettings(client)).toMatchObject({ eco: true })
        })
    })

    describe('getDeviceState', () => {
        test('should parse the state bit field', async () => {
            const client = new FakeModbusClient({ 44: 16 })

            expect(await getDeviceState(client)).toMatchObject({ normal: false, away: true, stop: false })
            expect(client.registerReads).toContainEqual([44, 1])
        })
    })

    describe('alarms', () => {
        // A heat pump alarm, active, raised 2024-11-05 14:30
        const ALARM_REGISTERS = { 385: 7, 386: 2, 387: 24, 388: 11, 389: 5, 390: 14, 391: 30 }

        test('getNewestAlarm should describe the alarm and when it was raised', async () => {
            const client = device(ALARM_REGISTERS)

            expect(await getNewestAlarm(client)).toEqual({
                name: 'HPError',
                description: 'Heatpump',
                type: 7,
                state: 2,
                timestamp: new Date(2024, 10, 5, 14, 30),
            })
        })

        test('getNewestAlarm should return null for an unknown alarm type', async () => {
            const client = device({ ...ALARM_REGISTERS, 385: 9999 })

            expect(await getNewestAlarm(client)).toBeNull()
        })

        test('getAlarmSummary should only mark the active alarm', async () => {
            const client = device(ALARM_REGISTERS)
            const summary = await getAlarmSummary(client)

            expect(summary.filter((alarm) => alarm.state !== 0)).toEqual([
                { name: 'HPError', description: 'Heatpump', type: 7, state: 2 },
            ])
        })

        test('acknowledgeAlarm should write the acknowledgement register', async () => {
            const client = device()

            await acknowledgeAlarm(client)

            expect(client.registerWrites).toEqual([[386, 1]])
        })
    })
})
