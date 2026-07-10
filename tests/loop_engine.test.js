import { test } from "node:test"
import assert from "node:assert"
import { execSync } from "child_process"
import fs from "fs"
import path from "path"

const ROOT = path.resolve(import.meta.dirname, "..")
const ENGINE = `python3 ${path.join(ROOT, "skills", "_shared", "scripts", "loop_engine.py")}`
const SKILL = "test-unit"
const LOOP_PATH = path.join(ROOT, ".omagents", "loops", SKILL, "tasks.json")

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8" }).trim()
}

function loadState() {
  return JSON.parse(fs.readFileSync(LOOP_PATH, "utf-8"))
}

test("init creates task queue with correct stats", () => {
  run(`${ENGINE} init ${SKILL} '[{"description":"task A"},{"description":"task B"}]'`)
  const state = loadState()
  assert.strictEqual(state.tasks.length, 2)
  assert.strictEqual(state.stats.total, 2)
  assert.strictEqual(state.stats.pending, 2)
  assert.strictEqual(state.stats.completed, 0)
})

test("next returns first pending task", () => {
  const out = run(`${ENGINE} next ${SKILL}`)
  const task = JSON.parse(out)
  assert.strictEqual(task.id, 1)
  assert.strictEqual(task.status, "pending")
  assert.strictEqual(task.description, "task A")
})

test("complete marks task done and updates stats", () => {
  run(`${ENGINE} complete ${SKILL} 1 "found 3 issues"`)
  const state = loadState()
  assert.strictEqual(state.tasks[0].status, "completed")
  assert.strictEqual(state.tasks[0].result, "found 3 issues")
  assert.strictEqual(state.stats.completed, 1)
  assert.strictEqual(state.stats.pending, 1)
})

test("next skips completed tasks", () => {
  const out = run(`${ENGINE} next ${SKILL}`)
  const task = JSON.parse(out)
  assert.strictEqual(task.id, 2)
  assert.strictEqual(task.description, "task B")
})

test("next returns null when all done", () => {
  run(`${ENGINE} complete ${SKILL} 2 "clean"`)
  const out = run(`${ENGINE} next ${SKILL}`)
  assert.strictEqual(out, "null")
})

test("fail retries 3 times then blocks", () => {
  run(`${ENGINE} init ${SKILL} '[{"description":"failing task"}]'`)

  run(`${ENGINE} fail ${SKILL} 1 "error 1"`)
  let state = loadState()
  assert.strictEqual(state.tasks[0].status, "pending")
  assert.strictEqual(state.tasks[0].attempts, 1)

  run(`${ENGINE} fail ${SKILL} 1 "error 2"`)
  state = loadState()
  assert.strictEqual(state.tasks[0].status, "pending")
  assert.strictEqual(state.tasks[0].attempts, 2)

  run(`${ENGINE} fail ${SKILL} 1 "error 3"`)
  state = loadState()
  assert.strictEqual(state.tasks[0].status, "blocked")
  assert.strictEqual(state.tasks[0].attempts, 3)
  assert.strictEqual(state.stats.blocked, 1)
  assert.strictEqual(state.stats.pending, 0)
})

test("add appends new task with auto-incremented id", () => {
  run(`${ENGINE} init ${SKILL} '[{"description":"original"}]'`)
  run(`${ENGINE} complete ${SKILL} 1 "done"`)
  run(`${ENGINE} add ${SKILL} '{"description":"new task"}'`)
  const state = loadState()
  assert.strictEqual(state.tasks.length, 2)
  assert.strictEqual(state.tasks[1].id, 2)
  assert.strictEqual(state.tasks[1].status, "pending")
  assert.strictEqual(state.stats.total, 2)
  assert.strictEqual(state.stats.pending, 1)
})

test("status prints correct stats", () => {
  run(`${ENGINE} init ${SKILL} '[{"description":"a"},{"description":"b"},{"description":"c"}]'`)
  run(`${ENGINE} complete ${SKILL} 1 "done"`)
  const out = run(`${ENGINE} status ${SKILL}`)
  assert.ok(out.includes("Total: 3"))
  assert.ok(out.includes("Completed: 1"))
  assert.ok(out.includes("Pending: 2"))
})

test("summary shows icons and results", () => {
  const out = run(`${ENGINE} summary ${SKILL}`)
  assert.ok(out.includes("[x]"))
  assert.ok(out.includes("[ ]"))
})

test("reset clears the queue", () => {
  run(`${ENGINE} reset ${SKILL}`)
  assert.ok(!fs.existsSync(LOOP_PATH))
})

test("next on non-existent skill returns error", () => {
  const out = run(`${ENGINE} next non-existent-skill 2>&1 || true`)
  assert.ok(out.includes("error") || out.includes("No loop found"))
})
