/**
 * OmAgents Codex installer.
 *
 * Run via: npx @omagents/omagents codex
 *
 * Copies the OmAgents plugin into ~/.codex/plugins/cache/omagents/omagents/local/
 * and enables it in ~/.codex/config.toml. No marketplace required.
 */

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PKG_ROOT = path.resolve(__dirname, "..", "..")

// ─── Inlined data (no external template files) ──────────────────────────────

const TOOL_MAPPING = {
  websearch_web_search_exa: "web_search",
  webfetch: "web_fetch",
  codegraph_codegraph_explore: "mcp__codegraph__explore",
  github_list_issues: "mcp__github__list_issues",
  github_issue_read: "mcp__github__issue_read",
  github_search_issues: "mcp__github__search_issues",
  github_issue_write: "mcp__github__issue_write",
  github_add_issue_comment: "mcp__github__add_issue_comment",
  github_create_pull_request: "mcp__github__create_pull_request",
  github_pull_request_read: "mcp__github__pull_request_read",
  github_update_pull_request: "mcp__github__update_pull_request",
  github_update_pull_request_branch: "mcp__github__update_pull_request_branch",
  github_pull_request_review_write: "mcp__github__pull_request_review_write",
  github_add_comment_to_pending_review: "mcp__github__add_comment_to_pending_review",
  github_merge_pull_request: "mcp__github__merge_pull_request",
  github_add_reply_to_pull_request_comment: "mcp__github__add_reply_to_pull_request_comment",
  github_search_code: "mcp__github__search_code",
  github_search_pull_requests: "mcp__github__search_pull_requests",
  github_list_releases: "mcp__github__list_releases",
}

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

// Sorted longest-first so longer tool names are replaced before shorter prefixes
const SORTED_KEYS = Object.keys(TOOL_MAPPING).sort((a, b) => b.length - a.length)

// ─── Helpers ────────────────────────────────────────────────────────────────

function applyToolMapping(text) {
  let result = text
  for (const key of SORTED_KEYS) {
    result = result.replaceAll(key, TOOL_MAPPING[key])
  }
  return result
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"))
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true })
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

function copyDirWithMapping(src, dest) {
  mkdirp(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") continue
      copyDirWithMapping(srcPath, destPath)
    } else if (entry.name.endsWith(".md")) {
      fs.writeFileSync(destPath, applyToolMapping(fs.readFileSync(srcPath, "utf-8")))
    } else if (entry.name !== ".DS_Store") {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// ─── .mcp.json generation ───────────────────────────────────────────────────

function generateMcpJson(baseJson, hasGithubToken) {
  const servers = {}
  for (const [name, defn] of Object.entries(baseJson)) {
    if (defn.command) {
      servers[name] = {
        command: defn.command[0],
        args: defn.command.slice(1),
      }
    } else {
      servers[name] = { url: defn.url }
    }
  }
  if (hasGithubToken) {
    servers.github = {
      url: "https://api.githubcopilot.com/mcp/",
      bearer_token_env_var: "GITHUB_TOKEN",
    }
  } else {
    servers.grep_app = { url: "https://mcp.grep.app" }
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

const MARKER_START = "# >>> omagents >>>"
const MARKER_END = "# <<< omagents <<<"

function updateConfigToml(configPath, pluginSection) {
  let config = ""
  if (fs.existsSync(configPath)) {
    config = fs.readFileSync(configPath, "utf-8")
  }

  const block = `${MARKER_START}\n${pluginSection}\n${MARKER_END}\n`

  const startIdx = config.indexOf(MARKER_START)
  const endIdx = config.indexOf(MARKER_END)

  if (startIdx !== -1 && endIdx !== -1) {
    const before = config.substring(0, startIdx)
    const after = config.substring(endIdx + MARKER_END.length)
    config = before + block + after
  } else {
    const sep =
      config.length > 0 && !config.endsWith("\n") ? "\n\n" : config.endsWith("\n") ? "\n" : "\n"
    config = config + sep + block
  }

  mkdirp(path.dirname(configPath))
  fs.writeFileSync(configPath, config, "utf-8")
}

// ─── Main install ───────────────────────────────────────────────────────────

export async function installCodex() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")

  if (!fs.existsSync(codexHome)) {
    console.error(`[omagents] Codex home not found at ${codexHome}`)
    console.error("[omagents] Install Codex CLI first: https://developers.openai.com/codex")
    process.exit(1)
  }

  const pkg = readJson(path.join(PKG_ROOT, "package.json"))
  const baseJson = readJson(path.join(PKG_ROOT, "mcp-servers", "base.json"))
  const hasGithubToken = !!process.env.GITHUB_TOKEN

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

  // 2. .mcp.json
  fs.writeFileSync(
    path.join(cacheDir, ".mcp.json"),
    JSON.stringify(generateMcpJson(baseJson, hasGithubToken), null, 2) + "\n"
  )

  // 3. hooks
  const hooksDir = path.join(cacheDir, "hooks")
  mkdirp(hooksDir)
  fs.writeFileSync(path.join(hooksDir, "hooks.json"), JSON.stringify(HOOKS_CONFIG, null, 2) + "\n")
  const venvHookSrc = path.join(PKG_ROOT, "hooks", "setup-venv.js")
  if (fs.existsSync(venvHookSrc)) {
    fs.copyFileSync(venvHookSrc, path.join(hooksDir, "setup-venv.js"))
  }

  // 4. skills (with tool mapping)
  const skillsSrc = path.join(PKG_ROOT, "skills")
  const skillsDest = path.join(cacheDir, "skills")
  mkdirp(skillsDest)

  for (const entry of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue

    const skillSrcDir = path.join(skillsSrc, entry.name)
    const skillDestDir = path.join(skillsDest, entry.name)
    mkdirp(skillDestDir)

    // Use SKILL.codex.md if it exists, otherwise SKILL.md
    const skillMdSrc = fs.existsSync(path.join(skillSrcDir, "SKILL.codex.md"))
      ? path.join(skillSrcDir, "SKILL.codex.md")
      : path.join(skillSrcDir, "SKILL.md")

    if (fs.existsSync(skillMdSrc)) {
      fs.writeFileSync(
        path.join(skillDestDir, "SKILL.md"),
        applyToolMapping(fs.readFileSync(skillMdSrc, "utf-8"))
      )
    }

    // Copy subdirectories with mapping on .md files
    for (const subdir of ["scripts", "templates", "agents"]) {
      const subdirSrc = path.join(skillSrcDir, subdir)
      if (fs.existsSync(subdirSrc)) {
        copyDirWithMapping(subdirSrc, path.join(skillDestDir, subdir))
      }
    }
  }

  // 5. Copy _shared scripts
  const sharedSrc = path.join(skillsSrc, "_shared")
  if (fs.existsSync(sharedSrc)) {
    copyDir(sharedSrc, path.join(skillsDest, "_shared"))
  }

  // 6. Bundle superpowers skills
  const superpowersSrc = path.join(PKG_ROOT, "node_modules", "superpowers", "skills")
  if (fs.existsSync(superpowersSrc)) {
    const superpowersDest = path.join(skillsDest, "superpowers")
    mkdirp(superpowersDest)
    for (const entry of fs.readdirSync(superpowersSrc, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue
      copyDir(path.join(superpowersSrc, entry.name), path.join(superpowersDest, entry.name))
    }
  } else {
    console.warn("[omagents] warning: superpowers skills not found, skipping")
  }

  // 7. Update config.toml (marketplace registration + plugin enable)
  const configPath = path.join(codexHome, "config.toml")
  const pluginSection = [
    `[marketplaces.omagents]`,
    `source_type = "local"`,
    `source = "${marketplaceRoot}"`,
    ``,
    `[plugins."omagents@omagents"]`,
    `enabled = true`,
  ].join("\n")
  updateConfigToml(configPath, pluginSection)
  console.log(`[omagents] Updated ${configPath}`)

  // 8. Done
  console.log("")
  console.log("[omagents] Installation complete!")
  console.log(`[omagents] Plugin: ${cacheDir}`)
  console.log(
    `[omagents] MCP servers: ${Object.keys(generateMcpJson(baseJson, hasGithubToken).mcpServers).join(", ")}`
  )
  if (hasGithubToken) {
    console.log("[omagents] GitHub MCP enabled (GITHUB_TOKEN detected)")
  } else {
    console.log("[omagents] Using grep_app for code search (set GITHUB_TOKEN for full GitHub MCP)")
  }
  console.log("")
  console.log("[omagents] Restart Codex to activate the plugin.")
}
