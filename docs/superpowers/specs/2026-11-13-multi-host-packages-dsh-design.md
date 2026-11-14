# Multi-Host Packages and Full DeepSeek Harness Support Design

Date: 2026-11-13
Status: Approved design; implementation in progress

## Purpose

Restructure OmAgents into explicit host packages with one shared core, and add DeepSeek Harness (DSH) as a complete, first-class host. The DSH release must include the full parallel execution lifecycle, model-facing status and cancellation tools, `/ps`, durable recovery, and a native Web Job Board. It must not be released as a skills-only or otherwise reduced plugin.

The existing OpenCode package remains `@omagents/omagents`. Codex moves to a new package with no backward-compatibility layer because there are no existing Codex users. DSH receives its own Host and Client package so its Loader and native Web UI use supported package surfaces.

## Goals

1. Publish three explicit user-facing host products and one shared dependency:
   - `@omagents/omagents` for OpenCode V1/V2.
   - `@omagents/omagents-codex` for Codex.
   - `@omagents/omagents-dsh` for DeepSeek Harness.
   - `@omagents/core` as an automatically installed shared library, not a user-facing plugin.
2. Make package selection the host selection mechanism; do not detect hosts from runtime context, environment variables, call stacks, or module export probing.
3. Keep host-independent Job Board, persistence, skills, MCP resolution, Python environment, and research workflow logic in Core.
4. Provide complete DSH background subagent tracking, completion delivery, cancellation, restart recovery, `/ps`, `parallel_status`, `cancel_task`, and native Web management.
5. Support every bundled OmAgents and Superpowers skill on DSH through shared content or explicit host-specific rendering; do not silently omit unsupported skills at release.
6. Preserve existing OpenCode V1/V2 behavior and package installation identity while sharing Core.
7. Publish built DSH Host and browser artifacts so end-user installation does not compile TypeScript or React source.
8. Keep all four README languages, project guidance, support matrices, tests, and release documentation synchronized.

## Non-Goals

- No compatibility command, alias, migration shim, or fallback for `npx @omagents/omagents codex`.
- No universal module entry that tries to support OpenCode and DSH by inspecting `ctx`.
- No mixed DSH function-plugin/default-export surface.
- No DSH package-subpath Host entry for the native UI; DSH attaches a browser half only to a bare package-root Loader row.
- No iframe-based Web UI, browser-owned job database, or periodic polling of running tasks.
- No new task dependency system, scheduler, or follow-up/resume product feature beyond the host behavior required for accurate status and cancellation.
- No assumption that DeepSeek operates an official curated plugin marketplace.
- No public release of intermediate skills-only, Host-only, or UI-only DSH milestones.

## Approved Installation Surface

```bash
# OpenCode: no positional argument
npx @omagents/omagents

# Codex: no positional argument
npx @omagents/omagents-codex

# DeepSeek Harness
dsh plugin --profile web add @omagents/omagents-dsh
```

The OpenCode and Codex CLIs support installation with no arguments plus conventional `--help` and `--version` options. They do not dispatch to other host installers. OpenCode module loading continues through the OpenCode package entry; CLI execution and module import remain separate package surfaces.

## Repository and Package Layout

The repository root becomes a private npm-workspaces root. It is no longer the published package root.

```text
omagents/
├── packages/
│   ├── core/                         # @omagents/core
│   │   ├── src/
│   │   │   ├── job-board/
│   │   │   ├── storage/
│   │   │   ├── mcp/
│   │   │   ├── skills/
│   │   │   └── python/
│   │   ├── skills/                   # OmAgents skills and shared scripts
│   │   ├── hooks/                    # Host-independent Python environment code
│   │   └── mcp-servers/base.json
│   │
│   ├── opencode/                     # @omagents/omagents
│   │   ├── src/
│   │   │   ├── index.js              # V1 server + V2 setup descriptor
│   │   │   ├── parallel.js           # OpenCode lifecycle adapter
│   │   │   └── superpowers.js
│   │   └── bin/install.js            # No-argument OpenCode installer
│   │
│   ├── codex/                        # @omagents/omagents-codex
│   │   ├── src/
│   │   └── bin/install.js            # No-argument Codex installer
│   │
│   └── dsh/                          # @omagents/omagents-dsh
│       ├── src/host/                 # Typed DSH Host entry and adapters
│       ├── src/client/               # React native Web Job Board
│       ├── cordis.patch.yml
│       └── dist/                     # Published built Host and Client artifacts
│
├── .opencode/plugins/index.js         # Development-only thin re-export
├── tests/                            # Cross-package and release integration tests
└── .github/workflows/
```

The old root CLI dispatcher, root Codex installer, duplicated host-specific MCP condition logic, and monolithic host-independent sections of `parallel.js` are removed rather than retained as compatibility code. The development-only OpenCode entry re-exports the local package and contains no second implementation; the self-repo dedup guard remains effective.

Core, OpenCode, and Codex remain plain JavaScript with no product build step. DSH uses TypeScript for typed Host/Remote APIs and React for the Client. Its package `prepack` builds the published artifacts; user installation does not rely on a Git `prepare` script.

`@omagents/core` owns the pinned Superpowers dependency and bundled skill assets. Host adapters resolve those assets through Core rather than relying on accidental npm hoisting. The Superpowers commit remains pinned.

## Core Boundaries

Core contains no imports of OpenCode, Codex, DSH, Cordis, React, or host SDK packages.

### Job Board

Core provides:

- A Job Board aggregate with idempotent launch, terminal, cancellation, notification, recovery, and retention operations.
- Injected storage, clock, ID generation, and host task-query/cancellation interfaces.
- Ordered change notifications with a monotonically increasing revision.
- Host-neutral status serialization used by tools and remote services.
- Versioned, serialized, atomic persistence.
- No hardcoded OpenCode or DSH paths.

### Shared capabilities

Core also owns:

- The canonical MCP service catalog and environment-dependent selection logic. Host adapters only apply user precedence and serialize/register the resolved entries.
- Skill discovery, host tool-name mappings, and host-specific content overrides where shared wording is insufficient.
- Python base and project-overlay management, including cross-platform executable and PATH rules.
- Deep-research structured dispatch descriptions. Python output describes an action and its payload; host skill text translates that action into the correct native tool call.
- Shared loop-engine, research, conversion, scraping, and reporting assets.

## Job Model

Execution state and model-notification state are separate.

### Execution states

```text
running
cancelling
completed
failed
cancelled
interrupted
```

Allowed behavior:

- `running -> cancelling` only after a cancellation request is accepted.
- `running -> completed | failed | cancelled | interrupted` from authoritative host lifecycle or reconciliation information.
- `cancelling -> completed | failed | cancelled | interrupted` from authoritative host information.
- `completed`, `failed`, and `cancelled` are terminal and never regress.
- `interrupted` means the outcome could not be confirmed; it is not presented as successful completion.
- Cancellation is never reported as `cancelled` merely because an interrupt request was accepted.

### Notification states

Terminal or interrupted jobs carry one of:

```text
pending -> injected -> acknowledged
```

`pending` means the parent Agent still needs the outcome. `injected` records that the outcome entered parent context. `acknowledged` records completion of the parent-facing delivery flow. Viewing a job in the Web UI does not change either state.

Core records at least:

```text
id
host
hostTaskId
parentSessionId
childName (when supplied by the host)
alias
agent
description
executionState
notificationState (when an outcome needs delivery)
resultSummary or structured error
launchedAt
cancelRequestedAt (when applicable)
terminalAt (when applicable)
updatedAt
revision
```

OpenCode's legacy `error` and `reconciled` labels are adapter serializations of the Core model, not Core execution states.

### Change consumers

The same Core instance supplies:

- Parent-Agent context injection.
- `parallel_status` and `cancel_task`.
- `/ps` output.
- OpenCode TUI state.
- DSH Remote API and Web Job Board updates.

No consumer maintains an independent task database.

## Persistence and Recovery

### Storage

- Each host adapter injects its own storage root. OpenCode retains its established storage location; DSH resolves an OmAgents data directory beneath the active DSH profile/home.
- Data is schema-versioned and validated on load.
- Writes are serialized and use a temporary file followed by atomic replacement.
- Terminal transitions, notification transitions, and disposal flush immediately; high-frequency nonterminal updates may be coalesced.
- A corrupt file is preserved as a diagnostic backup before a clean Board is created. The error is surfaced through Host diagnostics and the DSH UI health state.
- Running, cancelling, and outcome-pending jobs are never evicted by history retention. Only bounded, acknowledged terminal history is eligible for cleanup.

### Restart reconciliation

Jobs persisted as `running` or `cancelling` are not automatically marked completed. Startup reconciliation asks the Host adapter for authoritative state:

- Still active: restore `running` or `cancelling`.
- Finished with a readable result: record the appropriate terminal state and outcome.
- Missing or unreadable: record `interrupted` with an explicit reason and a pending parent notification.

Already-terminal jobs with pending outcomes remain eligible for parent delivery after restart. Repeated lifecycle events and repeated completion notices are idempotent and do not produce duplicate injections.

Reconciliation occurs at startup, manual refresh, reconnection, and authoritative lifecycle events. There is no periodic running-job poll.

### Failure isolation

Skills, MCP, Python provisioning, parallel tracking, and UI registration report independent health. One capability failure must not silently claim overall success or prevent unrelated capabilities from loading. Context-injection failures are logged without breaking the model request. Persistence failures may continue in memory only with a visible degraded-health warning.

## Host Adapters

### OpenCode

- Preserve the default `{ id, server, setup }` descriptor and the V1/V2 entry behavior.
- Preserve V1 `task(background: true)` and V2 `subagent(..., background: true)` tool semantics.
- Replace the current global maps and Host-specific persistence inside `parallel.js` with Core plus OpenCode launch/result/event/cancel adapters.
- Preserve existing parent-context, compaction, `/ps`, TUI, and cancellation behavior while mapping to the richer Core state model.
- Keep the self-repo dedup guard and development entry behavior.

### Codex

- Move the installer, hooks generation, skills handling, and MCP serialization into `@omagents/omagents-codex`.
- Remove the old OpenCode CLI Codex branch and its documentation.
- Continue using Codex-native subagents rather than adding the OpenCode parallel engine.
- Reuse Core skills, MCP resolution, and Python environment logic.

### DSH Host

- Use a supported package-root function-plugin surface with named `name`, `inject`, configuration, and `apply` exports and no default export.
- Use DSH-native asynchronous `subagent` semantics; do not add a `background` argument.
- Track tool calls/results and authoritative child lifecycle events, retaining child name and child/session identity where available.
- Register `parallel_status`, `cancel_task`, and a direct human `/ps` command against the same Core Board.
- Inject DSH-specific parallel instructions and parent outcomes without duplicate notices.
- Map DSH compaction, context, tool, and session extension points in the DSH adapter only.
- Register the canonical MCP entries through DSH configuration or `ctx.mcpManager.register`, respecting existing user configuration.

### DSH cancellation semantics

- Local child interruption stops the current turn; descendants continue unless separately cancelled.
- Local children may remain continuable through native DSH behavior, but OmAgents does not add a new resume feature in this release.
- External one-shot children stop permanently and cannot receive follow-ups.
- UI and tool responses state these constraints accurately.

## DSH Native Web Job Board

### Package surface

`@omagents/omagents-dsh` declares:

- A bare package-root Host Loader row in `cordis.patch.yml`.
- `dsh.bundle.patch` and a tested `engines.dsh` compatibility range.
- `dsh.client` for the Web platform.
- A built `./client` export in DSH's lazy-CJS factory format.

The Client is attached to the package-root row and disappears cleanly when that row is disabled.

### Remote API and events

A Host Remote service exposes authorized operations equivalent to:

```text
listJobs(profile/session scope)
watchJobs(profile/session scope, signal): stream of whole-set revisioned frames
cancelJob(job id)
getHealth()
```

`watchJobs` uses `@Remote({ mode: 'stream' })` and yields one complete baseline followed by whole-set frames after Core changes. This avoids modifying DSH's application-owned forwarded-event allowlist while preserving push-based updates. The browser consumes the stream directly, uses `listJobs` only for manual refresh, and opens a fresh baseline stream after reconnection. Elapsed-time rendering may tick locally without network requests.

Remote results distinguish success from structured failure. The API filters jobs according to the active DSH profile/session and remote-access rules; it must not expose unrelated profiles or unauthorized parent sessions.

### Presentation

The Client registers:

- An OmAgents item in `sidebar.panellist`.
- A corresponding keyed `main` panel.

The panel provides:

- All, running, attention-required, and finished filters.
- Status, task, agent, elapsed time, notification state, start time, and actions.
- Result/error details and parent/child identity.
- Cancellation confirmation and a non-repeatable `cancelling` state.
- Empty, loading, stale/disconnected, permission-denied, and degraded-health states.

The UI uses React components registered through DSH slots, DSH theme tokens, and plugin-owned controls/styles. It does not use an iframe, direct DOM injection, or private Host UI internals. Viewing details never acknowledges a model notification.

## Skills, Superpowers, MCP, and Python on DSH

- All 18 OmAgents skills and 15 Superpowers skills are discovered through DSH-supported skill providers or packaged skill roots.
- Shared skills use a host tool map. Content with materially different control flow uses an explicit host variant rather than textual search-and-replace at load time.
- DSH dispatch instructions use native `subagent` without `background`; OpenCode V1/V2 and Codex retain their respective native forms.
- `deep-research`, `hyperplan`, `parallel-execution`, `doctor`, and `lsp-guide` receive explicit DSH validation and any required variants.
- Superpowers file-based skills are reused, while DSH bootstrap/tool mapping is implemented explicitly rather than invoking the OpenCode plugin setup.
- Python base provisioning runs during DSH plugin setup without blocking startup. Project overlays remain on demand.
- Shell PATH injection and script discovery use DSH extension points or absolute resolved script paths; no bare-command availability is assumed without an integration test.
- Only `jinja2` is automatically provisioned in the persistent base; all other Python tools remain on demand.

## Testing Strategy

### Core unit tests

Cover:

1. Every allowed and rejected execution transition.
2. Sticky terminal states and idempotent repeated events.
3. Independent execution and notification transitions.
4. Cancellation acceptance versus confirmed termination.
5. Restart reconciliation for active, terminal, missing, and unreadable jobs.
6. Pending-outcome recovery without duplicate injection.
7. Atomic writes, schema validation, corrupt-file backup, flush, and bounded retention.
8. Cross-platform storage paths and injected host behavior.
9. MCP environment selection and user-precedence inputs.
10. Host-specific skill rendering and structured research dispatch.

### Host contract and regression tests

- Preserve and extend OpenCode V1/V2 fake-host and full lifecycle tests.
- Test the Codex no-argument installer, package contents, hooks, skills, MCP, and absence of the old dispatcher.
- Drive the real DSH Loader/export path in CI without requiring a model API key.
- Use deterministic DSH model/subagent backends for launch, completion, failure, cancellation, restart, and recovery tests.
- Verify real MCP stdio and streamable-HTTP handshakes against local test servers.
- Test DSH Remote authorization, structured errors, baseline/watch stream frames, cancellation, disposal, and reconnect streams.

### UI and end-to-end tests

Component and browser tests cover initial loading, filters, details, all execution/notification states, cancellation confirmation, repeated-click prevention, stale state, reconnect, errors, empty state, and light/dark themes.

Release-candidate end-to-end verification must:

1. Install all products from packed tarballs into isolated host homes/profiles.
2. Start multiple DSH subagents and observe consistent Core, `/ps`, tool, and Web states.
3. Deliver each completion to the parent exactly once.
4. Exercise local and external cancellation semantics without false terminal claims.
5. Restart DSH and recover active and pending-outcome jobs.
6. Disconnect and reconnect the Web Client.
7. Run representative deep-research and hyperplan workflows concurrently and through recovery.
8. Verify all skills are discovered and no wrong-host tool instructions leak.
9. Run OpenCode V1/V2 and Codex regressions.
10. Run unit/package checks on Linux, macOS, and Windows, with DSH browser integration on supported CI platforms.

CI uses deterministic backends and local services, not external model credentials.

## Documentation Impact

Update in the same change:

- `README.md`, `README.zh-cn.md`, `README.ja.md`, and `README.ko.md` with the three installation commands and complete support matrix.
- Root and affected package `AGENTS.md` files for the workspace, Core boundaries, DSH build, testing, and publishing.
- `CHANGELOG.md` with the package restructuring, Codex installer move, and full DSH product.
- `CONTRIBUTING.md` with workspace development and package-specific checks.
- DSH installation, Web Job Board, cancellation, recovery, security, and troubleshooting documentation.
- CI and release documentation, including trusted publishing and artifact verification.

No documentation may describe the old Codex command as a supported path or claim that optional Python tools are pre-installed.

## Build and Release

1. Keep the repository root private and configure workspaces for Core and the three host packages.
2. Use one aligned version for all four packages on every release. Build, test, pack, and publish all four together under one release tag, including when a change touches only one host, so there is exactly one supported four-package compatibility combination per release.
3. Build DSH Host and Client artifacts before packing.
4. Inspect every tarball and install from those tarballs in isolated environments before publishing.
5. Configure npm OIDC Trusted Publishing for `@omagents/core`, `@omagents/omagents-codex`, and `@omagents/omagents-dsh`; retain it for `@omagents/omagents`.
6. Publish Core first. Once that exact Core version is available in the registry, publish OpenCode, Codex, and DSH. The three host packages depend only on Core, not on one another; the release workflow publishes them sequentially as OpenCode, Codex, then DSH for deterministic logs and failure handling, not because of host-to-host dependencies.
7. Declare only the DSH compatibility range exercised by release tests; do not claim untested future DSH versions.
8. Create the GitHub release and add the `dsh-plugin` repository topic.
9. Share the complete release through the official DSH GitHub Discussions plugin channel and Discord.
10. Treat a custom static plugin index as an optional later distribution aid, not an official DeepSeek certification or a release prerequisite.

## Implementation Sequence

Implementation may use internal milestones, but none is publicly presented as a complete DSH release:

1. Establish the workspace and package manifests while preserving a runnable OpenCode development entry.
2. Extract Core state, persistence, MCP, skills, and Python behavior behind characterization tests.
3. Move OpenCode to its package and complete V1/V2 regression coverage.
4. Move Codex to its package and delete the old dispatcher and duplicated implementation.
5. Implement DSH packaging, Host setup, skills, MCP, and Python integration.
6. Implement DSH subagent lifecycle, cancellation, context, tools, `/ps`, and recovery through Core.
7. Implement the Remote API and native Web Job Board.
8. Complete all skill variants, Superpowers bootstrap, deep-research, and hyperplan behavior.
9. Complete real Loader, UI, workflow, restart, cross-platform, and packed-artifact verification.
10. Synchronize documentation and execute the four-package release only after every acceptance criterion passes.

## Acceptance Criteria

- The three documented installation commands install only the intended host product and its shared dependencies.
- No runtime host detection or Codex compatibility dispatcher remains.
- OpenCode V1/V2 behavior and tests remain healthy after Core extraction.
- Codex installs exclusively from `@omagents/omagents-codex` with no legacy path.
- DSH loads through its real package-root Loader and serves its native Web Client.
- All bundled skills are available with correct DSH tool semantics.
- DSH launch, completion, failure, cancellation, restart, recovery, tools, `/ps`, and Web state use one Core Board.
- Cancellation and restart never fabricate success or confirmed termination.
- Web updates are event-driven with reconnect synchronization and no periodic running-job polling.
- Deep-research and hyperplan complete representative concurrent and recovery scenarios on DSH.
- All four packages can be packed and installed without user-side source builds.
- All automated and real end-to-end release checks pass.
- All required documentation and translations are synchronized before the community announcement.
