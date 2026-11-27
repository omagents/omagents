#!/usr/bin/env node
/**
 * OmAgents OpenCode installer.
 *
 * Run via: npx @omagents/omagents
 *
 * Adds "@omagents/omagents" to the plugin array in opencode.json.
 * Checks both global (~/.config/opencode/opencode.json) and project-level configs.
 */

import fs from "fs"
import path from "path"
import os from "os"

const USAGE = "Usage: npx @omagents/omagents [options]"

function findOpencodeConfig() {
  const candidates = [
    path.join(process.cwd(), "opencode.json"),
    path.join(process.cwd(), "opencode.jsonc"),
    path.join(os.homedir(), ".config", "opencode", "opencode.json"),
    path.join(os.homedir(), ".config", "opencode", "opencode.jsonc"),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  // Default to a project-level config when no existing config is found.
  return path.join(process.cwd(), "opencode.json")
}

export async function setupOpencode(options = {}) {
  const keepWebsearch = options.keepWebsearch === true
  const configPath = findOpencodeConfig()
  const configDir = path.dirname(configPath)

  // Read existing config or start fresh
  let config = {}
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8")
    try {
      config = JSON.parse(raw)
    } catch {
      // JSONC: strip line comments only outside strings (simplified:
      // strip lines that start with optional whitespace + //)
      const stripped = raw
        .split("\n")
        .map((line) => {
          const trimmed = line.trimStart()
          if (trimmed.startsWith("//")) return ""
          return line
        })
        .join("\n")
      config = JSON.parse(stripped)
    }
  }

  // OpenCode 2.x ships a built-in websearch tool whose name is close to the
  // Proxy's websearch_search/websearch_fetch, and agents can pick the wrong
  // one. When the config has no explicit websearch setting, disable the
  // built-in tool so the Proxy's routed tools are the only websearch. An
  // explicit value (false or a provider object) is the user's choice and is
  // never overwritten; --keep-websearch skips this default. OpenCode 1.x has
  // no built-in websearch tool, so the key is inert there.
  const hasWebsearchSetting = Object.hasOwn(config, "websearch")
  const disableWebsearch = !keepWebsearch && !hasWebsearchSetting
  if (disableWebsearch) {
    config.websearch = false
  }

  // OpenCode V2 renamed the config key "plugin" -> "plugins". V2 still
  // normalizes the V1 key, so writing "plugin" works on both — but when the
  // file already uses the native V2 key, add there instead of mixing styles.
  const pluginKey = Array.isArray(config.plugins)
    ? "plugins"
    : Array.isArray(config.plugin)
      ? "plugin"
      : "plugin"

  // Ensure plugin array exists
  config[pluginKey] = config[pluginKey] || []

  // Check if already installed (either key)
  const pkgName = "@omagents/omagents"
  const isOmagents = (p) =>
    p === pkgName ||
    (typeof p === "string" && p.startsWith(pkgName + "@")) ||
    (p && typeof p === "object" && typeof p.package === "string" && p.package.startsWith(pkgName))
  const alreadyInstalled = config.plugin?.some(isOmagents) || config.plugins?.some(isOmagents)

  if (alreadyInstalled) {
    if (disableWebsearch) {
      fs.mkdirSync(configDir, { recursive: true })
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8")
      logWebsearchDefault(configPath)
    } else if (!keepWebsearch && hasWebsearchSetting) {
      console.log("[omagents] OpenCode websearch setting left untouched.")
    }
    console.log(`[omagents] Already in ${configPath}`)
    console.log("[omagents] Restart OpenCode to activate.")
    return
  }

  // Add to plugin array
  config[pluginKey].push(pkgName)

  // Write config
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8")

  console.log(`[omagents] Added "${pkgName}" to ${configPath}`)
  if (disableWebsearch) {
    logWebsearchDefault(configPath)
  }
  console.log("[omagents] Restart OpenCode to activate.")
}

function logWebsearchDefault(configPath) {
  console.log(
    `[omagents] Disabled OpenCode's built-in websearch in ${configPath} (the automatic Search Proxy websearch_search/websearch_fetch remain).`
  )
  console.log(
    "[omagents] Pass --keep-websearch to keep the built-in tool, or delete the websearch key to restore it."
  )
}

function printHelp() {
  console.log(`${USAGE}

Install OmAgents for OpenCode without a positional host argument.

Options:
  --help            Show this help message
  --version         Show the package version
  --keep-websearch  Keep OpenCode's built-in websearch tool; by default the
                    installer writes "websearch": false into opencode.json when
                    that key is absent so the Search Proxy's websearch_search
                    and websearch_fetch are the only websearch tools`)
}

async function main(args) {
  if (args.length === 0) {
    await setupOpencode()
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

  if (args.length === 1 && args[0] === "--keep-websearch") {
    await setupOpencode({ keepWebsearch: true })
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
