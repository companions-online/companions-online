---
name: Sticky tap-to-act arming
description: client-webgl HUD action button — arming for placement/cook persists across taps until the stack empties or the user explicitly cancels
type: feedback
---

When wiring a tap-to-act / "armed mode" button (e.g. mobile-style "Place Wall" → tap a tile), the arm should NOT auto-disarm after a single successful action.

**Why:** The user pointed out that for stacks (5 walls in a quickslot), the natural UX is "tap button once, keep tapping tiles to keep building." Auto-disarm forces re-tapping the action button between every wall — friction that doesn't match how a player thinks about chained actions.

**How to apply:**
- Sticky arming. Stay armed after a successful commit so the next tap chains.
- Auto-clear when the arm goes stale: e.g. `selectedMode(scene) !== armedAction` (the stack ran out, or the slot rebound) — handle lazily in the click handler so no inventory-sync hook is needed.
- Explicit cancel paths: tapping the (highlighted) action button toggles off; tapping a different quickslot or pressing Esc clears via `selectQuickSlot`/`clearQuickSlotSelection`; opening any modal overlay clears.
- Failed commits (e.g. server bounces an unwalkable placement) should also leave the arm intact — the next tap on a *valid* tile builds. Don't pre-validate client-side just to disarm.

This rule generalizes to any "repeated-action mode" (cook a stack of raw fish, eat several bandages quickly via right-click, etc.).
