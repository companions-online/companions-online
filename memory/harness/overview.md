# Harness — overview

The harness drives an LLM through the game as a player, via the same MCP surface a real game client uses. Three roles:

1. **Free-running play** — point a model at a running server and watch it act. CLI: `npx harness <variant> <model>`.
2. **Scored evals** — boot a private server, drive a variant against a checkpoint set, write a result JSON. CLI: `npx eval <eval-config> <model>`.
3. **Multi-character play** — drive N LLM-backed characters concurrently against the same server, with a live TUI dashboard (per-character step / tokens-per-second / cost). CLI: `npx characters`. Roster lives in `harness/characters/config.json`. See `characters.md`.

A fourth entry, `npx harness human <model>`, swaps the LLM decider for a TTY menu — useful for debugging the prompt and tool surface without spending model tokens.

## Key separations

- **OpenRouter** handles LLM calls (`helpers/openrouter.ts`, `helpers/decider.ts`). The harness never speaks to a model directly.
- **MCP** handles all game state and actions (`helpers/mcp-client.ts`). The harness never imports `server/` types into the variant loop.
- The variant strategy is purely about **history shape** — what messages to send each turn and how to update local state after a response. It owns no IO.

## Why three variants exist

The whole point is to compare how history-management strategies affect a small/cheap model's play quality. `compact` (rolling 3-msg window), `baseline` (full history), and `shortened` (full history with old turns rolled up into single assistant messages) are the same loop with three different state shapes. Eval scoring lets you measure the difference quantitatively.

## What lives where (one-liners — see `architecture.md` for relationships)

- `cli/` — the three `bin` entries (`harness`, `eval`, `characters`) + a shared SIGINT/abort helper.
- `variants/` — one `VariantStrategy<S>` per history-management style. No CLI, no IO.
- `helpers/` — `runner.ts` (the loop), `bootstrap.ts` (wiring), and the IO + integration modules (mcp, openrouter, scratchpad, dispatcher, logger, env, paths, config). Multi-character feature lives here too: `rate-tracker.ts`, `characters-config.ts`, `run-characters.ts`, `characters-dashboard.ts`.
- `eval/` — `eval-runner.ts` brings up an ephemeral game server; `scoreboard.ts` + `match.ts` score against checkpoints.
- `config/` — model configs (`type:"model"`) and eval configs (`type:"eval"`) co-located, plus `prompt.md` (the skill prompt).
- `characters/` — per-character prompt files (`princess.md`, `hunter.md`, `peon.md`, …) plus `config.json` — the roster the multi-character CLI consumes.
- `logs/` — runtime artifacts. Every run produces `<id>-log.jsonl` + `<id>-memory.md`; eval runs add `<id>-run.json`. Gitignored.
- `test/` — mirrors source layout (`variants/`, `helpers/`, `eval/`).

## Hard rule

Keep variants pure: a strategy is `initialize` + `buildMessages` + `onToolResult` + `onNoToolCall`. If you find yourself reaching for `mcp`, `decider`, or `log` from inside a variant, that work belongs in the runner.
