---
title: Self-host a server
sidebar_position: 2
---

# Self-host a server

There is no public Companions Online server right now — if you want
a persistent world you can come back to, or somewhere to run your
own AI player against, you spin one up locally. It takes about a
minute and costs nothing.

## Requirements

- **Node.js 18 or newer**.
- Linux, macOS, or Windows with WSL.
- Roughly 200 MB free for `node_modules` plus whatever your saves
  grow to.

## Install and run

```bash
git clone https://github.com/companions-online/companions-online.git
cd companions-online
npm install
npm run dev:server
```

The server prints something like:

```
[server] generating new world (seed=42)...
[server] world created: 412 entities
[server] world id: w-2026-05-05-abc123
[server] listening on http://localhost:3001
```

That URL is what your client connects to:

- **WebGL client** in the browser — open the URL directly, or run
  the dev client with `npm run dev:client-gl` (defaults point at
  `localhost:3001`).
- **MCP client** (an LLM player) — point it at
  `http://localhost:3001/mcp`. See
  [MCP server](./ai-companions/mcp-server) for client setup.

To stop the server, press **q** in the terminal (or hit Ctrl-C).
The world saves on the way out.

:::tip Want to play with friends?

Tunnel the port out with [ngrok](https://ngrok.com/) and share the
public URL directly:

```bash
ngrok http 3001
```

ngrok prints a `https://<random>.ngrok.app` URL. That's both your
WebGL client URL and the base for `<url>/mcp` for AI companions.
Your friends paste it in their browser and they're in the same
world as you, no port forwarding required.

:::

## Configuration

Configuration is environment variables and one CLI flag:

| Variable / flag | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP / WebSocket / MCP port. |
| `SEED` | `42` | World-generation seed for new worlds. |
| `--world <id>` | _(none)_ | Resume a saved world by id. |

Examples:

```bash
PORT=4000 SEED=1234 npm run dev:server
npm run dev:server -- --world w-2026-05-05-abc123
```

Saved worlds live under `./data/worlds/<id>/`. The id is printed
on first boot. Pass it to `--world` to come back to the same map.

## Server console

The terminal running the server is a live dashboard — per-phase
tick CPU, network bytes, connection counts, and the in-world
clock. While it's running, four single-key shortcuts work (TTY
only):

| Key | What it does |
| --- | --- |
| **s** | Save the world right now. |
| **p** | Pause / unpause the tick loop. |
| **d** | Dump a forensic snapshot of the world to disk. |
| **q** | Save and quit. |

The world also auto-saves every five minutes, and on a clean exit
(Ctrl-C, SIGTERM, or `q`).
