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
import os from "os"
import { execSync } from "child_process"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const IS_WIN = process.platform === "win32"
const VENV_BIN = IS_WIN ? "Scripts" : "bin"
const PYTHON_CMD = IS_WIN ? "python" : "python3"

const AGENT_VENV = path.join(os.homedir(), ".venvs", "omagents")
const AGENT_PYTHON = path.join(AGENT_VENV, VENV_BIN, IS_WIN ? "python.exe" : "python")
const AGENT_PIP = path.join(AGENT_VENV, VENV_BIN, IS_WIN ? "pip.exe" : "pip")

function log(msg) {
  process.stderr.write(`[omagents] ${msg}\n`)
}

try {
  // Check Python availability
  try {
    execSync(`${PYTHON_CMD} --version`, { stdio: "pipe" })
  } catch {
    log("Python 3 is not installed. Please install Python 3.11+.")
    process.exit(1)
  }

  // Create venv if missing
  if (!fs.existsSync(AGENT_PYTHON)) {
    log(`Creating agent venv at ${AGENT_VENV}`)
    execSync(`${PYTHON_CMD} -m venv "${AGENT_VENV}"`, { stdio: "pipe" })
  }

  // Install jinja2
  try {
    execSync(`"${AGENT_PIP}" install -q jinja2`, { stdio: "pipe" })
  } catch {
    // non-fatal
  }

  // Copy skill helper scripts into the venv
  const skillsDir = path.resolve(__dirname, "..", "skills")
  if (fs.existsSync(skillsDir)) {
    const destScripts = path.join(AGENT_VENV, "scripts")
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

  log(`venv ready at ${AGENT_VENV}`)
} catch (err) {
  log(`venv setup failed: ${err.message}`)
}

// Codex SessionStart hooks require JSON on stdout
process.stdout.write("{}")
