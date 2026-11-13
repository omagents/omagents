import { buildJobBoardContext } from "@omagents/core"

import type { DshJobBoard } from "./runtime.js"

export const DSH_PARALLEL_SECTION_NAME = "omagents:parallel-execution"
export const DSH_JOB_BOARD_CONTEXT_NAME = "omagents:job-board-state"

export const DSH_PARALLEL_INSTRUCTIONS = `<Parallel_Execution>
You can coordinate independent work with native DSH subagents and the shared Job Board.

## When to parallelize
- Research multiple independent questions.
- Explore separate parts of a codebase.
- Implement independent changes whose write scopes do not conflict.

## How to parallelize
1. Decompose the request into self-contained subtasks.
2. Start native DSH \`subagent\` delegations concurrently and continue useful work while they run.
3. Do not poll running jobs. Native lifecycle delivery reports completion; use \`parallel_status\` only when you need a read-only status snapshot.
4. Acknowledge pending outcomes shown by the Job Board before your final response, then synthesize the results.
5. For dependent work, use the first job's outcome as input to the next delegation.

For trivial work or tiny mechanical edits, act directly instead of delegating.
</Parallel_Execution>`

export const DSH_STATE_PRESERVATION_NOTE = `## OmAgents State Preservation
This operational context is regenerated from durable state for model requests, including after compaction; compacted conversation history is not its only copy.
If you were processing a loop_engine task queue, run:
  loop_engine.py status <skill>
  loop_engine.py next <skill>
to resume where you left off.
If you had delegated jobs running, use parallel_status to inspect their durable state without changing their notification state.`

/** Build a fresh required runtime snapshot; no compactable message history is consulted. */
export function buildDshStatePreservationContext(
  board: DshJobBoard,
  parentSessionId?: string
): string {
  const boardContext =
    parentSessionId === undefined ? "" : buildJobBoardContext(board, parentSessionId)
  return boardContext
    ? `${DSH_STATE_PRESERVATION_NOTE}\n\n${boardContext}`
    : DSH_STATE_PRESERVATION_NOTE
}
