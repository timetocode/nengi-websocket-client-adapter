import {
    NetworkConditionLink
} from 'nengi'
import type {
    BinaryAdapter,
    BinaryPayload,
    ClientNetwork,
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
    socket: WebSocket | null
    network: ClientNetwork
    binary: BinaryAdapter<BinaryPayload, ArrayBuffer>
    connected = false

    constructor(network: ClientNetwork, config: WebSocketClientAdapterConfig = {}) {
        this.socket = null
        this.network = network
        this.binary = config.binary ?? dataViewBinary
    }

    flush() {
        if (!this.socket) {
            return
        }

        if (this.socket!.readyState !== 1) {
            return
        }

        const buffer = this.network.createOutbound(this.binary)
        this.socket!.send(buffer)
    }

    flushPongs() {
        const socket = this.socket
        if (!socket || socket.readyState !== WebSocket.OPEN || !this.connected) {
            return
        }
        try {
            this.network.flushPongs(this.binary, payload => socket.send(payload))
        } catch (error) {
            this.network.onSocketError(error)
        }
    }

    disconnect(reason?: any) {
        this.socket?.close(1000, typeof reason === 'string' ? reason : JSON.stringify(reason ?? 'closed'))
        this.socket = null
        this.connected = false
    }

    private setupWebsocket(socket: WebSocket) {
        this.socket = socket

        socket.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer || ArrayBuffer.isView(event.data)) {
                const dr = this.binary.createReader(event.data)
                this.network.readSnapshot(dr)
            }
        }

        socket.onclose = (event) => {
            this.connected = false
            this.network.onDisconnect(event.reason, event)
        }

        socket.onerror = (event) => {
            this.network.onSocketError(event)
        }
    }

    connect(wsUrl: string, handshake: any = {}) {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(wsUrl)
            socket.binaryType = 'arraybuffer'
            let settled = false

            socket.onopen = (event) => {
                socket.send(this.network.createHandshake(handshake, this.binary))
            }

            socket.onclose = (event) => {
                if (!settled) {
                    settled = true
                    reject(event)
                    return
                }
                this.connected = false
                this.network.onDisconnect(event.reason, event)
            }

            socket.onerror = (event) => {
                this.network.onSocketError(event)
                if (!settled) {
                    settled = true
                    reject(event)
                }
            }

            socket.onmessage = (event) => {
                // initially the only thing we care to read is a response to our handshake
                // we don't even setup the parser for the rest of what a nengi client can receive
                const result = this.network.readHandshakeResponse(this.binary.createReader(event.data))
                if (result.accepted) {
                    // setup listeners for normal game data
                    settled = true
                    this.connected = true
                    this.setupWebsocket(socket)
                    resolve(result)
                } else {
                    settled = true
                    socket.close(1000, typeof result.reason === 'string' ? result.reason : JSON.stringify(result.reason ?? 'closed'))
                    reject(result.reason)
                }
            }
        })
    }
}

class SimulatedWebSocketClientAdapter implements IClientNetworkAdapter<BinaryPayload, ArrayBuffer, string> {
    socket: WebSocket | null = null
    network: ClientNetwork
    binary: BinaryAdapter<BinaryPayload, ArrayBuffer>
    connected = false
    readonly conditions: NetworkConditionLink

    constructor(network: ClientNetwork, config: SimulatedWebSocketClientAdapterConfig) {
        if (!config?.conditions) {
            throw new Error('SimulatedWebSocketClientAdapter requires config.conditions.')
        }
        this.network = network
        this.binary = config.binary ?? dataViewBinary
        this.conditions = new NetworkConditionLink(config.conditions, {
            timers: liveTimers
        })
    }

    flush() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.connected) {
            return
        }
        this.send(this.network.createOutbound(this.binary))
    }

    flushPongs() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.connected) {
            return
        }
        try {
            this.network.flushPongs(this.binary, payload => this.send(payload))
        } catch (error) {
            this.network.onSocketError(error)
        }
    }

    disconnect(reason?: any) {
        this.conditions.clear()
        this.socket?.close(1000, closeReason(reason))
        this.socket = null
        this.connected = false
    }

    configureNetworkConditions(conditions: NetworkConditions) {
        this.conditions.configure(conditions)
    }

    getNetworkConditionStatus(): NetworkConditionStatus {
        return this.conditions.status()
    }

    connect(wsUrl: string, handshake: any = {}) {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(wsUrl)
            socket.binaryType = 'arraybuffer'
            this.socket = socket
            let settled = false

            socket.onopen = () => {
                this.send(this.network.createHandshake(handshake, this.binary))
            }

            socket.onclose = event => {
                const wasConnected = this.connected
                this.conditions.clear()
                this.socket = null
                this.connected = false
                if (!settled) {
                    settled = true
                    reject(event)
                    return
                }
                if (wasConnected) {
                    this.network.onDisconnect(event.reason, event)
                }
            }

            socket.onerror = event => {
                this.network.onSocketError(event)
                if (!settled) {
                    settled = true
                    reject(event)
                    this.conditions.clear()
                    socket.close()
                }
            }

            socket.onmessage = event => {
                if (!(event.data instanceof ArrayBuffer) && !ArrayBuffer.isView(event.data)) {
                    return
                }
                this.conditions.sendServerToClient(event.data, payload => {
                    if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) {
                        return
                    }
                    if (settled && !this.connected) {
                        return
                    }
                    if (!this.connected) {
                        const result = this.network.readHandshakeResponse(this.binary.createReader(payload))
                        if (result.accepted) {
                            settled = true
                            this.connected = true
                            resolve(result)
                        } else {
                            settled = true
                            socket.close(1000, closeReason(result.reason))
                            reject(result.reason)
                        }
                        return
                    }
                    this.network.readSnapshot(this.binary.createReader(payload))
                })
            }
        })
    }

    private send(buffer: ArrayBuffer) {
        const socket = this.socket
        if (!socket) {
            return
        }
        this.conditions.sendClientToServer(buffer, payload => {
            if (socket === this.socket && socket.readyState === WebSocket.OPEN) {
                socket.send(payload)
            }
        })
    }
}

function closeReason(reason?: any) {
    return typeof reason === 'string' ? reason : JSON.stringify(reason ?? 'closed')
}

export { WebSocketClientAdapter, SimulatedWebSocketClientAdapter }
