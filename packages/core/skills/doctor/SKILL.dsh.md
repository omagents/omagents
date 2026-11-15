---
name: doctor
description: "Diagnose the OmAgents DSH Host, native skills and subagents, MCP connectivity, Superpowers bootstrap, Job Board health, and Python base/project environments."
---

# Doctor: OmAgents DSH Diagnostics

Verify the installed `@omagents/omagents-dsh` composition using DSH 0.2.2 contracts. Run checks in order and report PASS, WARN, or FAIL with evidence and a targeted fix. Do not use another host's configuration or lifecycle assumptions.

## 1. Host and Loader Registration

Check that the active DSH profile has the bare package-root Loader row:

```yaml
- id: omagents
  name: "@omagents/omagents-dsh"
```

- **PASS:** the row is enabled and the Host starts without a required-service error.
- **FAIL:** restore the row through the DSH bundle/plugin mechanism and reload the profile. Do not point it at `/dist/host` or add a separate Client Loader row.
- Inspect Host health through the OmAgents Remote `getHealth()` surface or the Web Job Board health presentation when available. Host, persistence, skills, MCP, Python, tools, commands, and context health are independent; one degraded capability must not be reported as total failure.

## 2. Native Skill Discovery and Superpowers

Inspect the current session's native `<available_skills>` catalog and call `skill` for representative entries.

- **PASS:** all 33 packaged entries are present: 18 OmAgents and 15 Superpowers, including `deep-research`, `parallel-execution`, `brainstorming`, and `using-superpowers`. Additional user/project skills may also appear.
- **PASS:** a new top-level session automatically contains the Superpowers bootstrap and the DSH tool mapping before the first task action. A creation request such as "Let's make a react todo list" loads `brainstorming` before product code.
- **PASS:** a delegated session with `session.origin === "subagent"` keeps native skills available but does not restart the controller bootstrap.
- **FAIL:** if entries are absent, inspect skills health and Loader disposal/reactivation diagnostics. Files on disk alone are not proof of native registration or automatic bootstrap.

## 3. Native Subagents and Job Board

Start a small native `subagent` with a self-contained `description` and `prompt` (plus optional `cwd`).

- **PASS:** the call returns an activation immediately, a durable Job Board record appears, and native settlement supplies the terminal result without polling.
- **PASS:** `parallel_status` returns canonical read-only JSON and `/ps` reads the calling session's Board without creating a model prompt.
- **PASS:** `cancel_task` enters `cancelling` once; only native settlement confirms `cancelled`. Local descendants continue and external one-shot runs cannot resume.
- **FAIL:** inspect `tools/result`, `subagent/start`, and `subagent/end` correlation plus `ctx.subagents.interrupt(childId, { kind: "user", parentSessionId })` admission. Do not invent a `background` option or an environment feature flag.

## 4. MCP Registration and Connectivity

OmAgents mounts Core's catalog through the DSH `mcpManager` adapter. Existing Loader-owned user server names take precedence. Local definitions use `stdio`; remote definitions use `streamable-http`.

| Server | Expected check |
|--------|----------------|
| `agentmemory` | Local handshake succeeds through `npx -y @agentmemory/mcp`. |
| `codegraph` | Local handshake succeeds through `npx -y @colbymchenry/codegraph serve --mcp`. |
| `context7` | The configured local or remote Context7 endpoint answers initialization. |
| `websearch` | Hosted `https://mcp.exa.ai/mcp` is reachable; `EXA_API_KEY`, when set, is sent as `x-api-key`. |
| `github` / `grep_app` | `GITHUB_TOKEN` selects GitHub; otherwise the grep.app fallback is expected. |

Model-facing MCP tools use `mcp__<server>__<raw_tool>`, for example `mcp__codegraph__codegraph_explore`. Check for that actual DSH name rather than flattened names from other hosts.

Do not probe a stdio MCP server with `--help`; it can block waiting for protocol input. Use a real MCP handshake fixture or close stdin cleanly. A cold `npx` download can make the first startup slow without being a hang. Report each server's registration/readiness health separately.

## 5. Persistent Python Base

Inspect the base beneath the current home directory (`Scripts/python.exe` on Windows):

```bash
~/.venvs/omagents/bin/python -c "import jinja2; print(jinja2.__version__)"
```

- **PASS:** the interpreter exists and Jinja2 imports.
- **FAIL:** inspect Python capability health and reload the Host after installing a compatible Python 3.11+. Provisioning is nonblocking during Host setup, not an OpenCode session event.
- Only `jinja2` is automatic. MarkItDown, Playwright, and other optional packages are installed on demand by their skills; never repair diagnostics by preinstalling all of them.

## 6. Project Python Overlay

For a project using `.omagents/venv`:

1. Run `node <omagents-core>/hooks/project-venv.js ensure --root <project-root>`. A broken interpreter or base/project `majorMinor` mismatch is a **FAIL** and must not trigger automatic deletion.
2. Read both interpreters' versions and `sysconfig` `purelib`/`platlib`; use `Scripts/python.exe` on Windows.
3. Inspect project `pyvenv.cfg`: `include-system-site-packages` must be `false`.
4. Confirm project `purelib/omagents-base.pth` points to the normalized base `purelib` and `platlib` paths (both when different).
5. **Normal mode** must import base-only Jinja2 through the project interpreter:

   ```bash
   node <omagents-core>/hooks/project-venv.js run --root <project-root> -- -c "import jinja2; print(jinja2.__file__)"
   ```

   A base-only package resolves beneath base site paths; a declared project copy resolves beneath project site paths and wins.
6. **Project-only mode** must remove base paths. On Unix, substitute the reported paths:

   ```bash
   OMAGENTS_PROJECT_ONLY=1 BASE_PURELIB='<base-purelib>' BASE_PLATLIB='<base-platlib>' <project-root>/.omagents/venv/bin/python -c "import os,sys; paths={os.path.normcase(os.path.realpath(p)) for p in sys.path}; assert all(os.path.normcase(os.path.realpath(p)) not in paths for p in [os.environ['BASE_PURELIB'], os.environ['BASE_PLATLIB']])"
   ```

   On Windows, set the variables for the command session and use `Scripts/python.exe`. Also run `node <omagents-core>/hooks/project-venv.js pip --root <project-root> -- show jinja2`: base-only Jinja2 must be absent; a project copy's `Location` must be in project `purelib`.
7. Compare base and project `majorMinor`. Recreate a mismatched overlay only after explicit user confirmation.

## 7. Script and Resource Paths

DSH skill results provide absolute `resourceBase` directories.

- **PASS:** deep research resolves `<omagents-core>/skills/deep-research/scripts/deep_research.py` and `<omagents-core>/skills/_shared/scripts/loop_engine.py`, and loop-based skills use those absolute resources.
- **PASS:** research runs from the project root and resumes the same run-scoped queue.
- **FAIL:** do not assume bare `deep_research.py`, `loop_engine.py`, or venv executables are on `PATH`. DSH does not use the OpenCode shell-environment hook.

## 8. Model and Web Client

Check the active DSH profile's configured provider/model and the Web Client composition.

- **PASS:** the profile has an authorized model route and the OmAgents sidebar/main panel is registered through DSH slots.
- **WARN:** no model route is configured; configure it through DSH rather than another host's JSON file.
- **FAIL:** if the panel is absent, inspect Client slot registration/disposal and Remote authorization. Do not add an iframe, a second application root, or direct `document.body` mounts.

## Output Format

```text
| Check | Status | Evidence and next action |
|-------|--------|--------------------------|
| Loader Host | PASS | Bare @omagents/omagents-dsh row active |
| Native skills | PASS | 33 entries (18 OmAgents + 15 Superpowers) |
| Superpowers bootstrap | PASS | Automatic top-level bootstrap; brainstorming route verified |
| Native subagents | PASS | Activation, Board settlement, and cancellation verified |
| MCP | WARN | GitHub token absent; grep.app fallback active |
| Python base | PASS | Jinja2 imports; optional packages remain on demand |
| Project overlay | PASS | Base inheritance and project-only isolation verified |
| Resource paths | PASS | Absolute skill scripts used |
```

Give the exact DSH-specific repair for every failure. Never recommend deleting either Python environment without explicit confirmation.
