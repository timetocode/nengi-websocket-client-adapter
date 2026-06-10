import {
    ClientNetwork
} from 'nengi'
import type { BinaryAdapter, BinaryPayload, IClientNetworkAdapter } from 'nengi'

import { dataViewBinary } from 'nengi-dataviews'

type WebSocketClientAdapterConfig = {
    binary?: BinaryAdapter<BinaryPayload, ArrayBuffer>
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

    connect(wsUrl: string, handshake: any) {
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
                    reject(result.reason)
                }
            }
        })
    }
}

export { WebSocketClientAdapter }
