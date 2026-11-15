import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

test("package dry-run delegates to the Windows-safe npm launcher", async () => {
  const source = await readFile(new URL("package-surface.test.js", import.meta.url), "utf8")

  assert.doesNotMatch(source, /execFileAsync\s*\(\s*["']npm["']/)
  assert.match(source, /import\s*\{\s*runNpm\s*\}\s*from\s*["']\.\/npm-launcher\.js["']/)
  assert.match(source, /await\s+runNpm\s*\(/)
})

test("npm launcher uses Node and the resolved CLI without a shell and preserves args and env", async () => {
  const { createNpmLauncher } = await import("./npm-launcher.js")
  const npmCli = "/resolved/npm/bin/npm-cli.js"
  const env = { npm_execpath: npmCli, OMAGENTS_TEST_SENTINEL: "preserved" }
  const args = ["pack", "--dry-run", "--ignore-scripts", "--json"]
  const originalArgs = [...args]
  const calls = []
  const execute = async (file, childArgs, options) => {
    calls.push({ file, childArgs, options })
    return { stdout: "dry-run output", stderr: "" }
  }
  const runNpm = createNpmLauncher({ execute })

  const result = await runNpm(args, { cwd: "/workspace", env })

  assert.deepEqual(args, originalArgs)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].file, process.execPath)
  assert.deepEqual(calls[0].childArgs, [npmCli, ...originalArgs])
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.cwd, "/workspace")
  assert.strictEqual(calls[0].options.env, env)
  assert.equal(calls[0].options.env.OMAGENTS_TEST_SENTINEL, "preserved")
  assert.deepEqual(result, { stdout: "dry-run output", stderr: "" })
})
