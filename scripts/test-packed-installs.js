import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { ARTIFACT_ROOT, run } from "./pack-all.js"
import { prepareCleanRoom } from "./packed-harness.js"

const HOST_PROBE = String.raw`
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const hostProject = process.cwd()
const home = process.env.HOME
const installed = (name) => path.join(hostProject, "node_modules", ...name.split("/"))
const corePackage = installed("@omagents/core")
const core = await import("@omagents/core")
const corePaths = core.getCorePaths()
assert.equal(fs.realpathSync(corePaths.root), fs.realpathSync(corePackage))
assert.ok(corePaths.superpowersDir)
assert.ok(fs.realpathSync(corePaths.superpowersDir).startsWith(fs.realpathSync(corePackage) + path.sep), "Superpowers must resolve from Core's bundled dependency, not host hoisting")
for (const asset of [corePaths.skillsDir, corePaths.hooksDir, corePaths.mcpCatalogPath, corePaths.searchProxyDir, corePaths.searchProxyEntry]) {
  assert.equal(fs.existsSync(asset), true, asset)
}
const searchProxyModules = ["backends.mjs", "errors.mjs", "index.mjs", "remote-client.mjs", "router.mjs", "stdio-server.mjs"]
function assertCompleteSearchProxy(directory, sourceDirectory = directory) {
  assert.deepEqual(fs.readdirSync(directory).sort(), [...searchProxyModules].sort())
  for (const name of searchProxyModules) {
    assert.equal(fs.readFileSync(path.join(directory, name), "utf8"), fs.readFileSync(path.join(sourceDirectory, name), "utf8"), name)
  }
}
function assertSearchProxyHandshake(entry) {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "packed-probe", version: "1.0.0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]
  const npmCache = path.join(home, "nonexistent npm cache")
  assert.equal(fs.existsSync(npmCache), false)
  const result = spawnSync(process.execPath, [entry], {
    input: requests.map((request) => JSON.stringify(request)).join("\n") + "\n",
    encoding: "utf8",
    timeout: 30_000,
    killSignal: "SIGKILL",
    env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "", npm_config_cache: npmCache, NPM_CONFIG_CACHE: npmCache, OMAGENTS_SEARCH_PROVIDER: "auto", EXA_API_KEY: "", KEENABLE_API_KEY: "", YDC_API_KEY: "" },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)
  assert.equal(result.stderr, "")
  const responses = result.stdout.trim().split("\n").map((line) => JSON.parse(line))
  assert.equal(responses.length, 2)
  assert.equal(responses[0].result.protocolVersion, "2025-06-18")
  assert.deepEqual(responses[1].result.tools.map((tool) => tool.name), ["search", "fetch"])
}
assertCompleteSearchProxy(corePaths.searchProxyDir)
assertSearchProxyHandshake(corePaths.searchProxyEntry)

const definitions = core.listSkillDefinitions({ host: "dsh" })
assert.equal(definitions.filter((skill) => skill.source === "omagents").length, 18)
assert.equal(definitions.filter((skill) => skill.source === "superpowers").length, 15)
for (const definition of definitions) {
  const rendered = core.renderSkillForHost(definition, "dsh")
  assert.equal(fs.existsSync(rendered.path), true)
  assert.ok(rendered.content.length > 0)
  assert.doesNotMatch(rendered.content, /subagent\([^\n)]*\bbackground\s*:/i)
  assert.doesNotMatch(rendered.content, /OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS/)
}
assert.equal(core.getVenvPython("C:\\release\\.venvs\\omagents", "win32"), "C:\\release\\.venvs\\omagents\\Scripts\\python.exe")
assert.equal(core.getVenvPython("/opt/release", "linux"), path.join("/opt/release", "bin", "python"))

const opencode = await import("@omagents/omagents")
assert.equal(opencode.default.id, "omagents")
const storage = path.join(home, "v1-storage")
fs.mkdirSync(storage, { recursive: true })
const v1 = await opencode.default.server({
  directory: hostProject,
  omagents: {
    jobStorePath: path.join(storage, "jobs.json"),
    tuiStatePath: path.join(storage, "tui.json"),
    ensureBaseEnvironment: async () => ({ status: "isolated" }),
  },
})
const v1Config = { skills: { paths: [] }, mcp: {} }
await v1.config(v1Config)
assert.ok(v1Config.skills.paths.some((entry) => fs.realpathSync(entry).startsWith(fs.realpathSync(corePackage) + path.sep)))
assert.ok(v1Config.mcp.context7)
assert.ok(v1Config.mcp.websearch)

const captured = { skills: [], mcps: {}, tools: new Map(), commands: [] }
const ctx = {
  location: { directory: hostProject },
  omagents: {
    jobStorePath: path.join(storage, "v2-jobs.json"),
    tuiStatePath: path.join(storage, "v2-tui.json"),
    ensureBaseEnvironment: async () => ({ status: "isolated" }),
  },
  skill: { transform: async (cb) => cb({ add: (skill) => captured.skills.push(skill), get: () => undefined, list: () => [] }) },
  mcp: { transform: async (cb) => cb({ get: (name) => captured.mcps[name], set: (name, config) => { captured.mcps[name] = config } }) },
  tool: {
    transform: async (cb) => cb({ add: (tool) => captured.tools.set(tool.name, tool), namespace: () => {} }),
    hook: async () => {},
  },
  session: {
    hook: async () => {},
    get: async ({ sessionID }) => ({ id: sessionID }),
    prompt: async () => {},
    interrupt: async () => {},
  },
  shell: { hook: async () => {} },
  command: { list: async () => [], transform: async (cb) => cb({ add: (command) => captured.commands.push(command) }) },
  event: { subscribe: () => ({ async *[Symbol.asyncIterator]() { await new Promise(() => {}) } }) },
}
const cleanup = await opencode.default.setup(ctx)
assert.equal(captured.skills.filter((skill) => skill.id === "deep-research").length, 1)
assert.ok(captured.skills.some((skill) => skill.id === "brainstorming"))
assert.ok(captured.tools.has("parallel_status"))
assert.ok(captured.tools.has("cancel_task"))
assert.ok(captured.commands.some((command) => command.name === "ps"))
assert.ok(captured.mcps.context7)
if (typeof cleanup === "function") await cleanup()

function runCli(packageName, relativeCli, cwd) {
  fs.mkdirSync(cwd, { recursive: true })
  const result = spawnSync(process.execPath, [path.join(installed(packageName), relativeCli)], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config"), CODEX_HOME: undefined, OMAGENTS_SEARCH_PROVIDER: "auto", EXA_API_KEY: "", KEENABLE_API_KEY: "", YDC_API_KEY: "" },
    encoding: "utf8",
    timeout: 30_000,
    killSignal: "SIGKILL",
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result
}
const openCodeSurface = path.join(home, "opencode-project")
runCli("@omagents/omagents", "bin/install.js", openCodeSurface)
const openCodeConfig = JSON.parse(fs.readFileSync(path.join(openCodeSurface, "opencode.json"), "utf8"))
assert.deepEqual(openCodeConfig.plugin, ["@omagents/omagents"])

const codexSurface = path.join(home, "codex-project")
fs.mkdirSync(path.join(home, ".codex"), { recursive: true })
runCli("@omagents/omagents-codex", "bin/install.js", codexSurface)
const pluginRoot = path.join(home, ".codex", "plugins", "cache", "omagents", "omagents", "local")
assert.equal(fs.existsSync(path.join(pluginRoot, ".codex-plugin", "plugin.json")), true)
assert.equal(fs.existsSync(path.join(pluginRoot, "skills", "superpowers", "brainstorming", "SKILL.md")), true)
assert.equal(fs.existsSync(path.join(pluginRoot, "skills", "_shared", "scripts", "loop_engine.py")), true)
assert.match(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"), /\[plugins\."omagents@omagents"\]/)
const codexProxyDir = path.join(pluginRoot, "mcp-servers", "search-proxy")
const codexProxyEntry = path.join(codexProxyDir, "index.mjs")
assertCompleteSearchProxy(codexProxyDir, corePaths.searchProxyDir)
const codexMcp = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"))
assert.deepEqual(codexMcp.mcpServers.websearch, { command: "node", args: [codexProxyEntry] })
assert.equal(codexMcp.mcpServers.keenable, undefined)
assertSearchProxyHandshake(codexProxyEntry)

for (const name of ["@omagents/core", "@omagents/omagents", "@omagents/omagents-codex"]) {
  const resolved = fs.realpathSync(installed(name))
  assert.ok(resolved.startsWith(fs.realpathSync(hostProject) + path.sep))
}
console.log(JSON.stringify({
  coreAssets: true,
  bundledSuperpowers: 15,
  omagentsSkills: 18,
  openCodeV1: true,
  openCodeV2: true,
  openCodeCli: true,
  codexCli: true,
  coreSearchProxy: true,
  codexSearchProxy: true,
  searchProxyModules: searchProxyModules.length,
  windowsPython: true,
  dshBackgroundArgument: false,
}))
`

const DSH_PROBE = String.raw`
import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"

const profileDirectory = process.cwd()
const dshHome = path.resolve(profileDirectory, "..", "..")
const smokeProfile = path.join(dshHome, "profiles", "loader-smoke")
fs.mkdirSync(smokeProfile, { recursive: true })
if (!fs.existsSync(path.join(smokeProfile, "node_modules"))) {
  fs.symlinkSync(path.join(profileDirectory, "node_modules"), path.join(smokeProfile, "node_modules"), process.platform === "win32" ? "junction" : "dir")
}
process.env.DSH_HOME = dshHome
process.env.HOME = path.join(dshHome, "user-home")
process.env.USERPROFILE = process.env.HOME
fs.mkdirSync(process.env.HOME, { recursive: true })
delete process.env.DEEPSEEK_API_KEY

let root
let entry
let server
try {
const { Context } = await import("@deepseek-ai/cordis")
const { default: Loader } = await import("@deepseek-ai/cordis-plugin-loader")
root = new Context()
const skills = []
const tools = new Map()
const commands = new Map()
root.provide("omagentsPython", { ensureBaseEnvironment: async () => ({ status: "isolated" }) })
root.provide("mcpManager", { has: () => true, register: () => { throw new Error("unexpected MCP override") } })
root.provide("skills", { register(skill) { skills.push(skill); return () => {} } })
root.provide("tools", { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } })
root.provide("commands", { register(command) { commands.set(command.name, command); return () => commands.delete(command.name) } })
root.provide("subagents", { interrupt() {} })
await root.plugin(Loader, { baseUrl: pathToFileURL(smokeProfile + path.sep).href })
const id = await root.loader.create({ name: "@omagents/omagents-dsh" })
await root.loader.await()
entry = root.loader.resolve(id)
assert.equal(entry.disabled, false)
assert.ok(entry.fiber)
await entry.fiber.await()
const runtime = entry.fiber.ctx.omagents ?? root.get("omagents")
assert.ok(runtime)
assert.equal(runtime.health.host.status, "ready")
assert.equal(runtime.health.persistence.status, "ready")
await new Promise((resolve) => setImmediate(resolve))
assert.equal(skills.length, 33)
assert.ok(tools.has("parallel_status"))
assert.ok(commands.has("ps"))
const job = runtime.board.registerLaunch({ host: "dsh", hostTaskId: "packed-loader", parentSessionId: "packed-parent", childName: "packed-loader", agent: "spawn", description: "Packed Loader smoke" })
await runtime.board.flush()
const persisted = JSON.parse(fs.readFileSync(path.join(smokeProfile, "omagents", "job-board.json"), "utf8"))
assert.equal(persisted.jobs[0].id, job.id)

const clientArtifact = path.join(profileDirectory, "node_modules", "@omagents", "omagents-dsh", "dist", "client.js")
server = http.createServer((request, response) => {
  if (request.url !== "/client.js") { response.writeHead(404).end(); return }
  response.writeHead(200, { "content-type": "text/javascript" })
  fs.createReadStream(clientArtifact).pipe(response)
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
const served = await fetch("http://127.0.0.1:" + address.port + "/client.js")
assert.equal(served.status, 200)
const clientSource = await served.text()
assert.match(clientSource, /window\.__ModuleLoader__\.load\(\{/)
assert.match(clientSource, /@omagents\/omagents-dsh/)
if (process.env.OMAGENTS_DSH_PROBE_FAIL) throw new Error("intentional DSH probe failure")
await new Promise((resolve) => server.close(resolve))
root.loader.remove(id)
await entry.fiber.dispose()
await root.fiber.dispose()
console.log(JSON.stringify({ realLoader: true, skills: skills.length, clientServed: true, prepareScriptsRun: 0, clientArtifact }))
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(resolve))
  if (entry?.fiber) await Promise.resolve(entry.fiber.dispose()).catch(() => {})
  if (root) await Promise.resolve(root.fiber.dispose()).catch(() => {})
}
`

async function runProbe(name, source, cwd) {
  const probePath = path.join(cwd, `${name}.mjs`)
  fs.writeFileSync(probePath, source)
  const result = await run(process.execPath, [probePath], {
    cwd,
    timeoutMs: Number(process.env.OMAGENTS_PACKED_PROBE_TIMEOUT_MS ?? 120_000),
    env: {
      ...process.env,
      HOME: path.join(path.dirname(cwd), "home"),
      USERPROFILE: path.join(path.dirname(cwd), "home"),
      NODE_PATH: "",
      NODE_OPTIONS: "",
      GITHUB_TOKEN: "",
      OMAGENTS_SEARCH_PROVIDER: "auto",
      EXA_API_KEY: "",
      KEENABLE_API_KEY: "",
      YDC_API_KEY: "",
      CONTEXT7_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      DSH_TELEMETRY_DISABLED: "1",
    },
  })
  const lines = result.stdout.trim().split("\n")
  return JSON.parse(lines.at(-1))
}

test(
  "four aligned tarballs install and run in an offline clean room",
  { timeout: Number(process.env.OMAGENTS_PACKED_TEST_TIMEOUT_MS ?? 1_800_000) },
  async (t) => {
    const previousTestTmp = process.env.OMAGENTS_TEST_TMP
    fs.mkdirSync(ARTIFACT_ROOT, { recursive: true })
    const aliasContainer = fs.mkdtempSync(path.join(ARTIFACT_ROOT, "realpath-alias-"))
    const testTmpAlias = path.join(aliasContainer, "tmp")
    fs.symlinkSync(
      fs.realpathSync(os.tmpdir()),
      testTmpAlias,
      process.platform === "win32" ? "junction" : "dir"
    )
    process.env.OMAGENTS_TEST_TMP = testTmpAlias
    t.after(() => {
      if (previousTestTmp === undefined) delete process.env.OMAGENTS_TEST_TMP
      else process.env.OMAGENTS_TEST_TMP = previousTestTmp
      fs.rmSync(aliasContainer, { recursive: true, force: true })
    })

    const summary = await prepareCleanRoom({ pack: true })
    assert.equal(
      summary.cleanRoot,
      fs.realpathSync(summary.cleanRoot),
      "OMAGENTS_TEST_TMP aliases must produce canonical clean-room paths"
    )
    assert.equal(summary.packed.artifacts.length, 4)
    assert.equal(new Set(summary.packed.artifacts.map((artifact) => artifact.version)).size, 1)
    assert.equal(summary.prepareScriptsRun, 0)

    await t.test("Core assets, all skills, OpenCode V1/V2, and no-arg CLIs", async () => {
      const result = await runProbe("host-clean-room-probe", HOST_PROBE, summary.hostProject)
      assert.deepEqual(result, {
        coreAssets: true,
        bundledSuperpowers: 15,
        omagentsSkills: 18,
        openCodeV1: true,
        openCodeV2: true,
        openCodeCli: true,
        codexCli: true,
        coreSearchProxy: true,
        codexSearchProxy: true,
        searchProxyModules: 6,
        windowsPython: true,
        dshBackgroundArgument: false,
      })
    })

    await t.test("packed DSH uses the real Loader and serves its built Client", async () => {
      const result = await runProbe("dsh-clean-room-probe", DSH_PROBE, summary.profileDirectory)
      assert.equal(result.realLoader, true)
      assert.equal(result.skills, 33)
      assert.equal(result.clientServed, true)
      assert.equal(result.prepareScriptsRun, 0)
      assert.equal(result.clientArtifact, summary.clientArtifact)
      assert.equal(fs.existsSync(result.clientArtifact), true)
    })

    const evidence = {
      cleanRoom: summary.cleanRoot,
      tarballs: summary.packed.artifacts.map(({ name, version, filename, sha256 }) => ({
        name,
        version,
        filename,
        sha256,
      })),
      prepareScriptsRun: summary.prepareScriptsRun,
      offline: true,
      completedAt: new Date().toISOString(),
    }
    fs.writeFileSync(
      path.join(ARTIFACT_ROOT, "packed-verification.json"),
      `${JSON.stringify(evidence, null, 2)}\n`
    )
  }
)
