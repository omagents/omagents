import { test } from "node:test"
import assert from "node:assert/strict"

import { Context } from "@deepseek-ai/cordis"
import { JobBoard } from "@omagents/core"

import { createHealthRecords } from "../dist/host/health.js"
import { OmAgentsRemote } from "../dist/host/remote-service.js"

function launch(overrides = {}) {
  return {
    host: "dsh",
    hostTaskId: "child-1",
    parentSessionId: "parent-1",
    childName: "child-one",
    agent: "explore",
    description: "Inspect the current project",
    ...overrides,
  }
}

async function within(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 2_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function setup(t, { onSubscribe } = {}) {
  const root = new Context()
  let nextId = 0
  const board = new JobBoard({ idGenerator: () => `watch-job-${++nextId}` })
  let activeSubscriptions = 0
  const subscribe = board.subscribe.bind(board)
  board.subscribe = (listener) => {
    let active = true
    const unsubscribe = subscribe((event) => {
      listener(event)
    })
    activeSubscriptions += 1
    onSubscribe?.()
    return () => {
      if (!active) return
      active = false
      activeSubscriptions -= 1
      unsubscribe()
    }
  }
  const remote = new OmAgentsRemote(root, {
    board,
    tracker: { async cancel(job) { board.requestCancellation(job.id) } },
    health: createHealthRecords(() => []),
    authorizeScope: () => true,
  })
  t.after(() => root.fiber.dispose())
  return {
    root,
    board,
    remote,
    activeSubscriptions: () => activeSubscriptions,
  }
}

test("watchJobs yields an empty baseline and abort resolves a pending iteration without listeners", async (t) => {
  const { remote, activeSubscriptions } = setup(t)
  const controller = new AbortController()
  const stream = remote.watchJobs({}, controller.signal)[Symbol.asyncIterator]()

  const baseline = await within(stream.next(), "empty baseline")
  assert.deepEqual(baseline, { done: false, value: { revision: 0, jobs: [] } })
  assert.equal(activeSubscriptions(), 1)
  const pending = stream.next()
  controller.abort()
  assert.equal(activeSubscriptions(), 0, "abort itself must detach the Core listener")
  assert.deepEqual(await within(pending, "abort"), { done: true, value: undefined })
  assert.equal(activeSubscriptions(), 0)
  assert.deepEqual(await stream.next(), { done: true, value: undefined })
})

test("watchJobs return during an idle pending next closes immediately and detaches synchronously", async (t) => {
  const { remote, activeSubscriptions } = setup(t)
  const stream = remote.watchJobs({}, new AbortController().signal)[Symbol.asyncIterator]()
  await stream.next()
  assert.equal(activeSubscriptions(), 1)

  const pending = stream.next()
  const returned = stream.return()
  assert.equal(activeSubscriptions(), 0, "return() must synchronously detach the Core listener")
  assert.deepEqual(await within(Promise.all([pending, returned]), "overlapping next/return"), [
    { done: true, value: undefined },
    { done: true, value: undefined },
  ])
  assert.equal(activeSubscriptions(), 0)
})

test("watchJobs throw during an idle pending next cleans up before rejecting", async (t) => {
  const { remote, activeSubscriptions } = setup(t)
  const stream = remote.watchJobs({}, new AbortController().signal)[Symbol.asyncIterator]()
  await stream.next()
  const failure = new Error("consumer failed")
  const pending = stream.next()
  const thrownAssertion = assert.rejects(
    within(stream.throw(failure), "overlapping next/throw"),
    (error) => error === failure
  )
  const pendingSettlement = within(pending, "pending next after throw").then(
    (value) => ({ value }),
    (error) => ({ error })
  )

  assert.equal(activeSubscriptions(), 0, "throw() must synchronously detach the Core listener")
  await thrownAssertion
  assert.deepEqual(await pendingSettlement, {
    value: { done: true, value: undefined },
  })
  assert.equal(activeSubscriptions(), 0)
})

test("watchJobs subscribes before its baseline so a change during subscription is not lost", async (t) => {
  let job
  let board
  const setupResult = setup(t, {
    onSubscribe: () => board.markTerminal(job.id, { state: "completed", resultSummary: "done" }),
  })
  board = setupResult.board
  job = board.registerLaunch(launch())
  const { remote, activeSubscriptions } = setupResult
  const controller = new AbortController()
  const stream = remote.watchJobs({}, controller.signal)[Symbol.asyncIterator]()

  const baseline = await stream.next()
  assert.equal(baseline.value.revision, board.revision)
  assert.equal(baseline.value.jobs[0].executionState, "completed")
  assert.equal(baseline.value.jobs[0].resultSummary, "done")
  assert.equal(activeSubscriptions(), 1)

  const pending = stream.next()
  await new Promise((resolveTurn) => setImmediate(resolveTurn))
  controller.abort()
  assert.deepEqual(await within(pending, "no duplicate baseline frame"), {
    done: true,
    value: undefined,
  })
  assert.equal(activeSubscriptions(), 0)
})

test("watchJobs yields a baseline and does not lose a change during subscription", async (t) => {
  const { remote, board, activeSubscriptions } = setup(t)
  const job = board.registerLaunch(launch())
  const controller = new AbortController()
  const stream = remote.watchJobs({}, controller.signal)[Symbol.asyncIterator]()
  const baseline = await stream.next()

  assert.equal(baseline.value.jobs[0].executionState, "running")
  board.markTerminal(job.id, { state: "completed", resultSummary: "done" })
  const changed = await within(stream.next(), "terminal frame")
  assert.equal(changed.value.revision > baseline.value.revision, true)
  assert.deepEqual(changed.value.jobs[0].resultSummary, "done")
  assert.equal(changed.value.jobs[0].executionState, "completed")

  await stream.return()
  assert.equal(activeSubscriptions(), 0)
})

test("watchJobs coalesces bursts into the latest whole-set frame", async (t) => {
  const { remote, board } = setup(t)
  const job = board.registerLaunch(launch())
  const controller = new AbortController()
  const stream = remote.watchJobs({}, controller.signal)[Symbol.asyncIterator]()
  await stream.next()

  board.markTerminal(job.id, { state: "completed", resultSummary: "done" })
  board.markInjected([job.id])
  board.acknowledgeInjected(job.parentSessionId)
  const coalesced = await within(stream.next(), "coalesced burst")
  assert.equal(coalesced.value.revision, board.revision)
  assert.equal(coalesced.value.jobs.length, 1)
  assert.equal(coalesced.value.jobs[0].resultSummary, "done")
  assert.equal(coalesced.value.jobs[0].notificationState, "acknowledged")

  board.registerLaunch(launch({ hostTaskId: "child-2", description: "Second" }))
  board.registerLaunch(launch({ hostTaskId: "child-3", description: "Third" }))
  const secondBurst = await within(stream.next(), "second burst")
  assert.equal(secondBurst.value.revision, board.revision)
  assert.deepEqual(
    secondBurst.value.jobs.map((item) => item.description),
    ["Inspect the current project", "Second", "Third"]
  )
  controller.abort()
  await stream.next()
})

test("watchJobs reconnect starts with a fresh baseline and independent listener cleanup", async (t) => {
  const { remote, board, activeSubscriptions } = setup(t)
  const job = board.registerLaunch(launch())
  const first = remote.watchJobs({}, new AbortController().signal)[Symbol.asyncIterator]()
  await first.next()
  await first.return()
  assert.equal(activeSubscriptions(), 0)

  board.markTerminal(job.id, { state: "completed", resultSummary: "before reconnect" })
  const second = remote.watchJobs({}, new AbortController().signal)[Symbol.asyncIterator]()
  const baseline = await second.next()
  assert.equal(baseline.value.revision, board.revision)
  assert.equal(baseline.value.jobs[0].resultSummary, "before reconnect")
  assert.equal(activeSubscriptions(), 1)
  assert.deepEqual(await first.next(), { done: true, value: undefined })

  board.markInjected([job.id])
  const changed = await within(second.next(), "reconnected update")
  assert.equal(changed.value.jobs[0].notificationState, "injected")
  await second.return()
  assert.equal(activeSubscriptions(), 0)
})

test("watchJobs filters every frame to its authorized parent session", async (t) => {
  const { remote, board } = setup(t)
  const own = board.registerLaunch(launch())
  board.registerLaunch(
    launch({ hostTaskId: "child-2", parentSessionId: "parent-2", description: "Secret other session" })
  )
  const controller = new AbortController()
  const stream = remote.watchJobs(
    { parentSessionId: "parent-1" },
    controller.signal
  )[Symbol.asyncIterator]()
  const baseline = await stream.next()
  assert.deepEqual(baseline.value.jobs.map((job) => job.id), [own.id])

  board.markTerminal(own.id, { state: "completed", resultSummary: "own result" })
  const changed = await within(stream.next(), "scoped update")
  assert.equal(JSON.stringify(changed).includes("Secret other session"), false)
  assert.deepEqual(changed.value.jobs.map((job) => job.id), [own.id])
  controller.abort()
  await stream.next()
})

test("service disposal settles a pending watch and removes its Core listener", async (t) => {
  const { root, remote, activeSubscriptions } = setup(t)
  const stream = remote.watchJobs({}, new AbortController().signal)[Symbol.asyncIterator]()
  await stream.next()
  assert.equal(activeSubscriptions(), 1)
  const pending = stream.next()
  const disposal = root.fiber.dispose()
  assert.deepEqual(await within(pending, "service disposal"), { done: true, value: undefined })
  await disposal
  assert.equal(activeSubscriptions(), 0)
})

test("an already-aborted watch does not subscribe or yield a frame", async (t) => {
  const { remote, activeSubscriptions } = setup(t)
  const controller = new AbortController()
  controller.abort()
  const stream = remote.watchJobs({}, controller.signal)[Symbol.asyncIterator]()
  assert.deepEqual(await stream.next(), { done: true, value: undefined })
  assert.equal(activeSubscriptions(), 0)
})
