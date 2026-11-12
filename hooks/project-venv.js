#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"
import { ensureProjectEnvironment, runProjectPip, runProjectPython } from "./python-env.js"

const USAGE = "Usage: project-venv.js <ensure|python|pip|run> --root <dir> [-- <args...>]"

function parseArguments(argv) {
  const [command, ...rest] = argv
  if (!["ensure", "python", "pip", "run"].includes(command)) {
    throw new Error(USAGE)
  }

  const separator = rest.indexOf("--")
  const options = separator === -1 ? rest : rest.slice(0, separator)
  const args = separator === -1 ? [] : rest.slice(separator + 1)
  if (options.length !== 2 || options[0] !== "--root" || !options[1]) {
    throw new Error(`--root <dir> is required. ${USAGE}`)
  }
  if (["ensure", "python"].includes(command) && separator !== -1) {
    throw new Error(`${command} does not accept trailing arguments. ${USAGE}`)
  }
  if (["pip", "run"].includes(command) && (separator === -1 || args.length === 0)) {
    throw new Error(`${command} requires arguments after --. ${USAGE}`)
  }

  return { command, projectRoot: options[1], args }
}

export async function main(argv, dependencies = {}) {
  const stdout = dependencies.stdout || ((line) => process.stdout.write(`${line}\n`))
  const stderr = dependencies.stderr || ((line) => process.stderr.write(`${line}\n`))
  let parsed
  try {
    parsed = parseArguments(argv)
  } catch (error) {
    stderr(error.message)
    return 1
  }

  const logger = dependencies.logger || ((message) => stderr(message))
  const options = { projectRoot: parsed.projectRoot, logger }

  try {
    if (parsed.command === "ensure" || parsed.command === "python") {
      const ensure = dependencies.ensureProjectEnvironment || ensureProjectEnvironment
      const project = await ensure(options)
      stdout(
        parsed.command === "ensure" ? `${project.status} ${project.pythonPath}` : project.pythonPath
      )
      return 0
    }

    if (parsed.command === "pip") {
      const run = dependencies.runProjectPip || runProjectPip
      const result = await run({ ...options, args: parsed.args })
      return result.code
    }

    const run = dependencies.runProjectPython || runProjectPython
    const result = await run({ ...options, args: parsed.args })
    return result.code
  } catch (error) {
    stderr(error.message)
    return 1
  }
}

const isDirect =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirect) {
  process.exitCode = await main(process.argv.slice(2))
}
