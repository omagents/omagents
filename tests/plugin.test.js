import { test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"
import { spawnSync } from "node:child_process"

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

test("index.js imports MCP definitions from base.json", async () => {
  const indexSource = fs.readFileSync(path.join(PLUGINS_DIR, "index.js"), "utf-8")
  assert.ok(indexSource.includes("base.json"), "index.js should import base.json")
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

test("mcp-servers/base.json exists and contains only unconditional servers", () => {
  const basePath = path.join(ROOT, "mcp-servers", "base.json")
  assert.ok(fs.existsSync(basePath), "mcp-servers/base.json should exist")
  const data = JSON.parse(fs.readFileSync(basePath, "utf-8"))
  const expected = ["agentmemory", "codegraph", "context7", "websearch"]
  assert.deepStrictEqual(
    Object.keys(data).sort(),
    expected.sort(),
    "base.json should contain exactly the four unconditional MCP servers"
  )
})

test("index.js contains conditional github/grep_app fallback logic", () => {
  const indexSource = fs.readFileSync(path.join(PLUGINS_DIR, "index.js"), "utf-8")
  assert.ok(
    indexSource.includes("if (process.env.GITHUB_TOKEN)"),
    "index.js should check GITHUB_TOKEN"
  )
  assert.ok(
    indexSource.includes("BUILTIN_MCPS.github"),
    "index.js should conditionally register github"
  )
  assert.ok(
    indexSource.includes("BUILTIN_MCPS.grep_app"),
    "index.js should conditionally register grep_app"
  )
})

function getRegisteredMcps(env) {
  const script = `
    import plugin from "./.opencode/plugins/index.js";
    const p = await plugin({ $: {} });
    const config = { skills: { paths: [] }, mcp: {} };
    await p.config(config);
    console.log(JSON.stringify(config.mcp));
  `
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) {
    throw new Error(result.stderr.toString() || "Child process failed")
  }
  const lines = result.stdout.toString().trim().split("\n")
  const jsonLine = lines[lines.length - 1]
  return JSON.parse(jsonLine)
}

test("without GITHUB_TOKEN, plugin registers grep_app fallback (not github)", () => {
  const mcps = getRegisteredMcps({ GITHUB_TOKEN: "" })
  assert.ok(mcps.grep_app, "grep_app should be registered when GITHUB_TOKEN is absent")
  assert.ok(!mcps.github, "github should not be registered when GITHUB_TOKEN is absent")
})

test("with GITHUB_TOKEN, plugin registers github (not grep_app)", () => {
  const mcps = getRegisteredMcps({ GITHUB_TOKEN: "fake-token-for-test" })
  assert.ok(mcps.github, "github should be registered when GITHUB_TOKEN is present")
  assert.ok(!mcps.grep_app, "grep_app should not be registered when GITHUB_TOKEN is present")
})
