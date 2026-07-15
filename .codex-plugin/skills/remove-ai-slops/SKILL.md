---
name: remove-ai-slops
description: "Clean up AI-generated code artifacts using a durable loop workflow. Trigger when the user says 'clean AI code', 'remove slops', 'remove AI artifacts', or notices low-quality AI-generated code. Processes files one by one with verification."
---

# Remove AI Slops (Loop Engine)

Clean up common AI-generated code artifacts using a durable task queue. Each file is processed, verified, and marked complete before moving to the next.

## When to Use

- User says "clean AI code", "remove slops", "remove AI artifacts"
- After a large AI-generated change that needs cleanup
- Before code review or commit

## What to Remove (Reference)

| Pattern | Example | Action |
|---------|---------|--------|
| Redundant comments | `# Set counter to zero` before `counter = 0` | Remove |
| Obvious docstrings | `"""Get the name."""` on `def get_name(self)` | Remove |
| Unused imports | `import os` never referenced | Remove |
| Over-engineered abstractions | Single-use factory with one product | Inline |
| Verbose naming | `user_account_configuration_settings` | Shorten to `config` |
| Redundant type checking | `isinstance` check when type hints exist | Remove |
| Boilerplate error handling | `try/except: raise` that adds nothing | Remove |

Keep comments that explain **why**, not **what**.

## Loop Workflow

### Phase 1: Build Task Queue

Scan the codebase for files to process:

```Bash
# Find all source files in the changed area (adjust extensions as needed)
glob "**/*.{py,ts,js,go,rs,java}"
```

Initialize the loop:

```Bash
loop_engine.py init remove-ai-slops '[
  {"file": "src/auth.py", "description": "Clean AI slops in auth module"},
  {"file": "src/cache.py", "description": "Clean AI slops in cache module"},
  {"file": "src/utils.ts", "description": "Clean AI slops in utils"}
]'
```

### Phase 2: Execute Loop

Repeat until `next` returns `null`:

**Step 1: Get next task**
```Bash
loop_engine.py next remove-ai-slops
```

If output is `null`, go to Phase 3.

**Step 2: Read the file and identify slops**

Read the file, scan for the 7 patterns listed above. For each found slop, note the line number and what to change.

**Step 3: Apply fixes**

Edit the file to remove the identified slops.

**Step 4: Verify**
```Bash
# Run linter (adjust for project)
ruff check <file>          # Python
npx eslint <file>          # JS/TS

# Run tests if available
npm test 2>/dev/null || pytest tests/ 2>/dev/null || true
```

**Step 5: Record result**

If verification passes:
```Bash
loop_engine.py complete remove-ai-slops <id> "Removed N slops: 2 comments, 1 unused import"
```

If verification fails (tests broke):
```Bash
loop_engine.py fail remove-ai-slops <id> "Test failure in test_auth.py"
```

The engine will allow up to 3 retries before marking the task as blocked.

### Phase 3: Report

```Bash
loop_engine.py summary remove-ai-slops
```

Present the summary to the user. For any blocked tasks, show the error and suggest manual review.

## Rules

- **One file per task** - don't batch multiple files
- **Always verify after cleaning** - lint or test must pass
- **Don't remove comments that explain business logic**
- **Don't rename public API functions** without checking all callers
- **Show diffs for large changes** before applying
- **Preserve copyright/license headers**
- **If a file has no slops**, mark complete with result "no slops found"
