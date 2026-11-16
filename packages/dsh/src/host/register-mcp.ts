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

/** Structural subset of DSH 0.2.2-rc.2+ `@deepseek-ai/dsh-mcp-manager`. */
interface NativeMcpManagerView {
  readonly name: string
}

interface NativeMcpManager {
  list(): Iterable<NativeMcpManagerView>
  register(name: string, entry: NativeMcpRegistration): () => void
}

/** Server entry accepted by the built-in manager; all endpoint fields are optional. */
export interface NativeMcpRegistration {
  transport: "stdio" | "streamable-http"
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

function isNativeMcpManager(value: unknown): value is NativeMcpManager {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<NativeMcpManager>
  return typeof candidate.list === "function" && typeof candidate.register === "function"
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

/** Translate a validated `McpClient.Config` into the built-in manager's server entry. */
export function toDshMcpEntry(config: McpClient.Config): NativeMcpRegistration {
  if (config.transport === "stdio") {
    return {
      transport: "stdio",
      command: config.command,
      args: config.args,
      env: config.env,
    }
  }
  return {
    transport: "streamable-http",
    url: config.url,
    headers: config.headers,
  }
}

interface LoaderEntryTree {
  entries(): Iterable<{
    options: { name: string; disabled?: unknown; config?: { serverName?: unknown } }
  }>
}

const NATIVE_MCP_MANAGER_ROW = "@deepseek-ai/dsh-mcp-manager"

function loaderOf(ctx: Context): LoaderEntryTree | undefined {
  return (ctx as Context & { loader?: LoaderEntryTree }).loader
}

/**
 * True when the composed profile contains an enabled built-in manager row. Such
 * a runtime provides `ctx.mcpManager` itself, so the OmAgents adapter must wait
 * for that service instead of providing a conflicting one.
 */
function compositionProvidesNativeMcpManager(ctx: Context): boolean {
  const loader = loaderOf(ctx)
  if (!loader || typeof loader.entries !== "function") return false

  for (const entry of loader.entries()) {
    if (entry.options.name !== NATIVE_MCP_MANAGER_ROW) continue
    const disabled = (entry as { disabled?: unknown }).disabled
    if (disabled === true) continue
    return true
  }
  return false
}

function configuredUserServerNames(ctx: Context): Set<string> {
  const names = new Set<string>()
  const loader = loaderOf(ctx)
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
 * Compositions without the built-in `ctx.mcpManager` manager row (a minimal
 * profile on a supported DSH release) use this adapter; runtimes that compose
 * `@deepseek-ai/dsh-mcp-manager` use the native manager through
 * `adaptNativeMcpManager` below.
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
        throw new Error(
          `Cannot register MCP server "${name}": the DSH tool registry is unavailable`
        )
      }

      const fiber = ctx.plugin(McpClient, config)
      let disposal: Promise<void> | undefined
      const ready = (async () => {
        await fiber
      })()
      // Every caller receives the original rejecting promise, while this
      // attached handler prevents an ignored readiness promise from becoming
      // an unhandled rejection during plugin teardown.
      void ready.catch(() => {})

      const registration: DshMcpRegistration = {
        ready,
        dispose() {
          if (!disposal) {
            disposal = (async () => {
              try {
                await fiber.dispose()
              } finally {
                if (owned.get(name) === registration) owned.delete(name)
              }
            })()
          }
          return disposal
        },
      }
      owned.set(name, registration)
      return registration
    },
  }
}

/**
 * Adapt the native `@deepseek-ai/dsh-mcp-manager` service to this module's
 * registration seam. The manager owns instance lifecycle and readiness, so
 * `ready` resolves immediately and `dispose` removes the contribution.
 */
export function adaptNativeMcpManager(manager: NativeMcpManager): DshMcpManager {
  return {
    has(name) {
      for (const view of manager.list()) {
        if (view.name === name) return true
      }
      return false
    },

    register(name, config) {
      let disposed = false
      const remove = manager.register(name, toDshMcpEntry(config))
      return {
        ready: Promise.resolve(),
        async dispose() {
          if (disposed) return
          disposed = true
          remove()
        },
      }
    },
  }
}

function isLegacyMcpManager(value: unknown): value is DshMcpManager {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<DshMcpManager>
  return typeof candidate.has === "function" && typeof candidate.register === "function"
}

/**
 * Prefer the runtime's built-in `ctx.mcpManager` (DSH 0.2.2-rc.2+), adapting
 * its fleet API to this module's registration seam. An already-provided
 * registration-shaped manager is used as-is, and a composition without either
 * falls back to the OmAgents-owned adapter. The adapter never provides the
 * `mcpManager` service itself: the built-in manager owns that name, and
 * providing it first would make the native row fail to activate.
 */
function resolveMcpManager(ctx: Context): DshMcpManager {
  const raw =
    typeof ctx.get === "function"
      ? ctx.get("mcpManager")
      : (ctx as { mcpManager?: unknown }).mcpManager
  if (isNativeMcpManager(raw)) return adaptNativeMcpManager(raw)
  if (isLegacyMcpManager(raw)) return raw

  return createDshMcpManager(ctx)
}

/** Register the canonical Core catalog when DSH tools are available, preserving user names. */
export function registerDshMcp(
  ctx: Context,
  env: NodeJS.ProcessEnv,
  health: DshHealth
): () => Promise<void> {
  setDshCapabilityDiagnostics(health, "mcp", [])
  let capabilityFiber: ReturnType<Context["inject"]> | undefined
  let activeCleanup: (() => Promise<void>) | undefined
  let disposed = false
  let disposal: Promise<void> | undefined

  const activate = (inner: Context): (() => Promise<void>) => {
    if (disposed) return () => Promise.resolve()
    if (activeCleanup) return activeCleanup

    const registrations: DshMcpRegistration[] = []
    let activationDisposed = false
    let activationDisposal: Promise<void> | undefined

    const cleanup = (): Promise<void> => {
      if (!activationDisposal) {
        activationDisposed = true
        activationDisposal = (async () => {
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
        })()
        const reset = () => {
          if (activeCleanup === cleanup && !disposed) activeCleanup = undefined
        }
        void activationDisposal.then(reset, reset)
      }
      return activationDisposal
    }
    activeCleanup = cleanup
    setDshCapabilityDiagnostics(health, "mcp", [])

    try {
      const manager = resolveMcpManager(inner)

      for (const [name, definition] of Object.entries(resolveMcpServers({ env }))) {
        try {
          if (manager.has(name)) continue
          const registration = manager.register(
            name,
            toDshMcpConfig(name, definition as CoreMcpDefinition)
          )
          registrations.push(registration)
          void registration.ready.catch((error) => {
            if (disposed || activationDisposed) return
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
    return cleanup
  }

  try {
    if (typeof ctx.inject === "function" && typeof ctx.get === "function") {
      if (compositionProvidesNativeMcpManager(ctx)) {
        // The built-in manager owns `ctx.mcpManager`; wait for both the tool
        // registry and that service so the native fleet is never preempted.
        capabilityFiber = ctx.inject(["tools", "mcpManager"], activate)
      } else if (!ctx.get("tools")) {
        capabilityFiber = ctx.inject(["tools"], activate)
      } else {
        activate(ctx)
      }
    } else {
      activate(ctx)
    }
  } catch (error) {
    appendDshCapabilityDiagnostic(health, "mcp", {
      code: "ERR_DSH_MCP_UNAVAILABLE",
      message: `Unable to subscribe to DSH tool availability: ${errorMessage(error)}`,
    })
  }

  return () => {
    if (!disposal) {
      disposed = true
      const activeDisposal = activeCleanup?.()
      const capabilityDisposal = capabilityFiber?.dispose()
      disposal = (async () => {
        if (activeDisposal) await activeDisposal
        if (capabilityDisposal) {
          try {
            await capabilityDisposal
          } catch (error) {
            appendDshCapabilityDiagnostic(health, "mcp", {
              code: "ERR_DSH_MCP_DISPOSAL",
              message: `Unable to dispose DSH tool availability: ${errorMessage(error)}`,
            })
          }
        }
      })()
    }
    return disposal
  }
}
