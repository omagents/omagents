import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { getCorePaths, resolveMcpServers } from "../src/index.js"

const CORE_CATALOG_URL = new URL("../mcp-servers/base.json", import.meta.url)
const SEARCH_PROXY_ENTRY = fileURLToPath(new URL("../mcp-servers/search-proxy/index.mjs", import.meta.url))
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
    env: { OMAGENTS_SEARCH_PROVIDER: "exa", EXA_API_KEY: "", GITHUB_TOKEN: "" },
    exaApiKey: "",
    githubToken: "",
  },
  {
    name: "authenticated Exa and grep_app with only EXA_API_KEY",
    env: { OMAGENTS_SEARCH_PROVIDER: "exa", EXA_API_KEY: "exa-secret", GITHUB_TOKEN: "" },
    exaApiKey: "exa-secret",
    githubToken: "",
  },
  {
    name: "anonymous Exa and GitHub with only GITHUB_TOKEN",
    env: { OMAGENTS_SEARCH_PROVIDER: "exa", EXA_API_KEY: "", GITHUB_TOKEN: "github-secret" },
    exaApiKey: "",
    githubToken: "github-secret",
  },
  {
    name: "authenticated Exa and GitHub with both tokens",
    env: {
      OMAGENTS_SEARCH_PROVIDER: "exa",
      EXA_API_KEY: "exa-secret",
      GITHUB_TOKEN: "github-secret",
    },
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

test("unset and empty provider select the auto proxy", () => {
  const resolutions = []
  const environments = [
    {},
    { OMAGENTS_SEARCH_PROVIDER: "" },
    { OMAGENTS_SEARCH_PROVIDER: "auto" },
  ]

  for (const env of environments) {
    const servers = resolveMcpServers({ env })
    resolutions.push(servers)
    assert.deepEqual(servers.websearch, {
      type: "local",
      command: ["node", SEARCH_PROXY_ENTRY],
    })
    assert.equal(servers.websearch.command[0], "node")
    assert.equal(path.isAbsolute(servers.websearch.command[1]), true)
    assert.equal(servers.websearch.command[1].endsWith(path.join("search-proxy", "index.mjs")), true)
    assert.equal(Object.hasOwn(servers.websearch, "environment"), false)
    assert.equal(servers.keenable, undefined)
    assertCanonicalServers(servers)
  }
  assert.deepEqual(resolutions[1].websearch.command, resolutions[0].websearch.command)
  assert.deepEqual(resolutions[2].websearch.command, resolutions[0].websearch.command)

  const corePaths = getCorePaths()
  assert.equal(path.isAbsolute(corePaths.searchProxyDir), true)
  assert.equal(path.isAbsolute(corePaths.searchProxyEntry), true)
  assert.equal(corePaths.searchProxyDir, path.dirname(SEARCH_PROXY_ENTRY))
  assert.equal(corePaths.searchProxyEntry, SEARCH_PROXY_ENTRY)
  assert.equal(resolutions[0].websearch.command[1], corePaths.searchProxyEntry)
})

test("explicit auto passes optional You.com credentials to the proxy", () => {
  const env = {
    OMAGENTS_SEARCH_PROVIDER: "auto",
    EXA_API_KEY: "exa-secret",
    KEENABLE_API_KEY: "keenable-secret",
    YDC_API_KEY: "ydc-secret",
    CONTEXT7_API_KEY: "context7-secret",
  }
  const envBefore = { ...env }
  const searchProxyEntry = fileURLToPath(new URL("fixtures/custom-search-proxy.mjs", import.meta.url))

  const servers = resolveMcpServers({ env, searchProxyEntry })

  assert.deepEqual(servers.websearch, {
    type: "local",
    command: ["node", searchProxyEntry],
    environment: {
      EXA_API_KEY: "exa-secret",
      KEENABLE_API_KEY: "keenable-secret",
      YDC_API_KEY: "ydc-secret",
    },
  })
  assert.equal(servers.keenable, undefined)
  assert.deepEqual(env, envBefore)
  assertCanonicalServers(servers)
})

test("explicit You.com retains keyed and keyless direct registration", () => {
  const cases = [
    {
      name: "keyed You.com",
      env: {
        OMAGENTS_SEARCH_PROVIDER: "youcom",
        EXA_API_KEY: "exa-secret",
        KEENABLE_API_KEY: "keenable-secret",
        YDC_API_KEY: "ydc-secret",
      },
      expected: {
        type: "remote",
        url: "https://api.you.com/mcp",
        oauth: false,
        headers: { Authorization: "Bearer ydc-secret" },
      },
    },
    {
      name: "keyless You.com",
      env: {
        OMAGENTS_SEARCH_PROVIDER: "youcom",
        EXA_API_KEY: "exa-secret",
        KEENABLE_API_KEY: "keenable-secret",
        YDC_API_KEY: "",
      },
      expected: {
        type: "remote",
        url: "https://api.you.com/mcp/free",
        oauth: false,
      },
    },
  ]

  for (const { name, env, expected } of cases) {
    const envBefore = { ...env }
    const servers = resolveMcpServers({ env })

    assert.deepEqual(servers.youdotcom, expected, name)
    assert.equal(servers.websearch, undefined, name)
    assert.equal(servers.keenable, undefined, name)
    assert.deepEqual(env, envBefore, name)
    assertCanonicalServers(servers)
  }
})

test("explicit Exa and Keenable retain direct registration", () => {
  const cases = [
    {
      name: "explicit Exa ignores Keenable credentials",
      env: {
        OMAGENTS_SEARCH_PROVIDER: "exa",
        EXA_API_KEY: "exa-secret",
        KEENABLE_API_KEY: "keenable-secret",
      },
      expected: expectedWebsearch("exa-secret"),
    },
    {
      name: "keyless Keenable",
      env: { OMAGENTS_SEARCH_PROVIDER: "keenable", EXA_API_KEY: "exa-secret" },
      expected: {
        type: "remote",
        url: "https://api.keenable.ai/mcp-public",
        oauth: false,
      },
    },
    {
      name: "authenticated Keenable",
      env: {
        OMAGENTS_SEARCH_PROVIDER: "keenable",
        EXA_API_KEY: "exa-secret",
        KEENABLE_API_KEY: "keenable-secret",
      },
      expected: {
        type: "remote",
        url: "https://api.keenable.ai/mcp",
        oauth: false,
        headers: { "X-API-Key": "keenable-secret" },
      },
    },
  ]

  for (const { name, env, expected } of cases) {
    const servers = resolveMcpServers({ env })
    const provider = env.OMAGENTS_SEARCH_PROVIDER

    if (provider === "keenable") {
      assert.deepEqual(servers.keenable, expected, name)
      assert.equal(servers.websearch, undefined, name)
    } else {
      assert.deepEqual(servers.websearch, expected, name)
      assert.equal(servers.keenable, undefined, name)
    }
    assert.equal(servers.youdotcom, undefined, name)
    assertCanonicalServers(servers)
  }
})

test("an unsupported search provider fails explicitly", () => {
  assert.throws(
    () => resolveMcpServers({ env: { OMAGENTS_SEARCH_PROVIDER: "unknown" } }),
    /Unsupported OMAGENTS_SEARCH_PROVIDER "unknown"; expected "auto", "exa", "keenable", or "youcom"/
  )
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
  const env = { EXA_API_KEY: "exa-secret", KEENABLE_API_KEY: "keenable-secret" }
  const first = resolveMcpServers({ env })
  first.agentmemory.command[0] = "changed"
  first.websearch.command[1] = "changed"
  first.websearch.environment.EXA_API_KEY = "changed"

  const second = resolveMcpServers({ env })
  assert.deepEqual(second.agentmemory, BASE_CATALOG.agentmemory)
  assert.deepEqual(second.websearch, {
    type: "local",
    command: ["node", SEARCH_PROXY_ENTRY],
    environment: {
      EXA_API_KEY: "exa-secret",
      KEENABLE_API_KEY: "keenable-secret",
    },
  })
})

test("user-config precedence remains in the OpenCode host adapter", () => {
  const source = fs.readFileSync(OPENCODE_INDEX_URL, "utf8")
  assert.match(source, /if \(!config\.mcp\[name\]\)/)
  assert.match(source, /if \(!editor\.get\(name\)\)/)
  assert.doesNotMatch(
    source,
    /process\.env\.(?:OMAGENTS_SEARCH_PROVIDER|CONTEXT7_API_KEY|EXA_API_KEY|KEENABLE_API_KEY|GITHUB_TOKEN)/
  )
})
