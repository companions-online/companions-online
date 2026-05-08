---
title: MCP server
sidebar_position: 2
---

# MCP server

The Companions Online server exposes an MCP endpoint at `/mcp` on
the same port that serves WebSocket players (default `3001`). Any
MCP client that speaks the Streamable HTTP transport can connect.

## Endpoint

```
POST/GET/DELETE  http://<host>:<port>/mcp
```

- `POST /mcp` — JSON-RPC tool calls.
- `GET /mcp` — the server-sent-events stream the session reads
  from.
- `DELETE /mcp` — explicit session teardown.

There is no authentication on the endpoint today. Anyone who can
reach the host can connect. Run it on `localhost` or behind a
firewall.

## The identify contract

Every new MCP session starts entity-less. The first tool the
client must call is `identify(name)`:

```json
{ "name": "Elsy" }
```

This spawns the player's entity and registers the display name.
Any other tool call before `identify` returns:

```
[error] not identified — call identify(name) first
```

with `isError: true`. After `identify`, every subsequent tool call
operates on that entity.

Names are 1–16 characters, letters / digits / underscore / hyphen.

## Keepalive

The server sends an MCP `ping` to every connected session every
15 seconds. This keeps the SSE stream alive through proxies and
load balancers that would otherwise time it out. Node's per-request
HTTP timeouts are explicitly disabled on the server side for the
same reason.

If the client disconnects (TCP close, transport error, explicit
`DELETE /mcp`), the server resolves any pending action and removes
the player entity.

## Connecting from common clients

### Claude Desktop

Add the server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "companions-online": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Restart Claude Desktop. The tool list appears under the server
name in the tool picker. Tell Claude to play, and it will call
`identify` on its own.

### Cursor / other editors

Most editors support the same JSON shape under whatever their MCP
config key is. Point them at `http://localhost:3001/mcp`.

### Custom SDK code

Any client built on top of `@modelcontextprotocol/sdk` works:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3001/mcp'),
);
const client = new Client({ name: 'my-bot', version: '0.1.0' });
await client.connect(transport);

await client.callTool({ name: 'identify', arguments: { name: 'Bot' } });
const surroundings = await client.callTool({
  name: 'get_surroundings',
  arguments: {},
});
```

The harness does effectively this, with prompt-driven tool
selection on top — see [The harness](./harness).

### curl (smoke test)

```bash
curl -N -X POST http://localhost:3001/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

The session is short-lived and won't hold an entity, but it
confirms the endpoint is up.

## Sessions and connection count

Each connected client is a session with its own entity. The
server's terminal dashboard shows a live MCP session count
alongside the WebSocket count. Multiple LLMs can connect to the
same world at once (see [Populating the world](./populating-world)).
