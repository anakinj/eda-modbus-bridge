import { EventEmitter } from 'events'

export type SentMessage = {
    _id?: number
    type?: string
    dst?: string
    sessid?: string
    data?: {
        type?: string
        cmd?: string
        command?: string
        serialnumber?: string
        pin?: string
        id?: number
        value?: number
    }
}

// The backend talks in JSON strings carried on the "message" event, not in objects
export class FakeSocket extends EventEmitter {
    readonly sent: SentMessage[] = []
    readonly io = new EventEmitter()

    disconnected = false
    reconnects = 0

    send(message: string): void {
        this.sent.push(JSON.parse(message) as SentMessage)
    }

    onAny(): void {
        // The client only logs events it doesn't handle
    }

    // The client bounces a stale connection with socket.disconnect().connect()
    disconnect(): this {
        this.disconnected = true

        return this
    }

    connect(): this {
        this.disconnected = false
        this.reconnects++

        return this
    }

    receive(payload: unknown): void {
        this.emit('message', JSON.stringify(payload))
    }

    receiveRaw(message: string): void {
        this.emit('message', message)
    }

    lastSent(): SentMessage {
        return this.sent[this.sent.length - 1]
    }
}
