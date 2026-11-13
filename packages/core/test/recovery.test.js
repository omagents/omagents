import { test } from "node:test"
import assert from "node:assert/strict"

import { JobBoard } from "../src/index.js"

function clone(value) {
  return structuredClone(value)
}

class MemoryStore {
  constructor(snapshot = { version: 1, revision: 0, jobs: [] }) {
    this.snapshot = clone(snapshot)
    this.saves = []
    this.flushCount = 0
    this.closed = false
  }

  async load() {
    return clone(this.snapshot)
  }

  save(snapshot) {
    this.snapshot = clone(snapshot)
    this.saves.push(clone(snapshot))
    return Promise.resolve()
  }

  async flush() {
    this.flushCount += 1
  }

  async close() {
    await this.flush()
    this.closed = true
  }
}

function createJob(id, overrides = {}) {
  const number = id.match(/\d+$/)?.[0] || "1"
  return {
    id,
    host: "host-a",
    hostTaskId: `host-task-${number}`,
    parentSessionId: "parent-1",
    childName: `child-${number}`,
    alias: `exp-${number}`,
    agent: "explore",
    description: `Job ${number}`,
    executionState: "running",
    launchedAt: 1_000,
    updatedAt: 1_000,
    revision: Number(number),
    ...overrides,
  }
}

function snapshotWith(jobs, revision = 50) {
  return { version: 1, revision, jobs }
}

async function openBoard(snapshot, clock = () => 5_000) {
  const store = new MemoryStore(snapshot)
  const board = await JobBoard.open({
    store,
    clock,
    idGenerator: () => "generated-job",
  })
  return { board, store }
}

test("open restores revision, indexes, pending outcomes, and alias uniqueness without saving", async () => {
  const running = createJob("job-1")
  const completed = createJob("job-2", {
    executionState: "completed",
    notificationState: "pending",
    resultSummary: "already done",
    terminalAt: 2_000,
    updatedAt: 2_000,
  })
  const { board, store } = await openBoard(snapshotWith([running, completed], 8))

  assert.equal(board.revision, 8)
  const restoredRunning = board.get("job-1")
  const restoredCompleted = board.get("exp-2")
  assert.deepEqual(restoredRunning, running)
  assert.deepEqual(restoredCompleted, completed)
  assert.deepEqual(board.listPendingOutcomes("parent-1"), [restoredCompleted])
  assert.equal(store.saves.length, 0)

  const duplicate = board.registerLaunch({
    host: running.host,
    hostTaskId: running.hostTaskId,
    parentSessionId: "changed-parent",
    agent: "changed",
  })
  assert.strictEqual(duplicate, restoredRunning)
  assert.equal(board.revision, 8)

  const launched = board.registerLaunch({
    host: "host-b",
    hostTaskId: "new-host-task",
    parentSessionId: "parent-2",
    agent: "explore",
  })
  assert.equal(launched.alias, "exp-3")
  assert.equal(board.revision, 9)
  await board.close()
})

test("missing child after restart becomes interrupted, not completed", async () => {
  const running = createJob("job-1")
  const { board, store } = await openBoard(snapshotWith([running]), () => 9_000)

  await board.reconcile({
    query: async () => ({ kind: "missing", reason: "host session not found" }),
  })

  const [job] = board.list()
  assert.equal(job.executionState, "interrupted")
  assert.equal(job.notificationState, "pending")
  assert.equal(job.terminalAt, 9_000)
  assert.deepEqual(job.error, {
    code: "HOST_MISSING",
    message: "host session not found",
  })
  assert.notEqual(job.executionState, "completed")
  assert.deepEqual(board.listPendingOutcomes("parent-1"), [job])
  assert.equal(store.saves.length, 1)
  assert.equal(store.saves[0].jobs[0].executionState, "interrupted")

  const recoveredRevision = board.revision
  await board.reconcile({
    query: async () => {
      throw new Error("terminal jobs must not be queried again")
    },
  })
  assert.equal(board.revision, recoveredRevision)
  assert.equal(job.notificationState, "pending")
  assert.equal(store.saves.length, 1)
  await board.close()
})

test("reconciliation preserves active jobs and applies only authoritative terminal outcomes", async () => {
  const jobs = [
    createJob("job-1"),
    createJob("job-2", { executionState: "cancelling", cancelRequestedAt: 2_000 }),
    createJob("job-3"),
    createJob("job-4", { executionState: "cancelling", cancelRequestedAt: 2_000 }),
    createJob("job-5", {
      executionState: "failed",
      notificationState: "injected",
      error: { message: "existing outcome" },
      terminalAt: 2_000,
      updatedAt: 2_000,
    }),
  ]
  const { board, store } = await openBoard(snapshotWith(jobs), () => 10_000)
  const queried = []
  const outcomes = new Map([
    ["job-1", { kind: "active" }],
    ["job-2", { kind: "active" }],
    ["job-3", { kind: "terminal", state: "completed", resultSummary: "finished" }],
    ["job-4", { kind: "terminal", state: "failed", error: { message: "failed" } }],
  ])

  await board.reconcile({
    query: async (job) => {
      queried.push(job.id)
      return outcomes.get(job.id)
    },
  })

  assert.deepEqual(queried, ["job-1", "job-2", "job-3", "job-4"])
  assert.equal(board.get("job-1").executionState, "running")
  assert.equal(board.get("job-2").executionState, "cancelling")
  assert.equal(board.get("job-2").cancelRequestedAt, 2_000)
  assert.equal(board.get("job-3").executionState, "completed")
  assert.equal(board.get("job-3").resultSummary, "finished")
  assert.equal(board.get("job-3").notificationState, "pending")
  assert.equal(board.get("job-4").executionState, "failed")
  assert.deepEqual(board.get("job-4").error, { message: "failed" })
  assert.equal(board.get("job-5").executionState, "failed")
  assert.equal(board.get("job-5").notificationState, "injected")
  assert.equal(board.get("job-5").revision, 5)
  assert.equal(board.revision, 52)
  assert.equal(store.saves.length, 2)
  await board.close()
})

test("unreadable and old-but-active jobs never become false completions", async () => {
  const jobs = [createJob("job-1", { launchedAt: 1 }), createJob("job-2")]
  const { board } = await openBoard(snapshotWith(jobs), () => 999_999_999)

  await board.reconcile({
    query: async (job) =>
      job.id === "job-1"
        ? { kind: "active" }
        : { kind: "unreadable", reason: "result file permissions denied" },
  })

  assert.equal(board.get("job-1").executionState, "running")
  assert.equal(board.get("job-1").notificationState, undefined)
  assert.equal(board.get("job-2").executionState, "interrupted")
  assert.equal(board.get("job-2").notificationState, "pending")
  assert.deepEqual(board.get("job-2").error, {
    code: "HOST_UNREADABLE",
    message: "result file permissions denied",
  })
  await board.close()
})

test("racing and repeated recovered outcomes keep the first result and one pending notice", async () => {
  const running = createJob("job-1")
  const { board, store } = await openBoard(snapshotWith([running]))
  const pendingQueries = []

  const query = () =>
    new Promise((resolve) => {
      pendingQueries.push(resolve)
    })
  const firstRecovery = board.reconcile({ query })
  const secondRecovery = board.reconcile({ query })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(pendingQueries.length, 2)

  pendingQueries[0]({ kind: "terminal", state: "completed", resultSummary: "first result" })
  pendingQueries[1]({ kind: "terminal", state: "failed", error: "late failure" })
  await Promise.all([firstRecovery, secondRecovery])

  const job = board.get("job-1")
  assert.equal(job.executionState, "completed")
  assert.equal(job.resultSummary, "first result")
  assert.equal(job.error, undefined)
  assert.equal(job.notificationState, "pending")
  assert.equal(board.revision, 51)
  assert.deepEqual(board.listPendingOutcomes("parent-1"), [job])
  assert.equal(store.saves.length, 1)

  board.markTerminal(job.id, { state: "failed", error: "another late failure" })
  board.markInjected([job.id, job.id])
  board.markInjected([job.id])
  assert.equal(job.notificationState, "injected")
  assert.equal(store.saves.length, 2)
  await board.close()
})

test("terminal and notification transitions enqueue immediate snapshots and close drains them", async () => {
  const { board, store } = await openBoard(undefined, () => 7_000)
  const job = board.registerLaunch({
    host: "host-a",
    hostTaskId: "host-task-new",
    parentSessionId: "parent-1",
    agent: "explore",
    description: "flush outcome",
  })
  assert.equal(store.saves.at(-1).jobs[0].executionState, "running")

  board.requestCancellation(job.id)
  assert.equal(store.saves.at(-1).jobs[0].executionState, "cancelling")
  board.markTerminal(job.id, { state: "cancelled", resultSummary: "cancelled by request" })
  assert.equal(store.saves.at(-1).jobs[0].executionState, "cancelled")
  assert.equal(store.saves.at(-1).jobs[0].notificationState, "pending")

  board.markInjected([job.id])
  assert.equal(store.saves.at(-1).jobs[0].notificationState, "injected")
  board.acknowledgeInjected("parent-1")
  assert.equal(store.saves.at(-1).jobs[0].notificationState, "acknowledged")

  await board.close()
  await board.close()
  assert.equal(store.closed, true)
  assert.equal(store.snapshot.jobs[0].notificationState, "acknowledged")
  assert.equal(store.flushCount >= 1, true)
})

test("retention evicts only bounded acknowledged terminal history", async () => {
  const jobs = [
    createJob("job-1"),
    createJob("job-2", { executionState: "cancelling", cancelRequestedAt: 2_000 }),
    createJob("job-3", {
      executionState: "completed",
      notificationState: "pending",
      terminalAt: 2_000,
    }),
    createJob("job-4", {
      executionState: "failed",
      notificationState: "injected",
      terminalAt: 2_000,
    }),
    createJob("job-5", {
      executionState: "completed",
      notificationState: "acknowledged",
      terminalAt: 2_000,
      updatedAt: 2_000,
    }),
    createJob("job-6", {
      executionState: "failed",
      notificationState: "acknowledged",
      terminalAt: 3_000,
      updatedAt: 3_000,
    }),
  ]
  const { board, store } = await openBoard(snapshotWith(jobs))

  const removed = board.prune({ maxAcknowledged: 1 })

  assert.deepEqual(
    removed.map((job) => job.id),
    ["job-5"]
  )
  assert.deepEqual(
    board.list().map((job) => job.id),
    ["job-1", "job-2", "job-3", "job-4", "job-6"]
  )
  assert.equal(board.get("exp-5"), undefined)
  assert.equal(board.revision, 51)
  assert.deepEqual(store.saves.at(-1).jobs, board.list())

  assert.deepEqual(board.prune({ maxAcknowledged: 1 }), [])
  assert.equal(board.revision, 51)
  assert.equal(store.saves.length, 1)
  await board.close()
})

test("open validates restored records from any injected store", async (t) => {
  const invalidSnapshots = [
    ["unknown execution state", snapshotWith([createJob("job-1", { executionState: "done" })])],
    [
      "terminal notification missing",
      snapshotWith([createJob("job-1", { executionState: "completed", terminalAt: 2_000 })]),
    ],
    [
      "duplicate aliases",
      snapshotWith([createJob("job-1"), createJob("job-2", { alias: "exp-1" })]),
    ],
    [
      "ID and alias collision",
      snapshotWith([createJob("job-1"), createJob("job-2", { alias: "job-1" })]),
    ],
    [
      "duplicate host task identity",
      snapshotWith([createJob("job-1"), createJob("job-2", { hostTaskId: "host-task-1" })]),
    ],
  ]

  for (const [name, snapshot] of invalidSnapshots) {
    await t.test(name, async () => {
      await assert.rejects(JobBoard.open({ store: new MemoryStore(snapshot) }), /job|snapshot/i)
    })
  }
})
