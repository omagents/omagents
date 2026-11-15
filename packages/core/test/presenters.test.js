import { test } from "node:test"
import assert from "node:assert/strict"

import { JobBoard, buildJobBoardContext, buildParallelStatus, buildPsText } from "../src/index.js"

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
  }
}

function launch(overrides = {}) {
  return {
    host: "host-a",
    hostTaskId: "host-task-1",
    parentSessionId: "parent-1",
    agent: "explore",
    description: "Research presenters",
    ...overrides,
  }
}

test("empty presenters report no tasks without manufacturing context", () => {
  const { board } = createHarness()

  const status = buildParallelStatus(board)
  assert.equal(status.total, 0)
  assert.equal(status.message, "No background tasks found.")
  assert.deepEqual(status.tasks, [])
  assert.equal(buildPsText(board), "No background tasks.")
  assert.equal(buildPsText(board, { parentSessionId: "parent-1" }), "No background tasks.")
  assert.equal(buildJobBoardContext(board, "parent-1"), "")
})

test("parallel status serializes Core states, scope, revisions, and elapsed time", () => {
  const { board, setNow } = createHarness()
  const running = board.registerLaunch(launch())
  const completed = board.registerLaunch(
    launch({ hostTaskId: "host-task-2", agent: "plan", description: "Finished work" })
  )
  board.registerLaunch(
    launch({ hostTaskId: "host-task-3", parentSessionId: "parent-2", agent: "test" })
  )

  setNow(3_000)
  board.markTerminal(completed.id, { state: "completed", resultSummary: "done" })
  setNow(6_000)

  const status = buildParallelStatus(board, { parentSessionId: "parent-1" })

  assert.equal(status.revision, board.revision)
  assert.equal(status.total, 2)
  assert.equal(status.running, 1)
  assert.equal(status.cancelling, 0)
  assert.equal(status.completed, 1)
  assert.equal(status.failed, 0)
  assert.equal(status.cancelled, 0)
  assert.equal(status.interrupted, 0)
  assert.equal(status.pendingOutcomes, 1)
  assert.equal(status.tasks.length, 2)

  const runningStatus = status.tasks.find((task) => task.id === running.id)
  const completedStatus = status.tasks.find((task) => task.id === completed.id)
  assert.equal(runningStatus.host, "host-a")
  assert.equal(runningStatus.hostTaskId, "host-task-1")
  assert.equal(runningStatus.parentSessionId, "parent-1")
  assert.equal(runningStatus.executionState, "running")
  assert.equal(runningStatus.elapsedSeconds, 5)
  assert.equal(runningStatus.state, undefined)
  assert.equal(runningStatus.task_id, undefined)
  assert.equal(completedStatus.executionState, "completed")
  assert.equal(completedStatus.notificationState, "pending")
  assert.equal(completedStatus.resultSummary, "done")
  assert.equal(completedStatus.elapsedSeconds, 2)

  assert.equal(buildParallelStatus(board, "parent-2").total, 1)
  assert.equal(buildParallelStatus(board, { parentSessionId: "missing" }).total, 0)
})

test("job context contains active work and pending outcomes only for their parent", () => {
  const { board } = createHarness()
  const running = board.registerLaunch(launch({ description: "Still running" }))
  const finished = board.registerLaunch(
    launch({ hostTaskId: "host-task-2", agent: "plan", description: "Finished objective" })
  )
  const otherParent = board.registerLaunch(
    launch({ hostTaskId: "host-task-3", parentSessionId: "parent-2" })
  )
  board.markTerminal(finished.id, { state: "completed", resultSummary: "Useful result" })
  board.markTerminal(otherParent.id, { state: "failed", error: "other failure" })

  const context = buildJobBoardContext(board, "parent-1")

  assert.match(context, /### Background Job Board/)
  assert.match(context, /SENTINEL: omagents-job-board-v1/)
  assert.match(context, /Do not poll running jobs/)
  assert.match(context, /#### Running/)
  assert.match(context, new RegExp(`${running.alias}.*running`))
  assert.match(context, /Objective: Still running/)
  assert.match(context, /#### Pending outcomes/)
  assert.match(context, new RegExp(`${finished.alias}.*completed`))
  assert.match(context, /Result: Useful result/)
  assert.doesNotMatch(context, /other failure/)
  assert.equal(finished.notificationState, "pending")
  assert.deepEqual(board.listPendingOutcomes("parent-1"), [finished])

  board.markInjected([finished.id])
  const injectedContext = buildJobBoardContext(board, "parent-1")
  assert.doesNotMatch(injectedContext, /Useful result/)
  assert.match(injectedContext, /Still running/)

  board.acknowledgeInjected("parent-1")
  board.requestCancellation(running.id)
  const cancellingContext = buildJobBoardContext(board, "parent-1")
  assert.match(cancellingContext, /cancelling/)

  board.markTerminal(running.id, { state: "cancelled" })
  board.markInjected([running.id])
  board.acknowledgeInjected("parent-1")
  assert.equal(buildJobBoardContext(board, "parent-1"), "")
})

test("job context renders structured errors without changing notification state", () => {
  const { board } = createHarness()
  const job = board.registerLaunch(launch())
  board.markTerminal(job.id, {
    state: "interrupted",
    error: { code: "HOST_MISSING", message: "Host session not found" },
  })
  const revision = board.revision

  const context = buildJobBoardContext(board, "parent-1")

  assert.match(context, /interrupted/)
  assert.match(context, /Error: \{"code":"HOST_MISSING","message":"Host session not found"\}/)
  assert.equal(job.notificationState, "pending")
  assert.equal(board.revision, revision)
})

test("/ps renders a direct scoped table with stable elapsed time", () => {
  const { board, setNow } = createHarness()
  const active = board.registerLaunch(launch({ description: "Research | west\nThen summarize" }))
  const finished = board.registerLaunch(
    launch({ hostTaskId: "host-task-2", agent: "plan", description: "Done" })
  )
  board.registerLaunch(launch({ hostTaskId: "host-task-3", parentSessionId: "parent-2" }))

  setNow(3_250)
  board.markTerminal(finished.id, { state: "completed", resultSummary: "done" })
  setNow(6_500)

  const text = buildPsText(board, { parentSessionId: "parent-1" })

  assert.match(text, /Alias \| Agent \| Status \| Elapsed \| Description/)
  assert.match(text, new RegExp(`${active.alias}.*explore.*running.*6s`))
  assert.match(text, /Research \\\| west Then summarize/)
  assert.match(text, new RegExp(`${finished.alias}.*plan.*completed.*2s`))
  assert.doesNotMatch(text, /job-3/)

  setNow(20_000)
  assert.match(buildPsText(board, { parentSessionId: "parent-1" }), /completed.*2s/)
})

test("all presenters are read-only with respect to pending model notifications", () => {
  const { board } = createHarness()
  const job = board.registerLaunch(launch())
  board.markTerminal(job.id, { state: "failed", error: "boom" })
  const revision = board.revision

  buildParallelStatus(board)
  buildPsText(board)
  buildJobBoardContext(board, "parent-1")

  assert.equal(job.notificationState, "pending")
  assert.equal(board.revision, revision)
  assert.deepEqual(board.listPendingOutcomes("parent-1"), [job])
})
