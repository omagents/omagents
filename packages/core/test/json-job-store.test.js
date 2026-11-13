import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import { JsonJobStore } from "../src/index.js"

function createJob(overrides = {}) {
  return {
    id: "job-1",
    host: "host-a",
    hostTaskId: "host-task-1",
    parentSessionId: "parent-1",
    childName: "child-one",
    alias: "exp-1",
    agent: "explore",
    description: "Persist this job",
    executionState: "running",
    launchedAt: 1_000,
    updatedAt: 1_000,
    revision: 1,
    ...overrides,
  }
}

function createSnapshot(overrides = {}) {
  return {
    version: 1,
    revision: 1,
    jobs: [createJob()],
    ...overrides,
  }
}

async function createTempDirectory(t) {
  const directory = await fs.mkdtemp(join(tmpdir(), "omagents-job-store-"))
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })
  return directory
}

test("missing storage loads an empty versioned snapshot and round-trips nested portable paths", async (t) => {
  const directory = await createTempDirectory(t)
  const filePath = join(directory, "nested folder", "job board.json")
  const store = new JsonJobStore({ filePath, clock: () => 1_000 })

  assert.deepEqual(await store.load(), { version: 1, revision: 0, jobs: [] })

  const snapshot = createSnapshot({
    revision: 4,
    jobs: [
      createJob({
        executionState: "failed",
        notificationState: "pending",
        error: { code: "FAILED", message: "boom" },
        terminalAt: 4_000,
        updatedAt: 4_000,
        revision: 4,
      }),
    ],
  })
  await store.save(snapshot)
  await store.close()

  const reopened = new JsonJobStore({ filePath, clock: { now: () => 2_000 } })
  assert.deepEqual(await reopened.load(), snapshot)
  await reopened.close()
})

test("every save uses a same-directory temporary file and atomic replacement", async (t) => {
  const directory = await createTempDirectory(t)
  const filePath = join(directory, "jobs.json")
  const store = new JsonJobStore({ filePath, clock: () => 1_000 })
  const originalRename = fs.rename
  const replacements = []

  t.mock.method(fs, "rename", async (from, to) => {
    let previous
    try {
      previous = JSON.parse(await fs.readFile(to, "utf8"))
    } catch (error) {
      assert.equal(error.code, "ENOENT")
    }
    replacements.push({
      from,
      to,
      previous,
      replacement: JSON.parse(await fs.readFile(from, "utf8")),
    })
    return originalRename(from, to)
  })

  await store.save(createSnapshot())
  await store.save(
    createSnapshot({ revision: 2, jobs: [createJob({ updatedAt: 2_000, revision: 2 })] })
  )
  await store.close()

  assert.equal(replacements.length, 2)
  for (const replacement of replacements) {
    assert.equal(dirname(replacement.from), dirname(filePath))
    assert.equal(replacement.to, filePath)
    assert.notEqual(replacement.from, filePath)
  }
  assert.equal(replacements[0].previous, undefined)
  assert.equal(replacements[1].previous.revision, 1)
  assert.equal(replacements[1].replacement.revision, 2)
  assert.deepEqual(
    (await fs.readdir(directory)).filter((name) => name.endsWith(".tmp")),
    []
  )
})

test("concurrent saves are serialized in invocation order without overlapping writes", async (t) => {
  const directory = await createTempDirectory(t)
  const filePath = join(directory, "jobs.json")
  const store = new JsonJobStore({ filePath, clock: () => 1_000 })
  const originalWriteFile = fs.writeFile
  const revisions = []
  let activeWrites = 0
  let maximumActiveWrites = 0

  t.mock.method(fs, "writeFile", async (path, data, ...rest) => {
    activeWrites += 1
    maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites)
    await new Promise((resolve) => setImmediate(resolve))
    try {
      revisions.push(JSON.parse(String(data)).revision)
      return await originalWriteFile(path, data, ...rest)
    } finally {
      activeWrites -= 1
    }
  })

  const saves = []
  for (let revision = 1; revision <= 25; revision += 1) {
    saves.push(
      store.save(
        createSnapshot({
          revision,
          jobs: [createJob({ updatedAt: revision * 1_000, revision })],
        })
      )
    )
  }
  await Promise.all(saves)
  await store.close()

  assert.equal(maximumActiveWrites, 1)
  assert.deepEqual(
    revisions,
    Array.from({ length: 25 }, (_, index) => index + 1)
  )
  assert.equal(JSON.parse(await fs.readFile(filePath, "utf8")).revision, 25)
  assert.deepEqual(
    (await fs.readdir(directory)).filter((name) => name.endsWith(".tmp")),
    []
  )
})

test("invalid outbound snapshots reject without replacing the last valid file", async (t) => {
  const directory = await createTempDirectory(t)
  const filePath = join(directory, "jobs.json")
  const store = new JsonJobStore({ filePath, clock: () => 1_000 })
  await store.save(createSnapshot())

  await assert.rejects(
    store.save(createSnapshot({ jobs: [createJob({ executionState: "done" })] })),
    /executionState/
  )
  await assert.rejects(store.save({ version: 2, revision: 2, jobs: [] }), /version/)
  await store.close()

  assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), createSnapshot())
})

test("corrupt JSON and malformed schemas are preserved with visible diagnostics", async (t) => {
  const cases = [
    ["invalid JSON", '{"version":1,"revision":'],
    ["malformed job record", JSON.stringify({ version: 1, revision: 1, jobs: [{}] })],
    ["unsupported schema version", JSON.stringify({ version: 99, revision: 0, jobs: [] })],
  ]

  for (const [name, contents] of cases) {
    await t.test(name, async (t) => {
      const directory = await createTempDirectory(t)
      const filePath = join(directory, "jobs.json")
      const backupPath = `${filePath}.corrupt-1700000000000`
      await fs.writeFile(filePath, contents, "utf8")
      const warnings = []
      t.mock.method(console, "warn", (message) => warnings.push(String(message)))
      const store = new JsonJobStore({ filePath, clock: () => 1_700_000_000_000 })

      assert.deepEqual(await store.load(), { version: 1, revision: 0, jobs: [] })
      assert.equal(await fs.readFile(backupPath, "utf8"), contents)
      await assert.rejects(fs.access(filePath), { code: "ENOENT" })
      assert.equal(store.diagnostics.length, 1)
      assert.equal(store.diagnostics[0].code, "ERR_JOB_STORE_CORRUPT")
      assert.equal(store.diagnostics[0].backupPath, backupPath)
      assert.match(store.diagnostics[0].message, /job store/i)
      assert.equal(warnings.length, 1)
      assert.match(warnings[0], /corrupt/i)
      assert.match(warnings[0], /jobs\.json\.corrupt-1700000000000/)

      await store.save({ version: 1, revision: 0, jobs: [] })
      await store.close()
      assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), {
        version: 1,
        revision: 0,
        jobs: [],
      })
    })
  }
})

test("corrupt backup timestamps and directories are cross-platform-safe", async (t) => {
  const directory = await createTempDirectory(t)
  const filePath = join(directory, "profile with spaces", "jobs.json")
  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, "not json", "utf8")
  t.mock.method(console, "warn", () => {})
  const store = new JsonJobStore({
    filePath,
    clock: () => "2026-11-13T10:20:30.000Z",
  })

  await store.load()
  const backupName = basename(store.diagnostics[0].backupPath)
  assert.match(backupName, /^jobs\.json\.corrupt-2026-11-13T10-20-30-000Z$/)
  assert.doesNotMatch(backupName, /[<>:"/\\|?*]/)
  assert.equal(dirname(store.diagnostics[0].backupPath), dirname(filePath))
  await store.close()
})

test("close drains every queued write and rejects later saves", async (t) => {
  const directory = await createTempDirectory(t)
  const filePath = join(directory, "jobs.json")
  const store = new JsonJobStore({ filePath, clock: () => 1_000 })

  const pendingSave = store.save(createSnapshot())
  await store.close()
  await pendingSave
  await store.flush()
  await store.close()

  assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), createSnapshot())
  await assert.rejects(store.save(createSnapshot({ revision: 2 })), /closed/i)
})
