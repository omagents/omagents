---
name: github-triage
description: "Triage GitHub issues using a durable loop workflow. Each issue is classified, labeled, and recorded before moving to the next. Trigger when the user says 'triage issues', 'classify issues', 'organize issues'."
---

# GitHub Issue Triage (Loop Engine)

Systematically review, categorize, and label GitHub issues using a durable task queue. Each issue is processed individually with its result recorded.

## When to Use

- User says "triage issues", "classify issues", "organize issues"
- Backlog has grown and needs sorting
- After a release to clean up stale issues
- Weekly/monthly issue review

## Classification Reference

**By Type:** `bug`, `feature`, `enhancement`, `documentation`, `question`, `duplicate`
**By Priority:** `priority:critical`, `priority:high`, `priority:medium`, `priority:low`
**By Effort:** `effort:small` (<1h), `effort:medium` (1-4h), `effort:large` (>4h)

## Loop Workflow

### Phase 1: Build Task Queue

Fetch open issues using the github MCP:

```
mcp__github__list_issues(owner="<owner>", repo="<repo>", state="OPEN", perPage=50)
```

Initialize the loop with one task per issue:

```Bash
loop_engine.py init github-triage '[
  {"issue_number": 42, "title": "Login fails on Safari", "description": "Triage issue #42: Login fails on Safari"},
  {"issue_number": 43, "title": "Add dark mode", "description": "Triage issue #43: Add dark mode"},
  {"issue_number": 44, "title": "How to configure X?", "description": "Triage issue #44: How to configure X?"}
]'
```

### Phase 2: Execute Loop

Repeat until `next` returns `null`:

**Step 1: Get next task**
```Bash
loop_engine.py next github-triage
```

If output is `null`, go to Phase 3.

**Step 2: Read the full issue**

```
mcp__github__issue_read(method="get", owner="<owner>", repo="<repo>", issue_number=<N>)
```

Read the title, body, and existing labels. Read comments if needed.

**Step 3: Classify**

Determine type, priority, and effort based on the classification reference above.

**Step 4: Check for duplicates**

```
mcp__github__search_issues(query="repo:<owner>/<repo> is:issue <keywords from title>")
```

If a duplicate is found, note the original issue number.

**Step 5: Apply labels**

```
mcp__github__issue_write(
  method="update",
  owner="<owner>",
  repo="<repo>",
  issue_number=<N>,
  labels=["bug", "priority:high", "effort:medium"]
)
```

For duplicates, close with a comment:
```
mcp__github__add_issue_comment(
  owner="<owner>", repo="<repo>", issue_number=<N>,
  body="Closing as duplicate of #<original>. Please follow the original issue for updates."
)
mcp__github__issue_write(method="update", owner="<owner>", repo="<repo>", issue_number=<N>, state="closed", state_reason="duplicate")
```

**Step 6: Record result**

```Bash
loop_engine.py complete github-triage <id> "Labeled: bug, priority:high, effort:medium"
```

If labeling fails (permissions, etc.):
```Bash
loop_engine.py fail github-triage <id> "Permission denied: cannot label issues"
```

### Phase 3: Report

```Bash
loop_engine.py summary github-triage
```

Present the summary table:

```
| # | Title | Type | Priority | Action |
|---|-------|------|----------|--------|
| 42 | Login fails on Safari | bug | high | Labeled |
| 43 | Add dark mode | feature | medium | Labeled |
| 44 | How to configure X? | question | - | Closed (answered) |
```

## Rules

- **Don't close issues without user approval** - only label and comment
- **Read the full issue body** - titles alone are misleading
- **Check existing labels first** - don't duplicate or contradict
- **Be conservative with `priority:critical`** - reserve for true blockers
- **Always add a comment when labeling** - not just silent labels
- **If an issue is already well-labeled**, mark complete with "already triaged"
