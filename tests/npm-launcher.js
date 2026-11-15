import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const require = createRequire(import.meta.url)

function resolveNpmCli() {
  if (process.env.npm_execpath) return process.env.npm_execpath
  try {
    return require.resolve("npm/bin/npm-cli.js")
  } catch {
    const candidates = [
      path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
      path.join(
        path.dirname(process.execPath),
        "..",
        "lib",
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js"
      ),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    throw new Error(`Unable to locate npm CLI: ${candidates.join(", ")}`)
  }
}

export function runNpm(args, options = {}) {
  const cli = resolveNpmCli()
  return spawnSync(process.execPath, [cli, ...args], { shell: false, ...options })
}
