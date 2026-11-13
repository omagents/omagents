---
name: hyperplan
description: "Adversarial plan review with 3 parallel Codex-native critics using loop engine tracking: security, architecture, and edge cases."
---

# Hyperplan: Adversarial Plan Review on Codex

Dispatch three concurrent Codex-native critic subagents, track their outcomes with the durable loop engine, and synthesize a prioritized review.

## When to Use

- The user says "hyperplan", "review plan", or "critique plan".
- A major plan needs adversarial review before implementation.

Codex multi-agent support must be enabled and the actual session tool list is authoritative. Resolve `loop_engine.py` against this skill's `../_shared/scripts/` resource and invoke it with the Python environment from `agents-python-tools`.

## Phase 1: Build the Queue

```bash
<python> <skill-dir>/../_shared/scripts/loop_engine.py init hyperplan '[
  {"task_id": "security", "critic": "security", "description": "Security critic"},
  {"task_id": "architecture", "critic": "architecture", "description": "Architecture critic"},
  {"task_id": "edge-cases", "critic": "edge-cases", "description": "Edge cases critic"}
]'
```

## Phase 2: Dispatch Three Codex-Native Critics

Issue three independent `spawn_agent` calls concurrently with `fork_turns: "none"` so each child receives a clean context. Supply each critic's complete prompt through the actual spawn schema and follow the session's model/reasoning-effort rules. Do not copy another host's launch arguments.

1. **Security critic** — review input validation, authentication/authorization bypass, data exposure, injection vulnerabilities, and dependency risks.
2. **Architecture critic** — review coupling, scalability, abstraction quality, error handling, and testability.
3. **Edge cases critic** — review empty/null inputs, races, network failures/timeouts, resource exhaustion, and numeric/unicode boundaries.

Every prompt must include the approved plan and require findings with severity (CRITICAL/HIGH/MEDIUM/LOW), exact file/line or plan-section references, and concrete fixes.

Continue useful local work while children run. Codex delivers completion mail to the controller mailbox. When only waiting remains, use `wait_agent` in bounded five-to-ten-minute stretches rather than short polls; reconcile with `list_agents` after each wake.

## Phase 3: Record Actual Outcomes

After each child's findings arrive:

```bash
<python> <skill-dir>/../_shared/scripts/loop_engine.py complete hyperplan security "Found 3 issues: 1 CRITICAL, 2 MEDIUM"
<python> <skill-dir>/../_shared/scripts/loop_engine.py complete hyperplan architecture "Found 2 design issues"
```

If a child fails without usable findings:

```bash
<python> <skill-dir>/../_shared/scripts/loop_engine.py fail hyperplan edge-cases "No usable findings"
```

Use the actual Codex child-management capabilities for any cancellation or follow-up. V2 children can receive `followup_task`; do not spawn a replacement merely because an existing child was evicted. Only V1 uses `close_agent` for cleanup. Never report an incomplete or cancelled critic as successful.

## Phase 4: Synthesize After Settlement

```bash
<python> <skill-dir>/../_shared/scripts/loop_engine.py summary hyperplan
```

Produce:

```markdown
## Hyperplan Review Report

### Summary
- Security: findings and severity counts
- Architecture: findings and severity counts
- Edge Cases: findings and severity counts

### Critical Issues (must fix before implementation)
1. [SECURITY] Finding, location, and concrete fix

### High Priority (should fix before implementation)
2. [EDGE] Finding, location, and concrete fix

### Medium Priority (address during implementation)
3. [ARCH] Finding, location, and concrete fix

### Low Priority (nice to have)
4. [EDGE] Finding, location, and concrete fix
```

Deduplicate overlaps and preserve the highest justified severity. If a critic failed or was cancelled, mark the review incomplete rather than claiming three-critic coverage.

## Rules

- All critics run concurrently through Codex-native delegation.
- Wait for all outcomes before synthesis.
- Be hostile, not polite; identify weaknesses rather than validate.
- Every finding needs severity, location, and a fix.
- Critical issues block implementation.
- No findings is a valid completed result.
