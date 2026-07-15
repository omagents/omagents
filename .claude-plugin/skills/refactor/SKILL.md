---
name: refactor
description: "Systematic code refactoring using a durable loop workflow. Each refactoring target is processed, verified, and marked complete before moving to the next. Trigger when the user says 'refactor', 'restructure code', or wants to improve code without changing behavior."
---

# Refactor (Loop Engine)

Systematically refactor code targets one by one, with verification after each change. The loop engine tracks progress and survives context clearing.

## When to Use

- User says "refactor", "restructure", "clean up code"
- Improving code quality without changing behavior
- Reducing complexity, removing duplication
- Modernizing patterns (e.g., callbacks to async/await)

## When NOT to Use

- Bug fixes (use systematic-debugging skill)
- New features (use brainstorming + writing-plans)
- Removing dead code (use remove-deadcode skill)

## Loop Workflow

### Phase 1: Identify Refactoring Targets

Scan the codebase for refactoring opportunities:

```Bash
# Long functions (> 50 lines)
grep -rn "def \|function \|const .* = " --include="*.py" --include="*.ts" --include="*.js" | head -50

# High complexity (deep nesting)
# Use codegraph to find complex call paths
mcp__codegraph__explore query="complex functions with deep nesting"

# Code duplication
# Use grep to find repeated patterns
grep -rn "duplicate pattern" --include="*.py"
```

### Phase 2: Build Task Queue

```Bash
loop_engine.py init refactor '[
  {"file": "src/auth.py", "target": "split authenticate() into validate_credentials() + create_session()", "description": "Refactor auth.py: split authenticate()"},
  {"file": "src/cache.py", "target": "replace manual caching with functools.lru_cache", "description": "Refactor cache.py: use lru_cache"},
  {"file": "src/utils.ts", "target": "extract duplicate validation logic into shared validator", "description": "Refactor utils.ts: extract validator"}
]'
```

### Phase 3: Execute Loop

Repeat until `next` returns `null`:

**Step 1: Get next task**
```Bash
loop_engine.py next refactor
```

If output is `null`, go to Phase 4.

**Step 2: Read and understand the target**

Read the file, understand what it does currently, and plan the specific changes.

**Step 3: Apply the refactoring**

Use Edit tools to make the changes. If using LSP-enabled OpenCode:
- Use `lsp` tool for `prepare_rename` and `rename` operations
- Use `lsp` tool for `findReferences` to ensure all callers are updated

If using ast-grep:
```Bash
sg -p 'old_pattern' -r 'new_pattern' --lang python --update-all <file>
```

**Step 4: Verify**

```Bash
# Run tests
npm test 2>/dev/null || pytest tests/ 2>/dev/null || true

# Run linter
ruff check <file> 2>/dev/null || npx eslint <file> 2>/dev/null || true

# Check LSP diagnostics if available
# Use lsp tool with diagnostics operation
```

**Step 5: Record result**

If verification passes:
```Bash
loop_engine.py complete refactor <id> "Split authenticate() into 2 functions, all tests pass"
```

If tests fail:
```Bash
loop_engine.py fail refactor <id> "test_auth.py failed after split"
```

### Phase 4: Report

```Bash
loop_engine.py summary refactor
```

Present the summary. For blocked tasks, show what failed and suggest manual review.

## Refactoring Patterns (Reference)

| Pattern | When to use | How |
|---------|------------|-----|
| Extract Function | Function too long, does multiple things | Split into smaller functions |
| Extract Class | Class has too many responsibilities | Split into focused classes |
| Replace Conditional with Polymorphism | Complex if/else or switch | Use strategy/template pattern |
| Replace Magic Number with Constant | Hardcoded values | Extract to named constants |
| Simplify Conditional | Complex boolean logic | Use guard clauses, early returns |
| Replace Inheritance with Composition | Deep inheritance hierarchy | Use composition/delegation |
| Rename | Misleading names | Use LSP rename for safety |

## Rules

- **One target per task** -- don't batch multiple refactors
- **Always verify after refactoring** -- tests must pass
- **Never change behavior** -- refactoring is structural only
- **Use LSP rename when available** -- safer than manual find/replace
- **Commit after each completed refactor** -- easier to revert
- **If tests fail, revert and mark as failed** -- don't leave broken code
- **Show diffs for large changes** before applying
