import { test } from "node:test"
import assert from "node:assert/strict"

import { Context } from "@deepseek-ai/cordis"
import { scopeTarget } from "@deepseek-ai/dsh-scope"
import { SessionId } from "@deepseek-ai/dsh-session"
import { SubagentRunId } from "@deepseek-ai/dsh-subagent"
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools"
import { JobBoard } from "@omagents/core"

import { createHealthRecords } from "../dist/host/health.js"
import { registerDshTools } from "../dist/host/register-tools.js"
import { createSubagentTracker } from "../dist/host/subagent-tracker.js"

function createBoard() {
  let now = 1_000
  let nextId = 0
  return {
    board: new JobBoard({
      clock: () => now,
      idGenerator: () => `dsh-subagent-job-${++nextId}`,
    }),
    setNow(value) {
      now = value
    },
  }
}

function parent(id = "parent-1") {
  return { id: SessionId(id), session: { id: SessionId(id) }, status: "idle" }
}

function toolRegistry() {
  const definitions = new Map()
  return {
    definitions,
    register(definition) {
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
  }
}

function subagentService() {
  const interrupts = []
  return {
    interrupts,
    interrupt(targetSessionId, authority) {
      interrupts.push({ targetSessionId, authority })
    },
  }
}

async function setup(t, { withTools = false } = {}) {
  const root = new Context()
  const tools = toolRegistry()
  const subagents = subagentService()
  root.provide("tools", tools)
  root.provide("subagents", subagents)
  t.after(() => root.fiber.dispose())
  const { board, setNow } = createBoard()
  const tracker = createSubagentTracker(root, board)
  t.after(() => tracker.dispose())
  await new Promise((resolve) => setImmediate(resolve))
  if (withTools) registerDshTools(root, board, tracker, createHealthRecords(() => []))
  return { root, board, setNow, tracker, tools, subagents }
}

function emitStart(root, owner, { id, runId = `run-${id}`, local = true, provider = "spawn" }) {
  const info = { runId: SubagentRunId(runId), provider, id: SessionId(id), local }
  root.emit(scopeTarget(root.subagents, owner), "subagent/start", info)
  return info
}

function emitResult(root, owner, id, description = `Work on ${id}`) {
  const exec = {
    callId: `call-${id}`,
    rootCallId: `call-${id}`,
    name: "subagent",
    arguments: { description, prompt: `Complete ${description}` },
    agent: owner,
    signal: new AbortController().signal,
    token: Symbol(id),
  }
  const result = {
    isError: false,
    value: { kind: "activation", subagentId: id },
    content: [{ type: "text", text: `started subagent ${id}` }],
  }
  root.emit(scopeTarget(root.tools, owner), "tools/result", exec, result)
}

function emitEnd(root, owner, start, stopReason, lastAssistantMessage) {
  root.emit(scopeTarget(root.subagents, owner), "subagent/end", {
    ...start,
    stopReason,
    ...(lastAssistantMessage === undefined ? {} : { lastAssistantMessage }),
  })
}

test("native result/start correlation records the durable child and maps completed output once", async (t) => {
  const { root, board } = await setup(t)
  const owner = parent()
  const start = emitStart(root, owner, { id: "child-complete" })
  emitResult(root, owner, "child-complete", "Inspect lifecycle")

  const [job] = board.list()
  assert.ok(job)
  assert.equal(job.host, "dsh")
  assert.equal(job.hostTaskId, "child-complete")
  assert.equal(job.parentSessionId, "parent-1")
  assert.equal(job.childName, "child-complete")
  assert.equal(job.agent, "spawn")
  assert.equal(job.description, "Inspect lifecycle")
  assert.equal(job.executionState, "running")

  emitEnd(root, owner, start, "completed", [{ type: "text", text: "Lifecycle verified" }])
  assert.equal(job.executionState, "completed")
  assert.equal(job.resultSummary, "Lifecycle verified")
  assert.equal(job.notificationState, "injected")
  assert.deepEqual(board.listPendingOutcomes("parent-1"), [])

  board.acknowledgeInjected("parent-1")
  const revision = board.revision
  emitEnd(root, owner, start, "completed", [{ type: "text", text: "Late detail" }])
  emitEnd(root, owner, start, "completed", [{ type: "text", text: "Late detail" }])
  assert.equal(job.executionState, "completed")
  assert.equal(job.resultSummary, "Lifecycle verified")
  assert.equal(job.notificationState, "acknowledged")
  assert.equal(board.revision, revision)

  emitEnd(root, owner, start, "error")
  assert.equal(job.executionState, "completed", "a different terminal state cannot regress")
})

test("an end with a missed start reconciles its durable job and backfills without reinjection", async (t) => {
  const { root, board } = await setup(t)
  const owner = parent()
  const job = board.registerLaunch({
    host: "dsh",
    hostTaskId: "missed-start",
    parentSessionId: "parent-1",
    childName: "missed-start",
    agent: "spawn",
    description: "Recover an already observed native end",
  })
  const end = {
    runId: SubagentRunId("missed-start-run"),
    provider: "spawn",
    id: SessionId("missed-start"),
    local: true,
  }
  emitEnd(root, owner, end, "completed")
  assert.equal(job.executionState, "completed")
  assert.equal(job.notificationState, "injected")

  emitEnd(root, owner, end, "completed", [{ type: "text", text: "Late native output" }])
  assert.equal(job.resultSummary, "Late native output")
  assert.equal(job.notificationState, "injected")
  const revision = board.revision
  emitEnd(root, owner, end, "completed", [{ type: "text", text: "Late native output" }])
  assert.equal(board.revision, revision)
})

test("a missed start followed by end-before-result creates exactly one terminal job", async (t) => {
  const { root, board } = await setup(t)
  const owner = parent()
  const end = {
    runId: SubagentRunId("orphan-end-run"),
    provider: "external",
    id: SessionId("orphan-end-child"),
    local: false,
  }

  emitEnd(root, owner, end, "completed", [{ type: "text", text: "Orphan result" }])
  assert.equal(board.list().length, 0)
  emitResult(root, owner, "orphan-end-child", "Correlate an orphan end")

  assert.equal(board.list().length, 1)
  const [job] = board.list()
  assert.equal(job.hostTaskId, "orphan-end-child")
  assert.equal(job.description, "Correlate an orphan end")
  assert.equal(job.executionState, "completed")
  assert.equal(job.resultSummary, "Orphan result")
  assert.equal(job.notificationState, "injected")

  const revision = board.revision
  emitResult(root, owner, "orphan-end-child", "Duplicate activation result")
  emitEnd(root, owner, end, "completed", [{ type: "text", text: "Orphan result" }])
  assert.equal(board.list().length, 1)
  assert.equal(board.revision, revision)
  assert.equal(job.notificationState, "injected")
})

test("result-first correlation is parent-scoped and error/aborted outcomes stay authoritative", async (t) => {
  const { root, board } = await setup(t)
  const firstParent = parent("parent-a")
  const secondParent = parent("parent-b")
  emitResult(root, firstParent, "first-child", "First parent's work")
  emitResult(root, secondParent, "second-child", "Second parent's work")
  assert.equal(board.list().length, 0, "activation results wait for their matching lifecycle start")

  const second = emitStart(root, secondParent, {
    id: "second-child",
    runId: "run-second",
    local: false,
    provider: "external",
  })
  const first = emitStart(root, firstParent, { id: "first-child", runId: "run-first" })
  assert.equal(board.list().length, 2)
  const firstJob = board.get("dsh-subagent-job-2")
  const secondJob = board.get("dsh-subagent-job-1")
  assert.equal(firstJob.parentSessionId, "parent-a")
  assert.equal(secondJob.parentSessionId, "parent-b")
  assert.equal(secondJob.agent, "external")

  emitEnd(root, firstParent, first, "error", [{ type: "text", text: "Partial answer" }])
  emitEnd(root, secondParent, second, "aborted")
  assert.equal(firstJob.executionState, "failed")
  assert.equal(firstJob.resultSummary, "Partial answer")
  assert.equal(firstJob.error.code, "SUBAGENT_ERROR")
  assert.equal(secondJob.executionState, "cancelled")
  assert.equal(secondJob.notificationState, "injected")
})

test("accepted interruption enters cancelling, repeated tool calls do not interrupt twice, and settlement cancels", async (t) => {
  const { root, board, tools, subagents, tracker } = await setup(t, { withTools: true })
  const owner = parent()
  const start = emitStart(root, owner, { id: "child-cancel", local: false })
  emitResult(root, owner, "child-cancel")
  const [job] = board.list()
  const cancel = tools.definitions.get("cancel_task")

  const first = await cancel.execute({ task_id: job.alias }, {})
  assert.equal(first.job.executionState, "cancelling")
  assert.equal(job.executionState, "cancelling")
  assert.equal(job.terminalAt, undefined)
  assert.deepEqual(subagents.interrupts, [
    {
      targetSessionId: "child-cancel",
      authority: { kind: "user", parentSessionId: "parent-1" },
    },
  ])
  assert.deepEqual(validateJsonSchemaValue(cancel.output.schema, first), [])

  const revision = board.revision
  const repeated = await cancel.execute({ task_id: job.id }, {})
  assert.equal(repeated.job.executionState, "cancelling")
  assert.equal(board.revision, revision)
  assert.equal(subagents.interrupts.length, 1)

  emitEnd(root, owner, start, "aborted")
  assert.equal(job.executionState, "cancelled")
  const terminalRevision = board.revision
  const terminal = await cancel.execute({ task_id: job.alias }, {})
  assert.equal(terminal.job.executionState, "cancelled")
  assert.equal(board.revision, terminalRevision)
  assert.equal(subagents.interrupts.length, 1)

  const unknown = await cancel.execute({ task_id: "not-a-job" }, {})
  assert.equal(unknown.found, false)
  assert.equal(unknown.job, undefined)
  assert.equal(subagents.interrupts.length, 1)
  assert.deepEqual(validateJsonSchemaValue(cancel.output.schema, unknown), [])

  await tracker.cancel(job)
  assert.equal(subagents.interrupts.length, 1, "direct repeated cancellation is idempotent too")
})

test("a rejected Host interruption leaves the job running", async (t) => {
  const { root, board, subagents, tracker } = await setup(t)
  subagents.interrupt = () => {
    throw new Error("unauthorized parent")
  }
  const owner = parent()
  emitStart(root, owner, { id: "child-rejected" })
  emitResult(root, owner, "child-rejected")
  const [job] = board.list()

  await assert.rejects(tracker.cancel(job), /unauthorized parent/)
  assert.equal(job.executionState, "running")
  assert.equal(job.cancelRequestedAt, undefined)
})

test("local interruption does not cancel descendants and query waits for their settlement", async (t) => {
  const { root, board, tracker, subagents } = await setup(t)
  const owner = parent()
  const local = emitStart(root, owner, { id: "local-parent", local: true })
  emitResult(root, owner, "local-parent")
  const [job] = board.list()
  const childParent = parent("local-parent")
  const descendant = emitStart(root, childParent, { id: "local-grandchild", local: true })
  emitResult(root, childParent, "local-grandchild")

  await tracker.cancel(job)
  assert.equal(job.executionState, "cancelling")
  assert.equal(subagents.interrupts.length, 1)
  assert.deepEqual((await tracker.query(job)).kind, "active")
  assert.equal(board.get("dsh-subagent-job-2").executionState, "running")

  emitEnd(root, childParent, descendant, "completed")
  assert.equal(job.executionState, "cancelling")
  emitEnd(root, owner, local, "aborted")
  assert.equal(job.executionState, "cancelled")
  assert.equal(board.get("dsh-subagent-job-2").executionState, "completed")
})

test("external one-shot cancellation settles only on subagent/end and cannot be resumed by recovery", async (t) => {
  const { root, board, tracker } = await setup(t)
  const owner = parent()
  const start = emitStart(root, owner, { id: "external-one-shot", local: false })
  emitResult(root, owner, "external-one-shot")
  const [job] = board.list()
  await tracker.cancel(job)
  assert.equal(job.executionState, "cancelling")
  emitEnd(root, owner, start, "aborted")
  assert.equal(job.executionState, "cancelled")

  root.provide("agents", { get() {} })
  root.provide("sessionQuery", {
    async readSession(id) {
      const error = new Error(`session "${id}" not found`)
      error.code = "SESSION_QUERY_SESSION_NOT_FOUND"
      throw error
    },
  })
  const missing = board.registerLaunch({
    host: "dsh",
    hostTaskId: "external-missing",
    parentSessionId: "parent-1",
    agent: "external",
    description: "Unreadable external result",
  })
  assert.deepEqual(await tracker.query(missing), {
    kind: "missing",
    reason: 'session "external-missing" not found',
  })
})

test("delayed capabilities activate once and disposal drops pending correlation without losing durable jobs", async (t) => {
  const root = new Context()
  t.after(() => root.fiber.dispose())
  const { board } = createBoard()
  const tracker = createSubagentTracker(root, board)
  const owner = parent()
  const tools = toolRegistry()
  const subagents = subagentService()
  root.provide("tools", tools)
  root.provide("subagents", subagents)
  await new Promise((resolve) => setImmediate(resolve))

  const start = emitStart(root, owner, { id: "pending-at-disposal" })
  tracker.dispose()
  tracker.dispose()
  emitResult(root, owner, "pending-at-disposal")
  assert.equal(board.list().length, 0)
  emitEnd(root, owner, start, "completed")
  assert.equal(board.list().length, 0)

  const durable = board.registerLaunch({
    host: "dsh",
    hostTaskId: "durable-after-disposal",
    parentSessionId: "parent-1",
    agent: "spawn",
    description: "Durable state survives listener cleanup",
  })
  const revision = board.revision
  emitStart(root, owner, { id: "durable-after-disposal" })
  emitEnd(root, owner, { id: "durable-after-disposal", runId: "late" }, "error")
  assert.equal(durable.executionState, "running")
  assert.equal(board.revision, revision)
  await assert.rejects(tracker.cancel(durable), /disposed/)
})
