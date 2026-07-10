# Roadmap

## Short-term (0.3.x) - Deep Research Enhancement & Polish

- [x] Deep Research provenance tracking (`provenance.jsonl`, phase-level event log)
- [x] Deep Research inline SVG charts (coverage heatmap, source donut, timeline, comparison radar, confidence bars)
- [x] Deep Research integrity audit (missing sources, conflicting data, coverage gaps, source duplicates)
- [x] Deep Research artifact package (manifest + README index)
- [x] Deep Research meta-orchestration (pausable state machine with pause/resume)
- [x] Project SVG icon (Unified Bot + Violet/Gold)
- [ ] CLI installer (`npx @omagents/omagents install` interactive setup)
- [ ] Model fallback mechanism (per-agent fallback chain in index.js)

## Mid-term (0.4.x - 0.6.x) - Quality & Scale

- [ ] TUI sidebar for Job Board visualization
- [ ] Unit test coverage for parallel.js (607 lines, currently untested)
- [ ] Unit tests for deep-research scripts (provenance, svg_charts, audit, package, orchestrate)
- [ ] Windows support testing and fixes
- [ ] Skill contribution guide and templates
- [ ] Community skill registry
- [ ] Performance profiling for large codebases
- [ ] Domain-specific research skill templates (science, tech, finance) built on deep-research

## Long-term (1.0+) - Stability & Ecosystem

- [ ] Stable plugin API (no breaking changes without major version)
- [ ] Multi-harness support (beyond OpenCode)
- [ ] Enterprise features (audit logs, team configs)
- [ ] Skill marketplace integration

## Completed (0.2.x)

- [x] LSP guide skill (leverage OpenCode native LSP, no MCP server needed)
- [x] AST-Grep skill (pattern-aware code search, detect-and-fallback to grep)
- [x] PR workflow skills (work-with-pr, pre-publish-review)
- [x] Hyperplan skill (adversarial plan review with 3-5 parallel critics)
- [x] Job Board persistence (file-based, survives restart)
- [x] Job Board session isolation (stop cross-session leak)

## Design Principles

1. **Prefer loop engineering over one-shot prompts.** When a skill processes multiple items, use the shared `loop_engine.py`.
2. **Infrastructure, not methodology.** OmAgents provides tools. Methodology is the user's choice.
3. **Don't duplicate what the host provides.** OpenCode has LSP, edit tools, search. Don't bundle alternatives.
4. **Pin dependencies.** Superpowers is pinned to a commit. Don't unpin without testing.
