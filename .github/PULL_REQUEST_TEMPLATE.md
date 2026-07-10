## Summary

<!-- One sentence describing what this PR does -->

## Type of Change

- [ ] feat: New feature
- [ ] fix: Bug fix
- [ ] docs: Documentation
- [ ] refactor: Code refactoring
- [ ] chore: Maintenance

## Checklist

- [ ] `node --check .opencode/plugins/index.js` passes
- [ ] `python3 -m py_compile skills/deep-research/scripts/*.py` passes
- [ ] `node --test tests/` passes (if tests exist for changed area)
- [ ] `npx prettier --check ".opencode/plugins/*.js" "tests/*.js"` passes
- [ ] CHANGELOG.md updated (if user-facing change)
- [ ] AGENTS.md updated (if project structure or conventions changed)
- [ ] If adding a new skill: has `SKILL.md` with frontmatter + `agents/openai.yaml`
- [ ] If the skill is iterative: uses `loop_engine.py` (see AGENTS.md Design Principles)
