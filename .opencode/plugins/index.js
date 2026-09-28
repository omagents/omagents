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
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createParallelHooks, setupParallelV2 } from "./parallel.js"
import baseMcps from "../../mcp-servers/base.json" with { type: "json" }

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OMAGENTS_DIR = path.resolve(__dirname, "../..")
const SKILLS_DIR = path.join(OMAGENTS_DIR, "skills")

// Dedicated venv for tools bundled by OmAgents
const IS_WIN = process.platform === "win32"
const VENV_BIN = IS_WIN ? "Scripts" : "bin"
const PYTHON_CMD = IS_WIN ? "python" : "python3"
const PATH_SEP = IS_WIN ? ";" : ":"
const AGENT_VENV = path.join(os.homedir(), ".venvs", "omagents")
const AGENT_PYTHON = path.join(AGENT_VENV, VENV_BIN, IS_WIN ? "python.exe" : "python")
const AGENT_PIP = path.join(AGENT_VENV, VENV_BIN, IS_WIN ? "pip.exe" : "pip")

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
 * Prepend the agent venv and skill script dirs to a PATH-like string.
 * Shared by the V1 `shell.env` hook and the V2 `shell "create.before"` hook.
 * Idempotent: entries already present are not duplicated.
 */
function buildPathWithAgentTools(currentPath) {
  const current = currentPath || process.env.PATH || ""
  const existing = current.split(PATH_SEP)

  const parts = []
  const venvBin = path.join(AGENT_VENV, VENV_BIN)
  if (!existing.includes(venvBin)) parts.push(venvBin)
  for (const dir of SKILL_SCRIPT_DIRS) {
    if (fs.existsSync(dir) && !existing.includes(dir)) {
      parts.push(dir)
    }
  }
  parts.push(current)

  return parts.join(PATH_SEP)
}

// Extra context appended to compaction requests (V1 experimental.session
// .compacting / V2 session "compaction" hook) so the agent can resume work.
const COMPACTION_NOTE =
  "## OmAgents State Preservation\n" +
  "If you were processing a loop_engine task queue, run:\n" +
  "  loop_engine.py status <skill>\n" +
  "  loop_engine.py next <skill>\n" +
  "to resume where you left off.\n" +
  "If you had background tasks running, use parallel_status to check their state."

async function tryRun(cmd, args) {
  try {
    await execFileAsync(cmd, args)
    return true
  } catch {
    return false
  }
}

// Provisioning runs at most once per process, no matter how many times the
// host invokes the plugin entry point (V1 may call both the named export and
// default.server; V2 calls setup once).
let _provisioning = null

/**
 * Ensure the dedicated agent venv exists and has the required Python packages.
 * If Python 3 is not found, logs a clear warning with install instructions.
 * Uses node:child_process so it works in both the V1 (Bun) and V2 runtimes.
 * Never rejects.
 */
function ensurePythonDependencies() {
  if (_provisioning) return _provisioning
  _provisioning = (async () => {
    try {
      if (!(await tryRun(PYTHON_CMD, ["--version"]))) {
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

      if (!fs.existsSync(AGENT_PYTHON)) {
        if (!(await tryRun(PYTHON_CMD, ["-m", "venv", AGENT_VENV]))) {
          warnIfDebug("[omagents] Could not create venv at", AGENT_VENV)
          return
        }
      }

      for (const pkg of REQUIRED_PYTHON_PACKAGES) {
        if (await tryRun(AGENT_PYTHON, ["-c", `import ${pkg}`])) {
          continue
        }
        if (!(await tryRun(AGENT_PIP, ["install", pkg]))) {
          warnIfDebug(`[omagents] Could not install ${pkg}`)
        }
      }
    } catch (error) {
      warnIfDebug("[omagents] Python dependency check failed:", error.message)
    }
  })()
  return _provisioning
}

// ─── Load Superpowers (graceful degradation if unavailable) ──────────────────
//
// superpowers >= 6.4 ships a dual entry point: default export is
// { id, server, setup } where .server is the V1 plugin function and .setup is
// the V2 setup function. superpowers <= 6.3 exports the V1 plugin function
// directly. We resolve both halves once and let each host runtime pick its own.

let _superpowers = null // null = not tried, false = unavailable, { server, setup }

async function loadSuperpowers() {
  if (_superpowers !== null) return _superpowers
  try {
    const mod = await import("superpowers")
    const d = mod.default
    const server =
      typeof d === "function"
        ? d
        : typeof d?.server === "function"
          ? d.server
          : typeof mod.SuperpowersPlugin === "function"
            ? mod.SuperpowersPlugin
            : null
    const setup = typeof d?.setup === "function" ? d.setup : null
    _superpowers = server || setup ? { server, setup } : false
    if (!_superpowers) {
      warnIfDebug("[omagents] superpowers module found but no plugin export")
    }
  } catch {
    _superpowers = false // mark as tried-and-failed (distinct from null=not-tried)
    warnIfDebug(
      "[omagents] superpowers not available, skipping (install with: bun add superpowers)"
    )
  }
  return _superpowers || null
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export const OmagentsPlugin = async (ctx) => {
  // Load superpowers and run its V1 plugin function to get its hooks
  let superHooks = {}
  const sp = await loadSuperpowers()
  if (sp && sp.server) {
    try {
      superHooks = (await sp.server(ctx)) || {}
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
      await ensurePythonDependencies()
    },

    "shell.env": async (input, output) => {
      // Run superpowers shell.env if present
      if (superHooks["shell.env"]) {
        await superHooks["shell.env"](input, output)
      }
      // Then prepend our venv + skill scripts to PATH (deduped: the host may
      // invoke this hook twice when both plugin entry points are picked up)
      output.env = output.env || {}
      output.env.PATH = buildPathWithAgentTools(output.env.PATH)
    },

    // Merged hooks
    "tool.execute.before": mergedToolBefore,
    "tool.execute.after": mergedToolAfter,
    "experimental.chat.messages.transform": mergedMessagesTransform,
    "experimental.chat.system.transform": parallelHooks["experimental.chat.system.transform"],
    "experimental.session.compacting": async (_input, output) => {
      output.context = output.context || []
      if (
        output.context.some(
          (c) => typeof c === "string" && c.includes("OmAgents State Preservation")
        )
      )
        return
      output.context.push(COMPACTION_NOTE)
    },
    event: mergedEvent,

    // Custom tools
    tool: mergedTools,
  }
}

// ─── OpenCode V2 ─────────────────────────────────────────────────────────────
//
// V2 (opencode 2.x) loads the default export's { id, setup } descriptor and
// never calls the V1 plugin function. setup() registers everything through
// the V2 plugin context: skills/MCP/commands/tools via domain transforms,
// shell env via ctx.shell.hook("create.before"), prompt context via
// ctx.session.hook("context"/"compaction"), and lifecycle via
// ctx.event.subscribe().

/**
 * Minimal YAML frontmatter parser for SKILL.md files. Handles plain
 * `key: value` lines, quoted values (including quotes closing on an indented
 * continuation line), block scalar markers (`>`, `|`), and CRLF endings.
 * Only the name/description fields consumed below need to survive parsing.
 */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, content: raw }

  const frontmatter = {}
  let lastKey = null
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.replace(/\r$/, "")
    const colonIdx = line.indexOf(":")
    if (colonIdx > 0 && !/^\s/.test(line)) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      frontmatter[key] = /^(>[+-]?|\|[+-]?)$/.test(value) ? "" : value
      lastKey = key
    } else if (lastKey !== null && line.trim() !== "") {
      // Continuation of a multi-line value: append so long descriptions
      // survive. Newlines collapse to spaces.
      frontmatter[lastKey] = `${frontmatter[lastKey]} ${line.trim()}`.trim()
    }
  }

  for (const key of Object.keys(frontmatter)) {
    frontmatter[key] = frontmatter[key].replace(/^(["'])([\s\S]*)\1$/, "$2")
  }

  return { frontmatter, content: match[2] }
}

function collectSkillInfos() {
  const skills = []
  let entries = []
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
  } catch {
    return skills
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue
    const skillPath = path.join(SKILLS_DIR, entry.name, "SKILL.md")
    if (!fs.existsSync(skillPath)) continue
    try {
      const { frontmatter, content } = parseFrontmatter(fs.readFileSync(skillPath, "utf8"))
      skills.push({
        id: entry.name,
        name: frontmatter.name || entry.name,
        ...(frontmatter.description ? { description: frontmatter.description } : {}),
        path: skillPath,
        content,
      })
    } catch (err) {
      warnIfDebug(`[omagents] failed to read skill "${entry.name}":`, err.message)
    }
  }
  return skills
}

// Convert the V1-shaped built-in MCP definitions ({ type, command|url,
// enabled, ... }) to the V2 Mcp.ServerConfig shape (no `enabled` field).
function toV2McpConfig(def) {
  const { enabled, ...rest } = def
  return rest
}

async function setupV2(ctx) {
  // V1 hosts may also invoke default.setup with a V1-shaped context (observed
  // on opencode 1.18.x). Detect it and return quietly — V1 is served entirely
  // by the server() entry point.
  if (
    !ctx ||
    typeof ctx.session?.hook !== "function" ||
    typeof ctx.skill?.transform !== "function" ||
    typeof ctx.tool?.transform !== "function"
  ) {
    return
  }

  // Superpowers: run its V2 setup half (registers its skills + bootstrap)
  const sp = await loadSuperpowers()
  if (sp && sp.setup) {
    try {
      await sp.setup(ctx)
    } catch (err) {
      warnIfDebug("[omagents] superpowers v2 setup failed:", err.message)
    }
  }

  // Register bundled skills as native V2 skills
  try {
    const skills = collectSkillInfos()
    if (skills.length > 0) {
      await ctx.skill.transform((editor) => {
        for (const skill of skills) {
          // editor.add() decodes against the host Skill.Info schema and throws
          // on mismatch; contain per skill so one bad payload skips that skill
          // instead of disabling the whole plugin.
          try {
            editor.add(skill)
          } catch (err) {
            console.error(`[omagents] skill "${skill.id}" rejected by host, skipping:`, err)
          }
        }
      })
    }
  } catch (err) {
    console.error("[omagents] v2 skill registration failed:", err)
  }

  // Register built-in MCP servers (user config takes precedence)
  try {
    await ctx.mcp.transform((editor) => {
      for (const [name, def] of Object.entries(BUILTIN_MCPS)) {
        try {
          if (!editor.get(name)) {
            editor.set(name, toV2McpConfig(def))
          }
        } catch (err) {
          console.error(`[omagents] MCP server "${name}" rejected by host, skipping:`, err)
        }
      }
    })
  } catch (err) {
    console.error("[omagents] v2 MCP registration failed:", err)
  }

  // PATH injection for the agent venv + skill helper scripts
  try {
    await ctx.shell.hook("create.before", (event) => {
      try {
        event.env = event.env || {}
        event.env.PATH = buildPathWithAgentTools(event.env.PATH)
      } catch (err) {
        warnIfDebug("[omagents] v2 shell hook failed:", err.message)
      }
    })
  } catch (err) {
    console.error("[omagents] v2 shell hook registration failed:", err)
  }

  // State-preservation note on compaction requests
  try {
    await ctx.session.hook("compaction", (event) => {
      try {
        event.system = event.system || []
        if (
          event.system.some(
            (p) => p && typeof p.text === "string" && p.text.includes("OmAgents State Preservation")
          )
        )
          return
        event.system.push({ type: "text", text: COMPACTION_NOTE })
      } catch (err) {
        warnIfDebug("[omagents] v2 compaction hook failed:", err.message)
      }
    })
  } catch (err) {
    console.error("[omagents] v2 compaction hook registration failed:", err)
  }

  // Parallel execution engine (tools, hooks, /ps command, event subscription)
  let cleanupParallel
  try {
    cleanupParallel = await setupParallelV2(ctx)
  } catch (err) {
    console.error("[omagents] v2 parallel engine registration failed:", err)
  }

  // Provision the Python venv in the background (never blocks plugin load)
  void ensurePythonDependencies()

  return () => {
    try {
      cleanupParallel?.()
    } catch {
      // best-effort
    }
  }
}

/**
 * Dual V1/V2 entry point.
 *
 * - V2 (opencode 2.x) reads `id` + `setup`.
 * - V1 (opencode 1.18.29+) calls `server()`.
 * - Older V1 releases scan named exports and call `OmagentsPlugin`.
 */
export default {
  id: "omagents",
  server: OmagentsPlugin,
  setup: setupV2,
}
