---
name: tech-debt-audit
description: "Systematically audit a codebase for technical debt using a durable loop workflow. Each audit category is scanned, findings collected, and recorded before moving to the next. Trigger when the user says 'tech debt audit', 'audit code', 'code health check'."
---

# Tech Debt Audit (Loop Engine)

Systematically scan a codebase for technical debt using a durable task queue. Each audit category is scanned independently, findings are collected, and a prioritized report is generated.

## When to Use

- User says "tech debt audit", "audit code", "code health check"
- Before a major refactoring
- Sprint planning for debt paydown
- Periodic code health assessment

## Audit Categories (Reference)

| Category | What to scan | Severity calibration |
|----------|-------------|---------------------|
| TODO/FIXME | `grep -rn "TODO\|FIXME\|HACK\|XXX"` | Critical if security/data, High if blocking, Medium otherwise |
| Code duplication | Similar function signatures, copy-pasted blocks | High if > 20 lines duplicated, Medium otherwise |
| Complex functions | > 50 lines, > 4 nesting, > 5 params | High if > 100 lines, Medium if > 50 |
| Outdated dependencies | `npm outdated` / `pip list --outdated` | High if security patch available, Low otherwise |
| Missing tests | Source files without test files | High for core modules, Low for utilities |
| Inconsistent patterns | Mixed naming, import styles, error handling | Low unless widespread |

## Loop Workflow

### Phase 1: Build Task Queue

Initialize the loop with one task per audit category:

```bash
loop_engine.py init tech-debt-audit '[
  {"category": "todo-fixme", "description": "Scan for TODO/FIXME/HACK comments"},
  {"category": "duplication", "description": "Find duplicated code blocks"},
  {"category": "complexity", "description": "Identify complex functions"},
  {"category": "dependencies", "description": "Check for outdated dependencies"},
  {"category": "missing-tests", "description": "Find source files without tests"},
  {"category": "inconsistencies", "description": "Detect inconsistent patterns"}
]'
```

### Phase 2: Execute Loop

Repeat until `next` returns `null`:

**Step 1: Get next task**
```bash
loop_engine.py next tech-debt-audit
```

If output is `null`, go to Phase 3.

**Step 2: Scan for the category**

Execute the appropriate scan:

```bash
# TODO/FIXME
grep -rn "TODO\|FIXME\|HACK\|XXX\|WORKAROUND" --include="*.py" --include="*.ts" --include="*.js" --include="*.go" --include="*.rs" --include="*.java"

# Complex functions (Python example)
grep -n "def " --include="*.py" -A 50 | head -100

# Outdated dependencies
npm outdated 2>/dev/null || pip list --outdated 2>/dev/null || true

# Missing tests
glob "**/*.{py,ts,js}"
# Compare source files with test file patterns
```

**Step 3: Collect findings**

For each finding, record:
- File path and line number
- What was found
- Severity (Critical/High/Medium/Low)
- Age (use `git blame` for TODOs)

**Step 4: Record result**

```bash
loop_engine.py complete tech-debt-audit <id> "Found 12 TODOs (2 High, 7 Medium, 3 Low), 3 FIXMEs (1 Critical)"
```

If the scan fails:
```bash
loop_engine.py fail tech-debt-audit <id> "Could not run npm outdated: package.json not found"
```

### Phase 3: Report

```bash
loop_engine.py summary tech-debt-audit
```

Generate a consolidated report:

```
## Tech Debt Audit Report

**Overall Health:** [Good/Fair/Poor/Critical]

| Category | Findings | Severity |
|----------|----------|----------|
| TODO/FIXME | 15 items | 1 Critical, 2 High, 12 Medium |
| Code Duplication | 5 blocks | 2 High, 3 Medium |
| Complex Functions | 8 functions | 3 High, 5 Medium |
| Outdated Dependencies | 4 packages | 1 High, 3 Low |
| Missing Tests | 12 files | 5 High, 7 Low |
| Inconsistent Patterns | 3 issues | 3 Low |

### Prioritized Action Items

1. [CRITICAL] Fix race condition in src/cache.py:15 (FIXME, 3 months old)
2. [HIGH] Add rate limiting in src/auth.py:42 (TODO, 6 months old)
3. [HIGH] Add tests for 5 core modules
4. [MEDIUM] Refactor 3 functions over 100 lines
5. [LOW] Update 3 outdated dependencies
```

## Rules

- **Don't fix anything during the audit** - this is assessment only
- **Use git blame** to age TODOs and understand context
- **Be specific** - "refactor auth module" is not actionable; "split authenticate() into 3 functions" is
- **Include file paths and line numbers** for every finding
- **If a category has no findings**, mark complete with "no issues found"
- **Prioritize by risk** - security/data issues are always Critical
