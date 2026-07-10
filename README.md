# nengi-websocket-client-adapter

Browser WebSocket client adapter for nengi using the `nengi-dataviews` binary
backend.

Keep the complete Nengi package family on one exact version:

```sh
npm install nengi@2.0.0-rc.125 \
    nengi-websocket-client-adapter@2.0.0-rc.125 \
    nengi-dataviews@2.0.0-rc.125
```

```ts
import { Client } from 'nengi'
import { WebSocketClientAdapter } from 'nengi-websocket-client-adapter'

const client = new Client(context, WebSocketClientAdapter, 20)
await client.connect('ws://localhost:8079')
```

Drain frames in the application update loop and call `client.flush()` at the
intended client cadence. Ping/Pong responses are engine traffic and are emitted
during that flush boundary.

Import only from package roots. See the
[nengi manual](https://github.com/timetocode/nengi/tree/rc/2.0.0/docs/ai) for
client state, timing, and adapter guidance.
