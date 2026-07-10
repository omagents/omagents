# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)
[![npm version](https://img.shields.io/npm/v/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![npm downloads](https://img.shields.io/npm/dm/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![GitHub stars](https://img.shields.io/github/stars/omagents/omagents?style=social)](https://github.com/omagents/omagents/stargazers)

An OpenCode plugin that bundles agent skills, MCP servers, parallel execution, and superpowers into a single install.

---

## Skip This README

Paste this into your agent:

```
Read this and install omagents: https://raw.githubusercontent.com/omagents/omagents/main/README.md
```

---

## Installation

### TL;DR

| You want | Do this | What happens |
| :--- | :--- | :--- |
| **Stable** (npm) | Add `"@omagents/omagents"` to `opencode.json` plugin array | Plugin auto-installs from npm, superpowers bundled |
| **Pinned** | Add `"@omagents/omagents@^0.1.0"` | Same, but locked to a version range |
| **Bleeding edge** (git) | Add `"@omagents/omagents@git+https://github.com/omagents/omagents.git"` | Latest source from main branch |

### For Humans

**Prerequisites:** [OpenCode](https://opencode.ai) installed and running.

1. Open your OpenCode config:

```bash
open -e ~/.config/opencode/opencode.json
```

2. Add `@omagents/omagents` to the `plugin` array:

```json
{
  "plugin": [
    "@omagents/omagents"
  ]
}
```

3. Restart OpenCode.

That's it. On first launch OmAgents will automatically:
- Install **superpowers** (bundled, no separate install needed)
- Register all **skills** (OmAgents + Superpowers)
- Register all **MCP servers** (agentmemory, codegraph, context7, websearch, github/grep_app)
- Enable **parallel execution** (background agents with `/ps` and `cancel_task`)
- Set up **Python venv** at `~/.venvs/omagents` (installs `jinja2` for report templates)

### For LLM Agents

If you're an AI agent helping a user install OmAgents, follow these steps:

```bash
# 1. Read the user's current OpenCode config
cat ~/.config/opencode/opencode.json

# 2. Add "@omagents/omagents" to the plugin array
#    Use jq if available, otherwise edit manually

# 3. Verify the config is valid JSON after editing

# 4. Tell the user to restart OpenCode
```

The plugin handles everything else automatically — no manual MCP configuration, no skill installation, no venv setup.

### Optional: API Keys

Some remote MCP servers accept optional API keys for higher rate limits:

```bash
# ~/.zshrc or ~/.bashrc
export EXA_API_KEY="your-exa-key"
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

Setting `GITHUB_TOKEN` enables the full GitHub Copilot MCP (issues, PRs, repos, code search). Without it, OmAgents falls back to Vercel's `mcp.grep.app` for public code search only.

### Combine with Other Plugins

OmAgents' hook merging mechanism ensures no conflicts with additional plugins:

```json
{
  "plugin": [
    "@omagents/omagents",
    "@devcxl/opencode-spec"
  ]
}
```

---

## Highlights

| | Feature | What it does |
| :---: | :--- | :--- |
| 🧠 | **Superpowers** (14 skills) | Brainstorming before implementation, TDD, systematic debugging, plan writing, code review, git worktrees |
| 🔍 | **Deep Research** | Multi-source iterative research with items × fields matrix, gap detection, Jinja2 reports |
| ⚡ | **Parallel Execution** | Background task dispatch via `task(background: true)`, Job Board tracking, `/ps` command |
| 📚 | **Built-in MCPs** | agentmemory, codegraph, context7, websearch, github/grep_app — all auto-registered |
| 🐍 | **Python Tooling** | Dedicated venv at `~/.venvs/omagents`, auto-installs jinja2 and skill dependencies |
| 📄 | **MarkItDown** | Convert PDF, DOCX, XLSX, PPTX, HTML to Markdown |
| 🌐 | **Web Scraping** | Playwright-based page fetching and scraping |
| 🔗 | **GitHub** | Full GitHub API when `GITHUB_TOKEN` is set; falls back to `mcp.grep.app` without token |

---

## What's Included

### Skills

| Skill | Source | Description |
|-------|--------|-------------|
| `deep-research` | OmAgents | Multi-source, iterative research with items × fields, gap detection, and Jinja2 reports |
| `parallel-execution` | OmAgents | Background parallel task dispatch with Job Board tracking |
| `agents-python-tools` | OmAgents | Routes Python tooling to the dedicated `~/.venvs/omagents` venv |
| `markitdown-converter` | OmAgents | Convert documents (PDF, DOCX, XLSX, etc.) to Markdown |
| `playwright-web-scraping` | OmAgents | Web scraping and page fetching with Playwright |
| `superpowers` (14 skills) | Superpowers | Brainstorming, TDD, debugging, planning, git worktrees, and more |

### MCP Servers

| MCP | Type | Notes |
|-----|------|-------|
| `agentmemory` | Local | Session memory and audit |
| `codegraph` | Local | Codebase symbol graph and exploration |
| `context7` | Remote | Documentation search (free tier available) |
| `websearch` | Remote | Web search via Exa (free tier available) |
| `github` / `grep_app` | Remote | GitHub Copilot MCP when `GITHUB_TOKEN` is set; otherwise `mcp.grep.app` for public code search |

### Parallel Execution

- Background task dispatch via OpenCode's native `task(background: true)`
- Job Board tracking with automatic result injection
- `/ps` command to check running tasks
- `cancel_task` tool to cancel background tasks
- `parallel_status` tool for programmatic status checks

---

## Architecture

OmAgents is designed as a layered system:

```
┌─────────────────────────────────────────────────┐
│  User Choice Layer (not bundled, install separately)  │
│  OpenSpec · gstack · custom workflows · none     │
├─────────────────────────────────────────────────┤
│  Process Skills Layer (bundled: superpowers)      │
│  Brainstorming · TDD · Debugging · Plans ·       │
│  Code Review · Git Worktrees · Verification      │
├─────────────────────────────────────────────────┤
│  Infrastructure Layer (bundled: OmAgents)         │
│  MCP servers · Parallel execution ·              │
│  Deep research · Python tooling · venv            │
├─────────────────────────────────────────────────┤
│  OpenCode runtime                                │
└─────────────────────────────────────────────────┘
```

**OmAgents is the infrastructure layer.** It provides the tools and capabilities agents need: MCP servers for external data, parallel execution for background tasks, research workflows, and Python environment management.

**Superpowers is the process skills layer.** It provides reusable development workflows: brainstorming before implementation, test-driven development, systematic debugging, plan writing and execution, code review, and git worktree management.

**The user choice layer is not bundled.** Development methodology is a choice — spec-driven development (OpenSpec), team-based engineering workflow (gstack), or no methodology at all. OmAgents stays neutral so users can pick what fits their project.

---

## Uninstallation

1. Remove the plugin from your OpenCode config:

```bash
# Using jq
jq '.plugin = [.plugin[] | select(. != "@omagents/omagents")]' \
    ~/.config/opencode/opencode.json > /tmp/oc.json && \
    mv /tmp/oc.json ~/.config/opencode/opencode.json
```

2. Remove the Python venv (optional):

```bash
rm -rf ~/.venvs/omagents
```

3. Restart OpenCode.

---

## Development

Project structure:

```
omagents/
├── .opencode/plugins/
│   ├── index.js              # Plugin entry point (merges superpowers + omagents hooks)
│   └── parallel.js           # Parallel execution engine
├── skills/                   # Bundled OpenCode skills
├── package.json              # Includes superpowers as dependency
└── README.md
```

To test locally:

1. Edit files in your local clone
2. Restart OpenCode to reload the plugin
3. Check that skills appear in the available skills list
4. Run `opencode mcp list` to verify MCP servers are registered

### Publishing

OmAgents uses OIDC Trusted Publishing — no npm token required.

```bash
# Bump version
npm version patch   # 0.1.0 → 0.1.1

# Push tag (triggers GitHub Actions auto-publish)
git push && git push --tags
```

Configure Trusted Publisher at [npmjs.com](https://www.npmjs.com/package/@omagents/omagents) → Settings → Trusted Publisher.

---

## License

MIT - see [LICENSE](LICENSE).
