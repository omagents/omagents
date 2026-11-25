# DSH Package Guide

`packages/dsh` is `@omagents/omagents-dsh`, the complete DeepSeek Harness Host and native Web Client. It depends only on the exact aligned `@omagents/core` version. Read the root `AGENTS.md` and user-facing `README.md` before changing behavior or documentation.

## Installation and Compatibility

```bash
dsh plugin --profile web add @omagents/omagents-dsh
```

The package supports Node.js `>=24.9.0` and DSH `>=0.2.2-rc.3 <0.2.3-0`. Do not broaden that range without exercising the added versions — the pinned `@deepseek-ai/*` dependency versions must match the host's own plugin versions, because a mismatch makes the older profile copy shadow the host's core plugins. Users install built artifacts and never compile TypeScript or React source. Core is an automatic dependency.

## Package Surfaces

- The package root is the named-export Host with no default or Client export. Keep `name`, `inject`, `apply`, and the typed runtime/Remote exports consistent with the real Loader contract.
- `./client` is the built lazy-CJS React Client, and `./typert` exposes Host invocation metadata to the real Typert Loader.
- `cordis.patch.yml` inserts only the bare `@omagents/omagents-dsh` row at the profile root (DSH skips a patch without `insert` with `patch: entry "omagents" not found`). The Client attaches to that row and must dispose with it; never add a separate Loader row or second application root.
- The `files` allowlist contains only `dist/` and `cordis.patch.yml`; npm also includes the mandatory `README.md` and `package.json` metadata. Never publish TypeScript/TSX source, tests, configs, or test tooling.
- Plugin-index discovery metadata includes `author`, a `homepage` pointing to this package's README, and `repository.directory = "packages/dsh"`; keep these links package-specific rather than letting generated cards point only to the monorepo root.

## Runtime and Job Board

Register all 33 skills (18 OmAgents + 15 Superpowers), canonical MCP entries, nonblocking Python base provisioning, native asynchronous subagent tracking, `/ps`, `parallel_status`, `cancel_task`, compaction-safe context, and independent capability health, including persistence and tracking. DSH `subagent` has no `background` argument and no OpenCode environment variables. Listener/subscription/recovery failures degrade tracking health and successful reactivation/query clears those diagnostics.

The active profile is the outer isolation boundary. Persist the Board at `$DSH_HOME/profiles/<active-profile>/omagents/job-board.json`. Storage read/write/flush failures retain the current in-memory Board and allow reconciliation plus Remote list/watch to continue with visible degraded persistence health. Save admission is serialized in the DSH adapter so every adapter-queued save re-checks degradation before entering Core's write queue; flush/close drain that adapter queue. Runtimes sharing a profile also share the write queue and latest revision, preventing an older overlapping runtime from replacing a newer Board snapshot. The degraded runtime stops current and future disk writes, preventing an unreadable startup store or newer repaired snapshot from being overwritten; reopen it after repair to restore durability. Do not describe that fallback as durable or change Core's sticky contract for other hosts. Startup waits for live-Agent and Session-query capabilities before reconciliation; explicit `listJobs` refresh and each initial/reconnect `watchJobs` baseline reconcile only authorized active jobs, while authoritative lifecycle events apply native outcomes directly. Native `interrupted` Session outcomes recover as `interrupted`, distinct from `aborted` cancellation outcomes. Missing or unreadable outcomes become `interrupted` only when no active run is authoritatively observable; an observed active external run remains active on cold session-not-found. Inactivity is never success, duplicate settlement is idempotent, and there is no periodic running-job poll. Recovered pending outcomes become `injected` only when rendered into the owning parent's context and become `acknowledged` at that parent's native `agent/turn-stopping` boundary; later turns must not repeat them. Native settlement retains direct `injected` semantics.

Cancellation acceptance enters `cancelling`, not `cancelled`. Local interruption stops the current turn while descendants continue unless separately cancelled. External one-shot runs stop permanently and cannot resume. Preserve descendants during local interruption and never fabricate settlement. Native `subagent/start` and `subagent/end` carry the durable creator as `parentSessionId`, while the `subagent` tool result carries only the model-facing child name; resolve it with `ctx.subagents.resolveName(caller, name, exec.signal)` before correlating, and interrupt with user authority (`{ kind: "user" }`) without a parent id.

Search configuration accepts exactly `auto`, `exa`, `keenable`, and `youcom`; unset or empty defaults to `auto`. Automatic mode registers Core's absolute packed `search-proxy/index.mjs` through the native MCP manager/adapter and exposes `mcp__websearch__search` plus single-URL `mcp__websearch__fetch`. Explicit providers retain direct endpoints and provider-native tools, with explicit `youcom` registered as `youdotcom` and mapped to `mcp__youdotcom__you-search`/`mcp__youdotcom__you-extract`. The Proxy initially follows Exa → Keenable → You.com with at most one 30-second attempt per provider per call, including lazy initialization and the tool call, and an approximate 90-second backend upper bound after three attempts. After a fallback-eligible Exa failure, every later call in the same Proxy process uses Keenable → You.com → Exa until the Proxy is recreated; this memory-only state is shared across sessions using the process and has no cooldown or persistence. Empty success, non-fallback failures, and cancellation stop the chain without changing the order. Existing Exa/Keenable metadata remains unchanged; You.com success after two eligible failures retains the first `fallback` and adds ordered `fallbacks` plus readable per-failure lines. Core skill rendering maps automatic generic tools to the DSH names; Deep Research shared/DSH prompts and orchestrated child dispatches must route `auto` exclusively through the Proxy without asking the model to implement fallback. User-owned `websearch` or `youdotcom` configuration and host-native web tools remain outside automatic wrapping/failover. Browser composition pins `auto` but retains four unrelated local echo fixtures only; its built-in Proxy startup and `tools/list` must remain offline because backend initialization is lazy.

Direct You.com uses optional `YDC_API_KEY`: keyed `https://api.you.com/mcp` sends `Authorization: Bearer <YDC_API_KEY>`, while keyless `https://api.you.com/mcp/free` sends no Authorization header and needs no OAuth flow. The [official You.com MCP documentation](https://you.com/docs/agents/mcp-server#choose-your-setup) advertises 100 queries/day for keyless use; keyless does not imply anonymous traffic or no provider logging. Automatic You.com attempts map `maxResults` to `count`, forward `query` to `you-search`, pass only `url` to `you-extract`, and omit unsupported `objective` and `maxCharacters` without local rewriting or truncation. Eligible fallback can disclose the same query or URL to Exa, Keenable, and You.com; explicit `exa`, `keenable`, or `youcom` are direct single-provider opt-outs.

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

Host tests must use the real Cordis Plugin Loader with an isolated `DSH_HOME`; do not replace them with direct `apply()` smoke tests. Keep real local MCP handshakes, automatic Proxy registration and native-child prompt evidence, explicit-provider/user-precedence regressions, Remote authorization/stream cleanup, React accessibility, lifecycle cancellation/recovery, package-surface, and lazy-CJS artifact coverage. Never require an external model API key or public search call; the browser gate uses the packed built-in Proxy with lazy backends and only four unrelated echo fixtures.

Current release-candidate verification includes local Linux x64 with the default pinned `chromium_headless_shell-1254` and main CI run `44712737977` on Linux, macOS, and Windows with the default pinned Chromium; all six Unit/packed and DSH Web jobs passed.

## Release

All four packages share one version and are built, tested, packed, and published together. Core is published first, then OpenCode, Codex, and DSH:

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

DSH has no host-to-host dependency. Build before packing and inspect the actual publish allowlist. Versioning, publication, and Git mutations require explicit user authorization.
