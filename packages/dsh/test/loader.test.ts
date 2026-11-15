import { test, type TestContext } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { Context } from "@deepseek-ai/cordis"
import Loader from "@deepseek-ai/cordis-plugin-loader"
import SkillRegistry from "@deepseek-ai/dsh-skill"
import SystemPrompt from "@deepseek-ai/dsh-system-prompt"

import type { DshRuntime } from "../dist/host/runtime.js"
import { OmAgentsRemote } from "../dist/host/remote-service.js"

const launch = {
  host: "dsh",
  hostTaskId: "loader-smoke-task",
  parentSessionId: "loader-smoke-parent",
  childName: "loader-smoke-child",
  agent: "explore",
  description: "Verify the real DSH Loader and durable disposal",
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

async function createIsolatedProfile(t: TestContext) {
  const home = await fs.mkdtemp(join(tmpdir(), "omagents-dsh-home-"))
  const userHome = join(home, "user-home")
  const profileDir = join(home, "profiles", "web")
  await fs.mkdir(profileDir, { recursive: true })
  await fs.mkdir(userHome, { recursive: true })
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const installedPackageDir = join(profileDir, "node_modules", "@omagents", "omagents-dsh")
  await fs.mkdir(dirname(installedPackageDir), { recursive: true })
  await fs.symlink(
    packageDir,
    installedPackageDir,
    process.platform === "win32" ? "junction" : "dir"
  )
  const previousHome = process.env.DSH_HOME
  const previousUserHome = process.env.HOME
  const previousUserProfile = process.env.USERPROFILE
  const previousModelKey = process.env.DEEPSEEK_API_KEY
  process.env.DSH_HOME = home
  process.env.HOME = userHome
  process.env.USERPROFILE = userHome
  delete process.env.DEEPSEEK_API_KEY

  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousUserHome === undefined) delete process.env.HOME
    else process.env.HOME = previousUserHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
    if (previousModelKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousModelKey
    await fs.rm(home, { recursive: true, force: true })
  })

  return {
    home,
    profileDir,
    baseUrl: pathToFileURL(`${profileDir}${sep}`).href,
  }
}

async function createTestLoaderWithRequiredServices(t: TestContext) {
  const profile = await createIsolatedProfile(t)
  const root = new Context()
  root.provide("omagentsPython", {
    async ensureBaseEnvironment() {
      return { status: "test-isolated" }
    },
  })
  await root.plugin(Loader, { baseUrl: profile.baseUrl })
  t.after(() => root.fiber.dispose())

  // The real Loader is the Host's only required service at this milestone.
  // Later harness services must not be invented merely to make this smoke test pass.
  return { root, loader: root.loader, ...profile }
}

test("real Loader starts and disposes the package-root Host entry", async (t) => {
  const root = await createTestLoaderWithRequiredServices(t)
  assert.equal(process.env.DEEPSEEK_API_KEY, undefined)

  const id = await root.loader.create({ name: "@omagents/omagents-dsh" })
  await root.loader.await()
  const entry = root.loader.resolve(id)
  assert.equal(entry.disabled, false)
  assert.ok(entry.fiber, "the package-root Host fiber must start")
  await entry.fiber.await()

  const runtime = (entry.fiber.ctx as Context & { omagents?: DshRuntime }).omagents
  assert.ok(runtime, "the loaded Host exposes its runtime as a Cordis service")
  assert.equal(runtime.health.host.status, "ready")
  assert.equal(runtime.health.persistence.status, "ready")

  const job = runtime.board.registerLaunch(launch)
  root.loader.remove(id)
  await entry.fiber.dispose()

  await runtime.board.flush()
  assert.throws(() => runtime.board.registerLaunch(launch), /closed/i)
  const persisted = JSON.parse(
    await fs.readFile(join(root.profileDir, "omagents", "job-board.json"), "utf8")
  )
  assert.equal(persisted.revision, 1)
  assert.equal(persisted.jobs[0].id, job.id)
  assert.equal(persisted.jobs[0].hostTaskId, launch.hostTaskId)
})

test(
  "Loader registers capabilities when their services are already available",
  { timeout: 10_000 },
  async (t) => {
    const isolated = await createIsolatedProfile(t)
    const root = new Context()
    const tools = new Map()
    const commands = new Map()
    root.provide("omagentsPython", {
      async ensureBaseEnvironment() {
        return { status: "test-isolated" }
      },
    })
    root.provide("mcpManager", {
      has() {
        return true
      },
      register() {
        throw new Error("the test must not start an external MCP server")
      },
    })
    root.provide("tools", {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    })
    root.provide("commands", {
      register(definition) {
        commands.set(definition.name, definition)
        return () => commands.delete(definition.name)
      },
    })
    root.provide("subagents", { interrupt() {} })
    await root.plugin(SkillRegistry)
    await root.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await root.plugin(Loader, { baseUrl: isolated.baseUrl })
    t.after(() => root.fiber.dispose())

    const id = await root.loader.create({ name: "@omagents/omagents-dsh" })
    await root.loader.await()
    const entry = root.loader.resolve(id)
    assert.ok(entry.fiber)
    await entry.fiber.await()
    const runtime = (entry.fiber.ctx as Context & { omagents?: DshRuntime }).omagents
    assert.ok(runtime)
    await within(
      root.skills.list().then((skills) => {
        assert.equal(skills.length, 33)
      }),
      "already-available skill registration"
    )
    assert.equal(tools.has("parallel_status"), true)
    assert.equal(tools.has("cancel_task"), true)
    assert.equal(commands.has("ps"), true)
    for (const capability of ["skills", "mcp", "tools", "commands", "context"] as const) {
      assert.equal(
        runtime.health[capability].status,
        "ready",
        runtime.health[capability].diagnostics[0]?.message
      )
    }
  }
)

test(
  "Loader activates delayed skill and tool services without blocking Host or Python",
  { timeout: 10_000 },
  async (t) => {
    const isolated = await createIsolatedProfile(t)
    const root = new Context()
    const python = deferred()
    let pythonStarted = false

    function createSkillBatch() {
      const batch = { registrations: [], activated: deferred() }
      batch.registry = {
        register(skill) {
          const registration = { name: skill.name, disposed: false }
          batch.registrations.push(registration)
          if (batch.registrations.length === 33) batch.activated.resolve()
          return () => {
            registration.disposed = true
          }
        },
      }
      return batch
    }

    const mcpBatches = []
    let currentMcpBatch
    function createMcpBatch() {
      const batch = { registrations: [], activated: deferred() }
      mcpBatches.push(batch)
      currentMcpBatch = batch
      return batch
    }
    createMcpBatch()

    root.provide("mcpManager", {
      has() {
        return false
      },
      register(name) {
        const registration = { name, disposed: false }
        currentMcpBatch.registrations.push(registration)
        currentMcpBatch.activated.resolve()
        return {
          ready: Promise.resolve(),
          async dispose() {
            registration.disposed = true
          },
        }
      },
    })
    root.provide("omagentsPython", {
      ensureBaseEnvironment() {
        pythonStarted = true
        return python.promise
      },
    })
    await root.plugin(Loader, { baseUrl: isolated.baseUrl })
    t.after(() => root.fiber.dispose())

    const id = await root.loader.create({ name: "@omagents/omagents-dsh" })
    await root.loader.await()
    const entry = root.loader.resolve(id)
    assert.ok(entry.fiber)
    await entry.fiber.await()
    const runtime = (entry.fiber.ctx as Context & { omagents?: DshRuntime }).omagents
    assert.ok(runtime, "Host startup must not wait for skills or tools")
    assert.equal(pythonStarted, true, "Python starts independently of delayed capabilities")
    assert.equal(mcpBatches[0].registrations.length, 0)

    const firstSkills = createSkillBatch()
    const firstMcp = currentMcpBatch
    const removeFirstSkills = root.provide("skills", firstSkills.registry)
    const removeFirstTools = root.provide("tools", {})
    await within(
      Promise.all([firstSkills.activated.promise, firstMcp.activated.promise]),
      "initial delayed capability activation"
    )
    assert.equal(firstSkills.registrations.length, 33)
    assert.ok(firstMcp.registrations.length > 0)
    assert.equal(runtime.health.skills.status, "ready")
    assert.equal(runtime.health.mcp.status, "ready")
    assert.equal(runtime.health.host.status, "ready")

    await removeFirstSkills()
    await removeFirstTools()
    const secondSkills = createSkillBatch()
    const secondMcp = createMcpBatch()
    const removeSecondSkills = root.provide("skills", secondSkills.registry)
    const removeSecondTools = root.provide("tools", {})
    await within(
      Promise.all([secondSkills.activated.promise, secondMcp.activated.promise]),
      "capability reactivation"
    )
    assert.equal(secondSkills.registrations.length, 33)
    assert.equal(secondMcp.registrations.length, firstMcp.registrations.length)
    assert.ok(firstSkills.registrations.every((skill) => skill.disposed))
    assert.ok(firstMcp.registrations.every((mcp) => mcp.disposed))

    python.resolve({ status: "ready" })
    await entry.fiber.dispose()
    assert.ok(secondSkills.registrations.every((skill) => skill.disposed))
    assert.ok(secondMcp.registrations.every((mcp) => mcp.disposed))

    await removeSecondSkills()
    await removeSecondTools()
    const lateSkills = createSkillBatch()
    const lateMcp = createMcpBatch()
    root.provide("skills", lateSkills.registry)
    root.provide("tools", {})
    await Promise.resolve()
    assert.equal(lateSkills.registrations.length, 0, "late skills must not register after disposal")
    assert.equal(lateMcp.registrations.length, 0, "late MCP must not register after disposal")
  }
)

test("Loader teardown composes capability disposers and blocks late Python health", async (t) => {
  const isolated = await createIsolatedProfile(t)
  const root = new Context()
  const skills = []
  const mcps = []
  let rejectPython
  const pendingPython = new Promise((_, reject) => {
    rejectPython = reject
  })
  root.provide("skills", {
    register(skill) {
      const registration = { name: skill.name, disposed: false }
      skills.push(registration)
      return () => {
        registration.disposed = true
      }
    },
  })
  root.provide("tools", {})
  root.provide("mcpManager", {
    has() {
      return false
    },
    register(name) {
      const registration = { name, disposed: false }
      mcps.push(registration)
      return {
        ready: Promise.resolve(),
        async dispose() {
          registration.disposed = true
        },
      }
    },
  })
  root.provide("omagentsPython", {
    ensureBaseEnvironment() {
      return pendingPython
    },
  })
  await root.plugin(Loader, { baseUrl: isolated.baseUrl })
  t.after(() => root.fiber.dispose())

  const id = await root.loader.create({ name: "@omagents/omagents-dsh" })
  await root.loader.await()
  const entry = root.loader.resolve(id)
  assert.ok(entry.fiber)
  await entry.fiber.await()
  const runtime = (entry.fiber.ctx as Context & { omagents?: DshRuntime }).omagents
  assert.ok(runtime)
  assert.equal(skills.length, 33)
  assert.ok(mcps.length > 0)

  await entry.fiber.dispose()
  assert.ok(skills.every((skill) => skill.disposed))
  assert.ok(mcps.every((mcp) => mcp.disposed))
  rejectPython(new Error("late Loader failure"))
  await new Promise((resolveTurn) => setImmediate(resolveTurn))
  assert.equal(runtime.health.python.status, "ready")
  assert.deepEqual(runtime.health.python.diagnostics, [])
})

test("runtime isolates active profiles and reports persistence health independently", async (t) => {
  const isolated = await createIsolatedProfile(t)
  const otherProfileDir = join(isolated.home, "profiles", "headless")
  const otherStorePath = join(otherProfileDir, "omagents", "job-board.json")
  await fs.mkdir(dirname(otherStorePath), { recursive: true })
  await fs.writeFile(otherStorePath, "not json", "utf8")
  t.mock.method(console, "warn", () => {})

  const { createDshRuntime } = await import("../dist/host/runtime.js")
  const webContext = new Context()
  webContext.baseUrl = isolated.baseUrl
  const headlessContext = new Context()
  headlessContext.baseUrl = pathToFileURL(`${otherProfileDir}${sep}`).href
  const web = await createDshRuntime(webContext)
  const headless = await createDshRuntime(headlessContext)

  assert.equal(web.health.host.status, "ready")
  assert.equal(web.health.persistence.status, "ready")
  assert.equal(headless.health.host.status, "ready")
  assert.equal(headless.health.persistence.status, "degraded")
  assert.notStrictEqual(headless.health.host, headless.health.persistence)
  assert.equal(headless.health.persistence.diagnostics[0]?.code, "ERR_JOB_STORE_CORRUPT")
  assert.deepEqual(web.board.list(), [])
  assert.deepEqual(headless.board.list(), [])

  web.board.registerLaunch(launch)
  const firstDisposal = web.dispose()
  assert.strictEqual(web.dispose(), firstDisposal)
  await firstDisposal
  await headless.dispose()

  assert.throws(() => web.board.registerLaunch(launch), /closed/i)
  const persisted = JSON.parse(
    await fs.readFile(join(isolated.profileDir, "omagents", "job-board.json"), "utf8")
  )
  assert.equal(persisted.jobs.length, 1)
  await assert.rejects(fs.access(otherStorePath), { code: "ENOENT" })
})

test("a startup store read failure falls back to a visible in-memory Board", async (t) => {
  const isolated = await createIsolatedProfile(t)
  const storePath = join(isolated.profileDir, "omagents", "job-board.json")
  await fs.mkdir(storePath, { recursive: true })
  const { createDshRuntime } = await import("../dist/host/runtime.js")
  const context = new Context()
  context.baseUrl = isolated.baseUrl
  const runtime = await createDshRuntime(context)
  t.after(() => runtime.dispose())

  assert.equal(runtime.health.host.status, "ready")
  assert.equal(runtime.health.persistence.status, "degraded")
  const loadDiagnostic = runtime.health.persistence.diagnostics.find(
    (diagnostic) => diagnostic.code === "ERR_DSH_JOB_STORE_LOAD"
  )
  assert.ok(loadDiagnostic, JSON.stringify(runtime.health.persistence.diagnostics))
  assert.match(loadDiagnostic.message, /in memory/i)

  // Even if the path becomes writable again, this already-degraded runtime must
  // not overwrite a store whose previous contents could not be read at startup.
  await fs.rm(storePath, { recursive: true, force: true })
  const repairedSnapshot = `${JSON.stringify({ version: 1, revision: 0, jobs: [] }, null, 2)}\n`
  await fs.writeFile(storePath, repairedSnapshot, "utf8")
  const job = runtime.board.registerLaunch(launch)
  await runtime.board.flush()
  await runtime.board.reconcile({ query: async () => ({ kind: "active" }) })
  assert.deepEqual(runtime.board.list().map((candidate) => candidate.id), [job.id])
  assert.equal(await fs.readFile(storePath, "utf8"), repairedSnapshot)
  await runtime.dispose()
})

test("later write failures preserve in-memory reconciliation and Remote list/watch", async (t) => {
  const isolated = await createIsolatedProfile(t)
  const dataDirectory = join(isolated.profileDir, "omagents")
  await fs.mkdir(dataDirectory, { recursive: true })
  const { createDshRuntime } = await import("../dist/host/runtime.js")
  const context = new Context()
  context.baseUrl = isolated.baseUrl
  const runtime = await createDshRuntime(context)
  t.after(() => runtime.dispose())
  t.after(() => context.fiber.dispose())

  await fs.rename(dataDirectory, `${dataDirectory}-empty`)
  await fs.writeFile(dataDirectory, "force atomic replacement to fail", "utf8")
  const job = runtime.board.registerLaunch(launch)
  await runtime.board.flush()
  await runtime.board.reconcile({ query: async () => ({ kind: "active" }) })
  assert.equal(runtime.board.get(job.id).executionState, "running")

  const remote = new OmAgentsRemote(context, {
    board: runtime.board,
    tracker: {
      async query() {
        return { kind: "active" }
      },
      async cancel() {},
    },
    health: runtime.health,
    authorizeScope: () => true,
  })
  const listed = await remote.listJobs({ parentSessionId: job.parentSessionId })
  assert.deepEqual(listed.map((candidate) => candidate.id), [job.id])

  const stream = remote
    .watchJobs({ parentSessionId: job.parentSessionId }, new AbortController().signal)
    [Symbol.asyncIterator]()
  const baseline = await within(stream.next(), "degraded persistence watch baseline")
  assert.equal(baseline.value.jobs[0].id, job.id)
  assert.equal(baseline.value.jobs[0].executionState, "running")

  runtime.board.markTerminal(job.id, { state: "completed", resultSummary: "kept in memory" })
  const changed = await within(stream.next(), "degraded persistence watch update")
  assert.equal(changed.value.jobs[0].executionState, "completed")
  assert.equal(changed.value.jobs[0].resultSummary, "kept in memory")
  await stream.return()

  const health = await remote.getHealth()
  assert.equal(health.persistence.status, "degraded")
  assert.ok(health.persistence.diagnostics.length > 0)
  assert.equal(health.host.status, "ready")
  assert.deepEqual((await remote.listJobs({})).map((candidate) => candidate.id), [job.id])
  await runtime.dispose()
})
