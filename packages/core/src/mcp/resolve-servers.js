import baseMcps from "../../mcp-servers/base.json" with { type: "json" }

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
export function resolveMcpServers({ env = process.env } = {}) {
  const servers = Object.fromEntries(
    Object.entries(baseMcps).map(([name, definition]) => [name, cloneDefinition(definition)])
  )

  // Context7 works anonymously; a key only raises the local server's rate limits.
  servers.context7 = {
    type: "local",
    command: ["npx", "-y", "@upstash/context7-mcp"],
    ...(env.CONTEXT7_API_KEY ? { environment: { CONTEXT7_API_KEY: env.CONTEXT7_API_KEY } } : {}),
  }

  // Hosted Exa supports both anonymous access and x-api-key authentication.
  if (env.EXA_API_KEY) {
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
