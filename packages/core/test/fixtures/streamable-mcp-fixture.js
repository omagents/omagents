import http from "node:http"

const DEFAULT_TOOLS = [
  {
    name: "search",
    description: "Search the local fixture",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
]

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers })
  res.end(JSON.stringify(payload))
}

function sendSse(res, payload, headers = {}) {
  res.writeHead(200, { "content-type": "text/event-stream", ...headers })
  res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
}

export async function createMcpHttpFixture(options = {}) {
  const requests = []
  const sockets = new Set()
  const protocolVersion = options.protocolVersion ?? "2025-06-18"
  const tools = options.tools ?? DEFAULT_TOOLS
  const sseMethods = new Set(options.sseMethods ?? [])

  const server = http.createServer(async (req, res) => {
    const chunks = []
    let record
    try {
      for await (const chunk of req) {
        chunks.push(chunk)
      }
      const rawBody = Buffer.concat(chunks).toString("utf8")
      let body
      try {
        body = rawBody ? JSON.parse(rawBody) : undefined
      } catch {
        body = undefined
      }
      record = { method: req.method, url: req.url, headers: { ...req.headers }, body, rawBody }
      requests.push(record)
      res.on("finish", () => {
        record.status = res.statusCode
      })
      res.on("close", () => {
        record.closedBeforeEnd = !res.writableEnded
      })

      const context = { req, res, body, rawBody, record, requests }
      if (options.onRequest) {
        const custom = await options.onRequest(context)
        if (custom === true) {
          return
        }
        if (custom) {
          const headers = { ...custom.headers }
          const responseBody =
            typeof custom.body === "string" || Buffer.isBuffer(custom.body)
              ? custom.body
              : JSON.stringify(custom.body)
          if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
            headers["content-type"] = "application/json"
          }
          res.writeHead(custom.status ?? 200, headers)
          res.end(responseBody)
          return
        }
      }

      if (req.method !== "POST" || !body || body.jsonrpc !== "2.0") {
        sendJson(res, 400, { error: "expected a JSON-RPC POST" })
        return
      }
      if (body.method === "notifications/initialized") {
        res.writeHead(202)
        res.end()
        return
      }

      const respond = (result) => {
        const payload = { jsonrpc: "2.0", id: body.id, result }
        const sessionHeader =
          body.method === "initialize" && options.sessionId !== undefined
            ? {
                "mcp-session-id":
                  typeof options.sessionId === "function" ? options.sessionId() : options.sessionId,
              }
            : {}
        if (sseMethods.has(body.method)) {
          sendSse(res, payload, sessionHeader)
        } else {
          sendJson(res, 200, payload, sessionHeader)
        }
      }

      if (body.method === "initialize") {
        respond({
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "streamable-mcp-fixture", version: "1.0.0" },
        })
      } else if (body.method === "tools/list") {
        respond({ tools: typeof tools === "function" ? tools() : tools })
      } else if (body.method === "tools/call") {
        const result = options.callTool
          ? await options.callTool(body.params, context)
          : { content: [{ type: "text", text: options.toolText ?? "fixture result" }] }
        respond(result)
      } else {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: "Method not found" },
        })
      }
    } catch (error) {
      if (record) {
        record.handlerError = error.message
      }
      if (!res.headersSent && !res.destroyed) {
        sendJson(res, 500, { error: "fixture handler failed" })
      } else if (!res.writableEnded && !res.destroyed) {
        res.end()
      }
    }
  })

  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  let closePromise
  const close = () => {
    if (!closePromise) {
      closePromise = new Promise((resolve) => {
        server.close(resolve)
        for (const socket of sockets) {
          socket.destroy()
        }
      })
    }
    return closePromise
  }

  return { url: `http://127.0.0.1:${address.port}/mcp`, requests, close }
}
