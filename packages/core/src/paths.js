import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)

/**
 * Resolve assets from the Core package itself. Superpowers uses Node's package
 * resolver so both Core-bundled installs and the development workspace work
 * without assuming a particular node_modules hoisting layout.
 */
export function getCorePaths() {
  const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)))
  const superpowersDir = path.dirname(require.resolve("superpowers/package.json"))

  return {
    root,
    skillsDir: path.join(root, "skills"),
    superpowersDir,
    hooksDir: path.join(root, "hooks"),
    mcpCatalogPath: path.join(root, "mcp-servers", "base.json"),
  }
}
