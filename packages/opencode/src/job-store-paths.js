import os from "node:os"
import path from "node:path"

function getStorageDirectory() {
  const dataDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  return path.join(dataDir, "opencode", "storage", "omagents")
}

export function getJobStorePath() {
  return path.join(getStorageDirectory(), "job-board.json")
}

export function getTuiStatePath() {
  return path.join(getStorageDirectory(), "tui-state.json")
}
