---
name: github-triage
description: "Triage GitHub issues using the github MCP. Automatically categorize, prioritize, and label issues. Trigger when the user says 'triage issues', 'classify issues', 'organize issues', or wants to review and sort their GitHub issue backlog."
---

# GitHub Issue Triage

Systematically review, categorize, and prioritize GitHub issues using the github MCP tools.

## When to Use

- User says "triage issues", "classify issues", "organize issues"
- Backlog has grown and needs sorting
- After a release to clean up stale issues
- Weekly/monthly issue review

## Workflow

### Step 1: Fetch Open Issues

Use `github_list_issues` to get all open issues:

```
github_list_issues(owner="<owner>", repo="<repo>", state="OPEN", perPage=50)
```

If more than 50, paginate with `after` cursor.

### Step 2: Classify Each Issue

For each issue, read the title and body, then classify:

**By Type:**
| Label | Criteria |
|-------|----------|
| `bug` | Unexpected behavior, error, crash |
| `feature` | Request for new functionality |
| `enhancement` | Improvement to existing feature |
| `documentation` | Docs issue, missing or incorrect |
| `question` | User question, not a code issue |
| `duplicate` | Same as another existing issue |

**By Priority:**
| Label | Criteria |
|-------|----------|
| `priority:critical` | Blocks production, data loss, security |
| `priority:high` | Blocks major functionality, no workaround |
| `priority:medium` | Affects functionality, has workaround |
| `priority:low` | Minor inconvenience, cosmetic |

**By Effort (if determinable):**
| Label | Criteria |
|-------|----------|
| `effort:small` | < 1 hour, single file change |
| `effort:medium` | 1-4 hours, multiple files |
| `effort:large` | > 4 hours, architectural change |

### Step 3: Detect Duplicates

For each issue, search for similar issues:
```
github_search_issues(query="repo:<owner>/<repo> is:issue <keywords from title>")
```

If a similar issue exists, mark as `duplicate` and reference the original.

### Step 4: Identify Stale Issues

Issues with no activity for 30+ days:
```
github_search_issues(query="repo:<owner>/<repo> is:issue is:open updated:<30d")
```

Suggest closing with a comment, or label `stale`.

### Step 5: Apply Labels

Use `github_issue_write` to update each issue:
```
github_issue_write(
  method="update",
  owner="<owner>",
  repo="<repo>",
  issue_number=<N>,
  labels=["bug", "priority:high", "effort:medium"]
)
```

### Step 6: Generate Summary Report

Present a table:

```
| # | Title | Type | Priority | Effort | Action |
|---|-------|------|----------|--------|--------|
| 42 | Login fails on Safari | bug | high | small | Labeled |
| 43 | Add dark mode | feature | medium | large | Labeled |
| 44 | How to configure X? | question | - | - | Closed (answered) |
| 45 | Same as #42 | duplicate | - | - | Closed (dup of #42) |
```

## Rules

- **Don't close issues without user approval** - only label and comment
- **Don't change priority of issues someone else set** - add a comment instead
- **Read the full issue body** - titles alone are misleading
- **Check existing labels first** - don't duplicate or contradict
- **Be conservative with `priority:critical`** - reserve for true blockers
- **Always explain why** - add a comment when labeling, not just silent labels
