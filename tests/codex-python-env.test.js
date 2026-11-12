import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

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
