import assert from "node:assert/strict"
import fs from "node:fs"
import { test } from "node:test"

import { PACK_MANIFEST } from "./pack-all.js"
import { CLEAN_ROOM_SUMMARY, ensureCleanRoom } from "./packed-harness.js"

const SOURCE = "packages/dsh/src/host/register-python.ts"
const LOCK = "package-lock.json"
const CACHE_SEAL = ".omagents/release-artifacts/offline-npm-cache/omagents-seed.json"

test("source and lockfile edits invalidate standalone clean-room reuse", async (t) => {
  const files = [SOURCE, LOCK, PACK_MANIFEST, CLEAN_ROOM_SUMMARY, CACHE_SEAL]
  const backups = new Map(
    files.map((file) => [file, fs.existsSync(file) ? fs.readFileSync(file) : undefined])
  )
  t.after(() => {
    for (const [file, contents] of backups) {
      if (contents === undefined) fs.rmSync(file, { force: true })
      else fs.writeFileSync(file, contents)
    }
  })

  const baseline = await ensureCleanRoom({ pack: true })
  const source = fs.readFileSync(SOURCE, "utf8")
  fs.writeFileSync(SOURCE, `${source}\n// Task 15 source-freshness regression.\n`)
  const sourceRebuild = await ensureCleanRoom()
  assert.equal(sourceRebuild.reused, false, "source edits must force repack/reinstall")
  assert.notEqual(sourceRebuild.cleanRoot, baseline.cleanRoot)
  assert.notEqual(sourceRebuild.packSha256, baseline.packSha256)

  fs.writeFileSync(SOURCE, source)
  const lock = fs.readFileSync(LOCK, "utf8")
  fs.writeFileSync(LOCK, `${lock}\n`)
  const lockRebuild = await ensureCleanRoom()
  assert.equal(lockRebuild.reused, false, "lockfile edits must force repack/reinstall")
  assert.notEqual(lockRebuild.cleanRoot, sourceRebuild.cleanRoot)

  fs.writeFileSync(LOCK, lock)
  const restored = await ensureCleanRoom()
  assert.equal(
    restored.reused,
    false,
    "restoring content must also refresh modified-state artifacts"
  )
  const unchanged = await ensureCleanRoom()
  assert.equal(unchanged.reused, true, "an unchanged current install must be reused")
})
