import { fileURLToPath } from "node:url"

import baseMcps from "../../mcp-servers/base.json" with { type: "json" }

const DEFAULT_SEARCH_PROXY_ENTRY = fileURLToPath(
  new URL("../../mcp-servers/search-proxy/index.mjs", import.meta.url)
)

function cloneDefinition(definition) {
  return {
    ...definition,
    ...(definition.command ? { command: [...definition.command] } : {}),
  }
}

/**
 * Resolve the host-neutral MCP catalog for an environment.
 * Host adapters remain responsible for registration precedence and serialization.
 */
export function resolveMcpServers({
  env = process.env,
  searchProxyEntry = DEFAULT_SEARCH_PROXY_ENTRY,
} = {}) {
  const servers = Object.fromEntries(
    Object.entries(baseMcps).map(([name, definition]) => [name, cloneDefinition(definition)])
  )

  // Context7 works anonymously; a key only raises the local server's rate limits.
  servers.context7 = {
    type: "local",
    command: ["npx", "-y", "@upstash/context7-mcp"],
    ...(env.CONTEXT7_API_KEY ? { environment: { CONTEXT7_API_KEY: env.CONTEXT7_API_KEY } } : {}),
  }

  const searchProvider = env.OMAGENTS_SEARCH_PROVIDER || "auto"
  if (
    searchProvider !== "auto" &&
    searchProvider !== "exa" &&
    searchProvider !== "keenable" &&
    searchProvider !== "youcom"
  ) {
    throw new RangeError(
      `Unsupported OMAGENTS_SEARCH_PROVIDER "${searchProvider}"; expected "auto", "exa", "keenable", or "youcom"`
    )
  }

  if (searchProvider === "auto") {
    const proxyEnvironment = {
      ...(env.EXA_API_KEY ? { EXA_API_KEY: env.EXA_API_KEY } : {}),
      ...(env.KEENABLE_API_KEY ? { KEENABLE_API_KEY: env.KEENABLE_API_KEY } : {}),
      ...(env.YDC_API_KEY ? { YDC_API_KEY: env.YDC_API_KEY } : {}),
    }
    servers.websearch = {
      type: "local",
      command: ["node", searchProxyEntry],
      ...(Object.keys(proxyEnvironment).length > 0 ? { environment: proxyEnvironment } : {}),
    }
  } else if (searchProvider === "youcom") {
    delete servers.websearch
    servers.youdotcom = env.YDC_API_KEY
      ? {
          type: "remote",
          url: "https://api.you.com/mcp",
          oauth: false,
          headers: { Authorization: `Bearer ${env.YDC_API_KEY}` },
        }
      : {
          type: "remote",
          url: "https://api.you.com/mcp/free",
          oauth: false,
        }
  } else if (searchProvider === "keenable") {
    delete servers.websearch
    servers.keenable = env.KEENABLE_API_KEY
      ? {
          type: "remote",
          url: "https://api.keenable.ai/mcp",
          oauth: false,
          headers: { "X-API-Key": env.KEENABLE_API_KEY },
        }
      : {
          type: "remote",
          url: "https://api.keenable.ai/mcp-public",
          oauth: false,
        }
  } else if (env.EXA_API_KEY) {
    // Hosted Exa supports both anonymous access and x-api-key authentication.
    servers.websearch = {
      type: "remote",
      url: "https://mcp.exa.ai/mcp",
      oauth: false,
      headers: { "x-api-key": env.EXA_API_KEY },
    }
  }

  // Prefer the authenticated GitHub MCP, falling back to public Grep.app.
  if (env.GITHUB_TOKEN) {
    servers.github = {
      type: "remote",
      url: "https://api.githubcopilot.com/mcp/",
      oauth: false,
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}` },
    }
  } else {
    servers.grep_app = {
      type: "remote",
      url: "https://mcp.grep.app",
      oauth: false,
    }
  }

  return servers
}
