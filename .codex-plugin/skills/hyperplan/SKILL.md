---
name: hyperplan
description: "Adversarial plan review with 3 parallel critics using loop engine tracking. Each critic attacks the plan from a different angle: security, architecture, and edge cases. Trigger when the user says 'hyperplan', 'review plan', 'critique plan', or wants adversarial analysis of a design."
---

# Hyperplan: Adversarial Plan Review (Loop + Parallel)

Dispatch 3 parallel critic subagents, each attacking a plan from a different perspective. The loop engine tracks completion; results are synthesized into a prioritized report.

## When to Use

- User says "hyperplan", "review plan", "critique plan"
- Before starting a major implementation
- When a plan needs stress-testing from multiple angles
- After brainstorming/writing-plans, before execution

## Loop Workflow

### Phase 1: Build Task Queue

```Bash
loop_engine.py init hyperplan '[
  {"critic": "security", "description": "Security critic: vulnerabilities, input validation, auth bypass, data exposure"},
  {"critic": "architecture", "description": "Architecture critic: coupling, scalability, design patterns, maintainability"},
  {"critic": "edge-cases", "description": "Edge cases critic: unhandled scenarios, error paths, race conditions, empty states"}
]'
```

### Phase 2: Dispatch All Critics in Parallel

Launch all 3 critics as background subagents in a single response:

```
task(background=true, description="Security critic", prompt="
You are a security critic. Review the following plan and find security issues.

Plan:
<insert plan here>

Analyze for:
1. Input validation gaps
2. Authentication/authorization bypass
3. Data exposure (logs, errors, responses)
4. Injection vulnerabilities
5. Dependency risks

Output: List of findings with severity (CRITICAL/HIGH/MEDIUM/LOW) and specific file/line references.
")

task(background=true, description="Architecture critic", prompt="
You are an architecture critic. Review the following plan and find design issues.

Plan:
<insert plan here>

Analyze for:
1. Tight coupling between modules
2. Scalability bottlenecks
3. Missing abstractions or over-engineering
4. Error handling strategy
5. Testability concerns

Output: List of findings with severity (CRITICAL/HIGH/MEDIUM/LOW) and specific design recommendations.
")

task(background=true, description="Edge cases critic", prompt="
You are an edge cases critic. Review the following plan and find unhandled scenarios.

Plan:
<insert plan here>

Analyze for:
1. Empty/null/undefined inputs
2. Concurrent access / race conditions
3. Network failures and timeouts
4. Resource exhaustion (memory, disk, connections)
5. Boundary conditions (0, max, negative, unicode)

Output: List of findings with severity (CRITICAL/HIGH/MEDIUM/LOW) and specific scenarios.
")
```

### Phase 3: Track Completion

As each background task completes, record the result:

```Bash
loop_engine.py complete hyperplan <id> "Found 3 issues: 1 CRITICAL, 2 MEDIUM"
```

If a critic fails to produce results:
```Bash
loop_engine.py fail hyperplan <id> "Critic timed out"
```

### Phase 4: Synthesize Report

When all critics are done:

```Bash
loop_engine.py summary hyperplan
```

Generate a consolidated report:

```
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
   Fix: Add 30s timeout with retry

### Medium Priority (address during implementation)
3. [ARCH] Search module directly imports from auth module
   Fix: Introduce interface in shared/types.ts
4. [SECURITY] Error messages leak internal paths
   Fix: Sanitize error responses
5. [ARCH] No retry strategy for failed jobs
   Fix: Add exponential backoff in queue processor
6. [EDGE] Empty search query returns all records
   Fix: Return empty result or validation error

### Low Priority (nice to have)
7. [EDGE] Unicode characters in usernames not handled
   Fix: Add unicode normalization
8. [EDGE] Negative page numbers cause 500 error
   Fix: Validate and return 400
```

## Rules

- **All critics run in parallel** -- dispatch in a single response
- **Wait for all critics** before synthesizing
- **Be hostile, not polite** -- the value is in finding problems, not validating
- **Each finding must have** severity, location, and fix recommendation
- **Critical issues block implementation** -- they must be addressed first
- **If a critic finds nothing**, that's valid -- mark complete with "no issues found"
