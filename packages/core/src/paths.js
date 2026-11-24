import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)

function resolveOptionalSuperpowersDir(coreRoot) {
  const packageParent = path.dirname(coreRoot)
  const isScopedInstall =
    path.basename(packageParent).startsWith("@") &&
    path.basename(path.dirname(packageParent)) === "node_modules"
  const appRoot = path.resolve(coreRoot, isScopedInstall ? "../../.." : "../..")
  const candidates = [
    path.join(appRoot, "node_modules", "superpowers"),
    path.join(coreRoot, "node_modules", "superpowers"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate
  }

  try {
    const resolved = path.dirname(require.resolve("superpowers/package.json"))
    return fs.existsSync(path.join(resolved, "package.json")) ? resolved : null
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error
    return null
  }
}

/**
 * Resolve assets from the Core package itself. Superpowers uses Node's package
 * resolver so both Core-bundled installs and the development workspace work
 * without assuming a particular node_modules hoisting layout. Only an absent
 * Superpowers package is optional; every other asset path remains required by
 * its consumer and resolution errors are not swallowed.
 */
export function getCorePaths() {
  const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)))
  const superpowersDir = resolveOptionalSuperpowersDir(root)
  const searchProxyDir = path.join(root, "mcp-servers", "search-proxy")

  return {
    root,
    skillsDir: path.join(root, "skills"),
    superpowersDir,
    hooksDir: path.join(root, "hooks"),
    mcpCatalogPath: path.join(root, "mcp-servers", "base.json"),
    searchProxyDir,
    searchProxyEntry: path.join(searchProxyDir, "index.mjs"),
  }
}
