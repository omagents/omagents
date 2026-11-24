import { test } from "node:test"
import assert from "node:assert/strict"

import {
  createBackendConfigs,
  fetchInvocation,
  searchInvocation,
  validateFetchInput,
  validateSearchInput,
} from "../mcp-servers/search-proxy/backends.mjs"
import { ProxyFailure } from "../mcp-servers/search-proxy/errors.mjs"

function assertInvalid(run) {
  assert.throws(run, (failure) => {
    assert.ok(failure instanceof ProxyFailure)
    assert.equal(failure.code, "invalid_params")
    assert.equal(failure.fallbackEligible, false)
    return true
  })
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
  return value
}

test("keyless backend configs are anonymous and include all providers", () => {
  assert.deepEqual(createBackendConfigs(), {
    exa: {
      provider: "exa",
      url: "https://mcp.exa.ai/mcp",
      headers: {},
    },
    keenable: {
      provider: "keenable",
      url: "https://api.keenable.ai/mcp-public",
      headers: {},
    },
    youcom: {
      provider: "youcom",
      url: "https://api.you.com/mcp/free",
      headers: {},
    },
  })
})

test("backend credentials set only their own headers and keyed Keenable endpoint", () => {
  assert.deepEqual(
    createBackendConfigs({
      EXA_API_KEY: "exa-secret",
      KEENABLE_API_KEY: "keenable-secret",
      OMAGENTS_SEARCH_PROVIDER: "keenable",
    }),
    {
      exa: {
        provider: "exa",
        url: "https://mcp.exa.ai/mcp",
        headers: { "x-api-key": "exa-secret" },
      },
      keenable: {
        provider: "keenable",
        url: "https://api.keenable.ai/mcp",
        headers: { "X-API-Key": "keenable-secret" },
      },
      youcom: {
        provider: "youcom",
        url: "https://api.you.com/mcp/free",
        headers: {},
      },
    }
  )

  const exaOnly = createBackendConfigs({ EXA_API_KEY: "exa-secret" })
  assert.deepEqual(exaOnly.keenable, {
    provider: "keenable",
    url: "https://api.keenable.ai/mcp-public",
    headers: {},
  })

  const keenableOnly = createBackendConfigs({ KEENABLE_API_KEY: "keenable-secret" })
  assert.deepEqual(keenableOnly.exa, {
    provider: "exa",
    url: "https://mcp.exa.ai/mcp",
    headers: {},
  })
})

test("You.com backend configs select keyed and keyless endpoints", () => {
  const keyless = createBackendConfigs({
    EXA_API_KEY: "exa-secret",
    KEENABLE_API_KEY: "keenable-secret",
  })
  const keyed = createBackendConfigs({
    EXA_API_KEY: "exa-secret",
    KEENABLE_API_KEY: "keenable-secret",
    YDC_API_KEY: "ydc-secret",
  })

  assert.deepEqual(keyless.youcom, {
    provider: "youcom",
    url: "https://api.you.com/mcp/free",
    headers: {},
  })
  assert.deepEqual(keyed.youcom, {
    provider: "youcom",
    url: "https://api.you.com/mcp",
    headers: { Authorization: "Bearer ydc-secret" },
  })
  assert.deepEqual(keyed.exa, {
    provider: "exa",
    url: "https://mcp.exa.ai/mcp",
    headers: { "x-api-key": "exa-secret" },
  })
  assert.deepEqual(keyed.keenable, {
    provider: "keenable",
    url: "https://api.keenable.ai/mcp",
    headers: { "X-API-Key": "keenable-secret" },
  })
})

test("search validation supplies defaults and retains a supplied objective", () => {
  assert.deepEqual(validateSearchInput({ query: "proxy routing" }), {
    query: "proxy routing",
    maxResults: 10,
  })
  assert.deepEqual(
    validateSearchInput({ query: "proxy routing", objective: "current documentation" }),
    {
      query: "proxy routing",
      objective: "current documentation",
      maxResults: 10,
    }
  )
  assert.deepEqual(validateSearchInput({ query: "proxy routing", maxResults: 25 }), {
    query: "proxy routing",
    maxResults: 25,
  })
})

test("search validation accepts inclusive result and objective boundaries", () => {
  const objective = "x".repeat(1_000)
  assert.deepEqual(validateSearchInput({ query: "minimum", objective, maxResults: 1 }), {
    query: "minimum",
    objective,
    maxResults: 1,
  })
  assert.deepEqual(validateSearchInput({ query: "maximum", maxResults: 50 }), {
    query: "maximum",
    maxResults: 50,
  })
})

test("search validation rejects malformed objects, unknown properties, and invalid text", () => {
  const cases = [
    null,
    [],
    "proxy routing",
    {},
    { query: 42 },
    { query: " \n\t " },
    { query: "valid", objective: 42 },
    { query: "valid", objective: " \n " },
    { query: "valid", objective: "x".repeat(1_001) },
    { query: "valid", unknown: true },
    { query: "valid", mode: "fast" },
  ]

  for (const value of cases) {
    assertInvalid(() => validateSearchInput(value))
  }
})

test("search validation rejects non-integer and out-of-range result counts", () => {
  for (const maxResults of [0, 51, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10", null]) {
    assertInvalid(() => validateSearchInput({ query: "valid", maxResults }))
  }
})

test("Exa search mapping handles required, optional, and absent objective schemas without mutation", () => {
  const requiredSchema = deepFreeze({
    type: "object",
    properties: { query: { type: "string" }, objective: { type: "string" } },
    required: ["query", "objective"],
  })
  const optionalSchema = deepFreeze({
    type: "object",
    properties: { query: { type: "string" }, objective: { type: "string" } },
    required: ["query"],
  })
  const suppliedInput = deepFreeze({
    query: "proxy docs",
    objective: "recent references",
    maxResults: 5,
  })

  assert.deepEqual(searchInvocation("exa", suppliedInput, requiredSchema), {
    name: "web_search_exa",
    arguments: { query: "proxy docs", objective: "recent references", numResults: 5 },
  })
  assert.deepEqual(searchInvocation("exa", deepFreeze({ query: "proxy docs" }), requiredSchema), {
    name: "web_search_exa",
    arguments: { query: "proxy docs", objective: "proxy docs", numResults: 10 },
  })
  assert.deepEqual(searchInvocation("exa", deepFreeze({ query: "proxy docs" }), optionalSchema), {
    name: "web_search_exa",
    arguments: { query: "proxy docs", numResults: 10 },
  })
  assert.deepEqual(searchInvocation("exa", suppliedInput, optionalSchema), {
    name: "web_search_exa",
    arguments: { query: "proxy docs", objective: "recent references", numResults: 5 },
  })
  assert.deepEqual(searchInvocation("exa", suppliedInput), {
    name: "web_search_exa",
    arguments: { query: "proxy docs", numResults: 5 },
  })
})

test("Keenable search mapping forwards objective and uses max_results without a mode", () => {
  assert.deepEqual(
    searchInvocation(
      "keenable",
      deepFreeze({ query: "proxy docs", objective: "recent references" })
    ),
    {
      name: "search_web_pages",
      arguments: { query: "proxy docs", objective: "recent references", max_results: 10 },
    }
  )
  assert.deepEqual(
    searchInvocation("keenable", deepFreeze({ query: "proxy docs", maxResults: 50 })),
    {
      name: "search_web_pages",
      arguments: { query: "proxy docs", max_results: 50 },
    }
  )
})

test("fetch validation accepts one HTTP(S) URL and an optional positive character count", () => {
  assert.deepEqual(validateFetchInput({ url: "https://example.com/article?a=1" }), {
    url: "https://example.com/article?a=1",
  })
  assert.deepEqual(validateFetchInput({ url: "http://example.com/article", maxCharacters: 1 }), {
    url: "http://example.com/article",
    maxCharacters: 1,
  })
})

test("fetch validation rejects unknown properties and invalid or non-HTTP(S) URLs", () => {
  const cases = [
    null,
    [],
    {},
    { url: 42 },
    { url: "" },
    { url: "example.com/article" },
    { url: "https://" },
    { url: "ftp://example.com/article" },
    { url: "mailto:user@example.com" },
    { url: "https://example.com/article", urls: ["https://example.com/other"] },
    { url: "https://example.com/article", unknown: true },
  ]

  for (const value of cases) {
    assertInvalid(() => validateFetchInput(value))
  }
})

test("fetch validation rejects non-positive and non-integer character counts", () => {
  for (const maxCharacters of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "100", null]) {
    assertInvalid(() => validateFetchInput({ url: "https://example.com/article", maxCharacters }))
  }
})

test("fetch mappings use one fresh URL array and provider-specific character fields", () => {
  const input = deepFreeze({ url: "https://example.com/article", maxCharacters: 12_000 })
  const exa = fetchInvocation("exa", input)
  const anotherExa = fetchInvocation("exa", input)

  assert.deepEqual(exa, {
    name: "web_fetch_exa",
    arguments: { urls: ["https://example.com/article"], maxCharacters: 12_000 },
  })
  assert.notStrictEqual(exa.arguments, anotherExa.arguments)
  assert.notStrictEqual(exa.arguments.urls, anotherExa.arguments.urls)
  assert.deepEqual(fetchInvocation("exa", deepFreeze({ url: "https://example.com/article" })), {
    name: "web_fetch_exa",
    arguments: { urls: ["https://example.com/article"] },
  })
  assert.deepEqual(fetchInvocation("keenable", input), {
    name: "fetch_page_content",
    arguments: { urls: ["https://example.com/article"], max_chars: 12_000 },
  })
  assert.deepEqual(
    fetchInvocation("keenable", deepFreeze({ url: "https://example.com/article" })),
    {
      name: "fetch_page_content",
      arguments: { urls: ["https://example.com/article"] },
    }
  )
})

test("You.com mappings omit unsupported generic hints", () => {
  assert.deepEqual(
    searchInvocation(
      "youcom",
      deepFreeze({ query: "proxy docs", objective: "ignored hint", maxResults: 50 })
    ),
    {
      name: "you-search",
      arguments: { query: "proxy docs", count: 50 },
    }
  )

  const url = "https://example.com/article"
  assert.deepEqual(fetchInvocation("youcom", deepFreeze({ url, maxCharacters: 12_000 })), {
    name: "you-extract",
    arguments: { url },
  })
})

test("invocation adapters enforce generic validation before producing backend arguments", () => {
  for (const provider of ["exa", "keenable", "youcom"]) {
    assertInvalid(() => searchInvocation(provider, { query: "valid", unknown: true }))
    assertInvalid(() =>
      fetchInvocation(provider, { url: "https://example.com/article", maxCharacters: 0 })
    )
  }
})
