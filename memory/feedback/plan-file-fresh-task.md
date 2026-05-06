---
name: Plan file — clean for new task
description: When re-entering plan mode for a different task, fully rewrite the plan file rather than appending the new plan to the old one
type: feedback
---

When `EnterPlanMode` is called and a stale plan file exists from a prior, unrelated task, **fully overwrite** the plan with just the new task's content. Do NOT append the new plan beneath the old one.

**Why:** The plan file is what the user reviews to approve the next step. Leaving the previous task's content above the new plan makes review harder and risks the user thinking unfinished work is still on the table. The user explicitly corrected this: "the plan given above includes the previous plan as well. either clean and rewrite, or remove the non-relevant part."

**How to apply:**
- New planning session for a *different* task → `Write` the file with only the new plan (no carryover from prior tasks).
- Continuation / refinement of the *same* task → `Edit` to update specific sections, removing anything outdated.
- The plan-mode harness reminder also says this; obey it without needing the nudge.
