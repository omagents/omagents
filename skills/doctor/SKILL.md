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

Each MCP server should be reachable. Check:

| MCP | How to verify |
|-----|---------------|
| `agentmemory` | `npx -y @agentmemory/mcp --help` exits successfully |
| `codegraph` | `npx -y @colbymchenry/codegraph --help` exits successfully |
| `context7` | Remote URL `https://mcp.context7.com/mcp` is reachable |
| `websearch` | Remote URL `https://mcp.exa.ai/mcp` is reachable |
| `github` / `grep_app` | Check if `GITHUB_TOKEN` env var is set. If set, github MCP should work. If not, grep_app fallback is used. |

Report which MCPs are configured and whether the token/key is present.

### 3. Python Venv

```bash
ls ~/.venvs/omagents/bin/python
~/.venvs/omagents/bin/python -c "import jinja2; print(jinja2.__version__)"
```

- **PASS**: venv exists and jinja2 is importable
- **FAIL**: venv missing or jinja2 not installed. Tell user to restart OpenCode (the plugin provisions it on session.created).

### 4. Skill Discovery

Verify the skills directory exists and contains SKILL.md files:

```bash
ls skills/*/SKILL.md
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

## Output Format

Present results as a table:

```
| Check | Status | Notes |
|-------|--------|-------|
| Plugin Registration | PASS | Found in opencode.json |
| MCP: agentmemory | PASS | npx available |
| MCP: codegraph | PASS | npx available |
| MCP: context7 | PASS | Remote reachable |
| MCP: websearch | PASS | Remote reachable |
| MCP: github | FAIL | GITHUB_TOKEN not set, using grep_app fallback |
| Python Venv | PASS | jinja2 3.1.4 |
| Skill Discovery | PASS | 5 skills found |
| PATH Injection | PASS | venv bin in PATH |
| Background Subagents | PASS | Enabled |
```

If any check fails, provide the exact command to fix it.
