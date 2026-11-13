import { EXECUTION_STATES, isTerminalState } from "../job-board/records.js"

const EXECUTION_STATE_SET = new Set(EXECUTION_STATES)
const NOTIFICATION_STATE_SET = new Set(["pending", "injected", "acknowledged"])

function invalid(message) {
  throw new TypeError(`Invalid job snapshot: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireString(job, field, index, { optional = false } = {}) {
  const value = job[field]
  if (optional && value === undefined) return
  if (typeof value !== "string" || value.length === 0) {
    invalid(`jobs[${index}].${field} must be a non-empty string`)
  }
}

function requireTimestamp(job, field, index, { optional = false } = {}) {
  const value = job[field]
  if (optional && value === undefined) return
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`jobs[${index}].${field} must be a finite number`)
  }
}

function validateJob(job, index) {
  if (!isObject(job)) invalid(`jobs[${index}] must be an object`)

  for (const field of [
    "id",
    "host",
    "hostTaskId",
    "parentSessionId",
    "alias",
    "agent",
    "description",
  ]) {
    requireString(job, field, index)
  }
  requireString(job, "childName", index, { optional: true })
  requireString(job, "resultSummary", index, { optional: true })

  if (!EXECUTION_STATE_SET.has(job.executionState)) {
    invalid(`jobs[${index}].executionState is invalid: ${job.executionState}`)
  }

  requireTimestamp(job, "launchedAt", index)
  requireTimestamp(job, "updatedAt", index)
  requireTimestamp(job, "cancelRequestedAt", index, { optional: true })
  requireTimestamp(job, "terminalAt", index, { optional: true })

  if (!Number.isInteger(job.revision) || job.revision < 0) {
    invalid(`jobs[${index}].revision must be a non-negative integer`)
  }

  if (isTerminalState(job.executionState)) {
    if (!NOTIFICATION_STATE_SET.has(job.notificationState)) {
      invalid(`jobs[${index}].notificationState is invalid for a terminal job`)
    }
    requireTimestamp(job, "terminalAt", index)
  } else if (job.notificationState !== undefined) {
    invalid(`jobs[${index}].notificationState is only valid for a terminal job`)
  }
}

export function emptyJobSnapshot() {
  return { version: 1, revision: 0, jobs: [] }
}

export function validateJobSnapshot(snapshot) {
  if (!isObject(snapshot)) invalid("snapshot must be an object")
  if (snapshot.version !== 1) invalid(`unsupported version: ${snapshot.version}`)
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) {
    invalid("revision must be a non-negative integer")
  }
  if (!Array.isArray(snapshot.jobs)) invalid("jobs must be an array")

  const names = new Set()
  const hostTasks = new Set()
  let maximumJobRevision = 0

  for (const [index, job] of snapshot.jobs.entries()) {
    validateJob(job, index)

    if (names.has(job.id)) invalid(`duplicate job ID or alias: ${job.id}`)
    names.add(job.id)
    if (names.has(job.alias)) invalid(`duplicate job ID or alias: ${job.alias}`)
    names.add(job.alias)

    const hostTask = JSON.stringify([job.host, job.hostTaskId])
    if (hostTasks.has(hostTask)) invalid(`duplicate host task: ${hostTask}`)
    hostTasks.add(hostTask)
    maximumJobRevision = Math.max(maximumJobRevision, job.revision)
  }

  if (snapshot.revision < maximumJobRevision) {
    invalid("revision must be greater than or equal to every job revision")
  }

  return snapshot
}
