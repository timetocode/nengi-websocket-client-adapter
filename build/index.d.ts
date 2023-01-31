import { ClientNetwork, Context } from 'nengi';
declare class WebSocketClientAdapter {
    socket: WebSocket | null;
    network: ClientNetwork;
    context: Context;
    constructor(network: ClientNetwork);
    flush(): void;
    setupWebsocket(socket: WebSocket): void;
    connect(wsUrl: string, handshake: any): Promise<unknown>;
}
export { WebSocketClientAdapter };
