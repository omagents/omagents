import { test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"

const ROOT = path.resolve(import.meta.dirname, "..")
const SKILLS_DIR = path.join(ROOT, "skills")
const PLUGINS_DIR = path.join(ROOT, ".opencode", "plugins")

test("plugin entry point exists", () => {
  assert.ok(fs.existsSync(path.join(PLUGINS_DIR, "index.js")))
})

test("parallel engine exists", () => {
  assert.ok(fs.existsSync(path.join(PLUGINS_DIR, "parallel.js")))
})

test("index.js exports OmagentsPlugin", async () => {
  const mod = await import(path.join(PLUGINS_DIR, "index.js"))
  assert.strictEqual(typeof mod.OmagentsPlugin, "function")
  assert.strictEqual(typeof mod.default, "function")
})

test("BUILTIN_MCPS contains expected servers", async () => {
  const indexSource = fs.readFileSync(path.join(PLUGINS_DIR, "index.js"), "utf-8")
  const expectedMcps = ["agentmemory", "codegraph", "context7", "websearch"]
  for (const mcp of expectedMcps) {
    assert.ok(indexSource.includes(mcp), `Missing MCP: ${mcp}`)
  }
})

test("SKILL_SCRIPT_DIRS includes _shared/scripts", () => {
  const indexSource = fs.readFileSync(path.join(PLUGINS_DIR, "index.js"), "utf-8")
  assert.ok(
    indexSource.includes('"_shared", "scripts"'),
    "SKILL_SCRIPT_DIRS should include _shared/scripts for loop_engine.py"
  )
})

test("Python prerequisite check exists", () => {
  const indexSource = fs.readFileSync(path.join(PLUGINS_DIR, "index.js"), "utf-8")
  assert.ok(
    indexSource.includes("python3 --version"),
    "Plugin should check for Python 3 availability"
  )
  assert.ok(
    indexSource.includes("Python 3 is not installed"),
    "Plugin should warn when Python is missing"
  )
})

test("superpowers dependency is pinned to a commit", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"))
  const dep = pkg.dependencies.superpowers
  assert.ok(dep.includes("#"), "superpowers should be pinned with #<commit-sha>")
  assert.ok(!dep.endsWith(".git"), "superpowers should not be unpinned (missing #commit)")
})
