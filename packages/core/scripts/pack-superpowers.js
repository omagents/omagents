import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const coreRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)))
const nodeModules = path.join(coreRoot, "node_modules")
const target = path.join(nodeModules, "superpowers")
const marker = path.join(nodeModules, ".omagents-superpowers-pack-materialized")

function removeMaterializedCopy() {
  if (!fs.existsSync(marker)) return false
  fs.rmSync(target, { recursive: true, force: true })
  fs.rmSync(marker, { force: true })
  return true
}

if (process.argv.includes("--cleanup")) {
  removeMaterializedCopy()
} else {
  // Recover deterministically from an interrupted earlier pack. A pre-existing
  // unmarked nested installation is a real dependency and is never removed.
  removeMaterializedCopy()
  if (!fs.existsSync(target)) {
    const source = path.dirname(require.resolve("superpowers/package.json"))
    fs.mkdirSync(nodeModules, { recursive: true })
    try {
      fs.cpSync(source, target, {
        recursive: true,
        filter: (entry) => {
          const name = path.basename(entry)
          return name !== ".git" && name !== ".DS_Store" && name !== "__pycache__"
        },
      })
      fs.writeFileSync(marker, "materialized by packages/core prepack\n", "utf8")
    } catch (error) {
      fs.rmSync(target, { recursive: true, force: true })
      fs.rmSync(marker, { force: true })
      throw error
    }
  }
}
