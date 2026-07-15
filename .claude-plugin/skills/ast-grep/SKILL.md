---
name: ast-grep
description: "AST-aware code search and rewrite across 25+ languages using the ast-grep (sg) CLI. Trigger when the agent needs structural code matching, pattern-based search, or pattern-based rewriting. Falls back to grep if ast-grep is not installed."
---

# AST-Grep: Structural Code Search and Rewrite

Pattern-aware code search using the `ast-grep` (`sg`) binary. Matches code by its syntactic structure, not just text.

## When to Use

- Find all calls to a specific function pattern (not just the name)
- Find all instances of a code structure (e.g., all try/catch blocks)
- Rewrite code patterns across the codebase
- When grep is too imprecise (matches in strings, comments, etc.)

## Prerequisites

Check if ast-grep is installed:

```Bash
sg --version 2>/dev/null || npx ast-grep --version 2>/dev/null
```

If not installed, fall back to `grep` with careful regex patterns.

## Basic Usage

### Search

```Bash
# Find all console.log calls
sg -p 'console.log($$$)' --lang javascript

# Find all function definitions with a specific name pattern
sg -p 'def $NAME($$$):' --lang python

# Find all if statements with a single return
sg -p 'if ($COND) { return $VAL }' --lang typescript
```

### Replace

```Bash
# Preview first (ALWAYS dry-run before applying)
sg -p 'console.log($$$)' -r 'logger.info($$$)' --lang javascript

# Apply (only after verifying preview)
sg -p 'console.log($$$)' -r 'logger.info($$$)' --lang javascript --update-all
```

### Validate Pattern

```Bash
# Check if pattern is valid before searching
sg -p 'pattern' --lang python --json=compact 2>&1 | head -5
```

## Pattern Syntax

| Token | Meaning |
|-------|---------|
| `$NAME` | Match a single AST node, bind to NAME |
| `$$$` | Match zero or more AST nodes (wildcard) |
| Literal text | Must match exactly in AST structure |

Examples:
```
# Python: find all decorators
@$DECORATOR
def $FUNC($$$):
    $$$

# TypeScript: find all arrow functions assigned to const
const $NAME = ($$$) => $BODY

# Rust: find all match arms with panic
$PAT => panic!($$$)
```

## Language Detection

ast-grep auto-detects language from file extension. Override with `--lang`:

```Bash
sg -p 'pattern' --lang python
sg -p 'pattern' --lang typescript
sg -p 'pattern' --lang rust
sg -p 'pattern' --lang go
```

Supported: python, javascript, typescript, rust, go, java, c, cpp, csharp, ruby, php, swift, kotlin, scala, html, css, json, yaml, and more.

## Refactor Mode (Loop Engine)

For project-wide refactoring, use the loop engine to process files one by one:

```Bash
# Phase 1: Find all matching files
sg -p 'console.log($$$)' --lang javascript --json=compact | jq '.[].path' | sort -u

# Phase 2: Build task queue
loop_engine.py init ast-grep-refactor '[
  {"file": "src/index.js", "description": "Replace console.log with logger.info"},
  {"file": "src/utils.js", "description": "Replace console.log with logger.info"}
]'

# Phase 3: Loop - for each file:
#   1. Get next task: loop_engine.py next ast-grep-refactor
#   2. Preview: sg -p 'console.log($$$)' -r 'logger.info($$$)' --lang javascript <file>
#   3. Apply: sg -p 'console.log($$$)' -r 'logger.info($$$)' --lang javascript --update-all <file>
#   4. Verify: run tests/linter
#   5. Complete: loop_engine.py complete ast-grep-refactor <id> "Replaced 3 calls"
```

## Fallback to grep

If ast-grep is not installed, use grep with careful patterns:

```Bash
# Instead of sg -p 'console.log($$$)' --lang javascript
grep -rn "console\.log(" --include="*.js" --include="*.ts"

# Instead of sg -p 'def $NAME($$$):' --lang python
grep -rn "def .*(" --include="*.py"
```

Note: grep matches text, not structure. It will match in strings, comments, and produce false positives.

## Rules

- **ALWAYS preview before applying** -- dry-run first
- **Validate patterns** before searching to catch syntax errors
- **One file per task** in refactor mode
- **Run tests after applying** -- structural changes can break code
- **Use --lang explicitly** when auto-detection might fail
