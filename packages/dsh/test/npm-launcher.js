import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

export function resolveNpmCli(env = process.env) {
  if (typeof env.npm_execpath === "string" && env.npm_execpath.length > 0) {
    return env.npm_execpath
  }
  return require.resolve("npm/bin/npm-cli.js")
}

export function createNpmLauncher({ execute = execFileAsync, resolveCli = resolveNpmCli } = {}) {
  return async function runNpm(args, options = {}) {
    const env = options.env ?? process.env
    return execute(process.execPath, [resolveCli(env), ...args], {
      ...options,
      env,
      shell: false,
    })
  }
}

export const runNpm = createNpmLauncher()
