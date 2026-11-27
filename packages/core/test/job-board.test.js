import { test } from "node:test"
import assert from "node:assert/strict"

import { JobBoard } from "../src/index.js"

function createHarness() {
  let now = 1_000
  let nextId = 0
  const board = new JobBoard({
    clock: () => now,
    idGenerator: () => `job-${++nextId}`,
  })

  return {
    board,
    setNow(value) {
      now = value
    },
    idCalls() {
      return nextId
    },
  }
}

function launch(overrides = {}) {
  return {
    host: "host-a",
    hostTaskId: "host-task-1",
    parentSessionId: "parent-1",
    childName: "child-one",
    agent: "explore",
    description: "Research the state machine",
    ...overrides,
  }
}

test("registerLaunch creates a running record indexed by Core ID and alias", () => {
  const { board } = createHarness()

  const job = board.registerLaunch(launch())

  assert.equal(job.id, "job-1")
  assert.equal(job.host, "host-a")
  assert.equal(job.hostTaskId, "host-task-1")
  assert.equal(job.parentSessionId, "parent-1")
  assert.equal(job.childName, "child-one")
  assert.equal(job.alias, "exp-1")
  assert.equal(job.agent, "explore")
  assert.equal(job.description, "Research the state machine")
  assert.equal(job.executionState, "running")
  assert.equal(job.notificationState, undefined)
  assert.equal(job.launchedAt, 1_000)
  assert.equal(job.updatedAt, 1_000)
  assert.equal(job.terminalAt, undefined)
  assert.equal(job.revision, 1)
  assert.equal(board.revision, 1)
  assert.strictEqual(board.get(job.id), job)
  assert.strictEqual(board.get(job.alias), job)
  assert.deepEqual(board.list(), [job])
  assert.deepEqual(board.list({ parentSessionId: "parent-1" }), [job])
  assert.deepEqual(board.list({ parentSessionId: "another-parent" }), [])
})

test("duplicate launches are idempotent and the host task index is host-scoped", () => {
  const { board, setNow, idCalls } = createHarness()
  const original = board.registerLaunch(launch())

  setNow(2_000)
  const duplicate = board.registerLaunch(
    launch({ childName: "changed", description: "A duplicate must not replace metadata" })
  )

  assert.strictEqual(duplicate, original)
  assert.equal(duplicate.childName, "child-one")
  assert.equal(duplicate.description, "Research the state machine")
  assert.equal(duplicate.updatedAt, 1_000)
  assert.equal(board.revision, 1)
  assert.equal(idCalls(), 1)

  const otherHost = board.registerLaunch(launch({ host: "host-b" }))
  assert.notStrictEqual(otherHost, original)
  assert.equal(otherHost.id, "job-2")
  assert.equal(otherHost.alias, "exp-2")
  assert.equal(board.list().length, 2)
  assert.equal(board.revision, 2)
})

test("an injected Core ID cannot collide with an existing alias", () => {
  const generatedIds = ["job-1", "exp-1", "exp-1", "job-2"]
  const board = new JobBoard({
    clock: () => 1_000,
    idGenerator: () => generatedIds.shift(),
  })
  const first = board.registerLaunch(launch())
  const secondLaunch = launch({ hostTaskId: "host-task-2", childName: "child-two" })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.throws(() => board.registerLaunch(secondLaunch), {
      name: "Error",
      message: "Duplicate job ID: exp-1",
    })
  }

  assert.equal(first.alias, "exp-1")
  assert.strictEqual(board.get("exp-1"), first)
  assert.equal(board.list().length, 1)
  assert.equal(board.revision, 1)

  const second = board.registerLaunch(secondLaunch)
  assert.equal(second.id, "job-2")
  assert.equal(second.alias, "exp-2", "rejected launches must not consume aliases")
  assert.strictEqual(board.get(second.id), second)
  assert.strictEqual(board.get(first.alias), first)

  board.requestCancellation(second.id)
  assert.equal(second.executionState, "cancelling")
  assert.equal(first.executionState, "running")

  board.markTerminal(second.id, { state: "cancelled" })
  assert.equal(second.executionState, "cancelled")
  assert.equal(second.notificationState, "pending")
  assert.equal(first.executionState, "running")
  assert.equal(first.notificationState, undefined)

  board.markTerminal(first.id, { state: "completed", resultSummary: "first done" })
  assert.equal(first.executionState, "completed")
  assert.equal(first.resultSummary, "first done")
  assert.equal(second.executionState, "cancelled")
})

test("repeated injected Core IDs fail deterministically before insertion", () => {
  const generatedIds = ["job-1", "job-1", "job-1", "job-2"]
  const board = new JobBoard({
    clock: () => 1_000,
    idGenerator: () => generatedIds.shift(),
  })
  const first = board.registerLaunch(launch())
  const secondLaunch = launch({ hostTaskId: "host-task-2" })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.throws(() => board.registerLaunch(secondLaunch), {
      name: "Error",
      message: "Duplicate job ID: job-1",
    })
  }

  assert.strictEqual(board.registerLaunch(launch()), first)
  assert.equal(generatedIds.length, 1, "idempotent host launches do not consume IDs")
  assert.equal(board.list().length, 1)
  assert.equal(board.revision, 1)

  const second = board.registerLaunch(secondLaunch)
  assert.equal(second.id, "job-2")
  assert.equal(second.alias, "exp-2", "rejected launches must not consume aliases")
  assert.strictEqual(board.get(first.id), first)
  assert.strictEqual(board.get(second.id), second)
})

test("accepted cancellation is not confirmed cancellation", () => {
  const { board, setNow } = createHarness()
  const job = board.registerLaunch(launch())

  setNow(1_500)
  const accepted = board.requestCancellation(job.alias)

  assert.strictEqual(accepted, job)
  assert.equal(job.executionState, "cancelling")
  assert.equal(job.notificationState, undefined)
  assert.equal(job.cancelRequestedAt, 1_500)
  assert.equal(job.updatedAt, 1_500)
  assert.equal(job.terminalAt, undefined)
  assert.equal(job.revision, 2)

  setNow(2_000)
  board.requestCancellation(job.id)
  assert.equal(job.executionState, "cancelling")
  assert.equal(job.cancelRequestedAt, 1_500)
  assert.equal(job.updatedAt, 1_500)
  assert.equal(board.revision, 2)
})

test("terminal outcomes are sticky and independently delivered", () => {
  const { board, setNow } = createHarness()
  const job = board.registerLaunch(launch())

  setNow(2_000)
  board.markTerminal(job.id, { state: "completed", resultSummary: "done" })
  assert.equal(job.executionState, "completed")
  assert.equal(job.notificationState, "pending")
  assert.equal(job.resultSummary, "done")
  assert.equal(job.terminalAt, 2_000)
  assert.equal(job.updatedAt, 2_000)
  assert.deepEqual(board.listPendingOutcomes(job.parentSessionId), [job])

  setNow(3_000)
  board.markTerminal(job.id, { state: "failed", error: "late failure" })
  assert.equal(job.executionState, "completed")
  assert.equal(job.resultSummary, "done")
  assert.equal(job.error, undefined)
  assert.equal(job.terminalAt, 2_000)
  assert.equal(job.updatedAt, 2_000)
  assert.equal(board.revision, 2)

  board.markInjected([job.id])
  assert.equal(job.executionState, "completed")
  assert.equal(job.notificationState, "injected")
  assert.deepEqual(board.listPendingOutcomes(job.parentSessionId), [])

  board.acknowledgeInjected(job.parentSessionId)
  assert.equal(job.executionState, "completed")
  assert.equal(job.notificationState, "acknowledged")
  assert.equal(job.resultSummary, "done")
  assert.equal(board.revision, 4)
})

test("equivalent terminal outcomes backfill only missing details", () => {
  const { board, setNow } = createHarness()
  const completed = board.registerLaunch(launch())
  const failed = board.registerLaunch(launch({ hostTaskId: "host-task-2" }))

  board.markTerminal(completed.id, { state: "completed" })
  board.markTerminal(failed.id, { state: "failed" })
  const terminalRevision = board.revision
  const terminalAt = completed.terminalAt
  setNow(3_000)

  board.markTerminal(completed.id, { state: "completed", resultSummary: "late result" })
  board.markTerminal(failed.id, {
    state: "failed",
    resultSummary: "failure output",
    error: { message: "late failure" },
  })
  assert.equal(completed.resultSummary, "late result")
  assert.equal(completed.terminalAt, terminalAt)
  assert.equal(completed.executionState, "completed")
  assert.equal(failed.resultSummary, "failure output")
  assert.deepEqual(failed.error, { message: "late failure" })
  assert.equal(board.revision, terminalRevision + 2)

  board.markTerminal(completed.id, { state: "completed", resultSummary: "replacement" })
  board.markTerminal(completed.id, { state: "failed", error: "regression" })
  board.markTerminal(failed.id, { state: "failed", error: { message: "replacement" } })
  assert.equal(completed.resultSummary, "late result")
  assert.equal(completed.error, undefined)
  assert.deepEqual(failed.error, { message: "late failure" })
  assert.equal(board.revision, terminalRevision + 2)
})

test("running and cancelling jobs accept every authoritative outcome state", () => {
  const states = ["completed", "failed", "cancelled", "interrupted"]

  for (const state of states) {
    for (const initialState of ["running", "cancelling"]) {
      const { board } = createHarness()
      const job = board.registerLaunch(launch())
      if (initialState === "cancelling") board.requestCancellation(job.id)

      board.markTerminal(job.id, {
        state,
        resultSummary: state === "completed" ? "finished" : undefined,
        error: state === "completed" ? undefined : { reason: state },
      })

      assert.equal(job.executionState, state)
      assert.equal(job.notificationState, "pending")
      assert.equal(job.terminalAt, 1_000)
      assert.equal(job.resultSummary, state === "completed" ? "finished" : undefined)
      assert.deepEqual(job.error, state === "completed" ? undefined : { reason: state })
    }
  }
})

test("unknown IDs and invalid transitions cannot corrupt the board", () => {
  const { board } = createHarness()

  assert.equal(board.get("missing"), undefined)
  assert.equal(board.requestCancellation("missing"), undefined)
  assert.equal(board.markTerminal("missing", { state: "completed" }), undefined)
  board.markInjected(["missing"])
  board.acknowledgeInjected("missing")
  assert.equal(board.revision, 0)

  const job = board.registerLaunch(launch())
  assert.throws(() => board.markTerminal(job.id, { state: "running" }), /Invalid terminal state/)
  assert.throws(() => board.markTerminal(job.id, { state: "error" }), /Invalid terminal state/)
  assert.equal(job.executionState, "running")
  assert.equal(job.notificationState, undefined)
  assert.equal(board.revision, 1)

  board.markInjected([job.id])
  board.acknowledgeInjected(job.parentSessionId)
  assert.equal(job.notificationState, undefined)
  assert.equal(board.revision, 1)

  board.markTerminal(job.id, { state: "cancelled" })
  const terminalRevision = board.revision
  board.requestCancellation(job.id)
  board.markTerminal(job.id, { state: "interrupted", error: "late interruption" })
  assert.equal(job.executionState, "cancelled")
  assert.equal(job.notificationState, "pending")
  assert.equal(job.cancelRequestedAt, undefined)
  assert.equal(board.revision, terminalRevision)
})

test("notification delivery is ordered, scoped, and idempotent", () => {
  const { board } = createHarness()
  const first = board.registerLaunch(launch())
  const second = board.registerLaunch(launch({ hostTaskId: "host-task-2", childName: "child-two" }))
  const otherParent = board.registerLaunch(
    launch({ hostTaskId: "host-task-3", parentSessionId: "parent-2" })
  )

  for (const job of [first, second, otherParent]) {
    board.markTerminal(job.id, { state: "failed", error: "failed" })
  }
  const beforeInjection = board.revision

  board.markInjected([first.id, "missing", first.id, second.id])
  assert.equal(first.notificationState, "injected")
  assert.equal(second.notificationState, "injected")
  assert.equal(otherParent.notificationState, "pending")
  assert.equal(board.revision, beforeInjection + 2)

  board.acknowledgeInjected(first.parentSessionId)
  assert.equal(first.notificationState, "acknowledged")
  assert.equal(second.notificationState, "acknowledged")
  assert.equal(otherParent.notificationState, "pending")
  assert.equal(board.revision, beforeInjection + 4)

  const acknowledgedRevision = board.revision
  board.markInjected([first.id, second.id])
  board.acknowledgeInjected(first.parentSessionId)
  assert.equal(board.revision, acknowledgedRevision)
  assert.deepEqual(board.listPendingOutcomes("parent-2"), [otherParent])
})

test("acknowledgement cannot skip the injected notification state", () => {
  const { board } = createHarness()
  const job = board.registerLaunch(launch())
  board.markTerminal(job.id, { state: "interrupted", error: "host disappeared" })
  const revision = board.revision

  board.acknowledgeInjected(job.parentSessionId)

  assert.equal(job.notificationState, "pending")
  assert.equal(board.revision, revision)
})

test("subscriptions are synchronous, ordered, revisioned, and disposable", () => {
  const { board } = createHarness()
  const events = []
  const disposeFirst = board.subscribe(({ revision, jobId }) => {
    events.push(`first:${revision}:${jobId}`)
  })
  board.subscribe(({ revision, jobId }) => {
    events.push(`second:${revision}:${jobId}`)
  })

  const job = board.registerLaunch(launch())
  assert.deepEqual(events, ["first:1:job-1", "second:1:job-1"])

  disposeFirst()
  disposeFirst()
  board.requestCancellation(job.id)
  assert.deepEqual(events, ["first:1:job-1", "second:1:job-1", "second:2:job-1"])
  assert.equal(job.revision, 2)
  assert.equal(board.revision, 2)
})

test("Core package has the aligned version and no host runtime dependencies", async () => {
  const { readFile } = await import("node:fs/promises")
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  )

  assert.equal(packageJson.name, "@omagents/core")
  assert.equal(packageJson.version, "0.16.2")
  assert.equal(packageJson.type, "module")
  assert.equal(packageJson.main, "src/index.js")
  for (const dependency of Object.keys(packageJson.dependencies || {})) {
    assert.doesNotMatch(dependency, /opencode|codex|dsh|cordis|react/i)
  }
})
