import {
    EngineMessage,
    BinarySection,
    ClientNetwork,
    Context
} from 'nengi'

import { DataViewReader, DataViewWriter } from 'nengi-dataviews'

class WebSocketClientAdapter {
    socket: WebSocket | null
    network: ClientNetwork
    context: Context

    constructor(network: ClientNetwork, config: any) {
        this.socket = null
        this.network = network
        this.context = this.network.client.context
    }

    flush() {
        if (!this.socket) {
            console.log('CANCELED, no socket')
            return
        }

        if (this.socket!.readyState !== 1) {
            console.log('socket not open')
            return
        }

        const buffer = this.network.createOutboundBuffer(DataViewWriter)
        this.socket!.send(buffer)
    }

    setupWebsocket(socket: WebSocket) {
        this.socket = socket

        socket.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                const dr = new DataViewReader(event.data, 0)
                this.network.readSnapshot(dr)
            }
        }

        socket.onclose = (event) => {
            this.network.onDisconnect(JSON.parse(event.reason))
        }

        socket.onerror = (event) => {
            this.network.onSocketError(event)
        }
    }

    connect(wsUrl: string, handshake: any) {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(wsUrl)
            socket.binaryType = 'arraybuffer'

            socket.onopen = (event) => {
                socket.send(this.network.createHandshakeBuffer(handshake, DataViewWriter))
            }

            socket.onclose = function (event) {
                reject(event)
            }

            socket.onerror = function (event) {
                reject(event)
            }

            socket.onmessage = (event) => {
                // initially the only thing we care to read is a response to our handshake
                // we don't even setup the parser for the rest of what a nengi client can receive
                const dr = new DataViewReader(event.data, 0)
                const type = dr.readUInt8() // type of message
                if (type === BinarySection.EngineMessages) {
                    const count = dr.readUInt8() // quantity of engine messages
                    const connectionResponseByte = dr.readUInt8()
                    if (connectionResponseByte === EngineMessage.ConnectionAccepted) {
                        // setup listeners for normal game data
                        this.setupWebsocket(socket)
                        resolve('accepted')
                    }
                    if (connectionResponseByte === EngineMessage.ConnectionDenied) {
                        const denyReason = JSON.parse(dr.readString())
                        reject(denyReason)
                    }
                }
            }
        })
    }
}

export { WebSocketClientAdapter }