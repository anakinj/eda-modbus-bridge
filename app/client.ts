export type CoilResult = {
    data: boolean[]
}

export type RegisterResult = {
    data: number[]
}

// Structurally satisfied by both ModbusRTU and EnerventCloudClient, neither of which declares it
export interface ModbusClient {
    readCoils(dataAddress: number, length: number): Promise<CoilResult>
    writeCoil(dataAddress: number, state: boolean): Promise<unknown>
    readHoldingRegisters(dataAddress: number, length: number): Promise<RegisterResult>
    writeRegister(dataAddress: number, value: number): Promise<unknown>
}
