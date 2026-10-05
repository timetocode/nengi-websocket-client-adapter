import { NetworkConditionLink } from 'nengi';
import type { BinaryAdapter, BinaryPayload, ClientTransportHandlers, IClientNetworkAdapter, NetworkConditions, NetworkConditionStatus } from 'nengi';
export type WebSocketClientAdapterConfig = {
    binary?: BinaryAdapter<BinaryPayload, ArrayBuffer>;
};
export type SimulatedWebSocketClientAdapterConfig = WebSocketClientAdapterConfig & {
    conditions: NetworkConditions;
};
declare class WebSocketClientAdapter implements IClientNetworkAdapter<BinaryPayload, ArrayBuffer, string> {
    readonly clientAdapterVersion: 2;
    socket: WebSocket | null;
    binary: BinaryAdapter<BinaryPayload, ArrayBuffer>;
    protected link?: NetworkConditionLink;
    private handlers;
    constructor(config?: WebSocketClientAdapterConfig);
    open(url: string, handlers: ClientTransportHandlers<BinaryPayload>): void;
    send(payload: ArrayBuffer): void;
    close(reason: string): void;
    private detach;
}
declare class SimulatedWebSocketClientAdapter extends WebSocketClientAdapter {
    readonly conditions: NetworkConditionLink;
    constructor(config: SimulatedWebSocketClientAdapterConfig);
    configureNetworkConditions(conditions: NetworkConditions): void;
    getNetworkConditionStatus(): NetworkConditionStatus;
}
export { WebSocketClientAdapter, SimulatedWebSocketClientAdapter };
