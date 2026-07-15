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
  assert.ok(fs.existsSync(path.join(ROOT, ".claude-plugin", "plugin.json")))
  assert.ok(fs.existsSync(path.join(ROOT, ".codex-plugin", "plugin.json")))
})

test("sync script copies mcp servers for claude and codex", () => {
  for (const platform of ["claude", "codex"]) {
    const mcpPath = path.join(ROOT, `.${platform}-plugin`, ".mcp.json")
    assert.ok(fs.existsSync(mcpPath), `.${platform}-plugin/.mcp.json should exist`)

    const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf-8"))
    assert.ok(mcp && typeof mcp === "object", `.${platform}-plugin/.mcp.json should be valid JSON`)

    for (const name of ["agentmemory", "codegraph", "context7", "websearch"]) {
      assert.ok(name in mcp, `.${platform}-plugin/.mcp.json should contain ${name}`)
    }
  }
})
