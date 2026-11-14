# DSH Package Guide

`packages/dsh` is `@omagents/omagents-dsh`, the complete DeepSeek Harness Host and native Web Client. It depends only on the exact aligned `@omagents/core` version. Read the root `AGENTS.md` and user-facing `README.md` before changing behavior or documentation.

## Installation and Compatibility

```bash
dsh plugin --profile web add @omagents/omagents-dsh
```

The package supports Node.js `>=24.9.0` and DSH `>=0.2.2-rc.1 <0.2.3-0`. Do not broaden that range without exercising the added versions. Users install built artifacts and never compile TypeScript or React source. Core is an automatic dependency.

## Package Surfaces

- The package root is the named-export Host with no default or Client export. Keep `name`, `inject`, `apply`, and the typed runtime/Remote exports consistent with the real Loader contract.
- `./client` is the built lazy-CJS React Client, and `./typert` exposes Host invocation metadata to the real Typert Loader.
- `cordis.patch.yml` contains only the bare `@omagents/omagents-dsh` row. The Client attaches to that row and must dispose with it; never add a separate Loader row or second application root.
- The `files` allowlist contains only `dist/` and `cordis.patch.yml`; npm also includes the mandatory `README.md` and `package.json` metadata. Never publish TypeScript/TSX source, tests, configs, or test tooling.

## Runtime and Job Board

Register all 33 skills (18 OmAgents + 15 Superpowers), canonical MCP entries, nonblocking Python base provisioning, native asynchronous subagent tracking, `/ps`, `parallel_status`, `cancel_task`, compaction-safe context, and independent capability health. DSH `subagent` has no `background` argument and no OpenCode environment variables.

The active profile is the outer isolation boundary. Persist the Board at `$DSH_HOME/profiles/<active-profile>/omagents/job-board.json`. Startup waits for live-Agent and Session-query capabilities before reconciliation; explicit `listJobs` refresh and each initial/reconnect `watchJobs` baseline reconcile only authorized active jobs, while authoritative lifecycle events apply native outcomes directly. Missing or unreadable outcomes become `interrupted` only when no active run is authoritatively observable; an observed active external run remains active on cold session-not-found. Inactivity is never success, duplicate settlement is idempotent, and there is no periodic running-job poll.

Cancellation acceptance enters `cancelling`, not `cancelled`. Local interruption stops the current turn while descendants continue unless separately cancelled. External one-shot runs stop permanently and cannot resume. Preserve descendants during local interruption and never fabricate settlement.

## Remote and Native Web Client

`OmAgentsRemote` exposes `listJobs`, `watchJobs`, `cancelJob`, and `getHealth`. Enforce DSH remote-access rules on the invocation-derived Context and optional `parentSessionId`; filter unscoped reads per job and return structured denial errors. Do not expose other profiles or unauthorized parent sessions.

`watchJobs` attaches the Core listener before reconciliation and its baseline, then emits revisioned whole-set frames without further native polling. Reconnection starts a fresh reconciled baseline. Iterator `return()`/`throw()` and abort detach immediately even during initial reconciliation. There is no application forwarded-event modification, browser-owned job database, iframe, or direct `document.body` mount.

The React Client registers DSH sidebar/main slots and plugin-owned controls using `--dsw-alias-*` colors. It provides filters, details, execution/notification states, confirmed non-repeatable cancellation, elapsed-time ticks, and loading/empty/stale/permission/degraded presentations. Viewing details never acknowledges a model notification.

Only `jinja2` is automatically provisioned; optional Python tools are on demand. Reference the `agents-python-tools` skill rather than duplicating the full Python environment guide.

## Build and Verification

```bash
npm run typecheck --workspace @omagents/omagents-dsh
npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh
node --test tests/documentation.test.js
npm test
npm run pack:all
npm run test:packed
npm run test:browser
```

Host tests must use the real Cordis Plugin Loader with an isolated `DSH_HOME`; do not replace them with direct `apply()` smoke tests. Keep real local MCP handshakes, Remote authorization/stream cleanup, React accessibility, lifecycle cancellation/recovery, package-surface, and lazy-CJS artifact coverage. Never require an external model API key.

Current release-candidate verification ran locally on macOS arm64 with the `chromium_headless_shell-1228` override. Linux, Windows, and the default pinned Chromium require first CI confirmation; do not claim those runs already passed.

## Release

All four packages share one version and are built, tested, packed, and published together. Core is published first, then OpenCode, Codex, and DSH:

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

DSH has no host-to-host dependency. Build before packing and inspect the actual publish allowlist. Versioning, publication, and Git mutations require explicit user authorization.
