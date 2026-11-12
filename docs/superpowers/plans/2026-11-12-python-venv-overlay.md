# Python Base Environment and Project Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist OmAgents Python tools in a reusable base venv and add an on-demand project venv that safely overlays base packages without compromising project-local dependency installation.

**Architecture:** A shared Node.js module owns base provisioning, Python inspection, project overlay creation, and subprocess execution. A small CLI exposes project operations to skills; OpenCode and Codex retain their existing plugin contracts and delegate base provisioning to the shared module.

**Tech Stack:** Node.js ESM, `node:child_process`, `node:test`, Python 3.11+ `venv`/`site`/`sysconfig`, Prettier, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-12-python-venv-overlay-design.md`

## Global Constraints

- Base is `~/.venvs/omagents`; project venv is `<project-root>/.omagents/venv`.
- Never automatically delete or recreate an existing base or project environment.
- Python 3.11+ is required; project and base Python `majorMinor` must match.
- Do not use `venv --system-site-packages` for the project overlay.
- Only `jinja2` is eagerly provisioned; all other tools remain on-demand.
- Project pip operations must set `OMAGENTS_PROJECT_ONLY=1`; normal project execution must remove it.
- Use `execFile`/`spawn` argument arrays and `<python> -m pip`, never shell command concatenation or pip launchers.
- Tests must use temporary/injected environments and must not modify the real `~/.venvs/omagents`.
- Existing project `.venv` directories and the plugin `{ id, server, setup }` contract remain untouched.
- No npm dependency is added.
- README changes are synchronized across EN, ZH-CN, JA, and KO; `AGENTS.md` is updated in the same change.
- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or other git mutations without explicit user confirmation. Each task ends with a read-only review checkpoint instead of a commit.

## Review Focus

- **Paths containing spaces, quotes, non-ASCII characters, or Windows backslashes:** subprocesses and generated Python literals must not corrupt or execute the path. Task 1 Step 1 and Task 2 Step 1 pin argument-array invocation and JSON-string serialization tests.
- **A stale project venv with a different Python minor version:** reuse must be refused without deletion. Task 2 Step 1 pins the mismatch and no-delete assertions.
- **A package present only in base during project dependency installation:** pip must not see it, while normal execution must see it. Task 2 Step 2 pins this with real Python interpreters and dummy modules.
- **An existing but broken interpreter:** health checks must fail safely instead of treating file existence as health or deleting the directory. Task 1 Step 1 and Task 2 Step 1 pin these cases.
- **Machine-readable CLI output and repository hygiene:** `python` stdout must contain only the interpreter path and the project venv must ignore itself without editing root `.gitignore`. Task 2 Steps 1 and 6 pin these behaviors.

---

### Task 1: Shared Base Environment Module

**Files:**
- Create: `hooks/python-env.js`
- Test: `tests/python-env.test.js`

**Interfaces:**
- Consumes: Node.js built-ins only.
- Produces:
  - `AGENT_VENV: string`
  - `AGENT_VENV_BIN: string`
  - `CORE_PYTHON_PACKAGES: Array<{ requirement: string, importName: string }>`
  - `getVenvPython(venvPath: string, platform?: string): string`
  - `getProjectVenvPath(projectRoot: string): string`
  - `defaultRunner(command: string, args: string[], options?: object): Promise<{ code: number, stdout: string, stderr: string }>`
  - `inspectPython(pythonPath: string, options?: { runner?: Function }): Promise<{ version: string, majorMinor: string, prefix: string, basePrefix: string, purelib: string, platlib: string, sysPath: string[] }>`
  - `ensureBaseEnvironment(options?: { venvPath?: string, pythonCommand?: string, runner?: Function, corePackages?: Array, withPip?: boolean, logger?: Function }): Promise<{ status: "created"|"reused", venvPath: string, pythonPath: string, installed: string[], skipped: string[], info: object }>`

- [ ] **Step 1: Write failing base-provisioning tests**

Create tests using `fs.mkdtempSync`, a mock `runner(command, args, options)`, and no real home-directory access. Cover these named behaviors:

- `inspectPython returns version, prefixes, site paths, and sys.path` — mock a JSON stdout payload and assert every returned field.
- `ensureBaseEnvironment creates a missing base without clearing it` — assert args are exactly `["-m", "venv", venvPath]` plus `--without-pip` only when `withPip:false`, and no delete API is called.
- `ensureBaseEnvironment reuses a healthy base without pip` — mock successful inspection and core import; assert no venv or pip command and `status === "reused"`.
- `ensureBaseEnvironment installs only missing core packages` — mock `jinja2` import failure and assert `[basePython, "-m", "pip", "install", "jinja2"]` with each value as a separate argument.
- `ensureBaseEnvironment rejects broken or unsupported Python without deletion` — test a non-zero interpreter probe and a `3.10.x` payload.
- `commands preserve paths containing spaces and quotes` — use a temporary path containing both and assert it is one unchanged argv element.
- `getProjectVenvPath resolves only .omagents/venv` — assert the exact suffix and absolute result.

- [ ] **Step 2: Run the tests and verify the module is missing**

Run: `node --test tests/python-env.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `hooks/python-env.js`.

- [ ] **Step 3: Implement the shared base API**

Implement `defaultRunner` with `spawn`, capturing stdout/stderr by default and supporting `stdio:"inherit"`; resolve with the exit code instead of rejecting on non-zero process exits. Throw descriptive JavaScript errors for failed inspection/provisioning operations.

Use a single `python -c` JSON probe for `inspectPython`. Check the system Python before creating base, check an existing base by executing it, and keep the core import/install loop idempotent. Accept `corePackages:[]` and `withPip:false` for isolated tests. Log only through the injected `logger`.

- [ ] **Step 4: Run base tests and verify they pass**

Run: `node --test tests/python-env.test.js`

Expected: all Task 1 tests PASS; no command accesses `os.homedir()` in test-provided paths.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check -- hooks/python-env.js tests/python-env.test.js && git diff -- hooks/python-env.js tests/python-env.test.js`

Expected: no whitespace errors; diff contains no deletion/recreation fallback and no project-overlay implementation yet.

---

### Task 2: Project Overlay and CLI

**Files:**
- Modify: `hooks/python-env.js`
- Create: `hooks/project-venv.js`
- Test: `tests/python-env.test.js`

**Interfaces:**
- Consumes: every Task 1 export.
- Produces:
  - `ensureProjectEnvironment(options: { projectRoot: string, baseVenvPath?: string, pythonCommand?: string, runner?: Function, corePackages?: Array, withPip?: boolean, logger?: Function }): Promise<{ status: "created"|"reused", projectRoot: string, venvPath: string, pythonPath: string, base: object, info: object }>`
  - `runProjectPip(options: ensureProjectEnvironment options & { args: string[], env?: object }): Promise<{ code: number, project: object }>`
  - `runProjectPython(options: ensureProjectEnvironment options & { args: string[], env?: object }): Promise<{ code: number, project: object }>`
  - CLI: `project-venv.js <ensure|python|pip|run> --root <dir> [-- <args...>]`
  - `main(argv: string[], dependencies?: object): Promise<number>` for CLI tests with injected project operations and streams

- [ ] **Step 1: Add failing project unit tests**

Use temporary roots and mock runners to cover:

- `project ensure creates from base without system site packages` — assert the creator is `base.pythonPath`, the target is `.omagents/venv`, and `--system-site-packages` is absent.
- `project overlay is switchable and safely serialized` — inspect `omagents-base.pth`; assert it imports `os`/`site`, calls `site.addsitedir`, checks `OMAGENTS_PROJECT_ONLY != "1"`, and correctly round-trips `C:\\Users\\A B\\base\\site-packages` through Python-string serialization.
- `project ensure is idempotent and writes local ignore/metadata files` — second call returns `reused`, file mtimes/content are unchanged, `.gitignore` is exactly `*\n`, `.omagents-python.json` has `schemaVersion:1` and matching `majorMinor`, and root `.gitignore` is untouched.
- `project ensure rejects broken interpreters and minor-version mismatches without deletion` — mock `3.14` base versus `3.13` project and assert rejection plus existing sentinel file preservation.
- `project pip hides base and run enables it` — assert pip env contains `OMAGENTS_PROJECT_ONLY:"1"`, run env omits it, both invoke `<project-python> -m pip`/`<project-python>` with unchanged trailing args.
- `CLI validates arguments and propagates exit codes` — missing `--root`, missing args after `--`, and a mocked non-zero pip/run result.
- `CLI python reserves stdout for the interpreter path` — all logger output is captured on stderr.

- [ ] **Step 2: Add a failing real-Python overlay integration test**

Using `ensureBaseEnvironment({ venvPath: tempBase, corePackages:[], withPip:false })` and `ensureProjectEnvironment(...)`:

1. Write `omagents_probe.py` containing `VALUE = "base"` to base `purelib`.
2. Assert normal project `python -c` prints `base` and project `pyvenv.cfg` contains `include-system-site-packages = false`.
3. While the probe exists only in base, assert `OMAGENTS_PROJECT_ONLY=1` causes its import to fail and base `purelib` is absent from `sys.path`.
4. Add a project-local `omagents_probe.py` containing `VALUE = "project"` and assert normal execution now prints `project`.
5. Delete only temporary test directories in test cleanup.

Run: `node --test tests/python-env.test.js`

Expected: FAIL because project exports and CLI do not exist.

- [ ] **Step 3: Implement project environment creation and execution**

Resolve and validate `projectRoot` as an existing directory. Create only a missing project venv; inspect existing interpreters and compare `majorMinor` before any write. Generate deduplicated base `purelib/platlib` overlay lines using JSON string literals and `site.addsitedir`.

Write the `.pth`, venv-local `.gitignore`, and `.omagents-python.json` only when content changes. Re-inspect normal-mode `sysPath` and fail if a base site path was not added. `runProjectPip` and `runProjectPython` call `ensureProjectEnvironment` first and return the child exit code with the project result.

- [ ] **Step 4: Implement the four CLI commands**

Implement exported `main(argv, dependencies)` and invoke it only when the file is the direct entry point. Parse exactly `<command> --root <dir> [-- <args...>]`; require `--root`, require trailing args for `pip` and `run`, and reject extra args for `ensure` and `python`. Inject project operations and stdout/stderr writers for unit tests. Send logs to stderr. `ensure` prints `<created|reused> <pythonPath>`; `python` prints only `pythonPath`; `pip` and `run` inherit stdio and return/set the child exit code through `main`/`process.exitCode`.

- [ ] **Step 5: Run all shared-module tests**

Run: `node --test tests/python-env.test.js`

Expected: unit and real-Python integration tests PASS, including project-only import failure and project-over-base precedence.

- [ ] **Step 6: Verify CLI hygiene manually in a temporary root**

Run:

```bash
ROOT=$(mktemp -d)
node hooks/project-venv.js ensure --root "$ROOT"
node hooks/project-venv.js ensure --root "$ROOT"
node hooks/project-venv.js python --root "$ROOT"
test "$(cat "$ROOT/.omagents/venv/.gitignore")" = "*"
```

Expected: first status `created`, second `reused`, stdout of `python` is one absolute path, and no root `.gitignore` is created. Remove only `$ROOT` after verification.

- [ ] **Step 7: Review checkpoint**

Run: `git diff --check -- hooks/python-env.js hooks/project-venv.js tests/python-env.test.js && git diff -- hooks/python-env.js hooks/project-venv.js tests/python-env.test.js`

Expected: no whitespace errors; no production code removes an existing base/project directory.

---

### Task 3: OpenCode Base Provisioning Integration

**Files:**
- Modify: `.opencode/plugins/index.js:24-31,88-90,138-187`
- Modify: `tests/plugin.test.js`
- Modify: `tests/plugin-v2.test.js:345-360`

**Interfaces:**
- Consumes: `AGENT_VENV_BIN` and `ensureBaseEnvironment()` from Task 1.
- Produces: unchanged V1/V2 plugin descriptor, PATH behavior, and once-per-process `_provisioning` wrapper.

- [ ] **Step 1: Write failing integration assertions**

In `tests/plugin.test.js`, replace local-implementation source assertions with a test named `OpenCode delegates Python provisioning to the shared environment module`: assert the source imports `ensureBaseEnvironment` and `AGENT_VENV_BIN`, retains `_provisioning`, and no longer contains its own `REQUIRED_PYTHON_PACKAGES` or `python3 -m venv` implementation.

In `tests/plugin-v2.test.js`, update `makeInstalledCopy()` to copy `hooks/python-env.js` into the fake package. Keep the existing PATH and V1/V2 lifecycle assertions unchanged.

- [ ] **Step 2: Run tests and verify the refactor is absent**

Run: `node --test tests/plugin.test.js tests/plugin-v2.test.js`

Expected: the new delegation assertion FAILS against the current plugin.

- [ ] **Step 3: Delegate OpenCode provisioning**

Import the shared API. Remove local `PYTHON_CMD`, `AGENT_PYTHON`, `AGENT_PIP`, `REQUIRED_PYTHON_PACKAGES`, `tryRun`, and the embedded base installer. Use `path.delimiter` and `AGENT_VENV_BIN` in PATH construction.

Keep `ensurePythonDependencies()` as the memoized, never-rejecting wrapper: call shared `ensureBaseEnvironment`, route logs through `warnIfDebug`, and retain the Python 3.11+ installation guidance on failure. Leave V1/V2 call sites unchanged and do not create project environments.

- [ ] **Step 4: Run OpenCode tests**

Run: `node --test tests/plugin.test.js tests/plugin-v2.test.js tests/python-env.test.js`

Expected: PASS, including installed-package fixtures, PATH deduplication, V1/V2 entry shapes, and shared environment tests.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check -- .opencode/plugins/index.js tests/plugin.test.js tests/plugin-v2.test.js && git diff -- .opencode/plugins/index.js`

Expected: only provisioning/PATH constant delegation changes; MCP, skills, parallel engine, and descriptor code are unchanged.

---

### Task 4: Codex Base Provisioning Integration

**Files:**
- Modify: `hooks/setup-venv.js`
- Modify: `.codex/plugins/setup.js:278-285`
- Create: `tests/codex-python-env.test.js`

**Interfaces:**
- Consumes: Task 1 `ensureBaseEnvironment()` and the shared hook path established in Task 2.
- Produces: Codex cache containing `python-env.js`, `setup-venv.js`, and `project-venv.js`; Codex `{}` stdout contract remains intact.

- [ ] **Step 1: Write a failing Codex installation test**

Use a temporary `CODEX_HOME`, call `installCodex()`, and assert all three hook files exist. Read the installed `setup-venv.js` and assert it delegates to `ensureBaseEnvironment` and does not contain the literal unconditional command `install -q jinja2`.

Run: `node --test tests/codex-python-env.test.js`

Expected: FAIL because `python-env.js` and `project-venv.js` are not copied and the old hook contains unconditional pip installation.

- [ ] **Step 2: Implement the thin Codex hook and installer copying**

Replace duplicated constants/install logic in `setup-venv.js` with `ensureBaseEnvironment({ logger: log })`; retain helper-script copying, stderr logging, outer error handling, and final `process.stdout.write("{}")`. Log actual `created`/`reused` and package installation results.

Change the Codex installer to loop over the three exact hook filenames and copy each from `PKG_ROOT/hooks` to the cache `hooks` directory.

- [ ] **Step 3: Run Codex and regression tests**

Run: `node --test tests/codex-python-env.test.js tests/plugin.test.js tests/python-env.test.js`

Expected: PASS; installation remains within temporary `CODEX_HOME`, and `{}` output handling remains in the hook.

- [ ] **Step 4: Review checkpoint**

Run: `git diff --check -- hooks/setup-venv.js .codex/plugins/setup.js tests/codex-python-env.test.js && git diff -- hooks/setup-venv.js .codex/plugins/setup.js`

Expected: no cache behavior changes outside the three-hook copy loop and no unconditional pip invocation.

---

### Task 5: Python Dependency Routing Skills

**Files:**
- Modify: `skills/agents-python-tools/SKILL.md`
- Modify: `skills/markitdown-converter/SKILL.md:72-82`
- Modify: `skills/playwright-web-scraping/SKILL.md:96-108`
- Modify: `skills/doctor/SKILL.md:52-60`
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: Task 2 CLI and base interpreter routing.
- Produces: agent instructions that consistently choose base for tools and `.omagents/venv` for project dependencies.

- [ ] **Step 1: Add failing skill-routing tests**

Add assertions that:

- `agents-python-tools` contains `<project-root>/.omagents/venv`, `project-venv.js pip`, `OMAGENTS_PROJECT_ONLY`, and retains `on-demand` for non-core tools.
- `agents-python-tools` no longer routes project dependencies to `<project-root>/.venv` and does not instruct direct project pip with overlay enabled.
- MarkItDown and Playwright use base Python `-m pip` and perform an import check before installation.
- Doctor checks the overlay, Python `majorMinor`, normal-mode import, and project-only isolation.

Run: `node --test tests/skills.test.js`

Expected: new assertions FAIL against the current skills.

- [ ] **Step 2: Update dependency routing and tool setup instructions**

Document the exact commands from Task 2. Preserve the existing rule that only `jinja2` is eagerly installed and all other tools are on-demand. State that existing `.venv` directories remain untouched, project-declared dependencies must be local even if base has them, and base console scripts are not copied into project venvs.

Use absolute base interpreter examples with the existing Windows substitution table; do not introduce shell-specific project helpers.

- [ ] **Step 3: Update doctor diagnostics**

Add base health, project/base `majorMinor`, `.pth` target, normal import, and `OMAGENTS_PROJECT_ONLY=1` isolation checks using `project-venv.js` where applicable. Keep the existing MCP timeout guidance unchanged.

- [ ] **Step 4: Run skill tests**

Run: `node --test tests/skills.test.js tests/python-env.test.js`

Expected: PASS; routing text matches the implemented CLI and no skill claims all tools are pre-installed.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check -- skills tests/skills.test.js && git diff -- skills/agents-python-tools/SKILL.md skills/markitdown-converter/SKILL.md skills/playwright-web-scraping/SKILL.md skills/doctor/SKILL.md`

Expected: only Python environment routing and diagnostics change.

---

### Task 6: Documentation, CI, Packaging, and Acceptance

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`, `README.zh-cn.md`, `README.ja.md`, `README.ko.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/INTEGRATION-CHECKLIST.md`
- Modify: `package.json:33-34`
- Modify: `.github/workflows/ci.yml:23-47`
- Verify: all files from Tasks 1-5

**Interfaces:**
- Consumes: completed implementation and tests from Tasks 1-5.
- Produces: synchronized user/developer documentation and CI coverage for every new runtime file.

- [ ] **Step 1: Update project and user documentation**

Document base persistence, on-demand `.omagents/venv`, the switchable overlay, project-only pip, version matching, on-demand tool installation, and coexistence with existing `.venv`. Update architecture/key-variable sections and the integration checklist with the exact Task 2 commands.

Apply equivalent content to all four README languages in the same change. Add a CHANGELOG entry describing persistent base reuse, honest provisioning logs, and safe project overlays. Do not bump the package version or rewrite historical records.

- [ ] **Step 2: Include new hooks in formatting and CI**

Change package formatting paths to cover `hooks/*.js` and add `hooks/python-env.js` plus `hooks/project-venv.js` to CI syntax checks. Keep existing Python compile, test, and template validation steps.

- [ ] **Step 3: Run syntax, formatting, and all unit/integration tests**

Run:

```bash
node --check hooks/python-env.js
node --check hooks/project-venv.js
node --check hooks/setup-venv.js
node --check .opencode/plugins/index.js
node --check .codex/plugins/setup.js
npm run format:check
node --test tests/*.test.js
python3 -m py_compile skills/deep-research/scripts/*.py skills/_shared/scripts/loop_engine.py
```

Expected: every command exits 0; real-Python overlay tests pass without network installation.

- [ ] **Step 4: Verify package contents**

Run: `npm pack --dry-run`

Expected: exit 0 and the package listing includes all three files under `hooks/`, the modified plugin entries, skills, spec/plan documents, and no `.omagents/venv` content.

- [ ] **Step 5: Run manual project dependency smoke test**

In a temporary demo project with a tiny local package/fixture, run `ensure` twice, install a project dependency through `project-venv.js pip`, and print its `__file__` through `run`. Verify the second ensure reports `reused`, the project dependency resolves under `.omagents/venv`, base Jinja2 is visible only when not shadowed, and base package inventory is unchanged except for an initially missing core package.

- [ ] **Step 6: Final read-only review**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only intended source/test/doc files are modified; no real home-directory venv or git mutation was performed. Report any remaining platform-specific risk explicitly instead of claiming unverified Windows/macOS coverage.
