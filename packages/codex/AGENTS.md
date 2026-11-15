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
- GitHub uses Codex's `bearer_token_env_var` indirection. The plugin `.mcp.json` contract has no arbitrary environment indirection for Exa headers or Context7 stdio `env`; those configured values are stored in `.mcp.json`. Create private directories with mode `0700` and write or rewrite `.mcp.json` with mode `0600` on platforms honoring POSIX modes.
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

Installer tests must cover generated artifacts, skills, MCP, Python hooks, idempotence, unknown arguments, and package contents without contacting external model services. Preserve Windows and Unix executable/path conventions.

## Release

All four packages share one version and are built, tested, packed, and published together. Publish Core first, then OpenCode, Codex, and DSH sequentially:

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

Codex has no dependency on another host. Versioning, publication, and Git mutations require explicit user authorization.
