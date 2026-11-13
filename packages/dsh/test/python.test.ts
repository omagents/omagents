import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { Context } from "@deepseek-ai/cordis"
import {
  CORE_PYTHON_PACKAGES,
  ensureBaseEnvironment,
  getVenvPython,
} from "@omagents/core"

import { createHealthRecords } from "../dist/host/health.js"
import { provisionDshPython } from "../dist/host/register-python.js"

async function isolatedHome(t) {
  const home = await fs.mkdtemp(join(tmpdir(), "omagents-dsh-python-home-"))
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  }
  process.env.HOME = home
  process.env.USERPROFILE = home
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await fs.rm(home, { recursive: true, force: true })
  })
  return home
}

function healthyRecords() {
  return createHealthRecords(() => [])
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve))
}

test("Python base provisioning is nonblocking and reports failure independently", async (t) => {
  const home = await isolatedHome(t)
  const root = new Context()
  t.after(() => root.fiber.dispose())
  const health = healthyRecords()
  let rejectProvisioning
  let receivedOptions
  const pending = new Promise((_, reject) => {
    rejectProvisioning = reject
  })
  root.provide("omagentsPython", {
    ensureBaseEnvironment(options) {
      receivedOptions = options
      return pending
    },
  })

  const result = provisionDshPython(root, health)
  assert.equal(result, undefined)
  assert.ok(receivedOptions, "provisioning starts without awaiting plugin setup")
  assert.equal(receivedOptions.venvPath, join(home, ".venvs", "omagents"))
  assert.deepEqual(receivedOptions.corePackages, CORE_PYTHON_PACKAGES)
  assert.equal(health.python.status, "ready")

  rejectProvisioning(new Error("Python is unavailable"))
  await nextTurn()
  assert.equal(health.python.status, "degraded")
  assert.match(health.python.diagnostics[0].message, /Python is unavailable/)
  assert.match(health.python.diagnostics[0].message, /Python 3\.11\+/)
  assert.equal(health.host.status, "ready")
  assert.equal(health.skills.status, "ready")
  assert.equal(health.mcp.status, "ready")
})

test("late Python completion cannot mutate health after Loader teardown", async (t) => {
  await isolatedHome(t)
  const root = new Context()
  const health = healthyRecords()
  let rejectProvisioning
  const pending = new Promise((_, reject) => {
    rejectProvisioning = reject
  })
  root.provide("omagentsPython", {
    ensureBaseEnvironment() {
      return pending
    },
  })

  provisionDshPython(root, health)
  const disposal = root.fiber.dispose()
  rejectProvisioning(new Error("late failure"))
  await disposal
  await nextTurn()

  assert.equal(health.python.status, "ready")
  assert.deepEqual(health.python.diagnostics, [])
  t.after(() => root.fiber.dispose())
})

test("DSH delegates only jinja2 base installation and leaves project overlays on demand", async (t) => {
  const home = await isolatedHome(t)
  const root = new Context()
  t.after(() => root.fiber.dispose())
  const health = healthyRecords()
  const calls = []
  const sitePackages = join(home, "base-site-packages")
  const inspection = JSON.stringify({
    version: "3.12.1",
    majorMinor: "3.12",
    prefix: home,
    basePrefix: home,
    purelib: sitePackages,
    platlib: sitePackages,
    sysPath: [sitePackages],
  })
  let finishedProvisioning
  const finished = new Promise((resolve) => {
    finishedProvisioning = resolve
  })

  async function runner(command, args) {
    calls.push({ command, args: [...args] })
    if (args.includes("venv")) {
      const venvPath = args.at(-1)
      const pythonPath = getVenvPython(venvPath)
      await fs.mkdir(dirname(pythonPath), { recursive: true })
      await fs.writeFile(pythonPath, "test interpreter placeholder", "utf8")
      return { code: 0, stdout: "", stderr: "" }
    }
    if (args[0] === "-I" && args[1] === "-c" && args[2]?.startsWith("import json")) {
      return { code: 0, stdout: inspection, stderr: "" }
    }
    if (args[0] === "-I" && args[1] === "-c" && args[2] === "import jinja2") {
      return { code: 1, stdout: "", stderr: "missing jinja2" }
    }
    if (args[0] === "-I" && args[1] === "-m" && args[2] === "pip") {
      return { code: 0, stdout: "", stderr: "" }
    }
    throw new Error(`Unexpected Python invocation: ${command} ${args.join(" ")}`)
  }

  root.provide("omagentsPython", {
    async ensureBaseEnvironment(options) {
      try {
        return await ensureBaseEnvironment({ ...options, runner, cwd: home })
      } finally {
        finishedProvisioning()
      }
    },
  })

  provisionDshPython(root, health)
  await finished
  await nextTurn()

  const pipInstalls = calls.filter(
    ({ args }) => args[0] === "-I" && args[1] === "-m" && args[2] === "pip" && args[3] === "install"
  )
  assert.equal(pipInstalls.length, 1)
  assert.deepEqual(pipInstalls[0].args, ["-I", "-m", "pip", "install", "jinja2"])
  assert.equal(calls.filter(({ args }) => args.includes("venv")).length, 1)
  assert.equal(calls.some(({ args }) => args.includes("markitdown")), false)
  assert.equal(calls.some(({ args }) => args.includes("playwright")), false)
  assert.equal(calls.some(({ args }) => args.some((arg) => arg.includes(".omagents/venv"))), false)
  assert.equal(health.python.status, "ready")
  assert.deepEqual(health.python.diagnostics, [])
})
