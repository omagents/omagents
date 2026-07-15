# OmAgents Cross-Platform Integration Checklist

This checklist is used to verify that the OmAgents plugin works correctly across supported AI platforms (OpenCode, Claude Code, and Codex).

## Pre-requisites

- [ ] **Node.js**: Version 24 is installed.
- [ ] **Python**: Python 3.11 or later is installed and available as `python3`.
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
- [ ] Confirm `.opencode/plugins/index.js` has no uncommitted modifications:
  ```bash
  git diff -- .opencode/plugins/index.js
  ```
  The command should produce no output.

## Claude Code Verification Steps

1. [ ] Run the platform sync:
   ```bash
   npm run sync
   ```
2. [ ] Verify the generated `.claude-plugin/` and `.codex-plugin/` directories are tracked in git:
   ```bash
   git ls-files .claude-plugin/ .codex-plugin/ | head
   ```
   The command should list files from both directories, confirming they are tracked.
3. [ ] Verify `.claude-plugin/plugin.json` exists and is valid JSON.
4. [ ] Verify `.claude-plugin/hooks/hooks.json` exists and references `setup-venv.sh` in a `SessionStart` hook.
5. [ ] Verify `.claude-plugin/.mcp.json` exists and contains the expected MCP servers: `agentmemory`, `codegraph`, `context7`, `websearch`.
6. [ ] Start a Claude Code session pointing at the local plugin directory:
   ```bash
   claude --plugin-dir /path/to/omagents/.claude-plugin
   ```
7. [ ] In the session, send:
   ```text
   Let's make a react todo list
   ```
   Verify that the `brainstorming` skill is triggered and begins the design process.

## Codex Verification Steps

1. [ ] Run the platform sync:
   ```bash
   npm run sync
   ```
2. [ ] Verify the generated `.claude-plugin/` and `.codex-plugin/` directories are tracked in git:
   ```bash
   git ls-files .claude-plugin/ .codex-plugin/ | head
   ```
   The command should list files from both directories, confirming they are tracked.
3. [ ] Verify `.codex-plugin/plugin.json` exists and is valid JSON.
4. [ ] Verify `.codex-plugin/hooks/hooks.json` exists and references `setup-venv.sh` in a `SessionStart` hook.
5. [ ] Verify `.codex-plugin/.mcp.json` exists and contains the expected MCP servers: `agentmemory`, `codegraph`, `context7`, `websearch`.
6. [ ] Add the plugin in Codex and verify skill discovery completes without errors.
7. [ ] In a chat session, send:
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

## Global Constraints

Keep the following constraints in mind when maintaining the cross-platform integration:

- **OpenCode plugin unchanged**: The OpenCode plugin entry point at `.opencode/plugins/index.js` must not be altered to support Claude Code or Codex. The generated `.claude-plugin/` and `.codex-plugin/` directories contain the platform-specific adaptations.
- **Superpowers pinned**: The `superpowers` dependency is pinned to a specific commit in `package.json`. Do not unpin it unless the change is tested across all platforms.
- **Only jinja2 is auto-installed**: The agent venv setup installs `jinja2` automatically. Any other Python tooling required by a skill must be installed on-demand by that skill.
- **README changes mirrored**: Any change to `README.md` must also be reflected in `README.zh-cn.md`, `README.ja.md`, and `README.ko.md` in the same commit.
