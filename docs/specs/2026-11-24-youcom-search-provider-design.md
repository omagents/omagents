# You.com Search Provider Integration Design

Date: 2026-11-24
Status: Implemented; Task 7 synchronized documentation and fresh deterministic verification passed on 2026-11-25; optional public-network smoke NOT RUN

## Purpose

Extend the implemented Search MCP Proxy with You.com while preserving the existing Exa and Keenable contracts. The automatic route becomes `Exa → Keenable → You.com`; explicit `youcom` registration bypasses the Proxy just like explicit Exa and Keenable.

This document supplements `docs/specs/2026-11-24-search-mcp-proxy-design.md`. Where that baseline describes exactly two providers, this document defines the new provider-specific and three-attempt contract. All unrelated transport, lifecycle, host, storage, and installation behavior remains unchanged.

## Official Service Contract

The integration is based on You.com's official MCP documentation at `https://you.com/docs/agents/mcp-server#choose-your-setup` and Search API schema documentation:

- Keyed remote MCP: `https://api.you.com/mcp` with `Authorization: Bearer <YDC_API_KEY>`.
- Keyless remote MCP: `https://api.you.com/mcp/free`, with no API key, OAuth flow, or Authorization header.
- The keyless endpoint advertises `you-search`, `you-extract`, and `you-discover`, with 100 queries per day.
- Generic search maps to `you-search`; generic single-URL fetch maps to `you-extract`. Deprecated `you-contents` is not used.
- `you-search` accepts `query` and `count`; `count` accepts 1–100, covering the generic `maxResults` range of 1–50.
- `you-extract` accepts one `url`. Keyless callers may pass only `url`; the Proxy therefore uses that common subset for keyed and keyless calls.
- You.com has no direct equivalent for generic `objective` or `maxCharacters`.

A live You.com handshake is optional release evidence, not a deterministic CI dependency. A local connection timeout during design exploration is not evidence of service incompatibility.

## Confirmed Product Decisions

1. Add exactly one provider value, `youcom`; accepted non-empty values become `auto`, `exa`, `keenable`, and `youcom`.
2. Unset or empty `OMAGENTS_SEARCH_PROVIDER` continues to mean `auto`.
3. `auto` tries Exa once, then Keenable once after an eligible Exa failure, then You.com once after an eligible Keenable failure.
4. Every new generic call starts at Exa. There are no same-provider retries, sticky routes, circuit breakers, or cross-call provider affinity.
5. Each provider retains an independent 30-second attempt budget, including lazy initialization and the tool call. A three-attempt call therefore has an approximate 90-second backend upper bound.
6. Successful empty results, authentication/permission/parameter failures, explicit non-retryable failures, and caller cancellation stop the chain immediately. A non-fallback-eligible Keenable failure prevents a You.com attempt.
7. Explicit `youcom` uses the MCP registration name `youdotcom`; automatic success metadata uses the stable provider string `youcom`.
8. The credential variable is `YDC_API_KEY`. Credentials select keyed versus keyless You.com endpoints but never select a provider or reorder the automatic chain.
9. Generic `search` and `fetch` schemas remain unchanged. You.com omits unsupported `objective` and `maxCharacters` fields without local query rewriting or response truncation.
10. The implementation stays within the existing six built-ins-only Proxy modules. No npm runtime dependency, local You.com bridge process, or extra host-facing automatic MCP row is added.

## Provider Resolution

### Automatic mode

The local `websearch` command is unchanged. Its environment now forwards each configured `EXA_API_KEY`, `KEENABLE_API_KEY`, and `YDC_API_KEY`, omitting absent values. The host still sees only generic `search` and `fetch` tools.

The backend configuration adds:

```text
provider: youcom
keyed:   https://api.you.com/mcp       + Authorization: Bearer <YDC_API_KEY>
keyless: https://api.you.com/mcp/free  + no Authorization header
```

### Explicit mode

`OMAGENTS_SEARCH_PROVIDER=youcom` removes the built-in `websearch` and `keenable` search entries and registers `youdotcom` directly:

- Keyed: remote `https://api.you.com/mcp`, `oauth: false`, and the Bearer header.
- Keyless: remote `https://api.you.com/mcp/free`, `oauth: false`, and no headers.

Other explicit providers never emit a `youdotcom` entry. Existing user-owned MCP names retain precedence in every host; a user-owned `websearch` or `youdotcom` server is not wrapped and receives no automatic failover promise.

## Generic Argument Adaptation

| Generic argument | You.com native argument | Behavior |
| --- | --- | --- |
| `search.query` | `you-search.query` | Forward unchanged. |
| `search.objective` | none | Ignore only for the You.com attempt; earlier providers retain existing behavior. |
| `search.maxResults` | `you-search.count` | Forward the validated integer, default 10, range 1–50. |
| `fetch.url` | `you-extract.url` | Forward the single validated HTTP(S) URL. |
| `fetch.maxCharacters` | none | Ignore only for the You.com attempt; do not truncate content locally. |

The adapters do not send `formats`, `extraction_source`, `timeout`, `parse_effort`, `profile`, `tools`, or other provider-specific options. Generic validation still rejects unknown arguments before any backend traffic.

## Ordered Routing and Failure Behavior

The router replaces its hard-coded two-branch sequence with the fixed ordered list `exa`, `keenable`, `youcom` while retaining the existing attempt primitive:

1. Validate locally and begin the Exa attempt.
2. Return any valid success immediately, including empty content representing zero hits.
3. Append a failed attempt's bounded `{ provider, failure }` record to the current call's ordered history.
4. Stop when the failure is not fallback-eligible or the failed provider is You.com.
5. Otherwise start exactly one fresh attempt for the next provider.
6. Caller cancellation or Proxy shutdown rejects the owning call and never starts another provider.

Initialization and tool schemas remain lazy per provider. A successful earlier provider leaves every later client untouched. Transport/session invalidation remains scoped to the affected backend. Concurrent calls and shared initialization retain their existing behavior.

All-failed tool errors list only the attempts actually made, in route order, using bounded provider/category/status summaries. Raw backend messages, request bodies, target URLs, credentials, and response payloads are not exposed.

## Success Metadata Compatibility

Existing routes keep their exact `_meta.omagents` shape:

- Exa success: `{ provider: "exa", fallback: null }`.
- Keenable success: `{ provider: "keenable", fallback: { from: "exa", code } }`.

`fallback` continues to describe the first eligible failure that started fallback. A You.com success after two eligible failures adds `fallbacks` because this new case has no legacy consumers:

```json
{
  "provider": "youcom",
  "fallback": { "from": "exa", "code": "transport" },
  "fallbacks": [
    { "from": "exa", "code": "transport" },
    { "from": "keenable", "code": "timeout" }
  ]
}
```

The readable prefix retains `Provider: <provider>` and one `Fallback: <from> failed (<code>)` line per prior eligible failure. Existing Exa and Keenable prefixes remain byte-for-byte unchanged. Backend content ordering, `structuredContent`, and unrelated `_meta` fields remain preserved.

## Host and Credential Integration

### OpenCode and DSH

Automatic tools remain `websearch_search` / `websearch_fetch` on OpenCode and `mcp__websearch__search` / `mcp__websearch__fetch` on Codex and DSH.

Explicit You.com guidance names:

- OpenCode: `youdotcom_you-search` and `youdotcom_you-extract`.
- Codex/DSH: `mcp__youdotcom__you-search` and `mcp__youdotcom__you-extract`.

OpenCode and DSH production registration remains provider-neutral; their tests expand to prove Core's new definitions, headers, and precedence are preserved.

### Codex

Codex continues to copy all six Proxy modules and use an install-time environment snapshot. Local automatic Proxy `env` may contain `YDC_API_KEY` directly. For direct remote `youdotcom`, Codex writes `bearer_token_env_var = "YDC_API_KEY"` rather than serializing the secret or incorrectly using `GITHUB_TOKEN`.

Bearer serialization is scoped by MCP server owner: `github` maps to `GITHUB_TOKEN`, and `youdotcom` maps to `YDC_API_KEY`. Existing Exa `x-api-key`, Keenable `X-API-Key`, and Context7 stdio environment behavior remains unchanged. Reinstalling rewrites provider entries and removes stale You.com credentials; users rerun the installer and restart Codex after changing configuration.

## Streamable HTTP Compatibility

The existing remote client continues to prefer MCP `2025-06-18` and accept `2025-03-26`. Add a transport regression for SSE blank lines formed from mixed legal line endings, including `\n\r\n`, so a complete hosted response is not discarded as malformed. This is a generic parser correction, not a Tavily backend or a new protocol-version feature.

## Security and Privacy

- Add `YDC_API_KEY` to automatic and direct credential tests, environment scrubbing, and router redaction inputs.
- Never print API keys or Authorization headers. Public failures remain bounded and provider/category based.
- Automatic fallback can disclose the same query, optional objective, or target URL to Exa, Keenable, and You.com. You.com does not receive `objective` as a native argument, but earlier providers may have received it.
- Keyless means no account credential, not anonymous network traffic or absence of provider logging. Documentation must not imply otherwise.
- Explicit `exa` remains the direct single-provider opt-out from automatic disclosure; explicit `keenable` and `youcom` are also single-provider routes.
- Only OmAgents-registered Proxy calls receive the three-provider guarantee. Host-native tools and user-owned MCP registrations remain outside it.

## Research, Doctor, and Documentation

Deep Research accepts `youcom` in its Python provider whitelist. Automatic prompts describe the fixed three-provider chain and prohibit direct provider tools and model-driven fallback. Explicit You.com prompts exclusively name the direct tools above. Shared and DSH skill overrides, host rendering maps, and Doctor variants are updated together.

Doctor distinguishes configured route from runtime provider evidence. Actual Proxy metadata may report `exa`, `keenable`, or `youcom`; two-fallback history is read from `fallbacks` when present. Doctor reports credential presence only.

The root and package AGENTS guides, CHANGELOG, both design specifications' status references, and English, Simplified Chinese, Japanese, and Korean READMEs are updated in the same change. Documentation includes the 100-query/day keyless statement with its official source context, keyed/keyless URLs, parameter degradation, approximate 90-second bound, three-provider privacy disclosure, and Codex reinstall behavior.

## Verification and Acceptance Criteria

1. Resolver and adapter tests cover all provider values, keyed/keyless You.com, optional credentials, exact native arguments, and unsupported-value errors.
2. Router fixtures prove success at all three positions, no later initialization after success, full three-failure summaries, middle-provider non-fallback stopping, cancellation before each later attempt, per-call Exa restart, unchanged legacy metadata, and new ordered `fallbacks` history.
3. Redaction tests include You.com keys and backend echoes without exposing raw payloads.
4. SSE tests cover mixed line-ending frame boundaries without regressing fragmented CRLF, comments, multiline data, and unrelated IDs.
5. OpenCode V1/V2, Codex, and DSH tests prove registration, precedence, keyed/keyless behavior, correct Bearer environment indirection, relocation, and stale-credential replacement.
6. Research and Doctor tests cover automatic and explicit You.com routing on every host, including actual native DSH child prompts.
7. Packed and browser probes remain offline, pin `auto`, scrub inherited You.com credentials, retain exactly two generic tools, and do not add an automatic host MCP row.
8. Optional public-network smoke remains opt-in through `OMAGENTS_LIVE_SEARCH_TEST=1` and adds a forced-Exa/Keenable failure route to anonymous You.com. It never joins deterministic CI.
9. Full static, unit, package, and browser verification passes after implementation. Any unavailable optional live route is reported separately rather than represented as deterministic evidence.
10. No Git mutation, package publication, version change, or release action occurs without separate explicit authorization.

## Task 7 Final Verification — 2026-11-25

This section records only fresh Task 7 evidence. Tasks 1–6 were already complete and independently approved; their earlier results are not repeated as new evidence. The optional public-network smoke was **NOT RUN**. No public provider calls or external model credentials were used, and no version, release, publication, or Git mutation occurred.

### Documentation TDD and Formatting

- RED: `node --test tests/documentation.test.js` exited 1 with 17 tests, 15 passed, 2 failed, and 0 skipped. The two new contract tests failed on the expected missing documentation: `README.md` omitted `youcom`, and `AGENTS.md` omitted the expanded provider list.
- Initial GREEN: `node --test tests/documentation.test.js && npm run format:check` exited 0. Documentation passed 17/17 with 0 skipped, and Prettier reported that all matched files used the required style. No formatting rewrite was needed.
- Important-review fix: a temporary test copy under `/tmp/opencode` applied non-destructive in-memory mutations to the current documents. It exited 1 as expected with 47 tests: the 19 unmodified-document tests passed and all 28 intentional stale-contract/semantic-clause mutants failed. Permanent in-memory mutation regressions were added to `tests/documentation.test.js`; the final documentation/format rerun passed 19/19 with 0 skipped and Prettier passed. No documentation prose correction was needed.

### Deterministic Release-Candidate Gate

| Command | Exit | Fresh result |
| --- | ---: | --- |
| `node --check packages/opencode/src/index.js` | 0 | No diagnostics. |
| `python -m compileall -q packages/core/skills/deep-research/scripts && python -m compileall -q packages/core/skills/_shared/scripts` | 0 | Both compile checks passed without output. |
| `npm run typecheck --workspace @omagents/omagents-dsh` | 0 | TypeScript `--noEmit` passed. |
| `npm test` | 0 | 573 tests: 570 passed, 3 skipped, 0 failed. Root/OpenCode 205/205, Codex 18/18, Core 220/223 with the three default-skipped public-network cases, and DSH 127/127. The nested Python layout suite also passed 11/11. |
| `npm run pack:all && npm run test:packed` | 0 | Four aligned tarballs were produced: Core 326 files, OpenCode 7, Codex 3, and DSH 57. The offline cache was current with 675 locked packages; packed verification passed 3/3 with 0 skipped. |
| `npm run test:browser` | 0 | Packed DSH Web composition passed 1/1 with 0 skipped, reusing the fresh packed clean room. |
| `git diff --check` | 0 | No whitespace errors. |

The three skipped Core cases were the opt-in live Exa, forced-fallback Keenable, and forced-two-fallback You.com public-network smokes. No deterministic test failure, cancellation, or unexpected warning occurred. Two passing test names contain the word “warns” for intentional missing-Superpowers behavior; they are not warnings from the gate.

Playwright emitted the following warning three times: `BEWARE: your OS is not officially supported by Playwright; downloading fallback build for ubuntu24.04-x64.` The browser pass is therefore scoped only to this local Linux x64 fallback execution. It does not establish official Playwright support for the local OS, coverage on macOS or Windows, or a fresh result for the previously documented default pinned Chromium build.
