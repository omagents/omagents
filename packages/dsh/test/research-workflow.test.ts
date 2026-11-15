import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

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

async function runPython(script, args, cwd) {
  const child = spawn(PYTHON, [script, ...args], { cwd })
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
      return { childId: `research-child-${++nextChild}` }
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
  const result = {
    isError: false,
    value,
    content: [{ type: "text", text: `started subagent ${value.subagentId}` }],
  }
  const start = {
    runId: SubagentRunId(`run-${value.subagentId}`),
    provider: "spawn",
    id: SessionId(value.subagentId),
    local: true,
  }
  composition.root.emit(scopeTarget(composition.root.subagents, owner), "subagent/start", start)
  composition.root.emit(scopeTarget(composition.root.tools, owner), "tools/result", exec, result)
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
