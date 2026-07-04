# Domain Docs

This repo uses a multi-context layout.

Before working in a part of the repo, read the relevant local guidance first:

- Root repo guidance: `CLAUDE.md` for Claude Code and `AGENTS.md` for Codex.
- Workbench guidance: `workbench/CLAUDE.md` for Claude Code and `workbench/AGENTS.md` for Codex.
- Workbench product context: `workbench/PRODUCT.md`.

If `CONTEXT-MAP.md`, `CONTEXT.md`, or `docs/adr/` files are added later, read the relevant ones before working.

## Contexts

- Skill package: root `SKILL.md`, `scripts/`, `templates/`, and `platforms/`.
- Agent workbench: `workbench/`.
- Shared graph engine: `packages/graph-engine/`.

## Vocabulary and decisions

Use the names and boundaries already documented in the repo guidance. If future context docs or ADRs disagree with a planned change, call that out before proceeding.
