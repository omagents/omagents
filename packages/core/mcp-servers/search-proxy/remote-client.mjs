import { ProxyFailure, classifyFailure, classifyJsonRpcError } from "./errors.mjs"

const ACCEPT_HEADER = "application/json, text/event-stream"
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-03-26", "2025-06-18"])

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function abortReason(signal) {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError")
}

function closedError() {
  return new Error("Remote MCP client is closed")
}

export class RemoteMcpClient {
  constructor({
    provider,
    url,
    headers = {},
    fetchImpl = globalThis.fetch,
    protocolVersion = "2025-06-18",
  }) {
    this.provider = provider
    this.url = url
    this.headers = headers
    this.fetchImpl = fetchImpl
    this.protocolVersion = protocolVersion
    this.sensitiveValues = Object.values(headers).filter(
      (value) => typeof value === "string" && value.length > 0
    )

    this.nextId = 0
    this.sessionId = null
    this.negotiatedProtocolVersion = null
    this.tools = null
    this.readiness = null
    this.generation = null
    this.activeRequests = new Set()
    this.closed = false
  }

  ensureReady({ signal } = {}) {
    if (signal?.aborted) {
      return Promise.reject(abortReason(signal))
    }
    if (this.closed) {
      return Promise.reject(closedError())
    }
    if (this.tools) {
      return Promise.resolve(this.tools)
    }
    if (!this.readiness) {
      const state = {
        generation: {},
        controller: new AbortController(),
        waiters: 0,
        promise: null,
      }
      this.readiness = state
      this.generation = state.generation
      state.promise = this.initialize(state)
    }

    const state = this.readiness
    state.waiters += 1
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort)
      }
      const settle = (callback, value) => {
        if (settled) {
          return
        }
        settled = true
        state.waiters -= 1
        cleanup()
        callback(value)
      }
      const onAbort = () => {
        if (settled) {
          return
        }
        settle(reject, abortReason(signal))
        if (state.waiters === 0 && this.readiness === state) {
          this.invalidate(state.generation)
        }
      }

      signal?.addEventListener("abort", onAbort, { once: true })
      state.promise.then(
        (tools) => settle(resolve, tools),
        (failure) => settle(reject, failure)
      )
      if (signal?.aborted) {
        onAbort()
      }
    })
  }

  async callTool({ name, arguments: toolArguments, signal }) {
    const cachedContext = this.tools
      ? {
          sessionId: this.sessionId,
          protocolVersion: this.negotiatedProtocolVersion,
          generation: this.generation,
        }
      : null
    await this.ensureReady({ signal })
    if (this.closed) {
      throw closedError()
    }
    const context = cachedContext ?? {
      sessionId: this.sessionId,
      protocolVersion: this.negotiatedProtocolVersion,
      generation: this.generation,
    }
    let response
    try {
      response = await this.rpc(
        "tools/call",
        { name, arguments: toolArguments ?? {} },
        { signal, context }
      )
    } catch (error) {
      throw this.withGeneration(error, context.generation)
    }
    return this.validateToolResult(response.result)
  }

  invalidate(expectedGeneration) {
    if (expectedGeneration !== undefined && this.generation !== expectedGeneration) {
      return false
    }
    this.generation = null
    this.tools = null
    this.sessionId = null
    this.negotiatedProtocolVersion = null
    const readiness = this.readiness
    this.readiness = null
    readiness?.controller.abort()
    return true
  }

  close() {
    if (this.closed) {
      return
    }
    this.closed = true
    this.invalidate()
    for (const controller of this.activeRequests) {
      controller.abort()
    }
  }

  async initialize(state) {
    try {
      this.tools = null
      this.sessionId = null
      this.negotiatedProtocolVersion = null
      const initialized = await this.rpc(
        "initialize",
        {
          protocolVersion: this.protocolVersion,
          capabilities: {},
          clientInfo: { name: "omagents-search-proxy", version: "1.0.0" },
        },
        { signal: state.controller.signal, initialize: true }
      )
      const negotiated = isObject(initialized.result)
        ? initialized.result.protocolVersion
        : undefined
      if (!SUPPORTED_PROTOCOL_VERSIONS.has(negotiated)) {
        throw this.protocolFailure()
      }
      const context = {
        sessionId: initialized.headers.get("mcp-session-id") || null,
        protocolVersion: negotiated,
      }
      if (this.readiness !== state || state.controller.signal.aborted || this.closed) {
        throw abortReason(state.controller.signal)
      }

      await this.rpc("notifications/initialized", undefined, {
        signal: state.controller.signal,
        notification: true,
        context,
      })
      const listed = await this.rpc("tools/list", {}, { signal: state.controller.signal, context })
      const tools = this.validateTools(listed.result)
      if (this.readiness !== state || state.controller.signal.aborted || this.closed) {
        throw abortReason(state.controller.signal)
      }
      this.negotiatedProtocolVersion = context.protocolVersion
      this.sessionId = context.sessionId
      this.tools = tools
      return tools
    } catch (error) {
      if (this.readiness === state) {
        this.tools = null
        this.sessionId = null
        this.negotiatedProtocolVersion = null
      }
      throw this.withGeneration(error, state.generation)
    } finally {
      if (this.readiness === state) {
        this.readiness = null
      }
    }
  }

  async rpc(
    method,
    params,
    { signal, initialize = false, notification = false, context = null } = {}
  ) {
    const id = notification ? undefined : ++this.nextId
    const message = { jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method }
    if (params !== undefined) {
      message.params = params
    }

    const controller = new AbortController()
    this.activeRequests.add(controller)
    const onAbort = () => controller.abort(abortReason(signal))
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
    }

    try {
      const headers = new Headers(this.headers)
      headers.set("accept", ACCEPT_HEADER)
      headers.set("content-type", "application/json")
      const sessionId = context ? context.sessionId : this.sessionId
      const protocolVersion = context ? context.protocolVersion : this.negotiatedProtocolVersion
      if (!initialize && sessionId) {
        headers.set("mcp-session-id", sessionId)
      }
      if (!initialize && protocolVersion) {
        headers.set("mcp-protocol-version", protocolVersion)
      }

      const fetchImpl = this.fetchImpl
      const response = await fetchImpl(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      })

      if (notification && response.status === 202) {
        response.body?.cancel().catch(() => {})
        return { result: undefined, headers: response.headers }
      }
      if (!response.ok) {
        response.body?.cancel().catch(() => {})
        const failure = new Error(`Remote MCP HTTP ${response.status}`)
        failure.status = response.status
        throw failure
      }

      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase()
      if (contentType === "application/json") {
        const text = await response.text()
        let payload
        try {
          payload = JSON.parse(text)
        } catch {
          throw this.protocolFailure()
        }
        return { result: this.validateMessage(payload, id), headers: response.headers }
      }
      if (contentType === "text/event-stream") {
        const payload = await this.readSse(response, id, controller.signal)
        return { result: this.validateMessage(payload, id), headers: response.headers }
      }
      response.body?.cancel().catch(() => {})
      throw this.protocolFailure()
    } catch (error) {
      if (controller.signal.aborted) {
        throw abortReason(controller.signal)
      }
      throw this.classify(error)
    } finally {
      signal?.removeEventListener("abort", onAbort)
      this.activeRequests.delete(controller)
    }
  }

  async readSse(response, id, signal) {
    if (!response.body?.getReader) {
      throw this.protocolFailure()
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let done = false
    let skipLeadingLf = false
    const onAbort = () => reader.cancel(abortReason(signal)).catch(() => {})
    signal.addEventListener("abort", onAbort, { once: true })

    const parseFrame = (frame) => {
      const data = []
      for (const line of frame.split(/\r\n|\n|\r/)) {
        if (!line || line.startsWith(":")) {
          continue
        }
        const colon = line.indexOf(":")
        const field = colon === -1 ? line : line.slice(0, colon)
        let value = colon === -1 ? "" : line.slice(colon + 1)
        if (value.startsWith(" ")) {
          value = value.slice(1)
        }
        if (field === "data") {
          data.push(value)
        }
      }
      if (data.length === 0) {
        return undefined
      }
      let payload
      try {
        payload = JSON.parse(data.join("\n"))
      } catch {
        throw this.protocolFailure()
      }
      return payload
    }

    try {
      while (!done) {
        const chunk = await reader.read()
        done = chunk.done
        buffer += decoder.decode(chunk.value, { stream: !done })
        if (skipLeadingLf && buffer) {
          skipLeadingLf = false
          if (buffer.startsWith("\n")) {
            buffer = buffer.slice(1)
          }
        }
        while (true) {
          const boundary = /(?:\r\n|\n|\r(?!\n)){2}/.exec(buffer)
          if (!boundary) {
            break
          }
          const trailingCr =
            !done &&
            boundary[0].endsWith("\r") &&
            boundary.index + boundary[0].length === buffer.length
          const frame = buffer.slice(0, boundary.index)
          buffer = buffer.slice(boundary.index + boundary[0].length)
          skipLeadingLf = trailingCr
          const payload = parseFrame(frame)
          if (payload?.id === id) {
            return payload
          }
        }
      }
      throw this.protocolFailure()
    } finally {
      signal.removeEventListener("abort", onAbort)
      if (!done) {
        reader.cancel().catch(() => {})
      }
    }
  }

  validateMessage(payload, id) {
    if (!isObject(payload) || payload.jsonrpc !== "2.0" || payload.id !== id) {
      throw this.protocolFailure()
    }
    const hasError = Object.hasOwn(payload, "error")
    const hasResult = Object.hasOwn(payload, "result")
    if (hasError === hasResult) {
      throw this.protocolFailure()
    }
    if (hasError) {
      const error = payload.error
      if (!isObject(error) || !Number.isInteger(error.code) || typeof error.message !== "string") {
        throw this.protocolFailure()
      }
      throw classifyJsonRpcError(error, {
        provider: this.provider,
        sensitiveValues: this.sensitiveValues,
      })
    }
    return payload.result
  }

  validateTools(result) {
    if (!isObject(result) || !Array.isArray(result.tools)) {
      throw this.protocolFailure()
    }
    for (const tool of result.tools) {
      if (
        !isObject(tool) ||
        typeof tool.name !== "string" ||
        !tool.name ||
        !isObject(tool.inputSchema)
      ) {
        throw this.protocolFailure()
      }
    }
    return result.tools
  }

  validateToolResult(result) {
    if (
      !isObject(result) ||
      !Array.isArray(result.content) ||
      (result.isError !== undefined && typeof result.isError !== "boolean")
    ) {
      throw this.protocolFailure()
    }
    for (const item of result.content) {
      if (
        !isObject(item) ||
        typeof item.type !== "string" ||
        !item.type ||
        (item.type === "text" && typeof item.text !== "string")
      ) {
        throw this.protocolFailure()
      }
    }
    return result
  }

  withGeneration(error, generation) {
    if (error !== null && (typeof error === "object" || typeof error === "function")) {
      try {
        Object.defineProperty(error, "sessionGeneration", {
          value: generation,
          configurable: true,
          writable: true,
        })
      } catch {
        // Non-extensible errors still retain their original classification.
      }
    }
    return error
  }

  protocolFailure() {
    return this.classify(
      Object.assign(new Error("Malformed remote MCP response"), { name: "ProtocolError" })
    )
  }

  classify(error) {
    if (error instanceof ProxyFailure) {
      return error
    }
    return classifyFailure(error, {
      provider: this.provider,
      sensitiveValues: this.sensitiveValues,
    })
  }
}
