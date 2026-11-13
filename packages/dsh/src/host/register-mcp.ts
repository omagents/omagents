import type { Context } from "@deepseek-ai/cordis"
import * as McpClient from "@deepseek-ai/dsh-mcp-client"
import { resolveMcpServers } from "@omagents/core"

import {
  appendDshCapabilityDiagnostic,
  setDshCapabilityDiagnostics,
  type DshHealth,
} from "./health.js"

interface CoreMcpDefinition {
  type: "local" | "remote"
  command?: string[]
  environment?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  oauth?: boolean
}

export interface DshMcpRegistration {
  readonly ready: Promise<void>
  dispose(): Promise<void>
}

export interface DshMcpManager {
  has(name: string): boolean
  register(name: string, config: McpClient.Config): DshMcpRegistration
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    mcpManager?: DshMcpManager
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Translate Core's host-neutral catalog entry into DSH 0.2.2's real client config. */
export function toDshMcpConfig(
  serverName: string,
  definition: CoreMcpDefinition
): McpClient.Config {
  if (definition.type === "local") {
    const [command, ...args] = definition.command ?? []
    if (!command) throw new TypeError(`MCP server "${serverName}" has no command`)
    return McpClient.Config({
      transport: "stdio",
      serverName,
      command,
      args,
      env: { ...definition.environment },
      failOnStartupError: true,
    })
  }

  if (definition.type === "remote") {
    if (!definition.url) throw new TypeError(`MCP server "${serverName}" has no URL`)
    return McpClient.Config({
      transport: "streamable-http",
      serverName,
      url: definition.url,
      headers: { ...definition.headers },
      failOnStartupError: true,
    })
  }

  throw new TypeError(`Unsupported MCP transport for "${serverName}"`)
}

interface LoaderEntryTree {
  entries(): Iterable<{
    options: { name: string; config?: { serverName?: unknown } }
  }>
}

function configuredUserServerNames(ctx: Context): Set<string> {
  const names = new Set<string>()
  const loader = (ctx as Context & { loader?: LoaderEntryTree }).loader
  if (!loader) return names

  for (const entry of loader.entries()) {
    const options = entry.options
    if (
      options.name === "@deepseek-ai/dsh-mcp-client" &&
      typeof options.config?.serverName === "string"
    ) {
      names.add(options.config.serverName)
    }
  }
  return names
}

/**
 * Small OmAgents-owned manager over DSH's one-server-per-plugin API.
 * DSH 0.2.2-rc.1 has no built-in ctx.mcpManager service; this adapter keeps
 * registration, user-name precedence, readiness, and disposal in one seam.
 */
export function createDshMcpManager(ctx: Context): DshMcpManager {
  const owned = new Map<string, DshMcpRegistration>()

  return {
    has(name) {
      return owned.has(name) || configuredUserServerNames(ctx).has(name)
    },

    register(name, config) {
      if (config.serverName !== name) {
        throw new TypeError(`MCP config serverName "${config.serverName}" does not match "${name}"`)
      }
      if (owned.has(name) || configuredUserServerNames(ctx).has(name)) {
        throw new Error(`MCP server "${name}" is already registered`)
      }
      if (!ctx.get("tools")) {
        throw new Error(`Cannot register MCP server "${name}": the DSH tool registry is unavailable`)
      }

      const fiber = ctx.plugin(McpClient, config)
      let disposed = false
      const ready = (async () => {
        await fiber
      })()
      // Every caller receives the original rejecting promise, while this
      // attached handler prevents an ignored readiness promise from becoming
      // an unhandled rejection during plugin teardown.
      void ready.catch(() => {})

      const registration: DshMcpRegistration = {
        ready,
        async dispose() {
          if (disposed) return
          disposed = true
          if (owned.get(name) === registration) owned.delete(name)
          await fiber.dispose()
        },
      }
      owned.set(name, registration)
      return registration
    },
  }
}

/** Register the canonical Core catalog without replacing user-configured MCP names. */
export function registerDshMcp(
  ctx: Context,
  env: NodeJS.ProcessEnv,
  health: DshHealth
): () => Promise<void> {
  setDshCapabilityDiagnostics(health, "mcp", [])
  const registrations: DshMcpRegistration[] = []
  let disposed = false

  try {
    const manager = ctx.mcpManager ?? createDshMcpManager(ctx)
    if (!ctx.mcpManager) ctx.provide("mcpManager", manager)

    for (const [name, definition] of Object.entries(resolveMcpServers({ env }))) {
      try {
        if (manager.has(name)) continue
        const registration = manager.register(
          name,
          toDshMcpConfig(name, definition as CoreMcpDefinition)
        )
        registrations.push(registration)
        void registration.ready.catch((error) => {
          if (disposed) return
          appendDshCapabilityDiagnostic(health, "mcp", {
            code: "ERR_DSH_MCP_STARTUP",
            message: `MCP server "${name}" failed its initial handshake: ${errorMessage(error)}`,
          })
        })
      } catch (error) {
        appendDshCapabilityDiagnostic(health, "mcp", {
          code: "ERR_DSH_MCP_REGISTRATION",
          message: `Unable to register MCP server "${name}": ${errorMessage(error)}`,
        })
      }
    }
  } catch (error) {
    appendDshCapabilityDiagnostic(health, "mcp", {
      code: "ERR_DSH_MCP_UNAVAILABLE",
      message: `Unable to initialize DSH MCP registration: ${errorMessage(error)}`,
    })
  }

  return async () => {
    if (disposed) return
    disposed = true
    for (const registration of registrations.splice(0).reverse()) {
      try {
        await registration.dispose()
      } catch (error) {
        appendDshCapabilityDiagnostic(health, "mcp", {
          code: "ERR_DSH_MCP_DISPOSAL",
          message: `Unable to dispose an MCP registration: ${errorMessage(error)}`,
        })
      }
    }
  }
}
