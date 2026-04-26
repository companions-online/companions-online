# Harness — eval

Eval = score a variant against a behavioral checkpoint set on a deterministic world.

## The pieces

- `eval-runner.ts` — `runEval(opts)`. Boots a fresh `GameWorld` (seeded), wraps it in a Hono app, listens on an ephemeral port, points `MCP_URL` at it, runs a `GameLoop` at `TICK_RATE`, drives the chosen variant, writes `<id>-run.json` to `harness/logs/`.
- `scoreboard.ts` — `Scoreboard` attaches as the world's event observer. Tracks which checkpoints have fired for the AI player.
- `match.ts` — `matches(checkpoint, ev)`: shallow equality on `event.type` and each key in `cp.match` against `ev.details`.

## AI eid resolution

Eval doesn't know in advance which entity the LLM will become — `identify` is a tool the model has to call. So the scoreboard does a snapshot-diff:

1. **Before** the harness connects, snapshot `world.players.keys()` into `playersBefore`.
2. On the first event whose `eid` is *not* in `playersBefore`, that's the AI. Lock it in.
3. Only count `'emit'`-channel events (point-to-point, addressed to the AI). Ignore `'broadcast'` events (spectator-range chatter from other players' actions).

This is why `addTestPlayer` calls in tests deliberately add a noise player before snapshotting — to verify the diff actually works.

## Stop reasons

The eval CLI exits 0 on a perfect score, 1 otherwise. The variant loop reports `stopReason ∈ {aborted, max_steps, host_stop, completed}`; eval-runner re-labels these into the eval-level vocabulary:

| Eval stop reason  | Triggered by |
|-------------------|---|
| `all_checkpoints` | `scoreboard.isComplete()` → `onTurnComplete` returns `'stop'` |
| `max_tokens`      | running `totalTokens` ≥ `evalConfig.maxTokens` → `'stop'` |
| `max_turns`       | variant hit `maxSteps` (= `evalConfig.maxTurns`) |
| `aborted`         | `SIGINT` propagated through `AbortSignal` |
| `error`           | exception thrown in the variant or boot path |

## Eval config shape

`harness/config/<name>.json` with `type:"eval"`. Fields: `name`, `harness` (variant), `worldSeed`, `maxTurns`, `maxTokens`, optional `port` (defaults to 0 → ephemeral), `checkpoints[]`. Each checkpoint: `{ id, event, match? }` where `event` is a `GameEvent['type']` and `match` is a partial `details` object.

Two configs ship today: `survival-basics-baseline.json` and `survival-basics-compact.json`. They differ only in the `harness` field — the same scenario with two history strategies. The CLI takes the eval config name and the model config name as separate args, so the `harness` field-in-config is the only knob distinguishing variants for an otherwise-shared scenario.

## Test injection

`runEval` accepts override hooks: `worldFactory`, `decider`, `logger`, `memory`, `resultsDir`. Tests use these to:
- swap `createDefaultWorld` for `createTestWorld` (faster, smaller, deterministic),
- inject a `ScriptedDecider` that emits hand-crafted assistant messages turn by turn (no OpenRouter, no API key),
- silence the logger,
- write run JSON to a tmp dir.

The test in `harness/test/eval/eval-runner.test.ts` exercises the full pipeline: identify → equip-axe-harvest hack → checkpoint fires → `all_checkpoints` stop → file written. It runs in ~2s.

## Server lifecycle gotcha

The eval boots its own server with a fresh `Telemetry` and `createApp(world, telemetry)` — note that `GameWorld` constructs its own internal `Telemetry`, but `createApp` requires one passed in. They are not the same instance. This is a known wart; don't try to "fix" it by re-using `world.telemetry` without checking what `createApp` does with the param.

`MCP_URL` is set process-wide on entry and restored (or deleted) in `finally`. If you spawn multiple evals from the same process, they cannot run concurrently — they'll race on the env var.
