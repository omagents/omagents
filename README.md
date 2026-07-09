# OmAgents

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
| `brainstorming` | Superpowers | Explore user intent before implementation |
| `test-driven-development` | Superpowers | TDD workflow |
| `systematic-debugging` | Superpowers | Structured debugging methodology |
| `writing-plans` | Superpowers | Multi-step task planning |
| `executing-plans` | Superpowers | Plan execution with review checkpoints |
| `using-git-worktrees` | Superpowers | Isolated workspace management |
| ... | Superpowers | 14 skills total |

### MCP Servers

| MCP | Type | Notes |
|-----|------|-------|
| `agentmemory` | Local | Session memory and audit |
| `codegraph` | Local | Codebase symbol graph and exploration |
| `context7` | Remote | Documentation search (free tier available) |
| `websearch` | Remote | Web search via Exa (free tier available) |
| `github` | Remote | GitHub tools via GitHub Copilot MCP (OAuth supported) |

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
    "omagents@git+https://github.com/omagents/omagents.git"
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
