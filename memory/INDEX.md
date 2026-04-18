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

### User — who I work with
- [Collaboration](user/collaboration.md) — steered build, plan→approve→implement, code prefs, corrections

### Feedback — lessons from past sessions
- [No Inline Imports](feedback/no-inline-imports.md) — never `import(...)` in type positions
- [Dev Cycle Speed](feedback/dev-cycle-speed.md) — server stands up in <2s; no sleep padding
- [Testing Philosophy](feedback/testing-philosophy.md) — load-bearing tests only, not trivial property-setting
- [Event Emission](feedback/event-emission.md) — emit at authoritative source, not delta reconstruction
- [LLM Teleportation](feedback/llm-teleportation.md) — LLM players see snapshots; only emit events not inferrable from them
- [Use Existing Systems](feedback/use-existing-systems.md) — client-webgl: use sprite registry/manifest, not parallel loaders

### Project — current initiatives
- [State](project/state.md) — no active initiatives tracked yet

### Subsystems — deep orientation
- [client-webgl/](client-webgl/overview.md) — WebGL client; also see architecture, file-map, gotchas, testing
