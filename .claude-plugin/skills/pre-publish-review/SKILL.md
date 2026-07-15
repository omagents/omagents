---
name: pre-publish-review
description: "Pre-publish release gate using a durable loop workflow. Checks version, changelog, tests, lint, Python scripts, git status, and docs before publishing. Trigger when the user says 'pre-publish', 'release check', 'ready to publish', or before running npm publish."
---

# Pre-Publish Review (Loop Engine)

A durable checklist that verifies everything is ready before publishing. Each check is processed, verified, and marked complete before moving to the next.

## When to Use

- User says "pre-publish", "release check", "ready to publish"
- Before running `npm publish`
- Before pushing a version tag
- Verifying release readiness

## Loop Workflow

### Phase 1: Build Task Queue

```Bash
loop_engine.py init pre-publish-review '[
  {"check": "version", "description": "Verify package.json version is correct and not already published"},
  {"check": "changelog", "description": "Verify CHANGELOG.md has entry for current version"},
  {"check": "tests", "description": "Run node --test tests/*.test.js"},
  {"check": "lint", "description": "Run npx prettier --check on JS files"},
  {"check": "python", "description": "Run py_compile on all Python scripts"},
  {"check": "git-status", "description": "Verify clean git working tree"},
  {"check": "docs", "description": "Verify README and AGENTS.md are up to date"}
]'
```

### Phase 2: Execute Loop

Repeat until `next` returns `null`:

**Step 1: Get next task**
```Bash
loop_engine.py next pre-publish-review
```

**Step 2: Execute the check**

| Check | How to verify |
|-------|--------------|
| `version` | `node -e "console.log(require('./package.json').version)"` then check `npm view @omagents/omagents versions` to ensure not already published |
| `changelog` | Read CHANGELOG.md, verify there's an entry for the current version |
| `tests` | `node --test tests/*.test.js` -- all must pass |
| `lint` | `npx prettier --check ".opencode/plugins/*.js" "tests/*.js"` |
| `python` | `python3 -m py_compile skills/deep-research/scripts/*.py skills/_shared/scripts/loop_engine.py` |
| `git-status` | `git status --porcelain` must be empty |
| `docs` | Verify README.md and AGENTS.md reference correct version, skill count, etc. |

**Step 3: Record result**

If check passes:
```Bash
loop_engine.py complete pre-publish-review <id> "PASS: all 26 tests passed"
```

If check fails:
```Bash
loop_engine.py fail pre-publish-review <id> "FAIL: 2 tests failed"
```

### Phase 3: Report

```Bash
loop_engine.py summary pre-publish-review
```

Present the summary. If any checks failed or are blocked, list what needs to be fixed before publishing.

**Only proceed with `npm publish` when all checks are completed.**

## Rules

- **Never skip a failed check** -- fix the issue or mark as blocked
- **Run checks in order** -- version first, docs last
- **If git-status fails**, commit or stash before continuing
- **If tests fail**, do not publish -- fix the tests first
- **If version is already published**, bump the version before continuing
