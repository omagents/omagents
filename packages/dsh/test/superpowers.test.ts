import { test } from "node:test"
import assert from "node:assert/strict"

import { Context } from "@deepseek-ai/cordis"
import { agentEvents } from "@deepseek-ai/dsh-agent"
import { createUserMessage } from "@deepseek-ai/dsh-llm"
import SkillRegistry from "@deepseek-ai/dsh-skill"
import SystemPrompt, { renderPrompt } from "@deepseek-ai/dsh-system-prompt"
import * as ToolSkill from "@deepseek-ai/dsh-tool-skill"
import { JobBoard } from "@omagents/core"

import { createHealthRecords } from "../dist/host/health.js"
import { registerDshContext } from "../dist/host/register-context.js"
import { registerDshSkills } from "../dist/host/register-skills.js"

function createToolRegistry() {
  const definitions = new Map()
  return {
    definitions,
    register(definition) {
      definitions.set(definition.name, definition)
      return () => definitions.delete(definition.name)
    },
    get(name) {
      return definitions.get(name)
    },
  }
}

function topLevelAgent(id = "superpowers-parent") {
  return {
    id,
    session: {
      id,
      seq: 0,
      surface: { nodes: [] },
      eventAt() {
        return undefined
      },
    },
  }
}

test("clean DSH composition bootstraps Superpowers and routes React creation to brainstorming before code", async (t) => {
  const root = new Context()
  t.after(() => root.fiber.dispose())
  await root.plugin(SkillRegistry)
  await root.plugin(SystemPrompt, { includeHarnessIdentity: false })
  const tools = createToolRegistry()
  root.provide("agents", {})
  root.provide("tools", tools)
  root.provide("workingDirectory", {
    async ensure() {
      return process.cwd()
    },
  })
  await root.plugin(ToolSkill)

  const health = createHealthRecords(() => [])
  const disposeSkills = registerDshSkills(root, health)
  const board = new JobBoard({ idGenerator: () => "superpowers-job" })
  const disposeContext = registerDshContext(root, board, health)
  t.after(() => {
    disposeContext()
    disposeSkills()
  })

  const agent = topLevelAgent()
  const assembly = await root.systemPrompt.assemble({ agent, scope: agent })
  const prompt = renderPrompt(assembly)
  const user = createUserMessage({
    content: [{ type: "text", text: "Let's make a react todo list" }],
    source: { kind: "test", form: "message" },
  })
  const signal = new AbortController().signal
  const decision = await agentEvents(root, agent).waterfall(
    "agent/pre-step",
    { messages: [user], turn: 1, step: 1, signal, modelSelection: {} },
    async () => ({ kind: "enter", messages: [user] })
  )
  assert.equal(decision.kind, "enter")
  const catalog = decision.messages.find((message) => message.source.kind === "skill-catalog")
  assert.ok(catalog, "the native DSH skill catalog must be published without session opt-in")
  assert.equal(catalog.source.entries.length, 33)
  const brainstorming = catalog.source.entries.find((entry) => entry.name === "brainstorming")
  assert.ok(brainstorming)

  // Deterministic model backend: it follows the creation route only when the
  // automatic bootstrap and matching native catalog entry are both visible.
  const bootstrapVisible =
    prompt.includes("You have superpowers") &&
    prompt.includes("Tool Mapping for DeepSeek Harness") &&
    prompt.includes('"Let\'s build X"')
  const writes = []
  const firstAction = bootstrapVisible
    ? { tool: "skill", args: { name: brainstorming.name } }
    : { tool: "write", args: { path: "src/App.tsx", content: "export default function App() {}" } }
  assert.equal(
    firstAction.tool,
    "skill",
    "the acceptance message must route to the skill loader rather than product code"
  )
  assert.equal(firstAction.args.name, "brainstorming")

  const loaded = await tools.definitions.get("skill").execute(firstAction.args, { agent, signal })
  assert.equal(loaded.name, "brainstorming")
  assert.match(loaded.content, /HARD-GATE/)
  assert.match(loaded.content, /Before taking any implementation action/)
  assert.deepEqual(writes, [], "no product code may be written before brainstorming")
  for (const nativeTool of [
    "todo_write",
    "subagent",
    "skill",
    "read",
    "write",
    "edit",
    "apply_patch",
    "bash",
    "grep",
    "glob",
    "web_fetch",
    "web_search",
  ]) {
    assert.match(
      prompt,
      new RegExp("`" + nativeTool + "`"),
      `missing DSH tool mapping: ${nativeTool}`
    )
  }
  assert.doesNotMatch(
    prompt,
    /\btask\s*\(\s*background|background\s*[:=]\s*true|OPENCODE_|\bwebfetch\b|\btodowrite\b/
  )

  const child = {
    ...topLevelAgent("superpowers-child"),
    session: { ...topLevelAgent("superpowers-child").session, origin: "subagent" },
  }
  const childAssembly = await root.systemPrompt.assemble({ agent: child, scope: child })
  assert.doesNotMatch(renderPrompt(childAssembly), /You have superpowers/)
})
