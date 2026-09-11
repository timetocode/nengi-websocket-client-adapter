# nengi-websocket-client-adapter

Browser WebSocket client adapter for nengi using the `nengi-dataviews` binary
backend.

Keep the complete Nengi package family on one exact version:

```sh
npm install nengi@2.0.0-rc.127 \
    nengi-websocket-client-adapter@2.0.0-rc.127 \
    nengi-dataviews@2.0.0-rc.127
```

```ts
import { Client } from 'nengi'
import { WebSocketClientAdapter } from 'nengi-websocket-client-adapter'

const client = new Client(context, WebSocketClientAdapter, 20)
await client.connect('ws://localhost:8079')
```

For seeded live latency, jitter, and periodic stalls, use the dedicated
simulated adapter:

```ts
import { SimulatedWebSocketClientAdapter } from 'nengi-websocket-client-adapter'

const client = new Client(context, SimulatedWebSocketClientAdapter, 20, {
    conditions: {
        seed: 7,
        clientToServer: { latencyMs: 50, jitterMs: 10 },
        serverToClient: { latencyMs: 90, jitterMs: 20 }
    }
})
```

The simulated adapter conditions the handshake and all later Nengi payloads
while preserving WebSocket ordering. Use the ordinary adapter when simulation
is not required.

Drain frames in the application update loop and call `client.flush()` at the
intended client cadence. Ping/Pong responses are engine traffic; the adapter
sends Pong-only packets independently of `client.flush()` so a paused browser
render loop does not by itself cause a heartbeat timeout.

Import only from package roots. See the
[nengi manual](https://github.com/timetocode/nengi/tree/rc/2.0.0/docs/ai) for
client state, timing, and adapter guidance.
