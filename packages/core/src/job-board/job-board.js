import { randomUUID } from "node:crypto"

import { assertTerminalState, createJobRecord, isTerminalState } from "./records.js"

function normalizeClock(clock) {
  if (clock === undefined) return Date.now
  if (typeof clock === "function") return clock
  if (typeof clock?.now === "function") return () => clock.now()
  throw new TypeError("clock must be a function or an object with now()")
}

function hostTaskKey(host, hostTaskId) {
  return JSON.stringify([host, hostTaskId])
}

export class JobBoard {
  #clock
  #idGenerator
  #jobs = new Map()
  #hostTaskIndex = new Map()
  #aliases = new Map()
  #listeners = new Set()
  #revision = 0
  #aliasCounter = 0

  constructor({ clock, idGenerator } = {}) {
    this.#clock = normalizeClock(clock)
    this.#idGenerator = idGenerator || randomUUID
  }

  get revision() {
    return this.#revision
  }

  now() {
    return this.#clock()
  }

  registerLaunch(launch) {
    const key = hostTaskKey(launch.host, launch.hostTaskId)
    const existingId = this.#hostTaskIndex.get(key)
    if (existingId !== undefined) return this.#jobs.get(existingId)

    const timestamp = this.now()
    const id = this.#idGenerator()
    if (this.#jobs.has(id)) throw new Error(`Duplicate job ID: ${id}`)

    const alias = this.#nextAlias(launch.agent)
    const job = createJobRecord(launch, { id, alias, timestamp })
    this.#jobs.set(id, job)
    this.#hostTaskIndex.set(key, id)
    this.#aliases.set(alias, id)
    this.#commit(job, timestamp)
    return job
  }

  requestCancellation(idOrAlias) {
    const job = this.#find(idOrAlias)
    if (!job || job.executionState !== "running") return job

    const timestamp = this.now()
    job.executionState = "cancelling"
    job.cancelRequestedAt = timestamp
    this.#commit(job, timestamp)
    return job
  }

  markTerminal(idOrAlias, { state, resultSummary, error }) {
    assertTerminalState(state)
    const job = this.#find(idOrAlias)
    if (!job || isTerminalState(job.executionState)) return job

    const timestamp = this.now()
    job.executionState = state
    job.notificationState = "pending"
    if (resultSummary !== undefined) job.resultSummary = resultSummary
    if (error !== undefined) job.error = error
    job.terminalAt = timestamp
    this.#commit(job, timestamp)
    return job
  }

  markInjected(ids) {
    for (const id of ids) {
      const job = this.#find(id)
      if (job?.notificationState !== "pending") continue

      job.notificationState = "injected"
      this.#commit(job)
    }
  }

  acknowledgeInjected(parentSessionId) {
    for (const job of this.list({ parentSessionId })) {
      if (job.notificationState !== "injected") continue

      job.notificationState = "acknowledged"
      this.#commit(job)
    }
  }

  get(idOrAlias) {
    return this.#find(idOrAlias)
  }

  list({ parentSessionId } = {}) {
    const jobs = [...this.#jobs.values()]
    if (parentSessionId === undefined) return jobs
    return jobs.filter((job) => job.parentSessionId === parentSessionId)
  }

  listPendingOutcomes(parentSessionId) {
    return this.list({ parentSessionId }).filter((job) => job.notificationState === "pending")
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function")
    this.#listeners.add(listener)
    let subscribed = true

    return () => {
      if (!subscribed) return
      subscribed = false
      this.#listeners.delete(listener)
    }
  }

  #find(idOrAlias) {
    const id = this.#aliases.get(idOrAlias) ?? idOrAlias
    return this.#jobs.get(id)
  }

  #nextAlias(agent) {
    const prefix = (agent || "task").slice(0, 3)
    let alias
    do {
      this.#aliasCounter += 1
      alias = `${prefix}-${this.#aliasCounter}`
    } while (this.#aliases.has(alias) || this.#jobs.has(alias))
    return alias
  }

  #commit(job, timestamp = this.now()) {
    this.#revision += 1
    job.revision = this.#revision
    job.updatedAt = timestamp

    for (const listener of [...this.#listeners]) {
      listener({ revision: this.#revision, jobId: job.id })
    }
  }
}
