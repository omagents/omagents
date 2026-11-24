const MAX_PUBLIC_TEXT_LENGTH = 500
const MAX_BACKEND_TEXT_LENGTH = 4_000
const REDACTED = "[redacted]"

const CREDENTIAL_PATTERNS = [
  /["']?\bauthorization\b["']?\s*:\s*(?:bearer\s+)?(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;}]+)/gi,
  /["']?\b(?:x-api-key|api[_-]?key)\b["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;}]+)/gi,
  /\bhttps?:\/\/[^\s/@]+:[^\s/@]+@[^\s<>"']+/gi,
  /\bhttps?:\/\/[^\s<>"']*(?:api[_-]?key|access[_-]?token|token)=[^\s<>"']*/gi,
]

const NON_FALLBACK_STATUSES = new Set([400, 401, 403, 422])

export class ProxyFailure extends Error {
  constructor({ code, message, fallbackEligible, status } = {}) {
    super(redactText(message))
    this.name = "ProxyFailure"
    this.code = code
    this.fallbackEligible = fallbackEligible
    if (status !== undefined) {
      this.status = status
    }
  }
}

export function redactText(value, sensitiveValues = []) {
  let text = String(value ?? "")

  const configuredValues = sensitiveValues
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((left, right) => right.length - left.length)
  for (const sensitive of configuredValues) {
    text = text.split(sensitive).join(REDACTED)
  }

  for (const pattern of CREDENTIAL_PATTERNS) {
    text = text.replace(pattern, REDACTED)
  }

  return text.slice(0, MAX_PUBLIC_TEXT_LENGTH)
}

export function classifyFailure(error, { provider, sensitiveValues = [] } = {}) {
  if (error instanceof ProxyFailure) {
    return error
  }
  return classify(error, errorText(error), { provider, sensitiveValues, toolResult: false })
}

export function classifyToolResult(result, { provider, sensitiveValues = [] } = {}) {
  return classify(result, toolResultText(result), { provider, sensitiveValues, toolResult: true })
}

export function classifyJsonRpcError(error, { provider, sensitiveValues = [] } = {}) {
  return classify(error, jsonRpcErrorText(error), { provider, sensitiveValues, toolResult: true })
}

function classify(value, text, { provider, sensitiveValues, toolResult }) {
  const status = structuredStatus(value) ?? textStatus(text)
  const options = { provider, sensitiveValues, status }

  if (/\bretryable\s*:\s*no\b/i.test(text)) {
    return publicFailure("backend_error", false, options)
  }

  const knownCategory =
    knownNonFallbackCategory(text) ?? (value?.code === -32602 ? "invalid_params" : undefined)
  if (knownCategory) {
    return publicFailure(knownCategory, false, options)
  }

  if (status !== undefined) {
    if (!toolResult && status === 404) {
      return publicFailure("transport", true, options)
    }
    if (status === 404 || NON_FALLBACK_STATUSES.has(status)) {
      return publicFailure(`http_${status}`, false, options)
    }
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
      return publicFailure(`http_${status}`, true, options)
    }
  }

  if (
    /\bretryable\s*:\s*yes\b/i.test(text) ||
    /\b(?:temporary|temporarily unavailable|service unavailable|rate[ -]?limit(?:ed|ing)?)\b/i.test(
      text
    )
  ) {
    return publicFailure("backend_error", true, options)
  }

  if (toolResult) {
    return publicFailure("backend_error", true, options)
  }

  const errorType = `${value?.name ?? ""} ${value?.code ?? ""}`
  if (
    /\b(?:TimeoutError|ETIMEDOUT)\b/i.test(errorType) ||
    /\b(?:timeout|timed out|deadline exceeded)\b/i.test(text)
  ) {
    return publicFailure("timeout", true, options)
  }
  if (
    /\b(?:ProtocolError|MCP_PROTOCOL_ERROR|ERR_MCP_PROTOCOL)\b/i.test(errorType) ||
    /\b(?:protocol|malformed(?:\s+\w+)*\s+response|unexpected content[ -]type)\b/i.test(text)
  ) {
    return publicFailure("protocol", true, options)
  }
  return publicFailure("transport", true, options)
}

function publicFailure(code, fallbackEligible, { provider, sensitiveValues, status }) {
  const providerLabel =
    typeof provider === "string" && provider.trim() ? provider.trim() : "backend"
  const statusSummary = status === undefined ? "" : ` (HTTP ${status})`
  return new ProxyFailure({
    code,
    message: redactText(`${providerLabel} ${code} failure${statusSummary}`, sensitiveValues),
    fallbackEligible,
    ...(status === undefined ? {} : { status }),
  })
}

function structuredStatus(value) {
  const candidates = [
    value?.status,
    value?.statusCode,
    value?.response?.status,
    value?.cause?.status,
    value?.data?.status,
    value?.data?.statusCode,
    value?.data?.response?.status,
  ]
  for (const candidate of candidates) {
    const status = Number(candidate)
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      return status
    }
  }
  return undefined
}

function textStatus(text) {
  const match =
    /\bHTTP\s*[:/]?\s*(\d{3})\b/i.exec(text) ??
    /\bstatus\s*:\s*(\d{3})\b/i.exec(text) ??
    /\b(\d{3})\s+(?:Bad Request|Not Found|Unprocessable Entity)\b/i.exec(text)
  if (!match) {
    return undefined
  }
  const status = Number(match[1])
  return status >= 100 && status <= 599 ? status : undefined
}

function errorText(error) {
  if (typeof error === "string") {
    return error.slice(0, MAX_BACKEND_TEXT_LENGTH)
  }
  return typeof error?.message === "string" ? error.message.slice(0, MAX_BACKEND_TEXT_LENGTH) : ""
}

function toolResultText(result) {
  if (!Array.isArray(result?.content)) {
    return ""
  }
  return result.content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .slice(0, MAX_BACKEND_TEXT_LENGTH)
}

function jsonRpcErrorText(error) {
  const parts = []
  if (typeof error?.message === "string") {
    parts.push(error.message)
  }
  if (error?.data !== undefined) {
    if (typeof error.data === "string") {
      parts.push(error.data)
    } else {
      try {
        const serialized = JSON.stringify(error.data)
        if (serialized !== undefined) {
          parts.push(serialized)
        }
      } catch {
        // Unserializable backend data cannot contribute classification markers.
      }
    }
  }
  return parts.join("\n").slice(0, MAX_BACKEND_TEXT_LENGTH)
}

function knownNonFallbackCategory(text) {
  if (
    /\b(?:auth(?:entication)?\s+(?:failed|failure|error)|unauthenticated|unauthorized|invalid\s+credentials|invalid(?:\s+\w+)?\s+api[ -]?key|api[ -]?key\s+(?:is\s+)?invalid)\b/i.test(
      text
    )
  ) {
    return "authentication"
  }
  if (
    /\b(?:permissions?\s+(?:denied|failed|failure|error)|forbidden|access\s+denied|not\s+authorized|authorization\s+(?:failed|failure|error)|insufficient\s+permissions?)\b/i.test(
      text
    )
  ) {
    return "permission"
  }
  if (
    /\b(?:invalid\s+(?:parameter|parameters|params|argument|arguments|request)|parameters?\s+(?:failure|error)|missing\s+(?:required\s+)?(?:parameter|argument)|validation\s+error)\b/i.test(
      text
    )
  ) {
    return "invalid_params"
  }
  return undefined
}
