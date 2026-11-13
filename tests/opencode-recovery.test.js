import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

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
        await interrupt?.(request)
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
  { child, parent = "parent-v2", agent = "explore", description = child }
) {
  await captured.toolHooks["execute.before"][0]({
    tool: "subagent",
    sessionID: parent,
    id: `call-${child}`,
    input: { agent, description, background: true, prompt: description },
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
  const { setupParallelV2 } = await import(PARALLEL_PATH)
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
  const { createParallelHooks } = await import(PARALLEL_PATH)
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
  const { createParallelHooks } = await import(PARALLEL_PATH)
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
  const { createParallelHooks } = await import(PARALLEL_PATH)
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
  const { setupParallelV2 } = await import(PARALLEL_PATH)
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

test("restart reconciles running records through host queries", async (t) => {
  const filePath = useTemporaryStorage(t)
  const { setupParallelV2 } = await import(PARALLEL_PATH)
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
  const { setupParallelV2 } = await import(PARALLEL_PATH)
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

test("corrupt stores are preserved and exposed through host diagnostics", async (t) => {
  const filePath = useTemporaryStorage(t)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, "{ definitely not json")
  t.mock.method(console, "warn", () => {})
  const { setupParallelV2 } = await import(PARALLEL_PATH)
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
