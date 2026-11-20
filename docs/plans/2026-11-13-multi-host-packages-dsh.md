# Multi-Host Packages and Full DeepSeek Harness Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure OmAgents into Core plus explicit OpenCode, Codex, and DSH packages, and ship complete DSH parallel execution with durable recovery and a native Web Job Board.

**Architecture:** A host-neutral `@omagents/core` owns the Job Board, persistence, skills, MCP resolution, Python environments, and workflow assets. Three host packages depend only on Core; DSH uses a supported package-root Host export, a Typert Remote stream, and a React Client attached to the root Loader row.

**Tech Stack:** Node.js 24, ESM, npm workspaces, JavaScript, TypeScript, React, DSH Cordis/Typert APIs, Node test runner, Playwright, Python 3.11+, npm OIDC Trusted Publishing.

**Spec:** `docs/specs/2026-11-13-multi-host-packages-dsh-design.md`

## Global Constraints

- User installs are exactly `npx @omagents/omagents`, `npx @omagents/omagents-codex`, and `dsh plugin --profile web add @omagents/omagents-dsh`.
- No runtime host detection and no Codex compatibility dispatcher, alias, or migration shim.
- No public partial DSH release; all 18 OmAgents and 15 Superpowers skills must work with correct host semantics.
- Core imports no OpenCode, Codex, DSH, Cordis, React, or host SDK package.
- DSH uses native `subagent` without `background`; OpenCode V1/V2 retain their existing background arguments.
- Cancellation acknowledgement is not confirmed termination; Web reads never acknowledge model notifications.
- No periodic running-job polling and no modification of DSH's application-owned forwarded-event allowlist.
- DSH UI updates use `@Remote({ mode: 'stream' }) watchJobs()` whole-set frames with a baseline on every new stream.
- Preserve the Superpowers commit pin; only `jinja2` is provisioned automatically in the Python base.
- Support Linux, macOS, and Windows paths and executable conventions; DSH users never run source builds.
- Every release uses one aligned version for Core and all three hosts; publish Core before the host packages.
- Update EN, ZH-CN, JA, and KO documentation together, plus affected AGENTS.md files.
- Commit steps are checkpoints only: request explicit user authorization immediately before every Git add/commit; never commit automatically.

## Review Focus

1. **Real DSH module/package loading:** a named-export Host or root-row Client can pass unit tests but fail in the actual Loader; Tasks 8, 13, and 15 test the real Loader and packed artifact.
2. **Baseline/stream races:** a Core change between stream creation and listener attachment must not be lost; Task 12 tests synchronous listener attachment and revisioned whole-set frames.
3. **Restart and ambiguous outcomes:** missing children, corrupt JSON, and duplicate completion events must produce recovery or `interrupted`, never false success; Tasks 3, 4, and 11 pin these cases.
4. **Cancellation semantics:** an accepted interrupt may leave a local child or its descendants active; Tasks 11 and 15 verify `cancelling` until authoritative settlement.
5. **Packed installs without hoisting or source builds:** Core assets, Superpowers, Windows executables, and DSH Client output must resolve from tarballs in clean homes; Task 15 performs the clean-room checks.

---

### Task 1: Workspace and Standalone OpenCode Package

**Files:**
- Modify: `package.json`, `package-lock.json`, `.opencode/plugins/index.js`
- Move: `.opencode/plugins/index.js`, `.opencode/plugins/parallel.js` to `packages/opencode/src/`
- Move: `setup/opencode.js` to `packages/opencode/bin/install.js`
- Create: `packages/opencode/package.json`, `tests/workspace.test.js`, `tests/opencode-cli.test.js`
- Modify: `tests/plugin.test.js`, `tests/plugin-v2.test.js` imports only

**Interfaces:**
- Produces: `@omagents/omagents` with `main: src/index.js`, `bin.omagents: bin/install.js`, and the unchanged default `{ id, server, setup }` descriptor.
- Produces: root development `.opencode/plugins/index.js` as only a re-export of `../../packages/opencode/src/index.js`.

- [ ] **Step 1: Write failing package and no-argument CLI tests**

```js
test('workspace exposes the three intended package identities', () => {
  assert.equal(readJson('package.json').private, true)
  assert.equal(readJson('packages/opencode/package.json').name, '@omagents/omagents')
})
test('OpenCode CLI installs with no host argument', async () => {
  await runCli('packages/opencode/bin/install.js', [], { cwd: tempProject, home: tempHome })
  assert.equal(readJson(`${tempProject}/opencode.json`).plugin.includes('@omagents/omagents'), true)
})
```

- [ ] **Step 2: Verify the new tests fail for missing package/default behavior**

Run: `node --test tests/workspace.test.js tests/opencode-cli.test.js`
Expected: FAIL because the workspace package and no-argument installer do not exist.

- [ ] **Step 3: Create the workspace and move OpenCode without changing runtime behavior**

Make the root private with `workspaces: ["packages/*"]`. Move both OpenCode plugin modules together, correct their asset-root calculation to the repository root during development, and leave the root development entry as a thin re-export. The new CLI retains its shebang/executable mode, accepts no positional host argument, handles `--help/--version`, and rejects unknown arguments.

- [ ] **Step 4: Regenerate the lockfile and run all regression tests**

Run: `npm install && node --test tests/*.test.js`
Expected: the new tests and the existing 90-test baseline PASS; no root parallel plugin is auto-discovered.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `refactor: create workspace and standalone OpenCode package`

### Task 2: Core Job Board State Machine and Presenters

**Files:**
- Create: `packages/core/package.json`, `packages/core/src/index.js`
- Create: `packages/core/src/job-board/job-board.js`, `packages/core/src/job-board/records.js`, `packages/core/src/job-board/presenters.js`
- Create: `packages/core/test/job-board.test.js`, `packages/core/test/presenters.test.js`

**Interfaces:**
- Produces: `new JobBoard({ clock, idGenerator })`.
- Produces: `registerLaunch({ host, hostTaskId, parentSessionId, childName?, agent, description }) -> JobRecord`.
- Produces: `requestCancellation(idOrAlias)`, `markTerminal(idOrAlias, { state, resultSummary?, error? })`, `markInjected(ids)`, `acknowledgeInjected(parentSessionId)`.
- Produces: `get(idOrAlias)`, `list({ parentSessionId? } = {})`, `listPendingOutcomes(parentSessionId)`, `subscribe(listener: ({ revision, jobId? }) => void): () => void`, and `revision`.
- Produces: `buildParallelStatus(board, scope?)`, `buildJobBoardContext(board, parentSessionId)`, and `buildPsText(board, scope?)`.
- `markTerminal.state` is exactly `completed | failed | cancelled | interrupted`; terminal outcomes begin with `notificationState: "pending"`.

- [ ] **Step 1: Write failing transition and presenter tests**

```js
test('accepted cancellation is not confirmed cancellation', () => {
  const job = board.registerLaunch(launch)
  board.requestCancellation(job.id)
  assert.equal(job.executionState, 'cancelling')
  assert.equal(job.notificationState, undefined)
})
test('terminal outcomes are sticky and independently delivered', () => {
  board.markTerminal(job.id, { state: 'completed', resultSummary: 'done' })
  board.markTerminal(job.id, { state: 'failed', error: 'late failure' })
  board.markInjected([job.id])
  board.acknowledgeInjected(job.parentSessionId)
  assert.equal(job.executionState, 'completed')
  assert.equal(job.notificationState, 'acknowledged')
})
```

Also assert unknown IDs, invalid transitions, aliases, duplicate launches, revision increments, listener disposal, pending-outcome context, and `/ps` empty output.

- [ ] **Step 2: Run Core tests and verify failure**

Run: `node --test packages/core/test/job-board.test.js packages/core/test/presenters.test.js`
Expected: FAIL because `@omagents/core` and its Job Board do not exist.

- [ ] **Step 3: Implement the pure in-memory aggregate and presenters**

Use a `Map` keyed by Core `id`, a second host/hostTaskId index, immutable terminal states, injected clock/IDs, and synchronous ordered listeners. Presenters contain no host imports or file I/O.

- [ ] **Step 4: Run Core tests**

Run: `node --test packages/core/test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `feat(core): add host-neutral Job Board state machine`

### Task 3: Atomic Persistence and Restart Reconciliation

**Files:**
- Create: `packages/core/src/storage/json-job-store.js`, `packages/core/src/storage/schema.js`
- Modify: `packages/core/src/job-board/job-board.js`, `packages/core/src/index.js`
- Create: `packages/core/test/json-job-store.test.js`, `packages/core/test/recovery.test.js`

**Interfaces:**
- Produces: `new JsonJobStore({ filePath, clock })` with `load()`, `save(snapshot)`, `flush()`, and `close()`.
- Produces: `JobBoard.open({ store, clock, idGenerator }) -> Promise<JobBoard>`.
- Produces: `board.reconcile({ query(job) })`, where `query` returns `{ kind: 'active' }`, `{ kind: 'terminal', state, resultSummary?, error? }`, or `{ kind: 'missing' | 'unreadable', reason }`.
- Snapshot shape: `{ version: 1, revision: number, jobs: JobRecord[] }`.

- [ ] **Step 1: Write failing persistence and recovery tests**

```js
test('missing child after restart becomes interrupted, not completed', async () => {
  const board = await JobBoard.open({ store, clock: fixedClock, idGenerator })
  await board.reconcile({ query: async () => ({ kind: 'missing', reason: 'host session not found' }) })
  assert.equal(board.list()[0].executionState, 'interrupted')
  assert.equal(board.list()[0].notificationState, 'pending')
})
```

Add assertions for atomic replacement, concurrent `save` serialization, immediate terminal flush, malformed schema, corrupt-file `.corrupt-<timestamp>` backup, duplicate recovered notices, active/terminal/missing/unreadable queries, and retention that never evicts active or pending jobs.

- [ ] **Step 2: Verify persistence tests fail**

Run: `node --test packages/core/test/json-job-store.test.js packages/core/test/recovery.test.js`
Expected: FAIL because storage and reconciliation are absent.

- [ ] **Step 3: Implement versioned storage and recovery**

Serialize writes through one promise chain, write in the same directory, atomically replace the target, preserve corrupt input, and validate every restored record. Reconcile through the injected query only; do not poll or infer success from age.

- [ ] **Step 4: Run all Core tests**

Run: `node --test packages/core/test/*.test.js`
Expected: PASS, including no unresolved write promises after `close()`.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `feat(core): persist and reconcile background jobs`

### Task 4: Migrate OpenCode Parallel Execution to Core

**Files:**
- Modify: `packages/opencode/src/parallel.js`, `packages/opencode/src/index.js`
- Create: `packages/opencode/src/job-store-paths.js`, `packages/opencode/src/job-presenters.js`
- Modify: `tests/plugin-v2.test.js`, `tests/plugin.test.js`
- Create: `tests/opencode-recovery.test.js`

**Interfaces:**
- Consumes: Tasks 2–3 `JobBoard`, `JsonJobStore`, and presenters.
- Produces: `createParallelHooks(ctx)` and `setupParallelV2(ctx)` with their existing public shapes, backed by one injected Board per Host process.
- Preserves: OpenCode V1 `task(background: true)`, V2 `subagent(..., background: true)`, `/ps`, TUI state, compaction note, and `cancel_task` argument shape.

- [ ] **Step 1: Add failing Core-backed lifecycle and recovery tests**

```js
test('V2 cancellation waits for authoritative lifecycle settlement', async () => {
  await callCancelTask(job.alias)
  assert.equal(readBoardJob(job.id).executionState, 'cancelling')
  await emitSessionInterrupted(job.hostTaskId)
  assert.equal(readBoardJob(job.id).executionState, 'cancelled')
})
```

Add V1/V2 duplicate completion, restart with running records, legacy `error/reconciled` serialization, pending-outcome recovery, corrupt-store diagnostics, and unchanged context sentinel tests.

- [ ] **Step 2: Verify the new tests fail against the legacy global-map implementation**

Run: `node --test tests/plugin-v2.test.js tests/opencode-recovery.test.js`
Expected: FAIL on confirmed cancellation and restart behavior.

- [ ] **Step 3: Replace Core-owned logic in the OpenCode adapter**

Keep only pending tool-call correlation, host event parsing, session interruption, shell environment, TUI projection, and hook registration in the OpenCode package. Inject the established OpenCode storage path into `JsonJobStore`; map Core `failed` to legacy `error` and acknowledged outcomes to legacy `reconciled` only at the adapter boundary.

- [ ] **Step 4: Run the complete suite**

Run: `node --test tests/*.test.js packages/core/test/*.test.js`
Expected: PASS; no `jobBoard = new Map()` or Core-independent persistence remains in `parallel.js`.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `refactor(opencode): back parallel execution with shared Core`

### Task 5: Canonical MCP Resolution in Core

**Files:**
- Move: `mcp-servers/base.json` to `packages/core/mcp-servers/base.json`
- Create: `packages/core/src/mcp/resolve-servers.js`, `packages/core/test/mcp.test.js`
- Modify: `packages/opencode/src/index.js` to consume the resolver

**Interfaces:**
- Produces: `resolveMcpServers({ env = process.env } = {}) -> Record<string, CanonicalMcpServer>`.
- Preserves: local Context7 with optional `CONTEXT7_API_KEY`, hosted Exa with optional `x-api-key`, GitHub when `GITHUB_TOKEN` exists, otherwise `grep_app`.

- [ ] **Step 1: Write the environment-matrix contract tests**

```js
test('hosted Exa remains remote and uses x-api-key only when configured', () => {
  assert.deepEqual(resolveMcpServers({ env: { EXA_API_KEY: 'secret' } }).websearch.headers,
    { 'x-api-key': 'secret' })
})
```

Pin all four GitHub/Exa combinations, Context7 with/without its key, no mutation of `process.env`, and user-config precedence remaining in the host adapter.

- [ ] **Step 2: Verify tests fail before extraction**

Run: `node --test packages/core/test/mcp.test.js`
Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Move the catalog and centralize conditionals**

Return canonical stdio/HTTP data only. Keep OpenCode V1 `enabled` and V2 startup-timeout serialization in the OpenCode adapter.

- [ ] **Step 4: Run MCP and OpenCode tests**

Run: `node --test packages/core/test/mcp.test.js tests/plugin.test.js tests/plugin-v2.test.js`
Expected: PASS.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `refactor(core): centralize MCP server resolution`

### Task 6: Move Skills, Superpowers Assets, and Python Management to Core

**Files:**
- Move: `skills/` to `packages/core/skills/`
- Move: `hooks/python-env.js`, `hooks/project-venv.js`, `hooks/setup-venv.js` to `packages/core/hooks/`
- Create: `packages/core/src/paths.js`, `packages/core/src/skills/catalog.js`, `packages/core/src/skills/render.js`
- Modify: `packages/opencode/src/index.js`, `packages/core/package.json`, `package-lock.json`
- Modify: `tests/skills.test.js`, `tests/python-env.test.js`, `tests/deep-research.test.js`, `tests/loop_engine.test.js`

**Interfaces:**
- Produces: `getCorePaths() -> { root, skillsDir, superpowersDir, hooksDir, mcpCatalogPath }` using `import.meta.url`, never npm hoisting assumptions.
- Produces: `listSkillDefinitions({ host })` and `renderSkillForHost(definition, host)` for `opencode-v1 | opencode-v2 | codex | dsh`; `SKILL.md` is the shared fallback and `SKILL.<host>.md` is an explicit full-content override.
- Preserves: all existing Python exported functions and CLI exit/stdout behavior.

- [ ] **Step 1: Write failing package-asset and host-rendering tests**

```js
test('Core resolves every packaged asset without repository-relative paths', () => {
  const paths = getCorePaths()
  assert.equal(existsSync(`${paths.skillsDir}/deep-research/SKILL.md`), true)
  assert.equal(existsSync(`${paths.superpowersDir}/skills/brainstorming/SKILL.md`), true)
})
test('DSH parallel skill never contains the OpenCode background argument', () => {
  const definition = listSkillDefinitions({ host: 'dsh' }).find(s => s.name === 'parallel-execution')
  assert.doesNotMatch(renderSkillForHost(definition, 'dsh').content, /background:\s*true/)
})
```

- [ ] **Step 2: Verify asset tests fail before the move**

Run: `node --test tests/skills.test.js tests/python-env.test.js`
Expected: FAIL on the new Core path/render imports.

- [ ] **Step 3: Move assets and adapt imports without changing Python behavior**

Move the pinned Superpowers dependency and `bundledDependencies` declaration to Core. Preserve the commit SHA. Keep host-specific skill variants explicit; shared templates use the four named host keys, not free-form detection.

- [ ] **Step 4: Run all asset, workflow, and OpenCode tests**

Run: `node --test tests/*.test.js packages/core/test/*.test.js`
Expected: PASS, including 11 Python layout tests and real overlay tests.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `refactor(core): share skills Superpowers and Python assets`

### Task 7: Standalone Codex Package and Removal of Old Dispatcher

**Files:**
- Move: `.codex/plugins/setup.js` to `packages/codex/src/setup.js`
- Create: `packages/codex/package.json`, `packages/codex/bin/install.js`, `packages/codex/test/installer.test.js`
- Delete: root `index.js`, obsolete root `setup/`, `.codex/`, and old dispatcher tests
- Modify: `tests/codex-python-env.test.js`, `package-lock.json`

**Interfaces:**
- Produces: `@omagents/omagents-codex` with `bin.omagents-codex: bin/install.js`.
- Preserves: `installCodex(options?)` installation artifacts, now resolving all shared assets through `getCorePaths()`.

- [ ] **Step 1: Write failing standalone installer and clean-tree tests**

```js
test('Codex package installs with no arguments', async () => {
  await runCli('packages/codex/bin/install.js', [], { cwd: tempProject, home: tempHome })
  const pluginRoot = await findInstalledCodexPlugin(tempHome)
  assert.equal(existsSync(`${pluginRoot}/hooks/hooks.json`), true)
})
test('old OpenCode-to-Codex dispatcher is gone', () => {
  assert.equal(existsSync('index.js'), false)
  assert.equal(existsSync('.codex/plugins/setup.js'), false)
})
```

- [ ] **Step 2: Verify standalone package tests fail**

Run: `node --test packages/codex/test/installer.test.js tests/codex-python-env.test.js`
Expected: FAIL because the package/bin is absent.

- [ ] **Step 3: Move Codex and delete the old implementation**

Do not retain an alias, fallback, deprecation wrapper, or root CLI. Preserve the new bin's shebang/executable mode. Use Core MCP and skill rendering rather than duplicating conditional logic.

- [ ] **Step 4: Run Codex and full regression tests**

Run: `node --test packages/codex/test/*.test.js tests/*.test.js packages/core/test/*.test.js`
Expected: PASS; no reference to `npx @omagents/omagents codex` remains in executable code.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `refactor(codex): publish a standalone installer package`

### Task 8: DSH Bundle Surface and Real Loader Smoke Test

**Files:**
- Create: `packages/dsh/package.json`, `packages/dsh/tsconfig.json`, `packages/dsh/cordis.patch.yml`
- Create: `packages/dsh/src/host/index.ts`, `packages/dsh/src/host/runtime.ts`, `packages/dsh/src/host/health.ts`
- Create: `packages/dsh/test/loader.test.ts`, `packages/dsh/test/package-surface.test.js`

**Interfaces:**
- Produces: named Host exports `name = "omagents"`, `inject`, and `apply(ctx): Promise<void>`; no default export.
- Produces: `createDshRuntime(ctx) -> Promise<{ board, health, dispose() }>`.
- Produces: a root `cordis.patch.yml` row named `@omagents/omagents-dsh`, plus `dsh.bundle.patch` and a release-tested `engines.dsh` range.

- [ ] **Step 1: Write failing export and real Loader tests**

```ts
test('real Loader starts the package-root Host entry', async () => {
  const root = await createTestLoaderWithRequiredServices()
  const id = await root.loader.create({ name: '@omagents/omagents-dsh' })
  await root.loader.await()
  assert.equal(root.loader.get(id).disabled, false)
})
```

Use `Context` plus DSH's Loader with `baseUrl`, not a hand-invoked `apply`. Assert the module has no `default`, the patch uses the bare package name, and required test services are explicit fakes.

- [ ] **Step 2: Verify Loader tests fail**

Run: `npm test --workspace @omagents/omagents-dsh -- loader`
Expected: FAIL because the DSH bundle does not exist.

- [ ] **Step 3: Implement the minimal runtime and bundle surface**

Open the DSH-profile `JsonJobStore`, expose independent health records, and make disposal flush/close the Board. Keep Client declarations out until Task 13 supplies the actual built Client.

- [ ] **Step 4: Build and run DSH smoke tests**

Run: `npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh`
Expected: PASS through the real Loader with no model API key.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `feat(dsh): add loadable Host bundle and runtime`

### Task 9: DSH Skills, MCP, and Python Integration

**Files:**
- Create: `packages/dsh/src/host/register-skills.ts`, `packages/dsh/src/host/register-mcp.ts`, `packages/dsh/src/host/register-python.ts`
- Modify: `packages/dsh/src/host/index.ts`, `packages/dsh/src/host/health.ts`
- Create: `packages/dsh/test/skills.test.ts`, `packages/dsh/test/mcp.test.ts`, `packages/dsh/test/python.test.ts`

**Interfaces:**
- Consumes: `listSkillDefinitions({ host: 'dsh' })`, `renderSkillForHost`, `resolveMcpServers`, and Core Python functions.
- Produces: `registerDshSkills(ctx, health)`, `registerDshMcp(ctx, env, health)`, and `provisionDshPython(ctx, health): void` with nonblocking provisioning and disposal-safe completion.

- [ ] **Step 1: Write failing capability registration tests**

```ts
test('DSH registers all bundled skills with native subagent semantics', () => {
  registerDshSkills(ctx, health)
  assert.equal(ctx.skills.registrations.length, 33)
  const parallel = ctx.skills.registrations.find(s => s.name === 'parallel-execution')
  assert.doesNotMatch(parallel.content, /background:\s*true/)
})
```

Add MCP registration/no-override tests, stdio and streamable-HTTP local handshakes, nonblocking Python setup, absolute script resource paths, independent failure health, and automatic installation of only `jinja2`.

- [ ] **Step 2: Verify capability tests fail**

Run: `npm test --workspace @omagents/omagents-dsh -- skills mcp python`
Expected: FAIL because registrars are absent.

- [ ] **Step 3: Implement capability adapters**

Use `ctx.skills.register()` with `resourceBase`, `ctx.mcpManager.register()` after checking existing names, and Core provisioning at plugin setup. Return/compose disposers so plugin teardown invalidates skill discovery and withdraws MCP registrations.

- [ ] **Step 4: Run DSH and Core tests**

Run: `npm test --workspace @omagents/omagents-dsh && node --test packages/core/test/*.test.js`
Expected: PASS; exactly 33 skills are present and health failures are visible.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `feat(dsh): register skills MCP and Python environments`

### Task 10: DSH Status Tool, Commands, and Compaction-Safe Context

**Files:**
- Create: `packages/dsh/src/host/register-tools.ts`, `packages/dsh/src/host/register-commands.ts`, `packages/dsh/src/host/register-context.ts`
- Create: `packages/dsh/src/host/prompt.ts`
- Modify: `packages/dsh/src/host/index.ts`
- Create: `packages/dsh/test/tools.test.ts`, `packages/dsh/test/context.test.ts`

**Interfaces:**
- Produces: `registerDshTools(ctx, board)` using `defineTool` for read-only `parallel_status`; Task 11 extends the registration with the cancellation controller.
- Produces: `registerDshCommands(ctx, board)` using `ctx.commands.register({ name: 'ps', ... })` and returning direct command success text.
- Produces: `registerDshContext(ctx, board)` using `ctx.systemPrompt.section/context`; the dynamic state-preservation note and Board survive session compaction because they are not stored only in compactable history.

- [ ] **Step 1: Write failing tool and prompt tests**

```ts
test('/ps reads the Board directly without creating a model message', async () => {
  const result = await ctx.commands.find(agent, 'ps').handler({ agent, rawInput: '' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /Alias/)
  assert.equal(agent.promptCalls.length, 0)
})
```

Add tool schema/invalid-input tests, duplicate-prompt suppression, pending/running context, compaction-safe note assembly, and context-failure diagnostics.

- [ ] **Step 2: Verify tests fail**

Run: `npm test --workspace @omagents/omagents-dsh -- tools context`
Expected: FAIL because the registrars are absent.

- [ ] **Step 3: Implement tools, command, and dynamic prompt contributions**

Return canonical JSON from tools and render text through DSH's output declaration. Keep the DSH prompt free of OpenCode tool names and `background` arguments.

- [ ] **Step 4: Run DSH tests**

Run: `npm test --workspace @omagents/omagents-dsh`
Expected: PASS.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `feat(dsh): add status tools ps command and durable context`

### Task 11: Complete DSH Subagent Lifecycle and Cancellation

**Files:**
- Create: `packages/dsh/src/host/subagent-tracker.ts`, `packages/dsh/src/host/subagent-queries.ts`
- Modify: `packages/dsh/src/host/index.ts`, `packages/dsh/src/host/register-tools.ts`
- Create: `packages/dsh/test/subagent-lifecycle.test.ts`, `packages/dsh/test/subagent-recovery.test.ts`

**Interfaces:**
- Produces: `createSubagentTracker(ctx, board) -> { query(job), cancel(job): Promise<void>, dispose() }`.
- Extends: `registerDshTools(ctx, board, tracker)` with `cancel_task`; unknown, already-terminal, and repeated-cancellation requests return the current Board state without duplicate Host interrupts.
- Observes: `tools/result` for native `subagent` call metadata, `subagent/start` with `SubagentRunInfo`, and `subagent/end` with `SubagentRunEndInfo`.
- Cancels: `ctx.subagents.interruptByUser(hostTaskId)` and treats its receipt only as permission to enter `cancelling`.

- [ ] **Step 1: Write failing lifecycle and cancellation tests**

```ts
test('interrupt receipt does not mark a local child cancelled before subagent/end', async () => {
  await tracker.cancel(job)
  assert.equal(job.executionState, 'cancelling')
  emitSubagentEnd({ id: job.hostTaskId, outcome: 'cancelled' })
  assert.equal(job.executionState, 'cancelled')
})
```

Cover tool-result/start correlation by parent and child name, success/error/cancelled outcomes, duplicate end events, missed completion recovery, external one-shot termination, descendants continuing after local interruption, repeated cancellation, and tracker disposal.

- [ ] **Step 2: Verify lifecycle tests fail**

Run: `npm test --workspace @omagents/omagents-dsh -- subagent`
Expected: FAIL because tracking is absent.

- [ ] **Step 3: Implement the event adapter and authoritative queries**

Use typed DSH events, not SDK wire notifications. Keep pending tool metadata only in the adapter. Reconcile from live Agents/readable results when possible and otherwise return `missing/unreadable` to Core. Never infer terminal success from inactivity.

- [ ] **Step 4: Run DSH and Core recovery tests**

Run: `npm test --workspace @omagents/omagents-dsh && node --test packages/core/test/recovery.test.js`
Expected: PASS; no completion is injected twice.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `feat(dsh): track and cancel native subagent lifecycles`

### Task 12: Authorized Remote API and Race-Free Watch Stream

**Files:**
- Create: `packages/dsh/src/host/remote-service.ts`, `packages/dsh/src/host/remote-types.ts`, `packages/dsh/src/host/remote-access.ts`
- Modify: `packages/dsh/src/host/index.ts`
- Create: `packages/dsh/test/remote-service.test.ts`, `packages/dsh/test/watch-stream.test.ts`

**Interfaces:**
- Produces: `new OmAgentsRemote(ctx, { board, tracker, health, authorizeScope })` extending `TypertRemoteService` with `listJobs(scope): Promise<JobDto[]>`, `cancelJob(jobId): Promise<JobDto>`, and `getHealth(): HealthDto` Remote methods.
- Produces: `@Remote({ mode: 'stream' }) watchJobs(scope, signal): AsyncIterable<{ revision: number, jobs: JobDto[] }>`.
- `JobScope` is `{ parentSessionId?: string }`; the active DSH profile Board is the outer isolation boundary and session scopes are authorized before reads/cancellation.

- [ ] **Step 1: Write failing authorization and stream-race tests**

```ts
test('watchJobs yields a baseline and does not lose a change during subscription', async () => {
  const stream = remote.watchJobs({}, controller.signal)[Symbol.asyncIterator]()
  const baseline = await stream.next()
  board.markTerminal(job.id, { state: 'completed', resultSummary: 'done' })
  const changed = await stream.next()
  assert.equal(changed.value.revision > baseline.value.revision, true)
  assert.deepEqual(changed.value.jobs[0].resultSummary, 'done')
})
```

Add initial empty frames, multiple coalesced changes, abort/disposer cleanup, unauthorized scope/job, structured errors, cancel acknowledgement versus settlement, and reconnect baseline tests.

- [ ] **Step 2: Verify Remote tests fail**

Run: `npm test --workspace @omagents/omagents-dsh -- remote watch`
Expected: FAIL because the Remote service is absent.

- [ ] **Step 3: Implement the Remote service and stream queue**

Attach the Core listener synchronously before yielding the baseline, queue later whole-set frames, and remove the listener on `finally`/abort. Do not use DSH's sole application forwarded-event source. Keep authorization in a small adapter so denial is tested independently.

- [ ] **Step 4: Run DSH tests and type checking**

Run: `npm run typecheck --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh`
Expected: PASS with no unhandled stream iteration after abort.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `feat(dsh): expose authorized Job Board Remote streams`

### Task 13: Native React Web Job Board and Client Bundle

**Files:**
- Create: `packages/dsh/src/client/index.ts`, `packages/dsh/src/client/remote-store.ts`
- Create: `packages/dsh/src/client/components/{JobBoardPage,JobTable,JobDetails,CancelDialog,StatusBadge}.tsx`
- Create: `packages/dsh/src/client/job-board.module.css`, `packages/dsh/tsdown.client.config.ts`
- Modify: `packages/dsh/package.json` with `dsh.client` and `./client` export
- Create: `packages/dsh/test/client-store.test.ts`, `packages/dsh/test/client-components.test.tsx`, `packages/dsh/test/client-package.test.js`

**Interfaces:**
- Produces: Client named `inject = ['slots', 'remote']` and `apply(ctx)` registering `sidebar.panellist` plus keyed `main` panel ID `omagents`.
- Produces: `createJobBoardStore(remote)` with baseline/watch consumption, reconnect replacement, local elapsed-time ticking, and no independent persistence.
- Consumes: Task 12 `JobDto`, `JobScope`, revisioned frames, and cancellation result.

- [ ] **Step 1: Write failing store, component, and package tests**

```tsx
test('Cancel requires confirmation and disables repeated clicks while cancelling', async () => {
  render(<JobTable jobs={[cancellingJob]} onCancel={cancel} />)
  assert.equal(screen.getByRole('button', { name: /cancel/i }).disabled, true)
})
```

Add filters, all execution/notification states, details, empty/error/stale/permission/degraded states, baseline replacement, watch updates, reconnect, no model acknowledgement from UI reads, theme-token-only colors, root-row `dsh.client`, and lazy-CJS artifact assertions.

- [ ] **Step 2: Verify Client tests fail**

Run: `npm test --workspace @omagents/omagents-dsh -- client`
Expected: FAIL because the Client and build are absent.

- [ ] **Step 3: Implement React slots, store, controls, and Client build**

Use DSH slots and plugin-owned accessible controls. Do not iframe, append to `document.body`, or import private UI primitives. Configure the external-package lazy-CJS build and include only built Client artifacts in the published package.

- [ ] **Step 4: Build, typecheck, and run Client tests**

Run: `npm run build --workspace @omagents/omagents-dsh && npm run typecheck --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh`
Expected: PASS; disabling the root Loader row disposes the panel registrations.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `feat(dsh): add native Web Job Board`

### Task 14: DSH Skill Variants and Complete Research Workflows

**Files:**
- Modify: `packages/core/src/skills/render.js`
- Create: `SKILL.dsh.md` full-content overrides under `packages/core/skills/{parallel-execution,deep-research,hyperplan,doctor,lsp-guide}/`
- Modify: `packages/core/skills/deep-research/scripts/orchestrate.py`
- Modify: `tests/deep-research.test.js`, `tests/skills.test.js`
- Create: `packages/dsh/test/research-workflow.test.ts`, `packages/dsh/test/superpowers.test.ts`

**Interfaces:**
- Produces: structured Python dispatch `{ action: 'dispatch_subagent', description, prompt, name?, cwd? }`; host skill instructions translate it to native calls.
- Preserves: run-scoped loop keys, `layout.py` canonical paths, public-workspace restrictions, and legacy workspace behavior.

- [ ] **Step 1: Write failing host-leak and workflow tests**

```js
test('DSH orchestration contains only native subagent semantics', () => {
  const output = outputDispatchInstructions({ host: 'dsh', description: 'Research A', prompt: '...' })
  assert.match(output, /dispatch_subagent/)
  assert.doesNotMatch(output, /task\(|background:\s*true|OPENCODE_/)
})
```

Add all-33 skill discovery, Superpowers bootstrap/tool mapping, two concurrent research lanes, gap-loop resume, hyperplan three-critic completion/cancellation, wrong-host text scans, and legacy deep-research regression tests.

- [ ] **Step 2: Verify workflow tests fail**

Run: `node --test tests/deep-research.test.js tests/skills.test.js && npm test --workspace @omagents/omagents-dsh -- research superpowers`
Expected: FAIL on DSH dispatch/bootstrap behavior.

- [ ] **Step 3: Implement explicit variants and structured dispatch**

Keep shared workflow logic unchanged except host rendering. Do not migrate legacy workspaces, add a root `templates/` directory, or make optional Python packages part of base provisioning.

- [ ] **Step 4: Run complete workflow and Python suites**

Run: `node --test tests/*.test.js packages/core/test/*.test.js && npm test --workspace @omagents/omagents-dsh`
Expected: PASS, including 11 Python layout tests and concurrent/recovery scenarios.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `feat(dsh): complete skill and research workflow support`

### Task 15: Clean-Room, Browser, Cross-Platform, and Tarball Verification

**Files:**
- Modify: `.github/workflows/ci.yml`, root `package.json`, `package-lock.json`
- Create: `scripts/pack-all.js`, `scripts/test-packed-installs.js`, `packages/dsh/test/browser-job-board.spec.ts`
- Create: `tests/package-assets.test.js`

**Interfaces:**
- Produces: `npm run pack:all`, `npm run test:packed`, and `npm run test:browser`.
- Produces: four version-aligned tarballs in an ignored release-artifact directory, installed into temporary homes/profiles with no workspace source on the module resolution path.

- [ ] **Step 1: Write failing clean-room package tests**

```js
test('packed DSH installs without prepare and serves its Client artifact', async () => {
  const result = await installPackedDsh({ tarballs, isolatedHome, offlineCache, network: false })
  assert.equal(result.prepareScriptsRun, 0)
  assert.equal(existsSync(result.clientArtifact), true)
})
```

Add Core asset/Superpowers resolution without hoisting, all three no-argument install surfaces, OpenCode V1/V2 smoke, Codex smoke, Windows Python paths, real DSH Loader from tarball, browser launch/completion/cancel/reconnect, light/dark themes, and no `background` in DSH skills.

- [ ] **Step 2: Verify clean-room tests fail before release tooling**

Run: `npm run test:packed`
Expected: FAIL because aligned pack/install automation is absent.

- [ ] **Step 3: Implement deterministic pack/install/browser harnesses and CI matrix**

Set the root `test` script to run root/Core tests followed by `npm test --workspaces --if-present` so every package suite is included exactly once. Seed an offline npm cache from the lockfile before clean-room tests disable network access. Run unit/package checks on Linux, macOS, and Windows with Node 24. Run DSH real composition and Playwright on supported CI platforms using deterministic backends and local MCP servers; never require external model credentials.

- [ ] **Step 4: Run the full release-candidate verification**

Run: `npm ci && npm test && npm run test:packed && npm run test:browser`
Expected: PASS; four tarballs install cleanly and all Web/Host state agrees.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `test: verify clean-room host packages and DSH Web UI`

### Task 16: Documentation and Project Guidance Synchronization

**Files:**
- Modify: `README.md`, `README.zh-cn.md`, `README.ja.md`, `README.ko.md`
- Modify: `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`
- Create: `packages/core/AGENTS.md`, `packages/opencode/AGENTS.md`, `packages/codex/AGENTS.md`, `packages/dsh/AGENTS.md`
- Create: `packages/dsh/README.md`, `packages/dsh/docs/job-board.md`
- Create: `tests/documentation.test.js`

**Interfaces:**
- Produces: one support matrix and the three approved installation commands in every README language.
- Produces: DSH cancellation/recovery/security/troubleshooting documentation matching actual behavior.

- [ ] **Step 1: Write failing documentation consistency tests**

```js
test('all README languages contain only the approved Codex install command', () => {
  for (const file of fourReadmes) {
    assert.match(read(file), /@omagents\/omagents-codex/)
    assert.doesNotMatch(read(file), /@omagents\/omagents\s+codex/)
  }
})
```

Also assert Core publish order, four aligned package versions, no root `templates/`, no optional Python “pre-installed” claim, DSH native UI/cancellation/recovery sections, and updated workspace test commands in AGENTS/CONTRIBUTING.

- [ ] **Step 2: Verify documentation tests fail**

Run: `node --test tests/documentation.test.js`
Expected: FAIL on old structure/commands.

- [ ] **Step 3: Update all documentation in one pass**

Keep translations semantically aligned; if a translation cannot be completed, apply the project's explicit TODO marker rule instead of silently diverging. Document that `@omagents/core` is a dependency, not a separate user install.

- [ ] **Step 4: Run documentation and full tests**

Run: `node --test tests/documentation.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `docs: document multi-host packages and DSH Job Board`

### Task 17: Aligned Four-Package Release Workflow and Final Gate

**Files:**
- Create: `scripts/set-release-version.js`, `scripts/check-release.js`, `scripts/publish-all.js`
- Modify: `.github/workflows/publish.yml`, `package.json`
- Modify: `docs/specs/2026-11-13-multi-host-packages-dsh-design.md` status after implementation verification
- Create: `tests/release-workflow.test.js`

**Interfaces:**
- Produces: `node scripts/set-release-version.js <exact-version>` updating all four package versions, each host's exact `@omagents/core` dependency, and the workspace lockfile.
- Produces: `npm run release:check` executing tests, DSH build, pack inspection, clean-room installs, browser checks, and version/order validation; development runs may pass `--allow-dirty`, while the publish workflow always requires a clean checkout.
- Publishes: Core first, then OpenCode, Codex, and DSH sequentially for deterministic failure handling.

- [ ] **Step 1: Write failing release policy tests**

```js
test('release publishes Core before every host and all versions are identical', () => {
  const plan = readReleasePlan()
  assert.deepEqual(plan.packages.map(p => p.version), [version, version, version, version])
  assert.deepEqual(plan.publishOrder, ['core', 'opencode', 'codex', 'dsh'])
  for (const host of plan.hosts) assert.equal(host.dependencies['@omagents/core'], version)
})
```

Add dirty-tree rejection, invalid SemVer rejection, artifact-before-registry checks, registry confirmation after Core, no host-to-host dependency, resume behavior that never overwrites an already-published version, and no placeholder npm authentication token.

- [ ] **Step 2: Verify release tests fail**

Run: `node --test tests/release-workflow.test.js`
Expected: FAIL because aligned release tooling is absent.

- [ ] **Step 3: Implement the release scripts and OIDC workflow**

Keep `id-token: write`, do not set the placeholder `NODE_AUTH_TOKEN` registry configuration, and run the full release gate before any publish. Configure Trusted Publishing out-of-band for the three new package names; implementation tests never perform a real publish.

- [ ] **Step 4: Run the complete final verification**

Run: `npm run release:check -- --allow-dirty && git diff --check`
Expected: PASS; all spec acceptance criteria have evidence, and no old Codex path or partial DSH feature remains.

- [ ] **Step 5: Commit after explicit authorization**

Commit: `ci: release aligned Core and host packages`

---

## Execution Handoff

Implement tasks in numeric order because later interfaces consume earlier ones. Do not publish any package or make a community announcement during Tasks 1–16. Task 17 provides release automation only; actual versioning, tagging, npm publishing, GitHub Release creation, and DSH community announcement require separate explicit user authorization.
