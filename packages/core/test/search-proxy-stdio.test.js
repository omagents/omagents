import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import { fileURLToPath } from "node:url"

import { createStdioMcpServer } from "../mcp-servers/search-proxy/stdio-server.mjs"
import { runSearchProxy } from "../mcp-servers/search-proxy/index.mjs"

const ENTRY = fileURLToPath(new URL("../mcp-servers/search-proxy/index.mjs", import.meta.url))

const EXPECTED_TOOLS = [
  {
    name: "search",
    description: "Search the web through Exa with eligible Keenable and You.com fallback",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        objective: { type: "string", minLength: 1, maxLength: 1_000 },
        maxResults: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch",
    description: "Fetch one HTTP(S) URL through Exa with eligible Keenable and You.com fallback",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        maxCharacters: { type: "integer", minimum: 1 },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
]

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function within(promise, milliseconds = 5_000) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("timed out waiting for stdio test")),
          milliseconds
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve))
}

function createMessageReader(stream) {
  const messages = []
  const parseErrors = []
  const waiters = []
  let buffered = ""

  stream.setEncoding("utf8")
  stream.on("data", (chunk) => {
    buffered += chunk
    let newline
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, newline).replace(/\r$/, "")
      buffered = buffered.slice(newline + 1)
      if (line.trim() === "") {
        continue
      }
      try {
        const message = JSON.parse(line)
        messages.push(message)
        for (let index = waiters.length - 1; index >= 0; index -= 1) {
          if (waiters[index].predicate(message)) {
            waiters.splice(index, 1)[0].resolve(message)
          }
        }
      } catch (error) {
        parseErrors.push({ line, error })
      }
    }
  })

  return {
    messages,
    parseErrors,
    waitFor(predicate) {
      const existing = messages.find(predicate)
      if (existing) {
        return Promise.resolve(existing)
      }
      return within(
        new Promise((resolve) => {
          waiters.push({ predicate, resolve })
        })
      )
    },
  }
}

function createHarness(t, start) {
  const input = new PassThrough()
  const output = new PassThrough()
  const reader = createMessageReader(output)
  const server = start({ input, output })

  t.after(async () => {
    await server.close()
    input.destroy()
    output.destroy()
  })

  return {
    input,
    output,
    reader,
    server,
    send(message, delimiter = "\n") {
      input.write(`${JSON.stringify(message)}${delimiter}`)
    },
    request(message, delimiter = "\n") {
      input.write(`${JSON.stringify(message)}${delimiter}`)
      return reader.waitFor((candidate) => candidate.id === message.id)
    },
  }
}

function spawnEntry(t) {
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, EXA_API_KEY: "", KEENABLE_API_KEY: "", YDC_API_KEY: "" },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const reader = createMessageReader(child.stdout)
  const exit = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }))
  })
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
      await within(exit)
    }
  })

  return {
    child,
    reader,
    exit,
    stderr: () => stderr,
    send(message, delimiter = "\n") {
      child.stdin.write(`${JSON.stringify(message)}${delimiter}`)
    },
    request(message, delimiter = "\n") {
      child.stdin.write(`${JSON.stringify(message)}${delimiter}`)
      return reader.waitFor((candidate) => candidate.id === message.id)
    },
  }
}

function assertProtocolOnly(reader, stderr) {
  assert.deepEqual(reader.parseErrors, [])
  assert.equal(stderr, "")
}

function createBackendClient(calls) {
  return {
    async ensureReady() {
      calls.ensureReady += 1
      return []
    },
    async callTool() {
      calls.callTool += 1
      return { content: [] }
    },
    async close() {},
  }
}

test("the executable negotiates MCP, lists exact generic tools, and closes with stdin", async (t) => {
  const processHandle = spawnEntry(t)

  const initialize = await processHandle.request({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "stdio-test", version: "1.0.0" },
    },
  })
  assert.equal(initialize.jsonrpc, "2.0")
  assert.equal(initialize.result.protocolVersion, "2025-06-18")
  assert.equal(typeof initialize.result.capabilities.tools, "object")

  processHandle.send({ jsonrpc: "2.0", method: "notifications/initialized" })
  const list = await processHandle.request({ jsonrpc: "2.0", id: 2, method: "tools/list" })
  assert.deepEqual(list.result.tools, EXPECTED_TOOLS)
  assert.deepEqual(processHandle.reader.messages, [initialize, list])

  const shutdown = await processHandle.request({ jsonrpc: "2.0", id: 3, method: "shutdown" })
  assert.equal(shutdown.error.code, -32601)
  assert.equal(shutdown.result, undefined)

  processHandle.child.stdin.end()
  assert.deepEqual(await within(processHandle.exit), { code: 0, signal: null })
  assertProtocolOnly(processHandle.reader, processHandle.stderr())
})

test(
  "the executable negotiates MCP through a symlinked entry path",
  { skip: process.platform === "win32" ? "file symlinks may require elevated privileges" : false },
  (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-proxy-link-"))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const linkedEntry = path.join(directory, "index.mjs")
    fs.symlinkSync(ENTRY, linkedEntry, "file")

    const requests = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {} },
      },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]
    const result = spawnSync(process.execPath, [linkedEntry], {
      input: `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
      encoding: "utf8",
      env: { ...process.env, EXA_API_KEY: "", KEENABLE_API_KEY: "", YDC_API_KEY: "" },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, "")
    const responses = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      responses.map((response) => response.id),
      [1, 2]
    )
    assert.equal(responses[0].result.protocolVersion, "2025-06-18")
    assert.deepEqual(
      responses[1].result.tools.map((tool) => tool.name),
      ["search", "fetch"]
    )
  }
)

test("LF and CRLF requests support ping, notifications, protocol errors, and input validation", async (t) => {
  const calls = { ensureReady: 0, callTool: 0 }
  const harness = createHarness(t, ({ input, output }) =>
    runSearchProxy({
      input,
      output,
      env: {},
      clientFactory: () => createBackendClient(calls),
    })
  )

  const ping = await harness.request({ jsonrpc: "2.0", id: "ping", method: "ping" })
  assert.deepEqual(ping.result, {})

  harness.send({ jsonrpc: "2.0", method: "notifications/initialized" }, "\r\n")
  const unknownMethod = await harness.request(
    { jsonrpc: "2.0", id: 2, method: "not/a/method" },
    "\r\n"
  )
  assert.equal(unknownMethod.error.code, -32601)
  assert.deepEqual(harness.reader.messages, [ping, unknownMethod])

  const unknownTool = await harness.request({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "unknown", arguments: {} },
  })
  assert.equal(unknownTool.error.code, -32602)
  assert.equal(unknownTool.result, undefined)

  const invalid = await harness.request({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "search",
      arguments: { query: " ", objective: "private objective" },
    },
  })
  assert.equal(invalid.error, undefined)
  assert.equal(invalid.result.isError, true)
  assert.match(invalid.result.content[0].text, /invalid_params/)
  assert.equal(invalid.result.content[0].text.includes("private objective"), false)
  assert.deepEqual(calls, { ensureReady: 0, callTool: 0 })
  assertProtocolOnly(harness.reader, "")
})

test("tools/call preserves provider metadata from the injected router", async (t) => {
  const providerResult = {
    content: [
      { type: "text", text: "Provider: exa\n\n" },
      { type: "text", text: "backend result" },
    ],
    structuredContent: { hits: ["kept"] },
    _meta: { omagents: { provider: "exa", fallback: null } },
  }
  const router = {
    listTools: () => structuredClone(EXPECTED_TOOLS),
    async callTool() {
      return providerResult
    },
    async close() {},
  }
  const harness = createHarness(t, ({ input, output }) =>
    createStdioMcpServer({ input, output, router })
  )

  const response = await harness.request({
    jsonrpc: "2.0",
    id: 42,
    method: "tools/call",
    params: { name: "search", arguments: { query: "provider metadata" } },
  })

  assert.deepEqual(response.result, providerResult)
  assertProtocolOnly(harness.reader, "")
})

test("cancellation aborts only its matching call and suppresses its late response", async (t) => {
  const calls = new Map()
  const router = {
    listTools: () => structuredClone(EXPECTED_TOOLS),
    callTool(_name, args, { signal }) {
      const result = deferred()
      const aborted = deferred()
      const call = { result, aborted, signal }
      calls.set(args.query, call)
      signal.addEventListener("abort", () => aborted.resolve(), { once: true })
      return result.promise
    },
    async close() {},
  }
  const harness = createHarness(t, ({ input, output }) =>
    createStdioMcpServer({ input, output, router })
  )

  harness.send({
    jsonrpc: "2.0",
    id: 77,
    method: "tools/call",
    params: { name: "search", arguments: { query: "cancelled" } },
  })
  harness.send({
    jsonrpc: "2.0",
    id: 88,
    method: "tools/call",
    params: { name: "search", arguments: { query: "other" } },
  })
  await within(
    new Promise((resolve) => {
      const check = () => (calls.size === 2 ? resolve() : setImmediate(check))
      check()
    })
  )

  harness.send(
    { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 77 } },
    "\r\n"
  )
  await within(calls.get("cancelled").aborted.promise)
  assert.equal(calls.get("cancelled").signal.aborted, true)
  assert.equal(calls.get("other").signal.aborted, false)

  calls.get("cancelled").result.resolve({ content: [{ type: "text", text: "too late" }] })
  const ping = await harness.request({ jsonrpc: "2.0", id: 89, method: "ping" })
  assert.deepEqual(ping.result, {})
  assert.deepEqual(harness.reader.messages, [ping])

  await harness.server.close()
  assert.equal(calls.get("other").signal.aborted, true)
  calls.get("other").result.resolve({ content: [{ type: "text", text: "also too late" }] })
  await nextTurn()
  assert.deepEqual(harness.reader.messages, [ping])
  assertProtocolOnly(harness.reader, "")
})

for (const mode of ["stdin close", "repeated close"]) {
  test(`${mode} aborts active work, closes once, and suppresses late writes`, async (t) => {
    const started = deferred()
    const aborted = deferred()
    const closed = deferred()
    const result = deferred()
    let closeCount = 0
    let callSignal
    const router = {
      listTools: () => structuredClone(EXPECTED_TOOLS),
      callTool(_name, _args, { signal }) {
        callSignal = signal
        signal.addEventListener("abort", () => aborted.resolve(), { once: true })
        started.resolve()
        return result.promise
      },
      async close() {
        closeCount += 1
        closed.resolve()
      },
    }
    const harness = createHarness(t, ({ input, output }) =>
      createStdioMcpServer({ input, output, router })
    )
    harness.send({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "search", arguments: { query: mode } },
    })
    await within(started.promise)

    if (mode === "stdin close") {
      harness.input.end()
      await within(closed.promise)
      await harness.server.close()
      await harness.server.close()
    } else {
      const first = harness.server.close()
      const second = harness.server.close()
      assert.strictEqual(first, second)
      await Promise.all([first, second])
    }
    await within(aborted.promise)
    await within(closed.promise)
    assert.equal(callSignal.aborted, true)
    assert.equal(closeCount, 1)

    result.resolve({ content: [{ type: "text", text: "late close result" }] })
    await nextTurn()
    assert.deepEqual(harness.reader.messages, [])
    assertProtocolOnly(harness.reader, "")
  })
}

test("SIGTERM closes the real executable without non-protocol stdout", async (t) => {
  const processHandle = spawnEntry(t)
  const initialize = await processHandle.request({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {} },
  })
  assert.equal(initialize.result.protocolVersion, "2025-06-18")

  processHandle.child.kill("SIGTERM")
  const exit = await within(processHandle.exit)
  if (process.platform === "win32") {
    assert.ok(exit.code === 0 || exit.code === 1 || exit.signal === "SIGTERM")
  } else {
    assert.deepEqual(exit, { code: 0, signal: null })
  }
  assert.deepEqual(processHandle.reader.messages, [initialize])
  assertProtocolOnly(processHandle.reader, processHandle.stderr())
})

const ACTIVE_SIGTERM_HOOK_URL = `data:text/javascript,${encodeURIComponent(`
  const json = (message, result) => new Response(
    JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
    { status: 200, headers: { "content-type": "application/json" } },
  )

  process.on("message", (message) => {
    if (message?.type === "emit-sigterm") {
      process.emit("SIGTERM")
    }
  })

  globalThis.fetch = async (_url, init) => {
    const message = JSON.parse(init.body)
    if (message.method === "initialize") {
      return json(message, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "active-sigterm-fixture", version: "1.0.0" },
      })
    }
    if (message.method === "notifications/initialized") {
      return new Response(null, { status: 202 })
    }
    if (message.method === "tools/list") {
      return json(message, {
        tools: [{
          name: "web_search_exa",
          description: "Active SIGTERM fixture",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
        }],
      })
    }
    if (message.method === "tools/call") {
      return new Promise((resolve) => {
        const finishLateResult = () => {
          resolve(json(message, { content: [{ type: "text", text: "late backend result" }] }))
          if (process.connected) {
            process.disconnect()
          }
        }
        init.signal.addEventListener("abort", () => {
          process.send({ type: "backend-aborted" })
          setTimeout(() => {
            if (process.send) {
              process.send({ type: "backend-late-result" }, finishLateResult)
            } else {
              finishLateResult()
            }
          }, 25)
        }, { once: true })
        process.send({ type: "backend-started" })
      })
    }
    throw new Error("Unexpected fixture method")
  }
`)}`

test("SIGTERM aborts an active backend call and suppresses its late response", async (t) => {
  const child = spawn(process.execPath, ["--import", ACTIVE_SIGTERM_HOOK_URL, ENTRY], {
    env: { ...process.env, EXA_API_KEY: "", KEENABLE_API_KEY: "", YDC_API_KEY: "" },
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  })
  const reader = createMessageReader(child.stdout)
  const exit = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }))
  })
  const backendEvents = []
  child.on("message", (message) => backendEvents.push(message))
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
      await within(exit)
    }
  })

  const waitForBackendEvent = (type) => {
    if (backendEvents.some((event) => event.type === type)) {
      return Promise.resolve()
    }
    return within(
      new Promise((resolve) => {
        const onMessage = (event) => {
          if (event.type === type) {
            child.off("message", onMessage)
            resolve()
          }
        }
        child.on("message", onMessage)
      })
    )
  }

  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } })}\n`
  )
  const initialize = await reader.waitFor((message) => message.id === 1)
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search", arguments: { query: "active SIGTERM" } } })}\n`
  )
  await waitForBackendEvent("backend-started")

  if (process.platform === "win32") {
    child.send({ type: "emit-sigterm" })
  } else {
    child.kill("SIGTERM")
  }
  await waitForBackendEvent("backend-aborted")
  await waitForBackendEvent("backend-late-result")
  assert.deepEqual(await within(exit), { code: 0, signal: null })

  assert.deepEqual(
    backendEvents.map((event) => event.type),
    ["backend-started", "backend-aborted", "backend-late-result"]
  )
  assert.deepEqual(reader.messages, [initialize])
  assert.equal(
    reader.messages.some((message) => message.id === 2),
    false
  )
  assertProtocolOnly(reader, stderr)
})
