# Contributing to OmAgents

Thanks for your interest in contributing! This guide covers the basics.

## Development Setup

```bash
git clone git@github.com:omagents/omagents.git
cd omagents
```

For local testing, point your OpenCode config to the local clone:

```json
{
  "plugin": ["omagents@git+file:///path/to/omagents"]
}
```

Restart OpenCode to reload changes.

## Project Structure

```
omagents/
├── .opencode/plugins/index.js # Development-only OpenCode re-export
├── packages/
│   ├── core/
│   │   ├── src/              # Host-neutral state, assets, and rendering
│   │   ├── hooks/            # Shared Python environment management
│   │   └── skills/           # Bundled skills and helper scripts
│   │       ├── deep-research/
│   │       ├── parallel-execution/
│   │       ├── agents-python-tools/
│   │       ├── markitdown-converter/
│   │       └── playwright-web-scraping/
│   └── opencode/src/         # OpenCode V1/V2 adapter and parallel hooks
├── package.json              # Private npm-workspaces root
└── README.md
```

## Making Changes

### Plugin Code (`.opencode/plugins/`)

- `index.js` is the main entry point. It merges hooks from superpowers and omagents.
- `parallel.js` contains the parallel execution engine (Job Board, task tracking, hooks).
- Both files are plain JavaScript (ESM). No build step required.
- Test syntax with: `node --check .opencode/plugins/index.js`

### Skills (`packages/core/skills/`)

Each skill is a directory with a shared `SKILL.md` fallback (YAML frontmatter + Markdown body). An optional `SKILL.<host>.md` is a full-content override for `opencode-v1`, `opencode-v2`, `codex`, or `dsh`. Some skills include helper scripts (Python) and templates.

### Deep-Research Scripts (`packages/core/skills/deep-research/scripts/`)

Python scripts that support the deep-research workflow. Test with:

```bash
~/.venvs/omagents/bin/python packages/core/skills/deep-research/scripts/deep_research.py plan --query "test"
```

## Submitting Changes

1. Fork the repo and create a branch: `git checkout -b my-feature`
2. Make your changes
3. Test locally by restarting OpenCode
4. Commit with a clear message
5. Open a Pull Request

## Reporting Issues

Use [GitHub Issues](https://github.com/omagents/omagents/issues) to report bugs or request features.

## License

MIT. See [LICENSE](LICENSE).
