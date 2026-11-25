# OpenCode Package Guide

`packages/opencode` is `@omagents/omagents`, the OpenCode V1/V2 host package. It depends only on the exact aligned `@omagents/core` version. Read the root `AGENTS.md` first.

## Installation Surface

```bash
npx @omagents/omagents
```

The installer takes no positional argument. Only conventional `--help` and `--version` options are supported; unknown arguments fail. Do not add a Codex or other host dispatcher to this package. Core is an automatic dependency, not a separate user install.

## Plugin Contract

- `src/index.js` exports the plain dual descriptor `{ id, server, setup }` plus the named V1 plugin export. Do not import either OpenCode SDK package.
- V1 preserves `task(background: true)`; V2 uses native `subagent(...)` without a `background` argument, preserves structured child-session metadata, and keeps `sessionID` follow-up rounds native-only so historical notices never reactivate terminal Board records.
- `src/parallel.js` is the OpenCode lifecycle adapter over Core, not a host-neutral storage implementation.
- Skills and MCP entries come from Core. V2 preserves the upstream Superpowers bootstrap but suppresses its file-based skill registration so Core renders and registers all 33 skills exactly once; V1 injects Core's equivalent Superpowers documentation-path preference through its system prompt. User MCP configuration takes precedence, and local V2 servers retain their cold-cache startup timeout.
- Search configuration accepts exactly `auto`, `exa`, `keenable`, and `youcom`; unset or empty defaults to `auto`. Automatic mode registers Core's absolute local `search-proxy/index.mjs` as built-in `websearch`, while explicit providers preserve direct remote registration and explicit `youcom` uses `youdotcom`. V1/V2 expose automatic generic tools as `websearch_search` and single-URL `websearch_fetch`. The Proxy owns the one-attempt-per-call routing policy, not model prompts or host adapters. It initially follows Exa → Keenable → You.com; after a fallback-eligible Exa failure, every later call in the same Proxy process uses Keenable → You.com → Exa until the Proxy is recreated. This memory-only state is shared across sessions using the process and has no cooldown or persistence. Each 30-second backend attempt includes lazy initialization and the tool call, yielding an approximate 90-second upper bound after three attempts; success at any position leaves later clients untouched. Empty success, non-fallback failures, and cancellation stop the chain. Existing Exa/Keenable metadata remains unchanged, and a You.com success after two failures adds ordered `fallbacks` while retaining the first `fallback`. A user-owned `websearch` or `youdotcom` entry still wins and is never wrapped; host-native tools outside OmAgents registration are outside the failover guarantee. Backend initialization is lazy, so startup and `tools/list` stay offline. Eligible fallback can disclose the same query or URL to Exa, Keenable, and You.com; explicit `exa`, `keenable`, or `youcom` are direct single-provider opt-outs.
- Direct You.com uses optional `YDC_API_KEY`: keyed `https://api.you.com/mcp` sends `Authorization: Bearer <YDC_API_KEY>`, while keyless `https://api.you.com/mcp/free` sends no Authorization header and requires no OAuth flow. The [official You.com MCP documentation](https://you.com/docs/agents/mcp-server#choose-your-setup) advertises 100 queries/day for keyless use, which does not imply anonymous traffic or no logging. Automatic You.com attempts map `maxResults` to `count`, forward `query` to `you-search`, pass only `url` to `you-extract`, and omit unsupported `objective` and `maxCharacters` without rewriting queries or truncating responses locally. OpenCode's direct native names are `youdotcom_you-search` and `youdotcom_you-extract`.
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
