import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const files = ["loader.test.ts", "package-surface.test.js"]
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
    ["--test", ...selected.map((file) => fileURLToPath(new URL(file, import.meta.url)))],
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
