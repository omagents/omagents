---
name: parallel-execution
description: "The orchestrator agent automatically parallelizes independent work with native DSH subagents and tracks their outcomes on the Job Board."
---

# Parallel Execution

The `orchestrator` agent decomposes work into independent subtasks when parallel execution is beneficial.

## How It Works

1. **Decompose** the request into independent subtasks.
2. **Launch** native DSH subagents concurrently using the host's supported subagent interface.
3. **Continue** other work while those subagents run.
4. **Synthesize** the results after all required subtasks finish.

Do not use OpenCode-only tool names or launch arguments. DSH supplies its own native subagent lifecycle, completion notifications, cancellation, and recovery behavior.

## Checking Status

Use the `parallel_status` tool to inspect the current Job Board. It reports running, terminal, cancelled, and interrupted work with host task identifiers and outcome summaries.

## Cancelling Tasks

Use the `cancel_task` tool with a task ID or alias. Cancellation is reported as accepted first; the final state comes from the authoritative DSH subagent lifecycle.

## Job Board

The plugin injects Job Board changes into the orchestrator's context and exposes the same state to the DSH Web Job Board. Acknowledge completed outcomes before responding, and do not infer success from inactivity or an unreadable result.

## Tips

- Keep write scopes independent between concurrent lanes.
- For dependent work, launch the first subtask and use its result as input to the next.
- Do not poll repeatedly; DSH delivers lifecycle changes and completion notices.
- Preserve unfinished or unreadable work as interrupted rather than claiming it completed successfully.
