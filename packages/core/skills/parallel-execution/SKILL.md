---
name: parallel-execution
description: "The orchestrator agent automatically parallelizes work using background tasks. Use /ps to check status, cancel_task to cancel."
---

# Parallel Execution

The `orchestrator` agent is the default agent. It automatically decomposes tasks into parallel background subagents when beneficial.

## How It Works

You don't need to do anything special. When you ask the orchestrator to do something that can be parallelized, it will:

1. **Decompose** your request into independent subtasks
2. **Launch** each as a background task via `task(background: true)`
3. **Continue** working on other things while they run
4. **Synthesize** results when all tasks complete

## Checking Status

Type `/ps` to see all background tasks:

```
/ps
```

## Cancelling Tasks

Tell the orchestrator to cancel a task, or it will use the `cancel_task` tool:

```
cancel the research task
```

## Background Job Board

The plugin automatically injects a "Background Job Board" summary into the orchestrator's context. This includes running tasks and completed (unreconciled) tasks with their results. The orchestrator acknowledges completed tasks before responding.

## Tips

- Background subagents are auto-enabled by the plugin.
- The orchestrator decides when to parallelize - you just talk naturally.
- For dependent tasks, the orchestrator launches the first, continues other work, and launches the dependent task when results arrive.
- Don't ask the orchestrator to "wait" for background tasks - it knows when they complete.
