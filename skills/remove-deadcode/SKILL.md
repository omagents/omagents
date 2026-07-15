---
name: remove-deadcode
description: "Find and remove unreferenced code using a durable loop workflow. Each candidate is verified, removed, tested, and marked complete before moving to the next. Trigger when the user says 'remove dead code', 'clean unused code', 'find unused'."
---

# Remove Dead Code (Loop Engine)

Systematically find and remove dead code using a durable task queue. Each candidate is verified as truly dead, removed, tested, and recorded before moving to the next.

## When to Use

- User says "remove dead code", "clean unused code", "find unused"
- Before refactoring
- Reducing codebase size
- Tech debt cleanup

## What to Find (Reference)

| Type | How to detect | Exceptions (don't remove) |
|------|--------------|---------------------------|
| Unused imports | grep import, verify usage in file | - |
| Unreferenced functions | codegraph or grep for callers | Entry points, public API, event handlers |
| Unused variables | Assigned but never read | - |
| Unreferenced files | Not imported anywhere | Entry points, config, test files |
| Dead CSS classes | Defined but never used in templates | - |
| Commented-out code | Blocks of commented code | Documentation comments |

## Loop Workflow

### Phase 1: Build Task Queue

Scan the codebase for dead code candidates:

```bash
# Find unused imports
grep -rn "^import\|^from" --include="*.py" --include="*.ts" --include="*.js"

# Find potentially unreferenced functions (use codegraph)
{{tool:codegraph_explore}} query="all function names"

# Find commented-out code
grep -rn "^\s*#.*=\|^\s*//.*=" --include="*.py" --include="*.ts" --include="*.js"
```

For each candidate, verify it's not an exception before adding to queue.

Initialize the loop:

```bash
loop_engine.py init remove-deadcode '[
  {"file": "src/utils.py", "line": 12, "type": "unused-import", "name": "os", "description": "Remove unused import os from utils.py"},
  {"file": "src/old_api.py", "line": 1, "type": "unreferenced-file", "name": "old_api.py", "description": "Remove unreferenced old_api.py"},
  {"file": "src/helpers.ts", "line": 45, "type": "unreferenced-function", "name": "oldHelper()", "description": "Remove unreferenced oldHelper() from helpers.ts"}
]'
```

### Phase 2: Execute Loop

Repeat until `next` returns `null`:

**Step 1: Get next task**
```bash
loop_engine.py next remove-deadcode
```

If output is `null`, go to Phase 3.

**Step 2: Verify the candidate is truly dead**

Double-check using grep:
```bash
grep -rn "<name>" --include="*.py" --include="*.ts" --include="*.js"
```

Check for dynamic references:
```bash
grep -rn "import(\|__import__\|require(" --include="*.py" --include="*.ts"
```

If references are found, mark complete with "not dead - referenced in X":
```bash
loop_engine.py complete remove-deadcode <id> "not dead - referenced in src/main.py:23"
```

**Step 3: Remove the dead code**

Edit the file to remove the import, function, or file.

**Step 4: Verify**
```bash
# Run tests
npm test 2>/dev/null || pytest tests/ 2>/dev/null || true

# Run linter
ruff check <file> 2>/dev/null || npx eslint <file> 2>/dev/null || true
```

**Step 5: Record result**

If verification passes:
```bash
loop_engine.py complete remove-deadcode <id> "Removed unused import os"
```

If tests fail:
```bash
loop_engine.py fail remove-deadcode <id> "test_utils.py failed after removal"
```

### Phase 3: Report

```bash
loop_engine.py summary remove-deadcode
```

Present the summary. For blocked tasks, show what failed and suggest the user review manually.

## Rules

- **Always double-check before removing** - grep may miss dynamic references
- **One candidate per task** - don't batch
- **Run tests after each removal** - not just at the end
- **Don't remove entry points or public APIs**
- **If not dead, mark complete with explanation** - don't leave as pending
- **Remove in small batches** - easier to review and revert
