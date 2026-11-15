---
name: work-with-pr
description: "Manage the full PR lifecycle using the github MCP: create, update, review, merge. Trigger when the user says 'create PR', 'update PR', 'review PR', 'merge PR', or needs to work with pull requests."
---

# Work With PR: Pull Request Lifecycle

Manage pull requests from creation to merge using the github MCP tools.

## When to Use

- User says "create PR", "open PR", "submit PR"
- User says "review PR", "check PR status"
- User says "merge PR", "update PR branch"
- Any PR-related workflow

## Workflow

### 1. Before Creating a PR

Verify the branch is ready:

```bash
# Check current branch
git branch --show-current

# Check for uncommitted changes
git status --porcelain

# Check commits to be included
git log origin/main..HEAD --oneline
```

### 2. Create a PR

```
github_create_pull_request(
  owner="<owner>",
  repo="<repo>",
  title="<clear title>",
  head="<feature-branch>",
  base="main",
  body="## Summary\n\n<what this PR does>\n\n## Changes\n\n- <change 1>\n- <change 2>\n\n## Testing\n\n<how to test>"
)
```

PR body structure:
- **Summary**: One sentence describing what the PR does
- **Changes**: Bullet list of specific changes
- **Testing**: How to verify the changes work

### 3. Check PR Status

```
# Get PR details
github_pull_request_read(method="get", owner="<owner>", repo="<repo>", pullNumber=<N>)

# Get changed files
github_pull_request_read(method="get_files", owner="<owner>", repo="<repo>", pullNumber=<N>)

# Get diff
github_pull_request_read(method="get_diff", owner="<owner>", repo="<repo>", pullNumber=<N>)

# Get CI check runs
github_pull_request_read(method="get_check_runs", owner="<owner>", repo="<repo>", pullNumber=<N>)
```

### 4. Update PR

```
# Update title or body
github_update_pull_request(owner="<owner>", repo="<repo>", pullNumber=<N>, title="<new title>")

# Update branch with latest from base
github_update_pull_request_branch(owner="<owner>", repo="<repo>", pullNumber=<N>)

# Convert to/from draft
github_update_pull_request(owner="<owner>", repo="<repo>", pullNumber=<N>, draft=false)
```

### 5. Review a PR

Create a pending review, add comments, then submit:

```
# Create pending review
github_pull_request_review_write(method="create", owner="<owner>", repo="<repo>", pullNumber=<N>)

# Add line comments
github_add_comment_to_pending_review(
  owner="<owner>", repo="<repo>", pullNumber=<N>,
  path="src/file.ts", line=42, side="RIGHT",
  body="Consider extracting this to a helper function.",
  subjectType="LINE"
)

# Submit the review
github_pull_request_review_write(
  method="submit_pending", owner="<owner>", repo="<repo>", pullNumber=<N>,
  event="COMMENT"  # or "APPROVE" or "REQUEST_CHANGES"
)
```

### 6. Merge a PR

```
github_merge_pull_request(
  owner="<owner>",
  repo="<repo>",
  pullNumber=<N>,
  merge_method="squash",  # "merge", "squash", or "rebase"
  commit_title="<title>",
  commit_message="<details>"
)
```

### 7. Handle Review Comments

```
# Get review threads
github_pull_request_read(method="get_review_comments", owner="<owner>", repo="<repo>", pullNumber=<N>)

# Reply to a review comment
github_add_reply_to_pull_request_comment(
  owner="<owner>", repo="<repo>",
  commentId=<comment_id>,
  body="Fixed in <commit_sha>",
  pullNumber=<N>
)
```

## PR Checklist

Before creating a PR:
- [ ] Branch is up to date with base (`git rebase origin/main`)
- [ ] All tests pass
- [ ] No uncommitted changes
- [ ] Commit messages are clear
- [ ] PR title follows convention (feat:, fix:, docs:, refactor:, chore:)

Before merging:
- [ ] CI checks pass
- [ ] Code review approved
- [ ] No unresolved review comments
- [ ] Branch is up to date

## Rules

- **Squash merge by default** for clean history
- **Never force-push** to shared branches
- **Address all review comments** before merging
- **Use draft PR** for work in progress
- **Keep PRs small** -- one feature/fix per PR
