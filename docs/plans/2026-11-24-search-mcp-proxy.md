# Automatic Search MCP Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `auto` the default search provider and route generic search/fetch calls through a self-contained local MCP Proxy that tries Exa once and falls back to Keenable once only for approved invocation failures.

**Architecture:** Core selects a local `websearch` stdio server for `auto` while preserving direct registration for explicit `exa` and `keenable`. The Proxy contains focused backend adapters, a Streamable HTTP MCP client, failover/session logic, and a stdio MCP server; host adapters keep registration only, and Codex copies the complete self-contained Proxy into its plugin cache.

**Tech Stack:** Node.js ESM and built-ins only for the Proxy, `node:test`, `node:http`, streams/PassThrough, Python 3.11+ standard library for research orchestration, existing OpenCode/Codex/DSH test harnesses.

**Spec:** `docs/specs/2026-11-24-search-mcp-proxy-design.md`

## Global Constraints

- Unset, empty, or `auto` selects the Proxy; only `auto`, `exa`, and `keenable` are accepted non-empty values.
- Explicit `exa` and `keenable` retain their current direct endpoints, tool names, and optional credential behavior.
- Each backend gets at most one attempt and 30 seconds per generic call; successful empty results and known non-fallback failures never fall back.
- Proxy runtime code uses Node.js built-ins only, no host SDK imports, no new package, no product build step, and no cwd-relative asset resolution.
- Prefer MCP protocol `2025-06-18`; accept a negotiated `2025-03-26` or `2025-06-18`. Use initialize/initialized, `Mcp-Session-Id` when supplied, `MCP-Protocol-Version` on subsequent requests, and JSON plus SSE responses. Do not implement the newer stateless protocol revision in this change.
- Preserve user MCP precedence, Codex private file modes, Windows/macOS/Linux paths, and all existing host installation commands.
- Tests exercising default selection must explicitly clear inherited `OMAGENTS_SEARCH_PROVIDER`, `EXA_API_KEY`, and `KEENABLE_API_KEY`; packed/browser probes pin `auto` deliberately rather than inheriting the developer's environment.
- Update English, Simplified Chinese, Japanese, and Korean README files together, plus affected AGENTS guides and CHANGELOG.
- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or other Git mutations. Leave every change uncommitted unless the user separately authorizes a Git operation.

## Review Focus

- **One caller cancels while concurrent first calls share initialization:** the remaining caller must finish with one backend handshake; pinned by Task 5 `one cancelled waiter does not abort shared initialization`.
- **Provider schema/session drift:** Exa objective optional/required/absent variants must map correctly, and an MCP session 404 must not be confused with a tool/page 404; pinned by Tasks 3 and 5 `Exa objective schema variants` and `session 404 falls back but tool 404 does not`.
- **Fragmented SSE input:** split CRLF frames, multiline data, comments, and unrelated event IDs must not hang or produce the wrong response; pinned by Task 4 `SSE parser handles fragmented CRLF frames and multiline data`.
- **Backend errors echo sensitive input:** keys, queries, objectives, and target URLs must not escape through errors; pinned by Task 2 `redaction removes secrets and bounds public error text` and Task 5 dual-failure assertions.
- **Codex paths are relocated and contain spaces/non-ASCII characters:** the copied Proxy must still handshake without source or npx paths; pinned by Task 7 `Codex auto installs a relocatable proxy and replaces stale credentials`.

---

### Task 1: Auto Provider Resolution and Packaged Paths

**Files:**
- Modify: `packages/core/src/mcp/resolve-servers.js`
- Modify: `packages/core/src/paths.js`
- Test: `packages/core/test/mcp.test.js`

**Interfaces:**
- Defines private `DEFAULT_SEARCH_PROXY_ENTRY = fileURLToPath(new URL("../../mcp-servers/search-proxy/index.mjs", import.meta.url))`; the resolver does not import `getCorePaths()` or perform host detection, so MCP resolution stays independent of optional Superpowers discovery.
- Produces: `resolveMcpServers({ env = process.env, searchProxyEntry = DEFAULT_SEARCH_PROXY_ENTRY } = {})`.
- Produces independently in `paths.js`: `getCorePaths().searchProxyDir` and `getCorePaths().searchProxyEntry`, both absolute paths beneath `packages/core/mcp-servers/search-proxy/` and equal to the resolver default.
- Produces in `auto`: `websearch = { type: "local", command: ["node", absoluteEntry], environment? }` with only configured `EXA_API_KEY` and `KEENABLE_API_KEY` entries.

- [ ] **Step 1: Write failing resolver tests**

Add cases named `unset and empty provider select the auto proxy`, `explicit auto passes optional credentials to the proxy`, and `explicit Exa and Keenable retain direct registration`.

Assert:
- Unset, `""`, and `"auto"` select identical local `websearch` commands with `command[0] === "node"` and an absolute `command[1]` ending in `search-proxy/index.mjs`.
- No direct `keenable` or remote Exa entry remains in `auto`.
- Auto with both keys exposes exactly those two environment entries; auto without keys has no `environment` property.
- `searchProxyEntry` overrides the command path without changing the environment or mutating `env`.
- Explicit Exa remains `https://mcp.exa.ai/mcp`; explicit Keenable retains its keyed/public endpoints.
- Unsupported values report `expected "auto", "exa", or "keenable"`.
- `getCorePaths()` exposes the two absolute Proxy paths.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test --test-name-pattern="auto proxy|explicit auto|explicit Exa and Keenable" packages/core/test/mcp.test.js`

Expected: FAIL because `auto` is rejected and the default is direct Exa.

- [ ] **Step 3: Implement provider selection and path resolution**

Resolve the default entry with `fileURLToPath(new URL(..., import.meta.url))`; do not infer a host or use cwd. Keep all non-search catalog behavior unchanged. Clone command/environment data so separate resolutions remain independent.

- [ ] **Step 4: Run Core resolver tests and verify GREEN**

Run: `node --test packages/core/test/mcp.test.js`

Expected: all resolver and existing catalog tests PASS.

---

### Task 2: Failure Categories and Redaction

**Files:**
- Create: `packages/core/mcp-servers/search-proxy/errors.mjs`
- Test: `packages/core/test/search-proxy-errors.test.js`

**Interfaces:**
- Produces: `class ProxyFailure extends Error` with constructor `new ProxyFailure({ code, message, fallbackEligible, status? })` and properties `code`, `fallbackEligible`, and optional `status`.
- Produces: `redactText(value, sensitiveValues = []) -> string`, replacing configured values and credential-shaped text with `[redacted]`, with public text capped at 500 characters.
- Produces: `classifyFailure(error, { provider, sensitiveValues = [] } = {}) -> ProxyFailure`.
- Produces: `classifyToolResult(result, { provider, sensitiveValues = [] } = {}) -> ProxyFailure`, used only when `result.isError === true`.

- [ ] **Step 1: Write failing classification and privacy tests**

Add tests for:
- `408`, `429`, and `503` fallback; `400`, `401`, `403`, tool/page `404`, and `422` do not.
- `Retryable: yes` falls back and `Retryable: no` does not, including `HTTP 500; Retryable: no`.
- Unknown tool errors fall back as `backend_error`; explicit auth/permission/parameter text does not.
- Transport/protocol/timeout failures retain stable codes and fallback eligibility.
- `redaction removes secrets and bounds public error text`: include both API keys, a query, objective, target URL, `Authorization: Bearer ...`, `x-api-key`, and `X-API-Key`; assert none survive and output length is at most 500.
- Public messages use provider/category/status summaries rather than serializing raw backend bodies or `cause` objects.

- [ ] **Step 2: Run the new tests and verify RED**

Run: `node --test packages/core/test/search-proxy-errors.test.js`

Expected: FAIL during import because `errors.mjs` does not exist.

- [ ] **Step 3: Implement classification and redaction**

Preserve an existing `ProxyFailure`. Parse structured status first, then bounded backend text for retryability and known non-fallback classes; explicit non-retryable markers take precedence. Do not attach raw request/response objects to public errors. Treat cancellation separately in later tasks rather than converting it into fallback.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `node --test packages/core/test/search-proxy-errors.test.js`

Expected: all classification and redaction tests PASS.

---

### Task 3: Backend Configuration and Argument Adapters

**Files:**
- Create: `packages/core/mcp-servers/search-proxy/backends.mjs`
- Test: `packages/core/test/search-proxy-backends.test.js`

**Interfaces:**
- Consumes: `ProxyFailure` from Task 2.
- Produces: `createBackendConfigs(env = {}) -> { exa, keenable }`, where each config is `{ provider, url, headers }`.
- Produces: `validateSearchInput(value) -> { query, objective?, maxResults }` and `validateFetchInput(value) -> { url, maxCharacters? }`.
- Produces: `searchInvocation(provider, input, inputSchema = {}) -> { name, arguments }`.
- Produces: `fetchInvocation(provider, input) -> { name, arguments }`.

- [ ] **Step 1: Write failing adapter tests**

Assert:
- Keyless configs use anonymous Exa and `https://api.keenable.ai/mcp-public`; keyed configs use `x-api-key`, `X-API-Key`, and keyed Keenable `/mcp`.
- Search maps `query`, optional `objective`, and default `maxResults: 10` to Exa `web_search_exa` / `numResults` and Keenable `search_web_pages` / `max_results`.
- `Exa objective schema variants`: required objective receives `objective ?? query`; optional objective is omitted when not supplied; absent objective is never sent even when generic input supplies it.
- Fetch maps one URL to `urls: [url]`, and `maxCharacters` to `maxCharacters` or `max_chars`.
- Reject unknown properties, blank query/objective, objective over 1,000 characters, non-integer or out-of-range `maxResults`, non-HTTP(S)/invalid URL, and non-positive/non-integer `maxCharacters` with `ProxyFailure.code === "invalid_params"` and `fallbackEligible === false`.
- `maxResults` accepts 1 and 50 but rejects 0 and 51.

- [ ] **Step 2: Run the adapter tests and verify RED**

Run: `node --test packages/core/test/search-proxy-backends.test.js`

Expected: FAIL during import because `backends.mjs` does not exist.

- [ ] **Step 3: Implement validation and mappings**

Keep provider-specific tool names and endpoints in this module only. Return fresh argument objects and never mutate generic input or a backend schema. Do not add backend-specific `mode`, batch fetch, or result normalization.

- [ ] **Step 4: Run the adapter tests and verify GREEN**

Run: `node --test packages/core/test/search-proxy-backends.test.js`

Expected: all adapter tests PASS.

---

### Task 4: Streamable HTTP MCP Client and Fixture

**Files:**
- Create: `packages/core/mcp-servers/search-proxy/remote-client.mjs`
- Create: `packages/core/test/fixtures/streamable-mcp-fixture.js`
- Test: `packages/core/test/search-proxy-remote-client.test.js`

**Interfaces:**
- Consumes: `ProxyFailure` and `classifyFailure` from Task 2.
- Produces: `class RemoteMcpClient` with constructor `{ provider, url, headers = {}, fetchImpl = globalThis.fetch, protocolVersion = "2025-06-18" }`.
- Produces: `ensureReady({ signal } = {}) -> Promise<ToolDefinition[]>`, performing coalesced initialize, initialized notification, and tools/list.
- Produces: `callTool({ name, arguments, signal }) -> Promise<McpToolResult>`, returning both success and `isError` tool results for Task 5 to classify.
- Produces: `invalidate()` and `close()`.
- Test fixture produces: `createMcpHttpFixture(options) -> Promise<{ url, requests, close }>` using a real ephemeral `node:http` server.

- [ ] **Step 1: Write failing real-HTTP client tests**

Cover:
- Initialize/tools/list/tools/call with `Accept: application/json, text/event-stream`, JSON content type, optional session ID, and negotiated protocol header on subsequent requests.
- A server negotiating `2025-03-26` and one using `2025-06-18`; reject an unsupported negotiated version as `protocol`.
- JSON success, SSE success, 202 initialized notification, and tool `isError` returned to the caller rather than thrown as a transport error.
- `SSE parser handles fragmented CRLF frames and multiline data`: chunks split inside headers/data, comment lines ignored, multiline `data:` joined with newlines, and only the matching JSON-RPC ID settles the request.
- HTTP status becomes `ProxyFailure` with status/code; malformed JSON, unexpected content type, missing response ID, and invalid tool envelopes become `protocol`.
- Abort cancels the POST/SSE body; `invalidate()` clears session/tools for the next readiness call; `close()` is repeat-safe and prevents late responses.

- [ ] **Step 2: Run the client tests and verify RED**

Run: `node --test packages/core/test/search-proxy-remote-client.test.js`

Expected: FAIL during import because `remote-client.mjs` does not exist.

- [ ] **Step 3: Implement the fixture and client**

Use POST-only Streamable HTTP for the required client surface; no standalone GET stream, resumability, JSON-RPC batching, or unrelated MCP capabilities. Offer `2025-06-18`, accept only the two global protocol versions, retain a server-issued session ID, and send the negotiated version on later requests.

Parse JSON and incremental SSE responses. Coalesce readiness while tracking waiting callers so one caller's abort does not cancel initialization still needed by another; abort shared initialization when no waiters remain. Invalidate only affected session state, not other in-flight tool calls.

- [ ] **Step 4: Run the client tests and verify GREEN**

Run: `node --test packages/core/test/search-proxy-remote-client.test.js packages/core/test/search-proxy-errors.test.js`

Expected: all client and error tests PASS without public network access.

---

### Task 5: Generic Router, Failover, and Backend Lifecycles

**Files:**
- Create: `packages/core/mcp-servers/search-proxy/router.mjs`
- Test: `packages/core/test/search-proxy-router.test.js`

**Interfaces:**
- Consumes: Tasks 2–4, including `createBackendConfigs`, validators, invocation mappers, `RemoteMcpClient`, and failure classifiers.
- Produces: `DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000` and `SEARCH_PROXY_TOOLS`, containing exactly the generic `search` and `fetch` JSON Schema definitions with `additionalProperties: false`.
- Produces: `createSearchRouter({ env = {}, clientFactory = config => new RemoteMcpClient(config), attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS })`.
- Router methods: `listTools() -> ToolDefinition[]`, `callTool(name, args, { signal } = {}) -> Promise<McpToolResult>`, and `close() -> Promise<void>`.

- [ ] **Step 1: Write failing router integration tests**

Use two real local HTTP fixtures. The default `clientFactory(config)` under test may replace only `config.url` with the fixture URL for `config.provider`.

Cover:
- Exa success returns `provider: "exa"`, `fallback: null`, and zero Keenable requests.
- Valid empty Exa search content is success without fallback.
- Timeout, transport, 408/429/5xx, protocol failure, and unknown `isError` each cause exactly one Keenable call; successful fallback preserves Keenable content and adds Exa failure metadata.
- Auth, permission, parameter, tool/page 404, 422, and `Retryable: no` do not call Keenable.
- `session 404 falls back but tool 404 does not`.
- Both failures return `isError: true` with both providers/codes and no API key, query, objective, or target URL.
- Search/fetch mappings use Task 3 schemas, and a missing required backend tool is a protocol failure.
- A small injected `attemptTimeoutMs` verifies timeout without a slow test; production default remains exactly 30,000 ms.
- Caller cancellation and `close()` abort pending work, never start Keenable afterward, and emit no late result.
- `one cancelled waiter does not abort shared initialization`: start two first calls, cancel one while initialize is delayed, and assert one initialize plus one successful remaining call.
- Later calls reinitialize an invalidated backend; every new call still tries Exa first.

- [ ] **Step 2: Run the router tests and verify RED**

Run: `node --test packages/core/test/search-proxy-router.test.js`

Expected: FAIL during import because `router.mjs` does not exist.

- [ ] **Step 3: Implement bounded routing and response metadata**

For each attempt, combine caller cancellation and its own deadline, then run ensureReady plus the mapped call within that budget. Distinguish timeout abort from caller abort. Do not retry an invalidated Exa session in the same call; proceed according to its failure classification.

Prepend `Provider: ...` and optional `Fallback: ...` text to successful backend content. Add `_meta.omagents = { provider, fallback }`; use `fallback: null` on direct Exa success. Reject malformed success envelopes as protocol failures. Return bounded dual-provider errors without raw response serialization.

- [ ] **Step 4: Run router and prerequisite tests and verify GREEN**

Run: `node --test packages/core/test/search-proxy-router.test.js packages/core/test/search-proxy-remote-client.test.js packages/core/test/search-proxy-backends.test.js packages/core/test/search-proxy-errors.test.js`

Expected: all Proxy unit/integration tests PASS using only local fixtures.

---

### Task 6: Stdio MCP Server and Executable Proxy

**Files:**
- Create: `packages/core/mcp-servers/search-proxy/stdio-server.mjs`
- Create: `packages/core/mcp-servers/search-proxy/index.mjs`
- Modify: `package.json` formatting globs to include `packages/core/mcp-servers/search-proxy/*.mjs`
- Modify: `.github/workflows/ci.yml` so the same Proxy modules receive syntax and formatting checks on every OS
- Test: `packages/core/test/search-proxy-stdio.test.js`

**Interfaces:**
- Consumes: `createSearchRouter` from Task 5.
- Produces: `createStdioMcpServer({ input, output, router }) -> { close() -> Promise<void> }`.
- Produces: `runSearchProxy({ input = process.stdin, output = process.stdout, env = process.env, clientFactory } = {}) -> { close() -> Promise<void> }` for in-process and spawned verification.
- The direct entry runs `node packages/core/mcp-servers/search-proxy/index.mjs` and writes protocol messages only to stdout.

- [ ] **Step 1: Write failing stdio and executable tests**

Assert:
- Spawn the real entry for initialize, initialized, tools/list, and stdin-close shutdown; initialize negotiates `2025-06-18`, server capabilities contain tools, and exactly `search`/`fetch` schemas are returned. There is no invented MCP `shutdown` method.
- Newline-delimited JSON and CRLF framing work; notifications receive no response; ping returns `{}`; unknown methods return JSON-RPC `-32601`; unknown tools return `-32602`.
- Invalid generic arguments return an MCP tool error without backend calls.
- Using PassThrough streams and an injected router, tools/call returns provider metadata and notifications/cancelled aborts the matching call without a late response.
- stdin close, SIGTERM, and repeated `close()` abort active work and do not write non-protocol stdout.

- [ ] **Step 2: Run the stdio tests and verify RED**

Run: `node --test packages/core/test/search-proxy-stdio.test.js`

Expected: FAIL during import or spawn because the stdio modules do not exist.

- [ ] **Step 3: Implement the stdio server and direct entry**

Handle only initialize/initialized, ping, tools/list, tools/call, and cancellation. Track request IDs through settlement and suppress late writes after cancellation/close. Keep stderr diagnostics bounded/redacted; preferably stay quiet unless an unexpected process-level failure requires a diagnostic.

Use an import-versus-direct-entry guard based on `pathToFileURL(process.argv[1]).href`; `runSearchProxy` remains injectable for tests without adding test-only environment variables or endpoint overrides.

- [ ] **Step 4: Run stdio and full Core Proxy tests and verify GREEN**

Run:
```bash
node --test packages/core/test/search-proxy-stdio.test.js packages/core/test/search-proxy-router.test.js packages/core/test/search-proxy-remote-client.test.js
node --check packages/core/mcp-servers/search-proxy/index.mjs
```

Expected: all stdio tests PASS and syntax checking exits 0.

---

### Task 7: Codex Self-Contained Installation and Reinstall

**Files:**
- Modify: `packages/codex/src/setup.js`
- Test: `packages/codex/test/setup-regression.test.js`
- Test: `packages/codex/test/installer.test.js`
- Test: `tests/package-assets.test.js`
- Modify: `scripts/test-packed-installs.js` for the final real-tarball probe

**Interfaces:**
- Consumes: `getCorePaths().searchProxyDir` and resolver `searchProxyEntry` from Task 1.
- Changes private helper to `generateMcpJson(env, { searchProxyEntry } = {})`.
- Installs copied assets beneath `<cacheDir>/mcp-servers/search-proxy/`; auto `.mcp.json` points `websearch.args` to the copied absolute `index.mjs`.

- [ ] **Step 1: Write failing Codex lifecycle tests**

Add `Codex auto installs a relocatable proxy and replaces stale credentials` and a package-surface assertion.

Use a temporary Codex home containing spaces and non-ASCII characters. Assert:
- Auto installs local `websearch` with `command === "node"`, copied args path, and optional credentials in `env`; no remote Exa or separate Keenable server is registered.
- The complete copied directory exists. Copy it once more to another temporary path containing spaces, temporarily rename the isolated installed Core and Codex package directories, spawn that relocated `index.mjs` with an empty `NODE_PATH` and nonexistent npm cache, and complete initialize/tools/list. Restore the packages in `finally`; also assert the configured path contains neither the repository, installed Core, nor an npx cache.
- Reinstall Exa → auto → Keenable → Exa removes stale provider entries, planted stale files inside the copied Proxy, and both old secrets. The small current Proxy asset directory may remain copied but unregistered under explicit providers because installation refreshes it unconditionally; no stale generated registration or credential may remain.
- `.mcp.json` remains `0600` and private directories `0700` on POSIX-mode platforms.
- `tests/package-assets.test.js` proves all six Proxy modules enter Core's real npm pack dry run; `packages/codex/test/installer.test.js` proves the actual packed CLI creates a complete copied runtime that never requires TypeScript or a build step.

- [ ] **Step 2: Run Codex tests and verify RED**

Run:
```bash
node --test --test-name-pattern="relocatable proxy|replaces stale credentials" packages/codex/test/setup-regression.test.js
node --test --test-name-pattern="proxy|auto" packages/codex/test/installer.test.js
node --test tests/package-assets.test.js
```

Expected: FAIL because auto is rejected, `.mcp.json` still references direct providers, or the Proxy is absent from package assets.

- [ ] **Step 3: Implement copied asset generation**

Compute `cacheDir` and copied Proxy paths before generating `.mcp.json`; pass the copied entry through the explicit resolver option. Resolve and validate the configuration before the existing cache removal so an unsupported provider cannot destroy a working installation. After cleaning/recreating the cache, copy `getCorePaths().searchProxyDir` recursively using existing installer helpers. Copy the small self-contained directory unconditionally so no provider-selection logic is duplicated in Codex.

- [ ] **Step 4: Run Codex suites and verify GREEN**

Run: `npm test --workspace @omagents/omagents-codex`

Expected: all Codex installer, credential, lifecycle, and package tests PASS.

---

### Task 8: OpenCode/DSH Registration and Generic Tool Rendering

**Files:**
- Modify: `packages/core/src/skills/render.js`
- Test: `packages/core/test/skills.test.js`
- Test: `tests/plugin.test.js`
- Test: `tests/plugin-v2.test.js`
- Test: `packages/dsh/test/mcp.test.ts`

**Interfaces:**
- Produces Codex/DSH mappings: `websearch_search -> mcp__websearch__search` and `websearch_fetch -> mcp__websearch__fetch`.
- Preserves explicit Exa native `web_search`/`web_fetch` and explicit Keenable mappings.

- [ ] **Step 1: Write failing host and rendering tests**

Assert:
- Default/auto OpenCode built-ins contain local `websearch`; V2 strips V1-only fields and retains local startup timeout; a user-configured `websearch` is not replaced.
- Existing direct Exa tests explicitly set `OMAGENTS_SEARCH_PROVIDER=exa` and retain their original remote assertions.
- DSH converts auto to stdio config with the absolute Proxy entry and credential environment; explicit keyed/keyless Keenable tests remain unchanged.
- Core rendering maps generic Proxy names only for Codex/DSH and does not introduce OpenCode host detection.

- [ ] **Step 2: Run focused host tests and verify RED**

Run:
```bash
node --test tests/plugin.test.js tests/plugin-v2.test.js
node --import tsx --test packages/dsh/test/mcp.test.ts
node --test --test-name-pattern="provider|tool names" packages/core/test/skills.test.js
```

Expected: FAIL on default direct Exa expectations and missing generic mappings.

- [ ] **Step 3: Implement mappings and update host assertions**

Keep production host adapters unchanged unless a test reveals a concrete serialization gap; the canonical local definition should flow through their existing local-MCP paths. Add only the two generic mappings to Core rendering.

- [ ] **Step 4: Run host suites and verify GREEN**

Run the Step 2 commands again.

Expected: all focused OpenCode, DSH MCP, and skill-rendering tests PASS.

---

### Task 9: Deep Research and Doctor Auto Guidance

**Files:**
- Modify: `packages/core/skills/deep-research/scripts/orchestrate.py`
- Modify: `packages/core/skills/deep-research/SKILL.md`
- Modify: `packages/core/skills/deep-research/SKILL.dsh.md`
- Modify: `packages/core/skills/doctor/SKILL.md`
- Modify: `packages/core/skills/doctor/SKILL.dsh.md`
- Test: `tests/deep-research.test.js`
- Test: `packages/dsh/test/research-workflow.test.ts`
- Test: `packages/core/test/skills.test.js`

**Interfaces:**
- `_search_provider()` returns `auto` for unset/empty and accepts `auto|exa|keenable`.
- `_search_tool_instruction("auto")` names `websearch_search` / `websearch_fetch` for OpenCode and `mcp__websearch__search` / `mcp__websearch__fetch` for Codex/DSH.
- Dispatch and pre-research JSON continue to emit `search_provider`, now including `auto`.

- [ ] **Step 1: Write failing actual-prompt tests**

Add root tests `auto structured research children receive generic proxy routing` and `auto pre-research instructions receive generic proxy routing`, plus a DSH native activation-prompt case.

Assert:
- `search_provider === "auto"` for explicit auto and for unset environment.
- Prompts contain all four host-specific generic names and explain programmatic Exa → Keenable failover.
- Prompts forbid direct Exa, direct Keenable, native `web_search`, `web_fetch`, `websearch_web_search_exa`, and `webfetch` for the research web route; they do not ask the model to perform fallback itself.
- Existing Exa/Keenable exclusivity tests set their provider explicitly and remain valid.
- Shared and DSH Deep Research/Doctor rendering describes `auto`, its local Proxy registration, failure semantics, response provider evidence, native-tool/user-override guarantee boundary, and no secret disclosure.

- [ ] **Step 2: Run prompt tests and verify RED**

Run:
```bash
node --test --test-name-pattern="auto structured|auto pre-research" tests/deep-research.test.js
node --import tsx --test --test-name-pattern="auto.*proxy|proxy.*auto" packages/dsh/test/research-workflow.test.ts
node --test --test-name-pattern="provider" packages/core/test/skills.test.js
```

Expected: FAIL because orchestration defaults to Exa and has no auto instruction.

- [ ] **Step 3: Implement orchestration and skill guidance**

Add one auto branch to `_search_tool_instruction`; preserve the existing explicit-provider branches verbatim unless host mappings require otherwise. Update the shared and DSH skill documents without adding runtime host detection to Core.

- [ ] **Step 4: Run research and skill suites and verify GREEN**

Run:
```bash
node --test tests/deep-research.test.js packages/core/test/skills.test.js
node --import tsx --test packages/dsh/test/research-workflow.test.ts
python -m compileall -q packages/core/skills/deep-research/scripts
```

Expected: all research, prompt-rendering, and Python checks PASS.

---

### Task 10: Documentation, Live Smoke, and Full Verification

**Files:**
- Modify: `README.md`, `README.zh-cn.md`, `README.ja.md`, `README.ko.md`
- Modify: `AGENTS.md`, `packages/core/AGENTS.md`, `packages/codex/AGENTS.md`, `packages/dsh/AGENTS.md`, `packages/opencode/AGENTS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/specs/2026-11-24-search-mcp-proxy-design.md` status after verification
- Modify: `scripts/packed-harness.js` so the browser clean room registers the packed built-in Proxy
- Test: `packages/dsh/test/browser-job-board.spec.ts`
- Test: `tests/documentation.test.js`
- Create: `packages/core/test/search-proxy-live.test.js` skipped unless `OMAGENTS_LIVE_SEARCH_TEST=1`

- [ ] **Step 1: Strengthen documentation tests and verify RED**

Require every README to describe the `auto` default, Exa-first/Keenable-fallback behavior, no empty-result/auth fallback, 30-second-per-attempt bound, single-URL fetch, generic host tool names, explicit Exa opt-out, Codex reinstall lifecycle, native-tool/user-override boundary, and second-provider privacy implication. Retain existing keyed/public endpoints, public-tier limits, and logging assertions.

Run: `node --test --test-name-pattern="search provider guidance" tests/documentation.test.js`

Expected: FAIL because documentation still declares Exa the default.

- [ ] **Step 2: Synchronize all user and agent documentation**

Update all four README languages in the same edit pass. Replace the unreleased direct-Exa-default changelog wording with the approved auto behavior; do not invent a release version. Document the self-contained Core layout, Codex copy/reinstall contract, host rendering, research prompts, and verification commands in affected AGENTS guides.

- [ ] **Step 3: Add optional anonymous live smoke coverage**

The skipped-by-default test invokes the real Proxy against anonymous Exa and then forces a test-only Exa transport failure through `clientFactory` to exercise real anonymous Keenable. Pass an empty credential environment inside the test, request one result, and assert readable content plus `exa` and `keenable` provider metadata respectively. Never print responses, keys, queries, or target URLs on failure.

Run locally:
```bash
OMAGENTS_LIVE_SEARCH_TEST=1 node --test packages/core/test/search-proxy-live.test.js
```

Expected: both live smoke cases PASS when public services are available. Record any public-network/service failure separately; do not weaken deterministic tests or make this a CI dependency.

- [ ] **Step 4: Run formatting, focused suites, and complete tests**

Run:
```bash
npm run format
npm run format:check
python -m compileall -q packages/core/skills/deep-research/scripts
python -m compileall -q packages/core/skills/_shared/scripts
node --check packages/opencode/src/index.js
npm run build --workspace @omagents/omagents-dsh
npm test
git diff --check
```

Expected: every command exits 0; all root, Core, Codex, and DSH tests PASS.

- [ ] **Step 5: Verify real packages and browser composition**

First update the packed probe and browser expectations, then make the clean-room harness satisfy them:

- Extend `HOST_PROBE` in `scripts/test-packed-installs.js` to assert packed Core and copied Codex Proxy paths, inspect all six modules, and perform real offline initialize/tools/list stdio handshakes against both entries. Pin `auto` and scrub inherited search keys in the probe environment.
- Update `browser-job-board.spec.ts` to expect `mcp__websearch__search` and `mcp__websearch__fetch`, the packed absolute Proxy path, and five total local rows. Run the browser test once to verify RED while its harness still substitutes the `websearch` echo fixture.
- Remove only the user-owned `websearch` echo row in `scripts/packed-harness.js`; retain the other four offline echo fixtures and all user-precedence coverage from Task 8. Pin `auto` in the browser environment. Lazy backend initialization keeps startup and tools/list offline.

Then run:
```bash
npm run pack:all
npm run test:packed
npm run test:browser
```

Expected: all packed probes and browser checks PASS without public search calls. Inspect the Core and Codex tarballs/install output for the complete Proxy and absence of unintended test tooling or credentials.

- [ ] **Step 6: Perform final diff and requirement review**

Read the final diff and confirm every Acceptance Criterion in the spec. Update the spec status with actual verification evidence, leave the working tree uncommitted, and report test counts plus any live-smoke limitation honestly. Do not commit, tag, push, publish, or create a release.

---

## Completion Evidence Required

- Resolver/provider matrix and explicit-provider compatibility.
- Deterministic local MCP JSON/SSE/stdio tests for success, fallback, errors, cancellation, concurrency, and shutdown.
- Real OpenCode/DSH registration and DSH child-prompt evidence.
- Relocatable Codex Proxy handshake and reinstall credential replacement.
- Four-language documentation and updated project guides.
- Full unit, build, packed, offline, browser, and diff verification results.
- Optional anonymous live Exa/Keenable smoke result, clearly separated from deterministic release evidence.
