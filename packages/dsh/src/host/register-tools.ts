import type { Context } from "@deepseek-ai/cordis"
import { defineTool } from "@deepseek-ai/dsh-tools"
import type { JsonValue } from "@deepseek-ai/dsh-util-values"
import { buildParallelStatus } from "@omagents/core"

import {
  appendDshCapabilityDiagnostic,
  setDshCapabilityDiagnostics,
  type DshHealth,
} from "./health.js"
import type { DshJobBoard, DshJobRecord } from "./runtime.js"
import type { DshSubagentTracker } from "./subagent-tracker.js"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cancellationResult(board: DshJobBoard, job: DshJobRecord | undefined, message: string) {
  return {
    revision: board.revision,
    found: job !== undefined,
    ...(job ? { job: job as unknown as JsonValue } : {}),
    message,
  }
}

/** Register canonical status and idempotent native-subagent cancellation tools. */
export function registerDshTools(
  ctx: Context,
  board: DshJobBoard,
  tracker?: DshSubagentTracker,
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
      const registry = typeof inner.get === "function" ? inner.get("tools") : inner.tools
      if (typeof registry?.register !== "function") {
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
      disposers.push(registry.register(definition))
      const cancellation = defineTool({
        name: "cancel_task",
        description:
          "Request cancellation of a running native DSH subagent by Job Board ID or alias. Acceptance changes the job to cancelling; only the native subagent settlement marks it cancelled. Local interruption stops the current turn while descendants continue; external one-shot runs terminate without resume. Repeated, unknown, and terminal requests are idempotent.",
        parameters: {
          task_id: {
            type: "string",
            required: true,
            description: "The Job Board task ID or alias to cancel.",
          },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              revision: { type: "integer", required: true },
              found: { type: "boolean", required: true },
              job: { type: "json" },
              message: { type: "string", required: true },
            },
          },
          render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
        },
        async execute(args) {
          const job = board.get(args.task_id)
          if (!job) {
            return cancellationResult(
              board,
              undefined,
              `No background task found with ID or alias '${args.task_id}'.`
            )
          }
          if (job.executionState !== "running") {
            return cancellationResult(
              board,
              job,
              `Task '${job.alias}' is already in state: ${job.executionState}.`
            )
          }
          if (!tracker) {
            return cancellationResult(
              board,
              job,
              `Error cancelling task '${job.alias}': DSH subagent tracking is unavailable.`
            )
          }
          try {
            await tracker.cancel(job)
            const current = board.get(job.id) ?? job
            return cancellationResult(
              board,
              current,
              current.executionState === "cancelling"
                ? `Cancellation requested for task '${current.alias}' (${current.hostTaskId}).`
                : `Task '${current.alias}' is now in state: ${current.executionState}.`
            )
          } catch (error) {
            return cancellationResult(
              board,
              board.get(job.id) ?? job,
              `Error cancelling task '${job.alias}': ${errorMessage(error)}`
            )
          }
        },
      })
      disposers.push(registry.register(cancellation))
    } catch (error) {
      report(
        "ERR_DSH_TOOL_REGISTRATION",
        `Unable to register DSH status/cancellation tools: ${errorMessage(error)}`
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
