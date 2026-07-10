# Roadmap

## Short-term (0.2.x) - Feature Enhancements

- [ ] LSP guide skill (leverage OpenCode native LSP, no MCP server needed)
- [ ] AST-Grep skill (pattern-aware code search, detect-and-fallback to grep)
- [ ] PR workflow skills (work-with-pr, pre-publish-review)
- [ ] Hyperplan skill (adversarial plan review with 3-5 parallel critics)
- [ ] Model fallback mechanism (per-agent fallback chain in index.js)
- [ ] Job Board persistence (file-based, survives restart)
- [ ] Job Board session isolation (stop cross-session leak)
- [ ] CLI installer (`npx @omagents/omagents install` interactive setup)

## Mid-term (0.3.x - 0.5.x) - Quality & Scale

- [ ] TUI sidebar for Job Board visualization
- [ ] Unit test coverage for parallel.js (607 lines, currently untested)
- [ ] Windows support testing and fixes
- [ ] Skill contribution guide and templates
- [ ] Community skill registry
- [ ] Performance profiling for large codebases

## Long-term (1.0+) - Stability & Ecosystem

- [ ] Stable plugin API (no breaking changes without major version)
- [ ] Multi-harness support (beyond OpenCode)
- [ ] Enterprise features (audit logs, team configs)
- [ ] Skill marketplace integration

## Design Principles

1. **Prefer loop engineering over one-shot prompts.** When a skill processes multiple items, use the shared `loop_engine.py`.
2. **Infrastructure, not methodology.** OmAgents provides tools. Methodology is the user's choice.
3. **Don't duplicate what the host provides.** OpenCode has LSP, edit tools, search. Don't bundle alternatives.
4. **Pin dependencies.** Superpowers is pinned to a commit. Don't unpin without testing.
