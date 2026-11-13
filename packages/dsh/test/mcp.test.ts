import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { Context } from "@deepseek-ai/cordis"

import { createHealthRecords } from "../dist/host/health.js"
import {
  createDshMcpManager,
  registerDshMcp,
  toDshMcpConfig,
} from "../dist/host/register-mcp.js"

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "stdio-mcp-server.mjs")

function healthyRecords() {
  return createHealthRecords(() => [])
}

function createFakeManager(existing = [], failures = new Set()) {
  const registrations = []
  return {
    registrations,
    has(name) {
      return existing.includes(name) || registrations.some((entry) => entry.name === name)
    },
    register(name, config) {
      if (failures.has(name)) throw new Error(`${name} registration exploded`)
      const entry = { name, config, disposed: false }
      registrations.push(entry)
      return {
        ready: Promise.resolve(),
        async dispose() {
          entry.disposed = true
        },
      }
    },
  }
}

async function withTimeout(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function protocolResponse(message) {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "omagents-local-http", version: "1.0.0" },
      },
    }
  }
  if (message.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Local HTTP handshake probe",
            inputSchema: { type: "object", properties: { text: { type: "string" } } },
          },
        ],
      },
    }
  }
  if (message.id !== undefined) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unsupported method: ${message.method}` },
    }
  }
  return undefined
}

async function startStreamableHttpServer(t) {
  const server = http.createServer((request, response) => {
    if (request.method === "GET") {
      response.writeHead(405, { Allow: "POST, DELETE" })
      response.end()
      return
    }
    if (request.method === "DELETE") {
      response.writeHead(200).end()
      return
    }
    if (request.method !== "POST") {
      response.writeHead(405).end()
      return
    }

    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk) => {
      body += chunk
    })
    request.on("end", () => {
      const message = body ? JSON.parse(body) : undefined
      if (!message || message.id === undefined) {
        response.writeHead(202).end()
        return
      }
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify(protocolResponse(message)))
    })
  })
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolveClose) => server.close(resolveClose))
  })
  const address = server.address()
  assert.ok(address && typeof address === "object")
  return `http://127.0.0.1:${address.port}/mcp`
}

function createToolContext(t) {
  const root = new Context()
  const tools = new Map()
  root.provide("tools", {
    register(definition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  })
  t.after(() => root.fiber.dispose())
  return { root, tools }
}

test("canonical MCP entries use DSH transports and never override existing names", async () => {
  const manager = createFakeManager(["context7"])
  const health = healthyRecords()
  const ctx = { mcpManager: manager }

  const dispose = registerDshMcp(
    ctx,
    { CONTEXT7_API_KEY: "context", EXA_API_KEY: "exa", GITHUB_TOKEN: "github" },
    health
  )

  assert.deepEqual(
    manager.registrations.map((entry) => entry.name),
    ["agentmemory", "codegraph", "websearch", "github"]
  )
  assert.equal(manager.registrations.some((entry) => entry.name === "context7"), false)
  assert.equal(manager.registrations.some((entry) => entry.name === "grep_app"), false)

  const stdio = manager.registrations.find((entry) => entry.name === "agentmemory").config
  assert.equal(stdio.transport, "stdio")
  assert.equal(stdio.command, "npx")
  assert.deepEqual(stdio.args, ["-y", "@agentmemory/mcp"])
  assert.equal(stdio.serverName, "agentmemory")
  assert.equal(stdio.failOnStartupError, true)

  const websearch = manager.registrations.find((entry) => entry.name === "websearch").config
  assert.equal(websearch.transport, "streamable-http")
  assert.equal(websearch.headers["x-api-key"], "exa")
  const github = manager.registrations.find((entry) => entry.name === "github").config
  assert.equal(github.headers.Authorization, "Bearer github")

  await dispose()
  assert.ok(manager.registrations.every((entry) => entry.disposed))
  assert.equal(health.mcp.status, "ready")
})

test("MCP registration failures are independent and visible in health", async () => {
  const manager = createFakeManager([], new Set(["codegraph"]))
  const health = healthyRecords()

  const dispose = registerDshMcp({ mcpManager: manager }, {}, health)

  assert.equal(manager.registrations.length, 4)
  assert.equal(health.mcp.status, "degraded")
  assert.match(health.mcp.diagnostics[0].message, /codegraph/)
  assert.equal(health.skills.status, "ready")
  assert.equal(health.python.status, "ready")
  assert.equal(health.host.status, "ready")
  await dispose()
})

test("DSH MCP adapter completes a real stdio handshake with a local server", async (t) => {
  const { root, tools } = createToolContext(t)
  const manager = createDshMcpManager(root)
  const config = toDshMcpConfig("stdio_test", {
    type: "local",
    command: [process.execPath, fixture],
  })

  const registration = manager.register("stdio_test", config)
  await withTimeout(registration.ready, "stdio MCP handshake")
  assert.ok(tools.has("mcp__stdio_test__echo"))

  await registration.dispose()
  assert.equal(tools.size, 0)
})

test("DSH MCP adapter completes a real Streamable HTTP handshake with a local server", async (t) => {
  const url = await startStreamableHttpServer(t)
  const { root, tools } = createToolContext(t)
  const manager = createDshMcpManager(root)
  const config = toDshMcpConfig("http_test", {
    type: "remote",
    url,
    oauth: false,
    headers: { "x-local-test": "omagents" },
  })

  const registration = manager.register("http_test", config)
  await withTimeout(registration.ready, "Streamable HTTP MCP handshake")
  assert.ok(tools.has("mcp__http_test__echo"))

  await registration.dispose()
  assert.equal(tools.size, 0)
})
