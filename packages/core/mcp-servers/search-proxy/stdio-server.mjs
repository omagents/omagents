const PROTOCOL_VERSION = "2025-06-18"
const SUPPORTED_TOOLS = new Set(["search", "fetch"])

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function createStdioMcpServer({ input, output, router }) {
  const activeCalls = new Map()
  let buffered = ""
  let closed = false
  let closePromise

  const write = (message) => {
    output.write(`${JSON.stringify(message)}\n`)
  }

  const respond = (id, result) => {
    write({ jsonrpc: "2.0", id, result })
  }

  const respondError = (id, code, message) => {
    write({ jsonrpc: "2.0", id, error: { code, message } })
  }

  const cancelCall = (entry) => {
    entry.cancelled = true
    if (!entry.controller.signal.aborted) {
      entry.controller.abort(new DOMException("The request was cancelled", "AbortError"))
    }
  }

  const runToolCall = async (message) => {
    const controller = new AbortController()
    const entry = { controller, cancelled: false }
    activeCalls.set(message.id, entry)
    const canRespond = () => !closed && !entry.cancelled && !controller.signal.aborted

    try {
      const result = await router.callTool(message.params.name, message.params.arguments ?? {}, {
        signal: controller.signal,
      })
      if (canRespond()) {
        respond(message.id, result)
      }
    } catch {
      if (canRespond()) {
        respondError(message.id, -32603, "Internal error")
      }
    } finally {
      if (activeCalls.get(message.id) === entry) {
        activeCalls.delete(message.id)
      }
    }
  }

  const handleRequest = (message) => {
    if (closed) {
      return
    }

    switch (message.method) {
      case "initialize":
        respond(message.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "omagents-search-proxy", version: "1.0.0" },
        })
        return
      case "ping":
        respond(message.id, {})
        return
      case "tools/list":
        try {
          respond(message.id, { tools: router.listTools() })
        } catch {
          respondError(message.id, -32603, "Internal error")
        }
        return
      case "tools/call":
        if (!isObject(message.params) || typeof message.params.name !== "string") {
          respondError(message.id, -32602, "Invalid tool call parameters")
          return
        }
        if (!SUPPORTED_TOOLS.has(message.params.name)) {
          respondError(message.id, -32602, "Unknown tool")
          return
        }
        void runToolCall(message)
        return
      default:
        respondError(message.id, -32601, "Method not found")
    }
  }

  const handleMessage = (message) => {
    if (!isObject(message)) {
      respondError(null, -32600, "Invalid Request")
      return
    }

    if (!Object.hasOwn(message, "id")) {
      if (message.method === "notifications/cancelled") {
        const entry = activeCalls.get(message.params?.requestId)
        if (entry) {
          cancelCall(entry)
        }
      }
      return
    }

    handleRequest(message)
  }

  const consumeLines = () => {
    let newline
    while (!closed && (newline = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, newline).replace(/\r$/, "")
      buffered = buffered.slice(newline + 1)
      if (line.trim() === "") {
        continue
      }
      try {
        handleMessage(JSON.parse(line))
      } catch {
        respondError(null, -32700, "Parse error")
      }
    }
  }

  const onData = (chunk) => {
    buffered += chunk
    consumeLines()
  }

  const close = () => {
    if (closePromise) {
      return closePromise
    }
    closed = true
    for (const entry of activeCalls.values()) {
      cancelCall(entry)
    }
    input.off("data", onData)
    input.off("end", onInputClose)
    input.off("close", onInputClose)
    input.off("error", onInputClose)
    input.pause()
    closePromise = Promise.resolve()
      .then(() => router.close())
      .then(() => {})
    return closePromise
  }

  const onInputClose = () => {
    void close().catch(() => {})
  }

  input.setEncoding("utf8")
  input.on("data", onData)
  input.on("end", onInputClose)
  input.on("close", onInputClose)
  input.on("error", onInputClose)

  return { close }
}
