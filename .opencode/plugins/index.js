/**
 * OmAgents plugin for OpenCode.ai
 *
 * Auto-registers bundled skills, MCP servers, parallel execution, and
 * superpowers (imported as a dependency) so users can install with a
 * single line in opencode.json.
 */

import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import os from "os"
import { createParallelHooks } from "./parallel.js"
import baseMcps from "../../mcp-servers/base.json" with { type: "json" }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OMAGENTS_DIR = path.resolve(__dirname, "../..")
const SKILLS_DIR = path.join(OMAGENTS_DIR, "skills")

// Dedicated venv for tools bundled by OmAgents
const AGENT_VENV = path.join(os.homedir(), ".venvs", "omagents")
const AGENT_PYTHON = path.join(AGENT_VENV, "bin", "python")
const AGENT_PIP = path.join(AGENT_VENV, "bin", "pip")

// Directories containing skill helper scripts to expose on PATH
const SKILL_SCRIPT_DIRS = [
  path.join(OMAGENTS_DIR, "skills", "deep-research", "scripts"),
  path.join(OMAGENTS_DIR, "skills", "markitdown-converter", "scripts"),
  path.join(OMAGENTS_DIR, "skills", "playwright-web-scraping", "scripts"),
  path.join(OMAGENTS_DIR, "skills", "_shared", "scripts"),
]

// Built-in MCP servers bundled by this plugin
const BUILTIN_MCPS = {}
for (const [name, def] of Object.entries(baseMcps)) {
  BUILTIN_MCPS[name] = { ...def, enabled: true }
}

// GitHub code search: use the full GitHub Copilot MCP when a token is
// available; otherwise fall back to Vercel's public Grep.app MCP.
if (process.env.GITHUB_TOKEN) {
  BUILTIN_MCPS.github = {
    type: "remote",
    url: "https://api.githubcopilot.com/mcp/",
    enabled: true,
    oauth: false,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
  }
} else {
  BUILTIN_MCPS.grep_app = {
    type: "remote",
    url: "https://mcp.grep.app",
    enabled: true,
    oauth: false,
  }
}

// Python packages required by bundled skills
const REQUIRED_PYTHON_PACKAGES = ["jinja2"]

function warnIfDebug(...args) {
  if (process.env.OMAGENTS_DEBUG === "1") {
    console.warn(...args)
  }
}

/**
 * Ensure the dedicated agent venv exists and has the required Python packages.
 * If Python 3 is not found, logs a clear warning with install instructions.
 */
async function ensurePythonDependencies({ $ }) {
  try {
    const pythonCheck = await $`python3 --version`.nothrow().quiet()
    if (pythonCheck.exitCode !== 0) {
      warnIfDebug(
        "[omagents] Python 3 is not installed or not on PATH.\n" +
          "  OmAgents requires Python 3.11+ for the following features:\n" +
          "    - Deep Research (Jinja2 report templates)\n" +
          "    - MarkItDown converter\n" +
          "    - Playwright web scraping\n" +
          "    - Loop engine (remove-ai-slops, remove-deadcode, github-triage, tech-debt-audit)\n" +
          "  Install Python: https://www.python.org/downloads/\n" +
          "  After installing, restart OpenCode."
      )
      return
    }

    const venvExists = fs.existsSync(AGENT_PYTHON)
    if (!venvExists) {
      await $`python3 -m venv "${AGENT_VENV}"`.quiet()
    }

    for (const pkg of REQUIRED_PYTHON_PACKAGES) {
      const checkResult = await $`"${AGENT_PYTHON}" -c "import ${pkg}"`.nothrow().quiet()
      if (checkResult.exitCode === 0) {
        continue
      }
      try {
        await $`"${AGENT_PIP}" install "${pkg}"`.quiet()
      } catch (installError) {
        warnIfDebug(`[omagents] Could not install ${pkg}:`, installError.message)
      }
    }
  } catch (error) {
    warnIfDebug("[omagents] Python dependency check failed:", error.message)
  }
}

// ─── Load Superpowers (graceful degradation if unavailable) ──────────────────

let _superpowersPlugin = null

async function loadSuperpowers() {
  if (_superpowersPlugin !== null) return _superpowersPlugin
  try {
    const mod = await import("superpowers")
    _superpowersPlugin = mod.default || mod.SuperpowersPlugin || null
    if (!_superpowersPlugin) {
      warnIfDebug("[omagents] superpowers module found but no plugin export")
    }
  } catch {
    _superpowersPlugin = false // mark as tried-and-failed (distinct from null=not-tried)
    warnIfDebug(
      "[omagents] superpowers not available, skipping (install with: bun add superpowers)"
    )
  }
  return _superpowersPlugin || null
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export const OmagentsPlugin = async (ctx) => {
  const { $ } = ctx

  // Load superpowers and run its plugin function to get its hooks
  let superHooks = {}
  const sp = await loadSuperpowers()
  if (sp) {
    try {
      superHooks = (await sp(ctx)) || {}
    } catch (err) {
      warnIfDebug("[omagents] superpowers plugin failed to initialize:", err.message)
    }
  }

  // Get parallel execution hooks
  const parallelHooks = createParallelHooks(ctx)

  // OmAgents config: register skills + MCPs
  const omagentsConfig = async (config) => {
    config.skills = config.skills || {}
    config.skills.paths = config.skills.paths || []
    if (!config.skills.paths.includes(SKILLS_DIR)) {
      config.skills.paths.push(SKILLS_DIR)
    }

    config.mcp = config.mcp || {}
    for (const [name, mcpConfig] of Object.entries(BUILTIN_MCPS)) {
      if (!config.mcp[name]) {
        config.mcp[name] = mcpConfig
      }
    }
  }

  // Merged config: superpowers first (register skills), then omagents, then parallel
  const mergedConfig = async (config) => {
    if (superHooks.config) await superHooks.config(config)
    await omagentsConfig(config)
    if (parallelHooks.config) await parallelHooks.config(config)
  }

  // Merged messages.transform: superpowers bootstrap first, then Job Board
  const mergedMessagesTransform = async (input, output) => {
    if (superHooks["experimental.chat.messages.transform"]) {
      await superHooks["experimental.chat.messages.transform"](input, output)
    }
    if (parallelHooks["experimental.chat.messages.transform"]) {
      await parallelHooks["experimental.chat.messages.transform"](input, output)
    }
  }

  // Merged event: superpowers events first (if any), then parallel events
  const mergedEvent = async (input) => {
    if (superHooks.event) {
      await superHooks.event(input)
    }
    if (parallelHooks.event) {
      await parallelHooks.event(input)
    }
  }

  // Merged tool.execute.before
  const mergedToolBefore = async (input, output) => {
    if (superHooks["tool.execute.before"]) {
      await superHooks["tool.execute.before"](input, output)
    }
    if (parallelHooks["tool.execute.before"]) {
      await parallelHooks["tool.execute.before"](input, output)
    }
  }

  // Merged tool.execute.after
  const mergedToolAfter = async (input, output) => {
    if (superHooks["tool.execute.after"]) {
      await superHooks["tool.execute.after"](input, output)
    }
    if (parallelHooks["tool.execute.after"]) {
      await parallelHooks["tool.execute.after"](input, output)
    }
  }

  // Merge custom tools (superpowers tools + omagents tools)
  const mergedTools = {
    ...(superHooks.tool || {}),
    ...(parallelHooks.tool || {}),
  }

  return {
    config: mergedConfig,

    "session.created": async () => {
      if (superHooks["session.created"]) await superHooks["session.created"]()
      if ($) await ensurePythonDependencies({ $ })
    },

    "shell.env": async (input, output) => {
      // Run superpowers shell.env if present
      if (superHooks["shell.env"]) {
        await superHooks["shell.env"](input, output)
      }
      // Then prepend our venv + skill scripts to PATH
      const currentPath = output?.env?.PATH || process.env.PATH || ""
      const venvBin = path.join(AGENT_VENV, "bin")

      const parts = []
      parts.push(venvBin)
      for (const dir of SKILL_SCRIPT_DIRS) {
        if (fs.existsSync(dir)) {
          parts.push(dir)
        }
      }
      parts.push(currentPath)

      output.env = output.env || {}
      output.env.PATH = parts.join(":")
    },

    // Merged hooks
    "tool.execute.before": mergedToolBefore,
    "tool.execute.after": mergedToolAfter,
    "experimental.chat.messages.transform": mergedMessagesTransform,
    "experimental.chat.system.transform": parallelHooks["experimental.chat.system.transform"],
    "experimental.session.compacting": async (_input, output) => {
      output.context = output.context || []
      output.context.push(
        "## OmAgents State Preservation\n" +
          "If you were processing a loop_engine task queue, run:\n" +
          "  loop_engine.py status <skill>\n" +
          "  loop_engine.py next <skill>\n" +
          "to resume where you left off.\n" +
          "If you had background tasks running, use parallel_status to check their state."
      )
    },
    event: mergedEvent,

    // Custom tools
    tool: mergedTools,
  }
}

export default OmagentsPlugin
