import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"

import { ROOT, run } from "./pack-all.js"

const require = createRequire(import.meta.url)
const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: path.join(ROOT, ".omagents", "playwright-browsers"),
}
const preparationTimeoutMs = positiveTimeout(
  process.env.OMAGENTS_BROWSER_PREPARE_TIMEOUT_MS ?? 900_000,
  "OMAGENTS_BROWSER_PREPARE_TIMEOUT_MS"
)
const installTimeoutMs = positiveTimeout(
  process.env.OMAGENTS_BROWSER_INSTALL_TIMEOUT_MS ?? preparationTimeoutMs,
  "OMAGENTS_BROWSER_INSTALL_TIMEOUT_MS"
)
if (process.env.OMAGENTS_PLAYWRIGHT_EXECUTABLE) {
  if (!fs.existsSync(process.env.OMAGENTS_PLAYWRIGHT_EXECUTABLE)) {
    throw new Error(
      `OMAGENTS_PLAYWRIGHT_EXECUTABLE does not exist: ${process.env.OMAGENTS_PLAYWRIGHT_EXECUTABLE}`
    )
  }
} else {
  const playwrightCli = path.join(
    path.dirname(require.resolve("playwright/package.json")),
    "cli.js"
  )
  const installArgs = [playwrightCli, "install", "chromium"]
  if (process.env.OMAGENTS_PLAYWRIGHT_WITH_DEPS === "1") installArgs.push("--with-deps")
  await run(process.execPath, installArgs, {
    cwd: ROOT,
    env,
    echo: true,
    timeoutMs: installTimeoutMs,
  })
}
function positiveTimeout(value, name) {
  const timeout = Number(value)
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`${name} must be a positive number: ${value}`)
  }
  return timeout
}

await run(process.execPath, [path.join(ROOT, "scripts", "prepare-browser-clean-room.js")], {
  cwd: ROOT,
  env,
  echo: true,
  timeoutMs: preparationTimeoutMs,
})

const browserTimeoutMs = positiveTimeout(
  process.env.OMAGENTS_BROWSER_TEST_TIMEOUT_MS ?? 120_000,
  "OMAGENTS_BROWSER_TEST_TIMEOUT_MS"
)
await run(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "--test-reporter=spec",
    path.join(ROOT, "packages", "dsh", "test", "browser-job-board.spec.ts"),
  ],
  { cwd: ROOT, env, echo: true, timeoutMs: browserTimeoutMs }
)
