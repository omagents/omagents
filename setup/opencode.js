/**
 * OmAgents OpenCode setup.
 *
 * Run via: npx @omagents/omagents opencode
 *
 * Adds "@omagents/omagents" to the plugin array in opencode.json.
 * Checks both global (~/.config/opencode/opencode.json) and project-level configs.
 */

import fs from "fs"
import path from "path"
import os from "os"

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

  // Default to global config path (will be created if needed)
  return path.join(os.homedir(), ".config", "opencode", "opencode.json")
}

export async function setupOpencode() {
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
  console.log("[omagents] Restart OpenCode to activate.")
}
