# Python Base Environment and Project Overlay Design

Date: 2026-11-12
Status: Approved

## Summary

OmAgents will keep a persistent Python tool environment at `~/.venvs/omagents` and add an on-demand project environment at `<project-root>/.omagents/venv`. The project environment will reuse OmAgents tool packages through a switchable `.pth` overlay rather than Python's `--system-site-packages` option.

The key safety rule is that project package management must hide the base environment. Otherwise pip can treat a base package as an already-installed project dependency and skip installing it locally.

## Goals

1. Keep one persistent OmAgents base environment for agent-owned Python tools.
2. Reuse an existing base without recreating it or invoking pip unnecessarily.
3. Install project-owned dependencies into `<project-root>/.omagents/venv`.
4. Let normal project Python processes import base tool packages.
5. Ensure project packages take precedence over same-named base packages.
6. Ensure project dependencies are installed locally even when base already contains them.
7. Support macOS, Linux, and Windows without shell-specific helper scripts.
8. Never automatically delete the base environment.

## Non-goals

- Do not create a project venv in projects that do not need Python dependencies.
- Do not migrate, delete, or modify an existing project `.venv`.
- Do not make base an undeclared dependency of project builds, releases, or CI.
- Do not integrate Poetry, uv, or other package managers in the first version.
- Do not automatically delete or recreate a broken base or project environment.
- Do not add npm dependencies.

## Existing Behavior and Root Cause

The current OpenCode plugin creates the base only when its Python executable is absent and checks `jinja2` before installing it. The Codex hook also creates the base only when needed, but unconditionally runs `pip install -q jinja2` and prints `venv ready` on every session start. No active repository automation deletes `~/.venvs/omagents`; deletion commands occur only in uninstall documentation and historical development records.

The repeated work is therefore primarily repeated checking/installation and misleading logging, not repeated environment deletion.

## Architecture

```text
┌──────────────────────────────────────────┐
│ ~/.venvs/omagents                        │
│ Persistent OmAgents base environment     │
│ - jinja2: ensured at session start       │
│ - markitdown/playwright/Office tools:    │
│   installed on first use                 │
│ - never automatically deleted            │
└───────────────────┬──────────────────────┘
                    │ switchable .pth overlay
                    ▼
┌──────────────────────────────────────────┐
│ <project>/.omagents/venv                 │
│ Project-owned environment                │
│ - project-declared dependencies          │
│ - project packages                       │
│ - OmAgents base overlay metadata         │
│ Project packages take precedence         │
└──────────────────────────────────────────┘
```

There are two project modes:

| Mode | Base visible | Purpose |
|---|---:|---|
| `OMAGENTS_PROJECT_ONLY=1` | No | Project pip install/upgrade/uninstall |
| Normal project execution | Yes | Project code can import OmAgents tools |

## Why Not `--system-site-packages`

`venv --system-site-packages` exposes system-level site-packages, not packages installed in a parent venv. Creating a venv from the OmAgents base interpreter with that flag therefore does not implement base-venv inheritance.

The project venv will be created by the base interpreter without `--system-site-packages`, ensuring the same underlying Python version and ABI while retaining an independent project `site-packages`.

## Switchable `.pth` Overlay

The project environment's `purelib` will contain `omagents-base.pth`. Its logical content is:

```python
import os, site; os.environ.get("OMAGENTS_PROJECT_ONLY") != "1" and site.addsitedir("<base-site-packages>")
```

The base `purelib` and `platlib` are added separately when different and deduplicated when identical. Paths must be serialized safely, including Windows backslashes and paths containing spaces.

`site.addsitedir` is used instead of a plain path line so that:

1. Base paths are appended after project paths.
2. Project packages retain precedence.
3. `.pth` files shipped inside the base environment are processed.

During project pip operations, `OMAGENTS_PROJECT_ONLY=1` prevents the base paths from being added. Pip consequently sees only project-local distributions and installs every declared project dependency locally.

## Components

### `hooks/python-env.js`

A new shared Node.js module used by OpenCode, Codex, and the project CLI.

Exports:

- `ensureBaseEnvironment(options)`
- `inspectPython(pythonPath)`
- `ensureProjectEnvironment(options)`
- `runProjectPip(options)`
- `runProjectPython(options)`
- `getProjectVenvPath(projectRoot)`

Shared constants:

- `AGENT_VENV = ~/.venvs/omagents`
- platform-specific base Python path
- `PROJECT_VENV = <project>/.omagents/venv`
- core package definitions, initially `{ requirement: "jinja2", importName: "jinja2" }`

All subprocesses use `execFile`/`spawn` with argument arrays. Pip is invoked as `<python> -m pip`, not through a pip launcher whose shebang may be stale. Internal inspection, venv, import-check, and pip commands use Python `-I` so project-local modules such as `json.py`, `venv.py`, or `pip.py` cannot shadow trusted stdlib/tool modules. Normal project `run` does not use `-I`.

For testability, path and subprocess dependencies must be injectable. Tests must never touch the real `~/.venvs/omagents`.

#### Base provisioning

`ensureBaseEnvironment()` will:

1. Verify that system Python exists and is at least 3.11.
2. Create base with `python -m venv` only when its interpreter is absent.
3. If base exists, execute it and inspect `sysconfig`; file existence alone is insufficient.
4. Check each core package by import and install only missing packages.
5. Return `created` or `reused`, plus installed and skipped packages.
6. Report a broken base without deleting it.

#### Python inspection

`inspectPython()` returns JSON containing:

- full version and `majorMinor`
- `prefix` and `basePrefix`
- `purelib` and `platlib`

This supports health checks, ABI compatibility checks, and overlay generation.

### `hooks/project-venv.js`

A cross-platform Node.js CLI for agents and skills.

#### `ensure`

```bash
node <omagents-root>/hooks/project-venv.js ensure --root <project-root>
```

Behavior:

1. Ensure base is healthy.
2. Create `<project>/.omagents/venv` with base Python when absent, without `--system-site-packages`.
3. Reuse an existing project venv only when its interpreter works and its Python `majorMinor` matches base.
4. Refuse mismatched or broken environments without deleting them.
5. Idempotently write `omagents-base.pth`.
6. Write a `.gitignore` containing `*` inside the project venv, without modifying the project's root `.gitignore`; this is required consistently on Python versions that do not create it automatically.
7. Write `.omagents-python.json` inside the project venv with schema version, base paths, and Python `majorMinor`.
8. Verify normal-mode base import with `OMAGENTS_PROJECT_ONLY` removed from the internal probe environment, even if the caller inherited it. Only the final project pip subprocess re-enables project-only mode.
9. Report `created` or `reused` and the project Python path.

The project root must be an existing directory and is resolved to an absolute path before any environment operation. Repeated execution with unchanged inputs must not recreate the environment or rewrite unchanged files.

#### `python`

```bash
node <omagents-root>/hooks/project-venv.js python --root <project-root>
```

Ensure the project environment and print only its Python absolute path to stdout. All provisioning and diagnostic logs go to stderr so this command remains machine-readable.

#### `pip`

```bash
node <omagents-root>/hooks/project-venv.js pip --root <project-root> -- install -r requirements.txt
node <omagents-root>/hooks/project-venv.js pip --root <project-root> -- install -e .
```

Ensure the project environment, set `OMAGENTS_PROJECT_ONLY=1`, invoke `<project-python> -m pip <args...>`, inherit stdio, and propagate the exit code.

#### `run`

```bash
node <omagents-root>/hooks/project-venv.js run --root <project-root> -- script.py
```

Ensure the project environment, remove `OMAGENTS_PROJECT_ONLY`, invoke project Python with base overlay enabled, and propagate the exit code.

### `hooks/setup-venv.js`

Convert the existing Codex hook into a thin wrapper around `ensureBaseEnvironment()` while retaining helper-script copying and Codex's `{}` stdout contract.

Remove the unconditional pip invocation. Log meaningful states (`created`, `reused`, `installed`, `ready`) to stderr.

### `.opencode/plugins/index.js`

- Import shared base constants and provisioning instead of maintaining duplicate implementations.
- Keep the module-level `_provisioning` Promise so provisioning happens at most once per OpenCode process.
- Preserve V1 `session.created` behavior and V2 non-blocking setup behavior.
- Preserve PATH injection and the `{ id, server, setup }` descriptor.
- Never create a project venv from plugin startup.

### `.codex/plugins/setup.js`

Copy all three runtime hooks into the Codex cache:

- `hooks/python-env.js`
- `hooks/setup-venv.js`
- `hooks/project-venv.js`

Their relative imports must remain valid in the installed cache. Skills refer to the CLI as `<omagents-root>/hooks/project-venv.js`; for Codex, the root is `${PLUGIN_ROOT}`. No skill may assume the current working directory is the OmAgents root.

## Dependency Routing Rules

| Dependency purpose | Location | Installation path |
|---|---|---|
| Agent-only tooling | `~/.venvs/omagents` | Base Python `-m pip`, on demand |
| Project-declared dependency | `<project>/.omagents/venv` | `project-venv.js pip` |
| Project use of a base-only tool | No duplicate required | `project-venv.js run` |

Rules:

1. Dependencies declared by `pyproject.toml`, `requirements.txt`, or equivalent project configuration are always project-local.
2. Base containing the same package is not a reason to skip project installation.
3. Utilities used by the agent to scrape, convert, or generate artifacts belong in base.
4. A package serving both roles is managed independently in both environments.
5. Project pip must go through `project-venv.js pip`; direct pip with overlay enabled is unsupported.
6. Existing `.venv` directories remain untouched.
7. Base console scripts remain in base `bin/Scripts`; the overlay shares imports, not executable entry points.

Only `jinja2` remains eagerly provisioned. MarkItDown, Playwright, Office libraries, and other tools remain on-demand to avoid heavy session startup.

## Skill Updates

### `agents-python-tools`

Document the base/project routing table, the project CLI, the project-local dependency rule, coexistence with `.venv`, and the prohibition on direct project pip with overlay enabled.

### `markitdown-converter`

Use the absolute platform-specific base Python for import checks and `python -m pip` installation. Install only after a failed import check.

### `playwright-web-scraping`

Use base Python for package checks/install and browser installation. Check the Python package and Chromium binary separately.

### `doctor`

Add checks for base health, project/base version match, `.pth` validity, normal-mode base imports, and project-only exclusion of base paths.

## Error Handling

| Condition | Required behavior |
|---|---|
| Python missing or older than 3.11 | Actionable error; modify nothing |
| Base exists but is broken | Report manual repair guidance; never auto-delete |
| Core package install fails | Preserve base and retry only missing packages next time |
| Project venv is broken | Report; require explicit user repair/recreation |
| Project/base Python minor versions differ | Refuse overlay due to ABI risk |
| Base path changes with same Python version | Update project `.pth` and metadata without recreation |
| `.pth` write fails | Fail instead of reporting ready |
| Project pip fails | Preserve base and propagate pip exit code |
| Concurrent sessions | Keep per-process deduplication; never resolve conflicts by deletion |

## Testing

### Unit tests: `tests/python-env.test.js`

Use temporary directories and mocked subprocess runners. Cover:

- base creation only when absent
- reuse without venv or pip invocation
- installation of only missing core packages
- broken base without deletion
- Python missing/unsupported
- argument-array handling and paths containing spaces
- project creation by base Python without `--system-site-packages`
- switchable `.pth` generation, including Windows paths
- project-local `.gitignore` creation without root `.gitignore` changes
- idempotent project reuse
- version mismatch without deletion
- project-only environment for pip
- normal environment for run
- CLI argument, stdio, and exit-code propagation

### Real Python integration tests

Use temporary base and project environments without network package installation:

1. Add a dummy `omagents_probe.py` with `VALUE = "base"` to base.
2. Verify normal project execution imports the base module.
3. Add the same module with `VALUE = "project"` to project.
4. Verify the project module wins.
5. Verify project-only mode excludes base paths.
6. Verify `include-system-site-packages = false` in project `pyvenv.cfg`.

### Existing tests

- Update `tests/plugin-v2.test.js` installed-package fixtures to copy the new hooks modules while retaining PATH and dedup tests.
- Move source-string Python prerequisite assertions from `tests/plugin.test.js` to the shared module as appropriate.
- Retain on-demand package assertions in `tests/skills.test.js` and add project routing assertions.
- Add Codex hook-copy assertions.

## Documentation and Tooling

Update in the same change:

- `AGENTS.md`
- `README.md`, `README.zh-cn.md`, `README.ja.md`, `README.ko.md`
- `CHANGELOG.md`
- `docs/superpowers/INTEGRATION-CHECKLIST.md`
- `package.json` formatting scripts
- `.github/workflows/ci.yml` syntax and formatting checks for `hooks/*.js`

Do not rewrite historical `.superpowers/sdd/` records or superseded design documents.

## Implementation Sequence

1. Add the shared environment module and unit tests.
2. Integrate OpenCode and Codex base provisioning and update their tests.
3. Add project CLI and real Python integration tests.
4. Update Python skills and doctor.
5. Update documentation, formatting, CI, and packaging checks.
6. Run full automated and manual acceptance verification.

## Verification Commands

```bash
node --check hooks/python-env.js
node --check hooks/setup-venv.js
node --check hooks/project-venv.js
node --check .opencode/plugins/index.js
node --check .codex/plugins/setup.js
node --test tests/*.test.js
npm run format:check
python3 -m py_compile skills/deep-research/scripts/*.py
python3 -m py_compile skills/_shared/scripts/loop_engine.py
npm pack --dry-run
```

Manual smoke test on a temporary project:

```bash
node hooks/project-venv.js ensure --root <demo>
node hooks/project-venv.js ensure --root <demo>
node hooks/project-venv.js pip --root <demo> -- install requests
node hooks/project-venv.js run --root <demo> -- -c "import requests; print(requests.__file__)"
node hooks/project-venv.js run --root <demo> -- -c "import sys, jinja2; print(sys.prefix); print(jinja2.__file__)"
```

The second `ensure` must report reuse. A project-installed `requests` must resolve inside `<demo>/.omagents/venv`. Jinja2 resolves from base only when not project-installed; a project-installed copy must win.

## Acceptance Criteria

- Base is created only when absent and reused thereafter.
- Existing base packages do not trigger repeated pip calls.
- No automation deletes base.
- Agent tool dependencies go to base.
- Project environments are created only on demand.
- Project dependencies are physically installed in `.omagents/venv`.
- Project packages override same-named base packages.
- Normal project execution can import base tools.
- Project pip cannot see base packages.
- Python minor-version mismatches are rejected.
- Existing `.venv` directories are unaffected.
- Cross-platform paths and subprocess invocation work.
- All tests, syntax checks, formatting checks, and package checks pass.
- Project documentation in all required languages is synchronized.
