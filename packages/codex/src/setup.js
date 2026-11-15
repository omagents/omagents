/**
 * OmAgents Codex installer.
 *
 * Run via: npx @omagents/omagents-codex
 *
 * Copies the OmAgents plugin into ~/.codex/plugins/cache/omagents/omagents/local/
 * and enables it in ~/.codex/config.toml. No marketplace required.
 */

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import {
  getCorePaths,
  listSkillDefinitions,
  renderSkillForHost,
  resolveMcpServers,
} from "@omagents/core"

const HOOKS_CONFIG = {
  hooks: {
    SessionStart: [
      {
        matcher: "startup|resume",
        hooks: [
          {
            type: "command",
            command: "node ${PLUGIN_ROOT}/hooks/setup-venv.js",
            timeout: 120,
          },
        ],
      },
    ],
  },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"))
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
}

function copyDir(src, dest) {
  mkdirp(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__" || entry.name === ".DS_Store") continue
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// ─── .mcp.json generation ───────────────────────────────────────────────────

function generateMcpJson(env) {
  const servers = {}
  for (const [name, definition] of Object.entries(resolveMcpServers({ env }))) {
    if (definition.command) {
      servers[name] = {
        command: definition.command[0],
        args: definition.command.slice(1),
        ...(definition.environment ? { env: definition.environment } : {}),
      }
    } else {
      servers[name] = { url: definition.url }
      if (definition.headers?.Authorization) {
        servers[name].bearer_token_env_var = "GITHUB_TOKEN"
      } else if (definition.headers) {
        servers[name].headers = definition.headers
      }
    }
  }
  return { mcpServers: servers }
}

// ─── plugin.json generation ─────────────────────────────────────────────────

function generatePluginJson(version, description) {
  return {
    name: "omagents",
    version,
    description,
    author: { name: "OmAgents" },
    homepage: "https://github.com/omagents/omagents",
    repository: "https://github.com/omagents/omagents",
    license: "MIT",
    keywords: ["skills", "mcp", "agents", "research"],
    skills: "./skills/",
    mcpServers: "./.mcp.json",
    hooks: "./hooks/hooks.json",
    interface: {
      displayName: "OmAgents",
      shortDescription: description,
      longDescription: description,
      developerName: "OmAgents",
      category: "Developer Tools",
      capabilities: ["Read", "Write"],
    },
  }
}

// ─── marketplace.json generation ────────────────────────────────────────────

function generateMarketplaceJson() {
  return {
    name: "omagents",
    interface: { displayName: "OmAgents" },
    plugins: [
      {
        name: "omagents",
        source: "./omagents",
        category: "Developer Tools",
        policy: { installation: "AVAILABLE" },
      },
    ],
  }
}

// ─── config.toml management ─────────────────────────────────────────────────

/** JSON and TOML basic strings share the escapes emitted here, except DEL. */
export function serializeTomlBasicString(value) {
  if (typeof value !== "string") throw new TypeError("TOML string value must be a string")
  return JSON.stringify(value).replace(/\u007f/g, "\\u007F")
}

const MARKER_START = "# >>> omagents >>>"
const MARKER_END = "# <<< omagents <<<"

// Section prefixes to strip (matches header and all sub-tables)
const MANAGED_PREFIXES = ["[marketplaces.omagents", '[plugins."omagents@omagents']

function stripManagedSections(config) {
  const lines = config.split("\n")
  const result = []
  let skipping = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("[")) {
      skipping = MANAGED_PREFIXES.some((p) => trimmed.startsWith(p))
    }
    if (!skipping) result.push(line)
  }

  // Trim trailing blank lines
  while (result.length > 0 && result[result.length - 1].trim() === "") {
    result.pop()
  }
  return result.join("\n")
}

function updateConfigToml(configPath, pluginSection) {
  let config = ""
  if (fs.existsSync(configPath)) {
    config = fs.readFileSync(configPath, "utf-8")
  }

  // Remove existing marker block
  const startIdx = config.indexOf(MARKER_START)
  const endIdx = config.indexOf(MARKER_END)
  if (startIdx !== -1 && endIdx !== -1) {
    config = config.substring(0, startIdx) + config.substring(endIdx + MARKER_END.length)
  }

  // Strip ALL orphaned omagents sections (from older installs without markers)
  config = stripManagedSections(config)

  // Append fresh marker block
  const block = `${MARKER_START}\n${pluginSection}\n${MARKER_END}\n`
  const sep = config.length > 0 && !config.endsWith("\n") ? "\n\n" : "\n"
  config = config + sep + block

  mkdirp(path.dirname(configPath))
  fs.writeFileSync(configPath, config, "utf-8")
}

// ─── Main install ───────────────────────────────────────────────────────────

export async function installCodex(options = {}) {
  const env = options.env ?? process.env
  const codexHome = options.codexHome ?? env.CODEX_HOME ?? path.join(os.homedir(), ".codex")
  const corePaths = getCorePaths()

  if (!fs.existsSync(codexHome)) {
    console.error(`[omagents] Codex home not found at ${codexHome}`)
    console.error("[omagents] Install Codex CLI first: https://developers.openai.com/codex")
    process.exit(1)
  }

  const pkg = readJson(fileURLToPath(new URL("../package.json", import.meta.url)))
  const mcpJson = generateMcpJson(env)

  // Use "local" as version dir - Codex always prefers it over semver versions
  const cacheDir = path.join(codexHome, "plugins", "cache", "omagents", "omagents", "local")
  const marketplaceRoot = path.join(codexHome, "plugins", "cache", "omagents")

  console.log(`[omagents] Installing to ${cacheDir}`)

  // Clean and recreate cache dir
  fs.rmSync(cacheDir, { recursive: true, force: true })
  mkdirp(cacheDir)

  // 0. marketplace.json at cache root
  mkdirp(marketplaceRoot)
  fs.writeFileSync(
    path.join(marketplaceRoot, "marketplace.json"),
    JSON.stringify(generateMarketplaceJson(), null, 2) + "\n"
  )

  // 1. plugin.json
  const pluginDir = path.join(cacheDir, ".codex-plugin")
  mkdirp(pluginDir)
  fs.writeFileSync(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify(generatePluginJson(pkg.version, pkg.description), null, 2) + "\n"
  )

  // 2. .mcp.json (Exa/Context7 values may be credentials)
  const mcpPath = path.join(cacheDir, ".mcp.json")
  fs.writeFileSync(mcpPath, JSON.stringify(mcpJson, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  })
  fs.chmodSync(mcpPath, 0o600)

  // 3. hooks
  const hooksDir = path.join(cacheDir, "hooks")
  mkdirp(hooksDir)
  fs.writeFileSync(path.join(hooksDir, "hooks.json"), JSON.stringify(HOOKS_CONFIG, null, 2) + "\n")
  for (const hookName of ["python-env.js", "setup-venv.js", "project-venv.js"]) {
    const hookSrc = path.join(corePaths.hooksDir, hookName)
    if (fs.existsSync(hookSrc)) {
      fs.copyFileSync(hookSrc, path.join(hooksDir, hookName))
    }
  }

  // 4. Render every discovered skill through Core for Codex.
  const skillsSrc = corePaths.skillsDir
  const skillsDest = path.join(cacheDir, "skills")
  mkdirp(skillsDest)

  const skillDefinitions = listSkillDefinitions({ host: "codex" })
  for (const definition of skillDefinitions) {
    const skillDestDir =
      definition.source === "superpowers"
        ? path.join(skillsDest, "superpowers", definition.id)
        : path.join(skillsDest, definition.id)
    mkdirp(skillDestDir)

    if (definition.source === "superpowers") {
      copyDir(definition.directory, skillDestDir)
    } else {
      for (const subdir of ["scripts", "templates", "agents"]) {
        const subdirSrc = path.join(definition.directory, subdir)
        if (fs.existsSync(subdirSrc)) copyDir(subdirSrc, path.join(skillDestDir, subdir))
      }
    }

    const rendered = renderSkillForHost(definition, "codex")
    fs.writeFileSync(path.join(skillDestDir, "SKILL.md"), rendered.content)
  }

  // 5. Copy _shared scripts
  const sharedSrc = path.join(skillsSrc, "_shared")
  if (fs.existsSync(sharedSrc)) {
    copyDir(sharedSrc, path.join(skillsDest, "_shared"))
  }

  if (!skillDefinitions.some((definition) => definition.source === "superpowers")) {
    console.warn("[omagents] warning: superpowers skills not found, skipping")
  }

  // 6. Update config.toml (marketplace registration + plugin enable)
  const configPath = path.join(codexHome, "config.toml")
  const pluginSection = [
    `[marketplaces.omagents]`,
    `source_type = "local"`,
    `source = ${serializeTomlBasicString(marketplaceRoot)}`,
    ``,
    `[plugins."omagents@omagents"]`,
    `enabled = true`,
  ].join("\n")
  updateConfigToml(configPath, pluginSection)
  console.log(`[omagents] Updated ${configPath}`)

  // 7. Done
  console.log("")
  console.log("[omagents] Installation complete!")
  console.log(`[omagents] Plugin: ${cacheDir}`)
  console.log(`[omagents] MCP servers: ${Object.keys(mcpJson.mcpServers).join(", ")}`)
  if (mcpJson.mcpServers.github) {
    console.log("[omagents] GitHub MCP enabled (GITHUB_TOKEN detected)")
  } else {
    console.log("[omagents] Using grep_app for code search (set GITHUB_TOKEN for full GitHub MCP)")
  }
  console.log("")
  console.log("[omagents] Restart Codex to activate the plugin.")
}
