#!/usr/bin/env node
/**
 * OmAgents unified entry point.
 *
 * - Module mode (OpenCode import): re-exports the OpenCode plugin.
 * - CLI mode: npx @omagents/omagents <codex|opencode>
 */

export { default, OmagentsPlugin } from "./.opencode/plugins/index.js"

const command = process.argv[2]

if (command === "codex") {
  const { installCodex } = await import("./.codex/plugins/setup.js")
  installCodex().catch((err) => {
    console.error("[omagents]", err.message)
    process.exit(1)
  })
} else if (command === "opencode") {
  const { setupOpencode } = await import("./.opencode/plugins/setup.js")
  setupOpencode().catch((err) => {
    console.error("[omagents]", err.message)
    process.exit(1)
  })
} else if (command) {
  console.error(`[omagents] Unknown command: ${command}`)
  console.error("Usage: npx @omagents/omagents <codex|opencode>")
  process.exit(1)
}
