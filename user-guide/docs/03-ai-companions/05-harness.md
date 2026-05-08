---
title: The harness
sidebar_position: 5
---

# The harness

The harness is a small CLI for running an LLM player against a
running Companions Online server. It handles the MCP connection,
the conversation loop, history management, decider selection, and
cost / token tracking.

## Quick start

Start a server in one terminal:

```bash
npm run dev:server
```

Then in another terminal, run the harness:

```bash
export OPENROUTER_API_KEY=sk-or-...
npx harness baseline gemini-3-flash
```

The CLI takes three positional arguments:

```
npx harness <variant> <model-config|human> [prompt-name]
```

- `<variant>` — `baseline`, `compact`, or `shortened`.
- `<model-config>` — the name of a JSON file in `harness/config/`
  (e.g. `gemini-3-flash`, `gemma-4-nothink`,
  `deepseek-v4-flash-nothink`). Or the literal `human` for
  manual play.
- `[prompt-name]` — optional; the name of a prompt file. Defaults
  to `prompt` (i.e. `harness/config/prompt.md`).

## The three variants

All three variants use the same prompt and the same tool surface;
they differ only in how they manage the conversation history
between turns.

### `baseline`

Keeps the full message history — every assistant turn, every tool
result, every reasoning block. After each tool result, the harness
sends `user: "continue"` to nudge the model to act again.

- **Pro**: maximum context, easy to debug, history is exactly
  what the model produced.
- **Con**: tokens grow unboundedly with run length. Hits context
  limits on long sessions.

Use baseline when you're debugging behavior, not tuning for
efficiency.

### `compact`

Keeps a rolling window of recent actions and the last perception
snapshot. Rebuilds a fixed three-message prompt every turn:
system + assistant + tool-result. Older turns are dropped, not
collapsed.

- **Pro**: bounded token footprint regardless of run length.
- **Con**: loses long-range context — the model "forgets" things
  it did many actions ago.

Use compact for long survival runs where steady token spend
matters more than perfect recall.

### `shortened`

Keeps full history but collapses turns older than the most recent
two into a single assistant message that lists tool calls + tool
result tags + reasoning, in compact form.

- **Pro**: preserves long-range structure (the model can still
  see what happened ten actions ago) at much lower token cost.
- **Con**: more complex; the collapsed format hides some detail.

Use shortened as the default for benchmarking — it's the closest
to "all the context you need, none you don't."

| Variant | History | Token growth | Recall |
| --- | --- | --- | --- |
| baseline | Full, verbatim | Unbounded | Perfect |
| compact | Window + snapshot | Bounded | Recent only |
| shortened | Full, collapsed older | Slow growth | Compressed |

## Human harness

Pass `human` instead of a model config to drive the harness
yourself. You get the same prompt, the same envelope, the same
tool surface — but the next-action decision is a menu in your
terminal instead of an LLM call.

```bash
npx harness baseline human
```

This mode is for **testing the harness directly**: walking through
a prompt change to see what the model would actually see, sanity-
checking that a tool wires up correctly, debugging a rejection,
or proving a scenario out by hand before pointing a paid model
at it. It's not a way to play the game (use the WebGL client for
that); it's the harness's introspection seam.

## Configuration files

Model configs are JSON in `harness/config/`:

```json
{
  "type": "model",
  "model": "google/gemini-3.1-flash-lite-preview",
  "temperature": 1,
  "reasoning": { "effort": "none" }
}
```

Add a new file with the model id you want to test, then pass its
basename to the CLI.

Prompts are markdown in `harness/config/` (or
`harness/characters/`). The default is `prompt.md`; pass a
different basename to try a variant.

## What the harness logs

Each run emits structured logs to stderr (so stdout stays usable
for piping). Per-turn lines record:

- Action chosen and arguments.
- Tokens (input / output / reasoning, cache hits).
- Latency.
- Stop reason on exit.

Final summary includes total tokens, total cost, and the run id.

## Using the harness for benchmarking

The same variants and configs feed the [MMO Bench](./mmo-bench)
eval system. The harness is the interactive tool; `npx eval` runs
the same code under a checkpoint scoreboard.
