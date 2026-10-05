import { NetworkConditionLink } from 'nengi'
import type {
    BinaryAdapter,
    BinaryPayload,
    ClientTransportHandlers,
    IClientNetworkAdapter,
    NetworkConditions,
    NetworkConditionStatus
} from 'nengi'
import { dataViewBinary } from 'nengi-dataviews'

export type WebSocketClientAdapterConfig = {
    binary?: BinaryAdapter<BinaryPayload, ArrayBuffer>
}

export type SimulatedWebSocketClientAdapterConfig = WebSocketClientAdapterConfig & {
    conditions: NetworkConditions
}

const liveTimers = {
    setTimeout(callback: () => void, delayMs: number) {
        return globalThis.setTimeout(callback, delayMs)
    },
    clearTimeout(handle: unknown) {
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
    }
}

class WebSocketClientAdapter implements IClientNetworkAdapter<BinaryPayload, ArrayBuffer, string> {
    readonly clientAdapterVersion = 2 as const
    socket: WebSocket | null = null
    binary: BinaryAdapter<BinaryPayload, ArrayBuffer>
    protected link?: NetworkConditionLink
    private handlers: ClientTransportHandlers<BinaryPayload> | null = null

    constructor(config: WebSocketClientAdapterConfig = {}) {
        this.binary = config.binary ?? dataViewBinary
    }

    open(url: string, handlers: ClientTransportHandlers<BinaryPayload>) {
        const socket = new WebSocket(url)
        socket.binaryType = 'arraybuffer'
        this.socket = socket
        this.handlers = handlers
        socket.onopen = () => {
            if (this.socket === socket) handlers.onOpen()
        }
        socket.onmessage = event => {
            if (this.socket !== socket) return
            if (!(event.data instanceof ArrayBuffer) && !ArrayBuffer.isView(event.data)) {
                handlers.onError(new Error('The nengi transport requires binary messages.'))
                return
            }
            const deliver = (payload: BinaryPayload) => {
                if (this.socket === socket) handlers.onMessage(payload)
            }
            if (this.link) this.link.sendServerToClient(event.data, deliver)
            else deliver(event.data)
        }
        socket.onclose = event => {
            if (this.socket !== socket) return
            this.detach(socket)
            this.socket = null
            this.handlers = null
            this.link?.clear()
            handlers.onClose({ code: event.code, reason: event.reason, wasClean: event.wasClean })
        }
        socket.onerror = cause => {
            if (this.socket === socket) handlers.onError(cause)
        }
    }

    send(payload: ArrayBuffer) {
        const socket = this.socket
        const handlers = this.handlers
        // The pending close event owns the reason; a late flush must not replace it.
        if (socket && (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED)) return
        if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('The WebSocket transport is not open.')
        const deliver = (message: ArrayBuffer) => {
            if (this.socket !== socket) return
            try {
                if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return
                if (socket.readyState !== WebSocket.OPEN) throw new Error('The WebSocket transport is not open.')
                socket.send(message)
            } catch (cause) {
                handlers?.onError(cause)
            }
        }
        if (this.link) this.link.sendClientToServer(payload, deliver)
        else deliver(payload)
    }

    close(reason: string) {
        const socket = this.socket
        this.socket = null
        this.handlers = null
        this.link?.clear()
        if (!socket) return
        this.detach(socket)
        // Browsers cannot force termination. Logical teardown is already done;
        // detach before a best-effort close, including during CONNECTING.
        try {
            socket.close(1000, reason)
        } catch {
            socket.close()
        }
    }

    private detach(socket: WebSocket) {
        socket.onopen = null
        socket.onmessage = null
        socket.onclose = null
        socket.onerror = null
    }
}

class SimulatedWebSocketClientAdapter extends WebSocketClientAdapter {
    readonly conditions: NetworkConditionLink

    constructor(config: SimulatedWebSocketClientAdapterConfig) {
        super(config)
        if (!config?.conditions) throw new Error('SimulatedWebSocketClientAdapter requires config.conditions.')
        this.conditions = new NetworkConditionLink(config.conditions, { timers: liveTimers })
        this.link = this.conditions
    }

    configureNetworkConditions(conditions: NetworkConditions) {
        this.conditions.configure(conditions)
    }

    getNetworkConditionStatus(): NetworkConditionStatus {
        return this.conditions.status()
    }
}

export { WebSocketClientAdapter, SimulatedWebSocketClientAdapter }
