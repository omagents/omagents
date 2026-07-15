---
name: init-deep
description: "Auto-generate hierarchical AGENTS.md files throughout a project. Trigger when the user says 'init-deep', 'generate AGENTS.md', or wants to set up project context for AI agents. Scans the codebase and creates context files at each meaningful directory level."
---

# Init-Deep: Hierarchical AGENTS.md Generation

Generate hierarchical `AGENTS.md` files so agents auto-Read relevant context per directory, reducing token usage and improving accuracy.

## When to Use

- New project onboarding
- User says `/init-deep`, "generate AGENTS.md", or "set up agent context"
- After major restructuring

## What It Produces

```
project/
├── AGENTS.md              ← project-wide context
├── src/
│   ├── AGENTS.md          ← src-specific context
│   └── components/
│       └── AGENTS.md      ← component-specific context
```

Each `AGENTS.md` is scoped to its directory. Agents entering a subdirectory Read only that context plus the root.

## Workflow

### Step 1: Scan the project root

1. Read the root directory structure (`ls`, `glob`)
2. Identify the project type: language, framework, build tool
3. Read key files: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `README.md`, existing `AGENTS.md`
4. Determine the module/package structure

### Step 2: Generate root AGENTS.md

Include:
- **Project name and purpose** (1-2 sentences)
- **Tech stack** (language, framework, build tool, package manager)
- **Directory structure** (top-level, with one-line descriptions)
- **Key conventions** (naming, file organization, testing approach)
- **How to build/test/run** (exact commands)
- **Common mistakes** (project-specific pitfalls)

### Step 3: Identify subdirectories that need their own AGENTS.md

Create AGENTS.md for directories that:
- Contain a distinct module or subsystem
- Have their own build/test commands
- Have non-obvious internal structure
- Would benefit from scoped context

Do NOT create AGENTS.md for:
- Directories with only 1-2 files
- Directories that are self-explanatory (e.g., `assets/`, `public/`)
- `node_modules/`, `.git/`, `dist/`, `build/`

### Step 4: Generate subdirectory AGENTS.md files

For each identified subdirectory, include:
- **What this directory does** (1 sentence)
- **Key files** (with one-line descriptions)
- **Internal conventions** (if different from root)
- **Dependencies** (what it imports from other modules)
- **How to test this module** (if it has its own tests)

### Step 5: Verify

- Ensure no AGENTS.md exceeds ~150 lines
- Ensure each file is self-contained but doesn't repeat root-level info
- Verify paths and commands are correct

## Rules

- **Don't overwrite existing AGENTS.md without asking** - show a diff instead
- **Keep it concise** - each file should be scannable in seconds
- **No fluff** - if a directory is simple, skip it
- **Use the project's actual conventions** - don't impose generic patterns
- **Include exact commands** - not "run the test suite" but `npm test` or `pytest tests/`
