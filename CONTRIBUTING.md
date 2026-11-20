# Contributing to OmAgents

Thanks for your interest in contributing. OmAgents is a private npm-workspaces repository with one shared Core package and three independent host products. Keep code, tests, package artifacts, and all four README languages synchronized.

## Development Setup

Use Node.js 24 and npm, then install the locked workspace dependencies:

```bash
git clone git@github.com:omagents/omagents.git
cd omagents
npm ci
```

Run OpenCode inside the repository to load the development-only `.opencode/plugins/index.js` re-export. Do not install the private repository root as a plugin. For isolated host testing, use the packed-artifact harnesses below rather than relying on workspace hoisting.

Read the scoped guide before changing a package:

- [`packages/core/AGENTS.md`](packages/core/AGENTS.md)
- [`packages/opencode/AGENTS.md`](packages/opencode/AGENTS.md)
- [`packages/codex/AGENTS.md`](packages/codex/AGENTS.md)
- [`packages/dsh/AGENTS.md`](packages/dsh/AGENTS.md)

## Project Structure

```text
omagents/
├── .opencode/plugins/index.js      # Development-only OpenCode re-export
├── packages/
│   ├── core/                       # @omagents/core; automatic shared dependency
│   │   ├── src/                    # Job Board, storage, MCP, skills, asset paths
│   │   ├── hooks/                  # Shared Python environment management
│   │   ├── skills/                 # 18 OmAgents skills and shared scripts
│   │   │   └── deep-research/
│   │   │       ├── scripts/
│   │   │       └── templates/      # Jinja2 templates; never a root templates/
│   │   └── mcp-servers/base.json
│   ├── opencode/                   # @omagents/omagents
│   │   ├── src/index.js            # Dual OpenCode V1/V2 plugin entry
│   │   ├── src/parallel.js         # OpenCode lifecycle adapter
│   │   └── bin/install.js          # No-argument installer
│   ├── codex/                      # @omagents/omagents-codex
│   │   ├── src/setup.js            # Codex artifact generation through Core
│   │   └── bin/install.js          # No-argument installer
│   └── dsh/                        # @omagents/omagents-dsh
│       ├── src/host/               # Typed Host, lifecycle, Remote, and adapters
│       ├── src/client/             # Native React Web Job Board
│       ├── dist/                   # Built publish artifacts
│       └── cordis.patch.yml        # Inserted package-root Loader row
├── scripts/                        # Pack, clean-room, and browser verification
├── tests/                          # Root and cross-package tests
├── package.json                    # Private npm-workspaces root
└── README.md
```

There is no root-level `templates/` directory. The canonical template path is `packages/core/skills/deep-research/templates/`.

## Package Boundaries

### Core

`@omagents/core` owns host-neutral execution and notification state, durable storage, skill discovery/rendering, MCP resolution, Python environments, and research assets. It must not import OpenCode, Codex, DSH, Cordis, React, or host SDK packages. Core is an automatic dependency, not a separate user plugin.

### OpenCode

`@omagents/omagents` preserves the dual V1/V2 descriptor, native V1 `task(background: true)`, and current V2 `subagent(...)` behavior without a `background` argument. Product code belongs in `packages/opencode/src/`; the parallel adapter is `packages/opencode/src/parallel.js`. The repository `.opencode/plugins/index.js` must remain a re-export, and the self-repository dedup guard must remain intact.

### Codex

`@omagents/omagents-codex` is the only supported Codex installer. It reuses Core skills, MCP resolution, and Python provisioning while retaining Codex-native subagents. Do not add a host dispatcher to the OpenCode package or an OpenCode parallel-engine dependency.

### DSH

`@omagents/omagents-dsh` contains the complete Host and native React Web Client. DSH uses native asynchronous `subagent` without `background`, one profile-scoped Core Board, an authorized Remote whole-set watch stream, `/ps`, `parallel_status`, and `cancel_task`. The Client is attached to the bare package-root Loader row; do not add a second application root, iframe, browser-owned database, or periodic running-job poll.

Local cancellation stops the current turn while descendants continue unless separately cancelled. External one-shot runs stop permanently and cannot resume. Cancellation admission is not terminal confirmation, and UI reads never acknowledge model notifications.

## Tests and Verification

Run the documentation contract and complete unit/workspace suite before submitting changes:

```bash
node --test tests/documentation.test.js
npm test
```

The root `npm test` runs `tests/*.test.js` and then `npm test --workspaces --if-present` exactly once. Do not add a duplicate package test path to the root script.

Use package-specific checks when working on a host:

```bash
# OpenCode syntax and focused root suites
node --check packages/opencode/src/index.js
node --test tests/plugin.test.js tests/plugin-v2.test.js tests/opencode-cli.test.js

# Codex installer
npm test --workspace @omagents/omagents-codex

# DSH typecheck, build, and full Host/Client suite
npm run typecheck --workspace @omagents/omagents-dsh
npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh
```

Python checks are directory-based and cross-platform:

```bash
python -m compileall -q packages/core/skills/deep-research/scripts
python -m compileall -q packages/core/skills/_shared/scripts
```

Only `jinja2` is automatically provisioned. Optional Python tools are installed on demand by their skills. Use the `agents-python-tools` skill for base/project environment selection and CLI details; project overlay commands live in `packages/core/hooks/project-venv.js`. Do not duplicate the full Python environment guide here.

### Packed Artifacts and Browser

```bash
npm run pack:all
npm run test:packed
npm run test:browser
```

These commands build and inspect the four aligned tarballs, install them into isolated homes/profiles, and exercise the real DSH Host/Web composition without external model credentials. DSH users must receive built artifacts and never need to compile TypeScript or React source.

**Current release-candidate verification scope:** verification includes local **macOS arm64** with the **`chromium_headless_shell-1228`** override and main CI run **`43688132997`** on Linux, macOS, and Windows with the default pinned Chromium. All six Unit/packed and DSH Web jobs passed.

## Documentation Changes

Update `README.md`, `README.zh-cn.md`, `README.ja.md`, and `README.ko.md` together. Preserve the exact installation commands and support matrix semantics, and do not add TODO translation fallback markers unless a translation genuinely cannot be completed. Update affected package `AGENTS.md` guides and `CHANGELOG.md` in the same change.

The approved design and implementation plan are retained at:

- `docs/specs/2026-11-13-multi-host-packages-dsh-design.md`
- `docs/plans/2026-11-13-multi-host-packages-dsh.md`

Do not rewrite approved technical decisions or final verification status while synchronizing user documentation.

## Release Policy

Every release uses one aligned version for all four manifests and each host's exact Core dependency. Every release must **build, test, pack, and publish all four packages together**, including single-host changes. Publish in this deterministic order:

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

Confirm the exact Core version is available in npm before publishing hosts. Host packages have no host-to-host dependencies; sequential host publication is only for deterministic logs and failure handling. Use OIDC Trusted Publishing for all four names, inspect the tarballs before publication, and never publish from an unverified or independently versioned package.

Versioning, Git mutations, tags, pushes, npm publication, GitHub releases, and community announcements require explicit user authorization.

## Submitting Changes

1. Create a focused branch.
2. Make minimal package-scoped changes and add or update tests first.
3. Run the documentation, full workspace, and applicable packed/browser checks.
4. Update all affected guides and translations.
5. Review the complete diff, then open a pull request with actual verification output and any unconfirmed environments clearly identified.

## Reporting Issues

Use [GitHub Issues](https://github.com/omagents/omagents/issues) to report bugs or request features. Include the host and version, package versions, installation command, relevant health diagnostics, and whether the failure reproduces from a packed install.

## License

MIT. See [LICENSE](LICENSE).
