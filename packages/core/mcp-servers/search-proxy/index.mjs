import { pathToFileURL } from "node:url"

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const proxy = runSearchProxy()
  process.once("SIGTERM", () => {
    proxy.close().catch(() => {
      process.exitCode = 1
    })
  })
}
