# Memory

All project knowledge Claude needs to work here. Structured and incrementally updated in-tree.

## Write rules
- **New memory → write here, never to `~/.claude/projects/.../memory/`.** That directory is deprecated for this project.
- Place under `./memory/<type>/<name>.md`. Types in use:
  - `reference/` — long-form orientation docs (architecture, file-map, etc.)
  - `user/` — who the user is + how they work
  - `feedback/` — short typed lessons from past sessions
  - `project/` — current initiatives, deadlines, ephemeral state
  - Subsystem dirs (e.g. `client-webgl/`) — deep orientation for a specific part of the codebase
- Short entries (`feedback/`, `user/`, `project/`) start with frontmatter: `name`, `description`, `type`. Long-form `reference/` and subsystem docs can skip frontmatter — the index entry + file heading carry that metadata.
- After writing, **add one line to the index below**: `- [Title](path.md) — one-line hook`.
- Before writing a new file, check if an existing entry covers it — updating beats duplicating.
- Max one subdirectory level under `./memory/`.

## Extending
- New subsystem → new top-level dir matching the source dir name (e.g. `memory/server/`, `memory/mcp/`) with orientation docs inside.
- New memory type → new top-level dir (e.g. `memory/decisions/` for ADRs).
- Scoped feedback → file in `feedback/` with scope named in description (e.g. "client-webgl: …").

## Index

### Reference — architectural orientation
- [Architecture](reference/architecture.md) — GameWorld + PlayerConnection + tick loop + MCP layer
- [Current State](reference/current-state.md) — what's done, queued, known issues
- [Design Decisions](reference/design-decisions.md) — why the code is shaped the way it is
- [File Map](reference/file-map.md) — where every module lives
- [Docs Status](reference/docs-status.md) — where `docs/` has drifted from code
- [Server Commands + Entity Meta](reference/server-commands.md) — `/nick` dispatcher, `MetaKey` sync channel, nameplates
- [Occupancy + Logger](reference/occupancy-and-logger.md) — occupancy = single-blocker invariant; per-world WorldLogger (file/memory) + assertions
- [Debug Tools](reference/debug-tools.md) — `d`-key world dumps + `scripts/world-dump-view.ts` forensic CLI (stuck-state scan, near/entity/find queries) + server.log grep

### User — who I work with
- [Collaboration](user/collaboration.md) — steered build, plan→approve→implement, code prefs, corrections

### Feedback — lessons from past sessions
- [No Inline Imports](feedback/no-inline-imports.md) — never `import(...)` in type positions
- [Dev Cycle Speed](feedback/dev-cycle-speed.md) — server stands up in <2s; no sleep padding
- [Testing Philosophy](feedback/testing-philosophy.md) — load-bearing tests only, not trivial property-setting
- [Event Emission](feedback/event-emission.md) — emit at authoritative source, not delta reconstruction
- [LLM Teleportation](feedback/llm-teleportation.md) — LLM players see snapshots; only emit events not inferrable from them
- [Use Existing Systems](feedback/use-existing-systems.md) — client-webgl: use sprite registry/manifest, not parallel loaders
- [Prefer Generic Layers](feedback/prefer-generic-layers.md) — new per-entity strings → MetaKey; new `/commands` → registry; skip bespoke plumbing
- [Err-side-effects](feedback/err-side-effects.md) — state-changing helpers must be no-op on Err; enables callers to use them as predicates with free rollback
- [Test Helper Bypass](feedback/test-helper-bypass.md) — direct-mutate setup helpers hide bugs in the production flow they skip; ensure ≥1 test covers the real path

### Project — current initiatives
- [State](project/state.md) — no active initiatives tracked yet

### Subsystems — deep orientation
- [client-webgl/](client-webgl/overview.md) — WebGL client; also see architecture, file-map, gotchas, testing
- [client-webgl/lighting](client-webgl/lighting.md) — day/night cycle + tinted point lights + wall-aware shadowcast
- [client-webgl/inventory-panel](client-webgl/inventory-panel.md) — drag-and-drop inventory UI + placement mode + optimistic-decrement flicker fix
- [client-webgl/standalone-observer](client-webgl/standalone-observer.md) — boot mode toggle (WS vs in-tab), observer-mode wiring, autopilot camera
- [harness/overview](harness/overview.md) — what the harness is, the three CLI surfaces, the variants/helpers/cli/eval split
- [harness/architecture](harness/architecture.md) — runner + VariantStrategy contract, two-tool-source dispatch, decider seam, scratchpad↔memory naming, single-sessionId convention, cost+rate tracking, inline-config + quiet logger
- [harness/variants](harness/variants.md) — compact/baseline/shortened: state shapes, prompt-build differences, when to use each, why no `continue` after tool results
- [harness/eval](harness/eval.md) — eval-runner, AI-eid snapshot-diff, stop-reason taxonomy, test injection seams
- [harness/characters](harness/characters.md) — multi-character CLI (`npx characters`), roster format, orchestrator/dashboard split, concurrency model
