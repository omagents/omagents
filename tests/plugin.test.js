import { test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"
import { importModule } from "./import-module.js"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const SKILLS_DIR = path.join(ROOT, "packages", "core", "skills")
const PLUGINS_DIR = path.join(ROOT, "packages", "opencode", "src")
const SEARCH_PROXY_ENTRY = path.join(
  ROOT,
  "packages",
  "core",
  "mcp-servers",
  "search-proxy",
  "index.mjs"
)

test("plugin entry point exists", () => {
  assert.ok(fs.existsSync(path.join(PLUGINS_DIR, "index.js")))
})

test("parallel engine exists", () => {
  assert.ok(fs.existsSync(path.join(PLUGINS_DIR, "parallel.js")))
})

test("OpenCode parallel execution delegates state and persistence to Core", () => {
  const source = fs.readFileSync(path.join(PLUGINS_DIR, "parallel.js"), "utf8")
  assert.ok(!source.includes("jobBoard = new Map()"), "legacy global board must be removed")
  assert.ok(!source.includes("function persistJobBoard"), "legacy persistence must be removed")
  assert.ok(source.includes("JobBoard"), "adapter should use the Core JobBoard")
  assert.ok(source.includes("JsonJobStore"), "adapter should use the Core JSON store")
})

test("index.js exports dual V1/V2 entry point", async () => {
  const mod = await importModule(path.join(PLUGINS_DIR, "index.js"))
  // V1: named export scanned by older V1 hosts
  assert.strictEqual(typeof mod.OmagentsPlugin, "function")
  // Dual descriptor: V1 >= 1.18.29 calls default.server(), V2 reads id + setup()
  assert.strictEqual(typeof mod.default, "object")
  assert.strictEqual(mod.default.id, "omagents")
  assert.strictEqual(typeof mod.default.server, "function")
  assert.strictEqual(typeof mod.default.setup, "function")
  assert.strictEqual(mod.default.server, mod.OmagentsPlugin)
})

test("index.js consumes canonical MCP definitions from Core", async () => {
  const indexSource = fs.readFileSync(path.join(PLUGINS_DIR, "index.js"), "utf-8")
  assert.ok(indexSource.includes("resolveMcpServers"), "index.js should use the Core resolver")
  assert.ok(!indexSource.includes("base.json"), "Core should own the base catalog import")
})

test("SKILL_SCRIPT_DIRS includes _shared/scripts", () => {
  const indexSource = fs.readFileSync(path.join(PLUGINS_DIR, "index.js"), "utf-8")
  assert.ok(
    indexSource.includes('"_shared", "scripts"'),
    "SKILL_SCRIPT_DIRS should include _shared/scripts for loop_engine.py"
  )
})

test("OpenCode delegates Python provisioning to the shared environment module", () => {
  const indexSource = fs.readFileSync(path.join(PLUGINS_DIR, "index.js"), "utf-8")
  assert.ok(
    indexSource.includes("ensureBaseEnvironment"),
    "Plugin should delegate base provisioning"
  )
  assert.ok(indexSource.includes("AGENT_VENV_BIN"), "Plugin should use the shared venv bin path")
  assert.ok(
    indexSource.includes("_provisioning"),
    "Plugin should retain once-per-process deduplication"
  )
  assert.ok(
    !indexSource.includes("REQUIRED_PYTHON_PACKAGES"),
    "Package definitions should be shared"
  )
  assert.ok(
    !indexSource.includes('["-m", "venv", AGENT_VENV]'),
    "Plugin should not create venvs itself"
  )
})

test("Core owns the Superpowers dependency pinned to a commit", () => {
  const corePkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "packages", "core", "package.json"), "utf-8")
  )
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"))
  const opencodePkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "packages", "opencode", "package.json"), "utf-8")
  )
  const dep = corePkg.dependencies.superpowers
  assert.ok(dep.includes("#8ca22dba9a94f28898bbce59f2537ff4d87c747d"))
  assert.ok(corePkg.bundledDependencies.includes("superpowers"))
  assert.equal(rootPkg.dependencies?.superpowers, undefined)
  assert.equal(rootPkg.bundledDependencies, undefined)
  assert.equal(opencodePkg.dependencies?.superpowers, undefined)
  assert.equal(opencodePkg.bundledDependencies, undefined)
})

test("Core mcp-servers/base.json contains only unconditional servers", () => {
  const basePath = path.join(ROOT, "packages", "core", "mcp-servers", "base.json")
  assert.ok(fs.existsSync(basePath), "packages/core/mcp-servers/base.json should exist")
  const data = JSON.parse(fs.readFileSync(basePath, "utf-8"))
  const expected = ["agentmemory", "codegraph", "context7", "websearch"]
  assert.deepStrictEqual(
    Object.keys(data).sort(),
    expected.sort(),
    "base.json should contain exactly the four unconditional MCP servers"
  )
})

test("index.js leaves conditional github/grep_app fallback logic to Core", () => {
  const indexSource = fs.readFileSync(path.join(PLUGINS_DIR, "index.js"), "utf-8")
  assert.ok(
    !indexSource.includes("process.env.GITHUB_TOKEN"),
    "index.js should not inspect GITHUB_TOKEN"
  )
  assert.ok(
    !indexSource.includes("BUILTIN_MCPS.github"),
    "Core should conditionally resolve github"
  )
  assert.ok(
    !indexSource.includes("BUILTIN_MCPS.grep_app"),
    "Core should conditionally resolve grep_app"
  )
})

function getRegisteredMcps(env, configuredMcps = {}) {
  const script = `
    import fs from "node:fs";
    import os from "node:os";
    import path from "node:path";
    import mod from "./packages/opencode/src/index.js";
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-v1-test-"));
    const p = await mod.server({ omagents: {
      jobStorePath: path.join(storage, "job-board.json"),
      tuiStatePath: path.join(storage, "tui-state.json")
    } });
    const config = { skills: { paths: [] }, mcp: ${JSON.stringify(configuredMcps)} };
    await p.config(config);
    console.log(JSON.stringify(config.mcp));
    fs.rmSync(storage, { recursive: true, force: true });
  `
  const childEnv = {
    ...process.env,
    OMAGENTS_SEARCH_PROVIDER: "auto",
    EXA_API_KEY: "",
    KEENABLE_API_KEY: "",
    YDC_API_KEY: "",
    ...env,
    SHELL: "omagents-test-shell",
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key]
  }
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    env: childEnv,
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

test("context7 always registers as local @upstash/context7-mcp", () => {
  const mcps = getRegisteredMcps({})
  assert.strictEqual(mcps.context7.type, "local", "context7 should be local")
  assert.deepStrictEqual(mcps.context7.command, ["npx", "-y", "@upstash/context7-mcp"])
})

test("CONTEXT7_API_KEY is passed through to the local context7 MCP", () => {
  const mcps = getRegisteredMcps({ CONTEXT7_API_KEY: "fake-context7-key-for-test" })
  assert.strictEqual(mcps.context7.environment.CONTEXT7_API_KEY, "fake-context7-key-for-test")
})

test("context7 registers without environment when CONTEXT7_API_KEY is unset", () => {
  const mcps = getRegisteredMcps({ CONTEXT7_API_KEY: "" })
  assert.strictEqual(mcps.context7.environment, undefined)
})

test("explicit Exa with EXA_API_KEY stays remote and uses x-api-key authentication", () => {
  const mcps = getRegisteredMcps({
    OMAGENTS_SEARCH_PROVIDER: "exa",
    EXA_API_KEY: "fake-exa-key-for-test",
  })
  assert.strictEqual(mcps.websearch.type, "remote", "websearch should stay remote with EXA_API_KEY")
  assert.strictEqual(mcps.websearch.url, "https://mcp.exa.ai/mcp")
  assert.strictEqual(mcps.websearch.headers["x-api-key"], "fake-exa-key-for-test")
  assert.strictEqual(mcps.websearch.oauth, false)
  assert.strictEqual(mcps.websearch.command, undefined)
  assert.strictEqual(mcps.websearch.environment, undefined)
})

test("explicit Exa without EXA_API_KEY uses the anonymous remote exa endpoint", () => {
  const mcps = getRegisteredMcps({ OMAGENTS_SEARCH_PROVIDER: "exa", EXA_API_KEY: "" })
  assert.strictEqual(mcps.websearch.type, "remote", "websearch should stay remote without a key")
  assert.strictEqual(mcps.websearch.url, "https://mcp.exa.ai/mcp")
  assert.strictEqual(mcps.websearch.headers, undefined)
  assert.strictEqual(mcps.websearch.environment, undefined)
})

test("default, empty, and auto provider selection register local websearch", () => {
  for (const [selection, provider] of [
    ["default", undefined],
    ["empty", ""],
    ["auto", "auto"],
  ]) {
    const mcps = getRegisteredMcps({
      OMAGENTS_SEARCH_PROVIDER: provider,
      EXA_API_KEY: "",
      KEENABLE_API_KEY: "",
    })
    assert.deepStrictEqual(
      mcps.websearch,
      {
        type: "local",
        command: ["node", SEARCH_PROXY_ENTRY],
        enabled: true,
      },
      selection
    )
  }
})

test("auto websearch passes optional search credentials to the local proxy", () => {
  const mcps = getRegisteredMcps({
    OMAGENTS_SEARCH_PROVIDER: "auto",
    EXA_API_KEY: "auto-exa-key",
    KEENABLE_API_KEY: "auto-keenable-key",
    YDC_API_KEY: "auto-youcom-key",
  })
  assert.deepStrictEqual(mcps.websearch, {
    type: "local",
    command: ["node", SEARCH_PROXY_ENTRY],
    environment: {
      EXA_API_KEY: "auto-exa-key",
      KEENABLE_API_KEY: "auto-keenable-key",
      YDC_API_KEY: "auto-youcom-key",
    },
    enabled: true,
  })
})

test("OpenCode V1 does not override a user-configured websearch", () => {
  const custom = {
    type: "remote",
    url: "https://example.com/custom-websearch",
    oauth: false,
  }
  const mcps = getRegisteredMcps({ OMAGENTS_SEARCH_PROVIDER: "auto" }, { websearch: custom })
  assert.deepStrictEqual(mcps.websearch, custom)
})

test("Keenable provider registers the keyless endpoint without Exa", () => {
  const mcps = getRegisteredMcps({
    OMAGENTS_SEARCH_PROVIDER: "keenable",
    EXA_API_KEY: "unused-exa-key",
    KEENABLE_API_KEY: "",
  })
  assert.deepStrictEqual(mcps.keenable, {
    type: "remote",
    url: "https://api.keenable.ai/mcp-public",
    oauth: false,
    enabled: true,
  })
  assert.strictEqual(mcps.websearch, undefined)
})

test("You.com provider registers the keyed direct endpoint without the proxy", () => {
  const mcps = getRegisteredMcps({
    OMAGENTS_SEARCH_PROVIDER: "youcom",
    EXA_API_KEY: "unused-exa-key",
    KEENABLE_API_KEY: "unused-keenable-key",
    YDC_API_KEY: "direct-youcom-key",
  })
  assert.deepStrictEqual(mcps.youdotcom, {
    type: "remote",
    url: "https://api.you.com/mcp",
    oauth: false,
    headers: { Authorization: "Bearer direct-youcom-key" },
    enabled: true,
  })
  assert.strictEqual(mcps.websearch, undefined)
  assert.strictEqual(mcps.keenable, undefined)
})

test("You.com provider registers the keyless direct endpoint without authentication", () => {
  const mcps = getRegisteredMcps({
    OMAGENTS_SEARCH_PROVIDER: "youcom",
    YDC_API_KEY: "",
  })
  assert.deepStrictEqual(mcps.youdotcom, {
    type: "remote",
    url: "https://api.you.com/mcp/free",
    oauth: false,
    enabled: true,
  })
  assert.strictEqual(mcps.websearch, undefined)
  assert.strictEqual(mcps.keenable, undefined)
})

test("OpenCode V1 does not override a user-configured youdotcom", () => {
  const custom = {
    type: "remote",
    url: "https://example.com/custom-youcom",
    oauth: false,
  }
  const mcps = getRegisteredMcps(
    { OMAGENTS_SEARCH_PROVIDER: "youcom", YDC_API_KEY: "unused-youcom-key" },
    { youdotcom: custom }
  )
  assert.deepStrictEqual(mcps.youdotcom, custom)
})
