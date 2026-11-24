import { ProxyFailure } from "./errors.mjs"

const SEARCH_PROPERTIES = new Set(["query", "objective", "maxResults"])
const FETCH_PROPERTIES = new Set(["url", "maxCharacters"])

export function createBackendConfigs(env = {}) {
  return {
    exa: {
      provider: "exa",
      url: "https://mcp.exa.ai/mcp",
      headers: env.EXA_API_KEY ? { "x-api-key": env.EXA_API_KEY } : {},
    },
    keenable: {
      provider: "keenable",
      url: env.KEENABLE_API_KEY
        ? "https://api.keenable.ai/mcp"
        : "https://api.keenable.ai/mcp-public",
      headers: env.KEENABLE_API_KEY ? { "X-API-Key": env.KEENABLE_API_KEY } : {},
    },
    youcom: {
      provider: "youcom",
      url: env.YDC_API_KEY ? "https://api.you.com/mcp" : "https://api.you.com/mcp/free",
      headers: env.YDC_API_KEY ? { Authorization: `Bearer ${env.YDC_API_KEY}` } : {},
    },
  }
}

export function validateSearchInput(value) {
  validateObject(value, SEARCH_PROPERTIES, "search")

  if (
    !Object.hasOwn(value, "query") ||
    typeof value.query !== "string" ||
    value.query.trim() === ""
  ) {
    throw invalidParams("search query must be a non-empty string")
  }

  const hasObjective = Object.hasOwn(value, "objective")
  if (
    hasObjective &&
    (typeof value.objective !== "string" ||
      value.objective.trim() === "" ||
      value.objective.length > 1_000)
  ) {
    throw invalidParams("search objective must be a non-empty string of at most 1000 characters")
  }

  const maxResults = Object.hasOwn(value, "maxResults") ? value.maxResults : 10
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) {
    throw invalidParams("search maxResults must be an integer from 1 through 50")
  }

  return {
    query: value.query,
    ...(hasObjective ? { objective: value.objective } : {}),
    maxResults,
  }
}

export function validateFetchInput(value) {
  validateObject(value, FETCH_PROPERTIES, "fetch")

  if (!Object.hasOwn(value, "url") || typeof value.url !== "string" || !isHttpUrl(value.url)) {
    throw invalidParams("fetch url must be an absolute HTTP(S) URL")
  }

  const hasMaxCharacters = Object.hasOwn(value, "maxCharacters")
  if (hasMaxCharacters && (!Number.isInteger(value.maxCharacters) || value.maxCharacters <= 0)) {
    throw invalidParams("fetch maxCharacters must be a positive integer")
  }

  return {
    url: value.url,
    ...(hasMaxCharacters ? { maxCharacters: value.maxCharacters } : {}),
  }
}

export function searchInvocation(provider, input, inputSchema = {}) {
  const validated = validateSearchInput(input)

  if (provider === "exa") {
    const hasObjectiveProperty = Object.hasOwn(inputSchema?.properties ?? {}, "objective")
    const requiresObjective =
      hasObjectiveProperty &&
      Array.isArray(inputSchema?.required) &&
      inputSchema.required.includes("objective")
    const includeObjective =
      hasObjectiveProperty && (validated.objective !== undefined || requiresObjective)

    return {
      name: "web_search_exa",
      arguments: {
        query: validated.query,
        ...(includeObjective ? { objective: validated.objective ?? validated.query } : {}),
        numResults: validated.maxResults,
      },
    }
  }

  if (provider === "keenable") {
    return {
      name: "search_web_pages",
      arguments: {
        query: validated.query,
        ...(validated.objective === undefined ? {} : { objective: validated.objective }),
        max_results: validated.maxResults,
      },
    }
  }

  if (provider === "youcom") {
    return {
      name: "you-search",
      arguments: {
        query: validated.query,
        count: validated.maxResults,
      },
    }
  }

  throw new RangeError("Unsupported search provider")
}

export function fetchInvocation(provider, input) {
  const validated = validateFetchInput(input)

  if (provider === "exa") {
    return {
      name: "web_fetch_exa",
      arguments: {
        urls: [validated.url],
        ...(validated.maxCharacters === undefined
          ? {}
          : { maxCharacters: validated.maxCharacters }),
      },
    }
  }

  if (provider === "keenable") {
    return {
      name: "fetch_page_content",
      arguments: {
        urls: [validated.url],
        ...(validated.maxCharacters === undefined ? {} : { max_chars: validated.maxCharacters }),
      },
    }
  }

  if (provider === "youcom") {
    return {
      name: "you-extract",
      arguments: { url: validated.url },
    }
  }

  throw new RangeError("Unsupported fetch provider")
}

function validateObject(value, allowedProperties, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidParams(`${label} input must be an object`)
  }
  if (Object.keys(value).some((key) => !allowedProperties.has(key))) {
    throw invalidParams(`${label} input contains unknown properties`)
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function invalidParams(message) {
  return new ProxyFailure({
    code: "invalid_params",
    message,
    fallbackEligible: false,
  })
}
