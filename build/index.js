"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketClientAdapter = void 0;
const nengi_dataviews_1 = require("nengi-dataviews");
class WebSocketClientAdapter {
    constructor(network, config = {}) {
        var _a;
        this.connected = false;
        this.socket = null;
        this.network = network;
        this.binary = (_a = config.binary) !== null && _a !== void 0 ? _a : nengi_dataviews_1.dataViewBinary;
    }
    flush() {
        if (!this.socket) {
            return;
        }
        if (this.socket.readyState !== 1) {
            return;
        }
        const buffer = this.network.createOutbound(this.binary);
        this.socket.send(buffer);
    }
    disconnect(reason) {
        var _a;
        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.close(1000, typeof reason === 'string' ? reason : JSON.stringify(reason !== null && reason !== void 0 ? reason : 'closed'));
        this.socket = null;
        this.connected = false;
    }
    setupWebsocket(socket) {
        this.socket = socket;
        socket.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer || ArrayBuffer.isView(event.data)) {
                const dr = this.binary.createReader(event.data);
                this.network.readSnapshot(dr);
            }
        };
        socket.onclose = (event) => {
            this.connected = false;
            this.network.onDisconnect(event.reason, event);
        };
        socket.onerror = (event) => {
            this.network.onSocketError(event);
        };
    }
    connect(wsUrl, handshake) {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(wsUrl);
            socket.binaryType = 'arraybuffer';
            let settled = false;
            socket.onopen = (event) => {
                socket.send(this.network.createHandshake(handshake, this.binary));
            };
            socket.onclose = (event) => {
                if (!settled) {
                    settled = true;
                    reject(event);
                    return;
                }
                this.connected = false;
                this.network.onDisconnect(event.reason, event);
            };
            socket.onerror = (event) => {
                this.network.onSocketError(event);
                if (!settled) {
                    settled = true;
                    reject(event);
                }
            };
            socket.onmessage = (event) => {
                // initially the only thing we care to read is a response to our handshake
                // we don't even setup the parser for the rest of what a nengi client can receive
                const result = this.network.readHandshakeResponse(this.binary.createReader(event.data));
                if (result.accepted) {
                    // setup listeners for normal game data
                    settled = true;
                    this.connected = true;
                    this.setupWebsocket(socket);
                    resolve(result);
                }
                else {
                    settled = true;
                    reject(result.reason);
                }
            };
        });
    }
}
exports.WebSocketClientAdapter = WebSocketClientAdapter;
