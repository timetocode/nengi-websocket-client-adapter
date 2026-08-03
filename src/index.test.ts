import {
    SimulatedWebSocketClientAdapter,
    WebSocketClientAdapter
} from './index'

class FakeWebSocket {
    static readonly OPEN = 1
    static instances: FakeWebSocket[] = []

    readyState = 0
    binaryType = ''
    sent: ArrayBuffer[] = []
    onopen: ((event: any) => void) | null = null
    onmessage: ((event: any) => void) | null = null
    onclose: ((event: any) => void) | null = null
    onerror: ((event: any) => void) | null = null

    constructor(readonly url: string) {
        FakeWebSocket.instances.push(this)
    }

    open() {
        this.readyState = FakeWebSocket.OPEN
        this.onopen?.({})
    }

    receive(data: ArrayBuffer) {
        this.onmessage?.({ data })
    }

    close(code = 1000, reason = '') {
        this.readyState = 3
        this.onclose?.({ code, reason })
    }

    send(payload: ArrayBuffer) {
        this.sent.push(payload)
    }
}

function bytes(...values: number[]) {
    return Uint8Array.from(values).buffer
}

function createNetwork() {
    return {
        createHandshake: jest.fn(() => bytes(1)),
        createOutbound: jest.fn(() => bytes(8)),
        readHandshakeResponse: jest.fn((): any => ({ accepted: true })),
        readSnapshot: jest.fn(),
        flushPongs: jest.fn((_binary, send: (payload: ArrayBuffer) => void) => {
            send(bytes(9))
            return 1
        }),
        onDisconnect: jest.fn(),
        onSocketError: jest.fn()
    }
}

describe('browser client adapters', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        FakeWebSocket.instances = []
        ;(globalThis as any).WebSocket = FakeWebSocket
    })

    afterEach(() => {
        jest.useRealTimers()
        delete (globalThis as any).WebSocket
    })

    it('conditions the handshake and sends automatic Pongs through the simulated link', async () => {
        const network = createNetwork()
        const adapter = new SimulatedWebSocketClientAdapter(network as any, {
            conditions: {
                seed: 7,
                clientToServer: { latencyMs: 50 },
                serverToClient: { latencyMs: 70 }
            }
        })
        network.readSnapshot.mockImplementation(() => adapter.flushPongs())

        const connecting = adapter.connect('ws://test')
        const socket = FakeWebSocket.instances[0]
        socket.open()

        jest.advanceTimersByTime(49)
        expect(socket.sent).toHaveLength(0)
        jest.advanceTimersByTime(1)
        expect(Array.from(new Uint8Array(socket.sent[0]))).toEqual([1])

        socket.receive(bytes(2))
        jest.advanceTimersByTime(70)
        await expect(connecting).resolves.toMatchObject({ accepted: true })

        socket.receive(bytes(3))
        jest.advanceTimersByTime(70)
        expect(network.readSnapshot).toHaveBeenCalledTimes(1)
        expect(adapter.getNetworkConditionStatus().clientToServer.queued).toBe(1)
        jest.advanceTimersByTime(50)
        expect(Array.from(new Uint8Array(socket.sent[1]))).toEqual([9])

        adapter.configureNetworkConditions({
            seed: 8,
            clientToServer: { latencyMs: 1000 }
        })
        adapter.flush()
        expect(adapter.getNetworkConditionStatus().clientToServer.queued).toBe(1)
        adapter.disconnect('done')
        jest.advanceTimersByTime(1000)
        expect(socket.sent).toHaveLength(2)
        expect(adapter.getNetworkConditionStatus().clientToServer.queued).toBe(0)
    })

    it('reports rejection and established transport closure', async () => {
        const rejectedNetwork = createNetwork()
        rejectedNetwork.readHandshakeResponse.mockReturnValue({
            accepted: false,
            reason: 'denied'
        })
        const rejected = new WebSocketClientAdapter(rejectedNetwork as any)
        const rejectedConnect = rejected.connect('ws://rejected')
        const rejectedSocket = FakeWebSocket.instances[0]
        rejectedSocket.open()
        rejectedSocket.receive(bytes(2))
        await expect(rejectedConnect).rejects.toBe('denied')

        const network = createNetwork()
        const adapter = new WebSocketClientAdapter(network as any)
        const connecting = adapter.connect('ws://accepted')
        const socket = FakeWebSocket.instances[1]
        socket.open()
        socket.receive(bytes(2))
        await connecting
        socket.close(1006, 'transport_lost')

        expect(network.onDisconnect).toHaveBeenCalledWith(
            'transport_lost',
            expect.objectContaining({ code: 1006 })
        )
    })
})
