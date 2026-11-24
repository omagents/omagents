import { test } from "node:test"
import assert from "node:assert/strict"

import {
  ProxyFailure,
  classifyFailure,
  classifyToolResult,
  redactText,
} from "../mcp-servers/search-proxy/errors.mjs"

function httpError(status, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { status })
}

function toolError(text) {
  return {
    isError: true,
    content: [{ type: "text", text }],
  }
}

function assertCategory(failure, code, fallbackEligible, status) {
  assert.ok(failure instanceof ProxyFailure)
  assert.equal(failure.code, code)
  assert.equal(failure.fallbackEligible, fallbackEligible)
  if (status === undefined) {
    assert.equal(failure.status, undefined)
  } else {
    assert.equal(failure.status, status)
  }
}

test("ProxyFailure exposes stable fields and classifiers preserve existing failures", () => {
  const existing = new ProxyFailure({
    code: "protocol",
    message: "exa protocol failure",
    fallbackEligible: true,
    status: 503,
  })

  assert.equal(existing.name, "ProxyFailure")
  assert.equal(existing.message, "exa protocol failure")
  assert.equal(classifyFailure(existing, { provider: "keenable" }), existing)
  assertCategory(existing, "protocol", true, 503)

  const withoutStatus = new ProxyFailure({
    code: "invalid_params",
    message: "invalid generic arguments",
    fallbackEligible: false,
  })
  assert.equal(Object.hasOwn(withoutStatus, "status"), false)
})

test("fallback-eligible structured HTTP statuses use stable codes", () => {
  for (const status of [408, 429, 503]) {
    assertCategory(classifyFailure(httpError(status), { provider: "exa" }), `http_${status}`, true, status)
  }

  const nested = new Error("backend response")
  nested.response = { status: 503 }
  assertCategory(classifyFailure(nested, { provider: "exa" }), "http_503", true, 503)
})

test("known non-fallback structured HTTP statuses do not fall back", () => {
  for (const status of [400, 401, 403, 422]) {
    assertCategory(classifyFailure(httpError(status), { provider: "exa" }), `http_${status}`, false, status)
  }
})

test("tool and page 404 do not fall back but session 404 is transport", () => {
  assertCategory(
    classifyToolResult(toolError("HTTP 404: target page was not found"), { provider: "exa" }),
    "http_404",
    false,
    404,
  )
  assertCategory(classifyFailure(httpError(404), { provider: "exa" }), "transport", true, 404)
})

test("unprefixed textual HTTP statuses classify explicitly without matching arbitrary numbers", () => {
  const cases = [
    ["404 Not Found", "http_404", 404],
    ["400 Bad Request", "http_400", 400],
    ["422 Unprocessable Entity", "http_422", 422],
    ["status: 404", "http_404", 404],
  ]
  for (const [text, code, status] of cases) {
    assertCategory(classifyToolResult(toolError(text), { provider: "exa" }), code, false, status)
  }

  assertCategory(
    classifyToolResult(toolError("The backend returned 400 items"), { provider: "exa" }),
    "backend_error",
    true,
  )
})

test("explicit retryability markers control otherwise unknown tool errors", () => {
  assertCategory(
    classifyToolResult(toolError("Temporary backend failure; Retryable: yes"), { provider: "exa" }),
    "backend_error",
    true,
  )
  assertCategory(
    classifyToolResult(toolError("Permanent backend failure; Retryable: no"), { provider: "exa" }),
    "backend_error",
    false,
  )
})

test("Retryable no takes precedence over fallback status heuristics", () => {
  const failure = classifyToolResult(toolError("HTTP 500; Retryable: no"), { provider: "exa" })
  assertCategory(failure, "backend_error", false, 500)
  assert.equal(failure.message.includes("HTTP 500"), true)
  assert.equal(failure.message.includes("Retryable"), false)
})

test("unknown tool errors fall back but explicit client failures do not", () => {
  assertCategory(
    classifyToolResult(toolError("The backend could not complete this operation"), { provider: "exa" }),
    "backend_error",
    true,
  )

  const cases = [
    ["Authentication failed: invalid API key", "authentication"],
    ["Invalid credentials supplied", "authentication"],
    ["Permission denied for this resource", "permission"],
    ["Authorization failed for this resource", "permission"],
    ["Invalid parameter: maxResults", "invalid_params"],
  ]
  for (const [text, code] of cases) {
    assertCategory(classifyToolResult(toolError(text), { provider: "exa" }), code, false)
  }

  assertCategory(
    classifyToolResult(toolError("HTTP 503; Authentication failed: invalid API key"), { provider: "exa" }),
    "authentication",
    false,
    503,
  )
})

test("explicit failure and error wordings remain non-fallback", () => {
  const cases = [
    ["Authentication failure", "authentication"],
    ["Authentication error", "authentication"],
    ["Permission failure", "permission"],
    ["Permission error", "permission"],
    ["Parameter error", "invalid_params"],
    ["Parameter failure", "invalid_params"],
  ]
  for (const [text, code] of cases) {
    assertCategory(classifyToolResult(toolError(text), { provider: "exa" }), code, false)
  }
})

test("temporary unavailable and rate-limit tool errors fall back", () => {
  for (const text of ["Temporary backend failure", "Service unavailable", "Rate limit exceeded"]) {
    assertCategory(classifyToolResult(toolError(text), { provider: "exa" }), "backend_error", true)
  }
})

test("transport protocol and timeout failures retain stable codes", () => {
  const transport = Object.assign(new Error("socket closed"), { code: "ECONNRESET" })
  const protocol = new Error("malformed backend response")
  protocol.name = "ProtocolError"
  const timeout = new Error("attempt deadline expired")
  timeout.name = "TimeoutError"

  assertCategory(classifyFailure(transport, { provider: "exa" }), "transport", true)
  assertCategory(classifyFailure(protocol, { provider: "exa" }), "protocol", true)
  assertCategory(classifyFailure(timeout, { provider: "exa" }), "timeout", true)
})

test("redaction removes secrets and bounds public error text", () => {
  const exaKey = "exa-live-[secret]-123456789"
  const keenableKey = "keenable-live-(secret)-987654321"
  const query = "confidential [query] with (literal) characters?"
  const objective = "rank private acquisition targets"
  const targetUrl = "https://private.example.test/path?a=1&b=two"
  const bearerSecret = "unconfigured-bearer-secret"
  const lowerHeaderSecret = "unconfigured-lower-header-secret"
  const upperHeaderSecret = "unconfigured-upper-header-secret"
  const input = [
    `EXA_API_KEY=${exaKey}`,
    `KEENABLE_API_KEY=${keenableKey}`,
    `query=${query}`,
    `objective=${objective}`,
    `target=${targetUrl}`,
    `Authorization: Bearer ${bearerSecret}`,
    `x-api-key: ${lowerHeaderSecret}`,
    `X-API-Key: ${upperHeaderSecret}`,
    "public-filler-".repeat(100),
  ].join("\n")

  const redacted = redactText(input, [exaKey, keenableKey, query, objective, targetUrl])

  for (const sensitive of [
    exaKey,
    keenableKey,
    query,
    objective,
    targetUrl,
    bearerSecret,
    lowerHeaderSecret,
    upperHeaderSecret,
    "Authorization: Bearer",
    "x-api-key",
    "X-API-Key",
  ]) {
    assert.equal(redacted.includes(sensitive), false, `leaked ${sensitive}`)
  }
  assert.equal(redacted.includes("[redacted]"), true)
  assert.ok(redacted.length <= 500)
})

test("API key assignment variants redact unconfigured secrets from text and ProxyFailure", () => {
  const secrets = [
    "unconfigured-underscore-colon-secret",
    "unconfigured-underscore-equals-secret",
    "unconfigured-camel-equals-secret",
  ]
  const input = [`api_key: ${secrets[0]}`, `api_key=${secrets[1]}`, `apiKey=${secrets[2]}`].join("\n")
  const failure = new ProxyFailure({
    code: "backend_error",
    message: input,
    fallbackEligible: true,
  })

  for (const publicText of [redactText(input), failure.message]) {
    for (const secret of secrets) {
      assert.equal(publicText.includes(secret), false, `leaked ${secret}`)
    }
    assert.equal(publicText.includes("[redacted]"), true)
  }
})

test("public messages use summaries without backend bodies or cause objects", () => {
  const exaKey = "exa-summary-secret"
  const query = "summary private query"
  const objective = "summary private objective"
  const targetUrl = "https://summary-private.example.test/article"
  const rawBody = `raw backend body ${exaKey} ${query} ${objective} ${targetUrl}`
  const error = httpError(503, rawBody)
  error.cause = { exaKey, query, objective, targetUrl }
  error.request = { query, objective, targetUrl }

  const httpFailure = classifyFailure(error, {
    provider: "exa",
    sensitiveValues: [exaKey, query, objective, targetUrl],
  })
  const toolFailure = classifyToolResult(toolError(rawBody), {
    provider: "keenable",
    sensitiveValues: [exaKey, query, objective, targetUrl],
  })

  assert.equal(httpFailure.message, "exa http_503 failure (HTTP 503)")
  assert.equal(toolFailure.message, "keenable backend_error failure")
  for (const failure of [httpFailure, toolFailure]) {
    for (const sensitive of [exaKey, query, objective, targetUrl, "raw backend body", "[object Object]"]) {
      assert.equal(failure.message.includes(sensitive), false)
    }
    assert.ok(failure.message.length <= 500)
    assert.equal(Object.hasOwn(failure, "cause"), false)
    assert.equal(Object.hasOwn(failure, "request"), false)
    assert.equal(Object.hasOwn(failure, "response"), false)
  }
})
