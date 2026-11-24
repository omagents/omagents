# You.com Search Provider Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add keyed/keyless You.com as an explicit provider and as the third automatic Search MCP Proxy backend without changing existing Exa/Keenable behavior.

**Architecture:** Extend Core's existing resolver and six built-ins-only Proxy modules with a You.com adapter and a fixed `exa → keenable → youcom` attempt list. Keep host registration provider-neutral except for Codex's server-owned Bearer serialization; update research guidance, offline package/browser probes, and synchronized documentation in the same change.

**Tech Stack:** Node.js ESM and built-ins only, `node:test`, local Streamable HTTP MCP fixtures, Python 3.11+ standard library for research orchestration, existing OpenCode/Codex/DSH test harnesses.

**Spec:** `docs/specs/2026-11-24-youcom-search-provider-design.md`

## Global Constraints

- Accepted provider values are exactly `auto`, `exa`, `keenable`, and `youcom`; unset or empty means `auto`.
- Automatic order is exactly Exa, Keenable, You.com, with at most one 30-second attempt per provider and an approximate 90-second backend upper bound.
- Explicit provider value and metadata string are `youcom`; direct MCP registration name is `youdotcom`; credential variable is `YDC_API_KEY`.
- Keyed You.com is `https://api.you.com/mcp` with `Authorization: Bearer <YDC_API_KEY>`; keyless is `https://api.you.com/mcp/free` without authentication or OAuth.
- Generic public schemas and existing Exa/Keenable result metadata remain unchanged. You.com maps `query/count` and single `url`, while omitting `objective` and `maxCharacters` without local simulation.
- Successful empty results, known non-fallback failures, and caller cancellation never advance the chain. Every new call restarts at Exa.
- Proxy runtime code stays within the existing six modules and uses Node.js built-ins only. No new dependency, package, build step, cwd-relative asset, or automatic host-facing MCP row.
- Preserve user MCP precedence, Codex relocation/private modes/reinstall semantics, Windows/macOS/Linux compatibility, and existing host installation commands.
- Clear inherited `YDC_API_KEY` in deterministic default/packed/browser tests; public-network smoke remains optional and outside CI.
- Update all four README languages plus affected AGENTS guides, CHANGELOG, and specification status references together.
- Do not run Git mutations, change versions, publish packages, or create branches/worktrees without separate explicit authorization.

## Review Focus

- **A middle-provider authentication/parameter failure:** You.com must not hide it; pinned by Task 2 `non-fallback Keenable failure stops before You.com`.
- **Caller cancellation after one or two failures:** no later provider may initialize; pinned by Task 2 cancellation-at-each-position cases.
- **A keyless request containing optional generic fields:** You.com receives only `query/count` or `url`; pinned by Task 1 adapter tests and Task 2 request assertions.
- **Two Authorization-bearing Codex servers:** GitHub must use `GITHUB_TOKEN`, You.com must use `YDC_API_KEY`, and stale secrets must disappear; pinned by Task 4 Codex serialization/reinstall tests.
- **A complete SSE frame terminated by mixed legal newlines:** the client must return its matching JSON-RPC response rather than a protocol failure; pinned by Task 3 `SSE parser accepts mixed line-ending frame boundaries`.

---

### Task 1: Provider Resolution and You.com Argument Adapters

**Files:**
- Modify: `packages/core/src/mcp/resolve-servers.js`
- Modify: `packages/core/mcp-servers/search-proxy/backends.mjs`
- Test: `packages/core/test/mcp.test.js`
- Test: `packages/core/test/search-proxy-backends.test.js`

**Interfaces:**
- Consumes: existing `resolveMcpServers({ env, searchProxyEntry })`, `createBackendConfigs(env)`, `searchInvocation(provider, input, schema?)`, and `fetchInvocation(provider, input)` contracts.
- Produces: `configs.youcom` and exact You.com invocations for Task 2; explicit `servers.youdotcom` for Task 4.

- [x] **Step 1: Write failing resolver and adapter tests**

Add cases named `explicit You.com retains keyed and keyless direct registration`, `explicit auto passes optional You.com credentials to the proxy`, `You.com backend configs select keyed and keyless endpoints`, and `You.com mappings omit unsupported generic hints`.

Assert:
- Auto with all three keys forwards exactly `EXA_API_KEY`, `KEENABLE_API_KEY`, and `YDC_API_KEY`.
- Explicit keyed `youcom` produces only direct `youdotcom` with URL `/mcp`, `oauth: false`, and the Bearer header; keyless produces `/mcp/free` without `headers`.
- Explicit Exa/Keenable never produce `youdotcom`; unsupported-value text lists all four accepted values.
- `createBackendConfigs()` includes anonymous `youcom`; a You.com key changes only its own URL/header.
- `searchInvocation("youcom", { query: "proxy docs", objective: "ignored hint", maxResults: 50 })` returns `{ name: "you-search", arguments: { query: "proxy docs", count: 50 } }`.
- `fetchInvocation("youcom", { url, maxCharacters: 12000 })` returns `{ name: "you-extract", arguments: { url } }` and never adds keyed-only extraction options.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern="You.com|youcom|unsupported search provider|explicit auto" packages/core/test/mcp.test.js packages/core/test/search-proxy-backends.test.js`

Expected: FAIL because `youcom` is rejected and no You.com config/adapter exists.

- [x] **Step 3: Implement the provider definition and adapters**

Extend the whitelist and automatic environment without mutating `env`. Register direct `youdotcom` only for explicit `youcom`. Add the fixed backend config and minimal native mappings; do not change generic validation or existing provider mappings.

- [x] **Step 4: Run both suites and verify GREEN**

Run: `node --test packages/core/test/mcp.test.js packages/core/test/search-proxy-backends.test.js`

Expected: all resolver, validation, and adapter tests PASS.

---

### Task 2: Ordered Three-Provider Routing and Compatible Metadata

**Files:**
- Modify: `packages/core/mcp-servers/search-proxy/router.mjs`
- Test: `packages/core/test/search-proxy-router.test.js`
- Test: `packages/core/test/search-proxy-stdio.test.js`

**Interfaces:**
- Consumes: Task 1 `configs.youcom`, `you-search`, and `you-extract` mappings.
- Produces: fixed provider order and success metadata consumed by research/Doctor guidance and optional live smoke.

- [x] **Step 1: Convert fixtures and write failing routing tests**

Add a real third local fixture for You.com with native tool schemas and exact request capture. Ensure existing direct/fallback tests assert no You.com traffic after Exa or Keenable success.

Add tests named:
- `You.com success preserves ordered two-fallback metadata without changing legacy result shapes`.
- `non-fallback Keenable failure stops before You.com`.
- `three failures expose only bounded ordered provider/category summaries and redact all provider keys`.
- `caller cancellation prevents each remaining provider attempt`.
- `each new generic call restarts at Exa without sticky You.com routing`.

For You.com success after temporary Exa and Keenable failures, assert provider `youcom`, first `fallback.from === "exa"`, ordered `fallbacks` entries for Exa and Keenable, two readable Fallback lines, preserved backend content, and one attempt per provider. Assert Exa and Keenable successes retain their exact old `_meta.omagents` objects without `fallbacks`. Include `YDC_API_KEY` and raw echoed secrets in the all-failed redaction case.

- [x] **Step 2: Run the router suite and verify RED**

Run: `node --test packages/core/test/search-proxy-router.test.js packages/core/test/search-proxy-stdio.test.js`

Expected: FAIL because the router has no You.com client or third attempt and advertises two-provider descriptions.

- [x] **Step 3: Implement the ordered attempt loop**

Construct all three clients and iterate `exa`, `keenable`, `youcom` using the existing `runAttempt` primitive. Stop on success, non-eligible failure, cancellation, or final failure. Preserve the legacy `fallback` field and add `fallbacks` only for success after two failures. Update generic descriptions to name eligible Keenable and You.com fallback. Add `YDC_API_KEY` to sensitive values.

- [x] **Step 4: Run router and stdio suites and verify GREEN**

Run: `node --test packages/core/test/search-proxy-router.test.js packages/core/test/search-proxy-stdio.test.js`

Expected: all legacy and new routing, cancellation, metadata, redaction, and stdio contract tests PASS.

---

### Task 3: Mixed-Newline SSE Frame Compatibility

**Files:**
- Modify: `packages/core/mcp-servers/search-proxy/remote-client.mjs`
- Test: `packages/core/test/search-proxy-remote-client.test.js`

**Interfaces:**
- Consumes: existing `RemoteMcpClient.readSse(response, id, signal)` and local response fixtures.
- Produces: no new API; Task 2 continues using the same client contract.

- [x] **Step 1: Write the failing transport regression**

Add `SSE parser accepts mixed line-ending frame boundaries`: deliver a matching `initialize` or `tools/list` SSE event whose data line ends with LF and whose blank line ends with CRLF (`\n\r\n`), including a fragmented chunk boundary. Assert the matching result is returned. Retain all current CRLF, multiline-data, comment, unrelated-ID, and truncation tests.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="mixed line-ending" packages/core/test/search-proxy-remote-client.test.js`

Expected: FAIL with `protocol` because the complete frame is not recognized.

- [x] **Step 3: Recognize two consecutive legal SSE line endings**

Adjust only frame-boundary recognition so CRLF, LF, and CR can form a blank line in any valid combination and across chunks. Do not relax JSON-RPC validation, response-ID matching, or cancellation behavior.

- [x] **Step 4: Run the complete remote-client suite and verify GREEN**

Run: `node --test packages/core/test/search-proxy-remote-client.test.js`

Expected: all transport and regression tests PASS.

---

### Task 4: Host Registration and Codex Bearer Ownership

**Files:**
- Modify: `packages/codex/src/setup.js`
- Test: `packages/codex/test/setup-regression.test.js`
- Test: `packages/codex/test/installer.test.js`
- Test: `tests/plugin.test.js`
- Test: `tests/plugin-v2.test.js`
- Test: `packages/dsh/test/mcp.test.ts`

**Interfaces:**
- Consumes: Task 1 automatic environment and direct `youdotcom` definitions.
- Produces: Codex `bearer_token_env_var` owner mapping and deterministic host coverage; OpenCode/DSH production registration remains unchanged.

- [x] **Step 1: Write failing host and installer tests**

Add OpenCode V1/V2 and DSH cases for keyed/keyless direct You.com and automatic `YDC_API_KEY` forwarding. Add `YDC_API_KEY` to the V2 inherited-environment scrub list.

Extend Codex tests to assert:
- `github` uses `bearer_token_env_var: "GITHUB_TOKEN"` while keyed `youdotcom` uses `"YDC_API_KEY"`; neither secret appears literally.
- Keyless `youdotcom` has only the `/mcp/free` URL.
- Auto relocation still copies exactly six modules and its local `env` includes configured You.com credentials.
- Exa → auto → Keenable → keyed You.com → keyless You.com reinstall transitions remove stale provider entries and secrets without changing private modes or rejected-reinstall atomicity.

- [x] **Step 2: Run focused host tests and verify RED**

Run: `node --test tests/plugin.test.js tests/plugin-v2.test.js packages/codex/test/installer.test.js packages/codex/test/setup-regression.test.js`

Run: `npm test --workspace @omagents/omagents-dsh -- mcp`

Expected: FAIL on missing You.com registration/environment and Codex's current `Authorization → GITHUB_TOKEN` assumption.

- [x] **Step 3: Scope Codex Bearer indirection by server owner**

Replace the universal Authorization-to-GitHub branch with explicit `github` and `youdotcom` owner mappings. Preserve existing direct-header serialization for Exa, Keenable, and other non-Bearer definitions. Do not alter OpenCode or DSH registration logic.

- [x] **Step 4: Run host suites and verify GREEN**

Run the two commands from Step 2.

Expected: all targeted host, credential, relocation, and reinstall tests PASS.

---

### Task 5: Research, Skill Rendering, and Doctor Routing

**Files:**
- Modify: `packages/core/src/skills/render.js`
- Modify: `packages/core/skills/deep-research/scripts/orchestrate.py`
- Modify: `packages/core/skills/deep-research/SKILL.md`
- Modify: `packages/core/skills/deep-research/SKILL.dsh.md`
- Modify: `packages/core/skills/doctor/SKILL.md`
- Modify: `packages/core/skills/doctor/SKILL.dsh.md`
- Test: `packages/core/test/skills.test.js`
- Test: `tests/deep-research.test.js`
- Test: `packages/dsh/test/research-workflow.test.ts`

**Interfaces:**
- Consumes: Task 2 provider/metadata strings and Task 4 direct registration name.
- Produces: exclusive automatic and explicit You.com instructions for fresh research children and Doctor diagnostics.

- [x] **Step 1: Write failing rendering and prompt tests**

Assert:
- Codex/DSH rendering maps `youdotcom_you-search` / `youdotcom_you-extract` to `mcp__youdotcom__you-search` / `mcp__youdotcom__you-extract`.
- Auto prompts describe Exa → Keenable → You.com, one attempt per eligible position, no model-driven fallback, and no direct Exa/Keenable/You.com tools.
- Explicit `youcom` is accepted by Python orchestration and produces exclusive direct tool instructions; other explicit routes exclude You.com.
- Actual DSH native-child dispatches carry the same automatic and explicit contracts.
- Shared and DSH Doctor guidance names `exa|keenable|youcom`, the new three-failure history, keyed/keyless endpoints, and credential-presence-only reporting.

- [x] **Step 2: Run focused tests and verify RED**

Run: `node --test packages/core/test/skills.test.js tests/deep-research.test.js`

Run: `npm test --workspace @omagents/omagents-dsh -- research-workflow`

Expected: FAIL on the old two-provider whitelist, tool mappings, and prompt prose.

- [x] **Step 3: Update rendering and all prompt variants**

Add only the specified tool mappings and provider branch. Update both complete skill variants and Doctor variants consistently; do not add runtime host detection or instruct children to perform fallback themselves.

- [x] **Step 4: Run focused suites and verify GREEN**

Run the commands from Step 2.

Expected: all skill, orchestration, and native-child prompt tests PASS.

---

### Task 6: Offline Packaging, Browser Isolation, and Optional Live Smoke

**Files:**
- Modify: `scripts/test-packed-installs.js`
- Modify: `scripts/packed-harness.js`
- Modify: `packages/dsh/test/browser-job-board.spec.ts`
- Modify: `packages/core/test/search-proxy-live.test.js`
- Test: `tests/package-assets.test.js`

**Interfaces:**
- Consumes: the complete Task 1–5 implementation.
- Produces: deterministic offline evidence and an optional anonymous You.com route check.

- [x] **Step 1: Extend environment and live assertions**

Add `YDC_API_KEY: ""` to every packed/browser/default clean-room search environment. Keep six-module inventories and generic tool/row counts unchanged.

Add an opt-in live test that forces immediate transport failures for Exa and Keenable, calls anonymous You.com once, and asserts readable content, provider `youcom`, and two ordered fallback descriptors. Clear You.com credentials in the anonymous environment; do not add this test to CI.

- [x] **Step 2: Run deterministic asset and packed-first checks**

Run: `node --test tests/package-assets.test.js`

Run: `npm run pack:all && npm run test:packed`

Expected: all package-content, offline initialize/`tools/list`, relocation, and copied-module comparisons PASS with no public backend initialization.

- [x] **Step 3: Run the packed browser gate**

Run: `npm run test:browser`

Expected: PASS with one built-in Proxy row, four unrelated echo fixtures, exactly generic `mcp__websearch__search` / `mcp__websearch__fetch`, and offline startup.

- [ ] **Step 4: Optionally run public-network smoke separately** — NOT RUN; requires separate explicit authorization

Run only when network access is intended: `OMAGENTS_LIVE_SEARCH_TEST=1 node --test packages/core/test/search-proxy-live.test.js`

Expected: Exa, Keenable fallback, and You.com second-fallback smoke PASS. If a provider or local network route is unavailable, record the exact optional-smoke limitation without weakening deterministic evidence or adding retries.

---

### Task 7: Synchronized Documentation and Full Verification

**Files:**
- Modify: `README.md`, `README.zh-cn.md`, `README.ja.md`, `README.ko.md`
- Modify: `AGENTS.md`, `packages/core/AGENTS.md`, `packages/opencode/AGENTS.md`, `packages/codex/AGENTS.md`, `packages/dsh/AGENTS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/specs/2026-11-24-search-mcp-proxy-design.md` status/reference only
- Modify: `docs/specs/2026-11-24-youcom-search-provider-design.md` final verification status
- Test: `tests/documentation.test.js`

**Interfaces:**
- Consumes: all implemented behavior and fresh verification evidence.
- Produces: the current user/agent contract; no version or release change.

- [x] **Step 1: Extend documentation tests and verify RED**

Require all four languages to name `youcom`, `youdotcom`, `YDC_API_KEY`, both You.com endpoints, the three-provider order, 100 queries/day, parameter degradation, 30 seconds per backend/approximate 90 seconds total, three-provider privacy disclosure, explicit opt-out, and Codex Bearer/reinstall behavior. Require AGENTS guides to state the same core invariants.

Run: `node --test tests/documentation.test.js`

Expected: FAIL before documentation changes.

- [x] **Step 2: Update every documentation surface together**

Keep translations semantically aligned and preserve existing Keenable rate-limit/logging guidance. Mark the original two-provider spec as the implemented baseline extended by this spec; record only fresh verification evidence, not pre-You.com results.

- [x] **Step 3: Run documentation and formatting checks**

Run: `node --test tests/documentation.test.js && npm run format:check`

Expected: PASS. If formatting fails, format only files changed by this feature and rerun the check.

- [x] **Step 4: Run the complete deterministic release-candidate gate**

Run:
- `node --check packages/opencode/src/index.js`
- `python -m compileall -q packages/core/skills/deep-research/scripts && python -m compileall -q packages/core/skills/_shared/scripts`
- `npm run typecheck --workspace @omagents/omagents-dsh`
- `npm test`
- `npm run pack:all && npm run test:packed`
- `npm run test:browser`
- `git diff --check`

Expected: every command exits 0; test totals are recorded from actual output. Do not claim optional live success unless Step 4 of Task 6 actually ran and passed.

- [x] **Step 5: Perform final code review and close findings**

Use `requesting-code-review` for a fresh scoped review of the complete You.com diff and existing Search Proxy regression surface. Reproduce every confirmed Important/Critical finding with a failing regression before fixing it, rerun affected suites and the full gate, and record any deliberately deferred Minor with its reason. Use `verification-before-completion` before reporting completion.
