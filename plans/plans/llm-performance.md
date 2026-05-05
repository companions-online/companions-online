new baseline harness:

tsx harness/cli/eval.ts survival-basics-baseline qwen-3.6-flash-nothink
 -> score 4/6 — hit: harvest_tree, craft_axe, kill_deer, cook_meat — turns: 34 — tokens: in=507706/out=2977/total=510683 — stop: max_tokens

tsx harness/cli/eval.ts survival-basics-baseline  gemini-3-flash
 -> score 2/6 — hit: harvest_tree, craft_axe — turns: 35 — tokens: in=517409/out=2466/total=519875 — stop: max_tokens

gemma-4-nothink:
score 2/6 — hit: harvest_tree, craft_axe — turns: 38 — tokens: in=506386/out=723/total=507109 — stop: max_tokens










-------------
sonnet & haiku: too slow, even at low reasoning -> 2-3 seconds between movements

gemini 2.5 flash lite -> stops after 3-5 calls

0.25 | 1.50  gemini 3.1 flash lite ->
** no thinking: plays well for first round (~12 tool calls), then stop
** thinking: plays a bit, but no continuity between sessions -cherry+openrouter->google API broken


2.25 | 2.75 zai-glm-4.7 plays well, but expensive AF on cerebras


0.26 | 2.08 qwen3 235B A22B instruct -> plays somewhat, then stops at 8-10 calls