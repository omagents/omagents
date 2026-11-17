import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { importModule } from "./import-module.js"

const ROOT = path.resolve(import.meta.dirname, "..")
const PARALLEL_PATH = path.join(ROOT, "packages", "opencode", "src", "parallel.js")
const SENTINEL = "SENTINEL: omagents-job-board-v1"

function useTemporaryStorage(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-opencode-recovery-"))
  const previousDataHome = process.env.XDG_DATA_HOME
  const previousShell = process.env.SHELL
  process.env.XDG_DATA_HOME = directory
  process.env.SHELL = "omagents-test-shell"
  t.after(() => {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previousDataHome
    if (previousShell === undefined) delete process.env.SHELL
    else process.env.SHELL = previousShell
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return path.join(directory, "opencode", "storage", "omagents", "job-board.json")
}

function createEventChannel() {
  const queue = []
  const waiters = new Set()
  const notify = () => {
    for (const resolve of waiters) resolve()
    waiters.clear()
  }
  return {
    push(event) {
      queue.push(event)
      notify()
    },
    subscribe({ signal } = {}) {
      signal?.addEventListener("abort", notify, { once: true })
      return {
        async *[Symbol.asyncIterator]() {
          while (!signal?.aborted || queue.length > 0) {
            if (queue.length > 0) {
              yield queue.shift()
              continue
            }
            await new Promise((resolve) => waiters.add(resolve))
          }
        },
      }
    },
  }
}

function makeV2Context(filePath, { getSession, interrupt } = {}) {
  const captured = { tools: new Map(), commands: [], toolHooks: {}, sessionHooks: {} }
  const events = createEventChannel()
  const interruptions = []
  const ctx = {
    omagents: { jobStorePath: filePath },
    tool: {
      transform: async (cb) => cb({ add: (tool) => captured.tools.set(tool.name, tool) }),
      hook: async (name, cb) => (captured.toolHooks[name] ||= []).push(cb),
    },
    session: {
      hook: async (name, cb) => (captured.sessionHooks[name] ||= []).push(cb),
      get: getSession || (async ({ sessionID }) => ({ id: sessionID, status: "running" })),
      interrupt: async (request) => {
        interruptions.push(request)
        if (interrupt) return await interrupt(request)
        return { interrupted: true }
      },
      prompt: async () => {},
    },
    command: {
      list: async () => [],
      transform: async (cb) => cb({ add: (command) => captured.commands.push(command) }),
    },
    event: { subscribe: events.subscribe },
  }
  return { ctx, captured, events, interruptions }
}

async function launchV2(
  captured,
  { child, parent = "parent-v2", agent = "explore", description = child, followUp = false }
) {
  await captured.toolHooks["execute.before"][0]({
    tool: "subagent",
    sessionID: parent,
    id: `call-${child}`,
    input: {
      agent,
      description,
      prompt: description,
      ...(followUp ? { sessionID: child } : {}),
    },
  })
  await captured.toolHooks["execute.after"][0]({
    tool: "subagent",
    sessionID: parent,
    id: `call-${child}`,
    status: "completed",
    result: { metadata: { sessionID: child, status: "running" } },
  })
}

async function statusV2(captured, sessionId) {
  const result = await captured.tools.get("parallel_status").execute({ session_id: sessionId })
  return JSON.parse(result.content)
}

async function contextV2(captured, sessionID, text, extraMessages = []) {
  const event = {
    sessionID,
    system: [],
    messages: [...extraMessages, { role: "user", content: [{ type: "text", text }] }],
  }
  await captured.sessionHooks.context.at(-1)(event)
  return event
}

function completionNotice(child, state = "completed", body = "done") {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `<subagent sessionID="${child}" state="${state}" description="job">${body}</subagent>`,
      },
    ],
  }
}

function readStore(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

async function waitFor(predicate, message = "condition") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await predicate()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`Timed out waiting for ${message}`)
}

async function waitForStoreJobs(filePath, children) {
  return waitFor(
    () => {
      try {
        const snapshot = readStore(filePath)
        const jobs = Array.isArray(snapshot) ? snapshot : snapshot.jobs
        return children.every((child) =>
          jobs?.some((job) => (job.hostTaskId ?? job.taskID) === child)
        )
          ? snapshot
          : undefined
      } catch {
        return undefined
      }
    },
    `persisted jobs: ${children.join(", ")}`
  )
}

function jobByHostId(status, child) {
  return status.tasks.find((job) => job.task_id === child)
}

function makeV1Context(filePath, { getSession } = {}) {
  const aborts = []
  return {
    aborts,
    ctx: {
      omagents: { jobStorePath: filePath },
      client: {
        session: {
          abort: async (request) => aborts.push(request),
          get: getSession || (async ({ path: { id } }) => ({ data: { id, status: "running" } })),
        },
      },
    },
  }
}

async function launchV1(hooks, { child, parent = "parent-v1", state = "running" }) {
  await hooks["tool.execute.before"](
    { tool: "task", sessionID: parent, callID: `call-${child}` },
    { args: { subagent_type: "explore", description: child, background: true } }
  )
  await hooks["tool.execute.after"](
    { tool: "task", sessionID: parent, callID: `call-${child}` },
    { output: `<task id="${child}" state="${state}"></task>` }
  )
}

function v1Message(child, state, id, body = "done") {
  return {
    info: { id, role: "user", sessionID: "parent-v1" },
    parts: [
      {
        id: `part-${id}`,
        type: "text",
        synthetic: true,
        text: `<task id="${child}" state="${state}"><task_result>${body}</task_result></task>`,
      },
    ],
  }
}

async function transformV1(hooks, messages) {
  const output = { messages }
  await hooks["experimental.chat.messages.transform"]({ sessionID: "parent-v1" }, output)
  return output
}

async function statusV1(hooks) {
  return JSON.parse(await hooks.tool.parallel_status.execute({}))
}

test("V2 cancellation waits for authoritative lifecycle settlement", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const { ctx, captured, events, interruptions } = makeV2Context(filePath)
  const cleanup = await setupParallelV2(ctx)
  const child = "v2-cancel-child"
  try {
    await launchV2(captured, { child })
    const tuiPath = path.join(path.dirname(filePath), "tui-state.json")
    const runningTui = JSON.parse(fs.readFileSync(tuiPath, "utf8"))
    assert.equal(runningTui.running, 1)
    assert.equal(runningTui.jobs[0].state, "running")
    const launched = jobByHostId(await statusV2(captured), child)
    const accepted = await captured.tools.get("cancel_task").execute({ task_id: launched.alias })
    assert.match(accepted.content, /Cancellation requested/i)
    assert.equal(interruptions.length, 1)
    assert.equal(jobByHostId(await statusV2(captured), child).state, "cancelling")
    assert.equal(JSON.parse(fs.readFileSync(tuiPath, "utf8")).jobs[0].state, "cancelling")

    events.push({ type: "session.execution.interrupted", data: { sessionID: child } })
    await waitFor(async () => jobByHostId(await statusV2(captured), child)?.state === "cancelled")
    assert.equal(jobByHostId(await statusV2(captured), child).state, "cancelled")
  } finally {
    await cleanup?.()
  }
  const persisted = readStore(filePath)
  assert.equal(persisted.jobs[0].executionState, "cancelled")
  assert.equal(persisted.jobs[0].notificationState, "pending")
})

test("V1 cancellation waits for authoritative lifecycle settlement", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { createParallelHooks } = await importModule(PARALLEL_PATH)
  const { ctx, aborts } = makeV1Context(filePath)
  const hooks = createParallelHooks(ctx)
  const child = "v1-cancel-child"
  await launchV1(hooks, { child })
  const accepted = await hooks.tool.cancel_task.execute({ task_id: child })
  assert.match(accepted, /Cancellation requested/i)
  assert.equal(aborts.length, 1)
  assert.equal(jobByHostId(await statusV1(hooks), child).state, "cancelling")

  await hooks.event({
    event: { type: "session.execution.interrupted", properties: { sessionID: child } },
  })
  assert.equal(jobByHostId(await statusV1(hooks), child).state, "cancelled")
})

test("V1 duplicate completion notices inject one outcome", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { createParallelHooks } = await importModule(PARALLEL_PATH)
  const { ctx } = makeV1Context(filePath)
  const hooks = createParallelHooks(ctx)
  const child = "v1-duplicate-child"
  await launchV1(hooks, { child })
  const first = await transformV1(hooks, [
    v1Message(child, "completed", "message-1", "first result"),
  ])
  const second = await transformV1(hooks, [
    v1Message(child, "completed", "message-2", "duplicate result"),
  ])
  const count = (output) =>
    output.messages.at(-1).parts.filter((part) => part.text?.includes(SENTINEL)).length
  assert.equal(count(first), 1)
  assert.equal(count(second), 0)
  assert.equal(jobByHostId(await statusV1(hooks), child).result, "first result")
})

test("legacy error and reconciled labels are adapter serializations", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { createParallelHooks } = await importModule(PARALLEL_PATH)
  const { ctx } = makeV1Context(filePath)
  const hooks = createParallelHooks(ctx)
  const child = "v1-error-child"
  await launchV1(hooks, { child })
  await transformV1(hooks, [v1Message(child, "error", "error-message", "host failure")])
  assert.equal(jobByHostId(await statusV1(hooks), child).state, "error")

  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "parent-v1" } } })
  assert.equal(jobByHostId(await statusV1(hooks), child).state, "reconciled")
  await waitFor(() => {
    try {
      const snapshot = readStore(filePath)
      return (
        !Array.isArray(snapshot) &&
        snapshot.jobs.find((job) => job.hostTaskId === child)?.notificationState === "acknowledged"
      )
    } catch {
      return false
    }
  }, "acknowledged Core outcome")
  const persisted = readStore(filePath)
  const failed = persisted.jobs.find((job) => job.hostTaskId === child)
  assert.equal(failed.executionState, "failed")
  assert.equal(failed.notificationState, "acknowledged")
})

test("V2 duplicate completion notices inject one outcome", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const { ctx, captured } = makeV2Context(filePath)
  const cleanup = await setupParallelV2(ctx)
  const child = "v2-duplicate-child"
  try {
    await launchV2(captured, { child })
    const first = await contextV2(captured, "parent-v2", "first turn", [
      completionNotice(child, "completed", "first result"),
    ])
    const second = await contextV2(captured, "parent-v2", "second turn", [
      completionNotice(child, "completed", "duplicate result"),
    ])
    const count = (event) =>
      event.messages.at(-1).content.filter((part) => part.text?.includes(SENTINEL)).length
    assert.equal(count(first), 1)
    assert.equal(count(second), 0)
    assert.equal(jobByHostId(await statusV2(captured), child).result, "first result")
  } finally {
    await cleanup?.()
  }
})

test("V2 follow-up rounds stay native-only and never regress the initial outcome", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const { ctx, captured } = makeV2Context(filePath)
  const cleanup = await setupParallelV2(ctx)
  const child = "v2-follow-up-child"
  try {
    await launchV2(captured, { child })
    await contextV2(captured, "parent-v2", "first round", [
      completionNotice(child, "completed", "first result"),
    ])
    const initial = await statusV2(captured)
    assert.equal(jobByHostId(initial, child).result, "first result")

    await launchV2(captured, { child, followUp: true, description: "follow up" })
    await contextV2(captured, "parent-v2", "second round", [
      completionNotice(child, "completed", "first result"),
      completionNotice(child, "completed", "second result"),
    ])
    const current = await statusV2(captured)
    assert.equal(current.total, 1, "follow-ups must not duplicate the child job")
    assert.equal(
      current.revision,
      initial.revision,
      "native-only follow-ups must not rewrite the Board"
    )
    assert.equal(jobByHostId(current, child).state, "completed")
    assert.equal(jobByHostId(current, child).result, "first result")
  } finally {
    await cleanup?.()
  }
})

test("restart reconciles running records through host queries", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const activeChild = "v2-restart-active"
  const missingChild = "v2-restart-missing"
  const unreadableChild = "v2-restart-unreadable"
  const first = makeV2Context(filePath)
  const firstCleanup = await setupParallelV2(first.ctx)
  try {
    await launchV2(first.captured, { child: activeChild })
    await launchV2(first.captured, { child: missingChild })
    await launchV2(first.captured, { child: unreadableChild })
  } finally {
    await firstCleanup?.()
  }
  await waitForStoreJobs(filePath, [activeChild, missingChild, unreadableChild])

  const restarted = makeV2Context(filePath, {
    getSession: async ({ sessionID }) => {
      if (sessionID === activeChild) return { id: sessionID, status: "running" }
      if (sessionID === unreadableChild) throw new Error("host result permissions denied")
      return null
    },
  })
  const restartedCleanup = await setupParallelV2(restarted.ctx)
  try {
    const status = await statusV2(restarted.captured)
    assert.equal(jobByHostId(status, activeChild).state, "running")
    assert.equal(jobByHostId(status, missingChild).state, "interrupted")
    assert.equal(jobByHostId(status, missingChild).error.code, "HOST_MISSING")
    assert.equal(jobByHostId(status, unreadableChild).state, "interrupted")
    assert.equal(jobByHostId(status, unreadableChild).error.code, "HOST_UNREADABLE")
    const injected = await contextV2(restarted.captured, "parent-v2", "resume")
    assert.ok(injected.messages.at(-1).content[0].text.includes(SENTINEL))
    assert.match(injected.messages.at(-1).content[0].text, /interrupted/)
  } finally {
    await restartedCleanup?.()
  }
  const persisted = readStore(filePath)
  assert.equal(
    persisted.jobs.find((job) => job.hostTaskId === activeChild).executionState,
    "running"
  )
  assert.equal(
    persisted.jobs.find((job) => job.hostTaskId === missingChild).notificationState,
    "injected"
  )
  assert.equal(
    persisted.jobs.find((job) => job.hostTaskId === unreadableChild).notificationState,
    "injected"
  )
})

test("pending outcomes survive restart without duplicate injection", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const child = "v2-pending-restart"
  const first = makeV2Context(filePath)
  const firstCleanup = await setupParallelV2(first.ctx)
  try {
    await launchV2(first.captured, { child })
    first.events.push({ type: "session.execution.succeeded", data: { sessionID: child } })
    await waitFor(
      async () => jobByHostId(await statusV2(first.captured), child)?.state === "completed"
    )
  } finally {
    await firstCleanup?.()
  }
  const persisted = await waitForStoreJobs(filePath, [child])
  if (!Array.isArray(persisted)) {
    assert.equal(
      persisted.jobs.find((job) => job.hostTaskId === child).notificationState,
      "pending"
    )
  }

  const restarted = makeV2Context(filePath)
  const restartedCleanup = await setupParallelV2(restarted.ctx)
  try {
    const firstContext = await contextV2(restarted.captured, "parent-v2", "first resumed turn")
    const secondContext = await contextV2(restarted.captured, "parent-v2", "second resumed turn")
    assert.ok(firstContext.messages.at(-1).content[0].text.includes(SENTINEL))
    assert.equal(
      secondContext.messages.at(-1).content.some((part) => part.text?.includes(SENTINEL)),
      false
    )
    restarted.events.push({ type: "session.idle", data: { sessionID: "parent-v2" } })
    await waitFor(
      async () => jobByHostId(await statusV2(restarted.captured), child)?.state === "reconciled"
    )
  } finally {
    await restartedCleanup?.()
  }
})

test("restart reads actual V2 outcomes and rejects ambiguous Host responses", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const children = {
    active: "v2-outcome-active",
    succeeded: "v2-outcome-succeeded",
    failed: "v2-outcome-failed",
    interrupted: "v2-outcome-interrupted",
    statusless: "v2-outcome-statusless",
    unknown: "v2-outcome-unknown",
  }
  const first = makeV2Context(filePath)
  const firstCleanup = await setupParallelV2(first.ctx)
  try {
    for (const child of Object.values(children)) await launchV2(first.captured, { child })
  } finally {
    await firstCleanup?.()
  }
  await waitForStoreJobs(filePath, Object.values(children))

  const restarted = makeV2Context(filePath, {
    getSession: async ({ sessionID }) => {
      if (sessionID === children.active) return { id: sessionID, status: "running" }
      if (sessionID === children.succeeded) {
        return { id: sessionID, outcome: "succeeded", result: "recovered result" }
      }
      if (sessionID === children.failed) {
        return { id: sessionID, outcome: "failed", error: { message: "recovered failure" } }
      }
      if (sessionID === children.interrupted) return { id: sessionID, outcome: "interrupted" }
      if (sessionID === children.unknown) return { id: sessionID, outcome: "future-outcome" }
      return { id: sessionID }
    },
  })
  const restartedCleanup = await setupParallelV2(restarted.ctx)
  try {
    const status = await statusV2(restarted.captured)
    assert.equal(jobByHostId(status, children.active).state, "running")
    assert.equal(jobByHostId(status, children.succeeded).state, "completed")
    assert.equal(jobByHostId(status, children.succeeded).result, "recovered result")
    assert.equal(jobByHostId(status, children.failed).state, "error")
    assert.equal(jobByHostId(status, children.failed).error.message, "recovered failure")
    assert.equal(jobByHostId(status, children.interrupted).state, "cancelled")
    assert.equal(jobByHostId(status, children.statusless).state, "interrupted")
    assert.equal(jobByHostId(status, children.statusless).error.code, "HOST_UNREADABLE")
    assert.equal(jobByHostId(status, children.unknown).state, "interrupted")
    assert.equal(jobByHostId(status, children.unknown).error.code, "HOST_UNREADABLE")
  } finally {
    await restartedCleanup?.()
  }
})

test("V2 declined interruption does not enter cancelling", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const { ctx, captured, interruptions } = makeV2Context(filePath, {
    interrupt: async () => ({ interrupted: false }),
  })
  const cleanup = await setupParallelV2(ctx)
  const child = "v2-cancel-declined"
  try {
    await launchV2(captured, { child })
    const launched = jobByHostId(await statusV2(captured), child)
    const declined = await captured.tools.get("cancel_task").execute({ task_id: launched.alias })
    assert.match(declined.content, /not accept|declined/i)
    assert.equal(interruptions.length, 1)
    assert.equal(jobByHostId(await statusV2(captured), child).state, "running")
  } finally {
    await cleanup?.()
  }
})

test("independent Host contexts share one Board by storage identity", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const first = makeV2Context(filePath)
  const second = makeV2Context(filePath)
  const [firstCleanup, secondCleanup] = await Promise.all([
    setupParallelV2(first.ctx),
    setupParallelV2(second.ctx),
  ])
  try {
    await launchV2(first.captured, { child: "v2-shared-first" })
    await launchV2(second.captured, { child: "v2-shared-second" })
    const firstStatus = await statusV2(first.captured)
    const secondStatus = await statusV2(second.captured)
    for (const child of ["v2-shared-first", "v2-shared-second"]) {
      assert.ok(jobByHostId(firstStatus, child), `first context sees ${child}`)
      assert.ok(jobByHostId(secondStatus, child), `second context sees ${child}`)
    }
    assert.equal(
      jobByHostId(firstStatus, "v2-shared-first").id,
      jobByHostId(secondStatus, "v2-shared-first").id
    )

    await secondCleanup?.()
    await launchV2(first.captured, { child: "v2-shared-after-other-cleanup" })
    assert.ok(jobByHostId(await statusV2(first.captured), "v2-shared-after-other-cleanup"))
  } finally {
    await secondCleanup?.()
    await firstCleanup?.()
  }
  const persisted = readStore(filePath)
  assert.equal(persisted.jobs.length, 3)
  assert.equal(new Set(persisted.jobs.map((job) => job.id)).size, 3)
  assert.equal(new Set(persisted.jobs.map((job) => job.alias)).size, 3)
})

test("repeated setup reconciles once and reference-counts Board ownership", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const seed = makeV2Context(filePath)
  const seedCleanup = await setupParallelV2(seed.ctx)
  try {
    await launchV2(seed.captured, { child: "v2-repeated-seed" })
  } finally {
    await seedCleanup?.()
  }

  let queries = 0
  const repeated = makeV2Context(filePath, {
    getSession: async ({ sessionID }) => {
      queries += 1
      return { id: sessionID, status: "running" }
    },
  })
  const firstCleanup = await setupParallelV2(repeated.ctx)
  const secondCleanup = await setupParallelV2(repeated.ctx)
  try {
    assert.equal(queries, 1, "shared initialization reconciles only once")
    await secondCleanup?.()
    await launchV2(repeated.captured, { child: "v2-repeated-after-cleanup" })
    assert.ok(jobByHostId(await statusV2(repeated.captured), "v2-repeated-after-cleanup"))
  } finally {
    await secondCleanup?.()
    await firstCleanup?.()
  }
})

test("a new pending outcome replaces an old sentinel block before injection", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const { ctx, captured } = makeV2Context(filePath)
  const cleanup = await setupParallelV2(ctx)
  const firstChild = "v2-sentinel-first"
  const secondChild = "v2-sentinel-second"
  try {
    await launchV2(captured, { child: firstChild })
    await launchV2(captured, { child: secondChild })
    const first = await contextV2(captured, "parent-v2", "original instructions", [
      completionNotice(firstChild, "completed", "first outcome"),
    ])
    const oldText = first.messages
      .at(-1)
      .content[0].text.replace("\n<!-- omagents-job-board-end -->", "")
    assert.ok(oldText.includes("first outcome"))

    const second = await contextV2(captured, "parent-v2", oldText, [
      completionNotice(secondChild, "completed", "second outcome"),
    ])
    const updatedText = second.messages.at(-1).content[0].text
    assert.ok(updatedText.includes("second outcome"), "new outcome is present in context")
    assert.ok(updatedText.includes("original instructions"), "original text is preserved")
    assert.equal(updatedText.split(SENTINEL).length - 1, 1, "one current Board block")
    assert.equal(jobByHostId(await statusV2(captured), secondChild).notificationState, "injected")
  } finally {
    await cleanup?.()
  }
})

test("V1 store initialization failure degrades context injection independently", async (t) => {
  const filePath = useTemporaryStorage(t)
  fs.mkdirSync(filePath, { recursive: true })
  const { createParallelHooks } = await importModule(PARALLEL_PATH)
  const { ctx } = makeV1Context(filePath)
  const hooks = createParallelHooks(ctx)
  const message = {
    info: { id: "init-failure-message", role: "user", sessionID: "parent-v1" },
    parts: [{ type: "text", text: "model request survives" }],
  }

  await assert.doesNotReject(() => transformV1(hooks, [message]))
  assert.equal(message.parts[0].text, "model request survives")
  const system = { system: [] }
  await assert.doesNotReject(() => hooks["experimental.chat.system.transform"]({}, system))
  assert.equal(system.system.length, 1)
})

test("a completion notice backfills a result after lifecycle settlement", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const { ctx, captured, events } = makeV2Context(filePath)
  const cleanup = await setupParallelV2(ctx)
  const child = "v2-late-result"
  try {
    await launchV2(captured, { child })
    events.push({ type: "session.execution.succeeded", data: { sessionID: child } })
    await waitFor(async () => jobByHostId(await statusV2(captured), child)?.state === "completed")
    assert.equal(jobByHostId(await statusV2(captured), child).result, undefined)

    const injected = await contextV2(captured, "parent-v2", "late result turn", [
      completionNotice(child, "completed", "late lifecycle result"),
    ])
    assert.equal(jobByHostId(await statusV2(captured), child).result, "late lifecycle result")
    assert.ok(injected.messages.at(-1).content[0].text.includes("late lifecycle result"))
  } finally {
    await cleanup?.()
  }
})

test("setup overlapping final close waits before reopening the storage identity", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const { JobBoard } = await importModule(path.join(ROOT, "packages", "core", "src", "index.js"))
  const originalOpen = JobBoard.open
  const originalClose = JobBoard.prototype.close
  let openCount = 0
  let releaseClose
  let notifyCloseStarted
  const closeStarted = new Promise((resolve) => {
    notifyCloseStarted = resolve
  })

  t.mock.method(JobBoard, "open", async function (...args) {
    openCount += 1
    return originalOpen.apply(this, args)
  })
  t.mock.method(JobBoard.prototype, "close", async function (...args) {
    if (releaseClose === undefined) {
      notifyCloseStarted()
      await new Promise((resolve) => {
        releaseClose = resolve
      })
    }
    return originalClose.apply(this, args)
  })

  const first = makeV2Context(filePath)
  const firstCleanup = await setupParallelV2(first.ctx)
  await launchV2(first.captured, { child: "v2-close-race-first" })
  const second = makeV2Context(filePath)
  let firstCleanupPromise
  let secondSetupPromise
  let secondCleanup
  try {
    firstCleanupPromise = firstCleanup()
    await closeStarted

    let secondSettled = false
    secondSetupPromise = setupParallelV2(second.ctx).then((cleanup) => {
      secondSettled = true
      secondCleanup = cleanup
      return cleanup
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(openCount, 1, "no second Board opens while the final close is held")
    assert.equal(secondSettled, false, "setup waits for close settlement")

    releaseClose()
    secondCleanup = await secondSetupPromise
    assert.equal(openCount, 2, "a fresh Board opens only after close settles")
    await launchV2(second.captured, { child: "v2-close-race-second" })
    assert.ok(jobByHostId(await statusV2(second.captured), "v2-close-race-second"))
  } finally {
    releaseClose?.()
    await firstCleanupPromise
    if (secondSetupPromise) secondCleanup = await secondSetupPromise
    await secondCleanup?.()
  }

  const persisted = readStore(filePath)
  assert.deepEqual(persisted.jobs.map((job) => job.hostTaskId).sort(), [
    "v2-close-race-first",
    "v2-close-race-second",
  ])
})

test("corrupt stores are preserved and exposed through host diagnostics", async (t) => {
  const filePath = useTemporaryStorage(t)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, "{ definitely not json")
  t.mock.method(console, "warn", () => {})
  const { setupParallelV2 } = await importModule(PARALLEL_PATH)
  const { ctx, captured } = makeV2Context(filePath)
  const cleanup = await setupParallelV2(ctx)
  try {
    const status = await statusV2(captured)
    assert.ok(status.diagnostics.some((entry) => entry.code === "ERR_JOB_STORE_CORRUPT"))
    const backups = fs
      .readdirSync(path.dirname(filePath))
      .filter((name) => name.startsWith("job-board.json.corrupt-"))
    assert.equal(backups.length, 1)
    assert.equal(
      fs.readFileSync(path.join(path.dirname(filePath), backups[0]), "utf8"),
      "{ definitely not json"
    )
  } finally {
    await cleanup?.()
  }
})
