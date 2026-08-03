"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulatedWebSocketClientAdapter = exports.WebSocketClientAdapter = void 0;
const nengi_1 = require("nengi");
const nengi_dataviews_1 = require("nengi-dataviews");
const liveTimers = {
    setTimeout(callback, delayMs) {
        return globalThis.setTimeout(callback, delayMs);
    },
    clearTimeout(handle) {
        globalThis.clearTimeout(handle);
    }
};
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
    flushPongs() {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN || !this.connected) {
            return;
        }
        try {
            this.network.flushPongs(this.binary, payload => socket.send(payload));
        }
        catch (error) {
            this.network.onSocketError(error);
        }
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
    connect(wsUrl, handshake = {}) {
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
                var _a;
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
                    socket.close(1000, typeof result.reason === 'string' ? result.reason : JSON.stringify((_a = result.reason) !== null && _a !== void 0 ? _a : 'closed'));
                    reject(result.reason);
                }
            };
        });
    }
}
exports.WebSocketClientAdapter = WebSocketClientAdapter;
class SimulatedWebSocketClientAdapter {
    constructor(network, config) {
        var _a;
        this.socket = null;
        this.connected = false;
        if (!(config === null || config === void 0 ? void 0 : config.conditions)) {
            throw new Error('SimulatedWebSocketClientAdapter requires config.conditions.');
        }
        this.network = network;
        this.binary = (_a = config.binary) !== null && _a !== void 0 ? _a : nengi_dataviews_1.dataViewBinary;
        this.conditions = new nengi_1.NetworkConditionLink(config.conditions, {
            timers: liveTimers
        });
    }
    flush() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.connected) {
            return;
        }
        this.send(this.network.createOutbound(this.binary));
    }
    flushPongs() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.connected) {
            return;
        }
        try {
            this.network.flushPongs(this.binary, payload => this.send(payload));
        }
        catch (error) {
            this.network.onSocketError(error);
        }
    }
    disconnect(reason) {
        var _a;
        this.conditions.clear();
        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.close(1000, closeReason(reason));
        this.socket = null;
        this.connected = false;
    }
    configureNetworkConditions(conditions) {
        this.conditions.configure(conditions);
    }
    getNetworkConditionStatus() {
        return this.conditions.status();
    }
    connect(wsUrl, handshake = {}) {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(wsUrl);
            socket.binaryType = 'arraybuffer';
            this.socket = socket;
            let settled = false;
            socket.onopen = () => {
                this.send(this.network.createHandshake(handshake, this.binary));
            };
            socket.onclose = event => {
                const wasConnected = this.connected;
                this.conditions.clear();
                this.socket = null;
                this.connected = false;
                if (!settled) {
                    settled = true;
                    reject(event);
                    return;
                }
                if (wasConnected) {
                    this.network.onDisconnect(event.reason, event);
                }
            };
            socket.onerror = event => {
                this.network.onSocketError(event);
                if (!settled) {
                    settled = true;
                    reject(event);
                    this.conditions.clear();
                    socket.close();
                }
            };
            socket.onmessage = event => {
                if (!(event.data instanceof ArrayBuffer) && !ArrayBuffer.isView(event.data)) {
                    return;
                }
                this.conditions.sendServerToClient(event.data, payload => {
                    if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) {
                        return;
                    }
                    if (settled && !this.connected) {
                        return;
                    }
                    if (!this.connected) {
                        const result = this.network.readHandshakeResponse(this.binary.createReader(payload));
                        if (result.accepted) {
                            settled = true;
                            this.connected = true;
                            resolve(result);
                        }
                        else {
                            settled = true;
                            socket.close(1000, closeReason(result.reason));
                            reject(result.reason);
                        }
                        return;
                    }
                    this.network.readSnapshot(this.binary.createReader(payload));
                });
            };
        });
    }
    send(buffer) {
        const socket = this.socket;
        if (!socket) {
            return;
        }
        this.conditions.sendClientToServer(buffer, payload => {
            if (socket === this.socket && socket.readyState === WebSocket.OPEN) {
                socket.send(payload);
            }
        });
    }
}
exports.SimulatedWebSocketClientAdapter = SimulatedWebSocketClientAdapter;
function closeReason(reason) {
    return typeof reason === 'string' ? reason : JSON.stringify(reason !== null && reason !== void 0 ? reason : 'closed');
}
