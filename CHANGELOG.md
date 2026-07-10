# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2026-07-10

### Changed

- Version bump

## [0.1.3] - 2026-07-10

### Changed

- CI: use Node 24 for native OIDC trusted publishing support
- CI: upgrade actions to v5, add repository url for provenance

## [0.1.2] - 2026-07-09

### Fixed

- OIDC trusted publishing configuration

## [0.1.1] - 2026-07-09

### Added

- Scoped package name (`@omagents/omagents`)
- Superpowers bundled as dependency
- OIDC auto-publish via GitHub Actions

### Changed

- Revamped README with badges, For Humans/LLM Agents sections, highlights, uninstallation

### Fixed

- Disable OAuth flow and use GITHUB_TOKEN for github MCP

## [0.1.0] - 2026-07-09

### Added

- **Deep Research skill**: multi-source, iterative research workflow with items × fields matrix, gap detection loop, and Jinja2 report templates (comparison, survey, technical)
- **Parallel Execution engine**: intercepts OpenCode's native `task(background: true)` to track background jobs, inject Job Board into LLM context, and provide `/ps` command + `cancel_task` tool
- **Parallel system prompt injection**: via `experimental.chat.system.transform` hook, gives all agents (build, plan) parallel dispatch capabilities
- **Auto-enable background subagents**: writes `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` to shell config on first load
- **Superpowers integration**: bundled as npm dependency, hooks merged with graceful degradation
- **5 MCP servers**: agentmemory, codegraph, context7, websearch, github — auto-registered via config hook
- **5 bundled skills**: deep-research, parallel-execution, agents-python-tools, markitdown-converter, playwright-web-scraping
- **Python venv auto-provisioning**: creates `~/.venvs/omagents` and installs `jinja2` on first session
- **shell.env hook**: prepends venv bin and skill script directories to PATH
- **TUI state file**: writes job board snapshot to `~/.local/share/opencode/storage/omagents/tui-state.json` for future TUI sidebar integration
