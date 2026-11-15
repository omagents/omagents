import type { Context } from "@deepseek-ai/cordis"
import {
  Remote,
  TypertRemoteService,
} from "@deepseek-ai/dsh-typert-protocol"

import type { DshHealth } from "./health.js"
import {
  badJobRequest,
  cancellationFailed,
  jobNotFound,
  scopeDenied,
  type AuthorizeScope,
} from "./remote-access.js"
import type {
  HealthDto,
  JobDto,
  JobScope,
  JobWatchFrame,
} from "./remote-types.js"
import type { DshJobBoard, DshJobRecord } from "./runtime.js"
import type { DshSubagentTracker } from "./subagent-tracker.js"

export interface OmAgentsRemoteOptions {
  board: DshJobBoard
  tracker: DshSubagentTracker
  health: DshHealth
  authorizeScope: AuthorizeScope
}

function normalizeScope(scope: JobScope): JobScope {
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
    throw badJobRequest("scope", "scope must be an object")
  }
  if (Object.keys(scope).some((key) => key !== "parentSessionId")) {
    throw badJobRequest("scope", "scope accepts only parentSessionId")
  }
  const { parentSessionId } = scope
  if (
    parentSessionId !== undefined &&
    (typeof parentSessionId !== "string" || parentSessionId.length === 0)
  ) {
    throw badJobRequest("scope.parentSessionId", "parentSessionId must be a non-empty string")
  }
  return parentSessionId === undefined ? {} : { parentSessionId }
}

function normalizeJobId(jobId: string): string {
  if (typeof jobId !== "string" || jobId.length === 0) {
    throw badJobRequest("jobId", "jobId must be a non-empty string")
  }
  return jobId
}

function cloneJob(job: DshJobRecord): JobDto {
  return structuredClone(job)
}

/** A single pending slot coalesces bursts without ever withholding the newest frame. */
class LatestFrameQueue {
  private latest: JobWatchFrame | undefined
  private failure: { error: unknown } | undefined
  private wake: (() => void) | undefined
  private closed = false

  push(frame: JobWatchFrame): void {
    if (this.closed) return
    this.latest = frame
    this.notify()
  }

  fail(error: unknown): void {
    if (this.closed) return
    this.failure = { error }
    this.latest = undefined
    this.notify()
  }

  discardThrough(revision: number): void {
    if (this.latest && this.latest.revision <= revision) this.latest = undefined
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.latest = undefined
    this.notify()
  }

  async take(): Promise<JobWatchFrame | undefined> {
    while (!this.closed && !this.latest && !this.failure) {
      let wake!: () => void
      const waiting = new Promise<void>((resolve) => {
        wake = resolve
      })
      this.wake = wake
      await waiting
      if (this.wake === wake) this.wake = undefined
    }
    if (this.failure) throw this.failure.error
    if (this.closed) return undefined
    const frame = this.latest
    this.latest = undefined
    return frame
  }

  private notify(): void {
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }
}

/** Authorized Remote face of the active profile's Core Board. */
export class OmAgentsRemote extends TypertRemoteService {
  private readonly board: DshJobBoard
  private readonly tracker: DshSubagentTracker
  private readonly health: DshHealth
  private readonly authorizeScope: AuthorizeScope
  private readonly lifetime = new AbortController()

  constructor(ctx: Context, options: OmAgentsRemoteOptions) {
    // Keep the wire namespace distinct from the runtime's ctx.omagents service key.
    super(ctx, "omagentsRemote", { namespace: "omagents" })
    this.board = options.board
    this.tracker = options.tracker
    this.health = options.health
    this.authorizeScope = options.authorizeScope
    ctx.effect(() => () => this.lifetime.abort(), "omagents Remote watch streams")
  }

  @Remote
  async listJobs(scope: JobScope): Promise<JobDto[]> {
    const normalized = normalizeScope(scope)
    this.assertAuthorized(normalized, "omagents/listJobs", "session-scope-unauthorized")
    await this.reconcile(normalized)
    return this.readJobs(normalized)
  }

  @Remote
  async cancelJob(jobId: string): Promise<JobDto> {
    const normalized = normalizeJobId(jobId)
    const job = this.board.get(normalized)
    if (!job) throw jobNotFound(normalized)
    this.assertAuthorized(
      { parentSessionId: job.parentSessionId },
      "omagents/cancelJob",
      "job-unauthorized"
    )

    if (job.executionState === "running") {
      try {
        await this.tracker.cancel(job)
      } catch (error) {
        throw cancellationFailed(job.id, error)
      }
    }
    const current = this.board.get(job.id)
    if (!current) throw jobNotFound(normalized)
    return cloneJob(current)
  }

  @Remote
  getHealth(): HealthDto {
    return structuredClone(this.health)
  }

  @Remote({ mode: "stream" })
  watchJobs(scope: JobScope, signal: AbortSignal): AsyncIterable<JobWatchFrame> {
    return {
      [Symbol.asyncIterator]: () => {
        let close = () => {}
        const iterator = this.streamJobs(scope, signal, (closeStream) => {
          close = closeStream
        })[Symbol.asyncIterator]()
        return {
          next: () => iterator.next(),
          return: async () => {
            // AsyncGenerator return() is queued behind a pending next(). Close
            // first so that next can finish and the queued return can settle.
            close()
            return iterator.return(undefined)
          },
          throw: async (error?: unknown) => {
            close()
            return iterator.throw(error)
          },
        }
      },
    }
  }

  private async *streamJobs(
    scope: JobScope,
    signal: AbortSignal,
    registerClose: (close: () => void) => void
  ): AsyncGenerator<JobWatchFrame, void, unknown> {
    const normalized = normalizeScope(scope)
    this.assertAuthorized(normalized, "omagents/watchJobs", "session-scope-unauthorized")
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    if (lifetime.aborted) return

    const queue = new LatestFrameQueue()
    let closed = false
    // Subscribe before reconciliation and the baseline. The pending slot retains
    // any commit racing the baseline, while discardThrough suppresses stale duplicates.
    const unsubscribe = this.board.subscribe(() => {
      try {
        queue.push(this.frame(normalized))
      } catch (error) {
        queue.fail(error)
      }
    })
    const close = () => {
      closed = true
      queue.close()
      // An AsyncGenerator suspended at yield has no pending finally transition;
      // closure itself must still release the Core listener immediately.
      unsubscribe()
    }
    registerClose(close)
    lifetime.addEventListener("abort", close, { once: true })
    try {
      try {
        await this.reconcile(normalized)
      } catch (error) {
        // A consumer that already closed must not receive a late native failure.
        if (lifetime.aborted || closed) return
        throw error
      }
      if (lifetime.aborted || closed) return
      const baseline = this.frame(normalized)
      queue.discardThrough(baseline.revision)
      if (lifetime.aborted || closed) return
      yield baseline
      while (!lifetime.aborted && !closed) {
        const frame = await queue.take()
        if (!frame) return
        yield frame
      }
    } finally {
      lifetime.removeEventListener("abort", close)
      close()
    }
  }

  private async reconcile(scope: JobScope): Promise<void> {
    await this.board.reconcile({
      query: async (job) => {
        if (
          scope.parentSessionId !== undefined &&
          job.parentSessionId !== scope.parentSessionId
        ) {
          return { kind: "active" as const }
        }
        if (!this.authorizeScope(this.ctx, { parentSessionId: job.parentSessionId })) {
          return { kind: "active" as const }
        }
        return this.tracker.query(job)
      },
    })
  }

  private assertAuthorized(
    scope: JobScope,
    action: string,
    reason: "session-scope-unauthorized" | "job-unauthorized"
  ): void {
    if (!this.authorizeScope(this.ctx, scope)) throw scopeDenied(action, reason)
  }

  private readJobs(scope: JobScope): JobDto[] {
    return this.board
      .list(scope)
      .filter((job) =>
        this.authorizeScope(this.ctx, { parentSessionId: job.parentSessionId })
      )
      .map(cloneJob)
  }

  private frame(scope: JobScope): JobWatchFrame {
    return { revision: this.board.revision, jobs: this.readJobs(scope) }
  }
}
