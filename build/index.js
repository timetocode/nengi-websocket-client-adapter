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
    constructor(config = {}) {
        var _a;
        this.clientAdapterVersion = 2;
        this.socket = null;
        this.handlers = null;
        this.binary = (_a = config.binary) !== null && _a !== void 0 ? _a : nengi_dataviews_1.dataViewBinary;
    }
    open(url, handlers) {
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        this.socket = socket;
        this.handlers = handlers;
        socket.onopen = () => {
            if (this.socket === socket)
                handlers.onOpen();
        };
        socket.onmessage = event => {
            if (this.socket !== socket)
                return;
            if (!(event.data instanceof ArrayBuffer) && !ArrayBuffer.isView(event.data)) {
                handlers.onError(new Error('The nengi transport requires binary messages.'));
                return;
            }
            const deliver = (payload) => {
                if (this.socket === socket)
                    handlers.onMessage(payload);
            };
            if (this.link)
                this.link.sendServerToClient(event.data, deliver);
            else
                deliver(event.data);
        };
        socket.onclose = event => {
            var _a;
            if (this.socket !== socket)
                return;
            this.detach(socket);
            this.socket = null;
            this.handlers = null;
            (_a = this.link) === null || _a === void 0 ? void 0 : _a.clear();
            handlers.onClose({ code: event.code, reason: event.reason, wasClean: event.wasClean });
        };
        socket.onerror = cause => {
            if (this.socket === socket)
                handlers.onError(cause);
        };
    }
    send(payload) {
        const socket = this.socket;
        const handlers = this.handlers;
        // The pending close event owns the reason; a late flush must not replace it.
        if (socket && (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED))
            return;
        if (!socket || socket.readyState !== WebSocket.OPEN)
            throw new Error('The WebSocket transport is not open.');
        const deliver = (message) => {
            if (this.socket !== socket)
                return;
            try {
                if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED)
                    return;
                if (socket.readyState !== WebSocket.OPEN)
                    throw new Error('The WebSocket transport is not open.');
                socket.send(message);
            }
            catch (cause) {
                handlers === null || handlers === void 0 ? void 0 : handlers.onError(cause);
            }
        };
        if (this.link)
            this.link.sendClientToServer(payload, deliver);
        else
            deliver(payload);
    }
    close(reason) {
        var _a;
        const socket = this.socket;
        this.socket = null;
        this.handlers = null;
        (_a = this.link) === null || _a === void 0 ? void 0 : _a.clear();
        if (!socket)
            return;
        this.detach(socket);
        // Browsers cannot force termination. Logical teardown is already done;
        // detach before a best-effort close, including during CONNECTING.
        try {
            socket.close(1000, reason);
        }
        catch (_b) {
            socket.close();
        }
    }
    detach(socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
    }
}
exports.WebSocketClientAdapter = WebSocketClientAdapter;
class SimulatedWebSocketClientAdapter extends WebSocketClientAdapter {
    constructor(config) {
        super(config);
        if (!(config === null || config === void 0 ? void 0 : config.conditions))
            throw new Error('SimulatedWebSocketClientAdapter requires config.conditions.');
        this.conditions = new nengi_1.NetworkConditionLink(config.conditions, { timers: liveTimers });
        this.link = this.conditions;
    }
    configureNetworkConditions(conditions) {
        this.conditions.configure(conditions);
    }
    getNetworkConditionStatus() {
        return this.conditions.status();
    }
}
exports.SimulatedWebSocketClientAdapter = SimulatedWebSocketClientAdapter;
