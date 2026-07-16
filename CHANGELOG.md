# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.2] - 2026-07-16

### Fixed

- **Add shebang to index.js**: `npx @omagents/omagents` was executing the file as a shell script because the `bin` entry lacked a `#!/usr/bin/env node` shebang line.

## [0.7.1] - 2026-07-16

### Fixed

- **Codex installer: add marketplace registration**: installer now writes `marketplace.json` to the cache root and registers `[marketplaces.omagents]` in `config.toml`, matching the expected Codex plugin discovery flow.

## [0.7.0] - 2026-07-16

### Added

- **Unified entry point** (`index.js`): re-exports the OpenCode plugin when imported as a module, and runs the Codex installer when executed as CLI (`npx @omagents/omagents`).
- **Codex CLI auto-install** (`.codex/plugins/install.js`): all-in-one installer that copies the plugin to `~/.codex/plugins/cache/omagents/omagents/local/`, generates `.mcp.json` and `plugin.json` at install time, copies skills with tool name mapping, and enables the plugin in `~/.codex/config.toml`. No marketplace required.

### Changed

- **Codex installation simplified**: replaced `codex plugin marketplace add` + `codex plugin add` with a single `npx @omagents/omagents` command.
- **`.mcp.json` format fixed**: removed `type` field (Codex infers transport from `command` vs `url`).
- **GitHub MCP in Codex**: uses `bearer_token_env_var` in `.mcp.json` instead of top-level config.toml headers.
- **`package.json`**: `main` changed to `index.js`, added `bin` field, removed `sync`/`sync:check`/`prepublishOnly` scripts.
- **CI**: removed `npm run sync` step, added syntax checks for `index.js` and `.codex/plugins/install.js`.
- **Cross-platform installer**: replaced Perl-based `sync-platform.sh` with pure JS installer (works on Windows).
- **README updated** (4 languages): Codex section now uses `npx @omagents/omagents`.

### Removed

- **`scripts/` directory**: `sync-platform.sh`, `templates/`, `tool-mapping.txt` — all replaced by `.codex/plugins/install.js`.
- **`.agents/plugins/marketplace.json`**: no longer needed; installer writes directly to plugin cache.
- **`tests/sync-platform.test.js`**: tests for the deleted sync script.
- **`.codex-plugin/` and `.claude-plugin/` from `.gitignore`**: no longer generated as committed artifacts.

## [0.6.0] - 2026-07-15

### Added

- **Codex CLI plugin support**: OmAgents can now be installed as a Codex plugin via marketplace. Users run `codex plugin marketplace add omagents/omagents` and `codex plugin add omagents@omagents`.
- **Cross-platform sync script** (`scripts/sync-platform.sh`): generates `.codex-plugin/` artifacts from source skills with OpenCode-to-Codex tool name mapping.
- **Shared MCP definitions** (`mcp-servers/base.json`): single source of truth for built-in MCP servers, reused by both OpenCode and Codex plugins.
- **Python venv setup hook** (`hooks/setup-venv.sh`): shared script that creates `~/.venvs/omagents` and installs `jinja2`, invoked by Codex `SessionStart` hooks.
- **Codex marketplace** (`.agents/plugins/marketplace.json`): npm-sourced marketplace entry for Codex plugin discovery.
- **`prepublishOnly` script**: automatically runs `npm run sync` before `npm publish` to include generated `.codex-plugin/` in the tarball.
- **Integration checklist** (`docs/superpowers/INTEGRATION-CHECKLIST.md`): step-by-step verification for OpenCode and Codex.
- **Design spec and implementation plan** (`docs/superpowers/specs/` and `docs/superpowers/plans/`).

### Changed

- **MCP definitions refactored**: `.opencode/plugins/index.js` now imports from `mcp-servers/base.json` instead of hard-coding MCP server definitions.
- **CI workflow**: runs `npm run sync` to verify the sync script works; removed `git diff` check since generated artifacts are no longer committed.
- **Tool name mapping** (`scripts/tool-mapping.txt`): reverse-maps OpenCode-specific tool names (e.g., `websearch_web_search_exa`) to Codex equivalents (e.g., `web_search`) in generated skills.
- **Superpowers skills bundled**: superpowers skills are copied into `.codex-plugin/skills/superpowers/` during sync, without tool mapping applied.
- **README updated** (4 languages): added Codex installation instructions, removed Claude Code section.

### Removed

- **Claude Code support**: dropped in favor of focusing on two open-source platforms (OpenCode + Codex). Claude Code users can still use superpowers directly or configure MCP servers manually.
- **`.claude-plugin/` directory**: deleted and added to `.gitignore`.
- **`.codex-plugin/` from git tracking**: now a generated artifact, gitignored, distributed via npm.
- **`bin-src/` directory**: Claude-specific `bin/` wrappers, no longer needed.
- **Committed generated artifacts**: `.claude-plugin/` and `.codex-plugin/` are no longer committed to git. They are generated by `npm run sync` and included in npm packages via `prepublishOnly`.

## [0.5.0] - 2026-07-10

### Added

- **Deep Research Phase 0: Pre-research Landscape Scan**: new `pre_research.py` script using the shared loop engine to iteratively scan the web for current entities before generating a research plan. Ensures research items are based on real-world, up-to-date data rather than stale model knowledge. New CLI subcommands: `scan`, `scan-next`, `scan-complete`, `scan-evaluate`, `scan-finalize`.
- **Current date injection**: all pre-research task descriptions, dispatch instructions, and subagent prompts now include the current date (e.g., "Current date: July 2026") and instruct the agent to include the current year in search queries and not rely on training data.
- **Report date in templates**: all three report templates (survey, comparison, technical) now display `Research conducted: July 2026 (2026-07-10)` in the report header.
- **Template-aware fields**: `comparison` template now generates 7 fields (Overview, Key Technologies, Evidence, Latest Version, Strengths, Weaknesses, Pricing/License). `technical` template generates 6 fields (adds Architecture, API/Interface, Performance).
- **Configurable plan options**: new CLI flags `--max-loops`, `--batch-size`, `--search-tools`, `--language`, `--pre-research` for `plan` and `run-all` subcommands.
- **Extended DEFAULT_CONFIG**: `max_pre_research_loops`, `min_pre_research_candidates`, `min_pre_research_sources`, `confidence_weights`, `audit_weights`.
- **`--skip-pre-research` flag** for `run-all` to bypass the landscape scan phase.

### Changed

- **`build_tasks()` now covers ALL items x ALL fields**: previously only generated tasks for the first item and first two fields. Now generates one task per item per search source type, covering all required and optional fields.
- **`add_items()` respects `config.search_tools`**: generates web, github, and codebase tasks based on configured tools (was hardcoded web + github only).
- **Batch dispatch**: orchestrator now dispatches up to `batch_size` tasks at once instead of one at a time, enabling true parallel subagent execution.
- **Source-aware gap analysis**: gap-fill tasks now select the appropriate source type based on field category (Legal→github, Technical→codebase, Performance→web) instead of always defaulting to web.
- **Multi-dimensional confidence assessment**: `assess_confidence()` now considers source count, relevance, and cross-source agreement with configurable weights (was: source count + relevance average only).
- **Unicode-aware keyword extraction**: cross-cutting insights now extract CJK (Chinese/Japanese/Korean) keywords in addition to English (was: English-only `\b[a-zA-Z]{5,}\b`).
- **Language-agnostic supplemental marker**: raw report uses "Supplemental" instead of hardcoded Chinese "补充信息".
- **Dynamic SVG dimensions**: coverage heatmap cell/margin sizes now scale based on item/field count.
- **Configurable audit weights**: audit scoring penalties now read from `plan.config.audit_weights`.
- **Dynamic artifact discovery**: package manifest now scans the artifacts directory for additional files.
- **Template preserved across resume**: orchestrator state now saves and restores the report template through pause/resume cycles.

### Fixed

- **Orchestrator template loss on resume**: the `--template` flag value was lost when resuming with `--resume`, causing comparison plans to regress to survey template. Template is now saved in `orchestration_state.json`.
- **`merge.py` silent fallback**: unknown finding types now emit a warning and are bucketed as "other" instead of silently being treated as "web".
- **Word-aware truncation**: comparison table cell truncation now cuts at word boundaries instead of mid-word.

## [0.4.1] - 2026-07-10

### Fixed

- **Deep Research workspace path**: SKILL.md examples no longer create a `research/` subdirectory. The `--workspace` flag now uses a topic slug directly in the current working directory (e.g. `--workspace agent-frameworks`), with a naming guideline added. The `deep_research.py` docstring examples were updated to match.

## [0.4.0] - 2026-07-10

### Added

- **Deep Research LLM report polishing**: new `polish` subcommand and `report --polish` flag. After the Jinja2 template generates a raw `report.md`, it is backed up to `artifacts/report_raw.md` and the agent (LLM) rewrites it into coherent prose — merging multi-source bullet lists into flowing narrative, writing a real executive summary, ensuring language consistency, and preserving SVG charts and source citations.
- **Deep Research polish prompt template**: `prompts/polish_report.md` provides structured instructions for the LLM polishing phase.
- **Deep Research `polishing` orchestration phase**: the `run-all` pipeline now pauses between `reporting` and `auditing` for LLM polishing, with automatic resume via `--resume`.

### Changed

- **Deep Research workspace structure**: intermediate artifacts now live in `artifacts/` instead of the workspace root. Final deliverables (`report.md`, `summary.md`) and inputs (`plan.json`, `findings/`) remain at root.
  - `findings_merged.json` → `artifacts/findings_merged.json`
  - `gap_report.json` → `artifacts/gap_report.json`
  - `audit_report.json` → `artifacts/audit_report.json`
  - `provenance.jsonl` → `artifacts/provenance.jsonl`
  - `package.json` → `artifacts/package.json`
  - `README.md` → `artifacts/README.md`
  - `report_raw.md` → `artifacts/report_raw.md`
- **Deep Research synthesize.py**: multi-source field values are now merged into a single coherent text (longest value as primary, others as "补充信息") instead of being labeled as "Conflicts". Added `short_value` (truncated to 150 chars) for comparison table cells.
- **Deep Research templates** (comparison/survey/technical): fixed Markdown table rendering using Jinja2 `-%}` whitespace control. Table cells now use `short_value`. Removed "Conflicts" section from detailed findings.

### Fixed

- **Deep Research comparison table**: blank lines between table rows caused Markdown renderers to split the table into multiple independent tables. Fixed with Jinja2 `-%}` whitespace control on `{% for %}` / `{% endfor %}` blocks.

## [0.3.2] - 2026-07-10

### Fixed

- **deep-research SKILL.md**: subagent prompt now instructs writing findings via bash (`cat > file << 'EOF'`) instead of the `write` tool. Subagent sessions run in a temporary working directory, so `write` to absolute paths outside it triggered an opencode confirmation dialog. Using bash avoids this since bash has blanket allow permissions.

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
