import { test, type TestContext } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { Context } from "@deepseek-ai/cordis"
import Loader from "@deepseek-ai/cordis-plugin-loader"

import type { DshRuntime } from "../dist/host/runtime.js"

const launch = {
  host: "dsh",
  hostTaskId: "loader-smoke-task",
  parentSessionId: "loader-smoke-parent",
  childName: "loader-smoke-child",
  agent: "explore",
  description: "Verify the real DSH Loader and durable disposal",
}

async function createIsolatedProfile(t: TestContext) {
  const home = await fs.mkdtemp(join(tmpdir(), "omagents-dsh-home-"))
  const profileDir = join(home, "profiles", "web")
  await fs.mkdir(profileDir, { recursive: true })
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const installedPackageDir = join(profileDir, "node_modules", "@omagents", "omagents-dsh")
  await fs.mkdir(dirname(installedPackageDir), { recursive: true })
  await fs.symlink(
    packageDir,
    installedPackageDir,
    process.platform === "win32" ? "junction" : "dir"
  )
  const previousHome = process.env.DSH_HOME
  const previousModelKey = process.env.DEEPSEEK_API_KEY
  process.env.DSH_HOME = home
  delete process.env.DEEPSEEK_API_KEY

  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
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
