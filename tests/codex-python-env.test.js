import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { installCodex } from "../packages/codex/src/setup.js"

const ROOT = path.resolve(import.meta.dirname, "..")

test("Codex installer bundles shared Python environment hooks", async (t) => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-codex-home-"))
  t.after(() => fs.rmSync(codexHome, { recursive: true, force: true }))

  await installCodex({ codexHome, env: {} })

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
  const codexHome = path.join(root, "codex-home")
  const packagesRoot = path.join(root, "node_modules", "@omagents")
  const corePackageDir = path.join(packagesRoot, "core")
  const codexPackageDir = path.join(packagesRoot, "omagents-codex")
  fs.mkdirSync(codexHome, { recursive: true })
  fs.mkdirSync(path.join(codexPackageDir, "src"), { recursive: true })
  fs.cpSync(path.join(ROOT, "packages", "core"), corePackageDir, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules`),
  })
  fs.copyFileSync(
    path.join(ROOT, "packages", "codex", "package.json"),
    path.join(codexPackageDir, "package.json")
  )
  fs.copyFileSync(
    path.join(ROOT, "packages", "codex", "src", "setup.js"),
    path.join(codexPackageDir, "src", "setup.js")
  )
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const previousWarn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args.join(" "))
  t.after(() => {
    console.warn = previousWarn
  })

  const setup = await import(pathToFileURL(path.join(codexPackageDir, "src", "setup.js")).href)
  await setup.installCodex({ codexHome, env: {} })

  const pluginRoot = path.join(codexHome, "plugins", "cache", "omagents", "omagents", "local")
  assert.equal(fs.existsSync(path.join(pluginRoot, "skills", "deep-research", "SKILL.md")), true)
  assert.equal(fs.existsSync(path.join(pluginRoot, "skills", "superpowers")), false)
  assert.ok(
    warnings.some((warning) => warning.includes("superpowers skills not found, skipping")),
    `documented missing-skills warning should be reached: ${warnings.join("\n")}`
  )
})
