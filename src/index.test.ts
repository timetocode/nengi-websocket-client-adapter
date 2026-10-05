import { Client, Context, WIRE_PROTOCOL_VERSION } from 'nengi'
import { dataViewBinary } from 'nengi-dataviews'
import { SimulatedWebSocketClientAdapter, WebSocketClientAdapter } from './index'

class FakeWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    static instances: FakeWebSocket[] = []
    readyState = 0
    binaryType = ''
    sent: ArrayBuffer[] = []
    onopen: (() => void) | null = null
    onmessage: ((event: any) => void) | null = null
    onclose: ((event: any) => void) | null = null
    onerror: ((event: any) => void) | null = null
    close = jest.fn(() => { this.readyState = 2 })

    constructor(readonly url: string) {
        FakeWebSocket.instances.push(this)
    }

    open() {
        this.readyState = FakeWebSocket.OPEN
        this.onopen?.()
    }

    receive(data: ArrayBuffer) {
        this.onmessage?.({ data })
    }

    send(payload: ArrayBuffer) {
        this.sent.push(payload)
    }
}

function acceptance(clientData?: unknown) {
    const json = clientData === undefined ? '' : JSON.stringify(clientData)
    const writer = dataViewBinary.createWriter(9 + new TextEncoder().encode(json).byteLength)
    // Deliberate wire fixture: EngineMessages (1), one ConnectionAccepted (1).
    writer.writeUInt8(1)
    writer.writeUInt8(1)
    writer.writeUInt8(1)
    writer.writeUInt16(WIRE_PROTOCOL_VERSION)
    writer.writeString(json)
    return writer.payload
}

function snapshot() {
    const writer = dataViewBinary.createWriter(10)
    writer.writeUInt8(0x4e)
    writer.writeUInt8(WIRE_PROTOCOL_VERSION)
    writer.writeFloat64(100)
    return writer.payload
}

const originalWebSocket = globalThis.WebSocket
beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(0)
    FakeWebSocket.instances = []
    Object.assign(globalThis, { WebSocket: FakeWebSocket })
})
afterEach(() => {
    jest.useRealTimers()
    Object.assign(globalThis, { WebSocket: originalWebSocket })
})

describe.each([WebSocketClientAdapter, SimulatedWebSocketClientAdapter])('%p browser lifecycle', Adapter => {
    function setup() {
        const client = new Client(new Context(), Adapter, 20, { conditions: { seed: 1 } }, {
            now: Date.now, connectTimeoutMs: 100, serverTimeoutMs: 200
        })
        const closed = jest.fn()
        client.setDisconnectHandler(closed)
        return { client, closed }
    }

    it('returns JSON acceptance data through the browser binary backend', async () => {
        const { client } = setup()
        const data = { character: '旅人 🪁', settings: { music: false }, slots: [1, 3] }
        const connecting = client.connect<typeof data>('ws://test')
        const socket = FakeWebSocket.instances[0]
        socket.open()
        socket.receive(acceptance(data))
        jest.advanceTimersByTime(1)
        await expect(connecting).resolves.toEqual(data)
        expect(client.connectionState).toBe('connected')
        client.disconnect()
    })

    it.each(['error', 'cancelled', 'timeout', 'malformed', 'invalid handshake', 'closed'])('isolates a retry from a previous %s attempt', async outcome => {
        const { client, closed } = setup()
        const connecting = client.connect('ws://first', outcome === 'invalid handshake' ? { bad: BigInt(1) } : {})
        const rejected = expect(connecting).rejects.toBeDefined()
        const old = FakeWebSocket.instances[0]
        const late = { open: old.onopen, message: old.onmessage, error: old.onerror, close: old.onclose }
        if (outcome === 'cancelled') client.disconnect()
        if (outcome === 'timeout') jest.advanceTimersByTime(100)
        if (outcome === 'error') old.onerror?.(new Error('failed'))
        if (outcome === 'closed') old.onclose?.({ code: 1006, reason: 'lost' })
        if (outcome === 'invalid handshake' || outcome === 'malformed') old.open()
        if (outcome === 'malformed') old.receive(new ArrayBuffer(1))
        jest.advanceTimersByTime(1)
        await rejected
        expect(client.connectionState).toBe('idle')
        expect(client.adapter.socket).toBeNull()
        expect(closed).not.toHaveBeenCalled()

        const retry = client.connect('ws://retry')
        const current = FakeWebSocket.instances[1]
        current.open()
        late.open?.()
        late.message?.({ data: acceptance() })
        late.error?.('late')
        late.close?.({ reason: 'late' })
        expect(client.connectionState).toBe('connecting')
        current.receive(acceptance())
        jest.advanceTimersByTime(1)
        await expect(retry).resolves.toBeUndefined()
        expect(client.connectionState).toBe('connected')
        current.receive(snapshot())
        jest.advanceTimersByTime(1)
        expect(client.network.getPendingFrameCount()).toBe(1)
        client.disconnect()
        expect(closed).toHaveBeenCalledTimes(1)
    })

    it('settles immediately without a physical close event or serializing diagnostic details', async () => {
        const { client, closed } = setup()
        const connecting = client.connect('ws://test')
        const socket = FakeWebSocket.instances[0]
        socket.open()
        socket.receive(acceptance())
        jest.advanceTimersByTime(1)
        await connecting
        const pending = client.request(1, {}, { timeoutMs: 0 })
        const rejected = expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' })
        const detail: any = { text: 'é'.repeat(1000) }
        detail.self = detail
        client.disconnect(detail)
        expect(client.connectionState).toBe('closed')
        expect(closed).toHaveBeenCalledTimes(1)
        expect(closed.mock.calls[0][0].detail).toBe(detail)
        expect(socket.close).toHaveBeenCalledWith(1000, 'LOCAL_DISCONNECT')
        expect(socket.onmessage).toBeNull()
        expect(socket.onclose).toBeNull()
        expect(socket.readyState).toBe(2)
        await rejected
        expect(jest.getTimerCount()).toBe(0)
    })

    it('ends once on error even if close also arrives', async () => {
        const { client, closed } = setup()
        const connecting = client.connect('ws://test')
        const socket = FakeWebSocket.instances[0]
        socket.open()
        socket.receive(acceptance())
        jest.advanceTimersByTime(1)
        await connecting
        const lateClose = socket.onclose
        const cause = new Error('socket failed')
        socket.onerror?.(cause)
        lateClose?.({ code: 1006 })
        expect(closed).toHaveBeenCalledTimes(1)
        expect(closed).toHaveBeenCalledWith(expect.objectContaining({ code: 'TRANSPORT_ERROR', cause }))
    })

    it.each([FakeWebSocket.CLOSING, FakeWebSocket.CLOSED])('preserves the queued close reason when flush sees readyState %s', async state => {
        const { client, closed } = setup()
        const connecting = client.connect('ws://test')
        const socket = FakeWebSocket.instances[0]
        socket.open()
        socket.receive(acceptance())
        jest.advanceTimersByTime(1)
        await connecting
        const pending = client.request(1, {}, { timeoutMs: 0 })
        const rejected = expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' })
        const closeEvent = { code: 1000, reason: '{"reason":"participant_in_use"}', wasClean: true }
        const queuedClose = socket.onclose!
        const sent = socket.sent.length
        socket.readyState = state
        client.flush()
        jest.advanceTimersByTime(1)
        expect(closed).not.toHaveBeenCalled()
        expect(client.connectionState).toBe('connected')
        expect(socket.sent).toHaveLength(sent)
        expect(socket.close).not.toHaveBeenCalled()
        expect(socket.onclose).toBe(queuedClose)
        queuedClose(closeEvent)
        queuedClose(closeEvent)
        expect(closed).toHaveBeenCalledTimes(1)
        expect(closed).toHaveBeenCalledWith(expect.objectContaining({ code: 'REMOTE_CLOSE', detail: closeEvent }))
        await rejected
        expect(client.connectionState).toBe('closed')
        expect(jest.getTimerCount()).toBe(0)
    })

    it('still times out a closing transport that never delivers its close event', async () => {
        const { client, closed } = setup()
        const connecting = client.connect('ws://test')
        const socket = FakeWebSocket.instances[0]
        socket.open()
        socket.receive(acceptance())
        jest.advanceTimersByTime(1)
        await connecting
        const pending = client.request(1, {}, { timeoutMs: 0 })
        const rejected = expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' })
        socket.readyState = FakeWebSocket.CLOSING
        client.flush()
        expect(closed).not.toHaveBeenCalled()
        jest.advanceTimersByTime(200)
        expect(closed).toHaveBeenCalledTimes(1)
        expect(closed).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVER_TIMEOUT' }))
        await rejected
        expect(socket.onclose).toBeNull()
        expect(jest.getTimerCount()).toBe(0)
    })

    it('keeps absent/connecting sockets and genuine open-socket send errors as failures', () => {
        const config = { binary: dataViewBinary, conditions: { seed: 1 } }
        const adapter = new Adapter(config)
        const handlers = { onOpen: jest.fn(), onMessage: jest.fn(), onClose: jest.fn(), onError: jest.fn() }
        const payload = new ArrayBuffer(2)
        expect(() => adapter.send(payload)).toThrow('not open')
        adapter.open('ws://test', handlers)
        const socket = FakeWebSocket.instances[0]
        expect(() => adapter.send(payload)).toThrow('not open')
        socket.open()
        adapter.send(payload)
        jest.advanceTimersByTime(1)
        expect(socket.sent).toHaveLength(1)
        expect(handlers.onError).not.toHaveBeenCalled()
        const cause = new Error('write failed')
        jest.spyOn(socket, 'send').mockImplementation(() => { throw cause })
        adapter.send(payload)
        jest.advanceTimersByTime(1)
        expect(handlers.onError).toHaveBeenCalledWith(cause)
        adapter.close('done')
    })
})

test.each([FakeWebSocket.CLOSING, FakeWebSocket.CLOSED])('a delayed send preserves a later close reason at readyState %s', async state => {
    const client = new Client(new Context(), SimulatedWebSocketClientAdapter, 20, {
        conditions: { seed: 1 }
    }, { now: Date.now, serverTimeoutMs: 200 })
    const closed = jest.fn()
    client.setDisconnectHandler(closed)
    const connecting = client.connect('ws://test')
    const socket = FakeWebSocket.instances[0]
    socket.open()
    socket.receive(acceptance())
    jest.advanceTimersByTime(1)
    await connecting
    client.adapter.configureNetworkConditions({ seed: 1, clientToServer: { latencyMs: 20 } })
    const pending = client.request(1, {}, { timeoutMs: 0 })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' })
    const sent = socket.sent.length
    client.flush()
    expect(client.adapter.conditions.status().clientToServer.queued).toBe(1)
    socket.readyState = state
    jest.advanceTimersByTime(20)
    expect(closed).not.toHaveBeenCalled()
    expect(socket.sent).toHaveLength(sent)
    expect(client.adapter.conditions.status().clientToServer.queued).toBe(0)
    const detail = { code: 1000, reason: '{"reason":"participant_in_use"}', wasClean: true }
    socket.onclose!(detail)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ code: 'REMOTE_CLOSE', detail }))
    await rejected
    expect(jest.getTimerCount()).toBe(0)
})

test('simulation delays the handshake within the same connection budget and clears abandoned deliveries', async () => {
    const client = new Client(new Context(), SimulatedWebSocketClientAdapter, 20, {
        conditions: { seed: 3, clientToServer: { latencyMs: 40 }, serverToClient: { latencyMs: 70 } }
    }, { now: Date.now, connectTimeoutMs: 100 })
    const connecting = client.connect('ws://test')
    const rejected = expect(connecting).rejects.toMatchObject({ code: 'CONNECT_TIMEOUT' })
    const socket = FakeWebSocket.instances[0]
    socket.open()
    jest.advanceTimersByTime(40)
    expect(socket.sent).toHaveLength(1)
    socket.receive(acceptance())
    expect(client.adapter.conditions.status().serverToClient.queued).toBe(1)
    jest.advanceTimersByTime(60)
    await rejected
    expect(client.adapter.conditions.status().serverToClient.queued).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(100)
    expect(client.connectionState).toBe('idle')
})
