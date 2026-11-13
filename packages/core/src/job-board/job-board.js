import { randomUUID } from "node:crypto"

import { validateJobSnapshot } from "../storage/schema.js"
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

function recoveryError(kind, reason) {
  return {
    code: kind === "missing" ? "HOST_MISSING" : "HOST_UNREADABLE",
    message: typeof reason === "string" ? reason : JSON.stringify(reason),
  }
}

export class JobBoard {
  #clock
  #idGenerator
  #store
  #jobs = new Map()
  #hostTaskIndex = new Map()
  #aliases = new Map()
  #listeners = new Set()
  #revision = 0
  #aliasCounter = 0
  #closed = false
  #closePromise
  #observedWrites = Promise.resolve()
  #persistenceFailure
  #persistenceDiagnostics = []

  constructor({ clock, idGenerator, store } = {}) {
    this.#clock = normalizeClock(clock)
    this.#idGenerator = idGenerator || randomUUID
    this.#store = store
  }

  static async open({ store, clock, idGenerator } = {}) {
    if (typeof store?.load !== "function") {
      throw new TypeError("store must provide load()")
    }
    const snapshot = validateJobSnapshot(await store.load())
    const board = new JobBoard({ clock, idGenerator, store })
    board.#restore(snapshot)
    return board
  }

  get revision() {
    return this.#revision
  }

  get diagnostics() {
    const storeDiagnostics = this.#store?.diagnostics ?? []
    const storeCauses = new Set(storeDiagnostics.map((diagnostic) => diagnostic.cause))
    return [...storeDiagnostics, ...this.#persistenceDiagnostics]
      .filter(
        (diagnostic, index) => index < storeDiagnostics.length || !storeCauses.has(diagnostic.cause)
      )
      .map((diagnostic) => ({ ...diagnostic }))
  }

  now() {
    return this.#clock()
  }

  registerLaunch(launch) {
    this.#assertOpen()
    const key = hostTaskKey(launch.host, launch.hostTaskId)
    const existingId = this.#hostTaskIndex.get(key)
    if (existingId !== undefined) return this.#jobs.get(existingId)

    const timestamp = this.now()
    const id = this.#idGenerator()
    if (this.#jobs.has(id) || this.#aliases.has(id)) {
      throw new Error(`Duplicate job ID: ${id}`)
    }

    const alias = this.#nextAlias(launch.agent)
    const job = createJobRecord(launch, { id, alias, timestamp })
    this.#jobs.set(id, job)
    this.#hostTaskIndex.set(key, id)
    this.#aliases.set(alias, id)
    this.#commit(job, timestamp)
    return job
  }

  requestCancellation(idOrAlias) {
    this.#assertOpen()
    const job = this.#find(idOrAlias)
    if (!job || job.executionState !== "running") return job

    const timestamp = this.now()
    job.executionState = "cancelling"
    job.cancelRequestedAt = timestamp
    this.#commit(job, timestamp)
    return job
  }

  markTerminal(idOrAlias, { state, resultSummary, error }) {
    this.#assertOpen()
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
    this.#assertOpen()
    for (const id of ids) {
      const job = this.#find(id)
      if (job?.notificationState !== "pending") continue

      job.notificationState = "injected"
      this.#commit(job)
    }
  }

  acknowledgeInjected(parentSessionId) {
    this.#assertOpen()
    for (const job of this.list({ parentSessionId })) {
      if (job.notificationState !== "injected") continue

      job.notificationState = "acknowledged"
      this.#commit(job)
    }
  }

  async reconcile({ query } = {}) {
    this.#assertOpen()
    if (typeof query !== "function") throw new TypeError("query must be a function")
    const activeJobs = this.list().filter(
      (job) => job.executionState === "running" || job.executionState === "cancelling"
    )

    for (const job of activeJobs) {
      const outcome = await query(job)
      if (outcome?.kind === "active") continue

      if (outcome?.kind === "terminal") {
        this.markTerminal(job.id, outcome)
        continue
      }

      if (outcome?.kind === "missing" || outcome?.kind === "unreadable") {
        this.markTerminal(job.id, {
          state: "interrupted",
          error: recoveryError(outcome.kind, outcome.reason),
        })
        continue
      }

      throw new TypeError(`Invalid reconciliation outcome for job ${job.id}`)
    }

    await this.flush()
  }

  prune({ maxAcknowledged = 100 } = {}) {
    this.#assertOpen()
    if (!Number.isInteger(maxAcknowledged) || maxAcknowledged < 0) {
      throw new RangeError("maxAcknowledged must be a non-negative integer")
    }

    const eligible = this.list()
      .filter(
        (job) => isTerminalState(job.executionState) && job.notificationState === "acknowledged"
      )
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt ||
          right.revision - left.revision ||
          left.id.localeCompare(right.id)
      )
    const removed = eligible.slice(maxAcknowledged).reverse()
    if (removed.length === 0) return removed

    for (const job of removed) {
      this.#jobs.delete(job.id)
      this.#aliases.delete(job.alias)
      this.#hostTaskIndex.delete(hostTaskKey(job.host, job.hostTaskId))
    }

    this.#revision += 1
    this.#persist()
    for (const listener of [...this.#listeners]) listener({ revision: this.#revision })
    return removed
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

  async flush() {
    await this.#observedWrites
    try {
      await this.#store?.flush()
    } catch (error) {
      this.#recordPersistenceFailure(error, "flush")
    }
    if (this.#persistenceFailure) throw this.#persistenceFailure
  }

  close() {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    this.#closePromise = (async () => {
      try {
        await this.#store?.close()
      } catch (error) {
        this.#recordPersistenceFailure(error, "close")
      }
      await this.#observedWrites
      if (this.#persistenceFailure) throw this.#persistenceFailure
    })()
    return this.#closePromise
  }

  #assertOpen() {
    if (this.#closed) throw new Error("JobBoard is closed")
  }

  #restore(snapshot) {
    this.#revision = snapshot.revision
    for (const restored of snapshot.jobs) {
      const job = structuredClone(restored)
      this.#jobs.set(job.id, job)
      this.#hostTaskIndex.set(hostTaskKey(job.host, job.hostTaskId), job.id)
      this.#aliases.set(job.alias, job.id)
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

    this.#persist()
    for (const listener of [...this.#listeners]) {
      listener({ revision: this.#revision, jobId: job.id })
    }
  }

  #persist() {
    if (!this.#store) return

    try {
      const snapshot = {
        version: 1,
        revision: this.#revision,
        jobs: structuredClone(this.list()),
      }
      const observed = Promise.resolve(this.#store.save(snapshot)).catch((error) => {
        this.#recordPersistenceFailure(error, "save")
      })
      this.#observedWrites = Promise.all([this.#observedWrites, observed]).then(() => {})
    } catch (error) {
      this.#recordPersistenceFailure(error, "save")
    }
  }

  #recordPersistenceFailure(error, operation) {
    this.#persistenceFailure ??= error
    if (
      operation !== "save" &&
      this.#persistenceDiagnostics.some((diagnostic) => diagnostic.cause === error)
    ) {
      return
    }
    this.#persistenceDiagnostics.push({
      code: "ERR_JOB_BOARD_PERSIST",
      operation,
      message: `Job board persistence ${operation} failure: ${error.message}`,
      cause: error,
    })
  }
}
