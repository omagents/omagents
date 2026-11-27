import { after, test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import os from "os"
import path from "path"
import { importModule } from "./import-module.js"
import { pathToFileURL } from "node:url"

let freshModuleId = 0
function importFreshModule(filePath) {
  freshModuleId += 1
  return import(`${pathToFileURL(filePath).href}?omagents-v2-test=${freshModuleId}`)
}

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

const SEARCH_ENV_KEYS = [
  "OMAGENTS_SEARCH_PROVIDER",
  "EXA_API_KEY",
  "KEENABLE_API_KEY",
  "YDC_API_KEY",
]
const ORIGINAL_SEARCH_ENV = new Map(SEARCH_ENV_KEYS.map((key) => [key, process.env[key]]))
process.env.OMAGENTS_SEARCH_PROVIDER = "auto"
delete process.env.EXA_API_KEY
delete process.env.KEENABLE_API_KEY
delete process.env.YDC_API_KEY
after(() => {
  for (const [key, value] of ORIGINAL_SEARCH_ENV) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function setSearchEnv(t, values) {
  const previous = new Map(SEARCH_ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

/**
 * Minimal fake of the V2 plugin context (@opencode/plugin promise API).
 * Captures every registration so tests can assert what setup() did.
 * superpowers (a real dependency) also runs its V2 setup against this ctx,
 * so assertions are tolerant of its registrations too.
 */
function makeFakeV2Context(t) {
  const storageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-v2-test-"))
  t.after(() => fs.rmSync(storageDirectory, { recursive: true, force: true }))
  const captured = {
    skills: [],
    mcps: {},
    tools: new Map(),
    commands: [],
    toolHooks: {},
    sessionHooks: {},
    shellHooks: {},
    pythonProvisions: 0,
  }

  const ctx = {
    omagents: {
      jobStorePath: path.join(storageDirectory, "job-board.json"),
      tuiStatePath: path.join(storageDirectory, "tui-state.json"),
      ensureBaseEnvironment: async () => {
        captured.pythonProvisions += 1
        return { status: "reused" }
      },
    },
    skill: {
      transform: async (cb) =>
        cb({
          add: (s) => captured.skills.push(s),
          get: () => undefined,
          list: () => [],
        }),
    },
    mcp: {
      transform: async (cb) =>
        cb({
          get: (name) => captured.mcps[name],
          set: (name, cfg) => {
            captured.mcps[name] = cfg
          },
        }),
    },
    tool: {
      transform: async (cb) =>
        cb({
          add: (t) => captured.tools.set(t.name, t),
          namespace: () => {},
        }),
      hook: async (name, cb) => {
        ;(captured.toolHooks[name] ||= []).push(cb)
      },
    },
    session: {
      hook: async (name, cb) => {
        ;(captured.sessionHooks[name] ||= []).push(cb)
      },
      get: async ({ sessionID }) => ({ id: sessionID }),
      prompt: async () => {},
      interrupt: async () => {},
    },
    shell: {
      hook: async (name, cb) => {
        ;(captured.shellHooks[name] ||= []).push(cb)
      },
    },
    command: {
      list: async () => [],
      transform: async (cb) => cb({ add: (c) => captured.commands.push(c) }),
    },
    event: {
      // Never yields; no active handles so the test process can exit
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {
          await new Promise(() => {})
        },
      }),
    },
  }

  return { ctx, captured }
}

test("V2 setup returns quietly for a V1-shaped context", async (t) => {
  const mod = await importModule(path.join(PLUGINS_DIR, "index.js"))
  await assert.doesNotReject(() => mod.default.setup(null))
  await assert.doesNotReject(() => mod.default.setup({}))
  await assert.doesNotReject(() => mod.default.setup({ session: {} }))
})

test("V2 setup uses the injected Python provisioner", async (t) => {
  const mod = await importModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const cleanup = await mod.default.setup(ctx)
  try {
    assert.equal(captured.pythonProvisions, 1)
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 setup registers every bundled skill once through Core with flattened Superpowers docs", async (t) => {
  const mod = await importModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const cleanup = await mod.default.setup(ctx)
  try {
    const expected = fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
      .filter((e) => fs.existsSync(path.join(SKILLS_DIR, e.name, "SKILL.md")))
      .map((e) => e.name)
    assert.ok(expected.length >= 18, "repo should bundle at least 18 skills")
    const registered = new Set(captured.skills.map((s) => s.id))
    assert.equal(captured.skills.length, 33, "Core is the single registration path for all skills")
    assert.equal(registered.size, 33, "Superpowers and Core must not register duplicate skills")
    for (const id of expected) {
      assert.ok(registered.has(id), `skill "${id}" should be registered`)
    }
    for (const id of ["brainstorming", "writing-plans"]) {
      assert.ok(registered.has(id), `Superpowers skill "${id}" should be Core-rendered`)
    }

    // Registered entries carry the V2 Skill.Info fields
    const deepResearch = captured.skills.find((s) => s.id === "deep-research")
    assert.ok(deepResearch.name, "skill has a name")
    assert.ok(deepResearch.description, "skill has a description")
    assert.ok(deepResearch.path.endsWith(path.join("deep-research", "SKILL.md")))
    assert.ok(deepResearch.content.length > 0, "skill has body content")
    assert.ok(!deepResearch.content.startsWith("---"), "frontmatter is stripped from content")

    const brainstorming = captured.skills.find((s) => s.id === "brainstorming")
    const writingPlans = captured.skills.find((s) => s.id === "writing-plans")
    assert.match(brainstorming.content, /docs\/specs\//)
    assert.match(writingPlans.content, /docs\/plans\//)
    assert.doesNotMatch(brainstorming.content, /docs\/superpowers\//)
    assert.doesNotMatch(writingPlans.content, /docs\/superpowers\//)
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 setup registers built-in MCP servers in V2 shape", async (t) => {
  const mod = await importModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const cleanup = await mod.default.setup(ctx)
  try {
    for (const name of ["agentmemory", "codegraph", "context7", "websearch"]) {
      assert.ok(captured.mcps[name], `MCP "${name}" should be registered`)
    }
    // Conditional code-search server: github when GITHUB_TOKEN, else grep_app
    if (process.env.GITHUB_TOKEN) {
      assert.ok(captured.mcps.github, "github should be registered when GITHUB_TOKEN is set")
      assert.ok(!captured.mcps.grep_app)
    } else {
      assert.ok(captured.mcps.grep_app, "grep_app should be registered without GITHUB_TOKEN")
      assert.ok(!captured.mcps.github)
    }
    assert.strictEqual(captured.mcps.context7.type, "local", "context7 should register as local")
    assert.deepStrictEqual(captured.mcps.websearch, {
      type: "local",
      command: ["node", SEARCH_PROXY_ENTRY],
      timeout: { startup: 180_000 },
    })
    for (const [name, cfg] of Object.entries(captured.mcps)) {
      assert.ok(!("enabled" in cfg), `MCP "${name}" must not carry the V1 'enabled' field`)
      assert.ok(cfg.type === "local" || cfg.type === "remote", `MCP "${name}" has a valid type`)
      if (cfg.type === "local") {
        assert.ok(
          cfg.timeout?.startup >= 60_000,
          `local MCP "${name}" should carry a generous startup timeout (cold npx cache)`
        )
      }
    }
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 setup forwards automatic You.com credentials to the local proxy", async (t) => {
  setSearchEnv(t, {
    OMAGENTS_SEARCH_PROVIDER: "auto",
    EXA_API_KEY: "v2-auto-exa-key",
    KEENABLE_API_KEY: "v2-auto-keenable-key",
    YDC_API_KEY: "v2-auto-youcom-key",
  })
  const mod = await importFreshModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const cleanup = await mod.default.setup(ctx)
  try {
    assert.deepStrictEqual(captured.mcps.websearch, {
      type: "local",
      command: ["node", SEARCH_PROXY_ENTRY],
      environment: {
        EXA_API_KEY: "v2-auto-exa-key",
        KEENABLE_API_KEY: "v2-auto-keenable-key",
        YDC_API_KEY: "v2-auto-youcom-key",
      },
      timeout: { startup: 180_000 },
    })
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 setup registers keyed direct You.com without the proxy", async (t) => {
  setSearchEnv(t, {
    OMAGENTS_SEARCH_PROVIDER: "youcom",
    EXA_API_KEY: "unused-exa-key",
    KEENABLE_API_KEY: "unused-keenable-key",
    YDC_API_KEY: "v2-direct-youcom-key",
  })
  const mod = await importFreshModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const cleanup = await mod.default.setup(ctx)
  try {
    assert.deepStrictEqual(captured.mcps.youdotcom, {
      type: "remote",
      url: "https://api.you.com/mcp",
      oauth: false,
      headers: { Authorization: "Bearer v2-direct-youcom-key" },
    })
    assert.strictEqual(captured.mcps.websearch, undefined)
    assert.strictEqual(captured.mcps.keenable, undefined)
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 setup registers keyless direct You.com without authentication", async (t) => {
  setSearchEnv(t, { OMAGENTS_SEARCH_PROVIDER: "youcom", YDC_API_KEY: "" })
  const mod = await importFreshModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const cleanup = await mod.default.setup(ctx)
  try {
    assert.deepStrictEqual(captured.mcps.youdotcom, {
      type: "remote",
      url: "https://api.you.com/mcp/free",
      oauth: false,
    })
    assert.strictEqual(captured.mcps.websearch, undefined)
    assert.strictEqual(captured.mcps.keenable, undefined)
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 setup does not override a user-configured youdotcom", async (t) => {
  setSearchEnv(t, { OMAGENTS_SEARCH_PROVIDER: "youcom", YDC_API_KEY: "unused-youcom-key" })
  const mod = await importFreshModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const custom = { type: "remote", url: "https://example.com/custom-youcom", oauth: false }
  captured.mcps.youdotcom = custom
  const cleanup = await mod.default.setup(ctx)
  try {
    assert.deepStrictEqual(captured.mcps.youdotcom, custom)
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 setup does not override user-configured MCP servers", async (t) => {
  const mod = await importModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const customWebsearch = {
    type: "remote",
    url: "https://example.com/custom-websearch",
    oauth: false,
  }
  captured.mcps.context7 = { type: "remote", url: "https://example.com/custom" }
  captured.mcps.websearch = customWebsearch
  await mod.default.setup(ctx)
  assert.strictEqual(captured.mcps.context7.url, "https://example.com/custom")
  assert.deepStrictEqual(captured.mcps.websearch, customWebsearch)
})

test("V2 setup registers parallel_status/cancel_task tools and /ps command", async (t) => {
  const mod = await importModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const cleanup = await mod.default.setup(ctx)
  try {
    assert.ok(captured.tools.has("parallel_status"), "parallel_status registered")
    assert.ok(captured.tools.has("cancel_task"), "cancel_task registered")
    const ps = captured.tools.get("parallel_status")
    const result = await ps.execute({})
    assert.ok(typeof result.content === "string", "tool returns { content }")
    assert.ok(JSON.parse(result.content).total >= 0)
    assert.ok(
      captured.commands.some((c) => c.name === "ps"),
      "/ps command registered"
    )
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 parallel engine tracks a background subagent end to end", async (t) => {
  const mod = await importModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const cleanup = await mod.default.setup(ctx)
  try {
    const before = captured.toolHooks["execute.before"]?.[0]
    const after = captured.toolHooks["execute.after"]?.[0]
    assert.ok(before && after, "tool hooks registered")

    // OpenCode 2.3+ subagents are always background and have no background argument.
    await before({
      tool: "subagent",
      sessionID: "ses_parent_t1",
      id: "call_bg",
      input: { agent: "explore", description: "bg job", prompt: "do it" },
    })
    await after({
      tool: "subagent",
      sessionID: "ses_parent_t1",
      id: "call_bg",
      status: "completed",
      result: {
        output: { sessionID: "ses_child_t1", status: "running", output: "working..." },
        content: "The subagent is working in the background (sessionID: ses_child_t1).",
        metadata: { sessionID: "ses_child_t1", status: "running" },
      },
    })

    const statusTool = captured.tools.get("parallel_status")
    const tracked = JSON.parse((await statusTool.execute({})).content)
    const job = tracked.tasks.find((t) => t.task_id === "ses_child_t1")
    assert.ok(job, "background subagent is tracked on the job board")
    assert.strictEqual(job.state, "running")
    assert.strictEqual(job.agent, "explore")

    // Completion arrives as a synthetic <subagent ...> user message; the
    // context hook scans it and updates the job
    const contextHook = captured.sessionHooks["context"].at(-1)
    const event = {
      sessionID: "ses_parent_t1",
      system: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "launch something" }] },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: '<subagent sessionID="ses_child_t1" state="completed" description="bg job">\nAll done.\n</subagent>',
            },
          ],
        },
      ],
    }
    await contextHook(event)

    const done = JSON.parse((await statusTool.execute({})).content)
    const doneJob = done.tasks.find((t) => t.task_id === "ses_child_t1")
    assert.strictEqual(doneJob.state, "completed")
    assert.strictEqual(doneJob.result, "All done.")

    // System prompt injected
    assert.ok(
      event.system.some(
        (p) =>
          p.type === "text" &&
          p.text.includes("<Parallel_Execution>") &&
          p.text.includes("subagent(")
      ),
      "V2 parallel system prompt references the subagent tool"
    )
    assert.ok(
      event.system.every(
        (p) => !p.text?.includes("<Parallel_Execution>") || !p.text.includes("background: true")
      ),
      "V2 parallel system prompt must not require the removed background argument"
    )
    // Job board injected into the last user message
    const lastUser = event.messages.at(-1)
    assert.ok(
      lastUser.content.some(
        (p) => p.type === "text" && p.text.includes("SENTINEL: omagents-job-board-v1")
      ),
      "job board injected into the last user message"
    )
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 shell hook prepends venv and skill script dirs to PATH", async (t) => {
  const mod = await importModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const cleanup = await mod.default.setup(ctx)
  try {
    const hook = captured.shellHooks["create.before"]?.[0]
    assert.ok(hook, "shell create.before hook registered")
    const event = { env: { PATH: "/usr/bin:/bin" } }
    await hook(event)
    const parts = event.env.PATH.split(path.delimiter)
    const venvBin = path.join(
      ".venvs",
      "omagents",
      process.platform === "win32" ? "Scripts" : "bin"
    )
    assert.ok(
      parts.some((p) => p.endsWith(venvBin)),
      "venv bin on PATH"
    )
    assert.ok(
      parts.some((p) => p.endsWith(path.join("skills", "_shared", "scripts"))),
      "shared skill scripts on PATH"
    )
    // Idempotent: a second invocation must not duplicate entries
    await hook(event)
    const again = event.env.PATH.split(path.delimiter)
    assert.strictEqual(
      again.filter((p) => p.endsWith(venvBin)).length,
      1,
      "venv bin appears exactly once"
    )
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 compaction hook appends the state preservation note", async (t) => {
  const mod = await importModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  const cleanup = await mod.default.setup(ctx)
  try {
    // Superpowers >= 7 registers its own compaction listener (bootstrap
    // prompt-cache parity) before OmAgents appends the state note, so
    // dispatch every listener in registration order the way OpenCode does.
    const hooks = captured.sessionHooks["compaction"] || []
    assert.ok(hooks.length > 0, "compaction hook registered")
    const event = { system: [] }
    for (const hook of hooks) await hook(event)
    assert.ok(
      event.system.some((p) => p.text?.includes("OmAgents State Preservation")),
      "note appended"
    )
    for (const hook of hooks) await hook(event)
    assert.strictEqual(
      event.system.filter((p) => p.text?.includes("OmAgents State Preservation")).length,
      1,
      "note is not duplicated"
    )
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

// ─── Self-repo dedup guard ─────────────────────────────────────────────────
//
// Inside the OmAgents source repo, the repo's own .opencode/plugins/*.js are
// auto-discovered as project plugins in addition to a globally-installed
// @omagents/omagents. The installed copy must yield so only the local
// checkout activates.

/** Copy OpenCode and Core into separate fake installed workspace packages. */
function makeInstalledCopy(t, { includeSuperpowers = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-installed-"))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const nodeModules = path.join(tmp, "node_modules")
  const pkgDir = path.join(nodeModules, "@omagents", "omagents")
  const moduleDir = path.join(pkgDir, "src")
  const coreDir = path.join(nodeModules, "@omagents", "core")
  fs.mkdirSync(moduleDir, { recursive: true })
  for (const f of fs.readdirSync(PLUGINS_DIR).filter((file) => file.endsWith(".js"))) {
    fs.copyFileSync(path.join(PLUGINS_DIR, f), path.join(moduleDir, f))
  }
  const coreSource = path.join(ROOT, "packages", "core")
  fs.cpSync(coreSource, coreDir, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(coreSource, source)
      return relative !== "node_modules" && !relative.startsWith(`node_modules${path.sep}`)
    },
  })

  // A minimal installed dependency is sufficient for these adapter tests; the
  // real pinned Superpowers implementation is exercised by the local suite.
  if (includeSuperpowers) {
    const superpowersDir = path.join(nodeModules, "superpowers")
    fs.mkdirSync(superpowersDir, { recursive: true })
    fs.writeFileSync(
      path.join(superpowersDir, "package.json"),
      JSON.stringify({ name: "superpowers", type: "module", main: "index.js" })
    )
    fs.writeFileSync(
      path.join(superpowersDir, "index.js"),
      "export default { server: async () => ({}), setup: async () => {} }\n"
    )
    const brainstormingDir = path.join(superpowersDir, "skills", "brainstorming")
    fs.mkdirSync(brainstormingDir, { recursive: true })
    fs.writeFileSync(
      path.join(brainstormingDir, "SKILL.md"),
      "---\nname: brainstorming\ndescription: Test skill\n---\n"
    )
  }
  return path.join(moduleDir, "index.js")
}

/** Create a fake OmAgents source checkout (package.json + project plugins). */
function makeSourceRepo(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-srcrepo-"))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  fs.mkdirSync(path.join(tmp, ".opencode", "plugins"), { recursive: true })
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "@omagents/omagents" }))
  fs.writeFileSync(path.join(tmp, ".opencode", "plugins", "index.js"), "// local checkout\n")
  return tmp
}

test("installed package yields to the local checkout inside the source repo (V2)", async (t) => {
  const entry = makeInstalledCopy(t)
  const srcRepo = makeSourceRepo(t)
  const mod = await importModule(entry)
  const { ctx, captured } = makeFakeV2Context(t)
  ctx.location = { directory: srcRepo, project: { directory: srcRepo } }
  await mod.default.setup(ctx)
  assert.strictEqual(captured.skills.length, 0, "no skills registered when yielding")
  assert.strictEqual(Object.keys(captured.mcps).length, 0, "no MCPs registered when yielding")
  assert.strictEqual(
    Object.keys(captured.sessionHooks).length,
    0,
    "no session hooks registered when yielding"
  )
})

test("installed package also yields from a subdirectory of the source repo (V2)", async (t) => {
  const entry = makeInstalledCopy(t)
  const srcRepo = makeSourceRepo(t)
  const subdir = path.join(srcRepo, "packages", "core", "skills", "deep-research")
  fs.mkdirSync(subdir, { recursive: true })
  const mod = await importModule(entry)
  const { ctx, captured } = makeFakeV2Context(t)
  ctx.location = { directory: subdir }
  await mod.default.setup(ctx)
  assert.strictEqual(Object.keys(captured.mcps).length, 0, "no MCPs registered when yielding")
})

test("installed package runs normally in any other project (V2)", async (t) => {
  const entry = makeInstalledCopy(t)
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-other-"))
  t.after(() => fs.rmSync(other, { recursive: true, force: true }))
  const mod = await importModule(entry)
  const { ctx, captured } = makeFakeV2Context(t)
  ctx.location = { directory: other, project: { directory: other } }
  const cleanup = await mod.default.setup(ctx)
  try {
    assert.ok(Object.keys(captured.mcps).length > 0, "MCPs registered in a normal project")
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("installed OpenCode loads its own skills and warns cleanly without Superpowers", async (t) => {
  const entry = makeInstalledCopy(t, { includeSuperpowers: false })
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-no-superpowers-"))
  t.after(() => fs.rmSync(other, { recursive: true, force: true }))
  const previousDebug = process.env.OMAGENTS_DEBUG
  const previousWarn = console.warn
  const warnings = []
  process.env.OMAGENTS_DEBUG = "1"
  console.warn = (...args) => warnings.push(args.join(" "))
  t.after(() => {
    if (previousDebug === undefined) delete process.env.OMAGENTS_DEBUG
    else process.env.OMAGENTS_DEBUG = previousDebug
    console.warn = previousWarn
  })

  const mod = await importModule(entry)
  const { ctx, captured } = makeFakeV2Context(t)
  ctx.location = { directory: other, project: { directory: other } }
  const cleanup = await mod.default.setup(ctx)
  try {
    assert.ok(captured.skills.some((skill) => skill.id === "deep-research"))
    assert.ok(!captured.skills.some((skill) => skill.id === "brainstorming"))
    assert.ok(Object.keys(captured.mcps).length > 0, "OmAgents MCP registration still runs")
    assert.ok(
      warnings.some((warning) => warning.includes("superpowers not available, skipping")),
      `missing dependency warning should be observable: ${warnings.join("\n")}`
    )
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("installed package yields to the local checkout inside the source repo (V1)", async (t) => {
  const entry = makeInstalledCopy(t)
  const srcRepo = makeSourceRepo(t)
  const mod = await importModule(entry)
  const hooks = await mod.default.server({ directory: srcRepo })
  assert.deepStrictEqual(hooks, {}, "V1 returns empty hooks when yielding")
})

test("local checkout never yields inside the source repo (V2)", async (t) => {
  const mod = await importModule(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context(t)
  ctx.location = { directory: ROOT, project: { directory: ROOT } }
  const cleanup = await mod.default.setup(ctx)
  try {
    assert.ok(Object.keys(captured.mcps).length > 0, "local checkout stays active in its own repo")
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})
