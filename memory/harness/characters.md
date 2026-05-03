# Harness — multi-character

Drives N LLM-backed characters concurrently against the same running game server, with a live TUI dashboard. Entry: `npx characters`.

## Roster file

`harness/characters/config.json` — JSON array. Each entry:

```json
{
  "prompt": "princess",
  "harness": "baseline",
  "model": { "type": "model", "model": "google/gemma-4-31b-it",
             "temperature": 1, "reasoning": { "effort": "none" } }
}
```

- `prompt` — resolves to `harness/characters/<prompt>.md` (preferred) or `harness/config/<prompt>.md` via the existing `resolvePromptPath`.
- `harness` — variant strategy name (`baseline` | `compact` | `shortened`).
- `model` — **inlined** ModelConfig, same shape as `harness/config/<name>.json`. The whole config is embedded in the roster — no file lookup. This is what `BootstrapOpts.config?: ModelConfig` was added for.

Loader: `helpers/characters-config.ts::loadCharactersConfig(path?)`. Validates the array shape and each entry's `prompt` / `harness` / `model.{type,model}` fields, throws on the first failure.

## Orchestrator

`helpers/run-characters.ts` exposes two functions:

- `createCharacterRows(characters): CharacterRow[]` — synchronous. Builds the per-character `{ name, modelLabel, usage, rate, status, done }` objects up front so a caller (the CLI) can mount a dashboard against the same row references *before* the runners start mutating them.
- `runCharacters(characters, rows, opts?): Promise<{ failures }>` — `Promise.allSettled` over the characters. Each character runs through `runHarness(strategy, opts)` with its inline `config`, `quiet: true`, shared `abortSignal`, its own `usage` + `rate`, and an `onTurnComplete` that copies `{ step, lastToolName, lastInlineText }` into `row.status`.

`opts.deciders[]` is the test-injection seam: tests pass one `ScriptedDecider` per character to bypass OpenRouter entirely.

## CLI

`cli/characters.ts` is a thin wrapper:
1. `loadCharactersConfig()`
2. `createCharacterRows(characters)`
3. `startDashboard(rows)` — ANSI render loop on a `setInterval` ~250ms.
4. `runCharacters(characters, rows, { abortSignal })`
5. `dashboard.stop()` + `printFinalSummary(rows)`.

A single `SIGINT` handler at the top calls `ac.abort()`; the signal cascades to all characters via the shared `AbortSignal`. Failures are stashed and printed to stderr after dashboard tear-down so the TUI stays clean during the run.

Bin entry: `package.json`'s `bin.characters → ./harness/cli/characters.ts`. Also wired as `npm run characters`.

## Dashboard

`helpers/characters-dashboard.ts`. Modeled on `server/src/dashboard.ts` — raw ANSI, `\x1b[H` cursor-home, padded lines so trailing characters from previous frames are blanked. One row per character: `NAME | MODEL | STEP | TPS(10s) | TOK | COST`. Reads from the row objects directly — no event subscription, no diffing — so any mutation by the runner is visible on the next tick.

Assumes the runner's logger was created with `quiet: true`. If a per-character logger writes to stdout the dashboard tears.

## Concurrency model

Each character gets its own `bootstrapHarness` call → its own MCP client (all pointing at `MCP_URL`), sessionId, scratchpad, and logger. The server handles N concurrent MCP clients fine. No worker threads — Node's event loop handles HTTP-bound concurrency.

`runCli` from `cli/run-cli.ts` is **not** reused per character — that would stack one SIGINT handler per character. The multi-character CLI registers SIGINT exactly once.

## Where to extend

- New per-character override (e.g. log-filename prefix, stable scratchpad path): add to `RunCharactersOpts` and thread through `runOne`. Don't bolt onto `BootstrapOpts` unless single-character runs need it too.
- New dashboard column: extend `CharacterRow` if it's per-character state, or read directly from `row.usage` / `row.rate` / `row.status` if it's already there. Keep `CharacterRow` plain data — no methods.
- New multi-character variant behavior (e.g. shared memory between characters): does **not** belong in a `VariantStrategy`. It belongs in a new orchestrator-level concern in `run-characters.ts` or a sibling file. Variants stay pure.

## Tests

- `test/helpers/rate-tracker.test.ts` — windowed rate calc + edge cases.
- `test/helpers/characters-config.test.ts` — happy path + each validation failure.
- `test/helpers/run-characters.test.ts` — orchestrator integration with `ScriptedDecider` per character against the in-process `startTestMcpServer`. Asserts per-character usage / costUsd / rate / status accumulate correctly, and abort cascades to all characters.
