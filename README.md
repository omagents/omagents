# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)
[![npm version](https://img.shields.io/npm/v/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![npm downloads](https://img.shields.io/npm/dm/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![GitHub stars](https://img.shields.io/github/stars/omagents/omagents?style=social)](https://github.com/omagents/omagents/stargazers)

[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

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

**Prerequisites:**
- [OpenCode](https://opencode.ai) installed and running
- [Python 3.11+](https://www.python.org/downloads/) installed and on PATH (required for deep-research, markitdown-converter, playwright-web-scraping, and loop engine)

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

That's it. At session start OmAgents will automatically:
- Install **superpowers** (bundled, no separate install needed)
- Register all **skills** (OmAgents + Superpowers)
- Register all **MCP servers** (agentmemory, codegraph, context7, websearch, github/grep_app)
- Enable **parallel execution** (background agents with `/ps` and `cancel_task`)
- Set up **Python venv** at `~/.venvs/omagents` (installs `jinja2` for report templates)
- Check **Python prerequisite** (warns with install instructions if Python is missing)

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

The plugin handles everything else automatically - no manual MCP configuration, no skill installation, no venv setup.

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

### Claude Code

**Prerequisite:** [Python 3.11+](https://www.python.org/downloads/) installed and on PATH.

1. Add the OmAgents marketplace and install the plugin:

```bash
claude plugin marketplace add omagents/omagents
claude plugin install omagents@omagents
```

At session start, the plugin auto-discovers bundled skills, MCP servers, and sets up the Python venv via `SessionStart` hooks. The OpenCode-only parallel execution engine (`task(background: true)`, `/ps`) is not available; use Claude Code's native `Agent` tool for subagent dispatch.

### Codex

**Prerequisite:** [Python 3.11+](https://www.python.org/downloads/) installed and on PATH.

1. Add the OmAgents marketplace and install the plugin:

```bash
codex plugin marketplace add omagents/omagents
codex plugin add omagents@omagents
```

At session start, the plugin auto-discovers bundled skills, MCP servers, and sets up the Python venv via `SessionStart` hooks. The OpenCode-only parallel execution engine is not available; use Codex's native subagent tools for parallel dispatch.

> **For developers:** If you edit source skills in `skills/`, run `npm run sync` to regenerate the `.claude-plugin/` and `.codex-plugin/` artifacts, then commit them. CI automatically verifies that generated files are up-to-date.

---

## Highlights

| | Feature | What it does |
| :---: | :--- | :--- |
| 🔁 | **Loop Engineering** | Durable task queues for iterative skills. Survives context clearing, retry logic, unified summary. Used by 8 skills |
| 🧠 | **Superpowers** (14 skills) | Brainstorming before implementation, TDD, systematic debugging, plan writing, code review, git worktrees |
| 🔍 | **Deep Research** | Multi-source iterative research with items × fields matrix, gap detection loop, Jinja2 reports |
| ⚡ | **Parallel Execution** | Background task dispatch via `task(background: true)`, Job Board with persistence + session isolation, `/ps` command |
| 📚 | **Built-in MCPs** | agentmemory, codegraph, context7, websearch, github/grep_app - all auto-registered |
| 🐍 | **Python Tooling** | Dedicated venv at `~/.venvs/omagents`, auto-installs jinja2 and skill dependencies |
| 📄 | **MarkItDown** | Convert PDF, DOCX, XLSX, PPTX, HTML to Markdown |
| 📊 | **OfficeCLI** | Create, analyze, proofread, and modify .docx/.xlsx/.pptx via officecli |
| 🌐 | **Web Scraping** | Playwright-based page fetching and scraping |
| 🔗 | **GitHub** | Full GitHub API when `GITHUB_TOKEN` is set; falls back to `mcp.grep.app` without token |
| 🏗️ | **Refactor** | Systematic code refactoring with loop engine verification |
| 🛡️ | **Hyperplan** | Adversarial plan review with 3 parallel critics (security, architecture, edge cases) |
| 🔧 | **Code Intelligence** | LSP guide + AST-grep for structural code search and rewrite |

---

## Loop Engineering

OmAgents pioneers **loop engineering** for AI agent skills. Instead of one-shot prompts that say "scan everything and fix it," loop-based skills use a durable task queue that processes items one at a time with verification.

### How It Works

```
Phase 1: Build Task Queue          Phase 2: Execute Loop           Phase 3: Report
┌─────────────────────┐    ┌──────────────────────────┐    ┌─────────────────┐
│ Scan codebase       │    │ loop_engine.py next      │    │ loop_engine.py  │
│ Build task list     │───>│   -> get next task       │───>│   summary       │
│ loop_engine.py init │    │   -> execute + verify    │    │ Show results    │
└─────────────────────┘    │   -> complete or fail    │    └─────────────────┘
                           │   -> repeat until null   │
                           └──────────────────────────┘
```

**State persists** in `.omagents/loops/<skill>/tasks.json` -- if the agent's context is cleared mid-task, it can resume exactly where it left off.

**Retry logic:** Failed tasks retry up to 3 times before being marked blocked.

**Compaction safe:** The `experimental.session.compacting` hook injects loop engine state into the compaction prompt, so the agent knows to resume after context clearing.

### Skills Using Loop Engineering

| Skill | What it loops over | Verification |
|-------|-------------------|--------------|
| `deep-research` | Research tasks -> gap detection -> new tasks | Findings validation + coverage matrix |
| `remove-ai-slops` | Source files (one per task) | Lint / test pass |
| `remove-deadcode` | Dead code candidates (one per task) | Test pass after removal |
| `github-triage` | Open issues (one per task) | Labels applied successfully |
| `tech-debt-audit` | Audit categories (one per task) | Findings collected |
| `pre-publish-review` | Release checklist items (one per task) | Each check passes |
| `hyperplan` | 3 parallel critics (tracked, not sequential) | Critic produces findings |
| `refactor` | Refactoring targets (one file per task) | Tests pass after refactor |

### Loop Engine API

```bash
loop_engine.py init <skill> '<tasks_json>'   # Initialize task queue
loop_engine.py next <skill>                   # Get next pending task
loop_engine.py complete <skill> <id> [result] # Mark task complete
loop_engine.py fail <skill> <id> [error]      # Mark task failed (retries 3x)
loop_engine.py status <skill>                 # Print stats
loop_engine.py summary <skill>                # Full task list with icons
loop_engine.py reset <skill>                  # Clear queue
loop_engine.py add <skill> '<task_json>'      # Add task to existing queue
```

---

## What's Included

### Skills

| Skill | Source | Loop? | Description |
|-------|--------|-------|-------------|
| `deep-research` | OmAgents | Yes | Multi-source, iterative research with items × fields, gap detection, Jinja2 reports |
| `parallel-execution` | OmAgents | - | Background parallel task dispatch with Job Board tracking |
| `agents-python-tools` | OmAgents | - | Routes Python tooling to the dedicated `~/.venvs/omagents` venv |
| `markitdown-converter` | OmAgents | - | Convert documents (PDF, DOCX, XLSX, etc.) to Markdown |
| `officecli` | OmAgents | - | Create, analyze, proofread, and modify Office documents (.docx, .xlsx, .pptx) via officecli |
| `playwright-web-scraping` | OmAgents | - | Web scraping and page fetching with Playwright |
| `init-deep` | OmAgents | - | Auto-generate hierarchical AGENTS.md files |
| `doctor` | OmAgents | - | Diagnose OmAgents installation and configuration |
| `remove-ai-slops` | OmAgents | Yes | Clean up AI-generated code artifacts (loop: file-by-file) |
| `remove-deadcode` | OmAgents | Yes | Find and remove unreferenced code (loop: candidate-by-candidate) |
| `github-triage` | OmAgents | Yes | Triage and categorize GitHub issues (loop: issue-by-issue) |
| `tech-debt-audit` | OmAgents | Yes | Audit codebase for technical debt (loop: category-by-category) |
| `lsp-guide` | OmAgents | - | Guide agents to use the right code intelligence tool (LSP, codegraph, grep, ast-grep) |
| `ast-grep` | OmAgents | Optional | AST-aware code search and rewrite with grep fallback |
| `work-with-pr` | OmAgents | - | PR lifecycle management with github MCP |
| `pre-publish-review` | OmAgents | Yes | Pre-publish release gate checklist (loop: check-by-check) |
| `hyperplan` | OmAgents | Yes | Adversarial plan review with 3 parallel critics (loop: critic tracking) |
| `refactor` | OmAgents | Yes | Systematic code refactoring with verification (loop: file-by-file) |
| `superpowers` (14 skills) | Superpowers | - | Brainstorming, TDD, debugging, planning, git worktrees, and more |

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
- **Persistence**: Job Board survives restart (saved to `job-board.json`)
- **Session isolation**: Each session only sees its own jobs (no cross-session leak)
- **Compaction safe**: Loop engine and Job Board state preserved across context compaction
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

**The user choice layer is not bundled.** Development methodology is a choice - spec-driven development (OpenSpec), team-based engineering workflow (gstack), or no methodology at all. OmAgents stays neutral so users can pick what fits their project.

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
├── skills/                   # Bundled OpenCode skills (18 skills)
│   ├── _shared/scripts/      # Shared scripts (loop_engine.py)
│   ├── deep-research/        # Research workflow with gap detection
│   └── ...                   # 16 more skills
├── tests/                    # Node.js built-in test runner (26 tests)
├── AGENTS.md                 # AI agent context file
├── ROADMAP.md                # Development roadmap
├── package.json              # Includes superpowers as dependency
└── README.md
```

### Testing

```bash
# Run all tests
npm test

# Check formatting
npm run format:check

# Format code
npm run format
```

### Publishing

OmAgents uses OIDC Trusted Publishing - no npm token required.

```bash
# Bump version
npm version patch   # 0.1.0 -> 0.1.1

# Push tag (triggers GitHub Actions auto-publish)
git push && git push --tags
```

Configure Trusted Publisher at [npmjs.com](https://www.npmjs.com/package/@omagents/omagents) -> Settings -> Trusted Publisher.

---

## License

MIT - see [LICENSE](LICENSE).
