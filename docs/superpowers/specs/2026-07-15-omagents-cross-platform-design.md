# OmAgents Cross-Platform Plugin Support Design

**Date:** 2026-07-15  
**Status:** Draft / Proposed  
**Scope:** Add Codex and Claude Code plugin support to the existing OpenCode plugin, using a single source-of-truth repository and generated per-platform artifacts.

## 1. Problem Statement

OmAgents (`@omagents/omagents`) is currently an OpenCode plugin. Users want to know whether the same capabilities can be delivered as plugins for OpenAI Codex and Anthropic Claude Code, and how much work that would require.

The three harnesses have incompatible plugin models:

| Harness | Plugin model | Runtime capabilities |
|---|---|---|
| OpenCode | JS module (`export default pluginFn`) exporting hooks, config, custom tools | Full runtime control: `session.created`, `shell.env`, `tool.execute.before/after`, chat transforms |
| Claude Code | Manifest-based (`.claude-plugin/plugin.json`), `skills/`, `hooks/`, `bin/`, `.mcp.json` | Shell-command hooks only; no JS runtime to intercept tool calls |
| Codex | Manifest-based (`.codex-plugin/plugin.json`), `skills/`, `hooks/`, `.mcp.json`, assets | Shell-command hooks only; no JS runtime to intercept tool calls |

Therefore, supporting all three requires a platform-agnostic source-of-truth and generated per-platform artifacts.

## 2. Goals

1. Make OmAgents installable on Claude Code and Codex as a first-class plugin.
2. Keep the existing OpenCode plugin behavior unchanged.
3. Reuse existing skills and MCP server definitions with minimal per-platform adaptation.
4. Avoid duplicating source content; use a sync/build script to generate platform artifacts.
5. Provide clear documentation and installation instructions for each harness.

## 3. Non-Goals

1. **100% feature parity for runtime features that are not portable.** The OpenCode-specific parallel execution engine (Job Board that intercepts `task` calls) cannot be directly ported to Claude/Codex plugins. This design treats it as a separate, optional phase.
2. **Replacing OpenCode plugin with a manifest-based plugin.** OpenCode continues to use its JS plugin.
3. **Supporting every available harness immediately.** This design focuses on Claude Code and Codex.

## 4. High-Level Architecture

```
omagents (single source-of-truth)
├── skills/                 # Platform-agnostic skill source files
├── mcp-servers/            # Platform-agnostic MCP server definitions
├── hooks/                  # Common hook scripts (e.g. venv setup)
├── bin-src/                # Common wrapper scripts for skill helper tools
├── scripts/
│   └── sync-platform.sh    # Generate .claude-plugin/ and .codex-plugin/
├── .opencode/              # OpenCode plugin (existing, unchanged)
├── .claude-plugin/         # Generated Claude plugin
│   ├── plugin.json
│   ├── skills/
│   ├── .mcp.json
│   ├── hooks/
│   └── bin/
└── .codex-plugin/          # Generated Codex plugin
    ├── plugin.json
    ├── skills/
    ├── .mcp.json
    └── hooks/
```

### Build flow

1. Author or edit skills in `skills/`.
2. Author platform overrides in `overrides/<platform>/...` if a skill needs platform-specific text.
3. Run `npm run sync` (or `scripts/sync-platform.sh`).
4. The sync script:
   - Reads `package.json` for version/metadata.
   - Copies/transforms skills into `.claude-plugin/skills/` and `.codex-plugin/skills/`.
   - Generates `.mcp.json` for each platform.
   - Generates `plugin.json` for each platform.
   - Copies hook scripts and `bin/` wrappers.

## 5. Platform Details

### 5.1 OpenCode

Keep the existing `.opencode/plugins/index.js` and `.opencode/plugins/parallel.js`. No changes required for this design, except possibly moving MCP definitions to a shared source so they can be reused.

### 5.2 Claude Code

Claude plugins use `.claude-plugin/plugin.json` and auto-discover:

- `skills/` directories containing `SKILL.md`
- `.mcp.json` for MCP servers
- `hooks/hooks.json` for lifecycle hooks
- `bin/` for executables added to the Bash tool PATH

**Manifest (`plugin.json`):**

```json
{
  "name": "omagents",
  "displayName": "OmAgents",
  "version": "0.5.0",
  "description": "Agent toolkit: deep research, loop workflows, MCP servers, and Python tooling.",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json",
  "dependencies": [
    {
      "name": "superpowers",
      "version": "~6.1.0"
    }
  ]
}
```

**MCP configuration (`.mcp.json`):**

```json
{
  "agentmemory": { "type": "local", "command": ["npx", "-y", "@agentmemory/mcp"] },
  "codegraph": { "type": "local", "command": ["npx", "-y", "@colbymchenry/codegraph", "serve", "--mcp"] },
  "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" },
  "websearch": { "type": "remote", "url": "https://mcp.exa.ai/mcp" },
  "grep_app": { "type": "remote", "url": "https://mcp.grep.app" }
}
```

Note: GitHub MCP requires `GITHUB_TOKEN`; static `.mcp.json` cannot express the fallback from `github` to `grep_app`. The recommended default is to include `grep_app` and document that users can add the GitHub MCP manually if they have a token.

**Hooks (`hooks/hooks.json`):**

Use `SessionStart` to ensure the Python venv exists:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/setup-venv.sh"
          }
        ]
      }
    ]
  }
}
```

**`bin/` wrapper scripts:**

Place scripts like `loop_engine`, `deep_research`, `markitdown`, `playwright-scrape` in `.claude-plugin/bin/`. Each wrapper calls the venv Python interpreter at `~/.venvs/omagents/bin/python` with the appropriate script under the plugin root.

### 5.3 Codex

Codex plugins use `.codex-plugin/plugin.json` and auto-discover:

- `skills/` directory
- `hooks/hooks.json`
- `.mcp.json`
- `assets/` for plugin marketplace metadata

Codex has no `bin/` auto-PATH feature, so skill instructions must reference tools by full path or use wrapper scripts that are explicitly called.

**Manifest (`plugin.json`):**

```json
{
  "name": "omagents",
  "version": "0.5.0",
  "description": "Agent toolkit: deep research, loop workflows, MCP servers, and Python tooling.",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json",
  "interface": {
    "displayName": "OmAgents",
    "shortDescription": "Agent toolkit for research, loops, and tooling.",
    "longDescription": "...",
    "developerName": "OmAgents",
    "category": "Developer Tools",
    "capabilities": ["Read", "Write"]
  }
}
```

Codex plugin manifests do not clearly support a `dependencies` field for other plugins. Therefore, superpowers skills must be bundled into `.codex-plugin/skills/` or users must install the superpowers plugin separately.

**Hooks:**

Use `SessionStart` to run venv setup, similar to Claude.

### 5.4 Python venv & tooling

Common requirements:

- venv location: `~/.venvs/omagents`
- auto-install: `jinja2` only (keep the same contract as OpenCode)
- other packages installed on-demand by skills

**Setup script (`hooks/setup-venv.sh`):**

```bash
#!/usr/bin/env bash
set -e
VENV=~/.venvs/omagents
if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install -q jinja2 || true
```

This script is shared across platforms. It is invoked by the `SessionStart` hook.

### 5.5 Parallel execution engine

OpenCode's `parallel.js` is not portable. For Claude/Codex, this design defers a full port.

**Short-term approach:**
- Do not attempt to intercept `task` calls.
- Remove or rewrite the OpenCode-specific parallel execution instructions in skills.
- Let each harness's native subagent/parallel mechanism handle parallelism.

**Future option:**
- Implement a small MCP server (`omagents-parallel`) that exposes `parallel_status` and `cancel_task`.
- Skills that need background tracking would explicitly call this MCP server.
- This is out of scope for the initial design.

## 6. Skill Platformization

### 6.1 Tool name mapping

Skills reference tools by name. The same name differs across harnesses.

| Concept | OpenCode | Claude Code | Codex |
|---|---|---|---|
| Web search | `websearch_web_search_exa` | `WebSearch` | `web_search` |
| Web fetch | `webfetch` / `websearch_web_fetch_exa` | `WebFetch` | `web_fetch` |
| Read file | `read` | `Read` | `Read` |
| Write file | `write` | `Write` | `Write` |
| Edit file | `edit` | `Edit` | `Edit` |
| Bash | `bash` | `Bash` | `Bash` |
| Subagent | `task(..., background: true)` | `Agent` | `subagent` |
| GitHub search | `github_search_code` | `mcp__github__search_code` | `mcp__github__search_code` |
| CodeGraph | `codegraph_codegraph_explore` | `mcp__codegraph__...` | `mcp__codegraph__...` |

### 6.2 Transformation strategy

Use template placeholders in source skills and let the sync script replace them per platform.

Example in source `SKILL.md`:

```markdown
Use `{{tool:websearch}}` to find sources, then `{{tool:webfetch}}` to read them.
Dispatch parallel research tasks with `{{tool:subagent_parallel}}`.
```

Claude output:

```markdown
Use `WebSearch` to find sources, then `WebFetch` to read them.
Dispatch parallel research tasks with `Agent`.
```

Codex output:

```markdown
Use `web_search` to find sources, then `web_fetch` to read them.
Dispatch parallel research tasks with `subagent`.
```

For skills that need larger platform-specific differences, use per-platform override files:

```
skills/
  deep-research/
    SKILL.md
    SKILL.claude.md   # optional override
    SKILL.codex.md    # optional override
```

The sync script prefers the override file if it exists; otherwise it transforms the base `SKILL.md`.

## 7. Superpowers Bundling

- **Claude Code:** Declare `superpowers` in `plugin.json` `dependencies`. The Claude plugin system should load it.
- **Codex:** No confirmed plugin dependency mechanism. Bundle superpowers skills into `.codex-plugin/skills/` during sync.
- **OpenCode:** Continue using `import("superpowers")` in `.opencode/plugins/index.js`.

The sync script should be able to pull `node_modules/superpowers/skills/` into generated Codex skills directory.

## 8. Release & Versioning

1. Bump version in root `package.json` and `CHANGELOG.md`.
2. Run `npm run sync` to regenerate platform manifests.
3. Commit regenerated `.claude-plugin/` and `.codex-plugin/`.
4. Tag `vX.Y.Z`.
5. OpenCode: publish `@omagents/omagents` to npm via existing `publish.yml`.
6. Claude/Codex: users install from the git tag or a marketplace entry pointing to the repo root.

## 9. Testing & Acceptance

1. **CI checks:**
   - `npm run sync` runs cleanly.
   - Generated `plugin.json` and `.mcp.json` are valid JSON.
   - No OpenCode-only tool names leak into Claude/Codex generated skills.

2. **Harness testing:**
   - Claude Code: install the local plugin with the repo root, verify `doctor` or `deep-research` skill loads.
   - Codex: install the local plugin, verify skill discovery.
   - Acceptance prompt for process skills:
     > "Let's make a react todo list"
     The `brainstorming` skill should auto-trigger.

## 10. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Codex does not support plugin dependencies | Bundle superpowers skills into `.codex-plugin/skills/` |
| Tool names differ and may drift | Central mapping table in sync script; CI diff-check |
| Parallel execution engine cannot be ported directly | Drop for initial version; document limitation |
| Claude `bin/` and Codex hook PATH differ | Use platform-specific wrappers and absolute paths |
| Generated files could diverge from source | CI enforces `npm run sync` and fails if working tree is dirty |

## 11. Effort Estimate

| Phase | Days |
|---|---|
| Sync script + directory structure + CI | 3–4 |
| Claude plugin generation | 5–7 |
| Codex plugin generation | 5–7 |
| Skill platformization / tool mapping | 5–7 |
| Python venv / wrapper scripts | 3–4 |
| Superpowers bundling for Codex | 2–3 |
| Testing in real harnesses | 3–5 |
| Documentation (README all 4 languages) | 2–3 |
| **Total** | **~4–6 weeks (single developer)** |

## 12. Next Steps

After this design is approved, the implementation plan should be:

1. Add `scripts/sync-platform.sh` and the source-of-truth layout.
2. Implement Claude plugin generation.
3. Implement Codex plugin generation.
4. Add tool-name transformation and per-platform skill overrides.
5. Add venv setup hook and wrapper scripts.
6. Add CI checks.
7. Test end-to-end in Claude Code and Codex.
8. Update README and language variants.
