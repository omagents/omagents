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
    assert.ok(
      plugin && typeof plugin === "object",
      `.${platform}-plugin/plugin.json should be valid JSON`
    )

    assert.strictEqual(
      plugin.name,
      "omagents",
      `.${platform}-plugin/plugin.json name should be omagents`
    )
    assert.ok(plugin.version, `.${platform}-plugin/plugin.json should have a version`)
    assert.ok(plugin.description, `.${platform}-plugin/plugin.json should have a description`)
  }
})

test("sync script generates .mcp.json for claude and codex", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const mcpJsonPath = path.join(ROOT, `.${platform}-plugin`, ".mcp.json")
    assert.ok(fs.existsSync(mcpJsonPath), `.${platform}-plugin/.mcp.json should exist`)

    const mcp = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"))
    assert.ok(mcp && typeof mcp === "object", `.${platform}-plugin/.mcp.json should be valid JSON`)

    for (const name of ["agentmemory", "codegraph", "context7", "websearch"]) {
      assert.ok(mcp[name], `.${platform}-plugin/.mcp.json should contain ${name}`)
    }

    assert.strictEqual(
      mcp.agentmemory.type,
      "local",
      `.${platform}-plugin/.mcp.json agentmemory should be local`
    )
    assert.strictEqual(
      mcp.agentmemory.command,
      "npx",
      `.${platform}-plugin/.mcp.json agentmemory command should be npx`
    )
    assert.ok(
      Array.isArray(mcp.agentmemory.args),
      `.${platform}-plugin/.mcp.json agentmemory args should be an array`
    )

    assert.strictEqual(
      mcp.context7.type,
      "remote",
      `.${platform}-plugin/.mcp.json context7 should be remote`
    )
    assert.ok(mcp.context7.url, `.${platform}-plugin/.mcp.json context7 should have a url`)
  }
})
