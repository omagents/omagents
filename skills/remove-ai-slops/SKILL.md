---
name: remove-ai-slops
description: "Clean up AI-generated code artifacts: redundant comments, obvious code explanations, unused imports, over-engineered abstractions, verbose naming, and other AI coding bad habits. Trigger when the user says 'clean AI code', 'remove slops', 'remove AI artifacts', or notices low-quality AI-generated code."
---

# Remove AI Slops

Clean up common AI-generated code artifacts that make code harder to read and maintain.

## When to Use

- User says "clean AI code", "remove slops", "remove AI artifacts"
- After a large AI-generated change that needs cleanup
- Before code review or commit
- User notices redundant comments or over-engineering

## What to Remove

### 1. Redundant Comments

Remove comments that restate the code:

```python
# BAD - remove these
# Set the counter to zero
counter = 0

# Loop through the items
for item in items:
    # Process the item
    process(item)

# Return the result
return result
```

Keep comments that explain **why**, not **what**:

```python
# GOOD - keep these
# Reset counter because the batch boundary changed
counter = 0

# Skip items that failed validation in the previous pass
for item in items:
    process(item)
```

### 2. Obvious Docstrings on Simple Functions

Remove docstrings from trivial functions where the name + signature is enough:

```python
# BAD - remove
def get_name(self):
    """Get the name."""
    return self.name

# GOOD - keep if it adds info
def get_name(self):
    """Return the display name, falling back to email if not set."""
    return self.name or self.email
```

### 3. Unused Imports

Scan for imports that are never referenced:

```python
# Remove if 'os' is never used
import os
import sys  # Keep if used
```

Use `grep` or codegraph to verify each import is actually referenced before removing.

### 4. Over-Engineered Abstractions

Look for:
- Single-use wrapper classes with no added value
- Factory patterns where only one product exists
- Interface/abstract classes with one implementation
- Excessive configuration options that are never varied

Simplify by inlining or removing the abstraction. Keep it only if there's a concrete plan to add a second implementation.

### 5. Verbose Naming

AI tends to over-describe variable names:

```python
# BAD
user_account_configuration_settings = get_config()
processed_user_data_list = [process(u) for u in users]

# GOOD
config = get_config()
users = [process(u) for u in users]
```

Shorten names where the context makes the meaning clear. Don't shorten to the point of ambiguity.

### 6. Unnecessary Type Checking

Remove redundant runtime type checks when the type system already covers it:

```python
# BAD - remove if using type hints
def add(a: int, b: int) -> int:
    if not isinstance(a, int) or not isinstance(b, int):
        raise TypeError("a and b must be integers")
    return a + b

# GOOD
def add(a: int, b: int) -> int:
    return a + b
```

### 7. Boilerplate Error Handling

Remove catch-all exception handlers that just re-raise or log and continue:

```python
# BAD - remove
try:
    result = do_something()
except Exception as e:
    print(f"Error: {e}")
    raise

# GOOD - just call it
result = do_something()
```

## Workflow

1. **Scan**: Use `grep` and `read` to find candidates in the changed files
2. **Review**: Show each candidate to the user with context
3. **Clean**: Apply the fix
4. **Verify**: Run linters/tests to ensure nothing broke
5. **Report**: Summary of what was removed and why

## Rules

- **Don't remove comments that explain non-obvious business logic**
- **Don't rename public API functions** without checking all callers
- **Run tests after cleanup** to verify behavior is unchanged
- **Show diffs** for user approval before applying large changes
- **Preserve copyright/license headers** at the top of files
