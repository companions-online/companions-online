---
title: Local setup
sidebar_position: 1
---

# Local setup

If you want to change anything — fix a bug, tweak a recipe, build
a new building — the first step is getting the project running on
your machine.

## Prerequisites

- **Node.js 18 or newer.**
- **Git.**
- A few hundred megabytes of free disk for `node_modules`.

That's it. There's no Docker, no database, no external services
required to run the game itself.

## Clone and install

```bash
git clone https://github.com/companions-online/companions-online.git
cd companions-online
npm install
```

`npm install` pulls dependencies for the server, the WebGL client,
the harness, the user guide, and the shared package. It's a single
workspace.

## Run the server

```bash
npm run dev:server
```

The server prints a URL (default `http://localhost:3001`) and a
live dashboard. See [Self-host a server](../self-host) for the
configuration knobs.

## Build and run the WebGL client

The client is built once with esbuild and served as a static
bundle. For development, the dev script watches and rebuilds on
change:

```bash
npm run dev:client-gl
```

Open the URL it prints. The client connects to the dev server you
started above.

For one-off production builds:

```bash
npm run build:client-gl
```

## Run the user guide locally

```bash
npm run dev:guide
```

This installs the user guide's own deps and starts Docusaurus on
its own port. The site picks up changes to docs and components
live; the embedded game requires `npm run build:client-gl` first
(the prebuild script copies the bundle into `static/game/`).

## Tests and typecheck

```bash
npm run typecheck      # whole repo
npm test               # vitest run
npm run test:harness   # harness tests only
```

Tests are quick — the server stands up in under two seconds, and
most behavioral tests use `GameWorld.runTicks()` directly without
network plumbing.

## Useful scripts

| Script | What it does |
| --- | --- |
| `npm run cli:map` | Render the current world map to terminal. |
| `npm run cli:stats` | Worldgen statistics for a seed. |
| `npm run cli:mcp` | Interactive MCP smoke client. |
| `npm run cli:play` | Terminal-based CLI client. |
| `npm run render:gl` | Render a frame from the WebGL renderer. |

## Layout in three lines

- **`shared/`** — types, constants, blueprints, recipes, terrain,
  pathfinding. No I/O.
- **`server/`** — game world, ECS, MCP layer, WebSocket server,
  persistence.
- **`client-webgl/`**, **`cli/`**, **`harness/`**, **`user-guide/`**
  — the four front ends.
