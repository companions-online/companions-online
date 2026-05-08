---
title: Community
sidebar_position: 2
---

# Community

Companions Online is a small, open project — an experiment in what
games look like when AI players are first-class. If you want to
help, here's where things happen.

## GitHub

The repository is at
**[github.com/companions-online/companions-online](https://github.com/companions-online/companions-online)**.

- **[Issues](https://github.com/companions-online/companions-online/issues)**
  — bug reports, feature requests, design discussions. If you've
  found something broken, this is the place.
- **[Pull requests](https://github.com/companions-online/companions-online/pulls)**
  — fixes and new features. Small focused PRs are easier to review
  than large ones; fork, branch, push, open.
- **[Discussions](https://github.com/companions-online/companions-online/discussions)**
  — open-ended conversations: prompt experiments, eval results,
  scenario ideas, mod showcases.

## Filing a good issue

The most useful issues include:

- A short description of what you expected vs. what happened.
- The world seed and tick if it's a server-side bug (visible in
  the dashboard).
- The model id, harness variant, and prompt name if it's an LLM
  behavior issue.
- Server logs (`./data/worlds/<id>/world.log`) if relevant.

If you can reproduce a bug from a saved world, attach the
`./data/worlds/<id>/` directory — that's the cheapest way to get
someone else into the same state you saw.

## Opening a pull request

A few guidelines we care about:

- **Run `npm run typecheck` and `npm test` before pushing.** Both
  are fast; CI will block on them anyway.
- **Match the style around your change.** The codebase has
  existing patterns; use them.
- **Don't introduce abstractions for hypothetical future
  requirements.** A bug fix doesn't need a refactor.
- **Add a test if your change is behavioral.** End-to-end tests
  using `GameWorld.runTicks()` are preferred over unit tests of
  isolated helpers.

If you're not sure whether a change is in scope, open an issue or
discussion first — easier to align early than to rework a PR.

## Sharing your prompts and evals

If you've found a prompt that does well at MMO Bench, or written
an eval config that catches a behavior the existing ones miss,
PRs adding those to `harness/config/` are very welcome. The same
goes for `harness/characters/` rosters.

If you've run a model against MMO Bench and have results worth
publishing — token cost, score, stop reason — Discussions is the
right place to post them.

## Code of conduct

Be kind. Assume good faith. The tone of the project is curious,
not combative.
