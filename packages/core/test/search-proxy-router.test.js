import { test } from "node:test"
import assert from "node:assert/strict"

import { createMcpHttpFixture } from "./fixtures/streamable-mcp-fixture.js"
import { RemoteMcpClient } from "../mcp-servers/search-proxy/remote-client.mjs"
import {
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  SEARCH_PROXY_TOOLS,
  createSearchRouter,
} from "../mcp-servers/search-proxy/router.mjs"

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function within(promise, milliseconds = 1_000) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("timed out waiting for local fixture")),
          milliseconds
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function backendTools(provider, objective = "optional") {
  if (provider === "youcom") {
    return [
      {
        name: "you-search",
        description: "You.com search fixture",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            count: { type: "integer", minimum: 1, maximum: 100 },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        name: "you-extract",
        description: "You.com extract fixture",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string", format: "uri" } },
          required: ["url"],
          additionalProperties: false,
        },
      },
    ]
  }

  if (provider === "keenable") {
    return [
      {
        name: "search_web_pages",
        description: "Keenable search fixture",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            objective: { type: "string" },
            max_results: { type: "integer" },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        name: "fetch_page_content",
        description: "Keenable fetch fixture",
        inputSchema: {
          type: "object",
          properties: { urls: { type: "array" }, max_chars: { type: "integer" } },
          required: ["urls"],
          additionalProperties: false,
        },
      },
    ]
  }

  const searchProperties = { query: { type: "string" } }
  const required = ["query"]
  if (objective !== "absent") {
    searchProperties.objective = { type: "string" }
    if (objective === "required") {
      required.push("objective")
    }
  }
  return [
    {
      name: "web_search_exa",
      description: "Exa search fixture",
      inputSchema: {
        type: "object",
        properties: searchProperties,
        required,
        additionalProperties: false,
      },
    },
    {
      name: "web_fetch_exa",
      description: "Exa fetch fixture",
      inputSchema: {
        type: "object",
        properties: { urls: { type: "array" }, maxCharacters: { type: "integer" } },
        required: ["urls"],
        additionalProperties: false,
      },
    },
  ]
}

async function setup(t, options = {}) {
  const exa = await createMcpHttpFixture({
    tools: backendTools("exa", options.exaObjective),
    toolText: "Exa backend content",
    ...options.exa,
  })
  const keenable = await createMcpHttpFixture({
    tools: backendTools("keenable"),
    toolText: "Keenable backend content",
    ...options.keenable,
  })
  const youcom = await createMcpHttpFixture({
    tools: backendTools("youcom"),
    toolText: "You.com backend content",
    ...options.youcom,
  })
  const router = createSearchRouter({
    env: options.env ?? {},
    attemptTimeoutMs: options.attemptTimeoutMs ?? 1_000,
    clientFactory(config) {
      const urls = { exa: exa.url, keenable: keenable.url, youcom: youcom.url }
      const client = new RemoteMcpClient({ ...config, url: urls[config.provider] })
      if (options.onToolResult) {
        const callTool = client.callTool.bind(client)
        client.callTool = (invocation) =>
          options.onToolResult(config.provider, callTool(invocation))
      }
      return client
    },
  })
  t.after(async () => {
    await router.close()
    await Promise.all([exa.close(), keenable.close(), youcom.close()])
  })
  return { router, exa, keenable, youcom }
}

function requests(fixture, method) {
  return fixture.requests.filter((request) => request.body?.method === method)
}

function toolCalls(fixture) {
  return requests(fixture, "tools/call")
}

function textContent(result) {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
}

async function assertAbort(promise) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.name, "AbortError")
    return true
  })
}

function hangToolCall({ started, closed } = {}) {
  return ({ body, res }) => {
    if (body.method !== "tools/call") {
      return undefined
    }
    res.writeHead(200, { "content-type": "text/event-stream" })
    res.write(": waiting\n\n")
    started?.resolve()
    return new Promise((resolve) => {
      res.on("close", () => {
        closed?.resolve()
        resolve(true)
      })
    })
  }
}

function httpToolStatus(status) {
  return ({ body }) => {
    if (body.method === "tools/call") {
      return { status, body: { error: "private backend response" } }
    }
    return undefined
  }
}

function jsonRpcToolError(error) {
  return ({ body }) => {
    if (body.method === "tools/call") {
      return { body: { jsonrpc: "2.0", id: body.id, error } }
    }
    return undefined
  }
}

function afterResultMicrotasks(promise, callback, count) {
  return promise.then((result) => {
    let boundary = Promise.resolve()
    for (let index = 0; index < count; index += 1) {
      boundary = boundary.then(() => {})
    }
    boundary.then(callback)
    return result
  })
}

const SETTLEMENT_SCENARIOS = [
  { name: "direct success", provider: "exa", microtasks: 1 },
  {
    name: "fallback success",
    provider: "keenable",
    microtasks: 1,
    exa: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "temporary backend failure" }],
      }),
    },
  },
  {
    name: "second-provider failure",
    provider: "keenable",
    microtasks: 3,
    exa: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "temporary backend failure" }],
      }),
    },
    keenable: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "fallback backend failure" }],
      }),
    },
  },
  {
    name: "second fallback success",
    provider: "youcom",
    microtasks: 1,
    exa: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "temporary backend failure" }],
      }),
    },
    keenable: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "fallback backend failure" }],
      }),
    },
  },
  {
    name: "final triple failure",
    provider: "youcom",
    microtasks: 3,
    exa: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "temporary backend failure" }],
      }),
    },
    keenable: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "fallback backend failure" }],
      }),
    },
    youcom: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "final backend failure" }],
      }),
    },
  },
]

test("the router advertises only the bounded generic search and fetch schemas", async (t) => {
  const { router } = await setup(t)

  assert.equal(DEFAULT_ATTEMPT_TIMEOUT_MS, 30_000)
  assert.deepEqual(
    router.listTools().map((tool) => tool.name),
    ["search", "fetch"]
  )
  assert.deepEqual(
    SEARCH_PROXY_TOOLS.map((tool) => tool.name),
    ["search", "fetch"]
  )
  const [search, fetch] = router.listTools()
  assert.equal(search.inputSchema.type, "object")
  assert.deepEqual(search.inputSchema.required, ["query"])
  assert.equal(search.inputSchema.additionalProperties, false)
  assert.deepEqual(search.inputSchema.properties.maxResults, {
    type: "integer",
    minimum: 1,
    maximum: 50,
    default: 10,
  })
  assert.equal(search.inputSchema.properties.objective.maxLength, 1_000)
  assert.equal(fetch.inputSchema.type, "object")
  assert.deepEqual(fetch.inputSchema.required, ["url"])
  assert.equal(fetch.inputSchema.additionalProperties, false)
  assert.equal(fetch.inputSchema.properties.url.type, "string")
  assert.equal(fetch.inputSchema.properties.maxCharacters.type, "integer")
  assert.equal(fetch.inputSchema.properties.maxCharacters.minimum, 1)
})

test("Exa success preserves backend content and adds direct-provider metadata", async (t) => {
  const backendResult = {
    content: [
      { type: "text", text: "first Exa item" },
      { type: "resource", resource: { uri: "file:///result", text: "second Exa item" } },
    ],
    structuredContent: { hits: ["kept"] },
    _meta: { backend: "also kept" },
  }
  const { router, keenable, youcom } = await setup(t, {
    exa: { callTool: () => backendResult },
  })

  const result = await router.callTool("search", { query: "direct result" })

  assert.equal(result.isError, undefined)
  assert.deepEqual(result.content, [
    { type: "text", text: "Provider: exa\n\n" },
    ...backendResult.content,
  ])
  assert.deepEqual(result.structuredContent, { hits: ["kept"] })
  assert.deepEqual(result._meta, {
    backend: "also kept",
    omagents: { provider: "exa", fallback: null },
  })
  assert.equal(keenable.requests.length, 0)
  assert.equal(youcom.requests.length, 0)
  assert.equal("fallbacks" in result._meta.omagents, false)
  assert.deepEqual(backendResult._meta, { backend: "also kept" })
})

test("malformed success metadata is a protocol failure and falls back", async (t) => {
  const cases = [
    ["_meta string", { _meta: "bad" }],
    ["_meta array", { _meta: [] }],
    ["_meta null", { _meta: null }],
    ["structuredContent string", { structuredContent: "bad" }],
    ["structuredContent array", { structuredContent: [] }],
    ["structuredContent null", { structuredContent: null }],
  ]

  for (const [name, malformed] of cases) {
    await t.test(name, async (t) => {
      const { router, exa, keenable } = await setup(t, {
        exa: { callTool: () => ({ content: [], ...malformed }) },
      })

      const result = await router.callTool("search", { query: `malformed ${name}` })

      assert.deepEqual(result._meta.omagents, {
        provider: "keenable",
        fallback: { from: "exa", code: "protocol" },
      })
      assert.equal(toolCalls(exa).length, 1)
      assert.equal(toolCalls(keenable).length, 1)
    })
  }
})

test("valid empty Exa content is success without fallback", async (t) => {
  const { router, exa, keenable, youcom } = await setup(t, {
    exa: { callTool: () => ({ content: [] }) },
  })

  const result = await router.callTool("search", { query: "no hits" })

  assert.deepEqual(result.content, [{ type: "text", text: "Provider: exa\n\n" }])
  assert.deepEqual(result._meta.omagents, { provider: "exa", fallback: null })
  assert.equal(toolCalls(exa).length, 1)
  assert.equal(keenable.requests.length, 0)
  assert.equal(youcom.requests.length, 0)
})

test("each fallback-eligible Exa failure causes exactly one Keenable attempt", async (t) => {
  const cases = [
    {
      name: "timeout",
      code: "timeout",
      attemptTimeoutMs: 20,
      exa: { onRequest: hangToolCall() },
    },
    {
      name: "transport",
      code: "transport",
      exa: {
        onRequest: ({ body, req }) => {
          if (body.method === "tools/call") {
            req.socket.destroy()
            return true
          }
          return undefined
        },
      },
    },
    { name: "HTTP 408", code: "http_408", exa: { onRequest: httpToolStatus(408) } },
    { name: "HTTP 429", code: "http_429", exa: { onRequest: httpToolStatus(429) } },
    { name: "HTTP 503", code: "http_503", exa: { onRequest: httpToolStatus(503) } },
    { name: "protocol", code: "protocol", exa: { callTool: () => ({ content: "" }) } },
    {
      name: "unknown isError",
      code: "backend_error",
      exa: {
        callTool: () => ({
          isError: true,
          content: [{ type: "text", text: "unclassified private backend failure" }],
        }),
      },
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async (t) => {
      const { router, exa, keenable, youcom } = await setup(t, fixtureCase)

      const result = await router.callTool("search", {
        query: `fallback ${fixtureCase.name}`,
        objective: "verify the fallback route",
      })

      assert.equal(result.isError, undefined)
      assert.deepEqual(result.content, [
        {
          type: "text",
          text: `Provider: keenable\nFallback: exa failed (${fixtureCase.code})\n\n`,
        },
        { type: "text", text: "Keenable backend content" },
      ])
      assert.deepEqual(result._meta.omagents, {
        provider: "keenable",
        fallback: { from: "exa", code: fixtureCase.code },
      })
      assert.equal(toolCalls(exa).length, 1)
      assert.equal(toolCalls(keenable).length, 1)
      assert.equal(youcom.requests.length, 0)
      assert.equal("fallbacks" in result._meta.omagents, false)
    })
  }
})

test("You.com success preserves ordered two-fallback metadata without changing legacy result shapes", async (t) => {
  const backendResult = {
    content: [
      { type: "text", text: "first You.com item" },
      { type: "resource", resource: { uri: "file:///youcom", text: "second You.com item" } },
    ],
    structuredContent: { hits: ["kept"] },
    _meta: { backend: "also kept" },
  }
  const { router, exa, keenable, youcom } = await setup(t, {
    exa: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "Temporary Exa failure" }],
      }),
    },
    keenable: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "HTTP 503 temporary Keenable failure" }],
      }),
    },
    youcom: { callTool: () => backendResult },
  })

  const result = await router.callTool("search", {
    query: "third provider result",
    objective: "not forwarded to You.com",
    maxResults: 4,
  })

  const prefix =
    "Provider: youcom\n" +
    "Fallback: exa failed (backend_error)\n" +
    "Fallback: keenable failed (http_503)\n\n"
  assert.equal(result.isError, undefined)
  assert.deepEqual(result.content, [{ type: "text", text: prefix }, ...backendResult.content])
  assert.equal((prefix.match(/^Fallback:/gm) ?? []).length, 2)
  assert.deepEqual(result.structuredContent, { hits: ["kept"] })
  assert.deepEqual(result._meta, {
    backend: "also kept",
    omagents: {
      provider: "youcom",
      fallback: { from: "exa", code: "backend_error" },
      fallbacks: [
        { from: "exa", code: "backend_error" },
        { from: "keenable", code: "http_503" },
      ],
    },
  })
  assert.deepEqual(toolCalls(youcom)[0].body.params, {
    name: "you-search",
    arguments: { query: "third provider result", count: 4 },
  })
  assert.equal(toolCalls(exa).length, 1)
  assert.equal(toolCalls(keenable).length, 1)
  assert.equal(toolCalls(youcom).length, 1)
  assert.deepEqual(backendResult._meta, { backend: "also kept" })
})

test("attempt budget includes delayed initialization", async (t) => {
  const initializeFinished = deferred()
  const { router, exa, keenable } = await setup(t, {
    attemptTimeoutMs: 20,
    exa: {
      onRequest: async ({ body, res }) => {
        if (body.method !== "initialize") {
          return undefined
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
        initializeFinished.resolve()
        return res.destroyed ? true : undefined
      },
    },
  })

  const result = await router.callTool("search", { query: "readiness consumes the budget" })
  await within(initializeFinished.promise)

  assert.deepEqual(result._meta.omagents, {
    provider: "keenable",
    fallback: { from: "exa", code: "timeout" },
  })
  assert.equal(requests(exa, "initialize").length, 1)
  assert.equal(toolCalls(exa).length, 0)
  assert.equal(toolCalls(keenable).length, 1)
})

test("known non-fallback Exa failures return an error without contacting Keenable", async (t) => {
  const cases = [
    ["HTTP 400", "http_400"],
    ["HTTP 401", "http_401"],
    ["HTTP 403", "http_403"],
    ["Authentication failed: invalid API key", "authentication"],
    ["Permission denied for this request", "permission"],
    ["Invalid parameter: query", "invalid_params"],
    ["HTTP 404: target page not found", "http_404"],
    ["HTTP 422: Unprocessable Entity", "http_422"],
    ["HTTP 500; Retryable: no", "backend_error"],
  ]

  for (const [backendText, code] of cases) {
    await t.test(code, async (t) => {
      const { router, exa, keenable } = await setup(t, {
        exa: {
          callTool: () => ({ isError: true, content: [{ type: "text", text: backendText }] }),
        },
      })

      const result = await router.callTool("search", { query: "do not fall back" })

      assert.equal(result.isError, true)
      assert.match(textContent(result), new RegExp(`exa ${code} failure`))
      assert.equal(toolCalls(exa).length, 1)
      assert.equal(keenable.requests.length, 0)
    })
  }
})

test("non-fallback Keenable failure stops before You.com", async (t) => {
  const { router, exa, keenable, youcom } = await setup(t, {
    exa: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "Temporary Exa failure" }],
      }),
    },
    keenable: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "Authentication failed: invalid API key" }],
      }),
    },
  })

  const result = await router.callTool("search", { query: "stop at Keenable" })

  assert.equal(result.isError, true)
  assert.equal(textContent(result), "exa backend_error failure\nkeenable authentication failure")
  assert.equal(toolCalls(exa).length, 1)
  assert.equal(toolCalls(keenable).length, 1)
  assert.equal(youcom.requests.length, 0)
})

test("HTTP-200 JSON-RPC errors obey fallback precedence and public redaction", async (t) => {
  const secrets = {
    EXA_API_KEY: "json-rpc-exa-secret",
    KEENABLE_API_KEY: "json-rpc-keenable-secret",
  }
  const query = "confidential JSON-RPC query"
  const objective = "confidential JSON-RPC objective"
  const targetUrl = "https://private.example.test/json-rpc?token=private"
  const raw = `raw JSON-RPC body ${secrets.EXA_API_KEY} ${secrets.KEENABLE_API_KEY} ${query} ${objective} ${targetUrl}`
  const cases = [
    {
      name: "invalid parameters",
      error: { code: -32602, message: "Invalid params", data: { detail: raw } },
      code: "invalid_params",
      fallbackEligible: false,
    },
    {
      name: "authentication",
      error: { code: -32001, message: "Unauthorized", data: { detail: raw } },
      code: "authentication",
      fallbackEligible: false,
    },
    {
      name: "permission",
      error: { code: -32003, message: "Permission denied", data: { detail: raw } },
      code: "permission",
      fallbackEligible: false,
    },
    {
      name: "explicit non-retryable data",
      error: {
        code: -32000,
        message: "Backend failure",
        data: { status: 503, detail: `Retryable: no ${raw}` },
      },
      code: "backend_error",
      fallbackEligible: false,
      status: 503,
    },
    {
      name: "temporary",
      error: { code: -32000, message: "Temporary backend failure", data: { detail: raw } },
      code: "backend_error",
      fallbackEligible: true,
    },
    {
      name: "explicit retryable data",
      error: { code: -32000, message: "Backend failure", data: `Retryable: yes ${raw}` },
      code: "backend_error",
      fallbackEligible: true,
    },
    {
      name: "unclassified availability failure",
      error: { code: -32000, message: "Backend operation failed", data: { detail: raw } },
      code: "backend_error",
      fallbackEligible: true,
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async (t) => {
      const { router, exa, keenable } = await setup(t, {
        env: secrets,
        exa: { onRequest: jsonRpcToolError(fixtureCase.error) },
      })

      const result = await router.callTool("search", { query, objective })
      const text = textContent(result)

      assert.equal(toolCalls(exa).length, 1)
      assert.equal(toolCalls(keenable).length, fixtureCase.fallbackEligible ? 1 : 0)
      if (fixtureCase.fallbackEligible) {
        assert.equal(result.isError, undefined)
        assert.deepEqual(result._meta.omagents, {
          provider: "keenable",
          fallback: { from: "exa", code: fixtureCase.code },
        })
      } else {
        assert.equal(result.isError, true)
        assert.equal(
          text,
          `exa ${fixtureCase.code} failure${fixtureCase.status ? " (HTTP 503)" : ""}`
        )
        assert.equal(keenable.requests.length, 0)
      }
      assert.ok(text.length <= 500)
      for (const sensitive of [
        ...Object.values(secrets),
        query,
        objective,
        targetUrl,
        "raw JSON-RPC body",
      ]) {
        assert.equal(text.includes(sensitive), false, `leaked ${sensitive}`)
      }
    })
  }
})

test("invalid generic arguments return invalid_params without backend requests", async (t) => {
  const { router, exa, keenable } = await setup(t)

  const result = await router.callTool("search", { query: " ", objective: "private objective" })

  assert.equal(result.isError, true)
  assert.match(textContent(result), /invalid_params/)
  assert.equal(textContent(result).includes("private objective"), false)
  assert.equal(exa.requests.length, 0)
  assert.equal(keenable.requests.length, 0)
})

test("an eligible Exa failure deprioritizes Exa until the router is recreated", async (t) => {
  const { router, exa, keenable, youcom } = await setup(t, {
    exa: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "Temporary Exa failure" }],
      }),
    },
  })

  const first = await router.callTool("search", { query: "initial Exa failure" })
  assert.deepEqual(first._meta.omagents, {
    provider: "keenable",
    fallback: { from: "exa", code: "backend_error" },
  })

  for (const query of ["keep Exa last", "still keep Exa last"]) {
    const result = await router.callTool("search", { query })
    assert.deepEqual(result._meta.omagents, { provider: "keenable", fallback: null })
  }
  assert.equal(toolCalls(exa).length, 1)
  assert.equal(toolCalls(keenable).length, 3)
  assert.equal(youcom.requests.length, 0)

  const restarted = await setup(t)
  const direct = await restarted.router.callTool("search", { query: "new Proxy process" })
  assert.deepEqual(direct._meta.omagents, { provider: "exa", fallback: null })
  assert.equal(toolCalls(restarted.exa).length, 1)
  assert.equal(restarted.keenable.requests.length, 0)
  assert.equal(restarted.youcom.requests.length, 0)
})

test("the deprioritized route tries Keenable and You.com before Exa", async (t) => {
  let exaCallCount = 0
  let keenableCallCount = 0
  const attempts = []
  const { router, exa, keenable, youcom } = await setup(t, {
    exa: {
      callTool: () => {
        exaCallCount += 1
        if (exaCallCount === 1) {
          return {
            isError: true,
            content: [{ type: "text", text: "Temporary Exa failure" }],
          }
        }
        return { content: [{ type: "text", text: "Exa recovered" }] }
      },
    },
    keenable: {
      callTool: () => {
        keenableCallCount += 1
        if (keenableCallCount === 1) {
          return { content: [{ type: "text", text: "Initial Keenable success" }] }
        }
        return {
          isError: true,
          content: [{ type: "text", text: "Temporary Keenable failure" }],
        }
      },
    },
    youcom: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "Temporary You.com failure" }],
      }),
    },
    onToolResult(provider, promise) {
      attempts.push(provider)
      return promise
    },
  })

  const first = await router.callTool("search", { query: "activate Exa deprioritization" })
  assert.deepEqual(first._meta.omagents, {
    provider: "keenable",
    fallback: { from: "exa", code: "backend_error" },
  })
  attempts.length = 0

  const second = await router.callTool("search", { query: "Exa remains the last resort" })
  assert.deepEqual(attempts, ["keenable", "youcom", "exa"])
  assert.deepEqual(second._meta.omagents, {
    provider: "exa",
    fallback: { from: "keenable", code: "backend_error" },
  })
  assert.equal(toolCalls(exa).length, 2)
  assert.equal(toolCalls(keenable).length, 2)
  assert.equal(toolCalls(youcom).length, 1)
})

test("session 404 falls back and later calls keep using Keenable without reinitializing Exa", async (t) => {
  let exaCallCount = 0
  const { router, exa, keenable } = await setup(t, {
    exa: {
      sessionId: () => `exa-session-${requests(exa, "initialize").length}`,
      onRequest: ({ body }) => {
        if (body.method === "tools/call" && ++exaCallCount === 1) {
          return { status: 404, body: { error: "expired MCP session" } }
        }
        return undefined
      },
    },
  })

  const fallback = await router.callTool("search", { query: "refresh the session" })
  assert.deepEqual(fallback._meta.omagents, {
    provider: "keenable",
    fallback: { from: "exa", code: "transport" },
  })
  assert.equal(toolCalls(keenable).length, 1)

  const direct = await router.callTool("search", { query: "keep Exa deprioritized" })
  assert.deepEqual(direct._meta.omagents, { provider: "keenable", fallback: null })
  assert.equal(toolCalls(exa).length, 1)
  assert.equal(requests(exa, "initialize").length, 1)
  assert.equal(toolCalls(keenable).length, 2)
})

test("delayed A/S1 failure cannot invalidate C/S2 while initializing or ready", async (t) => {
  for (const mode of ["initializing", "ready"]) {
    await t.test(mode, async (t) => {
      const aStarted = deferred()
      const bStarted = deferred()
      const releaseA = deferred()
      const releaseB = deferred()
      const s2InitializeStarted = deferred()
      const releaseS2Initialize = deferred()
      const cCallStarted = deferred()
      const releaseCCall = deferred()
      t.after(() => {
        releaseA.resolve()
        releaseB.resolve()
        releaseS2Initialize.resolve()
        releaseCCall.resolve()
      })
      let initializeCount = 0
      let sessionCount = 0
      const { router, exa, keenable, youcom } = await setup(t, {
        exa: {
          sessionId: () => `S${++sessionCount}`,
          onRequest: async ({ body, req }) => {
            if (body.method === "initialize") {
              initializeCount += 1
              if (initializeCount === 2 && mode === "initializing") {
                s2InitializeStarted.resolve()
                await releaseS2Initialize.promise
              }
              return undefined
            }
            if (body.method !== "tools/call") {
              return undefined
            }
            const query = body.params.arguments.query
            if (query === "A/S1") {
              aStarted.resolve()
              await releaseA.promise
              req.socket.destroy()
              return true
            }
            if (query === "B/S1") {
              bStarted.resolve()
              await releaseB.promise
              req.socket.destroy()
              return true
            }
            if (query === "C/S2" && mode === "ready") {
              cCallStarted.resolve()
              await releaseCCall.promise
            }
            return undefined
          },
        },
        keenable: {
          callTool: (params) => {
            if (["C/S2", "D/S2"].includes(params.arguments.query)) {
              return {
                isError: true,
                content: [{ type: "text", text: "Temporary Keenable failure" }],
              }
            }
            return { content: [{ type: "text", text: "Keenable backend content" }] }
          },
        },
        youcom: {
          callTool: () => ({
            isError: true,
            content: [{ type: "text", text: "Temporary You.com failure" }],
          }),
        },
      })

      const a = router.callTool("search", { query: "A/S1" })
      const b = router.callTool("search", { query: "B/S1" })
      await within(aStarted.promise)
      await within(bStarted.promise)
      releaseB.resolve()
      const bResult = await b

      const c = router.callTool("search", { query: "C/S2" })
      await within(mode === "initializing" ? s2InitializeStarted.promise : cCallStarted.promise)
      releaseA.resolve()
      const aResult = await a
      if (mode === "initializing") {
        releaseS2Initialize.resolve()
      } else {
        releaseCCall.resolve()
      }
      const cResult = await c
      const dResult = await router.callTool("search", { query: "D/S2" })

      for (const oldResult of [aResult, bResult]) {
        assert.deepEqual(oldResult._meta.omagents, {
          provider: "keenable",
          fallback: { from: "exa", code: "transport" },
        })
      }
      for (const result of [cResult, dResult]) {
        assert.deepEqual(result._meta.omagents, {
          provider: "exa",
          fallback: { from: "keenable", code: "backend_error" },
        })
      }
      assert.equal(requests(exa, "initialize").length, 2)
      assert.equal(toolCalls(keenable).length, 4)
      assert.equal(toolCalls(youcom).length, 2)
      const exaCalls = toolCalls(exa)
      assert.equal(exaCalls.length, 4)
      for (const query of ["A/S1", "B/S1"]) {
        assert.equal(
          exaCalls.find((request) => request.body.params.arguments.query === query).headers[
            "mcp-session-id"
          ],
          "S1"
        )
      }
      for (const query of ["C/S2", "D/S2"]) {
        assert.equal(
          exaCalls.find((request) => request.body.params.arguments.query === query).headers[
            "mcp-session-id"
          ],
          "S2"
        )
      }
    })
  }
})

test("tool/page 404 does not invalidate the session or fall back", async (t) => {
  const { router, exa, keenable } = await setup(t, {
    exa: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "HTTP 404: target page not found" }],
      }),
    },
  })

  const result = await router.callTool("fetch", { url: "https://example.com/missing" })

  assert.equal(result.isError, true)
  assert.match(textContent(result), /exa http_404 failure/)
  assert.equal(requests(exa, "initialize").length, 1)
  assert.equal(keenable.requests.length, 0)
})

test("three failures expose only bounded ordered provider/category summaries and redact all provider keys", async (t) => {
  const secrets = {
    EXA_API_KEY: "exa-private-router-key",
    KEENABLE_API_KEY: "keenable-private-router-key",
    YDC_API_KEY: "youcom-private-router-key",
  }
  const query = "confidential router query"
  const objective = "confidential router objective"
  const targetUrl = "https://private.example.test/router?token=private"
  const raw = `raw backend body ${secrets.EXA_API_KEY} ${secrets.KEENABLE_API_KEY} ${secrets.YDC_API_KEY} ${query} ${objective} ${targetUrl}`

  for (const [name, args] of [
    ["search", { query, objective }],
    ["fetch", { url: targetUrl }],
  ]) {
    await t.test(name, async (t) => {
      const { router, exa, keenable, youcom } = await setup(t, {
        env: secrets,
        exa: {
          callTool: () => ({
            isError: true,
            content: [{ type: "text", text: `HTTP 503 ${raw}` }],
          }),
        },
        keenable: {
          callTool: () => ({ isError: true, content: [{ type: "text", text: raw }] }),
        },
        youcom: {
          callTool: () => ({ isError: true, content: [{ type: "text", text: raw }] }),
        },
      })

      const result = await router.callTool(name, args)
      const text = textContent(result)

      assert.equal(result.isError, true)
      assert.equal(
        text,
        "exa http_503 failure (HTTP 503)\n" +
          "keenable backend_error failure\n" +
          "youcom backend_error failure"
      )
      assert.ok(text.length <= 500)
      assert.equal(toolCalls(exa).length, 1)
      assert.equal(toolCalls(keenable).length, 1)
      assert.equal(toolCalls(youcom).length, 1)
      for (const sensitive of [
        ...Object.values(secrets),
        query,
        objective,
        targetUrl,
        "raw backend body",
      ]) {
        assert.equal(text.includes(sensitive), false, `leaked ${sensitive}`)
      }
    })
  }
})

test("Exa search mapping honors required, optional, and absent objective schemas", async (t) => {
  const cases = [
    {
      objective: "required",
      input: { query: "schema mapping" },
      arguments: { query: "schema mapping", objective: "schema mapping", numResults: 10 },
    },
    {
      objective: "optional",
      input: { query: "schema mapping" },
      arguments: { query: "schema mapping", numResults: 10 },
    },
    {
      objective: "absent",
      input: { query: "schema mapping", objective: "must not be sent", maxResults: 3 },
      arguments: { query: "schema mapping", numResults: 3 },
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.objective, async (t) => {
      const { router, exa, keenable } = await setup(t, { exaObjective: fixtureCase.objective })

      await router.callTool("search", fixtureCase.input)

      assert.deepEqual(toolCalls(exa)[0].body.params, {
        name: "web_search_exa",
        arguments: fixtureCase.arguments,
      })
      assert.equal(keenable.requests.length, 0)
    })
  }
})

test("fallback search and fetch mappings use Keenable's exact argument names", async (t) => {
  const { router, keenable, youcom } = await setup(t, {
    exa: {
      callTool: () => ({
        isError: true,
        content: [{ type: "text", text: "temporary backend failure" }],
      }),
    },
  })

  await router.callTool("search", {
    query: "mapped fallback",
    objective: "rank primary sources",
    maxResults: 7,
  })
  await router.callTool("fetch", { url: "https://example.com/article", maxCharacters: 12_000 })

  assert.deepEqual(
    toolCalls(keenable).map((request) => request.body.params),
    [
      {
        name: "search_web_pages",
        arguments: {
          query: "mapped fallback",
          objective: "rank primary sources",
          max_results: 7,
        },
      },
      {
        name: "fetch_page_content",
        arguments: { urls: ["https://example.com/article"], max_chars: 12_000 },
      },
    ]
  )
  assert.equal("mode" in toolCalls(keenable)[0].body.params.arguments, false)
  assert.equal(youcom.requests.length, 0)
})

test("third fallback search and fetch mappings use You.com's exact argument names", async (t) => {
  const temporaryFailure = () => ({
    isError: true,
    content: [{ type: "text", text: "temporary backend failure" }],
  })
  const { router, exa, keenable, youcom } = await setup(t, {
    exa: { callTool: temporaryFailure },
    keenable: { callTool: temporaryFailure },
  })

  await router.callTool("search", {
    query: "mapped third fallback",
    objective: "must not be sent",
    maxResults: 9,
  })
  await router.callTool("fetch", { url: "https://example.com/youcom", maxCharacters: 15_000 })

  assert.deepEqual(
    toolCalls(youcom).map((request) => request.body.params),
    [
      {
        name: "you-search",
        arguments: { query: "mapped third fallback", count: 9 },
      },
      {
        name: "you-extract",
        arguments: { url: "https://example.com/youcom" },
      },
    ]
  )
  assert.equal(toolCalls(exa).length, 1)
  assert.equal(toolCalls(keenable).length, 2)
})

test("direct Exa fetch mapping uses one URL and maxCharacters", async (t) => {
  const { router, exa, keenable, youcom } = await setup(t)

  await router.callTool("fetch", { url: "https://example.com/direct", maxCharacters: 500 })

  assert.deepEqual(toolCalls(exa)[0].body.params, {
    name: "web_fetch_exa",
    arguments: { urls: ["https://example.com/direct"], maxCharacters: 500 },
  })
  assert.equal(keenable.requests.length, 0)
  assert.equal(youcom.requests.length, 0)
})

test("a missing required backend tool is a protocol failure and falls back", async (t) => {
  const { router, exa, keenable } = await setup(t, {
    exa: { tools: [backendTools("exa")[1]] },
  })

  const result = await router.callTool("search", { query: "missing tool" })

  assert.deepEqual(result._meta.omagents, {
    provider: "keenable",
    fallback: { from: "exa", code: "protocol" },
  })
  assert.equal(toolCalls(exa).length, 0)
  assert.equal(toolCalls(keenable).length, 1)
})

test("caller cancellation prevents each remaining provider attempt", async (t) => {
  for (const provider of ["exa", "keenable", "youcom"]) {
    await t.test(provider, async (t) => {
      const started = deferred()
      const closed = deferred()
      const temporaryFailure = () => ({
        isError: true,
        content: [{ type: "text", text: "temporary backend failure" }],
      })
      const hanging = { onRequest: hangToolCall({ started, closed }) }
      const { router, exa, keenable, youcom } = await setup(t, {
        exa: provider === "exa" ? hanging : { callTool: temporaryFailure },
        keenable:
          provider === "keenable"
            ? hanging
            : provider === "youcom"
              ? { callTool: temporaryFailure }
              : {},
        youcom: provider === "youcom" ? hanging : {},
      })
      const controller = new AbortController()
      const pending = router.callTool(
        "search",
        { query: `cancel during ${provider}` },
        { signal: controller.signal }
      )
      await within(started.promise)

      controller.abort()
      await assertAbort(pending)
      await within(closed.promise)
      await new Promise((resolve) => setTimeout(resolve, 20))

      const fixtures = { exa, keenable, youcom }
      const currentIndex = ["exa", "keenable", "youcom"].indexOf(provider)
      for (const [index, candidate] of ["exa", "keenable", "youcom"].entries()) {
        if (index <= currentIndex) {
          assert.equal(toolCalls(fixtures[candidate]).length, 1)
        } else {
          assert.equal(fixtures[candidate].requests.length, 0)
        }
      }
    })
  }
})

test("close aborts pending work, prevents later calls, and never starts fallback", async (t) => {
  const started = deferred()
  const closed = deferred()
  const { router, exa, keenable } = await setup(t, {
    exa: { onRequest: hangToolCall({ started, closed }) },
  })
  const pending = router.callTool("search", { query: "close during this request" })
  await within(started.promise)

  await router.close()
  await router.close()
  await assertAbort(pending)
  await within(closed.promise)
  await assertAbort(router.callTool("search", { query: "after close" }))
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(toolCalls(exa).length, 1)
  assert.equal(keenable.requests.length, 0)
})

test("one cancelled waiter does not abort shared initialization", async (t) => {
  const initializeStarted = deferred()
  const releaseInitialize = deferred()
  const { router, exa, keenable } = await setup(t, {
    exa: {
      onRequest: async ({ body }) => {
        if (body.method === "initialize") {
          initializeStarted.resolve()
          await releaseInitialize.promise
        }
        return undefined
      },
    },
  })
  const firstController = new AbortController()
  const first = router.callTool(
    "search",
    { query: "cancelled waiter" },
    { signal: firstController.signal }
  )
  const second = router.callTool("search", { query: "remaining waiter" })
  await within(initializeStarted.promise)

  firstController.abort()
  await assertAbort(first)
  releaseInitialize.resolve()
  const result = await second

  assert.deepEqual(result._meta.omagents, { provider: "exa", fallback: null })
  assert.equal(requests(exa, "initialize").length, 1)
  assert.equal(toolCalls(exa).length, 1)
  assert.equal(keenable.requests.length, 0)
})

test("caller cancellation at attempt settlement suppresses every result path", async (t) => {
  for (const scenario of SETTLEMENT_SCENARIOS) {
    await t.test(scenario.name, async (t) => {
      const controller = new AbortController()
      const { router } = await setup(t, {
        exa: scenario.exa,
        keenable: scenario.keenable,
        youcom: scenario.youcom,
        onToolResult(provider, promise) {
          if (provider !== scenario.provider) {
            return promise
          }
          return afterResultMicrotasks(promise, () => controller.abort(), scenario.microtasks)
        },
      })

      const pending = router.callTool(
        "search",
        { query: `cancel settled ${scenario.name}` },
        { signal: controller.signal }
      )

      await assertAbort(pending)
      assert.equal(controller.signal.aborted, true)
    })
  }
})

test("close at attempt settlement suppresses every result path", async (t) => {
  for (const scenario of SETTLEMENT_SCENARIOS) {
    await t.test(scenario.name, async (t) => {
      let router
      let closing
      const setupOptions = {
        exa: scenario.exa,
        keenable: scenario.keenable,
        youcom: scenario.youcom,
        onToolResult(provider, promise) {
          if (provider !== scenario.provider) {
            return promise
          }
          return afterResultMicrotasks(
            promise,
            () => {
              closing = router.close()
            },
            scenario.microtasks
          )
        },
      }
      router = (await setup(t, setupOptions)).router

      const pending = router.callTool("search", { query: `close settled ${scenario.name}` })

      await assertAbort(pending)
      await closing
    })
  }
})
