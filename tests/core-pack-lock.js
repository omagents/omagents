import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"

const ROOT = path.resolve(import.meta.dirname, "..")
const lockName = createHash("sha256").update(ROOT).digest("hex").slice(0, 16)
const LOCK_DIR = path.join(os.tmpdir(), `omagents-core-pack-${lockName}.lock`)
const OWNER_FILE = path.join(LOCK_DIR, "owner")
const STALE_MS = 5 * 60 * 1000
const WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4))

function ownerIsAlive() {
  try {
    const pid = Number(fs.readFileSync(OWNER_FILE, "utf8"))
    if (!Number.isInteger(pid) || pid <= 0) return null
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === "ENOENT") return null
    if (error.code === "ESRCH") return false
    if (error.code === "EPERM") return true
    return null
  }
}

function removeAbandonedLock() {
  try {
    if (ownerIsAlive() === false) {
      fs.rmSync(LOCK_DIR, { recursive: true, force: true })
      return
    }
    if (Date.now() - fs.statSync(LOCK_DIR).mtimeMs > STALE_MS) {
      fs.rmSync(LOCK_DIR, { recursive: true, force: true })
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}

/** Serialize Core's temporary prepack/postpack asset materialization across test processes. */
export function withCorePackLock(callback) {
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR)
      fs.writeFileSync(OWNER_FILE, String(process.pid), "utf8")
      break
    } catch (error) {
      if (error.code !== "EEXIST") throw error
      removeAbandonedLock()
      Atomics.wait(WAIT_ARRAY, 0, 0, 20)
    }
  }

  try {
    return callback()
  } finally {
    try {
      if (Number(fs.readFileSync(OWNER_FILE, "utf8")) === process.pid) {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true })
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
}
