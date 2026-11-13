import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const files = [
  "loader.test.ts",
  "skills.test.ts",
  "mcp.test.ts",
  "python.test.ts",
  "tools.test.ts",
  "subagent-lifecycle.test.ts",
  "subagent-recovery.test.ts",
  "context.test.ts",
  "remote-service.test.ts",
  "watch-stream.test.ts",
  "client-store.test.ts",
  "client-components.test.tsx",
  "client-package.test.js",
  "package-surface.test.js",
  "npm-launcher.test.js",
]
const filters = process.argv.slice(2)
const selected = filters.length
  ? files.filter((file) => filters.some((filter) => file.includes(filter)))
  : files

if (selected.length === 0) {
  console.error(`No DSH tests match: ${filters.join(", ")}`)
  process.exitCode = 1
} else {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      ...selected.map((file) => fileURLToPath(new URL(file, import.meta.url))),
    ],
    { stdio: "inherit" }
  )
  child.on("error", (error) => {
    throw error
  })
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`DSH test process received ${signal}`)
      process.exitCode = 1
    } else {
      process.exitCode = code ?? 1
    }
  })
}
