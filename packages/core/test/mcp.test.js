import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

import { resolveMcpServers } from "../src/index.js"

const CORE_CATALOG_URL = new URL("../mcp-servers/base.json", import.meta.url)
const LEGACY_CATALOG_URL = new URL("../../../mcp-servers/base.json", import.meta.url)
const OPENCODE_INDEX_URL = new URL("../../opencode/src/index.js", import.meta.url)

const BASE_CATALOG = {
  agentmemory: {
    type: "local",
    command: ["npx", "-y", "@agentmemory/mcp"],
  },
  codegraph: {
    type: "local",
    command: ["npx", "-y", "@colbymchenry/codegraph", "serve", "--mcp"],
  },
  context7: {
    type: "remote",
    url: "https://mcp.context7.com/mcp",
  },
  websearch: {
    type: "remote",
    url: "https://mcp.exa.ai/mcp",
  },
}

function assertCanonicalServers(servers) {
  for (const [name, definition] of Object.entries(servers)) {
    assert.equal("enabled" in definition, false, `${name} must not contain OpenCode V1 enabled`)
    assert.equal("timeout" in definition, false, `${name} must not contain OpenCode V2 timeout`)
  }
}

function expectedWebsearch(exaApiKey) {
  return {
    type: "remote",
    url: "https://mcp.exa.ai/mcp",
    ...(exaApiKey
      ? {
          oauth: false,
          headers: { "x-api-key": exaApiKey },
        }
      : {}),
  }
}

test("Core exports the resolver and owns the unchanged base catalog", async () => {
  const resolverModule = await import("../src/mcp/resolve-servers.js")
  assert.equal(resolverModule.resolveMcpServers, resolveMcpServers)
  assert.equal(fs.existsSync(CORE_CATALOG_URL), true)
  assert.equal(fs.existsSync(LEGACY_CATALOG_URL), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(CORE_CATALOG_URL, "utf8")), BASE_CATALOG)
})

const environmentMatrix = [
  {
    name: "anonymous Exa and grep_app without tokens",
    env: { EXA_API_KEY: "", GITHUB_TOKEN: "" },
    exaApiKey: "",
    githubToken: "",
  },
  {
    name: "authenticated Exa and grep_app with only EXA_API_KEY",
    env: { EXA_API_KEY: "exa-secret", GITHUB_TOKEN: "" },
    exaApiKey: "exa-secret",
    githubToken: "",
  },
  {
    name: "anonymous Exa and GitHub with only GITHUB_TOKEN",
    env: { EXA_API_KEY: "", GITHUB_TOKEN: "github-secret" },
    exaApiKey: "",
    githubToken: "github-secret",
  },
  {
    name: "authenticated Exa and GitHub with both tokens",
    env: { EXA_API_KEY: "exa-secret", GITHUB_TOKEN: "github-secret" },
    exaApiKey: "exa-secret",
    githubToken: "github-secret",
  },
]

for (const { name, env, exaApiKey, githubToken } of environmentMatrix) {
  test(`resolves ${name}`, () => {
    const servers = resolveMcpServers({ env })

    assert.deepEqual(servers.agentmemory, BASE_CATALOG.agentmemory)
    assert.deepEqual(servers.codegraph, BASE_CATALOG.codegraph)
    assert.deepEqual(servers.websearch, expectedWebsearch(exaApiKey))
    assert.equal(servers.websearch.command, undefined)
    assert.equal(servers.websearch.environment, undefined)

    if (githubToken) {
      assert.deepEqual(servers.github, {
        type: "remote",
        url: "https://api.githubcopilot.com/mcp/",
        oauth: false,
        headers: { Authorization: `Bearer ${githubToken}` },
      })
      assert.equal(servers.grep_app, undefined)
    } else {
      assert.deepEqual(servers.grep_app, {
        type: "remote",
        url: "https://mcp.grep.app",
        oauth: false,
      })
      assert.equal(servers.github, undefined)
    }

    assert.deepEqual(
      Object.keys(servers).sort(),
      [
        "agentmemory",
        "codegraph",
        "context7",
        "websearch",
        githubToken ? "github" : "grep_app",
      ].sort()
    )
    assertCanonicalServers(servers)
  })
}

test("Keenable is not registered unless the user opts in", () => {
  for (const env of [
    {},
    { OMAGENTS_KEENABLE: "" },
    { OMAGENTS_KEENABLE: "0" },
    { KEENABLE_API_KEY: "" },
  ]) {
    assert.equal(resolveMcpServers({ env }).keenable, undefined)
  }
})

test("OMAGENTS_KEENABLE=1 registers the keyless Keenable endpoint next to websearch", () => {
  const servers = resolveMcpServers({ env: { OMAGENTS_KEENABLE: "1", EXA_API_KEY: "" } })
  assert.deepEqual(servers.keenable, {
    type: "remote",
    url: "https://api.keenable.ai/mcp-public",
    oauth: false,
  })
  assert.deepEqual(servers.websearch, expectedWebsearch(""))
  assertCanonicalServers(servers)
})

test("KEENABLE_API_KEY registers the keyed Keenable endpoint", () => {
  const servers = resolveMcpServers({
    env: { KEENABLE_API_KEY: "keenable-secret", OMAGENTS_KEENABLE: "1" },
  })
  assert.deepEqual(servers.keenable, {
    type: "remote",
    url: "https://api.keenable.ai/mcp",
    oauth: false,
    headers: { "X-API-Key": "keenable-secret" },
  })
  assert.deepEqual(servers.websearch, expectedWebsearch(""))
})

test("Context7 is always local and omits environment without CONTEXT7_API_KEY", () => {
  const servers = resolveMcpServers({ env: { CONTEXT7_API_KEY: "" } })
  assert.deepEqual(servers.context7, {
    type: "local",
    command: ["npx", "-y", "@upstash/context7-mcp"],
  })
})

test("Context7 receives CONTEXT7_API_KEY when configured", () => {
  const servers = resolveMcpServers({ env: { CONTEXT7_API_KEY: "context7-secret" } })
  assert.deepEqual(servers.context7, {
    type: "local",
    command: ["npx", "-y", "@upstash/context7-mcp"],
    environment: { CONTEXT7_API_KEY: "context7-secret" },
  })
})

test("resolver does not mutate process.env or the supplied environment", () => {
  const processEnvBefore = { ...process.env }
  const env = {
    CONTEXT7_API_KEY: "context7-secret",
    EXA_API_KEY: "exa-secret",
    GITHUB_TOKEN: "github-secret",
  }
  const envBefore = { ...env }

  resolveMcpServers()
  resolveMcpServers({ env })

  assert.deepEqual({ ...process.env }, processEnvBefore)
  assert.deepEqual(env, envBefore)
})

test("each resolution returns independent catalog data", () => {
  const first = resolveMcpServers({ env: {} })
  first.agentmemory.command[0] = "changed"
  first.websearch.url = "https://example.com/changed"

  const second = resolveMcpServers({ env: {} })
  assert.deepEqual(second.agentmemory, BASE_CATALOG.agentmemory)
  assert.deepEqual(second.websearch, BASE_CATALOG.websearch)
})

test("user-config precedence remains in the OpenCode host adapter", () => {
  const source = fs.readFileSync(OPENCODE_INDEX_URL, "utf8")
  assert.match(source, /if \(!config\.mcp\[name\]\)/)
  assert.match(source, /if \(!editor\.get\(name\)\)/)
  assert.doesNotMatch(source, /process\.env\.(?:CONTEXT7_API_KEY|EXA_API_KEY|GITHUB_TOKEN)/)
})
