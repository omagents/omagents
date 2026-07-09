# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)

An OpenCode plugin that bundles agent skills, MCP servers, parallel execution, and superpowers into a single install.

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

## Installation

Add **one line** to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "@omagents/omagents"
  ]
}
```

That's it. Restart OpenCode and the plugin will automatically:

1. Install and load **superpowers** (as a bundled dependency)
2. Register all **skills** (OmAgents + Superpowers)
3. Register all **MCP servers**
4. Enable **parallel execution** (auto-writes `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` to your shell config)
5. Install **Python dependencies** (e.g., `jinja2`) into `~/.venvs/omagents`

No other plugins or MCP servers need to be configured separately.

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

**The user choice layer is not bundled.** Development methodology is a choice — spec-driven development (OpenSpec), team-based engineering workflow (gstack), or no methodology at all. OmAgents stays neutral so users can pick what fits their project. Install any of these alongside OmAgents:

```json
{
  "plugin": [
    "@omagents/omagents",
    "@devcxl/opencode-spec"
  ]
}
```

OmAgents' hook merging mechanism ensures no conflicts with additional plugins.

## Optional: Higher Rate Limits

Some remote MCP servers accept optional API keys for higher rate limits. Set them as environment variables and configure the MCP headers in your `opencode.json` if needed:

```bash
# ~/.zshrc or ~/.bashrc
export EXA_API_KEY="your-exa-key"
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

```json
{
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"
      }
    }
  }
}
```

For GitHub, run `opencode mcp auth github` to use OAuth instead of a token.

## Development

Project structure:

```
omagents/
├── .opencode/plugins/
│   ├── index.js              # Plugin entry point (merges superpowers + omagents hooks)
│   └── parallel.js           # Parallel execution engine
├── skills/                   # Bundled OpenCode skills
├── templates/                # Jinja2 report templates
├── package.json              # Includes superpowers as dependency
└── README.md
```

To test locally:

1. Edit files in your local clone
2. Restart OpenCode to reload the plugin
3. Check that skills appear in the available skills list
4. Run `opencode mcp list` to verify MCP servers are registered

## License

MIT - see [LICENSE](LICENSE).
