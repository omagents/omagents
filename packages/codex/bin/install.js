#!/usr/bin/env node
/**
 * OmAgents Codex installer.
 *
 * Run via: npx @omagents/omagents-codex
 */

import fs from "node:fs"
import { installCodex } from "../src/setup.js"

const USAGE = "Usage: npx @omagents/omagents-codex [options]"

function printHelp() {
  console.log(`${USAGE}

Install OmAgents for Codex without a positional host argument.

Options:
  --help     Show this help message
  --version  Show the package version`)
}

async function main(args) {
  if (args.length === 0) {
    await installCodex()
    return
  }

  if (args.length === 1 && args[0] === "--help") {
    printHelp()
    return
  }

  if (args.length === 1 && args[0] === "--version") {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    console.log(pkg.version)
    return
  }

  console.error(`[omagents] Unknown or unexpected arguments: ${args.join(" ")}`)
  console.error(USAGE)
  process.exitCode = 1
}

main(process.argv.slice(2)).catch((err) => {
  console.error("[omagents]", err.message)
  process.exitCode = 1
})
