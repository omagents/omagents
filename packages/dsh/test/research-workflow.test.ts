import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

import { Context } from "@deepseek-ai/cordis"
import { scopeTarget } from "@deepseek-ai/dsh-scope"
import { SessionId } from "@deepseek-ai/dsh-session"
import { SubagentRunId } from "@deepseek-ai/dsh-subagent"
import * as ToolSubagent from "@deepseek-ai/dsh-tool-subagent"
import { JobBoard, listSkillDefinitions, renderSkillForHost } from "@omagents/core"

import { createHealthRecords } from "../dist/host/health.js"
import { registerDshTools } from "../dist/host/register-tools.js"
import { createSubagentTracker } from "../dist/host/subagent-tracker.js"

const ROOT = resolve(import.meta.dirname, "../../..")
const PYTHON = process.env.OMAGENTS_TEST_PYTHON || "python3"
const SCRIPTS = join(ROOT, "packages", "core", "skills", "deep-research", "scripts")
const DEEP_RESEARCH = join(SCRIPTS, "deep_research.py")
const LOOP_ENGINE = join(ROOT, "packages", "core", "skills", "_shared", "scripts", "loop_engine.py")

async function project(t) {
  const temporary = fs.realpathSync(await mkdtemp(join(tmpdir(), "omagents-dsh-research-")))
  let directory = temporary
  if (process.platform === "win32") {
    const resolved = spawnSync(
      PYTHON,
      ["-c", "import os, sys; print(os.path.realpath(sys.argv[1]))", temporary],
      { encoding: "utf8" }
    )
    assert.equal(resolved.status, 0, resolved.stderr)
    directory = resolved.stdout.trim()
  }
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function dispatchFrom(output) {
  const normalized = output.replaceAll("\r\n", "\n")
  const start = normalized.lastIndexOf('{\n  "action"')
  assert.notEqual(start, -1, `missing dispatch JSON:\n${output}`)
  return JSON.parse(normalized.slice(start))
}

async function runPython(script, args, cwd, environment = {}) {
  const env = { ...process.env }
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  const child = spawn(PYTHON, [script, ...args], {
    cwd,
    env,
  })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  const [code, signal] = await new Promise((resolveExit, reject) => {
    child.once("error", reject)
    child.once("exit", (exitCode, exitSignal) => resolveExit([exitCode, exitSignal]))
  })
  assert.equal(code, 0, `${script} failed (${signal}):\n${stdout}\n${stderr}`)
  return { stdout, stderr }
}

function runPythonSync(script, args, cwd) {
  const result = spawnSync(PYTHON, [script, ...args], { cwd, encoding: "utf8" })
  assert.equal(result.status, 0, `${script} failed:\n${result.stdout}\n${result.stderr}`)
  return result
}

async function nativeSubagentComposition(t) {
  const root = new Context()
  t.after(() => root.fiber.dispose())
  const definitions = new Map()
  const activations = []
  const names = new Map()
  const interrupts = []
  let nextChild = 0
  let activeStarts = 0
  let maxActiveStarts = 0
  const provider = {
    name: "spawn",
    inheritsParentContext: false,
    capabilities: {
      agentOptions: false,
      agentPreset: false,
      outputSchema: false,
      depthLimit: false,
    },
  }
  const tools = {
    definitions,
    register(definition) {
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
    get(name) {
      return definitions.get(name)
    },
  }
  const subagents = {
    getProvider(name) {
      return name === "spawn" ? provider : undefined
    },
    resolveMaxDepth() {
      return undefined
    },
    async startActivation(spec) {
      activeStarts += 1
      maxActiveStarts = Math.max(maxActiveStarts, activeStarts)
      activations.push(spec)
      await new Promise((resolveTurn) => setImmediate(resolveTurn))
      activeStarts -= 1
      const childId = SessionId(`research-child-${++nextChild}`)
      const name = `worker-${nextChild}`
      names.set(name, childId)
      return { childId, name }
    },
    async resolveName(_caller, name) {
      const childId = names.get(name)
      if (!childId) throw new Error(`unknown subagent name "${name}"`)
      return childId
    },
    interrupt(targetSessionId, authority) {
      interrupts.push({ targetSessionId, authority })
    },
  }
  root.provide("tools", tools)
  root.provide("subagents", subagents)
  root.provide("sessionProjections", {
    async register() {
      return {
        stateOf() {
          return null
        },
      }
    },
  })
  root.provide("systemPrompt", {
    getSectionOrder() {
      return 0
    },
    getContextOrder() {
      return 0
    },
    section() {
      return () => {}
    },
    context() {
      return () => {}
    },
  })
  await root.plugin(ToolSubagent, { provider: "spawn" })
  const subagent = definitions.get("subagent")
  assert.ok(subagent, "DSH 0.2.2 must expose its native subagent tool")
  assert.equal(subagent.parameters.properties.background, undefined)
  assert.ok(subagent.parameters.properties.description)
  assert.ok(subagent.parameters.properties.prompt)
  assert.ok(subagent.parameters.properties.cwd)
  return {
    root,
    tools,
    subagents,
    subagent,
    activations,
    interrupts,
    maxActiveStarts: () => maxActiveStarts,
  }
}

function parent(id = "research-parent") {
  return {
    id: SessionId(id),
    options: {},
    session: {
      id: SessionId(id),
      requestHeader() {
        return undefined
      },
    },
  }
}

async function startNativeLane(composition, owner, dispatch) {
  assert.equal(dispatch.action, "dispatch_subagent")
  const args = { description: dispatch.description, prompt: dispatch.prompt }
  if (dispatch.cwd !== undefined) args.cwd = dispatch.cwd
  assert.equal(Object.hasOwn(args, "background"), false)
  assert.equal(Object.hasOwn(args, "name"), false, "DSH has no native name argument")
  const exec = {
    callId: `call-${dispatch.name}`,
    rootCallId: `call-${dispatch.name}`,
    name: "subagent",
    arguments: args,
    agent: owner,
    signal: new AbortController().signal,
    token: Symbol(dispatch.name),
  }
  const value = await composition.subagent.execute(args, exec)
  const childId = await composition.subagents.resolveName(owner, value.name, exec.signal)
  const result = {
    isError: false,
    value,
    content: [{ type: "text", text: `started subagent ${value.name}` }],
  }
  const start = {
    runId: SubagentRunId(`run-${childId}`),
    provider: "spawn",
    parentSessionId: owner.session.id,
    id: childId,
    local: true,
  }
  composition.root.emit(scopeTarget(composition.root.subagents, owner), "subagent/start", start)
  composition.root.emit(scopeTarget(composition.root.tools, owner), "tools/result", exec, result)
  await new Promise((resolveTurn) => setImmediate(resolveTurn))
  return { start, result }
}

test("two concurrent research lanes translate structured dispatches to real native DSH subagent calls", async (t) => {
  const cwd = await project(t)
  const lanes = ["lane-a", "lane-b"]
  const results = await Promise.all(
    lanes.map((workspace) =>
      runPython(
        DEEP_RESEARCH,
        [
          "run-all",
          "--query",
          `Research ${workspace}`,
          "--workspace",
          workspace,
          "--skip-pre-research",
        ],
        cwd
      )
    )
  )
  const dispatches = results.map((result) => dispatchFrom(result.stdout))
  assert.notEqual(dispatches[0].run_id, dispatches[1].run_id)
  assert.ok(dispatches.every((dispatch) => dispatch.dispatches.length > 1))
  for (const envelope of dispatches) {
    assert.equal(
      new Set(envelope.dispatches.map((dispatch) => dispatch.name)).size,
      envelope.dispatches.length,
      "a pending batch must contain distinct research tasks"
    )
  }

  const composition = await nativeSubagentComposition(t)
  const owner = parent()
  const structured = dispatches.flatMap((envelope) => envelope.dispatches)
  await Promise.all(structured.map((dispatch) => startNativeLane(composition, owner, dispatch)))
  assert.equal(composition.activations.length, structured.length)
  assert.ok(composition.maxActiveStarts() > 1, "independent research dispatches must overlap")
  for (const dispatch of structured) {
    assert.equal(dispatch.cwd, cwd)
    assert.match(dispatch.prompt, /output_path|Output path/)
    assert.doesNotMatch(
      dispatch.prompt,
      /\btask\s*\(\s*background|background\s*[:=]\s*true|OPENCODE_/
    )
  }
  for (const dispatch of dispatches) {
    const queue = join(cwd, ".omagents", "loops", `deep-research-${dispatch.run_id}`, "tasks.json")
    assert.ok(fs.existsSync(queue), `missing run-scoped queue ${queue}`)
    assert.ok(!fs.existsSync(join(cwd, lanes[dispatches.indexOf(dispatch)], "plan.json")))
  }
})

function assertAutoProxyPrompt(prompt) {
  for (const tool of [
    "websearch_search",
    "websearch_fetch",
    "mcp__websearch__search",
    "mcp__websearch__fetch",
  ]) {
    assert.ok(prompt.includes(`\`${tool}\``), `auto prompt must name ${tool}`)
  }
  assert.match(prompt, /local Search MCP Proxy/i)
  assert.match(prompt, /Exa → Keenable → You\.com/)
  assert.match(prompt, /at most one attempt per eligible position/i)
  assert.match(prompt, /after a fallback-eligible failure at that position/i)
  assert.match(prompt, /do not perform provider fallback yourself/i)
  assert.match(prompt, /do not use direct Exa, direct Keenable, or direct You\.com tools/i)
  assert.doesNotMatch(
    prompt,
    /youdotcom_you-(?:search|extract)|mcp__youdotcom__you-(?:search|extract)/
  )
  assert.match(
    prompt,
    /do not use native web search\/fetch tools: `websearch_web_search_exa`, `webfetch`, `web_search`, or `web_fetch`/i
  )
}

function assertNativeResearchPaths(prompt, dispatch, envelope, cwd) {
  const planPath = join(cwd, ".omagents", "deep-research", envelope.run_id, "plan.json")
  const task =
    envelope.tasks?.find((candidate) => candidate.task_id === dispatch.name) || envelope.task
  assert.ok(task, "dispatch envelope must include the task output path")
  assert.ok(isAbsolute(planPath))
  assert.ok(prompt.includes(`Plan path: ${planPath}`))
  assert.ok(isAbsolute(task.output_path))
  assert.ok(prompt.includes(`Output path: ${task.output_path}`))
  assert.ok(isAbsolute(DEEP_RESEARCH))
  assert.ok(prompt.includes(DEEP_RESEARCH), "child prompt must use the absolute packaged CLI")
  assert.doesNotMatch(prompt, /\btask\s*\(\s*background|background\s*[:=]\s*true|OPENCODE_/)
}

test("DSH native children receive the actual auto proxy prompt", async (t) => {
  const cwd = await project(t)
  const result = await runPython(
    DEEP_RESEARCH,
    [
      "run-all",
      "--query",
      "Research auto proxy routing",
      "--workspace",
      "auto-proxy-native",
      "--skip-pre-research",
    ],
    cwd,
    { OMAGENTS_SEARCH_PROVIDER: "auto" }
  )
  const envelope = dispatchFrom(result.stdout)
  assert.equal(envelope.search_provider, "auto")
  const dispatch = envelope.dispatches[0]
  assert.equal(dispatch.search_provider, "auto")
  const composition = await nativeSubagentComposition(t)

  await startNativeLane(composition, parent(), dispatch)

  assert.equal(composition.activations.length, 1)
  const promptContent = composition.activations[0].prompt
  assert.equal(promptContent.length, 1)
  assert.equal(promptContent[0].type, "text")
  const prompt = promptContent[0].text
  assert.equal(prompt, dispatch.prompt)
  assertAutoProxyPrompt(prompt)
  assertNativeResearchPaths(prompt, dispatch, envelope, cwd)
})

function assertNoYoucomTools(prompt) {
  assert.doesNotMatch(prompt, /You\.com|youdotcom/i)
}

function assertExclusiveYoucomPrompt(prompt) {
  assert.match(prompt, /use only You\.com tools/i)
  assert.match(
    prompt,
    /Search with `youdotcom_you-search` on OpenCode or `mcp__youdotcom__you-search` on Codex\/DSH/i
  )
  assert.match(
    prompt,
    /fetch promising sources with `youdotcom_you-extract` on OpenCode or `mcp__youdotcom__you-extract` on Codex\/DSH/i
  )
  assert.match(
    prompt,
    /Do not use Exa, Keenable, the Search MCP Proxy, or native web search\/fetch tools/i
  )
  for (const tool of [
    "websearch_search",
    "websearch_fetch",
    "mcp__websearch__search",
    "mcp__websearch__fetch",
    "websearch_web_search_exa",
    "webfetch",
    "web_search",
    "web_fetch",
    "keenable_search_web_pages",
    "keenable_fetch_page_content",
    "mcp__keenable__search_web_pages",
    "mcp__keenable__fetch_page_content",
  ]) {
    assert.ok(!prompt.includes(`\`${tool}\``), `explicit You.com prompt must exclude ${tool}`)
  }
}

function assertExclusiveExaPrompt(prompt) {
  assert.match(prompt, /use only Exa tools/i)
  assertNoYoucomTools(prompt)
  assert.match(
    prompt,
    /Search with `websearch_web_search_exa` on OpenCode or `web_search` on Codex\/DSH/i
  )
  assert.match(
    prompt,
    /fetch promising sources with `webfetch` on OpenCode or `web_fetch` on Codex\/DSH/i
  )
  assert.match(
    prompt,
    /Do not use Keenable tools: `keenable_search_web_pages`, `keenable_fetch_page_content`, `mcp__keenable__search_web_pages`, or `mcp__keenable__fetch_page_content`/i
  )
}

test("DSH native children receive the actual exclusive Exa prompt", async (t) => {
  const cwd = await project(t)
  const result = await runPython(
    DEEP_RESEARCH,
    [
      "run-all",
      "--query",
      "Research Exa routing",
      "--workspace",
      "exa-native",
      "--skip-pre-research",
    ],
    cwd,
    { OMAGENTS_SEARCH_PROVIDER: "exa" }
  )
  const envelope = dispatchFrom(result.stdout)
  assert.equal(envelope.search_provider, "exa")
  const dispatch = envelope.dispatches[0]
  assert.equal(dispatch.search_provider, "exa")
  const composition = await nativeSubagentComposition(t)

  await startNativeLane(composition, parent(), dispatch)

  assert.equal(composition.activations.length, 1)
  const promptContent = composition.activations[0].prompt
  assert.equal(promptContent.length, 1)
  assert.equal(promptContent[0].type, "text")
  const prompt = promptContent[0].text
  assert.equal(prompt, dispatch.prompt)
  assertExclusiveExaPrompt(prompt)
  assertNativeResearchPaths(prompt, dispatch, envelope, cwd)
})

test("DSH native children receive the actual exclusive Keenable prompt", async (t) => {
  const cwd = await project(t)
  const result = await runPython(
    DEEP_RESEARCH,
    [
      "run-all",
      "--query",
      "Research Keenable routing",
      "--workspace",
      "keenable-native",
      "--skip-pre-research",
    ],
    cwd,
    { OMAGENTS_SEARCH_PROVIDER: "keenable" }
  )
  const envelope = dispatchFrom(result.stdout)
  const dispatch = envelope.dispatches[0]
  const composition = await nativeSubagentComposition(t)

  await startNativeLane(composition, parent(), dispatch)

  assert.equal(composition.activations.length, 1)
  const promptContent = composition.activations[0].prompt
  assert.equal(promptContent.length, 1)
  assert.equal(promptContent[0].type, "text")
  const prompt = promptContent[0].text
  assert.equal(prompt, dispatch.prompt)
  assert.match(prompt, /use only Keenable/i)
  assertNoYoucomTools(prompt)
  assert.match(prompt, /`mcp__keenable__search_web_pages`/)
  assert.match(prompt, /`mcp__keenable__fetch_page_content`/)
  assert.match(prompt, /do not use Exa/i)
  assert.match(prompt, /do not use native web search\/fetch tools/i)
  assertNativeResearchPaths(prompt, dispatch, envelope, cwd)
})

test("DSH native children receive the actual exclusive You.com prompt", async (t) => {
  const cwd = await project(t)
  const result = await runPython(
    DEEP_RESEARCH,
    [
      "run-all",
      "--query",
      "Research You.com routing",
      "--workspace",
      "youcom-native",
      "--skip-pre-research",
    ],
    cwd,
    { OMAGENTS_SEARCH_PROVIDER: "youcom" }
  )
  const envelope = dispatchFrom(result.stdout)
  assert.equal(envelope.search_provider, "youcom")
  const dispatch = envelope.dispatches[0]
  assert.equal(dispatch.search_provider, "youcom")
  const composition = await nativeSubagentComposition(t)

  await startNativeLane(composition, parent(), dispatch)

  assert.equal(composition.activations.length, 1)
  const promptContent = composition.activations[0].prompt
  assert.equal(promptContent.length, 1)
  assert.equal(promptContent[0].type, "text")
  const prompt = promptContent[0].text
  assert.equal(prompt, dispatch.prompt)
  assertExclusiveYoucomPrompt(prompt)
  assertNativeResearchPaths(prompt, dispatch, envelope, cwd)
})

test("hyperplan runs three critics to completion or authoritative cancellation", async (t) => {
  const skill = listSkillDefinitions({ host: "dsh" }).find((entry) => entry.name === "hyperplan")
  const content = renderSkillForHost(skill, "dsh").content
  assert.match(content, /`subagent`/)
  assert.doesNotMatch(content, /\btask\s*\(\s*background|background\s*[:=]\s*true|OPENCODE_/)

  const cwd = await project(t)
  runPythonSync(
    LOOP_ENGINE,
    [
      "init",
      "hyperplan",
      JSON.stringify([
        { task_id: "security", critic: "security", description: "Security critic" },
        { task_id: "architecture", critic: "architecture", description: "Architecture critic" },
        { task_id: "edge-cases", critic: "edge-cases", description: "Edge cases critic" },
      ]),
    ],
    cwd
  )

  const composition = await nativeSubagentComposition(t)
  const board = new JobBoard({
    idGenerator: (() => {
      let id = 0
      return () => `critic-job-${++id}`
    })(),
  })
  const tracker = createSubagentTracker(composition.root, board)
  t.after(() => tracker.dispose())
  await new Promise((resolveTurn) => setImmediate(resolveTurn))
  registerDshTools(
    composition.root,
    board,
    tracker,
    createHealthRecords(() => [])
  )
  const owner = parent()
  const critics = ["security", "architecture", "edge-cases"].map((name) => ({
    action: "dispatch_subagent",
    name,
    description: `${name} critic`,
    prompt: `Review the approved plan as the ${name} critic. Return severity, location, and fix.`,
    cwd,
  }))
  const running = await Promise.all(
    critics.map((dispatch) => startNativeLane(composition, owner, dispatch))
  )
  assert.equal(board.list().length, 3)
  assert.ok(board.list().every((job) => job.executionState === "running"))

  for (const index of [0, 1]) {
    composition.root.emit(scopeTarget(composition.root.subagents, owner), "subagent/end", {
      ...running[index].start,
      stopReason: "completed",
      lastAssistantMessage: [{ type: "text", text: `${critics[index].name} findings` }],
    })
    runPythonSync(
      LOOP_ENGINE,
      ["complete", "hyperplan", critics[index].name, "findings returned"],
      cwd
    )
  }
  const cancelled = board.list().find((job) => job.description === "edge-cases critic")
  const cancellation = composition.tools.definitions.get("cancel_task")
  const accepted = await cancellation.execute({ task_id: cancelled.alias }, {})
  assert.equal(accepted.job.executionState, "cancelling")
  composition.root.emit(scopeTarget(composition.root.subagents, owner), "subagent/end", {
    ...running[2].start,
    stopReason: "aborted",
  })
  runPythonSync(LOOP_ENGINE, ["fail", "hyperplan", "edge-cases", "cancelled by user"], cwd)

  assert.deepEqual(
    board.list().map((job) => job.executionState),
    ["completed", "completed", "cancelled"]
  )
  assert.equal(composition.interrupts.length, 1)
  const queue = JSON.parse(
    fs.readFileSync(join(cwd, ".omagents", "loops", "hyperplan", "tasks.json"), "utf8")
  )
  assert.deepEqual(
    queue.tasks.slice(0, 2).map((task) => task.status),
    ["completed", "completed"]
  )
  assert.notEqual(
    queue.tasks[2].status,
    "completed",
    "a cancelled critic must not be reported as a completed review"
  )
  assert.equal(queue.tasks[2].attempts, 1)
})
