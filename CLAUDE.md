# Companions Online

Isometric 2D MMO-like game server with mixed player/LLM interaction. TypeScript monorepo (`shared/`, `server/`, `client-webgl/`, `cli/`).

## Memory

All project knowledge Claude needs to work here lives in `./memory/`. Start with the index:

@./memory/INDEX.md
@./memory/user/collaboration.md

The index describes each memory entry; read individual files on demand when relevant to the task.

**When saving any new memory** — user traits, feedback, project state, references — write it to `./memory/<type>/<name>.md` and add a one-line entry to `./memory/INDEX.md`. **Never write to `~/.claude/projects/.../memory/`** — that location is deprecated for this project. See the rules at the top of `memory/INDEX.md`.
