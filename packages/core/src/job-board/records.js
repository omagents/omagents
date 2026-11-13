export const EXECUTION_STATES = Object.freeze([
  "running",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
])

export const TERMINAL_STATES = Object.freeze(["completed", "failed", "cancelled", "interrupted"])

const TERMINAL_STATE_SET = new Set(TERMINAL_STATES)

export function assertTerminalState(state) {
  if (!TERMINAL_STATE_SET.has(state)) {
    throw new RangeError(`Invalid terminal state: ${state}`)
  }
}

export function isTerminalState(state) {
  return TERMINAL_STATE_SET.has(state)
}

export function createJobRecord(launch, { id, alias, timestamp }) {
  return {
    id,
    host: launch.host,
    hostTaskId: launch.hostTaskId,
    parentSessionId: launch.parentSessionId,
    ...(launch.childName !== undefined ? { childName: launch.childName } : {}),
    alias,
    agent: launch.agent || "unknown",
    description: launch.description || "(no description)",
    executionState: "running",
    launchedAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  }
}
