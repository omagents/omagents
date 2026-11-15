---
name: hyperplan
description: "Adversarial plan review with 3 parallel native DSH critics using loop engine tracking: security, architecture, and edge cases. Trigger for 'hyperplan', 'review plan', 'critique plan', or adversarial design analysis."
---

# Hyperplan: Adversarial Plan Review on DSH

Dispatch three concurrent native DSH critic subagents. Track their durable outcomes with the loop engine and Job Board, then synthesize one prioritized report.

## When to Use

- The user says "hyperplan", "review plan", or "critique plan".
- A major implementation plan needs stress-testing.
- Brainstorming and planning are complete and execution has not started.

The native skill result supplies this skill's absolute base directory as `<skill-dir>`. Use `<python>` from `agents-python-tools` and invoke `<python> <skill-dir>/../_shared/scripts/loop_engine.py`; do not assume the script is on `PATH`.

## Phase 1: Build the Task Queue

Run from the project root:

```bash
<python> <skill-dir>/../_shared/scripts/loop_engine.py init hyperplan '[
  {"task_id": "security", "critic": "security", "description": "Security critic: vulnerabilities, input validation, auth bypass, data exposure"},
  {"task_id": "architecture", "critic": "architecture", "description": "Architecture critic: coupling, scalability, design patterns, maintainability"},
  {"task_id": "edge-cases", "critic": "edge-cases", "description": "Edge cases critic: unhandled scenarios, error paths, race conditions, empty states"}
]'
```

## Phase 2: Dispatch All Three Critics Concurrently

Start all three native `subagent` calls together. Each child receives a complete self-contained prompt and may receive the project root as `cwd`. Native DSH delegation is asynchronous; no launch-mode argument exists.

```text
subagent({
  description: "Security critic",
  cwd: "<project-root>",
  prompt: "You are a security critic. Review the following plan and find security issues.

Plan:
<insert approved plan here>

Analyze for:
1. Input validation gaps
2. Authentication/authorization bypass
3. Data exposure in logs, errors, and responses
4. Injection vulnerabilities
5. Dependency risks

Return findings with severity (CRITICAL/HIGH/MEDIUM/LOW), exact file/line or plan-section references, and concrete fixes."
})

subagent({
  description: "Architecture critic",
  cwd: "<project-root>",
  prompt: "You are an architecture critic. Review the following plan and find design issues.

Plan:
<insert approved plan here>

Analyze for:
1. Tight coupling between modules
2. Scalability bottlenecks
3. Missing abstractions or over-engineering
4. Error handling strategy
5. Testability concerns

Return findings with severity (CRITICAL/HIGH/MEDIUM/LOW), exact design references, and concrete recommendations."
})

subagent({
  description: "Edge cases critic",
  cwd: "<project-root>",
  prompt: "You are an edge cases critic. Review the following plan and find unhandled scenarios.

Plan:
<insert approved plan here>

Analyze for:
1. Empty/null/undefined inputs
2. Concurrent access and race conditions
3. Network failures and timeouts
4. Resource exhaustion (memory, disk, connections)
5. Boundary conditions (zero, maximum, negative, unicode)

Return findings with severity (CRITICAL/HIGH/MEDIUM/LOW), exact scenarios, and concrete fixes."
})
```

Continue useful work while the critics run. Do not poll. Native completion delivery and the OmAgents Job Board report each outcome.

## Phase 3: Record Completion, Failure, or Cancellation

When a critic returns findings, record its actual result:

```bash
<python> <skill-dir>/../_shared/scripts/loop_engine.py complete hyperplan security "Found 3 issues: 1 CRITICAL, 2 MEDIUM"
<python> <skill-dir>/../_shared/scripts/loop_engine.py complete hyperplan architecture "Found 2 design issues"
```

If a critic fails without usable findings:

```bash
<python> <skill-dir>/../_shared/scripts/loop_engine.py fail hyperplan edge-cases "Critic failed without findings"
```

Use `parallel_status` for a read-only snapshot. To cancel a running critic, call `cancel_task` with its Job Board ID or alias. Acceptance enters `cancelling`; only the native `subagent/end` settlement confirms `cancelled`. Do not interrupt twice and do not mark a cancelled critic complete. Record a failure/cancellation result instead and report that the three-critic review is incomplete unless the user authorizes a retry.

Local interruption preserves descendants; external one-shot children cannot resume. Never infer success from inactivity or an unreadable result.

## Phase 4: Synthesize Only After Settlement

Wait until all three critics have authoritative outcomes and their queue results are recorded:

```bash
<python> <skill-dir>/../_shared/scripts/loop_engine.py summary hyperplan
```

Synthesize completed critic findings into this structure:

```markdown
## Hyperplan Review Report

### Summary
- Security: 1 CRITICAL, 2 MEDIUM
- Architecture: 0 CRITICAL, 3 MEDIUM
- Edge Cases: 0 CRITICAL, 1 HIGH, 2 LOW

### Critical Issues (must fix before implementation)
1. [SECURITY] SQL injection in search endpoint (src/api/search.ts:42)
   Fix: Use parameterized queries

### High Priority (should fix before implementation)
2. [EDGE] No timeout on external API calls (src/services/external.ts:15)
   Fix: Add a 30-second timeout with bounded retry

### Medium Priority (address during implementation)
3. [ARCH] Search module directly imports authentication internals
   Fix: Introduce the planned interface in shared/types.ts

### Low Priority (nice to have)
4. [EDGE] Unicode normalization is unspecified
   Fix: Define and test the normalization policy
```

Deduplicate overlapping findings, preserve the highest justified severity, and include every critic's outcome. If one was cancelled or failed, label the report incomplete rather than claiming full three-critic coverage.

## Rules

- **All critics run concurrently** with native `subagent` calls.
- **Wait for all authoritative outcomes** before synthesizing.
- **Be hostile, not polite**; find problems rather than validate the plan.
- **Every finding needs** severity, location, and a fix recommendation.
- **Critical issues block implementation** until addressed.
- **No findings is a valid completed result**; record "no issues found".
- **Cancellation is not completion**; preserve it accurately in the queue and report.
