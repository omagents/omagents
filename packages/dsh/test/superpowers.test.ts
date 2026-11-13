import { test } from "node:test"
import assert from "node:assert/strict"

import { Context } from "@deepseek-ai/cordis"
import { agentEvents } from "@deepseek-ai/dsh-agent"
import { createUserMessage } from "@deepseek-ai/dsh-llm"
import { SESSION_FORMAT_VERSION, Session, SessionId } from "@deepseek-ai/dsh-session"
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

function realAgent(id, { subagent = false, parentId = "superpowers-parent" } = {}) {
  const sessionId = SessionId(id)
  const header = subagent
    ? {
        version: SESSION_FORMAT_VERSION,
        id: sessionId,
        createdAt: 1,
        isSeeded: false,
        parentSession: SessionId(parentId),
        origin: "subagent",
      }
    : undefined
  const session = Session.create(sessionId, [], header)
  return { id: session.id, session }
}

function messageText(message) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

/** A deterministic model/tool backend driven by the actual message, prompt, and catalog. */
function createDeterministicBackend(tools) {
  const calls = []
  const writes = []
  tools.register({
    name: "write",
    async execute(args) {
      writes.push(args)
      return { path: args.path, bytes: args.content.length }
    },
  })

  return {
    calls,
    writes,
    async complete({ user, prompt, catalogEntries, agent, signal }) {
      const text = messageText(user)
      const bootstrapVisible =
        prompt.includes("You have superpowers") &&
        prompt.includes("Tool Mapping for DeepSeek Harness") &&
        prompt.includes('"Let\'s build X"')
      let match
      if (bootstrapVisible && /(?:let's\s+(?:make|build)|\bcreate\b|\bimplement\b)/i.test(text)) {
        match = catalogEntries.find((entry) => /before any creative work/i.test(entry.description))
      } else if (
        bootstrapVisible &&
        /(?:\bbug\b|\bfix\b|test failure|unexpected behavior)/i.test(text)
      ) {
        match = catalogEntries.find((entry) =>
          /bug, test failure, or unexpected behavior/i.test(entry.description)
        )
      }

      const action = match
        ? { tool: "skill", args: { name: match.name } }
        : {
            tool: "write",
            args: {
              path: "src/App.tsx",
              content: `// Model input: ${text}\nexport default function App() { return null }\n`,
            },
          }
      calls.push(action)
      const result = await tools.definitions
        .get(action.tool)
        .execute(action.args, { agent, signal })
      return { action, result }
    },
  }
}

test("clean DSH composition routes the exact React request through real native tools before code", async (t) => {
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

  const agent = realAgent("superpowers-parent")
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

  const backend = createDeterministicBackend(tools)
  const acceptance = await backend.complete({
    user,
    prompt,
    catalogEntries: catalog.source.entries,
    agent,
    signal,
  })
  assert.equal(backend.calls.length, 1)
  assert.equal(backend.calls[0], acceptance.action)
  assert.equal(acceptance.action.tool, "skill")
  assert.equal(acceptance.action.args.name, "brainstorming")
  assert.equal(acceptance.result.name, "brainstorming")
  assert.match(acceptance.result.content, /HARD-GATE/)
  assert.match(acceptance.result.content, /Before taking any implementation action/)
  assert.equal(backend.writes.length, 0, "the actual backend wrote code before brainstorming")

  const debugging = await backend.complete({
    user: createUserMessage({
      content: [{ type: "text", text: "Fix this bug" }],
      source: { kind: "test", form: "message" },
    }),
    prompt,
    catalogEntries: catalog.source.entries,
    agent,
    signal,
  })
  assert.equal(debugging.action.tool, "skill")
  assert.equal(debugging.action.args.name, "systematic-debugging")
  assert.notEqual(debugging.action.args.name, "brainstorming")

  const withoutBootstrap = await backend.complete({
    user,
    prompt: "",
    catalogEntries: catalog.source.entries,
    agent,
    signal,
  })
  assert.equal(
    withoutBootstrap.action.tool,
    "write",
    "negative control must allow a non-skill route"
  )
  assert.equal(backend.writes.length, 1)
  assert.match(backend.writes[0].content, /Let's make a react todo list/)

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

  const child = realAgent("superpowers-child", { subagent: true })
  assert.equal(child.session.header.origin, "subagent")
  assert.equal(child.session.origin, undefined, "real DSH Session has no direct origin accessor")
  const childAssembly = await root.systemPrompt.assemble({ agent: child, scope: child })
  assert.doesNotMatch(renderPrompt(childAssembly), /You have superpowers/)
  const topLevelAssembly = await root.systemPrompt.assemble({ agent, scope: agent })
  assert.match(renderPrompt(topLevelAssembly), /You have superpowers/)
})
