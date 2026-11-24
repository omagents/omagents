# Automatic Search MCP Proxy Design

Date: 2026-11-24
Status: Implemented baseline extended by `docs/specs/2026-11-24-youcom-search-provider-design.md`; the two-provider contract and verification below are historical pre-You.com evidence, including its optional live-smoke record and deferred Minor

## Purpose

Add `OMAGENTS_SEARCH_PROVIDER=auto` and make it the default when the variable is unset or empty. In `auto`, a local Search MCP Proxy calls Exa first and calls Keenable only when the Exa invocation fails in a fallback-eligible way. A successful Exa response, including an empty search result, never falls back.

The Proxy gives OpenCode, Codex, and DSH one programmatic failover implementation. It does not ask the model to notice errors and switch tools. Explicit `exa` and `keenable` configurations retain their current direct-registration behavior.

## Confirmed Product Decisions

1. Support exactly these non-empty provider values: `auto`, `exa`, and `keenable`.
2. Unset or empty `OMAGENTS_SEARCH_PROVIDER` means `auto`.
3. `auto` means Exa first, then at most one Keenable attempt after a fallback-eligible Exa failure.
4. Successful empty results, authentication failures, permission failures, invalid parameters, and caller cancellation do not fall back.
5. Each backend attempt has a 30-second budget, including lazy initialization and the tool call.
6. The Proxy exposes generic `search` and single-URL `fetch` tools.
7. Backend response bodies remain readable MCP content. The Proxy adds provider and fallback metadata instead of lossy result parsing.
8. Explicit `exa` and `keenable` continue to bypass the Proxy.
9. Only calls made through the Proxy guarantee failover. Host-native web tools that a host does not allow OmAgents to disable remain outside that guarantee.

## Goals

- Provide deterministic, testable Exa-to-Keenable failover in one Core-owned component.
- Present the same generic search/fetch contract on every supported host.
- Preserve zero-configuration use through anonymous Exa and keyless Keenable.
- Keep API keys optional and prevent credentials from selecting a provider.
- Keep backend initialization lazy and isolate an unused Keenable failure from Exa.
- Bound each call, redact credentials from errors, and expose the actual backend used.
- Preserve explicit-provider behavior, user MCP precedence, Codex reinstall semantics, and host-neutral Core boundaries.
- Update Deep Research, Doctor, project guidance, all four README languages, tests, and packed artifacts together.

## Non-Goals

- A transparent proxy for arbitrary MCP servers or tools.
- Search-result merging, ranking, deduplication, or querying both providers on every call.
- Fallback after a successful empty result.
- Fallback after known authentication, authorization, or parameter errors.
- Batch URL fetching in the generic Proxy contract.
- A shared normalized schema for provider-specific titles, snippets, dates, or page bodies.
- Search-result or response caching, circuit breaking, sticky failover, cross-request provider affinity, or additional retries. Per-session MCP tool-schema caching is allowed.
- Disabling or replacing host-native web tools outside OmAgents' MCP registration surface.
- A hosted Proxy service, a second application root, or any browser UI.
- A new npm package or a runtime dependency on a host SDK.

## Architecture

```text
OpenCode / Codex / DSH
        │ stdio MCP: websearch.search / websearch.fetch
        ▼
Core-owned local Search MCP Proxy
        │
        ├── Exa adapter ───────► https://mcp.exa.ai/mcp
        │                          web_search_exa / web_fetch_exa
        │
        └── Keenable adapter ──► https://api.keenable.ai/mcp
                                   or /mcp-public
                                   search_web_pages / fetch_page_content
```

The Proxy is an MCP server toward the host and an MCP client toward the two hosted providers. It owns argument adaptation, bounded invocation, failure classification, failover, response metadata, and backend session lifecycle.

In `auto`, the host sees only the built-in `websearch` Proxy entry. The two backend MCP servers are not separately registered as model-facing host tools. Explicit `exa` and `keenable` keep the existing direct entries and tool names.

## Core Components and Layout

Add a self-contained directory beneath Core's existing packaged MCP assets:

```text
packages/core/mcp-servers/search-proxy/
├── index.mjs              # stdio entry point and process lifecycle
├── stdio-server.mjs       # JSON-RPC/MCP request handling
├── remote-client.mjs      # Streamable HTTP client for hosted MCP backends
├── router.mjs             # generic tools, attempt budget, and failover
├── backends.mjs           # Exa/Keenable endpoints and argument adapters
└── errors.mjs             # error categories, stable codes, and redaction
```

Responsibilities are deliberately separated:

- `index.mjs` wires stdin/stdout, shutdown, and cancellation without containing routing policy.
- `stdio-server.mjs` implements only the required MCP server surface: initialize, initialized notification, ping, tools/list, tools/call, request cancellation, unknown-method errors, and stdin-close cleanup.
- `remote-client.mjs` implements the required Streamable HTTP client surface: initialize, initialized notification, tools/list, tools/call, session headers, JSON and SSE responses, request abort, and session invalidation. It does not implement unrelated MCP features.
- `router.mjs` validates generic arguments and executes the approved attempt sequence.
- `backends.mjs` maps generic arguments to backend tool names and arguments. It contains no host-specific names or control flow.
- `errors.mjs` converts transport, HTTP, protocol, and tool failures into stable categories without serializing secrets.

These modules use Node.js built-ins only. Core, OpenCode, and Codex retain their plain-JavaScript, no-product-build workflow. The directory is self-contained so Codex can copy it without copying Core's npm dependencies or referencing an npx temporary directory.

## Provider Resolution

`resolveMcpServers()` accepts `auto` and defaults unset or empty values to `auto`. Any other non-empty value fails with a message listing `auto`, `exa`, and `keenable`.

In `auto`, the canonical `websearch` definition is local:

```json
{
  "type": "local",
  "command": ["node", "/absolute/path/to/search-proxy/index.mjs"],
  "environment": {
    "EXA_API_KEY": "only when configured",
    "KEENABLE_API_KEY": "only when configured"
  }
}
```

The actual environment object omits absent keys; the strings above are illustrative, not defaults. `OMAGENTS_SEARCH_PROVIDER` need not be passed to the Proxy because its presence already means `auto`.

Core resolves its own Proxy entry through `import.meta.url`, never the working directory. An optional explicit Proxy-entry override in the resolver supports Codex's copied asset without runtime host detection. OpenCode and DSH use Core's default absolute entry.

The base catalog remains host-neutral. OpenCode V1/V2, Codex, and DSH continue to apply their existing registration precedence and serialization rules. A user-defined `websearch` server still takes precedence; such a custom server is not wrapped automatically and therefore is not promised OmAgents failover.

Using the `node` executable keeps the child command independent of the host's own executable format. All supported installation paths already require Node.js tooling.

## Public Tool Contract

The Proxy server name remains `websearch`, and it exposes exactly two tools.

### `search`

```json
{
  "query": "required non-empty search query",
  "objective": "optional ranking objective, at most 1000 characters",
  "maxResults": 10
}
```

- `query` is a non-empty string.
- `objective` is optional and limited to 1,000 characters, the common lower bound of the two providers.
- `maxResults` is an integer from 1 through 50 and defaults to 10.
- Unknown arguments are rejected before any backend request.

Argument mapping:

| Generic argument | Exa `web_search_exa`       | Keenable `search_web_pages` |
| ---------------- | -------------------------- | --------------------------- |
| `query`          | `query`                    | `query`                     |
| `objective`      | `objective` when supported | `objective` when supplied   |
| `maxResults`     | `numResults`               | `max_results`               |

The hosted Exa schema has existed both with and without `objective`. During lazy initialization the Proxy reads the backend tool schema. If Exa accepts or requires `objective`, the Proxy sends the supplied objective, or `query` when no objective was supplied and Exa requires one. If Exa's schema has no `objective` property, the Proxy omits it. This avoids breaking either hosted schema while retaining the stable generic contract.

Keenable receives no `mode`, so keyless `/mcp-public` and keyed `/mcp` behavior remain compatible.

### `fetch`

```json
{
  "url": "https://example.com/article",
  "maxCharacters": 12000
}
```

- `url` is one absolute `http` or `https` URL.
- `maxCharacters` is an optional positive integer.
- Unknown arguments are rejected before any backend request.

Argument mapping:

| Generic argument | Exa `web_fetch_exa` | Keenable `fetch_page_content` |
| ---------------- | ------------------- | ----------------------------- |
| `url`            | `urls: [url]`       | `urls: [url]`                 |
| `maxCharacters`  | `maxCharacters`     | `max_chars`                   |

The generic contract deliberately accepts one URL. Keenable's keyless tier rejects multi-URL calls, and restricting the first version avoids fan-out, partial batch success, and rate-limit amplification. Explicit direct providers retain their native batch capabilities.

The Proxy sends only the URL to the backend MCP services; it does not fetch the target page itself. Backend private-address and page-validation rules therefore remain in force.

## Invocation and Failover Flow

For each generic tool call:

1. Validate the complete generic arguments locally. Reject invalid input without contacting a backend.
2. Start a 30-second Exa attempt budget. Lazily initialize Exa when necessary, read its tool schemas once for that session, and invoke the mapped tool.
3. If Exa returns a valid successful result, return it with `provider: "exa"` and `fallback: null`. A valid empty search result is success.
4. If Exa returns a known non-fallback failure, return that error without contacting Keenable.
5. If Exa returns a fallback-eligible failure, invalidate any broken Exa session, retain a redacted failure descriptor, and start a fresh 30-second Keenable attempt budget.
6. Lazily initialize Keenable when necessary and invoke the corresponding mapped tool. A Keenable initialization failure affects only this attempt and does not retroactively change an Exa success.
7. If Keenable succeeds, return its content with `provider: "keenable"` and fallback metadata describing the Exa failure.
8. If Keenable also fails, return an MCP tool error containing redacted summaries of both attempts.

There is no third attempt and no internal retry around either provider. Every new generic call starts with Exa again; the Proxy does not remember a preferred fallback provider across calls.

A caller cancellation or Proxy shutdown aborts the active request and never triggers another backend attempt. Late responses cannot emit a second result or start fallback after the owning call has settled.

## Response Contract

Successful backend MCP `content` items are retained in their original order. The Proxy prepends a small text item so hosts that expose only model-readable content still show the actual route:

```text
Provider: keenable
Fallback: exa failed (timeout)

<original backend content items follow>
```

The MCP result also contains:

```json
{
  "_meta": {
    "omagents": {
      "provider": "keenable",
      "fallback": {
        "from": "exa",
        "code": "timeout"
      }
    }
  }
}
```

For an Exa success, `provider` is `exa` and `fallback` is `null`. Fallback codes are stable machine-readable categories such as `timeout`, `http_429`, `http_503`, `transport`, `protocol`, and `backend_error`; raw backend messages are not used as codes.

The Proxy does not promise a common provider-specific result body. This avoids fragile parsing of human-readable search results and preserves information when either provider changes its formatting. Backend `structuredContent` is not required by the generic contract; readable `content` is the compatibility surface. A purported success without a valid MCP `content` array is a malformed protocol response and is fallback-eligible; a valid result whose content reports zero search hits remains a success.

Errors use MCP `isError: true`. They never convert failure into a successful empty result. When both providers fail, the error identifies both providers and their stable failure categories. Error details are bounded in length and redacted.

## Failure Classification

Caller cancellation and local validation are handled before backend classification. For backend failures, explicit authentication, permission, parameter, and `Retryable: no` markers take precedence over generic fallback heuristics. Remaining failures use structured status/code information first, then explicit backend retryability text when the hosted MCP wraps an error inside a tool result. An MCP session-invalidation response is classified as a transport/session failure, not confused with a backend tool or target-page 404.

### Fallback-eligible

- DNS, network, connection, TLS transport, and Streamable HTTP session failures.
- Timeouts and aborted backend attempts not requested by the caller.
- MCP protocol failures and malformed backend responses.
- HTTP 408, 429, and 5xx responses.
- Explicit temporary, unavailable, rate-limit, or `Retryable: yes` backend failures.
- A backend `isError` whose category cannot be determined. This availability-oriented default applies only after known non-fallback categories have been excluded; both failures remain visible if fallback also fails.

### Not fallback-eligible

- A valid successful result, including no search hits.
- Local generic-argument validation errors.
- Backend tool-result HTTP 400, 401, 403, 404, and 422, excluding the MCP session-invalidation transport case described above.
- Known authentication, authorization, invalid-parameter, and permission errors.
- Explicit `Retryable: no` failures.
- Caller cancellation, stdin closure, or process shutdown.

Explicit non-retryable markers take precedence over generic status-based and unknown-tool-error fallback rules. In particular, an invalid configured Exa key must remain visible rather than being silently hidden by Keenable traffic.

## Timeouts, Concurrency, and Lifecycle

- Each backend attempt has one 30-second deadline covering connection initialization, tools/list, and tools/call.
- An `auto` call therefore has an approximate 60-second worst-case backend budget, excluding small local processing time.
- AbortController or equivalent built-in cancellation stops the active HTTP request. Late data is ignored.
- Backend sessions are lazy and may be shared by concurrent calls. Initialization is coalesced per backend so concurrent first calls do not create competing sessions.
- Tool schemas are cached only for the lifetime of that backend session; this is protocol metadata caching, not search-result caching.
- A transport/session failure invalidates only the affected backend session. A later call may initialize it again.
- There is no health cache, circuit breaker, background reconnect, periodic polling, or cross-call failover state.
- Proxy shutdown aborts active calls, closes input handling, and prevents late backend completion from writing to stdout.

## Host Integration

### OpenCode

The generic tools appear as `websearch_search` and `websearch_fetch`. V1 and V2 use their existing local-MCP registration paths. V2 retains its local-server startup timeout and user-configuration precedence.

Explicit `exa` continues to expose the current Exa tools, and explicit `keenable` continues to expose `keenable_search_web_pages` and `keenable_fetch_page_content`.

### Codex and DSH

The generic tools appear as `mcp__websearch__search` and `mcp__websearch__fetch`.

Explicit `exa` retains current native `web_search` / `web_fetch` skill mappings, and explicit `keenable` retains `mcp__keenable__search_web_pages` / `mcp__keenable__fetch_page_content`.

In `auto`, skill rendering and actual research-child prompts name only the generic Proxy tools for web research. They do not map those tools to native host web tools, because doing so would bypass failover.

Host-native web tools that cannot be disabled through OmAgents remain outside the failover guarantee. OmAgents guidance must not claim that every possible host web call is intercepted.

### Codex Installation and Reinstallation

The installer copies the complete self-contained `search-proxy` directory into the Codex plugin cache. The generated `.mcp.json` points to that copied absolute entry, not to the source checkout, Core's npx cache, or a package-dependency path.

Provider and credential configuration remains an install-time snapshot:

1. Set provider and keys before installation.
2. Rerun the installer after changing them.
3. Restart Codex with the intended environment.

Reinstallation removes stale copied Proxy files, provider entries, and credentials. `.mcp.json` keeps mode `0600`, and private directories keep mode `0700` on platforms honoring POSIX modes. Proxy source files do not contain embedded credentials.

OpenCode and DSH resolve the route at host startup, while Codex continues to require reinstall after configuration changes.

## Security and Privacy

- `EXA_API_KEY` and `KEENABLE_API_KEY` remain optional and never select a provider by themselves.
- Keyed Keenable uses `https://api.keenable.ai/mcp` with `X-API-Key`; keyless Keenable uses `https://api.keenable.ai/mcp-public`.
- Exa uses `https://mcp.exa.ai/mcp`, with `x-api-key` only when configured.
- The Proxy does not persist queries, URLs, responses, credentials, sessions, or fallback history to disk.
- Proxy diagnostics do not log request payloads, target URLs, authorization headers, API keys, or complete backend responses.
- Redaction covers Exa and Keenable keys, authorization headers, header-shaped secrets, credential-bearing URLs, and backend-echoed request queries or target URLs. Error summaries omit those payloads rather than reproducing them, and error text is length-bounded.
- Backend privacy behavior is unchanged. Documentation retains Keenable public-tier rate limits and logging disclosures, and explains that fallback can send the same search or URL to Keenable after an Exa failure.
- Users who do not want a second provider to receive a failed request must select explicit `exa` or `keenable` instead of `auto`.

## Deep Research, Doctor, and Documentation

Deep Research's shared skill, DSH override, and Python orchestrator accept `auto`. Structured dispatches and pre-research instructions continue to carry `search_provider`, with `auto` producing exact generic Proxy tool names for OpenCode and Codex/DSH. The prompt describes the Proxy as the only web search/fetch route for that research task; it does not instruct the child to implement fallback itself.

Explicit `exa` and `keenable` retain their current exclusive provider instructions and regression coverage.

Doctor guidance distinguishes:

- configured route: `auto (Exa → Keenable)`, Exa only, or Keenable only;
- configured credentials without exposing their values;
- local Proxy registration versus direct remote registration;
- the provider reported by an actual Proxy response, which is runtime evidence rather than configuration inference;
- the fact that native host web calls and user-overridden `websearch` entries are outside automatic failover.

The root and package AGENTS guides, CHANGELOG, and English, Simplified Chinese, Japanese, and Korean READMEs are updated together. User documentation includes the new default, failure semantics, timeout bound, generic tool names, single-URL limitation, Codex reinstall requirement, privacy implication, and explicit-provider opt-out.

## Compatibility and Rollout

This intentionally changes the zero-configuration default from direct Exa to the Proxy. Unset and empty configurations therefore gain a new default tool surface. Users requiring the old direct behavior can set `OMAGENTS_SEARCH_PROVIDER=exa` before host startup or Codex installation.

There is no automatic migration of user MCP configuration, no second built-in Proxy registration, and no alias that silently wraps a user-owned `websearch` server. Existing unrelated MCP servers, Superpowers skills, Python environments, Job Board behavior, and host installation commands remain unchanged.

The current unified-provider implementation and its regressions are the baseline. The `auto` work extends that design rather than retaining an additional legacy direct-Exa default.

## Verification Design

### Unit and Contract Tests

- Resolver matrix for unset, empty, `auto`, `exa`, `keenable`, and unsupported values.
- Optional-key behavior for both providers and proof that credentials never select a provider.
- Absolute, cwd-independent Proxy command resolution and no mutation of supplied environments.
- Search/fetch argument mapping, Exa objective-schema variants, validation boundaries, and single-URL behavior.
- Provider/fallback metadata and credential redaction.

### Local MCP Integration Tests

Use real local stdio and Streamable HTTP fixtures; no external model API key is required.

Cover:

- Exa success without initializing Keenable.
- Successful empty Exa results without fallback.
- Fallback on transport failure, timeout, 408, 429, 5xx, protocol failure, and unknown tool error.
- No fallback on known authentication, permission, parameter, 404, non-retryable, or caller-cancellation outcomes.
- Keenable success after Exa failure and dual failure with both redacted summaries.
- Exactly one attempt per backend and no extra retry amplification.
- Lazy initialization coalescing, concurrent independent calls, session invalidation, and later reinitialization.
- Cancellation, late responses, stdin closure, and repeat-safe shutdown.
- JSON and SSE backend responses and session-header propagation.

### Host and Packaging Tests

- OpenCode V1/V2 registration, startup shape, and user `websearch` precedence.
- DSH canonical registration, real native-child prompt content, and host-native tool-name mapping without wrong-host flow.
- Codex generated config, copied Proxy independence from source/Core paths, private modes, and Exa-to-auto-to-Keenable reinstall replacement.
- Deep Research pre-research and structured-dispatch prompts for `auto`, plus existing explicit-provider regressions.
- Doctor and synchronized documentation assertions.
- Packed artifact inspection proving the complete self-contained Proxy is present in Core and Codex installation output.

### Full Verification Gate

Run formatting and syntax checks, Python compile checks, Core/Codex/OpenCode focused suites, DSH build and tests, complete `npm test`, `git diff --check`, `npm run pack:all`, offline `npm run test:packed`, and `npm run test:browser`.

Perform a separate anonymous live smoke check against the real hosted Exa and Keenable MCP endpoints to confirm current schemas and response envelopes. Public-network availability must not be a CI failure condition; deterministic local fixtures remain the release gate.

## Acceptance Criteria

The design is implemented successfully when:

1. Default and explicit `auto` configurations expose only the generic local Proxy for built-in web search.
2. A real Proxy call uses Exa first and reports the provider used.
3. Fallback-eligible Exa failures cause exactly one Keenable attempt, while successful empty results and known non-fallback errors do not fall back.
4. Both credentials remain optional, secrets never appear in diagnostics, and keyless endpoints work.
5. Explicit providers and user MCP precedence retain their established behavior.
6. Codex can run the copied Proxy after source and npx-cache paths are unavailable, and reinstall removes stale credentials.
7. Deep Research children on all hosts receive the correct generic Proxy instructions.
8. Documentation and all verification suites reflect the new default and the precise failover guarantee boundary.

## Implementation Verification — 2026-11-24

The complete tracked-plus-untracked scoped diff received an author self-review after Tasks 1–10. No subagent or independent reviewer was used for this final pass. The review found no Critical or Important issue and assessed all eight Acceptance Criteria as satisfied by the evidence below.

### Deterministic Release Evidence

- Formatting, Python compilation, OpenCode syntax, DSH build, and `git diff --check` completed successfully.
- Complete `npm test`: 515 tests, 513 passed, 2 skipped, 0 failed. Root/OpenCode passed 190/190, Codex 16/16, Core 184/184 with the two default-skipped live cases, and DSH 123/123.
- `npm run test:packed`: 3/3 passed, including offline initialize and `tools/list` stdio handshakes against packed Core and copied Codex Proxy entries.
- `npm run test:browser`: 1/1 passed against the packed DSH Web composition with five local MCP rows: the built-in Proxy and four unrelated offline echo fixtures. Proxy startup and `tools/list` remained offline through lazy backend initialization.
- Real artifact inspection found exactly six Proxy modules in the Core tarball, installed Core, and copied Codex runtime. The copied modules were byte-identical to Core's modules; the copied runtime contained no test tooling, generated `websearch` credential environment, or unexpected Keenable entry.
- The optional live smoke file is absent from CI provider configuration and skips both cases unless `OMAGENTS_LIVE_SEARCH_TEST=1` is explicitly set.

### Acceptance Criteria Assessment

| Criterion                                                                                         | Result    | Evidence                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Default and explicit `auto` expose only the generic local Proxy                                | Satisfied | Resolver matrix, OpenCode V1/V2 and DSH registration tests, packed Core handshake, and packed browser tool/path assertions.                                                                                                                                          |
| 2. A real Proxy call uses Exa first and reports the provider                                      | Satisfied | Real loopback Streamable HTTP/stdio integration tests establish Exa-first routing and metadata; the separate anonymous live Exa smoke also returned readable content with `provider: "exa"`.                                                                         |
| 3. Eligible failures fall back exactly once; empty success and known non-fallback outcomes do not | Satisfied | Deterministic router/remote/stdio cases cover eligible transport, timeout, HTTP, protocol, and unknown-tool failures; empty results, authentication/permission/parameter/non-retryable failures, and caller cancellation; attempt counts and dual-failure summaries. |
| 4. Credentials are optional, diagnostics are redacted, and keyless endpoints work                 | Satisfied | Resolver/backend matrices and redaction tests cover absent/present keys and secret/query/URL suppression; anonymous live Exa and forced-fallback anonymous Keenable smoke both passed.                                                                               |
| 5. Explicit providers and user MCP precedence remain compatible                                   | Satisfied | Core, OpenCode, Codex, and DSH explicit-provider and user-override regressions retained direct registration, native names, and precedence.                                                                                                                           |
| 6. Codex runs a relocatable copied Proxy and reinstall replaces stale credentials                 | Satisfied | Codex installer/regression tests and packed offline handshake prove independence from source/Core/npx-cache paths; Exa → auto → Keenable reinstall tests cover stale entry and credential replacement.                                                               |
| 7. Deep Research children receive correct generic Proxy instructions on all hosts                 | Satisfied | Actual structured/pre-research dispatch tests, all-host rendering tests, and native DSH activation-prompt checks cover `auto` plus explicit-provider regressions.                                                                                                    |
| 8. Documentation and verification reflect the default and guarantee boundary                      | Satisfied | Four synchronized README languages, five affected AGENTS guides, unreleased CHANGELOG wording, documentation assertions, and the complete deterministic gates above.                                                                                                 |

### Deferred Minor

`remote-client.mjs` validates the tool-result envelope and text blocks, but non-text content blocks are checked only for a non-empty `type`; type-specific required fields are not validated. A malformed non-text provider result could therefore pass through as success instead of becoming a fallback-eligible protocol failure. The verified text response path is unaffected, and no credential or security impact was identified. This remains an explicitly deferred protocol-hardening Minor, not a silently closed finding.

## Final Fix Verification — 2026-11-24

The original implementation evidence above remains the historical pre-review record. This final-fix section records the refreshed results after the whole-change review identified valid JSON-RPC error misclassification and stale transport invalidation as Important findings.

- Strict RED regressions failed as expected before production changes: all 16 HTTP-200 JSON-RPC remote/router category cases, plus both delayed-A/S1 versus C/S2 generation cases. The focused GREEN runs then passed 16/16 and 3/3 respectively.
- Remote-client and router regressions now cover invalid parameters, authentication, permission, explicit `Retryable: no`, temporary failure, explicit `Retryable: yes`, and unclassified backend availability failures. They assert fallback precedence, stable summaries, and suppression of backend details, credentials, queries, objectives, and URLs.
- The deterministic delayed-failure regressions prove that S1 cannot clear or abort C's S2 while S2 is initializing or ready, while B's current-generation failure still forces reinitialization. Existing cached-header, coalesced-readiness, one-cancelled-waiter, late-initialize isolation, and repeat-safe close regressions remain green.
- Focused Proxy suites: 130 tests, 128 passed, 2 default-skipped live cases, 0 failed.
- Formatting, format checking, both Python compilation checks, OpenCode syntax checking, DSH build, and `git diff --check` completed successfully.
- Complete `npm test`: 534 tests, 532 passed, 2 skipped, 0 failed. Root/OpenCode passed 190/190, Codex 16/16, Core 203/205 with the two default-skipped live cases, and DSH 123/123.
- `npm run pack:all` produced all four aligned tarballs. `npm run test:packed` passed 3/3 in the offline clean room, and `npm run test:browser` passed 1/1 against the packed DSH Web composition.
- The separate opt-in anonymous live smoke passed 2/2, covering direct Exa and forced-fallback Keenable. It emitted only test counts and status into the final-fix evidence, not response payloads, credentials, queries, or URLs.

### Final AC4 Status

**Satisfied.** Optional-credential and keyless behavior remains intact, the new HTTP-200 JSON-RPC cases prove bounded provider/category summaries without raw response or cause leakage, packed/browser gates remain green, and the separate anonymous live Exa and Keenable checks both passed. The deferred non-text content behavior is unchanged and remains non-blocking.
