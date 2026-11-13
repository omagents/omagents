---
name: parallel-execution
description: "Parallelize independent work with Codex-native subagents, mailbox completion, and bounded waits."
---

# Parallel Execution on Codex

Decompose work into independent subtasks when parallel execution is beneficial. Codex uses its own multi-agent tools; the OpenCode parallel engine and Job Board are not installed.

## How It Works

1. **Decompose** the request into self-contained subtasks with independent write scopes.
2. **Launch** each with `spawn_agent` and `fork_turns: "none"`; provide complete prompts and follow the actual session's model/reasoning-effort policy.
3. **Continue** useful local work while children run.
4. **Synthesize** after all required children report outcomes.

Codex multi-agent support must be enabled and the current tool list is authoritative. Do not copy another host's subagent type or launch-mode arguments.

## Waiting and Recovery

Completion mail arrives in the controller mailbox. While useful work remains, do not wait. When only waiting remains, use `wait_agent` with a five-to-ten-minute bounded timeout, then post status and reconcile with `list_agents`. Short polling wastes calls and context.

Use `followup_task` to steer or resume a V2 child, including after eviction. Do not create a replacement child just because the original was evicted. Only V1 requires `close_agent` cleanup.

## Tips

- Keep independent file write scopes separate.
- For dependent work, use the first child's result as input to the next spawn.
- For trivial work, act directly instead of delegating.
- Preserve failed, cancelled, or unreadable outcomes accurately rather than claiming success.
