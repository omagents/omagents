import { buildJobBoardContext, buildParallelStatus } from "../../core/src/index.js"

export function toLegacyExecutionState(job) {
  if (job.notificationState === "acknowledged") return "reconciled"
  if (job.executionState === "failed") return "error"
  return job.executionState
}

function serializeDiagnostic(diagnostic) {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.operation ? { operation: diagnostic.operation } : {}),
    ...(diagnostic.phase ? { phase: diagnostic.phase } : {}),
    ...(diagnostic.backupPath ? { backupPath: diagnostic.backupPath } : {}),
  }
}

export function buildLegacyParallelStatus(board, sessionId) {
  const scope = sessionId || undefined
  const status = buildParallelStatus(board, scope)
  const tasks = status.tasks.map((job) => ({
    ...job,
    task_id: job.hostTaskId,
    state: toLegacyExecutionState(job),
    elapsed_s: job.elapsedSeconds,
    result: job.resultSummary?.slice(0, 200),
  }))

  return {
    ...status,
    running: tasks.filter((job) => job.state === "running").length,
    completed: tasks.filter((job) => job.state === "completed" || job.state === "reconciled")
      .length,
    error: tasks.filter((job) => job.state === "error").length,
    tasks,
    diagnostics: board.diagnostics.map(serializeDiagnostic),
  }
}

export function buildOpenCodeJobBoardContext(board, parentSessionId) {
  let context = buildJobBoardContext(board, parentSessionId)
  for (const job of board.list({ parentSessionId })) {
    const coreLine = `- ${job.alias} / ${job.id} / ${job.agent} / ${job.executionState}`
    const legacyLine = `- ${job.alias} / ${job.hostTaskId} / ${job.agent} / ${toLegacyExecutionState(job)}`
    context = context.replace(coreLine, legacyLine)
  }
  return context
}

export function buildTuiState(board) {
  const now = board.now()
  const jobs = board.list().map((job) => ({
    alias: job.alias,
    agent: job.agent,
    description: job.description,
    state: toLegacyExecutionState(job),
    elapsed: Math.max(0, (job.terminalAt ?? now) - job.launchedAt),
  }))

  return {
    version: 1,
    updatedAt: now,
    running: jobs.filter((job) => job.state === "running").length,
    completed: jobs.filter((job) => job.state === "completed" || job.state === "reconciled").length,
    error: jobs.filter((job) => job.state === "error").length,
    jobs,
  }
}
