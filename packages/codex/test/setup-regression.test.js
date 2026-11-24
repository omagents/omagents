import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { resolvePythonCommand } from "../../../scripts/python-command.js"
import * as setup from "../src/setup.js"

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..", "..")
const SOURCE_PROXY_DIR = path.join(
  REPOSITORY_ROOT,
  "packages",
  "core",
  "mcp-servers",
  "search-proxy"
)
const SEARCH_PROXY_MODULES = [
  "backends.mjs",
  "errors.mjs",
  "index.mjs",
  "remote-client.mjs",
  "router.mjs",
  "stdio-server.mjs",
]

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

function assertCompleteProxy(directory) {
  assert.equal(fs.existsSync(directory), true, `Proxy asset directory must exist: ${directory}`)
  assert.deepEqual(fs.readdirSync(directory).sort(), [...SEARCH_PROXY_MODULES].sort())
  for (const name of SEARCH_PROXY_MODULES) {
    assert.equal(
      fs.readFileSync(path.join(directory, name), "utf8"),
      fs.readFileSync(path.join(SOURCE_PROXY_DIR, name), "utf8"),
      `${name} must be copied verbatim`
    )
  }
}

function runProxyHandshake(entry, nonexistentNpmCache) {
  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "codex-installer-test", version: "1.0.0" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]
  const result = spawnSync(process.execPath, [entry], {
    input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      NODE_PATH: "",
      NODE_OPTIONS: "",
      npm_config_cache: nonexistentNpmCache,
      NPM_CONFIG_CACHE: nonexistentNpmCache,
      OMAGENTS_SEARCH_PROVIDER: "auto",
      EXA_API_KEY: "",
      KEENABLE_API_KEY: "",
      YDC_API_KEY: "",
    },
  })
  assert.equal(
    result.status,
    0,
    `relocated Proxy failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error || "none"}`
  )
  assert.equal(result.stderr, "")
  const responses = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.equal(responses.length, 2)
  assert.equal(responses[0].id, 1)
  assert.equal(responses[0].result.protocolVersion, "2025-06-18")
  assert.equal(responses[1].id, 2)
  assert.deepEqual(
    responses[1].result.tools.map((tool) => tool.name),
    ["search", "fetch"]
  )
}

function assertPrivateModes(codexHome) {
  if (process.platform === "win32") return
  const root = pluginRoot(codexHome)
  const privateDirectories = [
    path.join(codexHome, "plugins", "cache", "omagents"),
    root,
    path.join(root, ".codex-plugin"),
    path.join(root, "hooks"),
    path.join(root, "mcp-servers"),
    path.join(root, "mcp-servers", "search-proxy"),
  ]
  for (const directory of privateDirectories) {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700, directory)
  }
  assert.equal(fs.statSync(path.join(root, ".mcp.json")).mode & 0o777, 0o600)
}

test("generated config TOML parses Windows-like and quote-containing install paths", async (t) => {
  const temporaryDirectory = makeTempDir(t)
  const homes = [
    process.platform === "win32"
      ? path.join(temporaryDirectory, "runner", "AppData", "Roaming", ".codex")
      : path.join(temporaryDirectory, "C:\\Users\\runner\\AppData\\Roaming\\.codex"),
    path.join(
      temporaryDirectory,
      process.platform === "win32" ? "codex-'quoted'-home" : 'codex-"quoted"-home'
    ),
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
    OMAGENTS_SEARCH_PROVIDER: "exa",
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

test("Codex bearer indirection uses each server owner's credential", async (t) => {
  const codexHome = path.join(makeTempDir(t), ".codex")
  const env = {
    GITHUB_TOKEN: "github-owner-secret",
    OMAGENTS_SEARCH_PROVIDER: "youcom",
    YDC_API_KEY: "youcom-owner-secret",
  }
  await installSilently(t, codexHome, env)

  const root = pluginRoot(codexHome)
  const raw = fs.readFileSync(path.join(root, ".mcp.json"), "utf8")
  const mcp = JSON.parse(raw)
  assert.deepEqual(mcp.mcpServers.github, {
    url: "https://api.githubcopilot.com/mcp/",
    bearer_token_env_var: "GITHUB_TOKEN",
  })
  assert.deepEqual(mcp.mcpServers.youdotcom, {
    url: "https://api.you.com/mcp",
    bearer_token_env_var: "YDC_API_KEY",
  })
  assert.equal(raw.includes(env.GITHUB_TOKEN), false)
  assert.equal(raw.includes(env.YDC_API_KEY), false)
  assert.equal(mcp.mcpServers.websearch, undefined)
  assert.equal(mcp.mcpServers.keenable, undefined)
  assertPrivateModes(codexHome)
})

test("Codex keyless You.com serialization contains only the free endpoint", async (t) => {
  const codexHome = path.join(makeTempDir(t), ".codex")
  await installSilently(t, codexHome, {
    OMAGENTS_SEARCH_PROVIDER: "youcom",
    YDC_API_KEY: "",
  })

  const root = pluginRoot(codexHome)
  const mcp = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"))
  assert.deepEqual(mcp.mcpServers.youdotcom, { url: "https://api.you.com/mcp/free" })
  assert.equal(mcp.mcpServers.websearch, undefined)
  assert.equal(mcp.mcpServers.keenable, undefined)
  assertPrivateModes(codexHome)
})

test("Codex auto installs a relocatable proxy and replaces stale credentials", async (t) => {
  const temporaryDirectory = makeTempDir(t, "omagents codex 空间 ")
  const codexHome = path.join(temporaryDirectory, "Codex Home 日本語", ".codex")
  const root = pluginRoot(codexHome)
  const mcpPath = path.join(root, ".mcp.json")
  const proxyDir = path.join(root, "mcp-servers", "search-proxy")
  const copiedEntry = path.join(proxyDir, "index.mjs")
  const staleProxyFile = path.join(proxyDir, "stale-generated.mjs")

  await installSilently(t, codexHome, {
    OMAGENTS_SEARCH_PROVIDER: "exa",
    EXA_API_KEY: "old-exa-secret",
  })
  assert.deepEqual(JSON.parse(fs.readFileSync(mcpPath, "utf8")).mcpServers.websearch, {
    url: "https://mcp.exa.ai/mcp",
    headers: { "x-api-key": "old-exa-secret" },
  })
  assertCompleteProxy(proxyDir)
  assertPrivateModes(codexHome)
  fs.writeFileSync(staleProxyFile, "stale\n")

  await installSilently(t, codexHome, {
    OMAGENTS_SEARCH_PROVIDER: "auto",
    EXA_API_KEY: "auto-exa-secret",
    KEENABLE_API_KEY: "auto-keenable-secret",
    YDC_API_KEY: "auto-youcom-secret",
  })
  const autoRaw = fs.readFileSync(mcpPath, "utf8")
  const auto = JSON.parse(autoRaw)
  assert.deepEqual(auto.mcpServers.websearch, {
    command: "node",
    args: [copiedEntry],
    env: {
      EXA_API_KEY: "auto-exa-secret",
      KEENABLE_API_KEY: "auto-keenable-secret",
      YDC_API_KEY: "auto-youcom-secret",
    },
  })
  assert.equal(auto.mcpServers.keenable, undefined)
  assert.equal(autoRaw.includes("old-exa-secret"), false)
  assert.equal(fs.existsSync(staleProxyFile), false)
  assertCompleteProxy(proxyDir)
  assertPrivateModes(codexHome)

  const configuredEntry = auto.mcpServers.websearch.args[0]
  assert.equal(path.isAbsolute(configuredEntry), true)
  assert.equal(configuredEntry.startsWith(`${root}${path.sep}`), true)
  assert.equal(configuredEntry.includes(REPOSITORY_ROOT), false)
  assert.equal(configuredEntry.includes(SOURCE_PROXY_DIR), false)
  assert.doesNotMatch(configuredEntry, /[\\/](?:_?npx)[\\/]/i)

  const relocatedParent = path.join(
    makeTempDir(t, "omagents relocated proxy 空间 "),
    "second copy 日本語"
  )
  const relocatedProxy = path.join(relocatedParent, "search-proxy")
  fs.cpSync(proxyDir, relocatedProxy, { recursive: true })
  assertCompleteProxy(relocatedProxy)
  runProxyHandshake(
    path.join(relocatedProxy, "index.mjs"),
    path.join(relocatedParent, "nonexistent npm cache")
  )

  fs.writeFileSync(staleProxyFile, "stale\n")
  await installSilently(t, codexHome, {
    OMAGENTS_SEARCH_PROVIDER: "keenable",
    EXA_API_KEY: "unused-exa-secret",
    KEENABLE_API_KEY: "new-keenable-secret",
    YDC_API_KEY: "unused-youcom-secret",
  })
  const keenableRaw = fs.readFileSync(mcpPath, "utf8")
  const keenable = JSON.parse(keenableRaw)
  assert.equal(keenable.mcpServers.websearch, undefined)
  assert.deepEqual(keenable.mcpServers.keenable, {
    url: "https://api.keenable.ai/mcp",
    headers: { "X-API-Key": "new-keenable-secret" },
  })
  for (const staleSecret of ["auto-exa-secret", "auto-keenable-secret", "auto-youcom-secret"]) {
    assert.equal(keenableRaw.includes(staleSecret), false)
  }
  assert.equal(fs.existsSync(staleProxyFile), false)
  assertCompleteProxy(proxyDir)
  assertPrivateModes(codexHome)

  fs.writeFileSync(staleProxyFile, "stale\n")
  await installSilently(t, codexHome, {
    OMAGENTS_SEARCH_PROVIDER: "youcom",
    EXA_API_KEY: "unused-exa-at-youcom",
    KEENABLE_API_KEY: "unused-keenable-at-youcom",
    YDC_API_KEY: "keyed-youcom-secret",
  })
  const keyedRaw = fs.readFileSync(mcpPath, "utf8")
  const keyedYoucom = JSON.parse(keyedRaw)
  assert.equal(keyedYoucom.mcpServers.websearch, undefined)
  assert.equal(keyedYoucom.mcpServers.keenable, undefined)
  assert.deepEqual(keyedYoucom.mcpServers.youdotcom, {
    url: "https://api.you.com/mcp",
    bearer_token_env_var: "YDC_API_KEY",
  })
  assert.equal(keyedRaw.includes("keyed-youcom-secret"), false)
  for (const staleSecret of [
    "old-exa-secret",
    "auto-exa-secret",
    "auto-keenable-secret",
    "auto-youcom-secret",
    "unused-exa-secret",
    "new-keenable-secret",
    "unused-youcom-secret",
  ]) {
    assert.equal(keyedRaw.includes(staleSecret), false)
  }
  assert.equal(fs.existsSync(staleProxyFile), false)
  assertCompleteProxy(proxyDir)
  assertPrivateModes(codexHome)

  fs.writeFileSync(staleProxyFile, "stale\n")
  await installSilently(t, codexHome, {
    OMAGENTS_SEARCH_PROVIDER: "youcom",
    EXA_API_KEY: "unused-exa-at-keyless",
    KEENABLE_API_KEY: "unused-keenable-at-keyless",
    YDC_API_KEY: "",
  })
  const finalRaw = fs.readFileSync(mcpPath, "utf8")
  const finalYoucom = JSON.parse(finalRaw)
  assert.equal(finalYoucom.mcpServers.websearch, undefined)
  assert.equal(finalYoucom.mcpServers.keenable, undefined)
  assert.deepEqual(finalYoucom.mcpServers.youdotcom, {
    url: "https://api.you.com/mcp/free",
  })
  for (const staleSecret of [
    "old-exa-secret",
    "auto-exa-secret",
    "auto-keenable-secret",
    "auto-youcom-secret",
    "unused-exa-secret",
    "new-keenable-secret",
    "unused-youcom-secret",
    "unused-exa-at-youcom",
    "unused-keenable-at-youcom",
    "keyed-youcom-secret",
    "unused-exa-at-keyless",
    "unused-keenable-at-keyless",
  ]) {
    assert.equal(finalRaw.includes(staleSecret), false)
  }
  assert.equal(fs.existsSync(staleProxyFile), false)
  assertCompleteProxy(proxyDir)
  assertPrivateModes(codexHome)

  fs.writeFileSync(staleProxyFile, "must survive rejected reinstall\n")
  await assert.rejects(
    setup.installCodex({
      codexHome,
      env: {
        OMAGENTS_SEARCH_PROVIDER: "unsupported",
        EXA_API_KEY: "must-not-be-written",
        YDC_API_KEY: "must-not-be-written-either",
      },
    }),
    /Unsupported OMAGENTS_SEARCH_PROVIDER/
  )
  assert.equal(fs.readFileSync(mcpPath, "utf8"), finalRaw)
  assert.equal(fs.readFileSync(staleProxyFile, "utf8"), "must survive rejected reinstall\n")
})

test("Codex reinstall replaces stale providers and credentials", async (t) => {
  const codexHome = path.join(makeTempDir(t), ".codex")
  const mcpPath = path.join(pluginRoot(codexHome), ".mcp.json")

  await installSilently(t, codexHome, {
    OMAGENTS_SEARCH_PROVIDER: "exa",
    EXA_API_KEY: "old-exa-secret",
  })
  assert.deepEqual(JSON.parse(fs.readFileSync(mcpPath, "utf8")).mcpServers.websearch, {
    url: "https://mcp.exa.ai/mcp",
    headers: { "x-api-key": "old-exa-secret" },
  })

  await installSilently(t, codexHome, {
    OMAGENTS_SEARCH_PROVIDER: "keenable",
    KEENABLE_API_KEY: "new-keenable-secret",
  })
  const keenableRaw = fs.readFileSync(mcpPath, "utf8")
  const keenable = JSON.parse(keenableRaw)
  assert.equal(keenable.mcpServers.websearch, undefined)
  assert.deepEqual(keenable.mcpServers.keenable, {
    url: "https://api.keenable.ai/mcp",
    headers: { "X-API-Key": "new-keenable-secret" },
  })
  assert.equal(keenableRaw.includes("old-exa-secret"), false)

  await installSilently(t, codexHome, { OMAGENTS_SEARCH_PROVIDER: "exa" })
  const exaRaw = fs.readFileSync(mcpPath, "utf8")
  const exa = JSON.parse(exaRaw)
  assert.equal(exa.mcpServers.keenable, undefined)
  assert.deepEqual(exa.mcpServers.websearch, { url: "https://mcp.exa.ai/mcp" })
  assert.equal(exaRaw.includes("new-keenable-secret"), false)
})

test("Codex serializes authenticated Keenable without registering Exa", async (t) => {
  const codexHome = path.join(makeTempDir(t), ".codex")
  await installSilently(t, codexHome, {
    OMAGENTS_SEARCH_PROVIDER: "keenable",
    EXA_API_KEY: "unused-exa-secret",
    KEENABLE_API_KEY: "keenable-secret-value",
  })

  const root = pluginRoot(codexHome)
  const mcp = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"))
  assert.deepEqual(mcp.mcpServers.keenable, {
    url: "https://api.keenable.ai/mcp",
    headers: { "X-API-Key": "keenable-secret-value" },
  })
  assert.equal(mcp.mcpServers.websearch, undefined)
  assertPrivateModes(codexHome)
})
