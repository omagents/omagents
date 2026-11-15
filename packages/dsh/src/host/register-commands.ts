import type { Context } from "@deepseek-ai/cordis"
import type { CommandResult } from "@deepseek-ai/dsh-commands"
import { buildPsText } from "@omagents/core"

import {
  appendDshCapabilityDiagnostic,
  setDshCapabilityDiagnostics,
  type DshHealth,
} from "./health.js"
import type { DshJobBoard } from "./runtime.js"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Register a direct human command; its handler never creates a model prompt or message. */
export function registerDshCommands(
  ctx: Context,
  board: DshJobBoard,
  health?: DshHealth
): () => void {
  if (health) setDshCapabilityDiagnostics(health, "commands", [])
  const disposers: Array<() => void> = []
  let capabilityFiber: ReturnType<Context["inject"]> | undefined
  let activeCleanup: (() => void) | undefined
  let disposed = false

  const report = (code: string, message: string) => {
    if (health) appendDshCapabilityDiagnostic(health, "commands", { code, message })
  }

  const cleanup = () => {
    if (activeCleanup === cleanup) activeCleanup = undefined
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch (error) {
        report(
          "ERR_DSH_COMMAND_DISPOSAL",
          `Unable to unregister a DSH command: ${errorMessage(error)}`
        )
      }
    }
  }

  const activate = (inner: Context): (() => void) => {
    if (disposed) return cleanup
    if (activeCleanup) return activeCleanup
    activeCleanup = cleanup
    if (health) setDshCapabilityDiagnostics(health, "commands", [])

    try {
      const registry = typeof inner.get === "function" ? inner.get("commands") : inner.commands
      if (typeof registry?.register !== "function") {
        throw new Error("The DSH command registry is unavailable")
      }
      disposers.push(
        registry.register({
          name: "ps",
          description: "Show tracked subagent jobs for the current session",
          recordInput: false,
          handler(invocation): CommandResult {
            try {
              return {
                kind: "success",
                text: buildPsText(board, { parentSessionId: invocation.agent.session.id }),
              }
            } catch (error) {
              const message = `Unable to read the DSH Job Board: ${errorMessage(error)}`
              report("ERR_DSH_COMMAND_EXECUTION", message)
              return { kind: "error", text: message }
            }
          },
        })
      )
    } catch (error) {
      report("ERR_DSH_COMMAND_REGISTRATION", `Unable to register DSH /ps: ${errorMessage(error)}`)
    }
    return cleanup
  }

  try {
    if (typeof ctx.inject === "function" && typeof ctx.get === "function" && !ctx.get("commands")) {
      capabilityFiber = ctx.inject(["commands"], activate)
    } else {
      activate(ctx)
    }
  } catch (error) {
    report(
      "ERR_DSH_COMMANDS_UNAVAILABLE",
      `Unable to subscribe to DSH command availability: ${errorMessage(error)}`
    )
  }

  return () => {
    if (disposed) return
    disposed = true
    activeCleanup?.()
    try {
      const capabilityDisposal = capabilityFiber?.dispose()
      if (capabilityDisposal) {
        void capabilityDisposal.catch((error) => {
          report(
            "ERR_DSH_COMMAND_DISPOSAL",
            `Unable to dispose DSH command availability: ${errorMessage(error)}`
          )
        })
      }
    } catch (error) {
      report(
        "ERR_DSH_COMMAND_DISPOSAL",
        `Unable to dispose DSH command availability: ${errorMessage(error)}`
      )
    }
  }
}
