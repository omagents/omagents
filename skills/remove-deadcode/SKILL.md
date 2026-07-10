---
name: remove-deadcode
description: "Find and remove unreferenced code: unused functions, variables, imports, files, and exports. Trigger when the user says 'remove dead code', 'clean unused code', 'find unused', or wants to reduce codebase size."
---

# Remove Dead Code

Systematically find and remove code that is never referenced or executed.

## When to Use

- User says "remove dead code", "clean unused code", "find unused"
- Before refactoring
- Reducing bundle size
- Tech debt cleanup

## What to Find

### 1. Unused Imports

```bash
# Python
grep -rn "^import\|^from" --include="*.py" |  # find all imports
# Then verify each is actually used

# JavaScript/TypeScript
grep -rn "^import\|^const.*require" --include="*.ts" --include="*.js"
```

For each import found, search for its usage in the same file. If not found, it's dead.

### 2. Unreferenced Functions/Methods

Use `codegraph_codegraph_explore` to find functions that are never called:
- Query for each function name
- If no callers are found (other than the definition), it may be dead

Fallback with grep:
```bash
grep -rn "function_name" --include="*.py" --include="*.ts"
```

If the only matches are the definition itself, the function is dead.

**Exceptions - don't remove:**
- Public API endpoints (decorated with `@app.route`, `@api_view`, etc.)
- Exported module functions (in `__init__.py`, `index.ts`, etc.)
- Entrypoints (`main()`, `if __name__ == "__main__"`)
- Test helper functions (used by tests)
- Callback/event handler registrations

### 3. Unused Variables

Scan for variables assigned but never read:
```bash
# Look for assignments, then check if the variable is read later
```

### 4. Unreferenced Files

Find files that are never imported by any other file:
```bash
# List all source files
glob "**/*.{py,ts,js}"
# For each, grep to see if it's imported anywhere
```

**Don't remove:**
- Entry point files (`main.py`, `index.ts`, `app.js`)
- Test files
- Configuration files
- Files referenced by build config (webpack, vite, etc.)

### 5. Dead CSS/Styles

Find CSS classes that are never used in any template:
```bash
# Extract class names from CSS
grep -oP '\.\K[a-zA-Z_-][a-zA-Z0-9_-]*' styles.css
# Search for each in templates
```

### 6. Commented-Out Code

Find blocks of commented-out code (not documentation comments):
```bash
grep -rn "^\s*//.*=\|^\s*#.*=" --include="*.py" --include="*.ts" --include="*.js"
```

Remove commented-out code. It's in version control if you need it back.

## Workflow

1. **Scan**: Use grep, codegraph, and glob to find candidates
2. **Classify**: For each candidate, determine if it's truly dead (check exceptions list)
3. **Report**: Present a table of findings with file, line, and reason
4. **Remove**: After user approval, remove the dead code
5. **Verify**: Run tests and linters to confirm nothing broke
6. **Commit**: Suggest committing with a clear message

## Output Format

```
| File | Line | Type | Name | Reason |
|------|------|------|------|--------|
| src/utils.py | 12 | import | `os` | Never used in file |
| src/utils.py | 45 | function | `old_helper()` | No callers found |
| src/types.ts | 8 | interface | `OldConfig` | Not imported anywhere |
```

## Rules

- **Always verify before removing** - grep/codegraph may miss dynamic references
- **Check for dynamic imports** - `import()`, `__import__()`, `require()`
- **Don't remove entry points or public APIs**
- **Run tests after removal** - the ultimate verification
- **Show findings before removing** - let the user decide what to keep
- **Remove in small batches** - easier to review and revert
