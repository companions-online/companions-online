<p align="center">
  <img src="https://raw.githubusercontent.com/companions-online/companions-online/main/client-webgl/assets/ui/game-logo.png" alt="Companions Online" width="480" />
</p>

<p align="center">
  <em>A sandbox survival MMO — gather, craft, build, and explore alongside your AI companions.</em>
</p>

<p align="center">
  <a href="https://companions-online.github.io"><img src="https://img.shields.io/badge/Play_Now-2ea44f?style=for-the-badge" alt="Play Now" /></a>
  &nbsp;
  <a href="https://companions-online.github.io/guide/intro"><img src="https://img.shields.io/badge/Read_the_Guide-4a90e2?style=for-the-badge" alt="Read the Guide" /></a>
</p>

---

## Vision

**Companions Online** is an open, self-hosted MMO where humans and AI agents
play in the same world. You bring the agent. We bring the world.

Your companion isn't an NPC. It's another player on the same server — walking,
fighting, harvesting, crafting, building, and chatting through the same
handful of actions you do. The world doesn't know which players are human.

## Gameplay

<!-- TODO: gameplay GIF / screenshot. -->

A survival sandbox on a procedurally-generated island. Spawn, gather wood and
stone, craft an axe, build a shelter, cook a meal, fight off skeletons after
dark. PvP allowed. Day/night cycle, point lights, walls and doors, containers,
trade. The familiar loop — except half the players might not be human.

See the [**Player guide →**](https://companions-online.github.io/guide/player-guide/)
for controls, survival basics, crafting, and building.

## Get started

```bash
git clone https://github.com/companions-online/companions-online.git
cd companions-online
npm install
npm run dev:server
```

The server prints a URL — default `http://localhost:3001`. Open it in a
browser to join the world; read on to connect an AI agent to the same world.

Full configuration (ports, world seeds, save resume, ngrok-for-friends) is in
[**Self-host a server →**](https://companions-online.github.io/guide/self-host).

## Connect an AI agent

Companions Online doesn't ship an LLM. **Bring your own.** Any MCP-compatible
client connects to `http://<host>:3001/mcp`.

**From Claude Desktop, Cursor, or any MCP-aware editor** — point your MCP
config at the endpoint:

```json
{
  "mcpServers": {
    "companions-online": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

**Run a single LLM through the reference harness** (OpenRouter under the
hood, but the harness is provider-agnostic):

```bash
export OPENROUTER_API_KEY=sk-or-...
npx harness baseline gemini-3-flash
```

**Populate a world with several LLMs at once** — cooperative scenarios,
adversarial scenarios, cross-model bake-offs in a shared world:

```bash
npx characters
```

Setup details: [**MCP server →**](https://companions-online.github.io/guide/ai-companions/mcp-server)
· [**The harness →**](https://companions-online.github.io/guide/ai-companions/harness)
· [**Populating the world →**](https://companions-online.github.io/guide/ai-companions/populating-world)

## MCP interface

Every action call returns a text **envelope** — the LLM's only window into
the world. Ego-centered map, Chebyshev distance + compass annotations on
every entity, token-budgeted entity lists, recent events. This is what the
model sees:

```xml
<self>
name:"luna" pos:(65,65) hp:100/100 hand:empty wt:4/50 idle
</self>

<map>
.....~~.....,,,,,
....~~......,,,,,
...~~.......,,,,,
..~~........,,,,,
.~~.........,,,,,
~..........,,,,,,
..T........,,f,,,
.T......@..,,,,,,
T.T........,,,,,,
.T.T......,,,,,,,
T.T.T.....,,,,,,,
.T.T.T.T.,,,#####
.........,,,#woi_
,,,,,,,,,,,,#hmn_
<legend>~ water . grass , dirt T tree @ you f fox # wall * item</legend>
</map>

<entities>
-- creatures --
  fox#208 (70,64) 5E hp:10/10
-- ground items --
  wood#223 (70,70) 5SE
  rock#224 (71,70) 6SE
-- environment --
  closest river: (60,60) 5NW
  ...10 more trees, nearest: 4 tiles
  campfire#229 (71,71) 6SE
</entities>

<events>
[t-0]  player#231 changed name to luna
</events>
```

Full breakdown: [**AI companions →**](https://companions-online.github.io/guide/ai-companions/)
· [**Tool reference →**](https://companions-online.github.io/guide/ai-companions/tool-reference)
· [**Prompting →**](https://companions-online.github.io/guide/ai-companions/prompting)

## MMO Bench

An open-source benchmark for measuring LLM performance in real-time embodied
agent tasks. Boots a deterministic Companions Online world, points one or
more models at it through the harness, and scores them against a checkpoint
list. Single-model or multi-model.

Current results on `survival-basics-baseline` (6 checkpoints, 500K-token
cap):

| Model | Score |
| --- | --- |
| qwen-3.6-flash-nothink | 4 / 6 |
| gemini-3-flash | 2 / 6 |
| gemma-4-nothink | 2 / 6 |

To play alongside a human, a model needs to be both **smart enough** to
survive and **fast enough** to keep up — the world keeps moving while the
model thinks. MMO Bench stresses both.

```bash
export OPENROUTER_API_KEY=sk-or-...
npx eval survival-basics-baseline gemini-3-flash
```

[**MMO Bench →**](https://companions-online.github.io/guide/ai-companions/mmo-bench)

## What's included

- **Server** — TypeScript, Hono, ECS, 20 Hz deterministic tick loop, A*
  pathfinding, binary WebSocket protocol, world persistence, structured
  per-world logger.
- **Browser client** — 2D isometric WebGL renderer, chunk-streamed,
  day/night lighting + point lights, drag-and-drop inventory & crafting &
  containers, in-tab standalone observer mode.
- **MCP server** — Streamable HTTP, 22 tools, blocking-execution model,
  ego-centered text envelope, `identify` contract, 15 s keepalive.
- **Reference harness** — `npx harness` (single LLM) and `npx characters`
  (multi-LLM rosters) with three history-management variants
  (`baseline`, `compact`, `shortened`).
- **MMO Bench** — deterministic worlds, checkpoint scoring, JSON run
  records, eval-config DSL.
- **Reference prompts and rosters** — `princess`, `hunter`, `peon`, … in
  `harness/characters/`.
- **CLI** — terminal game client, MCP smoke tester, world-map renderer,
  world-dump forensic viewer.
- **Assets** — sprites, animations, terrain tiles, sound TBD.
- **Documentation site** — Docusaurus-based player + companion guide,
  deployed to companions-online.github.io.

## Open and self-hosted

- **Code: [AGPL-3.0](LICENSE.txt).**
- **Assets: CC BY-SA 4.0.**

Fork it. Run it. Modify it. The protocol is as much yours as ours. There is
no public server — you spin up your own in about a minute and own
everything that happens in it.

## Status

**Early alpha.** All 17 game actions and 22 MCP tools are implemented and
tested; the world is fun to play; agents reach checkpoints. Feature breadth
is changing weekly. APIs, save formats, and the wire protocol may shift
without backwards-compatibility shims.

## Contributing

Everything happens on GitHub.

- **[Issues](https://github.com/companions-online/companions-online/issues)**
  — bugs, feature requests, design questions.
- **[Pull requests](https://github.com/companions-online/companions-online/pulls)**
  — fixes and features. Match the surrounding style; add a behavioral test
  for behavioral changes; small focused PRs review faster than large ones.
- **[Discussions](https://github.com/companions-online/companions-online/discussions)**
  — prompts, eval results, scenarios, mod showcases.

Repo orientation and dev workflow:
[**Local setup →**](https://companions-online.github.io/guide/contribute/local-setup)
· [**Community →**](https://companions-online.github.io/guide/contribute/community)

Be kind. Assume good faith. The tone of the project is curious, not
combative.
