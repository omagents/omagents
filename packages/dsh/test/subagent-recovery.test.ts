import { test } from "node:test"
import assert from "node:assert/strict"

import { Context } from "@deepseek-ai/cordis"
import { scopeTarget } from "@deepseek-ai/dsh-scope"
import { Session, SessionId } from "@deepseek-ai/dsh-session"
import { SubagentRunId, SUBAGENT_DESCRIPTOR_VERSION } from "@deepseek-ai/dsh-subagent"
import { JobBoard } from "@omagents/core"

import { createSubagentTracker } from "../dist/host/subagent-tracker.js"

function createBoard() {
  let nextId = 0
  return new JobBoard({
    clock: () => 5_000,
    idGenerator: () => `recovery-job-${++nextId}`,
  })
}

function launch(board, hostTaskId, overrides = {}) {
  return board.registerLaunch({
    host: "dsh",
    hostTaskId,
    parentSessionId: "parent-1",
    childName: hostTaskId,
    agent: "spawn",
    description: `Recover ${hostTaskId}`,
    ...overrides,
  })
}

function sessionWithTurn(id, reason, { descriptor = true, end = true } = {}) {
  const session = Session.create(SessionId(id))
  if (descriptor) {
    session.append("subagent/descriptor", {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: "continuable",
      provider: "spawn",
      label: `Recover ${id}`,
    })
  }
  session.append("turn/start", { turn: 1 })
  session.append("step/start", { turn: 1, step: 1 })
  if (end) session.append("turn/end", { turn: 1, reason })
  return session
}

async function setup(t, { agents = new Map(), readSession } = {}) {
  const root = new Context()
  root.provide("tools", {})
  root.provide("subagents", { interrupt() {} })
  root.provide("agents", {
    get(id) {
      return agents.get(id)
    },
  })
  if (readSession) root.provide("sessionQuery", { readSession })
  t.after(() => root.fiber.dispose())
  const board = createBoard()
  const tracker = createSubagentTracker(root, board)
  t.after(() => tracker.dispose())
  await new Promise((resolve) => setImmediate(resolve))
  return { root, board, tracker, agents }
}

test("missed completion is recovered from a real Session turn outcome, not inferred from idle", async (t) => {
  const session = sessionWithTurn("completed-child", { kind: "completed" })
  const agents = new Map([
    ["completed-child", { id: session.id, session, status: "idle" }],
    ["waiting-child", { id: "waiting-child", session: sessionWithTurn("waiting-child", { kind: "completed" }, { end: false }), status: "idle" }],
  ])
  const { board, tracker } = await setup(t, { agents })
  const completed = launch(board, "completed-child")
  const waiting = launch(board, "waiting-child")

  assert.deepEqual(await tracker.query(completed), {
    kind: "terminal",
    state: "completed",
  })
  assert.deepEqual(await tracker.query(waiting), { kind: "active" })
  assert.equal(waiting.executionState, "running")

  await board.reconcile({ query: (job) => tracker.query(job) })
  assert.equal(completed.executionState, "completed")
  assert.equal(completed.notificationState, "pending")
  assert.equal(waiting.executionState, "running")
  assert.deepEqual(board.listPendingOutcomes("parent-1"), [completed])
})

test("persisted failed and cancelled outcomes reconcile after the live Agent is gone", async (t) => {
  const sessions = new Map([
    ["failed-child", sessionWithTurn("failed-child", { kind: "error", error: { message: "model failed", code: "MODEL" } })],
    ["cancelled-child", sessionWithTurn("cancelled-child", { kind: "aborted", reason: { kind: "user" } })],
  ])
  const { board, tracker } = await setup(t, {
    async readSession(id) {
      const session = sessions.get(id)
      if (!session) {
        const error = new Error(`session "${id}" not found`)
        error.code = "SESSION_QUERY_SESSION_NOT_FOUND"
        throw error
      }
      return { session: session.header, events: session.snapshotEvents() }
    },
  })
  const failed = launch(board, "failed-child")
  const cancelled = launch(board, "cancelled-child")
  board.requestCancellation(cancelled.id)

  await board.reconcile({ query: (job) => tracker.query(job) })
  assert.equal(failed.executionState, "failed")
  assert.deepEqual(failed.error, {
    code: "SUBAGENT_ERROR",
    message: "Subagent turn ended with error",
  })
  assert.equal(cancelled.executionState, "cancelled")
  assert.equal(cancelled.notificationState, "pending")
})

test("missing and unreadable outcomes become interrupted without false completion", async (t) => {
  const { board, tracker } = await setup(t, {
    async readSession(id) {
      if (id === "missing-child") {
        const error = new Error("not found")
        error.code = "SESSION_QUERY_SESSION_NOT_FOUND"
        throw error
      }
      throw new Error("result file permissions denied")
    },
  })
  const missing = launch(board, "missing-child")
  const unreadable = launch(board, "unreadable-child")

  await board.reconcile({ query: (job) => tracker.query(job) })
  assert.equal(missing.executionState, "interrupted")
  assert.equal(missing.error.code, "HOST_MISSING")
  assert.equal(unreadable.executionState, "interrupted")
  assert.deepEqual(unreadable.error, {
    code: "HOST_UNREADABLE",
    message: "result file permissions denied",
  })
  assert.equal(board.listPendingOutcomes("parent-1").length, 2)
})

test("running Agents stay active and readable max-tokens/refusal outcomes fail closed", async (t) => {
  const runningSession = sessionWithTurn("running-child", { kind: "completed" }, { end: false })
  const maxTokens = sessionWithTurn("max-token-child", { kind: "max-tokens" })
  const refusal = sessionWithTurn("refusal-child", { kind: "blocked" })
  const agents = new Map([
    ["running-child", { id: runningSession.id, session: runningSession, status: "running" }],
  ])
  const sessions = new Map([
    ["max-token-child", maxTokens],
    ["refusal-child", refusal],
  ])
  const { board, tracker } = await setup(t, {
    agents,
    async readSession(id) {
      return { session: sessions.get(id).header, events: sessions.get(id).snapshotEvents() }
    },
  })
  const running = launch(board, "running-child")
  const max = launch(board, "max-token-child")
  const refused = launch(board, "refusal-child")

  assert.deepEqual(await tracker.query(running), { kind: "active" })
  assert.equal((await tracker.query(max)).state, "failed")
  assert.equal((await tracker.query(max)).error.code, "SUBAGENT_MAX_TOKENS")
  assert.equal((await tracker.query(refused)).state, "failed")
  assert.equal((await tracker.query(refused)).error.code, "SUBAGENT_REFUSAL")
})

test("a native end racing a slow recovery read wins without a missing-state regression", async (t) => {
  let releaseRead
  const gate = new Promise((resolve) => {
    releaseRead = resolve
  })
  const { root, board, tracker } = await setup(t, {
    async readSession() {
      await gate
      const error = new Error("not found")
      error.code = "SESSION_QUERY_SESSION_NOT_FOUND"
      throw error
    },
  })
  const job = launch(board, "racing-child")
  const querying = tracker.query(job)
  const owner = { id: SessionId("parent-1"), session: { id: SessionId("parent-1") } }
  root.emit(scopeTarget(root.subagents, owner), "subagent/end", {
    runId: SubagentRunId("racing-run"),
    provider: "spawn",
    id: SessionId("racing-child"),
    local: true,
    stopReason: "completed",
    lastAssistantMessage: [{ type: "text", text: "Native result arrived first" }],
  })
  releaseRead()

  assert.deepEqual(await querying, {
    kind: "terminal",
    state: "completed",
    resultSummary: "Native result arrived first",
  })
  assert.equal(job.executionState, "completed")
  assert.equal(job.notificationState, "injected")
})

test("startup recovery waits for delayed sessionQuery before classifying a restored job", async (t) => {
  const root = new Context()
  t.after(() => root.fiber.dispose())
  root.provide("tools", {})
  root.provide("subagents", { interrupt() {} })
  root.provide("agents", { get() {} })
  const board = createBoard()
  const restored = launch(board, "delayed-query-child")
  const tracker = createSubagentTracker(root, board)
  t.after(() => tracker.dispose())
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(restored.executionState, "running", "missing query services must not be sticky missing evidence")
  assert.deepEqual(
    await tracker.query(restored),
    { kind: "active" },
    "Remote-triggered queries must defer until live-Agent and Session-query capabilities are available"
  )

  const session = sessionWithTurn("delayed-query-child", { kind: "completed" })
  root.provide("sessionQuery", {
    async readSession() {
      return { session: session.header, events: session.snapshotEvents() }
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(restored.executionState, "completed")
  assert.equal(restored.notificationState, "pending")
})

test("an observed active external run stays active when its cold Session read is missing", async (t) => {
  const { root, board, tracker } = await setup(t, {
    async readSession(id) {
      const error = new Error(`session "${id}" not found`)
      error.code = "SESSION_QUERY_SESSION_NOT_FOUND"
      throw error
    },
  })
  const owner = { id: SessionId("parent-1"), session: { id: SessionId("parent-1") } }
  const start = {
    runId: SubagentRunId("active-external-run"),
    provider: "external",
    id: SessionId("active-external-child"),
    local: false,
  }
  root.emit(scopeTarget(root.subagents, owner), "subagent/start", start)
  const exec = {
    callId: "active-external-call",
    rootCallId: "active-external-call",
    name: "subagent",
    arguments: { description: "Active external work", prompt: "Keep running" },
    agent: owner,
    signal: new AbortController().signal,
    token: Symbol("active-external"),
  }
  root.emit(scopeTarget(root.tools, owner), "tools/result", exec, {
    isError: false,
    value: { kind: "activation", subagentId: "active-external-child" },
    content: [{ type: "text", text: "started subagent active-external-child" }],
  })
  const [job] = board.list()
  assert.equal(job.executionState, "running")

  await board.reconcile({ query: (candidate) => tracker.query(candidate) })
  assert.equal(job.executionState, "running", "an observed active external run is not missing")

  root.emit(scopeTarget(root.subagents, owner), "subagent/end", {
    ...start,
    stopReason: "completed",
    lastAssistantMessage: [{ type: "text", text: "External completion" }],
  })
  assert.equal(job.executionState, "completed")
  assert.equal(job.resultSummary, "External completion")
  assert.equal(job.notificationState, "injected")
})

test("startup recovery runs after delayed subagent/tools activation and preserves duplicate terminal notices", async (t) => {
  const root = new Context()
  t.after(() => root.fiber.dispose())
  const session = sessionWithTurn("restart-complete", { kind: "completed" })
  root.provide("agents", {
    get(id) {
      return id === "restart-complete"
        ? { id: session.id, session, status: "idle" }
        : undefined
    },
  })
  root.provide("sessionQuery", {
    async readSession() {
      throw new Error("the live Agent should supply this outcome")
    },
  })
  const board = createBoard()
  const completed = launch(board, "restart-complete")
  const tracker = createSubagentTracker(root, board)
  t.after(() => tracker.dispose())
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(completed.executionState, "running", "recovery waits for delayed Host services")

  root.provide("tools", {})
  root.provide("subagents", { interrupt() {} })
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(completed.executionState, "completed")
  assert.equal(completed.notificationState, "pending")

  board.markInjected([completed.id, completed.id])
  const revision = board.revision
  await board.reconcile({ query: (job) => tracker.query(job) })
  assert.equal(completed.notificationState, "injected")
  assert.equal(board.revision, revision)
})
