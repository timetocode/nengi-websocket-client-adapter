import type { BinaryAdapter, BinaryPayload, ClientNetwork, IClientNetworkAdapter } from 'nengi';
type WebSocketClientAdapterConfig = {
    binary?: BinaryAdapter<BinaryPayload, ArrayBuffer>;
};
declare class WebSocketClientAdapter implements IClientNetworkAdapter<BinaryPayload, ArrayBuffer, string> {
    socket: WebSocket | null;
    network: ClientNetwork;
    binary: BinaryAdapter<BinaryPayload, ArrayBuffer>;
    connected: boolean;
    constructor(network: ClientNetwork, config?: WebSocketClientAdapterConfig);
    flush(): void;
    disconnect(reason?: any): void;
    private setupWebsocket;
    connect(wsUrl: string, handshake: any): Promise<unknown>;
}
export { WebSocketClientAdapter };
