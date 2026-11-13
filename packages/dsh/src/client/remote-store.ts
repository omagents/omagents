import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol"

import type { HealthDto, JobDto, JobScope, JobWatchFrame } from "../host/remote-types.js"

export interface OmAgentsJobRemote {
  listJobs(scope: JobScope): Promise<RemoteResult<JobDto[]>>
  getHealth(): Promise<RemoteResult<HealthDto>>
  cancelJob(jobId: string): Promise<RemoteResult<JobDto>>
  watchJobs(scope: JobScope, signal: AbortSignal): AsyncIterable<JobWatchFrame>
}

export interface JobBoardScheduler {
  setInterval(callback: () => void, milliseconds: number): unknown
  clearInterval(handle: unknown): void
  setTimeout(callback: () => void, milliseconds: number): unknown
  clearTimeout(handle: unknown): void
}

export interface JobBoardStoreOptions {
  scope?: JobScope
  now?: () => number
  scheduler?: JobBoardScheduler
  tickIntervalMs?: number
  reconnectDelayMs?: number
}

export type JobBoardConnectionStatus = "loading" | "ready" | "stale" | "permission-denied" | "error"

export interface JobBoardSnapshot {
  readonly jobs: readonly JobDto[]
  readonly revision: number
  readonly status: JobBoardConnectionStatus
  readonly health?: HealthDto | undefined
  readonly now: number
  readonly cancellingIds: readonly string[]
  readonly error?: string | undefined
  readonly actionError?: string | undefined
  readonly lastUpdatedAt?: number | undefined
}

export interface JobBoardStore {
  getSnapshot(): JobBoardSnapshot
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  reconnect(): Promise<void>
  cancelJob(jobId: string): Promise<void>
  clearActionError(): void
  dispose(): void
}

interface ActiveWatch {
  readonly controller: AbortController
  readonly iterator: AsyncIterator<JobWatchFrame>
}

const systemScheduler: JobBoardScheduler = {
  setInterval(callback, milliseconds) {
    return globalThis.setInterval(callback, milliseconds)
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>)
  },
  setTimeout(callback, milliseconds) {
    return globalThis.setTimeout(callback, milliseconds)
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
  },
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = Reflect.get(error, "message")
    if (typeof message === "string" && message.length > 0) return message
  }
  return String(error)
}

function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Reflect.get(error, "code") === "remote-access/denied"
  )
}

function isTerminalExecutionState(state: JobDto["executionState"]): boolean {
  return (
    state === "completed" || state === "failed" || state === "cancelled" || state === "interrupted"
  )
}

class RemoteJobBoardStore implements JobBoardStore {
  private readonly remote: OmAgentsJobRemote
  private readonly scope: JobScope
  private readonly readNow: () => number
  private readonly scheduler: JobBoardScheduler
  private readonly tickIntervalMs: number
  private readonly reconnectDelayMs: number
  private readonly listeners = new Set<() => void>()
  private readonly cancellations = new Map<string, Promise<void>>()
  private snapshot: JobBoardSnapshot
  private running = false
  private disposed = false
  private watch: ActiveWatch | undefined
  private generation = 0
  private watchMutation = 0
  private tickHandle: unknown
  private reconnectHandle: unknown

  constructor(remote: OmAgentsJobRemote, options: JobBoardStoreOptions) {
    this.remote = remote
    this.scope = options.scope ?? {}
    this.readNow = options.now ?? Date.now
    this.scheduler = options.scheduler ?? systemScheduler
    this.tickIntervalMs = options.tickIntervalMs ?? 1_000
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000
    this.snapshot = {
      jobs: [],
      revision: 0,
      status: "loading",
      now: this.readNow(),
      cancellingIds: [],
    }
  }

  getSnapshot(): JobBoardSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    if (!this.running) {
      queueMicrotask(() => {
        if (!this.disposed && !this.running && this.listeners.size > 0) this.start()
      })
    }
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  async refresh(): Promise<void> {
    if (this.disposed) return
    const watchMutation = this.watchMutation
    try {
      const [listed, health] = await Promise.all([
        this.remote.listJobs(this.scope),
        this.remote.getHealth(),
      ])
      if (this.disposed || watchMutation !== this.watchMutation) return
      if (!listed.ok) {
        this.applyReadFailure(listed.error)
        return
      }
      if (!health.ok && isPermissionDenied(health.error)) {
        this.applyReadFailure(health.error)
        return
      }
      this.publish({
        ...this.snapshot,
        jobs: listed.value,
        health: health.ok ? health.value : this.snapshot.health,
        status: "ready",
        error: undefined,
        lastUpdatedAt: this.readNow(),
      })
    } catch (error) {
      if (!this.disposed && watchMutation === this.watchMutation) {
        this.applyReadFailure(error)
      }
    }
  }

  async reconnect(): Promise<void> {
    if (this.disposed) return
    this.clearReconnect()
    if (!this.running) {
      this.start()
      return
    }
    this.openWatch()
  }

  cancelJob(jobId: string): Promise<void> {
    const existing = this.cancellations.get(jobId)
    if (existing) return existing
    const cancellation = this.performCancellation(jobId)
    this.cancellations.set(jobId, cancellation)
    return cancellation
  }

  clearActionError(): void {
    if (this.snapshot.actionError === undefined) return
    this.publish({ ...this.snapshot, actionError: undefined })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.listeners.clear()
  }

  private async performCancellation(jobId: string): Promise<void> {
    const watchMutation = this.watchMutation
    this.publish({
      ...this.snapshot,
      cancellingIds: [...this.snapshot.cancellingIds, jobId],
      actionError: undefined,
    })
    try {
      const result = await this.remote.cancelJob(jobId)
      if (this.disposed || watchMutation !== this.watchMutation) return
      if (!result.ok) {
        if (isPermissionDenied(result.error)) this.applyReadFailure(result.error)
        else this.publish({ ...this.snapshot, actionError: errorMessage(result.error) })
        return
      }
      const currentJob = this.snapshot.jobs.find((job) => job.id === jobId)
      if (!currentJob || result.value.id !== jobId) return
      if (result.value.revision < currentJob.revision) return
      if (
        isTerminalExecutionState(currentJob.executionState) &&
        !isTerminalExecutionState(result.value.executionState)
      ) {
        return
      }
      const jobs = this.snapshot.jobs.map((job) =>
        job.id === result.value.id ? result.value : job
      )
      this.publish({ ...this.snapshot, jobs, lastUpdatedAt: this.readNow() })
    } catch (error) {
      if (!this.disposed && watchMutation === this.watchMutation) {
        if (isPermissionDenied(error)) this.applyReadFailure(error)
        else this.publish({ ...this.snapshot, actionError: errorMessage(error) })
      }
    } finally {
      this.cancellations.delete(jobId)
      if (!this.disposed) {
        this.publish({
          ...this.snapshot,
          cancellingIds: this.snapshot.cancellingIds.filter((id) => id !== jobId),
        })
      }
    }
  }

  private start(): void {
    if (this.disposed || this.running) return
    this.running = true
    this.tickHandle = this.scheduler.setInterval(() => {
      this.publish({ ...this.snapshot, now: this.readNow() })
    }, this.tickIntervalMs)
    this.openWatch()
  }

  private stop(): void {
    this.running = false
    this.generation += 1
    if (this.tickHandle !== undefined) {
      this.scheduler.clearInterval(this.tickHandle)
      this.tickHandle = undefined
    }
    this.clearReconnect()
    this.closeWatch()
  }

  private openWatch(): void {
    if (!this.running || this.disposed) return
    this.generation += 1
    const generation = this.generation
    this.closeWatch()
    const controller = new AbortController()
    const hasSnapshot = this.snapshot.lastUpdatedAt !== undefined
    this.publish({
      ...this.snapshot,
      status: hasSnapshot ? "stale" : "loading",
      error: undefined,
      now: this.readNow(),
    })
    try {
      const iterable = this.remote.watchJobs(this.scope, controller.signal)
      const watch: ActiveWatch = {
        controller,
        iterator: iterable[Symbol.asyncIterator](),
      }
      this.watch = watch
      void this.consumeWatch(watch, generation)
    } catch (error) {
      this.handleWatchFailure(error, generation, hasSnapshot)
    }
  }

  private async consumeWatch(watch: ActiveWatch, generation: number): Promise<void> {
    let baseline = true
    let hasSnapshot = this.snapshot.lastUpdatedAt !== undefined
    try {
      while (this.watch === watch && this.generation === generation) {
        const next = await watch.iterator.next()
        if (this.watch !== watch || this.generation !== generation) return
        if (next.done) {
          throw new Error("The OmAgents Job Board watch ended unexpectedly")
        }
        if (!baseline && next.value.revision < this.snapshot.revision) continue
        const isBaseline = baseline
        this.applyFrame(next.value)
        baseline = false
        hasSnapshot = true
        if (isBaseline && this.watch === watch && this.generation === generation) {
          void this.loadHealth(generation, this.watchMutation)
        }
      }
    } catch (error) {
      if (
        this.watch !== watch ||
        this.generation !== generation ||
        watch.controller.signal.aborted
      ) {
        return
      }
      this.watch = undefined
      this.handleWatchFailure(error, generation, hasSnapshot)
    }
  }

  private applyFrame(frame: JobWatchFrame): void {
    this.watchMutation += 1
    this.publish({
      ...this.snapshot,
      jobs: frame.jobs,
      revision: frame.revision,
      status: "ready",
      error: undefined,
      lastUpdatedAt: this.readNow(),
      now: this.readNow(),
    })
  }

  private async loadHealth(generation: number, watchMutation: number): Promise<void> {
    try {
      const result = await this.remote.getHealth()
      if (this.disposed || this.generation !== generation || this.watchMutation !== watchMutation) {
        return
      }
      if (result.ok) {
        this.publish({ ...this.snapshot, health: result.value })
      } else if (isPermissionDenied(result.error)) {
        this.applyReadFailure(result.error)
      }
    } catch {
      // Watch data remains authoritative when an independent health read is unavailable.
    }
  }

  private handleWatchFailure(error: unknown, generation: number, hasSnapshot: boolean): void {
    if (this.disposed || this.generation !== generation) return
    if (isPermissionDenied(error)) {
      this.enterPermissionDenied(error)
      return
    }
    this.publish({
      ...this.snapshot,
      status: hasSnapshot ? "stale" : "error",
      error: errorMessage(error),
    })
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectHandle !== undefined) return
    const generation = this.generation
    const handle = this.scheduler.setTimeout(() => {
      if (this.reconnectHandle !== handle) return
      this.reconnectHandle = undefined
      if (
        !this.running ||
        this.disposed ||
        this.generation !== generation ||
        this.snapshot.status === "permission-denied"
      ) {
        return
      }
      this.openWatch()
    }, this.reconnectDelayMs)
    this.reconnectHandle = handle
  }

  private enterPermissionDenied(error: unknown): void {
    this.clearReconnect()
    this.generation += 1
    this.watchMutation += 1
    this.closeWatch()
    this.publish({
      ...this.snapshot,
      jobs: [],
      status: "permission-denied",
      error: errorMessage(error),
    })
  }

  private applyReadFailure(error: unknown): void {
    if (isPermissionDenied(error)) {
      this.enterPermissionDenied(error)
      return
    }
    this.publish({
      ...this.snapshot,
      status: this.snapshot.lastUpdatedAt === undefined ? "error" : this.snapshot.status,
      error: errorMessage(error),
      actionError: errorMessage(error),
    })
  }

  private closeWatch(): void {
    const watch = this.watch
    this.watch = undefined
    if (!watch) return
    watch.controller.abort()
    if (watch.iterator.return) {
      void watch.iterator.return().catch(() => {
        // Disposal is best-effort after the transport has already failed.
      })
    }
  }

  private clearReconnect(): void {
    if (this.reconnectHandle === undefined) return
    this.scheduler.clearTimeout(this.reconnectHandle)
    this.reconnectHandle = undefined
  }

  private publish(next: JobBoardSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

/**
 * Create the browser's ephemeral view of the authorized Host Board. Frames are
 * whole-set replacements; only elapsed time and reconnect timing are local.
 */
export function createJobBoardStore(
  remote: OmAgentsJobRemote,
  options: JobBoardStoreOptions = {}
): JobBoardStore {
  return new RemoteJobBoardStore(remote, options)
}
