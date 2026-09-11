import type { CoilResult, ModbusClient, RegisterResult } from '../../app/client'

// Unseeded addresses read as 0/false, so fixtures only define what a test asserts on
export class FakeModbusClient implements ModbusClient {
    readonly registerReads: [number, number][] = []
    readonly coilReads: [number, number][] = []
    readonly registerWrites: [number, number][] = []
    readonly coilWrites: [number, boolean][] = []

    private readonly registers: Record<number, number>
    private readonly coils: Record<number, boolean>

    constructor(registers: Record<number, number> = {}, coils: Record<number, boolean> = {}) {
        this.registers = { ...registers }
        this.coils = { ...coils }
    }

    readCoils(dataAddress: number, length: number): Promise<CoilResult> {
        this.coilReads.push([dataAddress, length])

        const data: boolean[] = []
        for (let i = 0; i < length; i++) {
            data.push(this.coils[dataAddress + i] ?? false)
        }

        return Promise.resolve({ data })
    }

    writeCoil(dataAddress: number, state: boolean): Promise<void> {
        this.coilWrites.push([dataAddress, state])
        this.coils[dataAddress] = state

        return Promise.resolve()
    }

    readHoldingRegisters(dataAddress: number, length: number): Promise<RegisterResult> {
        this.registerReads.push([dataAddress, length])

        const data: number[] = []
        for (let i = 0; i < length; i++) {
            data.push(this.registers[dataAddress + i] ?? 0)
        }

        return Promise.resolve({ data })
    }

    writeRegister(dataAddress: number, value: number): Promise<void> {
        this.registerWrites.push([dataAddress, value])
        this.registers[dataAddress] = value

        return Promise.resolve()
    }
}
