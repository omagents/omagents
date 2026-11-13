import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { installCodex } from "../.codex/plugins/setup.js"

test("Codex installer bundles shared Python environment hooks", async (t) => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-codex-home-"))
  const previousCodexHome = process.env.CODEX_HOME
  process.env.CODEX_HOME = codexHome
  t.after(() => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previousCodexHome
    fs.rmSync(codexHome, { recursive: true, force: true })
  })

  await installCodex()

  const hooksDir = path.join(
    codexHome,
    "plugins",
    "cache",
    "omagents",
    "omagents",
    "local",
    "hooks"
  )
  for (const name of ["python-env.js", "setup-venv.js", "project-venv.js"]) {
    assert.equal(fs.existsSync(path.join(hooksDir, name)), true, `${name} should be installed`)
  }

  const setupHook = fs.readFileSync(path.join(hooksDir, "setup-venv.js"), "utf8")
  assert.match(setupHook, /ensureBaseEnvironment/)
  assert.doesNotMatch(setupHook, /install -q jinja2/)
  assert.match(setupHook, /process\.stdout\.write\("\{\}"\)/)
})

test("Codex installs OmAgents skills and warns without Superpowers", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-codex-no-superpowers-"))
  const checkout = path.join(root, "checkout")
  const codexHome = path.join(root, "codex-home")
  const setupDir = path.join(checkout, ".codex", "plugins")
  fs.mkdirSync(setupDir, { recursive: true })
  fs.mkdirSync(codexHome, { recursive: true })
  fs.copyFileSync(
    path.join(import.meta.dirname, "..", ".codex", "plugins", "setup.js"),
    path.join(setupDir, "setup.js")
  )
  fs.copyFileSync(
    path.join(import.meta.dirname, "..", "package.json"),
    path.join(checkout, "package.json")
  )
  fs.cpSync(
    path.join(import.meta.dirname, "..", "packages", "core"),
    path.join(checkout, "packages", "core"),
    {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}node_modules`),
    }
  )
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const previousCodexHome = process.env.CODEX_HOME
  const previousWarn = console.warn
  const warnings = []
  process.env.CODEX_HOME = codexHome
  console.warn = (...args) => warnings.push(args.join(" "))
  t.after(() => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previousCodexHome
    console.warn = previousWarn
  })

  const setup = await import(pathToFileURL(path.join(setupDir, "setup.js")).href)
  await setup.installCodex()

  const pluginRoot = path.join(codexHome, "plugins", "cache", "omagents", "omagents", "local")
  assert.equal(fs.existsSync(path.join(pluginRoot, "skills", "deep-research", "SKILL.md")), true)
  assert.equal(fs.existsSync(path.join(pluginRoot, "skills", "superpowers")), false)
  assert.ok(
    warnings.some((warning) => warning.includes("superpowers skills not found, skipping")),
    `documented missing-skills warning should be reached: ${warnings.join("\n")}`
  )
})
