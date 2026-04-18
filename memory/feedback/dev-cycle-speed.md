---
name: Keep dev cycle tight
description: Server stands up in <2s; don't pad Bash calls with sleep, don't chain many verification commands
type: feedback
---

The dev server stands up in under 2 seconds. Don't pad restarts with `sleep 3` or run multi-step `head | grep | curl` verification chains — they add latency to every change.

**Why:** slow verification loops compound across the many iterations in a typical change, turning a fast edit-build-probe cycle into minutes of waiting the user can see in the UI.

**How to apply:**
- After starting a dev/test server, either run one `curl -sf ... && echo OK` check OR go straight to the actual probe (puppeteer / next step).
- If the server takes >2s, that's a signal something's wrong — look at the log, don't wait longer.
- Prefer `run_in_background: true` for `npm run dev:server` so the turn doesn't wait on the long-running process; then do ONE readiness check.
- Skip defensive `sleep`s between setup steps; the shell sequences them anyway. Add sleeps only when a specific async ordering actually requires them, and keep them as short as possible.
