import type { Context } from "@deepseek-ai/cordis"
import { defineTool } from "@deepseek-ai/dsh-tools"
import { buildParallelStatus } from "@omagents/core"

import {
  appendDshCapabilityDiagnostic,
  setDshCapabilityDiagnostics,
  type DshHealth,
} from "./health.js"
import type { DshJobBoard } from "./runtime.js"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Register only the read-only status tool; cancellation is added by the lifecycle adapter. */
export function registerDshTools(
  ctx: Context,
  board: DshJobBoard,
  health?: DshHealth
): () => void {
  if (health) setDshCapabilityDiagnostics(health, "tools", [])
  const disposers: Array<() => void> = []
  let capabilityFiber: ReturnType<Context["inject"]> | undefined
  let activeCleanup: (() => void) | undefined
  let disposed = false

  const report = (code: string, message: string) => {
    if (health) appendDshCapabilityDiagnostic(health, "tools", { code, message })
  }

  const cleanup = () => {
    if (activeCleanup === cleanup) activeCleanup = undefined
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch (error) {
        report("ERR_DSH_TOOL_DISPOSAL", `Unable to unregister a DSH tool: ${errorMessage(error)}`)
      }
    }
  }

  const activate = (inner: Context): (() => void) => {
    if (disposed) return cleanup
    if (activeCleanup) return activeCleanup
    activeCleanup = cleanup
    if (health) setDshCapabilityDiagnostics(health, "tools", [])

    try {
      if (typeof inner.tools?.register !== "function") {
        throw new Error("The DSH tool registry is unavailable")
      }
      const definition = defineTool({
        name: "parallel_status",
        description:
          "Read the shared Job Board without changing jobs or notification state. Pass session_id to select one parent session; omit it to inspect all tracked subagent jobs. Returns canonical JSON counts, states, elapsed time, and outcome summaries.",
        parameters: {
          session_id: {
            type: "string",
            description: "Optional parent session ID. Omit to return jobs from every session.",
          },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              revision: { type: "integer", required: true },
              total: { type: "integer", required: true },
              running: { type: "integer", required: true },
              cancelling: { type: "integer", required: true },
              completed: { type: "integer", required: true },
              failed: { type: "integer", required: true },
              cancelled: { type: "integer", required: true },
              interrupted: { type: "integer", required: true },
              pendingOutcomes: { type: "integer", required: true },
              message: { type: "string" },
              tasks: {
                type: "array",
                required: true,
                items: {
                  type: "object",
                  additionalProperties: true,
                  properties: {
                    id: { type: "string", required: true },
                    host: { type: "string", required: true },
                    hostTaskId: { type: "string", required: true },
                    parentSessionId: { type: "string", required: true },
                    childName: { type: "string" },
                    alias: { type: "string", required: true },
                    agent: { type: "string", required: true },
                    description: { type: "string", required: true },
                    executionState: {
                      type: "string",
                      required: true,
                      enum: [
                        "running",
                        "cancelling",
                        "completed",
                        "failed",
                        "cancelled",
                        "interrupted",
                      ],
                    },
                    notificationState: {
                      type: "string",
                      enum: ["pending", "injected", "acknowledged"],
                    },
                    launchedAt: { type: "integer", required: true },
                    updatedAt: { type: "integer", required: true },
                    terminalAt: { type: "integer" },
                    cancelRequestedAt: { type: "integer" },
                    revision: { type: "integer", required: true },
                    resultSummary: { type: "json" },
                    error: { type: "json" },
                    elapsedSeconds: { type: "integer", required: true },
                  },
                },
              },
            },
          },
          render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
        },
        isConcurrencySafe: () => true,
        async execute(args) {
          return buildParallelStatus(board, args.session_id)
        },
      })
      disposers.push(inner.tools.register(definition))
    } catch (error) {
      report(
        "ERR_DSH_TOOL_REGISTRATION",
        `Unable to register DSH parallel_status: ${errorMessage(error)}`
      )
    }
    return cleanup
  }

  try {
    if (typeof ctx.inject === "function" && typeof ctx.get === "function" && !ctx.get("tools")) {
      capabilityFiber = ctx.inject(["tools"], activate)
    } else {
      activate(ctx)
    }
  } catch (error) {
    report(
      "ERR_DSH_TOOLS_UNAVAILABLE",
      `Unable to subscribe to DSH tool availability: ${errorMessage(error)}`
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
            "ERR_DSH_TOOL_DISPOSAL",
            `Unable to dispose DSH tool availability: ${errorMessage(error)}`
          )
        })
      }
    } catch (error) {
      report(
        "ERR_DSH_TOOL_DISPOSAL",
        `Unable to dispose DSH tool availability: ${errorMessage(error)}`
      )
    }
  }
}
