import { test } from "node:test"
import assert from "node:assert/strict"
import { mock } from "node:test"

import {
  createJobBoardStore,
  type JobBoardSnapshot,
  type OmAgentsJobRemote,
} from "../src/client/remote-store.ts"
import type { HealthDto, JobDto, JobWatchFrame } from "../src/host/remote-types.ts"

const readyHealth: HealthDto = {
  host: { status: "ready", diagnostics: [] },
  persistence: { status: "ready", diagnostics: [] },
  skills: { status: "ready", diagnostics: [] },
  mcp: { status: "ready", diagnostics: [] },
  python: { status: "ready", diagnostics: [] },
  tools: { status: "ready", diagnostics: [] },
  commands: { status: "ready", diagnostics: [] },
  context: { status: "ready", diagnostics: [] },
}

function job(id: string, patch: Partial<JobDto> = {}): JobDto {
  return {
    id,
    host: "dsh",
    hostTaskId: `child-${id}`,
    parentSessionId: "parent-1",
    childName: `worker-${id}`,
    alias: id,
    agent: "explore",
    description: `Task ${id}`,
    executionState: "running",
    notificationState: "pending",
    launchedAt: 1_000,
    updatedAt: 1_000,
    revision: 1,
    ...patch,
  }
}

function frame(revision: number, jobs: JobDto[]): JobWatchFrame {
  return { revision, jobs }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function watchChannel() {
  type Event =
    | { kind: "value"; value: JobWatchFrame }
    | { kind: "error"; error: unknown }
    | { kind: "end" }
  const events: Event[] = []
  let waiter:
    | {
        resolve: (result: IteratorResult<JobWatchFrame>) => void
        reject: (error: unknown) => void
      }
    | undefined
  let finished = false

  function drain() {
    if (!waiter) return
    const event = events.shift()
    if (!event && !finished) return
    const current = waiter
    waiter = undefined
    if (!event || event.kind === "end") current.resolve({ done: true, value: undefined })
    else if (event.kind === "error") current.reject(event.error)
    else current.resolve({ done: false, value: event.value })
  }

  const channel = {
    returned: 0,
    thrown: 0,
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<JobWatchFrame>> {
            return new Promise((resolve, reject) => {
              waiter = { resolve, reject }
              drain()
            })
          },
          async return(): Promise<IteratorResult<JobWatchFrame>> {
            channel.returned += 1
            finished = true
            events.length = 0
            drain()
            return { done: true, value: undefined }
          },
          async throw(error?: unknown): Promise<IteratorResult<JobWatchFrame>> {
            channel.thrown += 1
            finished = true
            events.length = 0
            waiter?.reject(error)
            waiter = undefined
            throw error
          },
        }
      },
    },
    push(value: JobWatchFrame) {
      events.push({ kind: "value", value })
      drain()
    },
    fail(error: unknown) {
      events.push({ kind: "error", error })
      drain()
    },
    end() {
      events.push({ kind: "end" })
      finished = true
      drain()
    },
  }
  return channel
}

function scheduler() {
  let now = 10_000
  let interval: (() => void) | undefined
  let timeout: (() => void) | undefined
  return {
    now: () => now,
    setInterval: mock.fn((callback: () => void) => {
      interval = callback
      return 1
    }),
    clearInterval: mock.fn(() => {
      interval = undefined
    }),
    setTimeout: mock.fn((callback: () => void) => {
      timeout = callback
      return 2
    }),
    clearTimeout: mock.fn(() => {
      timeout = undefined
    }),
    tick(milliseconds: number) {
      now += milliseconds
      interval?.()
    },
    reconnect() {
      const callback = timeout
      timeout = undefined
      callback?.()
    },
    get pendingReconnect() {
      return timeout !== undefined
    },
  }
}

function remoteFixture() {
  const channels: Array<ReturnType<typeof watchChannel>> = []
  const remote: OmAgentsJobRemote & {
    acknowledgeInjected: ReturnType<typeof mock.fn>
    channels: Array<ReturnType<typeof watchChannel>>
  } = {
    listJobs: mock.fn(async () => ({ ok: true as const, value: [] })),
    getHealth: mock.fn(async () => ({ ok: true as const, value: readyHealth })),
    cancelJob: mock.fn(async (id: string) => ({
      ok: true as const,
      value: job(id, { executionState: "cancelling", cancelRequestedAt: 2_000 }),
    })),
    watchJobs: mock.fn((_scope, _signal) => {
      const channel = watchChannel()
      channels.push(channel)
      return channel.iterable
    }),
    acknowledgeInjected: mock.fn(),
    channels,
  }
  return remote
}

async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function eventually(assertion: () => void) {
  let lastError: unknown
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await flush()
    }
  }
  throw lastError
}

function start(remote: OmAgentsJobRemote, timer = scheduler()) {
  const store = createJobBoardStore(remote, {
    scheduler: timer,
    now: timer.now,
    reconnectDelayMs: 25,
  })
  const snapshots: JobBoardSnapshot[] = []
  const unsubscribe = store.subscribe(() => snapshots.push(store.getSnapshot()))
  return { store, snapshots, timer, unsubscribe }
}

test("watch baselines and whole-set frames replace jobs without reads or acknowledgement", async () => {
  const remote = remoteFixture()
  const { store, timer, unsubscribe } = start(remote)
  await eventually(() => assert.equal(remote.watchJobs.mock.callCount(), 1))
  assert.equal(store.getSnapshot().status, "loading")

  remote.channels[0].push(frame(4, [job("one"), job("two")]))
  await eventually(() => assert.equal(store.getSnapshot().status, "ready"))
  assert.deepEqual(
    store.getSnapshot().jobs.map((item) => item.id),
    ["one", "two"],
  )
  assert.equal(store.getSnapshot().revision, 4)

  remote.channels[0].push(frame(5, [job("three")]))
  await eventually(() => assert.equal(store.getSnapshot().revision, 5))
  assert.deepEqual(
    store.getSnapshot().jobs.map((item) => item.id),
    ["three"],
  )
  assert.equal(remote.listJobs.mock.callCount(), 0)
  assert.equal(remote.acknowledgeInjected.mock.callCount(), 0)

  await flush()
  const callsBeforeTick = {
    watch: remote.watchJobs.mock.callCount(),
    list: remote.listJobs.mock.callCount(),
    health: remote.getHealth.mock.callCount(),
  }
  timer.tick(1_000)
  assert.equal(store.getSnapshot().now, 11_000)
  assert.equal(remote.watchJobs.mock.callCount(), callsBeforeTick.watch)
  assert.equal(remote.listJobs.mock.callCount(), callsBeforeTick.list)
  assert.equal(remote.getHealth.mock.callCount(), callsBeforeTick.health)
  unsubscribe()
  store.dispose()
})

test("a failed stream is stale, reconnects to a fresh baseline, and closes the replaced stream", async () => {
  const remote = remoteFixture()
  const { store, timer } = start(remote)
  await eventually(() => assert.equal(remote.channels.length, 1))
  remote.channels[0].push(frame(9, [job("before")]))
  await eventually(() => assert.equal(store.getSnapshot().status, "ready"))

  remote.channels[0].fail(new Error("carrier lost"))
  await eventually(() => assert.equal(store.getSnapshot().status, "stale"))
  assert.deepEqual(store.getSnapshot().jobs.map((item) => item.id), ["before"])
  assert.equal(timer.pendingReconnect, true)

  timer.reconnect()
  await eventually(() => assert.equal(remote.channels.length, 2))
  remote.channels[1].push(frame(2, [job("after")]))
  await eventually(() => assert.equal(store.getSnapshot().status, "ready"))
  assert.equal(store.getSnapshot().revision, 2)
  assert.deepEqual(store.getSnapshot().jobs.map((item) => item.id), ["after"])

  await store.reconnect()
  await eventually(() => assert.equal(remote.channels.length, 3))
  assert.ok(remote.channels[1].returned > 0)
  store.dispose()
  assert.ok(remote.channels[2].returned > 0)
})

test("permission failures do not reconnect or leak the previous authorized set", async () => {
  const remote = remoteFixture()
  const { store, timer } = start(remote)
  await eventually(() => assert.equal(remote.channels.length, 1))
  remote.channels[0].push(frame(1, [job("private")]))
  await eventually(() => assert.equal(store.getSnapshot().status, "ready"))
  remote.channels[0].fail({
    code: "remote-access/denied",
    message: "Not authorized for this session",
  })
  await eventually(() => assert.equal(store.getSnapshot().status, "permission-denied"))
  assert.equal(store.getSnapshot().jobs.length, 0)
  assert.match(store.getSnapshot().error ?? "", /not authorized/i)
  assert.equal(timer.pendingReconnect, false)
  store.dispose()
})

test("manual refresh alone calls listJobs and gets degraded health", async () => {
  const remote = remoteFixture()
  const degraded = {
    ...readyHealth,
    persistence: {
      status: "degraded" as const,
      diagnostics: [{ code: "write-failed", message: "Board writes are delayed" }],
    },
  }
  remote.listJobs.mock.mockImplementation(async () => ({
    ok: true as const,
    value: [job("refreshed")],
  }))
  remote.getHealth.mock.mockImplementation(async () => ({ ok: true as const, value: degraded }))
  const { store } = start(remote)
  await eventually(() => assert.equal(remote.channels.length, 1))
  remote.channels[0].push(frame(1, [job("watched")]))
  await eventually(() => assert.equal(store.getSnapshot().status, "ready"))

  await store.refresh()
  assert.deepEqual(store.getSnapshot().jobs.map((item) => item.id), ["refreshed"])
  assert.equal(store.getSnapshot().health?.persistence.status, "degraded")
  assert.equal(remote.listJobs.mock.callCount(), 1)
  assert.equal(remote.acknowledgeInjected.mock.callCount(), 0)
  store.dispose()
})

test("cancellation is non-repeatable while pending and applies the returned cancelling DTO", async () => {
  const remote = remoteFixture()
  const cancellation = deferred<Awaited<ReturnType<OmAgentsJobRemote["cancelJob"]>>>()
  remote.cancelJob.mock.mockImplementation(() => cancellation.promise)
  const { store } = start(remote)
  await eventually(() => assert.equal(remote.channels.length, 1))
  remote.channels[0].push(frame(1, [job("one")]))
  await eventually(() => assert.equal(store.getSnapshot().status, "ready"))

  const first = store.cancelJob("one")
  const second = store.cancelJob("one")
  assert.equal(remote.cancelJob.mock.callCount(), 1)
  assert.deepEqual(store.getSnapshot().cancellingIds, ["one"])
  cancellation.resolve({
    ok: true,
    value: job("one", { executionState: "cancelling", cancelRequestedAt: 2_000 }),
  })
  await Promise.all([first, second])
  assert.deepEqual(store.getSnapshot().cancellingIds, [])
  assert.equal(store.getSnapshot().jobs[0].executionState, "cancelling")
  store.dispose()
})

test("cancellation failures are actionable and do not mark a job cancelled", async () => {
  const remote = remoteFixture()
  remote.cancelJob.mock.mockImplementation(async () => ({
    ok: false as const,
    error: { code: "omagents/cancel-failed", message: "Native admission failed" },
  }))
  const { store } = start(remote)
  await eventually(() => assert.equal(remote.channels.length, 1))
  remote.channels[0].push(frame(1, [job("one")]))
  await eventually(() => assert.equal(store.getSnapshot().status, "ready"))

  await store.cancelJob("one")
  assert.match(store.getSnapshot().actionError ?? "", /native admission failed/i)
  assert.equal(store.getSnapshot().jobs[0].executionState, "running")
  assert.deepEqual(store.getSnapshot().cancellingIds, [])
  store.clearActionError()
  assert.equal(store.getSnapshot().actionError, undefined)
  store.dispose()
})
