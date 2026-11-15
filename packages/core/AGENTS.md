# Core Package Guide

`packages/core` is `@omagents/core`, the automatic shared dependency of OpenCode, Codex, and DSH. It is not a standalone user plugin and has no separate installation command. Read the root `AGENTS.md` first.

## Boundaries

Core must remain host-neutral. Do not import OpenCode, Codex, DSH, Cordis, React, or host SDK packages. Host adapters inject storage paths, lifecycle queries, cancellation, event delivery, and presentation behavior.

- `src/job-board/`: execution state, independent notification state, transitions, and presenters.
- `src/storage/`: validated, versioned, serialized, atomic JSON persistence and recovery.
- `src/skills/`: discovery and full-content rendering for exactly `opencode-v1`, `opencode-v2`, `codex`, and `dsh`.
- `src/mcp/` and `mcp-servers/base.json`: canonical environment-dependent MCP resolution.
- `src/paths.js`: packaged asset resolution through `import.meta.url`, never cwd. Superpowers resolution explicitly prefers the real workspace/app-hoisted installation, falls back to Core's bundled nested dependency, and remains stable across prepack materialization/postpack cleanup.
- `hooks/`: persistent Python base and on-demand project overlay management.
- `skills/`: 18 OmAgents skills, shared scripts, and research assets; pinned Superpowers supplies 15 process skills.

Execution and notification state are separate. Terminal states never regress, `interrupted` is not success, and cancellation admission alone is not `cancelled`. Consumers share one Board; do not create a second task database.

## Skills and Assets

`SKILL.md` is the fallback and `SKILL.<host>.md` is a complete override, not a runtime search-and-replace fragment. Do not add runtime host detection. Preserve native host delegation forms and the pinned Superpowers commit.

Jinja2 templates live only under `packages/core/skills/deep-research/templates/`. There is no root `templates/` directory. Deep-research internal state and public deliverables must remain separated through `skills/deep-research/scripts/layout.py`.

Only `jinja2` is automatically provisioned. Optional Python tools install on demand. Use the `agents-python-tools` skill for environment selection, paths, and CLI details rather than duplicating the full Python guide here. Never auto-delete the base or project environment.

## Verification

```bash
npm test --workspace @omagents/core
node --test tests/documentation.test.js
npm test
python -m compileall -q packages/core/skills/deep-research/scripts
python -m compileall -q packages/core/skills/_shared/scripts
```

Core `prepack` materializes the pinned installed Superpowers dependency into an ignored package-local directory for npm packing; `postpack` removes only that marked materialized copy. Never commit a duplicate Superpowers source tree. Run `npm run pack:all` and `npm run test:packed` for asset and clean-room changes.

## Release

Core and all hosts share one exact version. Every release builds, tests, packs, and publishes all four packages. Core is published first, followed sequentially by OpenCode, Codex, and DSH:

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

Do not add dependencies between host packages. Versioning, publication, and Git mutations require explicit user authorization.
