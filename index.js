#!/usr/bin/env node
/**
 * OmAgents unified entry point.
 *
 * - Module mode (OpenCode import): re-exports the OpenCode plugin.
 * - CLI mode (npx @omagents/omagents): runs the Codex installer.
 */

export { default, OmagentsPlugin } from "./.opencode/plugins/index.js"

import { fileURLToPath } from "url"
import path from "path"

const __filename = fileURLToPath(import.meta.url)
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename

if (isMain) {
  const { installCodex } = await import("./.codex/plugins/install.js")
  installCodex().catch((err) => {
    console.error("[omagents]", err.message)
    process.exit(1)
  })
}
