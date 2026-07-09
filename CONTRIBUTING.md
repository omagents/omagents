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
├── .opencode/plugins/
│   ├── index.js              # Plugin entry point (merges superpowers + omagents hooks)
│   └── parallel.js           # Parallel execution engine
├── skills/                   # Bundled OpenCode skills
│   ├── deep-research/        # Research workflow with items × fields + gap detection
│   ├── parallel-execution/   # Background task dispatch guide
│   ├── agents-python-tools/  # Python venv management
│   ├── markitdown-converter/ # Document to Markdown conversion
│   └── playwright-web-scraping/
├── templates/                # Jinja2 report templates (used by deep-research)
├── package.json              # Includes superpowers as dependency
└── README.md
```

## Making Changes

### Plugin Code (`.opencode/plugins/`)

- `index.js` is the main entry point. It merges hooks from superpowers and omagents.
- `parallel.js` contains the parallel execution engine (Job Board, task tracking, hooks).
- Both files are plain JavaScript (ESM). No build step required.
- Test syntax with: `node --check .opencode/plugins/index.js`

### Skills (`skills/`)

Each skill is a directory with a `SKILL.md` file (YAML frontmatter + Markdown body).
Some skills include helper scripts (Python) and templates.

### Deep-Research Scripts (`skills/deep-research/scripts/`)

Python scripts that support the deep-research workflow. Test with:

```bash
~/.venvs/omagents/bin/python skills/deep-research/scripts/deep_research.py plan --query "test"
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
