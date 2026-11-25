import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { createSearchRouter } from "./router.mjs"
import { createStdioMcpServer } from "./stdio-server.mjs"

export function runSearchProxy({
  input = process.stdin,
  output = process.stdout,
  env = process.env,
  clientFactory,
} = {}) {
  const router = createSearchRouter({ env, clientFactory })
  return createStdioMcpServer({ input, output, router })
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  const proxy = runSearchProxy()
  process.once("SIGTERM", () => {
    proxy.close().catch(() => {
      process.exitCode = 1
    })
  })
}
