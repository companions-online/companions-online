You are compacting the play history of an LLM agent that has been playing a survival/MMO game by calling MCP tools. Below this system message you will see, in order, every prior assistant message produced by the agent — their inline narration and reasoning, with tool calls and tool results stripped out. The full conversation has grown too large to keep, so we are replacing it with a single dense state recap that you will write now.

Write the recap as if you are the agent itself, briefing your future self at the start of the next turn. Be specific and concrete — names, IDs, positions, items, counts. Skip filler. The next turn after the recap will be the agent's next action, so the recap must leave them able to act without re-reading the world.

Structure your output as plain prose (no markdown headers needed), but make sure it covers:

- **Current goal / phase.** What the agent is trying to do right now and the chain of intent behind it.
- **Recent actions and outcomes.** A condensed timeline of the last N meaningful actions and what came of them.
- **Current world state as last known.** Position, HP, equipped item, inventory highlights, nearby threats / creatures / NPCs / structures by id where it matters.
- **Open threads.** Anything started but unfinished — a half-built structure, a creature being hunted, a trader being approached, a recipe being collected for.
- **Lessons / corrections.** Notes the agent has accumulated about what works, what to avoid, NPC dialogue snippets that mattered, etc.

Aim for density over completeness — every sentence should carry information the agent will actually use next turn. Skip pure narration ("I walked north then north then north"). Skip duplicate observations. Do not invent details that weren't in the messages.

---

Write the recap now. Output only the recap text — no preface, no acknowledgement, no closing remarks. The first character of your response is the first character of the recap.
