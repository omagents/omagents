function selectJobs(board, scope) {
  if (typeof scope === "string") return board.list({ parentSessionId: scope })
  return board.list(scope || {})
}

function elapsedSeconds(job, now) {
  const end = job.terminalAt ?? now
  return Math.max(0, Math.round((end - job.launchedAt) / 1000))
}

function formatTableCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
}

function formatError(error) {
  if (typeof error === "string") return error
  return JSON.stringify(error)
}

export function buildParallelStatus(board, scope) {
  const jobs = selectJobs(board, scope)
  const now = board.now()
  const counts = {
    running: 0,
    cancelling: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    interrupted: 0,
  }

  for (const job of jobs) counts[job.executionState] += 1

  return {
    revision: board.revision,
    total: jobs.length,
    ...counts,
    pendingOutcomes: jobs.filter((job) => job.notificationState === "pending").length,
    ...(jobs.length === 0 ? { message: "No background tasks found." } : {}),
    tasks: jobs.map((job) => ({
      ...job,
      elapsedSeconds: elapsedSeconds(job, now),
    })),
  }
}

export function buildJobBoardContext(board, parentSessionId) {
  const jobs = board.list({ parentSessionId })
  const active = jobs.filter(
    (job) => job.executionState === "running" || job.executionState === "cancelling"
  )
  const pending = board.listPendingOutcomes(parentSessionId)

  if (active.length === 0 && pending.length === 0) return ""

  const lines = [
    "### Background Job Board",
    "SENTINEL: omagents-job-board-v1",
    "Do not poll running jobs. Wait for hook-driven completion notifications.",
    "",
  ]

  if (active.length > 0) {
    lines.push("#### Running")
    for (const job of active) {
      lines.push(`- ${job.alias} / ${job.id} / ${job.agent} / ${job.executionState}`)
      lines.push(`  Objective: ${job.description}`)
    }
    lines.push("")
  }

  if (pending.length > 0) {
    lines.push("#### Pending outcomes")
    for (const job of pending) {
      lines.push(`- ${job.alias} / ${job.id} / ${job.agent} / ${job.executionState}`)
      lines.push(`  Objective: ${job.description}`)
      if (job.resultSummary !== undefined) {
        lines.push(`  Result: ${String(job.resultSummary).slice(0, 500)}`)
      }
      if (job.error !== undefined) lines.push(`  Error: ${formatError(job.error)}`)
    }
    lines.push("", "Acknowledge completed jobs before your final response.")
  }

  return lines.join("\n")
}

export function buildPsText(board, scope) {
  const status = buildParallelStatus(board, scope)
  if (status.total === 0) return "No background tasks."

  const lines = [
    "| Alias | Agent | Status | Elapsed | Description |",
    "| --- | --- | --- | ---: | --- |",
  ]

  for (const job of status.tasks) {
    lines.push(
      `| ${formatTableCell(job.alias)} | ${formatTableCell(job.agent)} | ${job.executionState} | ${job.elapsedSeconds}s | ${formatTableCell(job.description)} |`
    )
  }

  return lines.join("\n")
}
