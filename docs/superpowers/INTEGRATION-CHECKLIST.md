# OmAgents Cross-Platform Integration Checklist

This checklist is used to verify that the OmAgents plugin works correctly across supported AI platforms (OpenCode, Claude Code, and Codex).

## Pre-requisites

- [ ] **Node.js**: Version 24 or later is installed.
- [ ] **Python**: Python 3 is installed and available as `python3`.
- [ ] **Git**: Repository is cloned locally.
  ```bash
  git clone https://github.com/omagents/omagents.git
  cd omagents
  ```
- [ ] **Dependencies**: `npm install` has been run to install Node dependencies and the bundled `superpowers` package.
  ```bash
  npm install
  ```

## OpenCode Plugin Verification

The OpenCode plugin entry point lives at `.opencode/plugins/index.js`.

- [ ] Run the test suite:
  ```bash
  npm test
  ```
- [ ] Confirm all tests pass.

## Claude Code Verification Steps

1. [ ] Run the platform sync:
   ```bash
   npm run sync
   ```
2. [ ] Verify `.claude-plugin/plugin.json` exists and is valid JSON.
3. [ ] Verify `.claude-plugin/hooks/hooks.json` exists and references `setup-venv.sh` in a `SessionStart` hook.
4. [ ] Verify `.claude-plugin/.mcp.json` exists and contains the expected MCP servers: `agentmemory`, `codegraph`, `context7`, `websearch`.
5. [ ] Start a Claude Code session pointing at the local plugin directory:
   ```bash
   claude --plugin-dir /path/to/omagents/.claude-plugin
   ```
6. [ ] In the session, send:
   ```text
   Let's make a react todo list
   ```
   Verify that the `brainstorming` skill is triggered and begins the design process.

## Codex Verification Steps

1. [ ] Run the platform sync:
   ```bash
   npm run sync
   ```
2. [ ] Verify `.codex-plugin/plugin.json` exists and is valid JSON.
3. [ ] Verify `.codex-plugin/hooks/hooks.json` exists and references `setup-venv.sh` in a `SessionStart` hook.
4. [ ] Verify `.codex-plugin/.mcp.json` exists and contains the expected MCP servers: `agentmemory`, `codegraph`, `context7`, `websearch`.
5. [ ] Add the plugin in Codex and verify skill discovery completes without errors.
6. [ ] In a chat session, send:
   ```text
   Let's make a react todo list
   ```
   Verify that the `brainstorming` skill is triggered and begins the design process.

## Local Automated Verification

Run the following commands from the repository root:

```bash
npm run sync
npm test
npm run format:check
```

- [ ] `npm run sync` completes without errors.
- [ ] `npm test` passes all tests.
- [ ] `npm run format:check` reports no formatting issues.
- [ ] All four generated plugin manifests are valid JSON:
  - `.claude-plugin/plugin.json`
  - `.claude-plugin/hooks/hooks.json`
  - `.codex-plugin/plugin.json`
  - `.codex-plugin/hooks/hooks.json`
