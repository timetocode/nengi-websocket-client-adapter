import { NetworkConditionLink } from 'nengi';
import type { BinaryAdapter, BinaryPayload, ClientNetwork, IClientNetworkAdapter, NetworkConditions, NetworkConditionStatus } from 'nengi';
export type WebSocketClientAdapterConfig = {
    binary?: BinaryAdapter<BinaryPayload, ArrayBuffer>;
};
export type SimulatedWebSocketClientAdapterConfig = WebSocketClientAdapterConfig & {
    conditions: NetworkConditions;
};
declare class WebSocketClientAdapter implements IClientNetworkAdapter<BinaryPayload, ArrayBuffer, string> {
    socket: WebSocket | null;
    network: ClientNetwork;
    binary: BinaryAdapter<BinaryPayload, ArrayBuffer>;
    connected: boolean;
    constructor(network: ClientNetwork, config?: WebSocketClientAdapterConfig);
    flush(): void;
    flushPongs(): void;
    disconnect(reason?: any): void;
    private setupWebsocket;
    connect(wsUrl: string, handshake?: any): Promise<unknown>;
}
declare class SimulatedWebSocketClientAdapter implements IClientNetworkAdapter<BinaryPayload, ArrayBuffer, string> {
    socket: WebSocket | null;
    network: ClientNetwork;
    binary: BinaryAdapter<BinaryPayload, ArrayBuffer>;
    connected: boolean;
    readonly conditions: NetworkConditionLink;
    constructor(network: ClientNetwork, config: SimulatedWebSocketClientAdapterConfig);
    flush(): void;
    flushPongs(): void;
    disconnect(reason?: any): void;
    configureNetworkConditions(conditions: NetworkConditions): void;
    getNetworkConditionStatus(): NetworkConditionStatus;
    connect(wsUrl: string, handshake?: any): Promise<unknown>;
    private send;
}
export { WebSocketClientAdapter, SimulatedWebSocketClientAdapter };
