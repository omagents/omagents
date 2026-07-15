import { test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"
import { execSync } from "child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const SCRIPT = path.join(ROOT, "scripts", "sync-platform.sh")

test("sync script generates claude and codex directories", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const base = path.join(ROOT, `.${platform}-plugin`)

    for (const dir of ["skills", "hooks", "bin"]) {
      assert.ok(fs.existsSync(path.join(base, dir)), `.${platform}-plugin/${dir} should exist`)
    }

    const pluginJsonPath = path.join(base, "plugin.json")
    assert.ok(fs.existsSync(pluginJsonPath), `.${platform}-plugin/plugin.json should exist`)

    const plugin = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"))
    assert.ok(plugin && typeof plugin === "object", `.${platform}-plugin/plugin.json should be valid JSON`)

    assert.strictEqual(plugin.name, "omagents", `.${platform}-plugin/plugin.json name should be omagents`)
    assert.ok(plugin.version, `.${platform}-plugin/plugin.json should have a version`)
    assert.ok(plugin.description, `.${platform}-plugin/plugin.json should have a description`)
  }
})
