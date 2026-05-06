---
title: Multi-character play
sidebar_position: 6
---

# Multi-character play

`npx characters` runs several LLM players concurrently against the
same world. They see each other, can chat, can trade, can compete
for resources, can cooperate or interfere. It's the simplest way
to stage emergent multi-agent scenarios in Companions Online.

## Quick start

```bash
npm run dev:server               # in one terminal
export OPENROUTER_API_KEY=sk-or-...
npx characters                   # in another
```

The CLI loads a roster from `harness/characters/config.json`,
spawns one MCP session per entry, and brings up a live TUI
dashboard tracking each character's status.

## Roster format

`harness/characters/config.json` is a JSON array of character
objects:

```json
[
  {
    "prompt": "princess",
    "harness": "baseline",
    "model": {
      "type": "model",
      "model": "google/gemma-4-31b-it",
      "temperature": 1,
      "reasoning": { "effort": "none" }
    }
  },
  {
    "prompt": "hunter",
    "harness": "baseline",
    "model": {
      "type": "model",
      "model": "google/gemma-4-31b-it",
      "temperature": 1,
      "reasoning": { "effort": "none" }
    }
  },
  {
    "prompt": "peon",
    "harness": "compact",
    "model": {
      "type": "model",
      "model": "google/gemini-3.1-flash-lite-preview",
      "temperature": 1,
      "reasoning": { "effort": "none" }
    }
  }
]
```

| Field | Purpose |
| --- | --- |
| `prompt` | Basename of the prompt file in `harness/characters/` (or `harness/config/`). |
| `harness` | History strategy: `baseline`, `compact`, or `shortened`. |
| `model` | Inline model config — same shape as a `harness/config/<name>.json`. |

You can mix variants and models freely. A common setup is one
"thinker" character on a slower / cheaper model with a detailed
prompt, plus one or two "doers" on a fast model with a simpler
prompt.

## How the run works

Each character gets its own MCP session, identifies into the
world under a name derived from its prompt, and runs the same
loop the single-player harness uses — except all of them are
ticking against the same `GameWorld`.

The dashboard shows per-character:

- Display name and prompt.
- Current action / tool being called.
- Token totals (input / output / reasoning).
- Cost so far.
- Last error if the session is failing.

Press **Ctrl-C** to stop the run gracefully. On exit the
dashboard tears down and a final summary prints to stderr.

## Use cases

- **Cooperative scenarios.** Two LLMs, one prompted as a builder
  and one as a scavenger. Watch what they negotiate over chat.
- **Adversarial scenarios.** One peaceful character, one
  aggressive. Note that PvP is allowed in this world — players
  can attack other players.
- **Roleplay drift studies.** Three characters on the same model
  with different prompts. How long before each one stays in
  character? When do they break?
- **Cross-model comparisons.** Same prompt, different models, in
  the same world. Easier to compare than running separate eval
  runs.

## Limitations

- All characters share the same world. There's no per-character
  isolation today; if one character blocks the door of the shared
  base, the others are blocked too.
- The dashboard is per-run. There's no persistent leaderboard or
  history viewer; for that, use [MMO Bench](./mmo-bench).
