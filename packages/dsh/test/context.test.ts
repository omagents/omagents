import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Context } from "@deepseek-ai/cordis"
import { Session, SessionId } from "@deepseek-ai/dsh-session"
import { SUBAGENT_DESCRIPTOR_VERSION } from "@deepseek-ai/dsh-subagent"
import SystemPrompt, { renderContextSnapshot, renderPrompt } from "@deepseek-ai/dsh-system-prompt"
import { getCorePaths, JobBoard, JsonJobStore } from "@omagents/core"

import { createHealthRecords } from "../dist/host/health.js"
import { registerDshContext } from "../dist/host/register-context.js"
import { createSubagentTracker } from "../dist/host/subagent-tracker.js"

function createBoard() {
  let nextId = 0
  return new JobBoard({
    clock: () => 1_000,
    idGenerator: () => `context-job-${++nextId}`,
  })
}

function launch(overrides = {}) {
  return {
    host: "dsh",
    hostTaskId: "context-child-1",
    parentSessionId: "parent-1",
    childName: "context-child",
    agent: "explore",
    description: "Running objective",
    ...overrides,
  }
}

function healthyRecords() {
  return createHealthRecords(() => [])
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
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

function createPromptRegistry(activated) {
  const sections = new Map()
  const contexts = new Map()
  return {
    sections,
    contexts,
    getSectionOrder(name) {
      return name === "TOOL_SUBAGENT" ? 2_800 : 0
    },
    getContextOrder(name) {
      return name === "SUBAGENT_DELEGATION" ? 120 : 0
    },
    section(section) {
      sections.set(section.name, section)
      return () => sections.delete(section.name)
    },
    context(context) {
      contexts.set(context.name, context)
      activated?.resolve()
      return () => contexts.delete(context.name)
    },
  }
}

function occurrences(text, needle) {
  return text.split(needle).length - 1
}

test("DSH prompt has native instructions and one dynamic running/pending Board snapshot", async (t) => {
  const board = createBoard()
  const running = board.registerLaunch(launch())
  const finished = board.registerLaunch(
    launch({
      hostTaskId: "context-child-2",
      agent: "plan",
      description: "Finished objective",
    })
  )
  board.registerLaunch(
    launch({
      hostTaskId: "context-child-3",
      parentSessionId: "parent-2",
      description: "Other parent objective",
    })
  )
  board.markTerminal(finished.id, { state: "completed", resultSummary: "Useful result" })
  const root = new Context()
  await root.plugin(SystemPrompt, { includeHarnessIdentity: false })
  t.after(() => root.fiber.dispose())
  const health = healthyRecords()
  const dispose = registerDshContext(root, board, health)
  const agent = { id: "parent-1", session: { id: "parent-1" } }
  const assemblyContext = { agent, scope: agent }
  const first = await root.systemPrompt.assemble(assemblyContext)
  const firstPrompt = renderPrompt(first)
  const firstContext = renderContextSnapshot(first)
  assert.equal(occurrences(firstPrompt, "<Parallel_Execution>"), 1)
  assert.match(firstPrompt, /native DSH.*subagent|native `subagent`/)
  assert.match(firstPrompt, /parallel_status/)
  assert.doesNotMatch(firstPrompt, /\btask\s*\(\s*background|background\s*:/)
  assert.equal(occurrences(firstContext, "OmAgents State Preservation"), 1)
  assert.equal(occurrences(firstContext, "### Background Job Board"), 1)
  assert.match(firstContext, /#### Running/)
  assert.match(firstContext, new RegExp(`${running.alias}.*running`))
  assert.match(firstContext, /Objective: Running objective/)
  assert.match(firstContext, /#### Pending outcomes/)
  assert.match(firstContext, new RegExp(`${finished.alias}.*completed`))
  assert.match(firstContext, /Result: Useful result/)
  assert.doesNotMatch(firstContext, /Other parent objective/)
  assert.equal(finished.notificationState, "injected")
  const injectedRevision = board.revision

  const second = await root.systemPrompt.assemble(assemblyContext)
  const secondContext = renderContextSnapshot(second)
  assert.equal(occurrences(renderPrompt(second), "<Parallel_Execution>"), 1)
  assert.equal(occurrences(secondContext, "### Background Job Board"), 1)
  assert.match(secondContext, /#### Running/)
  assert.match(secondContext, /Objective: Running objective/)
  assert.doesNotMatch(secondContext, /#### Pending outcomes/)
  assert.doesNotMatch(secondContext, /Result: Useful result/)
  assert.doesNotMatch(secondContext, /Other parent objective/)

  const refreshed = root.systemPrompt.refreshContext(first, assemblyContext)
  assert.equal(
    refreshed.contexts.filter((entry) => entry.name === first.contexts[0].name).length,
    1
  )
  assert.equal(occurrences(renderContextSnapshot(refreshed), "### Background Job Board"), 1)
  assert.equal(board.revision, injectedRevision)
  assert.equal(finished.notificationState, "injected")
  assert.deepEqual(board.listPendingOutcomes("parent-1"), [])
  assert.equal(health.context.status, "ready")
  assert.equal(health.host.status, "ready")

  dispose()
  const afterDisposal = await root.systemPrompt.assemble(assemblyContext)
  assert.doesNotMatch(renderPrompt(afterDisposal), /<Parallel_Execution>/)
  assert.doesNotMatch(renderContextSnapshot(afterDisposal), /OmAgents State Preservation/)
})

test("required state-preservation context is restored after compactable history is removed", async (t) => {
  const board = createBoard()
  board.registerLaunch(launch({ description: "Survives compaction" }))
  const root = new Context()
  await root.plugin(SystemPrompt, { includeHarnessIdentity: false })
  t.after(() => root.fiber.dispose())
  registerDshContext(root, board, healthyRecords())
  const agent = { id: "parent-1", session: { id: "parent-1" } }
  const assemblyContext = { agent, scope: agent }
  const accepted = await root.systemPrompt.assemble(assemblyContext)

  const compacted = root.systemPrompt.refreshContext({ ...accepted, contexts: [] }, assemblyContext)
  const compactedText = renderContextSnapshot(compacted)
  assert.match(compactedText, /OmAgents State Preservation/)
  assert.match(compactedText, /Survives compaction/)
  assert.match(compactedText, /loop_engine\.py status <skill>/)
  const loopEngine = join(getCorePaths().skillsDir, "_shared", "scripts", "loop_engine.py")
  assert.ok(compactedText.includes(`${loopEngine} status <skill>`))
  assert.doesNotMatch(compactedText, /(?:^|\n)\s*loop_engine\.py\s+/)
  assert.match(compactedText, /parallel_status/)
  assert.equal(compacted.contexts.length, 1)
  assert.equal(compacted.contexts[0].interpolate, false)

  const suppressOptional = root.systemPrompt.suppressRuntimeContext()
  const suppressed = await root.systemPrompt.assemble(assemblyContext)
  assert.match(renderContextSnapshot(suppressed), /Survives compaction/)
  assert.match(renderPrompt(suppressed), /<Parallel_Execution>/)
  suppressOptional()
})

test("context projection failures degrade only context health and never reject model assembly", async (t) => {
  let fail = true
  const board = {
    list() {
      if (fail) throw new Error("Board projection exploded")
      return []
    },
    listPendingOutcomes() {
      return []
    },
  }
  const root = new Context()
  await root.plugin(SystemPrompt, { includeHarnessIdentity: false })
  t.after(() => root.fiber.dispose())
  const health = healthyRecords()
  registerDshContext(root, board, health)
  const agent = { id: "parent-1", session: { id: "parent-1" } }

  const failed = await root.systemPrompt.assemble({ agent, scope: agent })
  assert.match(renderContextSnapshot(failed), /OmAgents State Preservation/)
  assert.doesNotMatch(renderContextSnapshot(failed), /Background Job Board/)
  assert.equal(health.context.status, "degraded")
  assert.equal(health.context.diagnostics[0].code, "ERR_DSH_CONTEXT_ASSEMBLY")
  assert.match(health.context.diagnostics[0].message, /Board projection exploded/)
  assert.equal(health.host.status, "ready")
  assert.equal(health.persistence.status, "ready")
  assert.equal(health.skills.status, "ready")
  assert.equal(health.mcp.status, "ready")
  assert.equal(health.python.status, "ready")

  fail = false
  const recovered = await root.systemPrompt.assemble({ agent, scope: agent })
  assert.match(renderContextSnapshot(recovered), /OmAgents State Preservation/)
  assert.equal(health.context.status, "ready")
})

test("context registrar activates late prompt service and never leaks registrations", async (t) => {
  const board = createBoard()
  const health = healthyRecords()
  const root = new Context()
  t.after(() => root.fiber.dispose())
  const dispose = registerDshContext(root, board, health)

  const firstActivation = deferred()
  const first = createPromptRegistry(firstActivation)
  const removeFirst = root.provide("systemPrompt", first)
  await within(firstActivation.promise, "initial context activation")
  assert.equal(first.sections.size, 1)
  assert.equal(first.contexts.size, 1)
  await removeFirst()
  assert.equal(first.sections.size, 0)
  assert.equal(first.contexts.size, 0)

  const secondActivation = deferred()
  const second = createPromptRegistry(secondActivation)
  const removeSecond = root.provide("systemPrompt", second)
  await within(secondActivation.promise, "context reactivation")
  assert.equal(second.sections.size, 1)
  assert.equal(second.contexts.size, 1)

  dispose()
  dispose()
  assert.equal(second.sections.size, 0)
  assert.equal(second.contexts.size, 0)
  await removeSecond()

  const late = createPromptRegistry()
  root.provide("systemPrompt", late)
  await new Promise((resolveTurn) => setImmediate(resolveTurn))
  assert.equal(late.sections.size, 0)
  assert.equal(late.contexts.size, 0)
  assert.equal(health.host.status, "ready")
})

function completedSession(id) {
  const session = Session.create(SessionId(id))
  session.append("subagent/descriptor", {
    version: SUBAGENT_DESCRIPTOR_VERSION,
    mode: "continuable",
    provider: "spawn",
    label: `Recovered ${id}`,
  })
  session.append("turn/start", { turn: 1 })
  session.append("step/start", { turn: 1, step: 1 })
  session.append("turn/end", { turn: 1, reason: { kind: "completed" } })
  return session
}

test("a recovered outcome is injected once and acknowledged at the real parent turn boundary", async (t) => {
  const temporaryDirectory = await fs.mkdtemp(join(tmpdir(), "omagents-dsh-context-recovery-"))
  const filePath = join(temporaryDirectory, "job-board.json")
  const seed = createBoard()
  const recovered = seed.registerLaunch(launch({ description: "Recovered parent outcome" }))
  const otherParent = seed.registerLaunch(
    launch({
      hostTaskId: "context-child-other",
      parentSessionId: "parent-2",
      description: "Other recovered parent outcome",
    })
  )
  const seedStore = new JsonJobStore({ filePath })
  await seedStore.save({ version: 1, revision: seed.revision, jobs: seed.list() })
  await seedStore.close()

  const board = await JobBoard.open({ store: new JsonJobStore({ filePath }) })
  const sessions = new Map([
    [recovered.hostTaskId, completedSession(recovered.hostTaskId)],
    [otherParent.hostTaskId, completedSession(otherParent.hostTaskId)],
  ])
  const root = new Context()
  root.provide("tools", {})
  root.provide("subagents", { interrupt() {} })
  root.provide("agents", { get() {} })
  root.provide("sessionQuery", {
    async readSession(id) {
      const session = sessions.get(id)
      assert.ok(session, `missing recovered Session ${id}`)
      return { session: session.header, events: session.snapshotEvents() }
    },
  })
  await root.plugin(SystemPrompt, { includeHarnessIdentity: false })
  const tracker = createSubagentTracker(root, board)
  const disposeContext = registerDshContext(root, board, healthyRecords())
  t.after(async () => {
    disposeContext()
    tracker.dispose()
    await board.close()
    await root.fiber.dispose()
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  })
  await new Promise((resolveTurn) => setImmediate(resolveTurn))
  await new Promise((resolveTurn) => setImmediate(resolveTurn))

  const restored = board.get(recovered.id)
  const isolated = board.get(otherParent.id)
  assert.equal(restored.executionState, "completed")
  assert.equal(restored.notificationState, "pending")
  assert.equal(isolated.executionState, "completed")
  assert.equal(isolated.notificationState, "pending")

  const parent = { id: "parent-1", session: { id: "parent-1" } }
  const first = await root.systemPrompt.assemble({ agent: parent, scope: parent })
  const firstText = renderContextSnapshot(first)
  assert.match(firstText, /#### Pending outcomes/)
  assert.match(firstText, /Recovered parent outcome/)
  assert.doesNotMatch(firstText, /Other recovered parent outcome/)
  assert.equal(restored.notificationState, "injected")
  assert.equal(isolated.notificationState, "pending")

  await root.serial("agent/turn-stopping", {
    agent: parent,
    turn: 1,
    signal: new AbortController().signal,
  })
  assert.equal(restored.notificationState, "acknowledged")
  assert.equal(isolated.notificationState, "pending")

  const second = await root.systemPrompt.assemble({ agent: parent, scope: parent })
  const secondText = renderContextSnapshot(second)
  assert.doesNotMatch(secondText, /#### Pending outcomes/)
  assert.doesNotMatch(secondText, /Recovered parent outcome/)
  assert.equal(restored.notificationState, "acknowledged")
  assert.equal(isolated.notificationState, "pending")

  const other = { id: "parent-2", session: { id: "parent-2" } }
  const otherAssembly = await root.systemPrompt.assemble({ agent: other, scope: other })
  assert.match(renderContextSnapshot(otherAssembly), /Other recovered parent outcome/)
  assert.equal(isolated.notificationState, "injected")
  assert.equal(restored.notificationState, "acknowledged")
})
