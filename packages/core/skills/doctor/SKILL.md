---
name: doctor
description: "Diagnose OmAgents installation and configuration. Trigger when the user says 'doctor', 'diagnose', or encounters issues with MCP servers, skills, venv, or plugin loading. Checks plugin registration, MCP connectivity, Python venv, skill discovery, and PATH injection."
---

# Doctor: OmAgents Diagnostics

Verify that OmAgents is correctly installed, configured, and operational.

## When to Use

- User says `/doctor` or "diagnose"
- MCP server not responding
- Skill not appearing
- Python tool not working
- "Something is wrong but I don't know what"

## Diagnostic Checks

Run each check in order. Report PASS/FAIL for each with a one-line explanation.

### 1. Plugin Registration

Check that `@omagents/omagents` is in the OpenCode plugin config:

```bash
cat ~/.config/opencode/opencode.json
```

- **PASS**: `"@omagents/omagents"` appears in the `plugin` array
- **FAIL**: Not found. Tell the user to add it and restart OpenCode.

### 2. MCP Server Connectivity

Each MCP server should be reachable. `OMAGENTS_SEARCH_PROVIDER` selects `auto` (the default when `OMAGENTS_SEARCH_PROVIDER` is unset or empty), `exa`, `keenable`, or `youcom`. In `auto`, the only built-in search registration is a local stdio `websearch` Search MCP Proxy; explicit `exa` and `keenable` retain their direct registrations, while explicit `youcom` uses direct `youdotcom`. Check:

| MCP | How to verify |
|-----|---------------|
| `agentmemory` | `npx -y @agentmemory/mcp < /dev/null` exits promptly with code 0 |
| `codegraph` | `npx -y @colbymchenry/codegraph serve --mcp < /dev/null` exits promptly |
| `context7` | `npx -y @upstash/context7-mcp < /dev/null` exits promptly |
| `websearch` in auto | Verify the local Proxy handshake and generic `websearch_search` / `websearch_fetch` tools, then inspect an actual response for provider evidence. |
| `websearch` with explicit Exa | Remote URL `https://mcp.exa.ai/mcp` is reachable; when `EXA_API_KEY` is set, the registered config includes an `x-api-key` header. |
| `keenable` with explicit Keenable | `KEENABLE_API_KEY` selects `https://api.keenable.ai/mcp` with an `X-API-Key` header; without a key, use `https://api.keenable.ai/mcp-public` without that header. |
| `youdotcom` with explicit You.com | `YDC_API_KEY` selects keyed `https://api.you.com/mcp` with `Authorization: Bearer <YDC_API_KEY>`; without a key, use keyless `https://api.you.com/mcp/free` without an Authorization header. |
| `github` / `grep_app` | Check if `GITHUB_TOKEN` env var is set. If set, github MCP should work. If not, grep_app fallback is used. |

In auto, the Proxy follows Exa → Keenable → You.com and programmatically makes at most one attempt per eligible position, advancing only after a fallback-eligible failure at that position: transport/session failures, timeouts, MCP protocol or malformed responses, HTTP 408/429/5xx, explicit temporary/rate-limit/retryable failures, or an otherwise unclassified backend `isError`. A valid success, including zero search hits, never falls back. Local validation, backend tool/page HTTP 400/401/403/404/422, known authentication, authorization, invalid-parameter, and permission failures, `Retryable: no`, caller cancellation, stdin closure, and shutdown stop the chain without another provider attempt. After a fallback-eligible Exa failure, every later call in the same Proxy process uses Keenable → You.com → Exa until the Proxy is recreated; this memory-only state has no cooldown or persistence.

Distinguish the configured route (`auto` or an explicit provider) from runtime provider evidence. Use the actual response's prepended `Provider: exa|keenable|youcom` and optional `Fallback: <from> failed (<code>)` lines, or `_meta.omagents.provider`, `_meta.omagents.fallback`, and `_meta.omagents.fallbacks`, rather than configuration inference. A You.com success after two eligible failures exposes ordered two-fallback history through `fallbacks`; `fallback` continues to identify the first eligible failure. When all three providers fail, the error identifies the attempts actually made in route order with bounded, redacted categories. Only calls through the OmAgents-registered Proxy guarantee failover. Host-native web tools and a user-overridden `websearch` entry are not wrapped and are outside automatic failover.

Do NOT probe local (stdio) MCP servers with `--help` — they ignore the flag
and block on stdin forever. Stdio servers exit cleanly on stdin EOF, so
redirect `< /dev/null` instead. A cold npx cache can make the first run slow
(package download); that is normal and not a hang.

Report which MCPs are configured and credential presence only. Never print API key values or authorization headers, and do not replace redacted Proxy errors with raw backend payloads.

### 3. Python Venv

```bash
ls ~/.venvs/omagents/bin/python
~/.venvs/omagents/bin/python -c "import jinja2; print(jinja2.__version__)"
```

- **PASS**: venv exists and jinja2 is importable
- **FAIL**: venv missing or jinja2 not installed. Tell user to restart OpenCode (the plugin provisions it on session.created).

For a project using `.omagents/venv`, also inspect the overlay:

1. Run `node <omagents-core>/hooks/project-venv.js ensure --root <project-root>` to validate or idempotently repair the overlay. A broken interpreter or Python `majorMinor` mismatch is a **FAIL** and must not trigger automatic deletion. Read the versions and site paths directly when diagnosing a failure (use `Scripts/python.exe` on Windows):
   ```bash
   ~/.venvs/omagents/bin/python -c "import sys,sysconfig; print('.'.join(map(str,sys.version_info[:2]))); print(sysconfig.get_path('purelib')); print(sysconfig.get_path('platlib'))"
   <project-root>/.omagents/venv/bin/python -c "import sys,sysconfig; print('.'.join(map(str,sys.version_info[:2]))); print(sysconfig.get_path('purelib')); print(sysconfig.get_path('platlib'))"
   ```
2. Inspect project `pyvenv.cfg`: `include-system-site-packages` must be `false`.
3. Locate the project `purelib` and confirm `omagents-base.pth` exists and points to the base `purelib`/`platlib` reported by `sysconfig`. When `purelib` and `platlib` differ, both must be present. Compare paths after `os.path.normcase(os.path.realpath(...))` normalization.
4. **Normal mode** must import base-only tools through the project interpreter:
   ```bash
   node <omagents-core>/hooks/project-venv.js run --root <project-root> -- -c "import jinja2; print(jinja2.__file__)"
   ```
   **PASS** only when the normalized `jinja2.__file__` is beneath base `purelib`/`platlib` for a base-only package. If the project declares Jinja2 locally, its normalized path must instead be beneath the project `purelib`, proving the project copy wins.
5. Project-only isolation must remove both base paths. On Unix, substitute the reported paths and run:
   ```bash
   OMAGENTS_PROJECT_ONLY=1 BASE_PURELIB='<base-purelib>' BASE_PLATLIB='<base-platlib>' <project-root>/.omagents/venv/bin/python -c "import os,sys; paths={os.path.normcase(os.path.realpath(p)) for p in sys.path}; assert all(os.path.normcase(os.path.realpath(p)) not in paths for p in [os.environ['BASE_PURELIB'], os.environ['BASE_PLATLIB']])"
   ```
   On Windows, set all three variables for the command session and use `Scripts/python.exe`. Also run `node <omagents-core>/hooks/project-venv.js pip --root <project-root> -- show jinja2`: base-only Jinja2 must be reported as not installed; a project-local copy must have its `Location` inside the project `purelib`.
6. Compare project and base `majorMinor`; mismatch can break native extensions and requires explicit project recreation after user confirmation.

### 4. Skill Discovery

Verify the skills directory exists and contains SKILL.md files:

```bash
ls <omagents-core>/skills/*/SKILL.md
```

- **PASS**: At least 5 SKILL.md files found (deep-research, parallel-execution, agents-python-tools, markitdown-converter, playwright-web-scraping)
- **FAIL**: Skills directory not found or incomplete

### 5. PATH Injection

Verify the shell.env hook is prepending venv and skill scripts:

```bash
echo $PATH | tr ':' '\n' | head -10
```

- **PASS**: `~/.venvs/omagents/bin` appears in PATH
- **FAIL**: venv bin not in PATH. Restart OpenCode.

### 6. Background Subagents

```bash
echo $OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS
```

- **PASS**: Value is `true`
- **FAIL**: Not set. The plugin should set this automatically. Restart OpenCode.

### 7. Superpowers Loading

Check if superpowers was loaded successfully by looking for superpowers skills in the available skills list. If superpowers failed to load, the user will see a warning in the OpenCode console.

### 8. Model Configuration

Check that the user has at least one model configured:

```bash
cat ~/.config/opencode/opencode.json
```

- **PASS**: `model` field is set (e.g., `"model": "anthropic/claude-sonnet-4-5"`)
- **WARN**: `model` not set. Tell user to configure a model or use `/connect` command.
- **INFO**: Check if `small_model` is set (used for titles/summaries). If not, suggest setting it to a cheaper model.
- **INFO**: Suggest configuring a backup provider in case the primary is unavailable.

## Output Format

Present results as a table:

```
| Check | Status | Notes |
|-------|--------|-------|
| Plugin Registration | PASS | Found in opencode.json |
| MCP: agentmemory | PASS | npx available |
| MCP: codegraph | PASS | npx available |
| MCP: context7 | PASS | Remote reachable |
| MCP: websearch | PASS | Local Proxy handshake; response reports provider |
| MCP: github | FAIL | GITHUB_TOKEN not set, using grep_app fallback |
| Python Venv | PASS | jinja2 3.1.4 |
| Skill Discovery | PASS | 5 skills found |
| PATH Injection | PASS | venv bin in PATH |
| Background Subagents | PASS | Enabled |
```

If any check fails, provide the exact command to fix it.
