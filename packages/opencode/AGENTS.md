# OpenCode Package Guide

`packages/opencode` is `@omagents/omagents`, the OpenCode V1/V2 host package. It depends only on the exact aligned `@omagents/core` version. Read the root `AGENTS.md` first.

## Installation Surface

```bash
npx @omagents/omagents
```

The installer takes no positional argument. Only conventional `--help` and `--version` options are supported; unknown arguments fail. Do not add a Codex or other host dispatcher to this package. Core is an automatic dependency, not a separate user install.

## Plugin Contract

- `src/index.js` exports the plain dual descriptor `{ id, server, setup }` plus the named V1 plugin export. Do not import either OpenCode SDK package.
- V1 preserves `task(background: true)`; V2 preserves native `subagent(..., background: true)` and structured child-session metadata.
- `src/parallel.js` is the OpenCode lifecycle adapter over Core, not a host-neutral storage implementation.
- Skills and MCP entries come from Core. User MCP configuration takes precedence, and local V2 servers retain their cold-cache startup timeout.
- Preserve parent-context completion delivery, compaction state, `/ps`, `parallel_status`, `cancel_task`, TUI state, PATH injection, and the established OpenCode storage location.
- `bin/install.js` is the CLI only. `main` must remain the plugin entry so importing the package never executes CLI dispatch.

The repository `.opencode/plugins/index.js` is only a development re-export. Never move product implementation back into `.opencode/plugins/`, and never remove the self-repository dedup guard; otherwise npm and local copies activate together.

## Verification

```bash
node --check packages/opencode/src/index.js
node --test tests/plugin.test.js tests/plugin-v2.test.js tests/opencode-cli.test.js tests/opencode-recovery.test.js
node --test tests/documentation.test.js
npm test
npm run pack:all
npm run test:packed
```

Run the complete suite before finishing shared-Core changes. Preserve cross-platform paths and no-argument installer behavior in packed installs.

## Release

All four packages use one aligned version and are built, tested, packed, and published together. Publish Core first, then OpenCode, Codex, and DSH in that order:

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

No host-to-host dependency is allowed. Versioning, publication, and Git mutations require explicit user authorization.
