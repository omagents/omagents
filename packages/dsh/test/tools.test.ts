import { test } from "node:test"
import assert from "node:assert/strict"

import { Context } from "@deepseek-ai/cordis"
import CommandRuntime from "@deepseek-ai/dsh-commands"
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools"
import { JobBoard, buildParallelStatus } from "@omagents/core"

import { createHealthRecords } from "../dist/host/health.js"
import { registerDshCommands } from "../dist/host/register-commands.js"
import { registerDshTools } from "../dist/host/register-tools.js"

function createBoard() {
  let now = 1_000
  let nextId = 0
  const board = new JobBoard({
    clock: () => now,
    idGenerator: () => `dsh-job-${++nextId}`,
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
    host: "dsh",
    hostTaskId: "child-1",
    parentSessionId: "parent-1",
    childName: "child-one",
    agent: "explore",
    description: "Inspect the current project",
    ...overrides,
  }
}

function healthyRecords() {
  return createHealthRecords(() => [])
}

function createToolRegistry(activated) {
  const definitions = new Map()
  return {
    definitions,
    register(definition) {
      definitions.set(definition.name, definition)
      activated?.resolve()
      return () => definitions.delete(definition.name)
    },
  }
}

function createCommandRegistry(activated) {
  const definitions = new Map()
  return {
    definitions,
    register(definition) {
      definitions.set(definition.name, definition)
      activated?.resolve()
      return () => definitions.delete(definition.name)
    },
    find(_agent, name) {
      return definitions.get(name)
    },
  }
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

test("parallel_status is the only model tool and returns canonical read-only Core JSON", async () => {
  const { board, setNow } = createBoard()
  const running = board.registerLaunch(launch())
  const finished = board.registerLaunch(
    launch({ hostTaskId: "child-2", description: "Completed research", agent: "plan" })
  )
  board.registerLaunch(launch({ hostTaskId: "child-3", parentSessionId: "parent-2" }))
  setNow(3_000)
  board.markTerminal(finished.id, { state: "completed", resultSummary: "done" })
  setNow(6_000)
  const registry = createToolRegistry()
  const health = healthyRecords()
  const dispose = registerDshTools({ tools: registry }, board, health)

  assert.deepEqual([...registry.definitions.keys()], ["parallel_status"])
  assert.equal(registry.definitions.has("cancel_task"), false)
  const definition = registry.definitions.get("parallel_status")
  assert.equal(definition.isConcurrencySafe({}), true)
  assert.doesNotMatch(definition.description, /\btask\s*\(|background\s*:/)

  const revision = board.revision
  const scoped = await definition.execute({ session_id: "parent-1" }, {})
  assert.deepEqual(scoped, buildParallelStatus(board, "parent-1"))
  assert.equal(scoped.total, 2)
  assert.equal(scoped.running, 1)
  assert.equal(scoped.completed, 1)
  assert.equal(scoped.pendingOutcomes, 1)
  assert.equal(scoped.tasks.find((job) => job.id === running.id).elapsedSeconds, 5)
  assert.deepEqual(validateJsonSchemaValue(definition.output.schema, scoped), [])

  const unscoped = await definition.execute({}, {})
  assert.equal(unscoped.total, 3)
  const rendered = definition.output.render({ session_id: "parent-1" }, scoped)
  assert.deepEqual(rendered, [{ type: "text", text: JSON.stringify(scoped, null, 2) }])
  assert.equal(board.revision, revision)
  assert.equal(finished.notificationState, "pending")
  assert.deepEqual(board.listPendingOutcomes("parent-1"), [finished])
  assert.equal(health.tools.status, "ready")
  assert.equal(health.host.status, "ready")

  dispose()
  dispose()
  assert.equal(registry.definitions.size, 0)
})

test("DSH validates parallel_status arguments before reading the Board", async () => {
  const { board } = createBoard()
  const registry = createToolRegistry()
  registerDshTools({ tools: registry }, board, healthyRecords())
  const definition = registry.definitions.get("parallel_status")

  for (const args of [null, [], { session_id: 42 }, { session_id: null }]) {
    await assert.rejects(definition.execute(args, {}), (error) => {
      assert.equal(error.code, "INVALID_ARGS")
      assert.match(error.message, /invalid arguments/)
      return true
    })
  }
  assert.equal((await definition.execute({}, {})).total, 0)
})

test("/ps reads the calling session's Board directly without creating a model message", async (t) => {
  const { board } = createBoard()
  const current = board.registerLaunch(launch({ description: "Current session work" }))
  board.registerLaunch(
    launch({ hostTaskId: "child-2", parentSessionId: "parent-2", description: "Other session" })
  )
  const root = new Context()
  await root.plugin(CommandRuntime)
  t.after(() => root.fiber.dispose())
  const health = healthyRecords()
  const dispose = registerDshCommands(root, board, health)
  const agent = { id: "parent-1", session: { id: "parent-1" }, promptCalls: [] }
  const revision = board.revision

  const command = root.commands.find(agent, "ps")
  assert.ok(command)
  const result = await command.handler({ agent, rawInput: "" })
  assert.equal(result.kind, "success")
  assert.match(result.text, /Alias \| Agent \| Status \| Elapsed \| Description/)
  assert.match(result.text, new RegExp(current.alias))
  assert.match(result.text, /Current session work/)
  assert.doesNotMatch(result.text, /Other session/)
  assert.equal(agent.promptCalls.length, 0)
  assert.equal(board.revision, revision)
  assert.equal(current.notificationState, undefined)
  assert.equal(health.commands.status, "ready")
  assert.equal(health.host.status, "ready")

  dispose()
  assert.equal(root.commands.find(agent, "ps"), undefined)
})

test("tool and command registrars activate late services and compose repeat-safe cleanup", async (t) => {
  const { board } = createBoard()
  const health = healthyRecords()
  const root = new Context()
  t.after(() => root.fiber.dispose())
  const disposeTools = registerDshTools(root, board, health)
  const disposeCommands = registerDshCommands(root, board, health)

  const firstToolActivation = deferred()
  const firstCommandActivation = deferred()
  const firstTools = createToolRegistry(firstToolActivation)
  const firstCommands = createCommandRegistry(firstCommandActivation)
  const removeTools = root.provide("tools", firstTools)
  const removeCommands = root.provide("commands", firstCommands)
  await within(
    Promise.all([firstToolActivation.promise, firstCommandActivation.promise]),
    "initial tool and command activation"
  )
  assert.equal(firstTools.definitions.size, 1)
  assert.equal(firstCommands.definitions.size, 1)

  await removeTools()
  await removeCommands()
  assert.equal(firstTools.definitions.size, 0)
  assert.equal(firstCommands.definitions.size, 0)

  const secondToolActivation = deferred()
  const secondCommandActivation = deferred()
  const secondTools = createToolRegistry(secondToolActivation)
  const secondCommands = createCommandRegistry(secondCommandActivation)
  const removeSecondTools = root.provide("tools", secondTools)
  const removeSecondCommands = root.provide("commands", secondCommands)
  await within(
    Promise.all([secondToolActivation.promise, secondCommandActivation.promise]),
    "tool and command reactivation"
  )

  disposeTools()
  disposeTools()
  disposeCommands()
  disposeCommands()
  assert.equal(secondTools.definitions.size, 0)
  assert.equal(secondCommands.definitions.size, 0)
  await removeSecondTools()
  await removeSecondCommands()

  const lateTools = createToolRegistry()
  const lateCommands = createCommandRegistry()
  root.provide("tools", lateTools)
  root.provide("commands", lateCommands)
  await new Promise((resolveTurn) => setImmediate(resolveTurn))
  assert.equal(lateTools.definitions.size, 0)
  assert.equal(lateCommands.definitions.size, 0)
  assert.equal(health.host.status, "ready")
})
