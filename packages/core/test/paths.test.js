import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { getCorePaths } from "../src/paths.js"
import { withCorePackLock } from "../../../tests/core-pack-lock.js"

const REPOSITORY_CORE = path.resolve(import.meta.dirname, "..")

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-core-paths-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return fs.realpathSync(root)
}

function writeSuperpowers(directory) {
  fs.mkdirSync(path.join(directory, "skills", "brainstorming"), { recursive: true })
  fs.writeFileSync(
    path.join(directory, "package.json"),
    `${JSON.stringify({ name: "superpowers", version: "0.0.0" }, null, 2)}\n`
  )
  fs.writeFileSync(path.join(directory, "skills", "brainstorming", "SKILL.md"), "# Brainstorming\n")
}

async function importFixturePaths(coreRoot) {
  const source = path.join(coreRoot, "src", "paths.js")
  fs.mkdirSync(path.dirname(source), { recursive: true })
  fs.copyFileSync(path.join(REPOSITORY_CORE, "src", "paths.js"), source)
  return import(pathToFileURL(source).href)
}

test("hoisted Superpowers resolution survives pack materialization and cleanup", () => {
  withCorePackLock(() => {
    const script = path.join(REPOSITORY_CORE, "scripts", "pack-superpowers.js")
    const cleanup = () =>
      spawnSync(process.execPath, [script, "--cleanup"], {
        cwd: REPOSITORY_CORE,
        encoding: "utf8",
      })
    assert.equal(cleanup().status, 0)

    const hoisted = path.join(REPOSITORY_CORE, "..", "..", "node_modules", "superpowers")
    const nested = path.join(REPOSITORY_CORE, "node_modules", "superpowers")
    let duringPack
    try {
      const materialized = spawnSync(process.execPath, [script], {
        cwd: REPOSITORY_CORE,
        encoding: "utf8",
      })
      assert.equal(materialized.status, 0, materialized.stderr)
      assert.ok(fs.existsSync(path.join(nested, "package.json")))
      duringPack = getCorePaths().superpowersDir
    } finally {
      assert.equal(cleanup().status, 0)
    }

    assert.deepEqual(
      {
        duringPack,
        capturedPathExistsAfterCleanup: fs.existsSync(duringPack),
        freshAfterCleanup: getCorePaths().superpowersDir,
      },
      {
        duringPack: hoisted,
        capturedPathExistsAfterCleanup: true,
        freshAfterCleanup: hoisted,
      }
    )
  })
})

test("an installed app's hoisted Superpowers is preferred over Core's nested bundle", async (t) => {
  const fixture = makeFixture(t)
  const coreRoot = path.join(fixture, "node_modules", "@omagents", "core")
  const hoisted = path.join(fixture, "node_modules", "superpowers")
  writeSuperpowers(hoisted)
  writeSuperpowers(path.join(coreRoot, "node_modules", "superpowers"))
  const { getCorePaths: getFixturePaths } = await importFixturePaths(coreRoot)

  assert.equal(getFixturePaths().superpowersDir, hoisted)
})

test("a nested-only bundled Superpowers dependency remains available", async (t) => {
  const fixture = makeFixture(t)
  const coreRoot = path.join(fixture, "node_modules", "@omagents", "core")
  const nested = path.join(coreRoot, "node_modules", "superpowers")
  writeSuperpowers(nested)
  const { getCorePaths: getFixturePaths } = await importFixturePaths(coreRoot)

  assert.equal(getFixturePaths().superpowersDir, nested)
})

test("an actually absent optional Superpowers dependency remains null", async (t) => {
  const fixture = makeFixture(t)
  const coreRoot = path.join(fixture, "node_modules", "@omagents", "core")
  const { getCorePaths: getFixturePaths } = await importFixturePaths(coreRoot)

  assert.equal(getFixturePaths().superpowersDir, null)
})
