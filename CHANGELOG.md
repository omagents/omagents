# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-07-10

### Fixed

- **loop_engine.py**: `complete` and `fail` commands now accept both integer `id` and string `task_id` identifiers. Previously, deep-research tasks with string IDs (e.g. `task-flyio`) caused a `ValueError` because the engine forced `int(task_id)`.

## [0.3.0] - 2026-07-10

### Added

- **Deep Research provenance tracking**: append-only `provenance.jsonl` logs phase-level events (plan_created, gap_detected, report_generated, audit_completed). Backward-compatible, optional.
- **Deep Research inline SVG charts**: 5 pure-SVG chart generators (no JS, no external deps) embedded directly in Markdown reports:
  - Coverage Heatmap: item × field grid, color-coded by confidence
  - Source Distribution Donut: web/github/codebase proportion
  - Research Timeline: horizontal phase-level timeline from provenance
  - Comparison Radar: multi-dimensional radar chart (comparison template, 2+ items)
  - Confidence Bar Chart: high/medium/low/none distribution
- **Deep Research integrity audit** (`audit.py`): 4 automated checks (missing_sources, conflicting_data, coverage_gaps, source_duplicates) with 0-100 score and recommendations. Results embedded in report.
- **Deep Research artifact package** (`package.py`): generates `package.json` manifest and `README.md` index for complete research workspace.
- **Deep Research meta-orchestration** (`orchestrate.py`): pausable state machine for full pipeline (plan → dispatch → gaps → merge → report → audit → package). Agent calls `--resume` after subagent dispatch.
- **Project SVG icon**: Unified Bot design with violet/gold palette (`assets/omagents-icon.svg` + `.png`)
- **Design spec**: icon design documentation (`docs/superpowers/specs/`)

### Changed

- `synthesize.py`: generates SVG charts from findings data, embeds in Markdown templates, logs provenance, includes audit results
- `deep_research.py`: 6 new subcommands (audit, package, provenance, status, run-all, + existing run renamed to run-all)
- `plan.py`: logs `plan_created` event to provenance
- `gap_analysis.py`: logs `gap_detected` event to provenance
- All 3 Markdown templates (survey, comparison, technical): SVG chart embedding points + audit results section
- `SKILL.md`: updated command table (10 commands), new sections for SVG Charts, Provenance, Audit, Package, Run-All
- `ROADMAP.md`: restructured with 0.3.x short-term, moved completed 0.2.x items to completed section

## [0.2.1] - 2026-07-10

### Added

- **Loop Engine** (`skills/_shared/scripts/loop_engine.py`): durable task queue with init/next/complete/fail/status/summary/reset/add commands. State persists in `.omagents/loops/<skill>/tasks.json`, survives context clearing, retry logic (3 attempts then blocked)
- **12 new skills** (total 17): init-deep, doctor, remove-ai-slops, remove-deadcode, github-triage, tech-debt-audit, lsp-guide, ast-grep, work-with-pr, pre-publish-review, hyperplan, refactor
- **8 skills use loop engineering**: deep-research, remove-ai-slops, remove-deadcode, github-triage, tech-debt-audit, pre-publish-review, hyperplan, refactor
- **Job Board persistence**: parallel.js saves Job Board to `job-board.json`, auto-restores on restart (running jobs marked completed)
- **Job Board session isolation**: each session only sees its own jobs (fixes cross-session leak)
- **Compaction hook**: `experimental.session.compacting` preserves loop engine and Job Board state across context compaction
- **Python prerequisite check**: warns with install instructions if Python 3 is not found
- **AGENTS.md**: project-level AI agent context file with design principles and common mistakes
- **ROADMAP.md**: short/mid/long-term development roadmap
- **PULL_REQUEST_TEMPLATE.md**: PR checklist with loop engineering reminder
- **CODE_OF_CONDUCT.md**: Contributor Covenant 2.1
- **SECURITY.md**: vulnerability reporting policy and response timeline
- **26 unit tests**: plugin structure, skills frontmatter, loop engine workflow (init/next/complete/fail/retry/add/status/summary/reset)
- **Prettier config**: match existing code style (no semi, double quotes)
- **Multilingual README**: 4 languages (English, Simplified Chinese, Japanese, Korean) with language switcher
- **LSP guide skill**: decision tree for LSP vs codegraph vs grep vs ast-grep
- **AST-grep skill**: structural code search and rewrite with grep fallback
- **Hyperplan skill**: adversarial plan review with 3 parallel critics (security, architecture, edge cases)
- **Refactor skill**: systematic code refactoring with loop engine verification

### Changed

- Pin superpowers to commit `d884ae04` (v6.1.1) in package.json
- CI: add `npm ci`, prettier check, loop_engine py_compile, `node --test`
- agents-python-tools SKILL.md: clarify only jinja2 is pre-installed, others on-demand
- deep-research SKILL.md: integrate with loop_engine.py for task state management

### Fixed

- Remove incorrect `templates/` root-level directory from README and CONTRIBUTING.md (lives in `skills/deep-research/templates/`)
- Fix agents-python-tools SKILL.md claiming tools are "pre-installed" (only jinja2 is auto-installed)
- Update CHANGELOG.md with missing v0.1.1 through v0.1.4 entries

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
