# Harness — variants

Three history-management strategies. All implement the same `VariantStrategy<S>` interface; all begin with `[system, user(first)]` where `first` is the post-`\n---\n` half of `prompt.md`. They differ only in state shape and what messages the next request contains.

## compact

**Smallest context, rolling window.** Each request is exactly 3 messages: `[system, assistant(tool_call), tool(result)]`.

State (`CompactState`):
- `actionWindow: ActionEntry[]` — last N tool calls as 1-line summaries (default N=20 from `config.actionWindowSize`).
- `lastPerception: RecordedCall | null` — the most recent MCP tool result that contained `<map>` (i.e. the latest world snapshot), kept in full.
- `pendingCall: PendingCall | null` — the previous turn's assistant tool call + its result, replayed verbatim into the next request.

System prompt is rebuilt every turn from: skill prompt + `## Memory` (scratchpad) + `## Recent actions (last N)` (action window 1-liners) + `## Last perception (full)` (verbatim last `<map>` block).

Why it works for small models: the model sees a stable, bounded prompt regardless of run length. The latest perception is in full, so spatial reasoning still has the data it needs; older actions are abbreviated to `tool(args) → <action>` lines.

**Use when:** running cheap/small models, or when you want O(1) tokens per turn.

## baseline

**Full history, no rollup.** State is just `messages: ChatMessage[]`, mutated in place. After each tool result, push `assistant + tool` (no trailing user). System message is *replaced* each turn with the current scratchpad-bearing system text, so memory edits propagate without bloating history.

**Use when:** you have a capable model and want to see what unconstrained context does, or as the "control" arm of an eval comparison.

**Cost:** tokens grow O(turns). A 100-turn run can blow well past 100K input tokens.

## truncated

**Full history, but old turns collapsed.** State shape identical to baseline. The `buildMessages` step runs `compactOldTurns(state.messages, keepRecent=2)` before sending: turns older than the last 2 are each replaced with a single `user` line shaped like `tool(args) → <action>; events:[player_say…, entity_died…]`.

The action tag (`<action>...</action>`) and the `player_say`/`entity_died` event hints come from regex-extracting the tool result text. If neither is present, the line falls back to the first 80 chars of the result.

**Use when:** baseline is too expensive but you want more recent context than compact's 3-message window.

## Why no `user: continue` after a tool result

After a `role: 'tool'` message the model is expected to produce the next assistant turn directly — that's the standard OpenAI/OpenRouter flow. None of the three variants append a `continue` ping after a tool result. The compact variant proves it works (it's been doing this all along by rebuilding the request from state).

The `continue` ping IS still emitted in `onNoToolCall` (when the assistant produced no tool call at all). That's a real stall case where some models need a prod; without it they sit on an empty assistant turn.

## When to add a 4th variant

If the variant differs by **prompt shape or history transform**, add a new file in `variants/` with a strategy export and a thin `run<Name>` wrapper. If it differs by **decider behavior** (e.g. multiple candidates, voting), that's a new `Decider` implementation, not a new variant. If it differs by **what tools are exposed**, that's a `dispatcher` config change, not a new variant.
