---
name: tech-debt-audit
description: "Systematically audit a codebase for technical debt: TODO/FIXME comments, code duplication, complex functions, outdated patterns, and missing tests. Trigger when the user says 'tech debt audit', 'audit code', 'code health check', or wants to assess codebase quality."
---

# Tech Debt Audit

Systematically scan a codebase for technical debt and produce a prioritized report.

## When to Use

- User says "tech debt audit", "audit code", "code health check"
- Before a major refactoring
- Sprint planning for debt paydown
- Periodic code health assessment

## What to Scan

### 1. TODO/FIXME/HACK Comments

```bash
grep -rn "TODO\|FIXME\|HACK\|XXX\|WORKAROUND" --include="*.py" --include="*.ts" --include="*.js" --include="*.go" --include="*.rs" --include="*.java"
```

For each match, read the surrounding context to understand:
- What needs to be done
- How old it is (check git blame)
- How risky it is

### 2. Code Duplication

Find repeated code blocks:
- Use `codegraph_codegraph_explore` to find similar function signatures
- Use grep to find repeated string patterns
- Look for copy-pasted blocks (3+ identical lines)

```bash
# Find files with similar names that might indicate duplication
glob "**/*.{py,ts,js}"
```

### 3. Complex Functions

Look for functions with high complexity:
- Long functions (> 50 lines)
- Deep nesting (> 4 levels)
- Many parameters (> 5)
- Many branches (if/else/switch > 5)

```bash
# Find long functions (Python)
grep -n "def " --include="*.py" -A 50 | grep -c ".*" # rough line count
```

### 4. Outdated Dependencies

```bash
# Node.js
cat package.json | grep -A 1 "dependencies"
# Check for outdated:
npm outdated 2>/dev/null || true

# Python
cat requirements.txt 2>/dev/null || cat pyproject.toml 2>/dev/null
# Check for outdated:
pip list --outdated 2>/dev/null || true
```

### 5. Missing Tests

Identify source files without corresponding test files:
```bash
# For each source file, check if a test file exists
glob "**/*.{py,ts,js}"
# Compare with test file patterns: test_*.py, *_test.py, *.test.ts, *.spec.js
```

### 6. Inconsistent Patterns

Look for:
- Mixed naming conventions (camelCase vs snake_case in same project)
- Mixed import styles (ESM vs CommonJS)
- Inconsistent error handling (try/catch in some places, Result types in others)
- Mixed testing frameworks

### 7. Configuration Debt

- Hardcoded values that should be configurable
- Secrets in code (use github_run_secret_scanning if available)
- Environment-specific code without abstraction

## Output Format

### Summary Dashboard

```
## Tech Debt Audit Report

**Overall Health:** [Good/Fair/Poor/Critical]

| Category | Count | Severity |
|----------|-------|----------|
| TODO/FIXME | 23 | Medium |
| Code Duplication | 5 blocks | High |
| Complex Functions | 8 | Medium |
| Outdated Dependencies | 4 | Low |
| Missing Tests | 12 files | High |
| Inconsistent Patterns | 3 | Low |
```

### Detailed Findings

For each category, list the top items:

```
### TODO/FIXME (Top 5 by age)

| File | Line | Text | Age | Severity |
|------|------|------|-----|----------|
| src/auth.py | 42 | TODO: add rate limiting | 6 months | High |
| src/cache.py | 15 | FIXME: race condition possible | 3 months | Critical |
```

### Prioritized Action Items

```
1. [CRITICAL] Fix race condition in src/cache.py:15
2. [HIGH] Add rate limiting in src/auth.py:42
3. [HIGH] Add tests for 12 untested files
4. [MEDIUM] Refactor 8 complex functions
5. [LOW] Update 4 outdated dependencies
```

## Rules

- **Don't fix anything during the audit** - this is assessment only
- **Use git blame** to age TODOs and understand context
- **Prioritize by risk** - a 6-month-old FIXME about race conditions is more urgent than a 2-day-old TODO about styling
- **Be specific** - "refactor auth module" is not actionable; "split authenticate() into 3 functions" is
- **Include file paths and line numbers** for every finding
