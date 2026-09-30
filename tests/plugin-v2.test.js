import { test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import os from "os"
import path from "path"

const ROOT = path.resolve(import.meta.dirname, "..")
const SKILLS_DIR = path.join(ROOT, "skills")
const PLUGINS_DIR = path.join(ROOT, ".opencode", "plugins")

/**
 * Minimal fake of the V2 plugin context (@opencode/plugin promise API).
 * Captures every registration so tests can assert what setup() did.
 * superpowers (a real dependency) also runs its V2 setup against this ctx,
 * so assertions are tolerant of its registrations too.
 */
function makeFakeV2Context() {
  const captured = {
    skills: [],
    mcps: {},
    tools: new Map(),
    commands: [],
    toolHooks: {},
    sessionHooks: {},
    shellHooks: {},
  }

  const ctx = {
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

test("V2 setup returns quietly for a V1-shaped context", async () => {
  const mod = await import(path.join(PLUGINS_DIR, "index.js"))
  await assert.doesNotReject(() => mod.default.setup(null))
  await assert.doesNotReject(() => mod.default.setup({}))
  await assert.doesNotReject(() => mod.default.setup({ session: {} }))
})

test("V2 setup registers bundled skills via ctx.skill.transform", async () => {
  const mod = await import(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context()
  const cleanup = await mod.default.setup(ctx)
  try {
    // Every skills/<name>/SKILL.md must be registered (superpowers skills may
    // also be present — assert containment, not equality)
    const expected = fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
      .filter((e) => fs.existsSync(path.join(SKILLS_DIR, e.name, "SKILL.md")))
      .map((e) => e.name)
    assert.ok(expected.length >= 18, "repo should bundle at least 18 skills")
    const registered = new Set(captured.skills.map((s) => s.id))
    for (const id of expected) {
      assert.ok(registered.has(id), `skill "${id}" should be registered`)
    }
    // Registered entries carry the V2 Skill.Info fields
    const deepResearch = captured.skills.find((s) => s.id === "deep-research")
    assert.ok(deepResearch.name, "skill has a name")
    assert.ok(deepResearch.description, "skill has a description")
    assert.ok(deepResearch.path.endsWith(path.join("deep-research", "SKILL.md")))
    assert.ok(deepResearch.content.length > 0, "skill has body content")
    assert.ok(!deepResearch.content.startsWith("---"), "frontmatter is stripped from content")
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 setup registers built-in MCP servers in V2 shape", async () => {
  const mod = await import(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context()
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
    // context7 always runs locally; websearch goes local only with EXA_API_KEY
    assert.strictEqual(captured.mcps.context7.type, "local", "context7 should register as local")
    if (process.env.EXA_API_KEY) {
      assert.strictEqual(captured.mcps.websearch.type, "local", "websearch local with EXA_API_KEY")
    } else {
      assert.strictEqual(
        captured.mcps.websearch.type,
        "remote",
        "websearch stays on the remote endpoint without EXA_API_KEY"
      )
    }
    for (const [name, cfg] of Object.entries(captured.mcps)) {
      assert.ok(!("enabled" in cfg), `MCP "${name}" must not carry the V1 'enabled' field`)
      assert.ok(cfg.type === "local" || cfg.type === "remote", `MCP "${name}" has a valid type`)
    }
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 setup does not override user-configured MCP servers", async () => {
  const mod = await import(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context()
  captured.mcps.context7 = { type: "remote", url: "https://example.com/custom" }
  await mod.default.setup(ctx)
  assert.strictEqual(captured.mcps.context7.url, "https://example.com/custom")
})

test("V2 setup registers parallel_status/cancel_task tools and /ps command", async () => {
  const mod = await import(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context()
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

test("V2 parallel engine tracks a background subagent end to end", async () => {
  const mod = await import(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context()
  const cleanup = await mod.default.setup(ctx)
  try {
    const before = captured.toolHooks["execute.before"]?.[0]
    const after = captured.toolHooks["execute.after"]?.[0]
    assert.ok(before && after, "tool hooks registered")

    // Foreground subagent calls are not tracked
    await before({
      tool: "subagent",
      sessionID: "ses_parent_t1",
      id: "call_fg",
      input: { agent: "explore", description: "sync call" },
    })
    // Background launch
    await before({
      tool: "subagent",
      sessionID: "ses_parent_t1",
      id: "call_bg",
      input: { agent: "explore", description: "bg job", background: true, prompt: "do it" },
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

test("V2 shell hook prepends venv and skill script dirs to PATH", async () => {
  const mod = await import(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context()
  const cleanup = await mod.default.setup(ctx)
  try {
    const hook = captured.shellHooks["create.before"]?.[0]
    assert.ok(hook, "shell create.before hook registered")
    const event = { env: { PATH: "/usr/bin:/bin" } }
    await hook(event)
    const parts = event.env.PATH.split(path.delimiter)
    assert.ok(
      parts.some((p) => p.endsWith(path.join(".venvs", "omagents", "bin"))),
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
      again.filter((p) => p.endsWith(path.join(".venvs", "omagents", "bin"))).length,
      1,
      "venv bin appears exactly once"
    )
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("V2 compaction hook appends the state preservation note", async () => {
  const mod = await import(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context()
  const cleanup = await mod.default.setup(ctx)
  try {
    const hook = captured.sessionHooks["compaction"]?.[0]
    assert.ok(hook, "compaction hook registered")
    const event = { system: [] }
    await hook(event)
    assert.ok(
      event.system.some((p) => p.text?.includes("OmAgents State Preservation")),
      "note appended"
    )
    await hook(event)
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

/** Copy the plugin into a fake node_modules layout (the "installed package"). */
function makeInstalledCopy(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-installed-"))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const pkgDir = path.join(tmp, "node_modules", "@omagents", "omagents")
  fs.mkdirSync(path.join(pkgDir, ".opencode", "plugins"), { recursive: true })
  fs.mkdirSync(path.join(pkgDir, "mcp-servers"), { recursive: true })
  for (const f of ["index.js", "parallel.js"]) {
    fs.copyFileSync(path.join(PLUGINS_DIR, f), path.join(pkgDir, ".opencode", "plugins", f))
  }
  fs.copyFileSync(
    path.join(ROOT, "mcp-servers", "base.json"),
    path.join(pkgDir, "mcp-servers", "base.json")
  )
  return path.join(pkgDir, ".opencode", "plugins", "index.js")
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
  const mod = await import(entry)
  const { ctx, captured } = makeFakeV2Context()
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
  const subdir = path.join(srcRepo, "skills", "deep-research")
  fs.mkdirSync(subdir, { recursive: true })
  const mod = await import(entry)
  const { ctx, captured } = makeFakeV2Context()
  ctx.location = { directory: subdir }
  await mod.default.setup(ctx)
  assert.strictEqual(Object.keys(captured.mcps).length, 0, "no MCPs registered when yielding")
})

test("installed package runs normally in any other project (V2)", async (t) => {
  const entry = makeInstalledCopy(t)
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-other-"))
  t.after(() => fs.rmSync(other, { recursive: true, force: true }))
  const mod = await import(entry)
  const { ctx, captured } = makeFakeV2Context()
  ctx.location = { directory: other, project: { directory: other } }
  const cleanup = await mod.default.setup(ctx)
  try {
    assert.ok(Object.keys(captured.mcps).length > 0, "MCPs registered in a normal project")
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})

test("installed package yields to the local checkout inside the source repo (V1)", async (t) => {
  const entry = makeInstalledCopy(t)
  const srcRepo = makeSourceRepo(t)
  const mod = await import(entry)
  const hooks = await mod.default.server({ directory: srcRepo })
  assert.deepStrictEqual(hooks, {}, "V1 returns empty hooks when yielding")
})

test("local checkout never yields inside the source repo (V2)", async () => {
  const mod = await import(path.join(PLUGINS_DIR, "index.js"))
  const { ctx, captured } = makeFakeV2Context()
  ctx.location = { directory: ROOT, project: { directory: ROOT } }
  const cleanup = await mod.default.setup(ctx)
  try {
    assert.ok(Object.keys(captured.mcps).length > 0, "local checkout stays active in its own repo")
  } finally {
    if (typeof cleanup === "function") await cleanup()
  }
})
