import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { run } from "../scripts/pack-all.js"

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === "ESRCH") return false
    throw error
  }
}

test("timeout escalation reaps descendants even after the direct child exits", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-process-tree-"))
  const fixture = path.join(directory, "parent.mjs")
  const pidFile = path.join(directory, "child.pid")
  fs.writeFileSync(
    fixture,
    `import { spawn } from "node:child_process"\n` +
      `import fs from "node:fs"\n` +
      `const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" })\n` +
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))\n` +
      `process.on("SIGTERM", () => process.exit(0))\n` +
      `setInterval(() => {}, 1000)\n`
  )
  let childPid
  t.after(() => {
    if (childPid && alive(childPid)) process.kill(childPid, "SIGKILL")
    fs.rmSync(directory, { recursive: true, force: true })
  })

  let rejection
  try {
    await run(process.execPath, [fixture], { timeoutMs: 200 })
  } catch (error) {
    rejection = error
  }
  assert.match(rejection?.message ?? "", /timed out after 200ms/)
  childPid = Number(fs.readFileSync(pidFile, "utf8"))
  assert.ok(Number.isInteger(childPid) && childPid > 0)
  assert.equal(alive(childPid), false, `descendant ${childPid} survived the process-tree timeout`)
})
