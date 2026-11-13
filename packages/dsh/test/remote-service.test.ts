import { test } from "node:test"
import assert from "node:assert/strict"

import { Context } from "@deepseek-ai/cordis"
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol"
import { JobBoard } from "@omagents/core"

import { createHealthRecords } from "../dist/host/health.js"
import { authorizeRemoteScope } from "../dist/host/remote-access.js"
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

function setup(t, { authorizeScope, cancel } = {}) {
  const root = new Context()
  t.after(() => root.fiber.dispose())
  let nextId = 0
  const board = new JobBoard({ idGenerator: () => `remote-job-${++nextId}` })
  const cancellations = []
  const tracker = {
    async cancel(job) {
      cancellations.push(job.id)
      if (cancel) return cancel(job)
      board.requestCancellation(job.id)
    },
  }
  const health = createHealthRecords(() => [])
  const remote = new OmAgentsRemote(root, {
    board,
    tracker,
    health,
    authorizeScope:
      authorizeScope ??
      ((_ctx, scope) => scope.parentSessionId === undefined || scope.parentSessionId === "parent-1"),
  })
  return { root, board, remote, tracker, health, cancellations }
}

function assertRemoteError(error, code, details = {}) {
  assert.equal(error.name, "RemoteError")
  assert.equal(error.isDSHRemoteError, true)
  assert.equal(error.code, code)
  for (const [key, value] of Object.entries(details)) {
    assert.deepEqual(error.details[key], value)
  }
  return true
}

test("Remote metadata exposes unary methods and a stream without a Client surface", async (t) => {
  const { remote } = await setup(t)
  const markers = remoteMethods(remote)
  assert.deepEqual(
    markers.map(({ method, mode }) => ({ method, mode })),
    [
      { method: "listJobs", mode: undefined },
      { method: "cancelJob", mode: undefined },
      { method: "getHealth", mode: undefined },
      { method: "watchJobs", mode: "stream" },
    ]
  )
  assert.equal(remote.typertRemote.namespace, "omagents")
  assert.equal(remote.typertRemote.serviceKey, "omagentsRemote")
})

test("listJobs filters unscoped reads and returns only an authorized explicit scope", async (t) => {
  const { remote, board } = await setup(t)
  const own = board.registerLaunch(launch())
  const other = board.registerLaunch(
    launch({ hostTaskId: "child-2", parentSessionId: "parent-2", description: "Secret other session" })
  )
  const revision = board.revision

  const allVisible = await remote.listJobs({})
  assert.deepEqual(allVisible.map((job) => job.id), [own.id])
  assert.equal(JSON.stringify(allVisible).includes(other.description), false)
  const scoped = await remote.listJobs({ parentSessionId: "parent-1" })
  assert.deepEqual(scoped, allVisible)
  assert.notStrictEqual(scoped[0], own)
  assert.equal(board.revision, revision)
  assert.equal(own.notificationState, undefined)
})

test("unauthorized list/watch scopes fail with structured Remote errors before exposing jobs", async (t) => {
  const { remote, board } = await setup(t)
  board.registerLaunch(
    launch({ hostTaskId: "child-2", parentSessionId: "parent-2", description: "Secret other session" })
  )

  await assert.rejects(
    remote.listJobs({ parentSessionId: "parent-2" }),
    (error) =>
      assertRemoteError(error, "remote-access/denied", {
        action: "omagents/listJobs",
        reason: "session-scope-unauthorized",
      })
  )
  const stream = remote.watchJobs({ parentSessionId: "parent-2" }, new AbortController().signal)
  await assert.rejects(stream[Symbol.asyncIterator]().next(), (error) =>
    assertRemoteError(error, "remote-access/denied", {
      action: "omagents/watchJobs",
      reason: "session-scope-unauthorized",
    })
  )
})

test("cancelJob authorizes the actual job owner and never interrupts another session", async (t) => {
  const { remote, board, cancellations } = await setup(t)
  const other = board.registerLaunch(
    launch({ hostTaskId: "child-2", parentSessionId: "parent-2", description: "Secret other session" })
  )

  await assert.rejects(remote.cancelJob(other.id), (error) =>
    assertRemoteError(error, "remote-access/denied", {
      action: "omagents/cancelJob",
      reason: "job-unauthorized",
    })
  )
  assert.deepEqual(cancellations, [])
  assert.equal(other.executionState, "running")
})

test("cancelJob reports acknowledgement versus settlement and returns current state idempotently", async (t) => {
  const { remote, board, cancellations } = await setup(t)
  const job = board.registerLaunch(launch())

  const acknowledged = await remote.cancelJob(job.id)
  assert.deepEqual(cancellations, [job.id])
  assert.equal(acknowledged.executionState, "cancelling")
  assert.equal(acknowledged.cancelRequestedAt !== undefined, true)
  assert.equal(acknowledged.terminalAt, undefined)
  assert.equal(board.get(job.id).executionState, "cancelling")

  board.markTerminal(job.id, { state: "cancelled", resultSummary: "native settlement" })
  const settled = await remote.cancelJob(job.id)
  assert.equal(settled.executionState, "cancelled")
  assert.equal(settled.resultSummary, "native settlement")
  assert.deepEqual(cancellations, [job.id])
})

test("missing jobs and cancellation failures retain structured Remote failures", async (t) => {
  const { remote } = await setup(t)
  await assert.rejects(remote.cancelJob("missing"), (error) =>
    assertRemoteError(error, "omagents/job-not-found", { jobId: "missing" })
  )

  const failing = await setup(t, {
    authorizeScope: () => true,
    cancel: () => {
      throw new Error("native admission failed")
    },
  })
  const job = failing.board.registerLaunch(launch())
  await assert.rejects(failing.remote.cancelJob(job.id), (error) =>
    assertRemoteError(error, "omagents/cancel-failed", { jobId: job.id })
  )
  assert.equal(job.executionState, "running")
})

test("getHealth returns an independent snapshot and invalid inputs use gateway/bad-request", async (t) => {
  const { remote, health } = await setup(t)
  const snapshot = await remote.getHealth()
  assert.deepEqual(snapshot, health)
  assert.notStrictEqual(snapshot, health)
  assert.notStrictEqual(snapshot.host, health.host)

  await assert.rejects(remote.listJobs(null), (error) =>
    assertRemoteError(error, "gateway/bad-request")
  )
  await assert.rejects(remote.cancelJob(""), (error) =>
    assertRemoteError(error, "gateway/bad-request")
  )
})

test("remote-access adapter uses the invocation-derived Context and fails closed without policy service", async (t) => {
  const root = new Context()
  t.after(() => root.fiber.dispose())
  const checks = []
  root.provide("remoteAccess", {
    allows(resource) {
      checks.push(resource)
      return resource.kind === "session" && resource.id === "parent-1"
    },
  })
  const invocation = {
    request: { namespace: "omagents", method: "listJobs", args: {} },
    peer: { principal: { kind: "guest" } },
  }
  const caller = root.extend({ invocation })

  assert.equal(authorizeRemoteScope(caller, { parentSessionId: "parent-1" }), true)
  assert.equal(authorizeRemoteScope(caller, { parentSessionId: "parent-2" }), false)
  assert.deepEqual(checks, [
    { kind: "session", id: "parent-1" },
    { kind: "session", id: "parent-2" },
  ])
  assert.equal(authorizeRemoteScope(caller, {}), true)
  assert.equal(authorizeRemoteScope(root, { parentSessionId: "parent-2" }), true)

  const owner = root.extend({
    invocation: { ...invocation, peer: { principal: { kind: "owner" } } },
  })
  assert.equal(authorizeRemoteScope(owner, { parentSessionId: "parent-2" }), true)

  const withoutAccess = new Context()
  t.after(() => withoutAccess.fiber.dispose())
  assert.equal(
    authorizeRemoteScope(withoutAccess.extend({ invocation }), { parentSessionId: "parent-1" }),
    false
  )
})
