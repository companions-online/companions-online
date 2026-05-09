---
title: MMO Bench
sidebar_position: 7
---

# MMO Bench

MMO Bench is our contribution to the LLM community: an
open-source benchmarking tool for measuring model performance in
real-time, embodied agent benchmarks. It boots a deterministic
Companions Online world, points one or more models at it through
our harness, and scores them against a checkpoint list. It runs in single-player mode (one model vs. the
world) or multi-LLM mode, with several models sharing a world.

The same harness variants (`baseline`, `compact`, `shortened`)
feed into it — what's added is a deterministic world, a
stop-condition ladder, and a checkpoint scoreboard.

## Current results

Run against `survival-basics-baseline` — six checkpoints
(`harvest_tree`, `harvest_stone`, `craft_axe`, `kill_deer`,
`kill_wolf`, `cook_meat`) with a 500K-token cap.

| Model | Score | Actions / sec |
| --- | --- | --- |
| qwen-3.6-flash-nothink | 4 / 6 | <!-- TODO measure --> |
| gemini-3-flash | 2 / 6 | <!-- TODO measure --> |
| gemma-4-nothink | 2 / 6 | <!-- TODO measure --> |

To play alongside your companion on Companions Online, the model
needs to be both **relatively smart and relatively fast**. This
eval is designed to stress both — the world keeps moving while
the model thinks, so a slow clever model misses windows a fast
cruder one catches. Calibrate your companion against the rows
above on the bench to get a read on what to expect.

## Running an eval

```bash
npm run dev:server                # not needed; eval boots its own
export OPENROUTER_API_KEY=sk-or-...
npx eval survival-basics-baseline gemini-3-flash
```

`npx eval` takes two arguments: the eval config name and the
model config name. Both resolve to JSON files in
`harness/config/`.

The eval-runner stands up its own server on an ephemeral port,
points the harness at it via `MCP_URL`, runs the variant the eval
specifies, and tears the server down at the end. Exit code is `0`
if every checkpoint hit, `1` otherwise.

## Eval config schema

```json
{
  "type": "eval",
  "name": "survival-basics",
  "harness": "baseline",
  "worldSeed": 42,
  "maxTurns": 150,
  "maxTokens": 500000,
  "checkpoints": [
    { "id": "harvest_tree",  "event": "harvest_yield",  "match": { "resourceName": "Wood" } },
    { "id": "harvest_stone", "event": "harvest_yield",  "match": { "resourceName": "Stone" } },
    { "id": "craft_axe",     "event": "craft_complete", "match": { "itemName": "Axe" } },
    { "id": "kill_deer",     "event": "entity_died",    "match": { "entityName": "Deer" } },
    { "id": "kill_wolf",     "event": "entity_died",    "match": { "entityName": "Wolf" } },
    { "id": "cook_meat",     "event": "item_cooked",    "match": { "outputName": "Cooked Meat" } }
  ]
}
```

| Field | Purpose |
| --- | --- |
| `name` | Eval identifier. |
| `harness` | Variant to run (`baseline`, `compact`, or `shortened`). |
| `worldSeed` | Seeds the world generator — same seed = same map. |
| `maxTurns` | Hard cap on harness turns. |
| `maxTokens` | Hard cap on cumulative tokens (input + output + reasoning). |
| `checkpoints` | Ordered list of event matchers. |

## How checkpoints score

The scoreboard subscribes to the world's event observer, which
fires for every emitted game event (combat hits, harvest yields,
craft completions, deaths, cooking, etc.). On each event:

- For every unfired checkpoint, shallow-compare the checkpoint's
  `match` object against the event's `details`. A field-by-field
  match counts as a hit.
- Once a checkpoint hits, it stays hit; further matching events
  don't re-trigger it.

Score is `<hits> / <total>`. The run exits early with stop reason
`all_checkpoints` once every checkpoint has hit.

## Stop reasons

The run ends for one of:

| Reason | Cause |
| --- | --- |
| `all_checkpoints` | Every checkpoint hit. Score = total. |
| `max_turns` | Turn cap reached. Whatever score the model had stands. |
| `max_tokens` | Token cap reached. Same. |
| `aborted` | SIGINT / external stop signal. |
| `error` | Uncaught exception in the harness or server. |

Each run writes a JSON record to `harness/eval/runs/<runId>.json`
with the full per-turn token usage, every emitted event, and the
final score.

## Writing your own checkpoint

A checkpoint is `{ id, event, match }`. The `event` field names a
game event type, and `match` is a partial object compared against
the event's `details`. The shape of `details` per event type lives
in `server/src/events.ts` — pick the field you want to assert on
(usually `entityName`, `resourceName`, `itemName`, `outputName`,
or a numeric tile coord).

Example: a checkpoint that fires when the player kills a Skeleton:

```json
{ "id": "kill_skeleton", "event": "entity_died", "match": { "entityName": "Skeleton" } }
```

Drop it into a copy of an existing eval config, save under
`harness/config/<your-eval>.json`, and run it.

## Making the eval reproducible

- Pin `worldSeed` — the world generator is deterministic.
- Pin the model config (model id, temperature, reasoning effort).
- Pin the harness variant. `compact` and `shortened` have
  different recall profiles; mixing them between runs muddies the
  comparison.

The first AI to finish `survival-basics` cleanly is, by
construction, the first player. Companions Online's eval is the
benchmark we wish existed when we started.
