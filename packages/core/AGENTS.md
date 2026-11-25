# Core Package Guide

`packages/core` is `@omagents/core`, the automatic shared dependency of OpenCode, Codex, and DSH. It is not a standalone user plugin and has no separate installation command. Read the root `AGENTS.md` first.

## Boundaries

Core must remain host-neutral. Do not import OpenCode, Codex, DSH, Cordis, React, or host SDK packages. Host adapters inject storage paths, lifecycle queries, cancellation, event delivery, and presentation behavior.

- `src/job-board/`: execution state, independent notification state, transitions, and presenters.
- `src/storage/`: validated, versioned, serialized, atomic JSON persistence and recovery.
- `src/skills/`: discovery and full-content rendering for exactly `opencode-v1`, `opencode-v2`, `codex`, and `dsh`.
- `src/mcp/` and `mcp-servers/base.json`: canonical environment-dependent MCP resolution. `OMAGENTS_SEARCH_PROVIDER` accepts exactly `auto`, `exa`, `keenable`, and `youcom`; unset or empty defaults to `auto`. Explicit providers retain direct registration, with explicit `youcom` named `youdotcom`.
- `mcp-servers/search-proxy/`: self-contained Node.js built-ins-only Proxy with exactly six modules: `index.mjs`, `stdio-server.mjs`, `remote-client.mjs`, `router.mjs`, `backends.mjs`, and `errors.mjs`. It exposes generic `search`/single-URL `fetch` and initially follows Exa → Keenable → You.com with at most one attempt per provider per call after fallback-eligible failures. After a fallback-eligible Exa failure, every later call in the same Router/Proxy process uses Keenable → You.com → Exa until that process is recreated; the memory-only state is shared across sessions using the process, is not session-scoped or persisted, and has no cooldown. Empty success, auth/permission/parameter/non-retryable failures, and cancellation never fall back or change the order. Each backend attempt has a 30-second budget including lazy initialization and the tool call, producing an approximate 90-second backend upper bound after three attempts; there is no fourth attempt or model-driven failover. Initialization is lazy and errors are redacted. Existing Exa/Keenable metadata is unchanged, while a twice-fallen-back You.com success retains the first `fallback` and adds ordered `fallbacks` plus readable per-failure lines. Eligible fallback can disclose the same query or URL to Exa, Keenable, and You.com; explicit `exa`, `keenable`, or `youcom` are single-provider opt-outs, and user-owned or host-native tools remain outside the guarantee.
- You.com resolution and adaptation: optional `YDC_API_KEY` selects keyed `https://api.you.com/mcp` with `Authorization: Bearer <YDC_API_KEY>` or keyless `https://api.you.com/mcp/free` without an Authorization header or OAuth flow, but never selects a provider. The [official You.com MCP documentation](https://you.com/docs/agents/mcp-server#choose-your-setup) advertises 100 queries/day for keyless use; this does not imply anonymous traffic or no provider logging. `you-search` forwards `query` and maps `maxResults` to `count`; `you-extract` receives only `url`. Unsupported `objective` and `maxCharacters` are omitted only for the You.com attempt without query rewriting or local truncation.
- `src/paths.js`: packaged asset resolution through `import.meta.url`, never cwd, including `searchProxyDir` and `searchProxyEntry`. Superpowers resolution explicitly prefers the real workspace/app-hoisted installation, falls back to Core's bundled nested dependency, and remains stable across prepack materialization/postpack cleanup.
- `hooks/`: persistent Python base and on-demand project overlay management.
- `skills/`: 18 OmAgents skills, shared scripts, and research assets; pinned Superpowers supplies 15 process skills.

Execution and notification state are separate. Terminal states never regress, `interrupted` is not success, and cancellation admission alone is not `cancelled`. Consumers share one Board; do not create a second task database.

## Skills and Assets

`SKILL.md` is the fallback and `SKILL.<host>.md` is a complete override, not a runtime search-and-replace fragment. Do not add runtime host detection. Preserve native host delegation forms and the pinned Superpowers commit.

For Superpowers sources only, rendering replaces every bounded `docs/superpowers` documentation root with `docs`, preserving arbitrary following directories and leaving similar names such as `docs/superpowers-archive` unchanged. OpenCode V2, Codex, and DSH consume this Core rendering; the OpenCode V1 adapter supplies the equivalent system-prompt preference because it reads the upstream skill files directly. Existing project documents are never migrated automatically.

Jinja2 templates live only under `packages/core/skills/deep-research/templates/`. There is no root `templates/` directory. Deep-research internal state and public deliverables must remain separated through `skills/deep-research/scripts/layout.py`.

Only `jinja2` is automatically provisioned. Optional Python tools install on demand. Use the `agents-python-tools` skill for environment selection, paths, and CLI details rather than duplicating the full Python guide here. Never auto-delete the base or project environment.

## Verification

```bash
npm test --workspace @omagents/core
node --test tests/documentation.test.js
npm test
python -m compileall -q packages/core/skills/deep-research/scripts
python -m compileall -q packages/core/skills/_shared/scripts
# Optional public-network smoke only; never add it to CI:
OMAGENTS_LIVE_SEARCH_TEST=1 node --test packages/core/test/search-proxy-live.test.js
```

Core `prepack` materializes the pinned installed Superpowers dependency into an ignored package-local directory for npm packing; `postpack` removes only that marked materialized copy. Never commit a duplicate Superpowers source tree. Run `npm run pack:all` and `npm run test:packed` for asset and clean-room changes.

## Release

Core and all hosts share one exact version. Every release builds, tests, packs, and publishes all four packages. Core is published first, followed sequentially by OpenCode, Codex, and DSH:

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

Do not add dependencies between host packages. Versioning, publication, and Git mutations require explicit user authorization.
