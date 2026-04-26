# Harness — architecture

## Layers

```
cli/{harness,eval}.ts          argv → call the right run* function
   │
   ▼
helpers/runner.ts              the loop (one for all variants)
   │  uses
   ├── Bootstrap (wired by helpers/bootstrap.ts)
   │     ├── config (model JSON, type:"model")
   │     ├── system + first (split from prompt.md on \n---\n)
   │     ├── mcp           (ReconnectingMcpClient)
   │     ├── dispatcher    (MCP tools ∪ harness-local tools, OpenAI shape)
   │     ├── decider       (OpenRouterDecider | HumanDecider)
   │     ├── memory        (Scratchpad — disk-backed, LLM-facing as `memory_update`)
   │     └── log           (JSONL session log + stdout)
   │
   └── VariantStrategy<S>   (per-variant: state shape + 4 hooks)
```

## Strategy contract

```ts
interface VariantStrategy<S> {
  initialize(b: Bootstrap): S
  buildMessages(state: S, memory: string): ChatMessage[]
  onToolResult(state: S, ctx: { step, call, dispatched, inlineText, assistantMsg }): void
  onNoToolCall(state: S, ctx: { step, inlineText, assistantMsg }): void
}
```

The runner owns the loop, the abort/maxSteps gates, the decider call (with error logging), the dispatcher call, all `log.event` / `log.stdout` lines, the `onTurnComplete` verdict, and `mcp.close + log.close` on exit. A variant only describes:

1. What messages to send this turn (a transformation of state + current scratchpad text).
2. What to remember after the assistant responds (with or without a tool call).

Adding a new variant = a new file in `variants/` exporting the strategy and a `run<Name>(opts)` thin wrapper around `runHarness(strategy, opts)`. The runner does not change.

## The two-tool-source model

The model sees one flat OpenAI tool list, but it's a union of two sources merged by `dispatcher.ts`:

- **MCP tools** — discovered from the game server via `mcp.listTools()` on connect. These are the game actions (move, harvest, attack, identify, etc.).
- **Harness-local tools** — registered in `harness-tools.ts`. Today this is just `memory_update`, which writes to the per-session scratchpad. These tools never touch the game server.

The dispatcher tags results with `kind: 'mcp' | 'harness'` so variants (specifically compact's `recordTurn`) can treat harness turns differently — e.g. they don't update `lastPerception`.

## Decider abstraction

The runner only sees `Decider.decide({ messages, tools }) → { message, usage? }`. Two implementations:

- `OpenRouterDecider` — the production path. Strips the harness-only fields (`type`, `actionWindowSize`) from the model config and passes the rest through to OpenRouter as the request body, so per-model knobs like `temperature`, `reasoning.effort`, etc. live in the model JSON.
- `HumanDecider` — TTY menu. The CLI path `harness human <model>` substitutes this in.

This is also the test-injection seam: eval-runner unit tests pass a `ScriptedDecider` that emits hand-crafted assistant messages turn by turn.

## Scratchpad ↔ memory naming

Internally: `Scratchpad` (`helpers/scratchpad.ts`), passed around as `memory: Scratchpad`.
LLM-facing: the harness-local tool is named `memory_update` and its result writes to the same file. The system-prompt section header is `## Memory`. The on-disk artifact is `<id>-memory.md`.

The double-naming is deliberate — internal symbol describes what it *is* (a local scratchpad), the LLM-facing name describes what the model thinks of it as (its memory). Don't rename the LLM-facing surface to "scratchpad"; the prompt and tool name are part of the contract with the model.

## Per-turn data flow (runner, abridged)

```
loop:
  if abort or step >= maxSteps: break
  step++
  messages = strategy.buildMessages(state, memory.read())
  log.event('request', { step, messages, tools })
  result = decider.decide({ messages, tools })          ← throws → log + rethrow
  log.event('response', { step, assistantMsg, usage })
  if assistantMsg has tool_calls:
    dispatched = dispatcher.dispatch(call)              ← throws → caught, logged, becomes ERROR text
    log.event('tool_call' / 'tool_result')
    strategy.onToolResult(state, ...)
  else:
    strategy.onNoToolCall(state, ...)
  verdict = await opts.onTurnComplete?(step, usage)     ← eval uses this for early stop
  if verdict === 'stop': break
mcp.close(); log.close()
```

`onTurnComplete` is the eval hook. The eval-runner passes a callback that returns `'stop'` when checkpoints are all hit or token budget is exhausted; the runner reports that back as `stopReason: 'host_stop'` which the eval-runner re-labels.

## Single-sessionId convention

Every run has one UUID. The harness logger writes `<id>-log.jsonl`, the scratchpad writes `<id>-memory.md`, eval writes `<id>-run.json` — all in `harness/logs/`. For evals, `runEval` generates the UUID and threads it as `sessionId` into the variant; for plain runs, `bootstrap` generates one. This means "given a run.json, you immediately know the matching log + memory paths" with no separate ID indirection.

## Path resolution

`helpers/paths.ts` derives `HARNESS_ROOT` from `import.meta.url`, so `LOGS_DIR` and `CONFIG_DIR` resolve correctly regardless of cwd. Don't introduce relative `'harness/...'` strings — that breaks running scripts from any other directory.
