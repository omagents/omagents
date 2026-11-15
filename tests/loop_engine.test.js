import { test } from "node:test"
import assert from "node:assert"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { resolvePythonCommand } from "../scripts/python-command.js"

const ROOT = path.resolve(import.meta.dirname, "..")
const ENGINE = path.join(ROOT, "packages", "core", "skills", "_shared", "scripts", "loop_engine.py")
const SKILL = "test-unit"
const LOOP_PATH = path.join(ROOT, ".omagents", "loops", SKILL, "tasks.json")

function run(args, expectedStatus = 0, environment = {}) {
  const result = spawnSync(resolvePythonCommand(), [ENGINE, ...args], {
    cwd: ROOT,
    encoding: "utf-8",
    env: { ...process.env, ...environment },
  })
  assert.strictEqual(
    result.status,
    expectedStatus,
    `Loop engine failed (${result.status}): ${result.stdout}\n${result.stderr}\n${result.error?.message || ""}`
  )
  return result.stdout.trim()
}

function loadState() {
  return JSON.parse(fs.readFileSync(LOOP_PATH, "utf-8"))
}

test("init creates task queue with correct stats", () => {
  run(["init", SKILL, JSON.stringify([{ description: "task A" }, { description: "task B" }])])
  const state = loadState()
  assert.strictEqual(state.tasks.length, 2)
  assert.strictEqual(state.stats.total, 2)
  assert.strictEqual(state.stats.pending, 2)
  assert.strictEqual(state.stats.completed, 0)
})

test("next returns first pending task", () => {
  const out = run(["next", SKILL])
  const task = JSON.parse(out)
  assert.strictEqual(task.id, 1)
  assert.strictEqual(task.status, "pending")
  assert.strictEqual(task.description, "task A")
})

test("complete marks task done and updates stats", () => {
  run(["complete", SKILL, "1", "found 3 issues"])
  const state = loadState()
  assert.strictEqual(state.tasks[0].status, "completed")
  assert.strictEqual(state.tasks[0].result, "found 3 issues")
  assert.strictEqual(state.stats.completed, 1)
  assert.strictEqual(state.stats.pending, 1)
})

test("next skips completed tasks", () => {
  const out = run(["next", SKILL])
  const task = JSON.parse(out)
  assert.strictEqual(task.id, 2)
  assert.strictEqual(task.description, "task B")
})

test("next returns null when all done", () => {
  run(["complete", SKILL, "2", "clean"])
  const out = run(["next", SKILL])
  assert.strictEqual(out, "null")
})

test("fail retries 3 times then blocks", () => {
  run(["init", SKILL, JSON.stringify([{ description: "failing task" }])])

  run(["fail", SKILL, "1", "error 1"])
  let state = loadState()
  assert.strictEqual(state.tasks[0].status, "pending")
  assert.strictEqual(state.tasks[0].attempts, 1)

  run(["fail", SKILL, "1", "error 2"])
  state = loadState()
  assert.strictEqual(state.tasks[0].status, "pending")
  assert.strictEqual(state.tasks[0].attempts, 2)

  run(["fail", SKILL, "1", "error 3"])
  state = loadState()
  assert.strictEqual(state.tasks[0].status, "blocked")
  assert.strictEqual(state.tasks[0].attempts, 3)
  assert.strictEqual(state.stats.blocked, 1)
  assert.strictEqual(state.stats.pending, 0)
})

test("add appends new task with auto-incremented id", () => {
  run(["init", SKILL, JSON.stringify([{ description: "original" }])])
  run(["complete", SKILL, "1", "done"])
  run(["add", SKILL, JSON.stringify({ description: "new task" })])
  const state = loadState()
  assert.strictEqual(state.tasks.length, 2)
  assert.strictEqual(state.tasks[1].id, 2)
  assert.strictEqual(state.tasks[1].status, "pending")
  assert.strictEqual(state.stats.total, 2)
  assert.strictEqual(state.stats.pending, 1)
})

test("status prints correct stats", () => {
  run([
    "init",
    SKILL,
    JSON.stringify([{ description: "a" }, { description: "b" }, { description: "c" }]),
  ])
  run(["complete", SKILL, "1", "done"])
  const out = run(["status", SKILL])
  assert.ok(out.includes("Total: 3"))
  assert.ok(out.includes("Completed: 1"))
  assert.ok(out.includes("Pending: 2"))
})

test("summary shows icons and results", () => {
  const out = run(["summary", SKILL])
  assert.ok(out.includes("[x]"))
  assert.ok(out.includes("[ ]"))
})

test("next emits Unicode tasks with a legacy console encoding", () => {
  run(["init", SKILL, JSON.stringify([{ description: "研究 task" }])])
  const out = run(["next", SKILL], 0, { PYTHONIOENCODING: "cp1252" })
  assert.strictEqual(JSON.parse(out).description, "研究 task")
})

test("reset clears the queue", () => {
  run(["reset", SKILL])
  assert.ok(!fs.existsSync(LOOP_PATH))
})

test("next on non-existent skill returns error", () => {
  const out = run(["next", "non-existent-skill"], 1)
  assert.ok(out.includes("error") || out.includes("No loop found"))
})
