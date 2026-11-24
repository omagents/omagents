# Codex Package Guide

`packages/codex` is `@omagents/omagents-codex`, the standalone Codex host package. It depends only on the exact aligned `@omagents/core` version. Read the root `AGENTS.md` first.

## Installation Surface

```bash
npx @omagents/omagents-codex
```

The installer takes no positional argument. Only conventional `--help` and `--version` options are supported; unknown arguments fail. There is no compatibility dispatcher in the OpenCode package and no legacy root `.codex/` implementation. Core is installed automatically, not as a separate user plugin.

## Implementation Contract

- `bin/install.js` is the no-argument CLI and does not dispatch to another host.
- `src/setup.js` exports `installCodex(options?)` and `serializeTomlBasicString(value)`, renders Core skills for the explicit `codex` host, serializes Core MCP resolution, and generates Codex configuration and SessionStart artifacts. TOML basic strings must escape Windows backslashes, quotes, and control characters.
- `OMAGENTS_SEARCH_PROVIDER` accepts exactly `auto`, `exa`, `keenable`, and `youcom`; unset or empty defaults to `auto`. Automatic mode copies all six self-contained Core `search-proxy` modules into the plugin cache and points `.mcp.json` at that copied absolute `index.mjs`, never the source checkout, Core's npx cache, or a dependency path. The copied Proxy exposes `mcp__websearch__search` and single-URL `mcp__websearch__fetch`, follows Exa → Keenable → You.com with at most one 30-second attempt per provider, and has an approximate 90-second backend upper bound after three attempts. Empty success, non-fallback failures, and cancellation stop the chain. Existing Exa/Keenable metadata remains unchanged; You.com success after two eligible failures retains the first `fallback` and adds ordered `fallbacks` plus readable per-failure lines. Explicit providers retain direct registration and native tool names, with explicit `youcom` registered as `youdotcom`. `KEENABLE_API_KEY` is optional: keyed Keenable uses `https://api.keenable.ai/mcp` with `X-API-Key`, while keyless Keenable uses `https://api.keenable.ai/mcp-public`. Optional `YDC_API_KEY` selects keyed `https://api.you.com/mcp` with `Authorization: Bearer <YDC_API_KEY>` or keyless `https://api.you.com/mcp/free` without an Authorization header or OAuth flow. The [official You.com MCP documentation](https://you.com/docs/agents/mcp-server#choose-your-setup) advertises 100 queries/day for keyless use; keyless does not imply anonymous traffic or no provider logging. Automatic You.com attempts map `maxResults` to `count`, forward `query` to `you-search`, pass only `url` to `you-extract`, and omit unsupported `objective` and `maxCharacters` without local rewriting or truncation. Eligible fallback can disclose the same query or URL to Exa, Keenable, and You.com; explicit `exa`, `keenable`, or `youcom` are single-provider opt-outs. Provider and credentials are install-time snapshots: set them before installation, rerun the installer after changes, and restart Codex with the same environment; reinstallation refreshes the copied Proxy and replaces stale entries and credentials.
- Codex Bearer serialization is scoped by MCP server owner: `github` uses `bearer_token_env_var = "GITHUB_TOKEN"`, while direct `youdotcom` uses `bearer_token_env_var = "YDC_API_KEY"` instead of serializing its Bearer secret. Direct Codex/DSH-native You.com tool guidance uses `mcp__youdotcom__you-search` and `mcp__youdotcom__you-extract`. The plugin `.mcp.json` contract has no arbitrary environment indirection for Exa's `x-api-key`, Keenable's `X-API-Key`, automatic local Proxy `env` (including configured `YDC_API_KEY`), or Context7 stdio `env`; those configured values are stored in `.mcp.json`. Create private directories with mode `0700` and write or rewrite `.mcp.json` with mode `0600` on platforms honoring POSIX modes.
- Preserve Codex-native subagents. Do not install or emulate the OpenCode parallel engine, OpenCode Job Board tools, or DSH Web Job Board.
- Core supplies 18 OmAgents skills and pinned Superpowers supplies 15, for 33 total. Host-specific skill files are full-content overrides; do not detect hosts at runtime.
- User MCP configuration takes precedence. Resolve packaged hooks and assets through Core paths, never cwd or accidental npm hoisting.

Only `jinja2` is automatically provisioned. Optional Python tools remain on demand; use the `agents-python-tools` skill for environment and CLI guidance. Project overlays are created on demand and neither Python environment is automatically deleted.

## Verification

```bash
npm test --workspace @omagents/omagents-codex
node --test tests/documentation.test.js
npm test
npm run pack:all
npm run test:packed
```

Installer tests must cover generated artifacts, skills, MCP, Python hooks, idempotence, unknown arguments, and package contents without contacting external model services. Automatic-provider tests must prove the copied six-module Proxy handshakes after source and npx-cache paths are unavailable and that provider reinstall cases replace stale entries and credentials, including keyed/keyless You.com and `YDC_API_KEY`. Preserve Windows and Unix executable/path conventions.

## Release

All four packages share one version and are built, tested, packed, and published together. Publish Core first, then OpenCode, Codex, and DSH sequentially:

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

Codex has no dependency on another host. Versioning, publication, and Git mutations require explicit user authorization.
