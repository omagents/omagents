#!/usr/bin/env node
/**
 * OmAgents venv setup hook (cross-platform).
 *
 * Creates ~/.venvs/omagents if missing, installs jinja2, and copies
 * skill helper scripts into the venv. Called by Codex SessionStart hooks
 * and OpenCode session.created.
 *
 * Outputs {} to stdout (Codex requires JSON), messages to stderr.
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { ensureBaseEnvironment } from "./python-env.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function log(msg) {
  process.stderr.write(`[omagents] ${msg}\n`)
}

async function run() {
  try {
    const result = await ensureBaseEnvironment({ logger: log })
    for (const requirement of result.installed) log(`Installed ${requirement}`)

    // Copy skill helper scripts into the venv
    const skillsDir = path.resolve(__dirname, "..", "skills")
    if (fs.existsSync(skillsDir)) {
      const destScripts = path.join(result.venvPath, "scripts")
      fs.mkdirSync(destScripts, { recursive: true })
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const srcScripts = path.join(skillsDir, entry.name, "scripts")
        if (fs.existsSync(srcScripts)) {
          for (const file of fs.readdirSync(srcScripts)) {
            fs.copyFileSync(path.join(srcScripts, file), path.join(destScripts, file))
          }
        }
      }
    }

    log(`venv ready at ${result.venvPath} (${result.status})`)
  } catch (err) {
    log(`venv setup failed: ${err.message}`)
  }
}

run().finally(() => {
  // Codex SessionStart hooks require JSON on stdout
  process.stdout.write("{}")
})
