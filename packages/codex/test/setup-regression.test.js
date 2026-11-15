import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { resolvePythonCommand } from "../../../scripts/python-command.js"
import * as setup from "../src/setup.js"

function makeTempDir(t, prefix = "omagents-codex-regression-") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

async function installSilently(t, codexHome, env = {}) {
  if (!console.log.mock) t.mock.method(console, "log", () => {})
  fs.mkdirSync(codexHome, { recursive: true })
  await setup.installCodex({ codexHome, env })
}

function parseToml(source) {
  const result = spawnSync(
    resolvePythonCommand(),
    ["-c", "import json, sys, tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))"],
    { encoding: "utf8", input: source, maxBuffer: 16 * 1024 * 1024 }
  )
  assert.equal(
    result.status,
    0,
    `tomllib rejected generated TOML\n${result.stderr}\n${result.error || ""}`
  )
  return JSON.parse(result.stdout)
}

function pluginRoot(codexHome) {
  return path.join(codexHome, "plugins", "cache", "omagents", "omagents", "local")
}

function assertPrivateModes(codexHome) {
  if (process.platform === "win32") return
  const root = pluginRoot(codexHome)
  const privateDirectories = [
    path.join(codexHome, "plugins", "cache", "omagents"),
    root,
    path.join(root, ".codex-plugin"),
    path.join(root, "hooks"),
  ]
  for (const directory of privateDirectories) {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700, directory)
  }
  assert.equal(fs.statSync(path.join(root, ".mcp.json")).mode & 0o777, 0o600)
}

test("generated config TOML parses Windows-like and quote-containing install paths", async (t) => {
  const temporaryDirectory = makeTempDir(t)
  const homes = [
    path.join(temporaryDirectory, "C:\\Users\\runner\\AppData\\Roaming\\.codex"),
    path.join(temporaryDirectory, 'codex-"quoted"-home'),
  ]
  for (const codexHome of homes) {
    await t.test(path.basename(codexHome), async (t) => {
      await installSilently(t, codexHome)
      const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8")
      const parsed = parseToml(config)
      assert.equal(
        parsed.marketplaces.omagents.source,
        path.join(codexHome, "plugins", "cache", "omagents")
      )
      assert.equal(parsed.plugins["omagents@omagents"].enabled, true)
    })
  }
})

test("TOML basic-string serialization preserves backslashes, quotes, and controls", async () => {
  assert.equal(typeof setup.serializeTomlBasicString, "function")
  const values = [
    "C:\\Users\\runner\\AppData\\Roaming\\.codex",
    'C:\\Users\\"quoted"\\.codex',
    'line\nfeed\ttab\u0001\\and-"quote"',
  ]
  for (const value of values) {
    const parsed = parseToml(`source = ${setup.serializeTomlBasicString(value)}\n`)
    assert.equal(parsed.source, value)
  }
})

test("credential serialization and private modes survive installation rewrites", async (t) => {
  const codexHome = path.join(makeTempDir(t), ".codex")
  const env = {
    GITHUB_TOKEN: "github-secret-value",
    EXA_API_KEY: "exa-secret-value",
    CONTEXT7_API_KEY: "context7-secret-value",
  }
  await installSilently(t, codexHome, env)
  await installSilently(t, codexHome, env)

  const root = pluginRoot(codexHome)
  const mcpPath = path.join(root, ".mcp.json")
  const raw = fs.readFileSync(mcpPath, "utf8")
  const mcp = JSON.parse(raw)
  assert.deepEqual(mcp.mcpServers.github, {
    url: "https://api.githubcopilot.com/mcp/",
    bearer_token_env_var: "GITHUB_TOKEN",
  })
  assert.equal(raw.includes(env.GITHUB_TOKEN), false)
  assert.deepEqual(mcp.mcpServers.websearch, {
    url: "https://mcp.exa.ai/mcp",
    headers: { "x-api-key": env.EXA_API_KEY },
  })
  assert.deepEqual(mcp.mcpServers.context7, {
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: { CONTEXT7_API_KEY: env.CONTEXT7_API_KEY },
  })
  assertPrivateModes(codexHome)
})
