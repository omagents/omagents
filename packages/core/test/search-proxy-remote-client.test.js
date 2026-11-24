import { test } from "node:test"
import assert from "node:assert/strict"

import { createMcpHttpFixture } from "./fixtures/streamable-mcp-fixture.js"
import { RemoteMcpClient } from "../mcp-servers/search-proxy/remote-client.mjs"
import { ProxyFailure } from "../mcp-servers/search-proxy/errors.mjs"

const SEARCH_TOOL = {
  name: "search",
  description: "Search the local fixture",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
}

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

function sseBody(chunks, close = true) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      if (close) {
        controller.close()
      }
    },
  })
}

async function setup(t, fixtureOptions = {}, clientOptions = {}) {
  const fixture = await createMcpHttpFixture(fixtureOptions)
  const client = new RemoteMcpClient({
    provider: "exa",
    url: fixture.url,
    headers: { "x-api-key": "local-secret" },
    ...clientOptions,
  })
  t.after(async () => {
    client.close()
    await fixture.close()
  })
  return { fixture, client, requests: fixture.requests }
}

async function assertAbort(promise) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.name, "AbortError")
    return true
  })
}

async function assertProtocol(promise) {
  await assert.rejects(promise, (failure) => {
    assert.ok(failure instanceof ProxyFailure)
    assert.equal(failure.code, "protocol")
    assert.equal(failure.fallbackEligible, true)
    return true
  })
}

test("JSON initialization and tool calls send the MCP session and protocol headers", async (t) => {
  const { client, requests } = await setup(t, { sessionId: "session-123" })

  assert.deepEqual(await client.ensureReady(), [SEARCH_TOOL])
  assert.deepEqual(await client.callTool({ name: "search", arguments: { query: "local" } }), {
    content: [{ type: "text", text: "fixture result" }],
  })

  assert.deepEqual(
    requests.map((request) => request.body.method),
    ["initialize", "notifications/initialized", "tools/list", "tools/call"]
  )
  for (const request of requests) {
    assert.equal(request.method, "POST")
    assert.equal(request.headers.accept, "application/json, text/event-stream")
    assert.equal(request.headers["content-type"], "application/json")
    assert.equal(request.headers["x-api-key"], "local-secret")
  }
  assert.equal(requests[0].body.params.protocolVersion, "2025-06-18")
  assert.equal(requests[0].headers["mcp-session-id"], undefined)
  assert.equal(requests[0].headers["mcp-protocol-version"], undefined)
  for (const request of requests.slice(1)) {
    assert.equal(request.headers["mcp-session-id"], "session-123")
    assert.equal(request.headers["mcp-protocol-version"], "2025-06-18")
  }
  assert.equal(requests[1].status, 202)
  assert.deepEqual(requests[3].body.params, { name: "search", arguments: { query: "local" } })
})

test("a server without a session ID does not cause a session header on later requests", async (t) => {
  const { client, requests } = await setup(t)
  await client.ensureReady()

  assert.equal(requests[0].headers["mcp-session-id"], undefined)
  for (const request of requests.slice(1)) {
    assert.equal(request.headers["mcp-session-id"], undefined)
    assert.equal(request.headers["mcp-protocol-version"], "2025-06-18")
  }
})

test("the negotiated 2025-03-26 version is retained on subsequent requests", async (t) => {
  const { client, requests } = await setup(t, {
    protocolVersion: "2025-03-26",
    sessionId: "older-session",
  })
  await client.ensureReady()

  assert.equal(requests[0].body.params.protocolVersion, "2025-06-18")
  for (const request of requests.slice(1)) {
    assert.equal(request.headers["mcp-protocol-version"], "2025-03-26")
  }
})

test("an unsupported negotiated protocol version is a protocol failure", async (t) => {
  const { client, requests } = await setup(t, { protocolVersion: "2024-11-05" })

  await assertProtocol(client.ensureReady())
  assert.equal(requests.length, 1)
})

test("incremental SSE handles fragmented CRLF, comments, multiline data, and unrelated IDs", async (t) => {
  const { client } = await setup(t, {
    onRequest: async ({ body, res }) => {
      if (body.method !== "tools/call") {
        return undefined
      }
      const unrelated = JSON.stringify({
        jsonrpc: "2.0",
        id: body.id + 100,
        result: { content: [{ type: "text", text: "wrong response" }] },
      })
      const matching = JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "from SSE" }] },
      })
      const splitAt = matching.indexOf(',"result"') + 1
      const frame =
        `: keepalive\r\nevent: message\r\ndata: ${unrelated}\r\n\r\n` +
        `: another comment\r\nevent: message\r\ndata: ${matching.slice(0, splitAt)}\r\n` +
        `data: ${matching.slice(splitAt)}\r\n\r\n`
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" })
      let offset = 0
      for (const size of [1, 4, 2, 9, 3, 17, 5, 23, 7, 31]) {
        if (offset >= frame.length) {
          break
        }
        res.write(frame.slice(offset, offset + size))
        offset += size
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
      while (offset < frame.length) {
        res.write(frame.slice(offset, offset + 11))
        offset += 11
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
      res.end()
      return true
    },
  })

  assert.deepEqual(await client.callTool({ name: "search", arguments: { query: "sse" } }), {
    content: [{ type: "text", text: "from SSE" }],
  })
})

test("SSE parser accepts mixed line-ending frame boundaries", async () => {
  const client = new RemoteMcpClient({ provider: "exa", url: "http://local.invalid" })
  const payload = { jsonrpc: "2.0", id: 7, result: { tools: [SEARCH_TOOL] } }
  const body = sseBody([`event: message\ndata: ${JSON.stringify(payload)}\n`, "\r\n"])

  try {
    assert.deepEqual(
      await client.readSse({ body }, payload.id, new AbortController().signal),
      payload
    )
  } finally {
    client.close()
  }
})

test("SSE parser resolves standalone CR frames without EOF", async () => {
  const client = new RemoteMcpClient({ provider: "exa", url: "http://local.invalid" })
  const controller = new AbortController()
  const payload = { jsonrpc: "2.0", id: 8, result: { tools: [SEARCH_TOOL] } }
  const body = sseBody([`data: ${JSON.stringify(payload)}\r\r`], false)
  const pending = client.readSse({ body }, payload.id, controller.signal)

  try {
    assert.deepEqual(await within(pending), payload)
  } finally {
    controller.abort()
    await pending.catch(() => {})
    client.close()
  }
})

test("an isError tool result is returned for router classification", async (t) => {
  const failureResult = {
    isError: true,
    content: [{ type: "text", text: "Temporary backend failure" }],
  }
  const { client } = await setup(t, { callTool: () => failureResult })

  assert.deepEqual(
    await client.callTool({ name: "search", arguments: { query: "failure" } }),
    failureResult
  )
})

test("HTTP-200 JSON-RPC errors preserve backend failure categories without public details", async (t) => {
  const raw =
    "raw JSON-RPC data local-secret confidential query confidential objective https://private.example.test/article"
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
      const { client } = await setup(t, {
        onRequest: ({ body }) => {
          if (body.method === "tools/call") {
            return {
              body: { jsonrpc: "2.0", id: body.id, error: fixtureCase.error },
            }
          }
          return undefined
        },
      })

      await assert.rejects(
        client.callTool({ name: "search", arguments: { query: "confidential query" } }),
        (failure) => {
          assert.ok(failure instanceof ProxyFailure)
          assert.equal(failure.code, fixtureCase.code)
          assert.equal(failure.fallbackEligible, fixtureCase.fallbackEligible)
          assert.equal(failure.status, fixtureCase.status)
          assert.equal(
            failure.message,
            `exa ${fixtureCase.code} failure${fixtureCase.status ? " (HTTP 503)" : ""}`
          )
          assert.ok(failure.message.length <= 500)
          for (const sensitive of [
            "raw JSON-RPC data",
            "local-secret",
            "confidential query",
            "confidential objective",
            "https://private.example.test/article",
          ]) {
            assert.equal(failure.message.includes(sensitive), false, `leaked ${sensitive}`)
          }
          assert.equal(Object.hasOwn(failure, "cause"), false)
          assert.equal(Object.hasOwn(failure, "response"), false)
          return true
        }
      )
    })
  }
})

test("an HTTP error status becomes a ProxyFailure with its status and stable code", async (t) => {
  const { client } = await setup(t, {
    onRequest: () => ({ status: 503, body: { error: "secret backend detail" } }),
  })

  await assert.rejects(client.ensureReady(), (failure) => {
    assert.ok(failure instanceof ProxyFailure)
    assert.equal(failure.code, "http_503")
    assert.equal(failure.status, 503)
    assert.equal(failure.fallbackEligible, true)
    assert.equal(failure.message.includes("secret backend detail"), false)
    return true
  })
})

test("malformed JSON is a protocol failure", async (t) => {
  const { client } = await setup(t, {
    onRequest: () => ({ headers: { "content-type": "application/json" }, body: "{not-json" }),
  })
  await assertProtocol(client.ensureReady())
})

test("an unexpected response content type is a protocol failure", async (t) => {
  const { client } = await setup(t, {
    onRequest: () => ({ headers: { "content-type": "text/plain" }, body: "not an MCP response" }),
  })
  await assertProtocol(client.ensureReady())
})

test("a JSON response without the matching JSON-RPC ID is a protocol failure", async (t) => {
  const { client } = await setup(t, {
    onRequest: () => ({ body: { jsonrpc: "2.0", result: { protocolVersion: "2025-06-18" } } }),
  })
  await assertProtocol(client.ensureReady())
})

test("an SSE stream ending with only an unrelated ID is a protocol failure", async (t) => {
  const { client } = await setup(t, {
    onRequest: ({ body, res }) => {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.end(`data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id + 1, result: {} })}\n\n`)
      return true
    },
  })
  await assertProtocol(client.ensureReady())
})

test("an invalid tools/list envelope is a protocol failure", async (t) => {
  const { client } = await setup(t, {
    onRequest: ({ body }) => {
      if (body.method === "tools/list") {
        return { body: { jsonrpc: "2.0", id: body.id, result: { tools: {} } } }
      }
      return undefined
    },
  })
  await assertProtocol(client.ensureReady())
})

test("an invalid tools/call success envelope is a protocol failure", async (t) => {
  const { client } = await setup(t, {
    onRequest: ({ body }) => {
      if (body.method === "tools/call") {
        return { body: { jsonrpc: "2.0", id: body.id, result: { content: "" } } }
      }
      return undefined
    },
  })
  await assertProtocol(client.callTool({ name: "search", arguments: { query: "invalid" } }))
})

test("aborting a tool call cancels its incremental SSE response body", async (t) => {
  const callStarted = deferred()
  const responseClosed = deferred()
  const { client } = await setup(t, {
    onRequest: ({ body, res }) => {
      if (body.method !== "tools/call") {
        return undefined
      }
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.on("close", () => {
        if (!res.writableEnded) {
          responseClosed.resolve()
        }
      })
      res.write(": waiting\n\n")
      callStarted.resolve()
      return true
    },
  })
  const controller = new AbortController()
  const pending = client.callTool({ name: "search", arguments: {}, signal: controller.signal })
  await within(callStarted.promise)

  controller.abort()
  await assertAbort(pending)
  await within(responseClosed.promise)
})

test("one cancelled readiness waiter does not abort initialization needed by another", async (t) => {
  const initializeStarted = deferred()
  const releaseInitialize = deferred()
  const { client, requests } = await setup(t, {
    onRequest: async ({ body }) => {
      if (body.method === "initialize") {
        initializeStarted.resolve()
        await releaseInitialize.promise
      }
      return undefined
    },
  })
  const firstController = new AbortController()
  const first = client.ensureReady({ signal: firstController.signal })
  const second = client.ensureReady()
  await within(initializeStarted.promise)

  firstController.abort()
  await assertAbort(first)
  releaseInitialize.resolve()
  assert.deepEqual(await second, [SEARCH_TOOL])
  assert.equal(requests.filter((request) => request.body.method === "initialize").length, 1)
})

test("aborting the last readiness waiter cancels the shared initialization POST", async (t) => {
  const initializeStarted = deferred()
  const responseClosed = deferred()
  const { client } = await setup(t, {
    onRequest: async ({ body, res }) => {
      if (body.method !== "initialize") {
        return undefined
      }
      initializeStarted.resolve()
      res.on("close", () => {
        if (!res.writableEnded) {
          responseClosed.resolve()
        }
      })
      await responseClosed.promise
      return true
    },
  })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = client.ensureReady({ signal: firstController.signal })
  const second = client.ensureReady({ signal: secondController.signal })
  await within(initializeStarted.promise)

  firstController.abort()
  secondController.abort()
  await assertAbort(first)
  await assertAbort(second)
  await within(responseClosed.promise)
})

test("a new readiness waiter starts fresh after all earlier waiters cancel", async (t) => {
  const firstInitializeStarted = deferred()
  const firstResponseClosed = deferred()
  let initializeCount = 0
  const { client, requests } = await setup(t, {
    onRequest: async ({ body, res }) => {
      if (body.method !== "initialize") {
        return undefined
      }
      initializeCount += 1
      if (initializeCount === 1) {
        firstInitializeStarted.resolve()
        res.on("close", () => {
          if (!res.writableEnded) {
            firstResponseClosed.resolve()
          }
        })
        await firstResponseClosed.promise
        return true
      }
      return undefined
    },
  })
  const controller = new AbortController()
  const first = client.ensureReady({ signal: controller.signal })
  await within(firstInitializeStarted.promise)

  controller.abort()
  const second = client.ensureReady()
  await assertAbort(first)
  assert.deepEqual(await second, [SEARCH_TOOL])
  await within(firstResponseClosed.promise)
  assert.equal(requests.filter((request) => request.body.method === "initialize").length, 2)
})

test("invalidate resets readiness without aborting an unrelated in-flight tool call", async (t) => {
  const callStarted = deferred()
  const releaseCall = deferred()
  let sessionCounter = 0
  const { client, requests } = await setup(t, {
    sessionId: () => `session-${++sessionCounter}`,
    callTool: async () => {
      callStarted.resolve()
      await releaseCall.promise
      return { content: [{ type: "text", text: "completed" }] }
    },
  })
  await client.ensureReady()
  const pending = client.callTool({ name: "search", arguments: { query: "in flight" } })
  await within(callStarted.promise)

  client.invalidate()
  releaseCall.resolve()
  assert.deepEqual(await pending, { content: [{ type: "text", text: "completed" }] })
  assert.deepEqual(await client.ensureReady(), [SEARCH_TOOL])
  assert.equal(requests.filter((request) => request.body.method === "initialize").length, 2)
  assert.equal(requests.filter((request) => request.body.method === "tools/list").length, 2)
  assert.equal(requests.at(-1).headers["mcp-session-id"], "session-2")
})

test("cached-ready calls retain session headers when invalidated before dispatch", async (t) => {
  const { client, requests } = await setup(t, {
    protocolVersion: "2025-03-26",
    sessionId: "session-before-invalidate",
  })
  await client.ensureReady()
  const pending = client.callTool({ name: "search", arguments: { query: "cached" } })

  client.invalidate()
  assert.deepEqual(await pending, { content: [{ type: "text", text: "fixture result" }] })
  const callRequest = requests.find((request) => request.body.method === "tools/call")
  assert.equal(callRequest.headers["mcp-session-id"], "session-before-invalidate")
  assert.equal(callRequest.headers["mcp-protocol-version"], "2025-03-26")
})

test("late initialize results cannot overwrite a fresh generation's session context", async (t) => {
  const firstInitializeBuffered = deferred()
  const releaseFirstInitialize = deferred()
  let initializeCount = 0
  let sessionCount = 0
  const fetchImpl = async (url, options) => {
    const message = JSON.parse(options.body)
    const isFirstInitialize = message.method === "initialize" && initializeCount++ === 0
    const response = await globalThis.fetch(url, options)
    if (!isFirstInitialize) {
      return response
    }
    const payload = JSON.parse(await response.text())
    payload.result.protocolVersion = "2025-03-26"
    const lateResponse = new Response(JSON.stringify(payload), {
      status: response.status,
      headers: response.headers,
    })
    firstInitializeBuffered.resolve()
    await releaseFirstInitialize.promise
    return lateResponse
  }
  const { client, requests } = await setup(
    t,
    { sessionId: () => `session-${++sessionCount}` },
    { fetchImpl }
  )
  const firstReady = client.ensureReady()
  const firstRejected = assertAbort(firstReady)
  await within(firstInitializeBuffered.promise)

  client.invalidate()
  assert.deepEqual(await client.ensureReady(), [SEARCH_TOOL])
  releaseFirstInitialize.resolve()
  await firstRejected
  assert.deepEqual(await client.callTool({ name: "search", arguments: { query: "fresh" } }), {
    content: [{ type: "text", text: "fixture result" }],
  })
  const callRequest = requests.find((request) => request.body.method === "tools/call")
  assert.equal(callRequest.headers["mcp-session-id"], "session-2")
  assert.equal(callRequest.headers["mcp-protocol-version"], "2025-06-18")
})

test("close is repeat-safe, aborts pending work, and prevents later operations", async (t) => {
  const callStarted = deferred()
  const releaseCall = deferred()
  const responseClosed = deferred()
  const { client } = await setup(t, {
    onRequest: async ({ body, res }) => {
      if (body.method !== "tools/call") {
        return undefined
      }
      callStarted.resolve()
      res.on("close", () => {
        if (!res.writableEnded) {
          responseClosed.resolve()
        }
      })
      await releaseCall.promise
      return {
        body: {
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "too late" }] },
        },
      }
    },
  })
  await client.ensureReady()
  const pending = client.callTool({ name: "search", arguments: { query: "late" } })
  await within(callStarted.promise)

  client.close()
  client.close()
  await assertAbort(pending)
  await within(responseClosed.promise)
  releaseCall.resolve()
  await assert.rejects(client.ensureReady(), /closed/)
  await assert.rejects(client.callTool({ name: "search", arguments: {} }), /closed/)
})
