import {
  createBackendConfigs,
  fetchInvocation,
  searchInvocation,
  validateFetchInput,
  validateSearchInput,
} from "./backends.mjs"
import { ProxyFailure, classifyFailure, classifyToolResult, redactText } from "./errors.mjs"
import { RemoteMcpClient } from "./remote-client.mjs"

export const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
  return value
}

export const SEARCH_PROXY_TOOLS = deepFreeze([
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
])

function abortReason(signal) {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError")
}

function timeoutError(provider) {
  const error = new Error(`${provider} backend attempt timed out`)
  error.name = "TimeoutError"
  return error
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function protocolFailure(provider) {
  return new ProxyFailure({
    code: "protocol",
    message: `${provider} protocol failure`,
    fallbackEligible: true,
  })
}

function invalidTool(name) {
  return new ProxyFailure({
    code: "invalid_params",
    message: `Unsupported generic tool: ${name}`,
    fallbackEligible: false,
  })
}

function failureSummary(provider, failure) {
  const code = typeof failure.code === "string" && failure.code ? failure.code : "backend_error"
  const status = Number.isInteger(failure.status) ? ` (HTTP ${failure.status})` : ""
  return `${provider} ${code} failure${status}`
}

function failureResult(failures, sensitiveValues) {
  const text = redactText(
    failures.map(({ provider, failure }) => failureSummary(provider, failure)).join("\n"),
    sensitiveValues
  )
  return { isError: true, content: [{ type: "text", text }] }
}

function successfulResult(result, provider, failures) {
  const fallbacks = failures.map(({ provider: from, failure }) => ({ from, code: failure.code }))
  const fallbackLines = fallbacks
    .map(({ from, code }) => `\nFallback: ${from} failed (${code})`)
    .join("")
  const omagents = { provider, fallback: fallbacks[0] ?? null }
  if (provider === "youcom" && fallbacks.length === 2) {
    omagents.fallbacks = fallbacks
  }
  return {
    ...result,
    content: [
      { type: "text", text: `Provider: ${provider}${fallbackLines}\n\n` },
      ...result.content,
    ],
    _meta: { ...result._meta, omagents },
  }
}

function validateBackendResult(result, provider, sensitiveValues) {
  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    !Array.isArray(result.content) ||
    (result.isError !== undefined && typeof result.isError !== "boolean") ||
    (result._meta !== undefined && !isObject(result._meta)) ||
    (result.structuredContent !== undefined && !isObject(result.structuredContent))
  ) {
    throw protocolFailure(provider)
  }
  if (result.isError === true) {
    throw classifyToolResult(result, { provider, sensitiveValues })
  }
  return result
}

function createAttempt(callerSignal, closeSignal, provider, attemptTimeoutMs) {
  const controller = new AbortController()
  const sources = [callerSignal, closeSignal].filter(Boolean)
  let rejectAborted
  const aborted = new Promise((_, reject) => {
    rejectAborted = reject
  })
  const onAbort = () => rejectAborted(abortReason(controller.signal))
  const onSourceAbort = (event) => controller.abort(abortReason(event.target))
  controller.signal.addEventListener("abort", onAbort, { once: true })
  for (const signal of sources) {
    signal.addEventListener("abort", onSourceAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(timeoutError(provider)), attemptTimeoutMs)
  for (const signal of sources) {
    if (signal.aborted) {
      controller.abort(abortReason(signal))
    }
  }

  return {
    signal: controller.signal,
    aborted,
    cleanup() {
      clearTimeout(timer)
      controller.signal.removeEventListener("abort", onAbort)
      for (const signal of sources) {
        signal.removeEventListener("abort", onSourceAbort)
      }
    },
  }
}

export function createSearchRouter({
  env = {},
  clientFactory = (config) => new RemoteMcpClient(config),
  attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
} = {}) {
  const configs = createBackendConfigs(env)
  const clients = {
    exa: clientFactory(configs.exa),
    keenable: clientFactory(configs.keenable),
    youcom: clientFactory(configs.youcom),
  }
  const closeController = new AbortController()
  let closed = false
  let closePromise

  const throwIfCancelled = (callerSignal) => {
    if (callerSignal?.aborted) {
      throw abortReason(callerSignal)
    }
    if (closed || closeController.signal.aborted) {
      throw abortReason(closeController.signal)
    }
  }

  const runAttempt = async (provider, kind, input, callerSignal, sensitiveValues) => {
    throwIfCancelled(callerSignal)
    const client = clients[provider]
    const attempt = createAttempt(callerSignal, closeController.signal, provider, attemptTimeoutMs)
    const operation = (async () => {
      const tools = await client.ensureReady({ signal: attempt.signal })
      const initialInvocation =
        kind === "search" ? searchInvocation(provider, input) : fetchInvocation(provider, input)
      const tool = tools.find((candidate) => candidate.name === initialInvocation.name)
      if (!tool) {
        throw protocolFailure(provider)
      }
      const invocation =
        kind === "search" ? searchInvocation(provider, input, tool.inputSchema) : initialInvocation
      const result = await client.callTool({ ...invocation, signal: attempt.signal })
      return validateBackendResult(result, provider, sensitiveValues)
    })()

    try {
      const result = await Promise.race([operation, attempt.aborted])
      return { result }
    } catch (error) {
      throwIfCancelled(callerSignal)
      const failure = classifyFailure(error, { provider, sensitiveValues })
      if (failure.code === "transport") {
        client.invalidate(error?.sessionGeneration)
      }
      return { failure }
    } finally {
      attempt.cleanup()
    }
  }

  return {
    listTools() {
      return structuredClone(SEARCH_PROXY_TOOLS)
    },

    async callTool(name, args, { signal } = {}) {
      throwIfCancelled(signal)
      const sensitiveValues = [
        env.EXA_API_KEY,
        env.KEENABLE_API_KEY,
        env.YDC_API_KEY,
        args?.query,
        args?.objective,
        args?.url,
      ]
      let kind
      let validate
      let invocationInput
      try {
        if (name === "search") {
          kind = "search"
          validate = validateSearchInput
        } else if (name === "fetch") {
          kind = "fetch"
          validate = validateFetchInput
        } else {
          throw invalidTool(name)
        }
        invocationInput = validate(args)
      } catch (error) {
        const failure = classifyFailure(error, { provider: "proxy", sensitiveValues })
        return failureResult([{ provider: "proxy", failure }], sensitiveValues)
      }

      const failures = []
      for (const provider of ["exa", "keenable", "youcom"]) {
        throwIfCancelled(signal)
        const attempt = await runAttempt(provider, kind, invocationInput, signal, sensitiveValues)
        throwIfCancelled(signal)
        if (attempt.result) {
          return successfulResult(attempt.result, provider, failures)
        }
        failures.push({ provider, failure: attempt.failure })
        if (!attempt.failure.fallbackEligible) {
          break
        }
      }
      return failureResult(failures, sensitiveValues)
    },

    close() {
      if (closePromise) {
        return closePromise
      }
      closed = true
      closeController.abort(new DOMException("Search proxy is closed", "AbortError"))
      closePromise = Promise.all(
        Object.values(clients).map(async (client) => {
          await client.close()
        })
      ).then(() => {})
      return closePromise
    },
  }
}
