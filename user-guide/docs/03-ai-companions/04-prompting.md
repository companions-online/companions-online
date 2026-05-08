---
title: Prompting
sidebar_position: 4
---

# Prompting

Companions Online plays well with most modern instruction-tuned
LLMs, but the world has a few sharp edges that benefit from
explicit guidance in the system prompt. This page summarizes the
patterns we've found work, and links to the prompt we ship with
the harness.

## The current shipping prompt

The system prompt the harness uses every run is checked into the
repo and copied verbatim into this site at build time:

→ **[Open the live prompt (raw markdown)](pathname:///prompt.md)**

That file is whatever shipped at the time of the build. If you
fork the project and tune your own prompt, that's the file to
edit; rebuild the site to publish it.

## Patterns that work

### One action per turn, then read the envelope

Every action returns a full perception envelope. That's the
look-around — the model rarely needs to follow an action with
`get_surroundings`. The model that wins is the one that **plans a
phase, executes one action, reads, decides next** — not the one
that fires several tool calls per turn or calls `get_surroundings`
between every action.

### Treat rejections as data, not errors

Rejection envelopes carry structured reasons and obstacle hints.
The model should read the rejection and pick a corrective action,
not retry the same thing. For example:

```
[rejected: tile_blocked; water blocks at (50,40), (51,40) — build a wooden floor to cross]
```

is an instruction to either route around or place a floor; not a
"try again" signal.

### Identify first, then look around

The first two calls of every session are almost always:

1. `identify(name)`
2. `get_surroundings()` (or skip — `identify` already returns a
   full envelope)

Then the model can plan.

### Skip redundant queries

`get_inventory` and `get_recipes` rarely change between actions.
Most action envelopes embed the relevant inventory state. Calling
the queries every turn just burns tokens.

### Ignore broadcast events

The MCP envelope shows first-person events ("you hit", "you
gained"). Broadcast events (other players' visuals) don't reach
MCP — they're a WebSocket-only channel for spectator visuals.
Models trained to look for them will be disappointed; the prompt
should not promise them.

## Common failure modes

| Symptom | Likely cause |
| --- | --- |
| Model keeps calling `get_surroundings` after every action | Prompt didn't establish that action responses are full perception. |
| Model retries the same rejected action repeatedly | Prompt didn't teach rejection-as-data. |
| Model batches multiple action tool calls in one assistant turn | Tool runtime serializes them; the second call typically interrupts the first. Prompt must say "one action per turn." |
| Model freezes mid-night, doing nothing | Skeleton aggro is silent in events; the model needs an explicit "if HP drops, react" rule. |
| Model wanders into rivers and gives up | Missing instruction to read obstacle hints and place floors. |

## Tuning your own prompt

The shipping prompt is markdown — fork it, edit it, and either:

- Rebuild the harness with `npm run harness <variant> <model>
  <your-prompt-name>` (prompts live in `harness/config/` and
  `harness/characters/`).
- Or wire it into your own MCP client directly — the system
  prompt is just text.

If you want to change the prompt that ships on the published
guide, edit `harness/config/prompt.md` and rebuild the user guide
(`npm run build:guide`).
