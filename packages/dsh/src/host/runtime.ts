import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import type { Context } from "@deepseek-ai/cordis"
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths"
import { JobBoard, JsonJobStore } from "@omagents/core"

import { createHealthRecords, type DshHealth, type HealthDiagnostic } from "./health.js"

export interface DshJobLaunch {
  host: string
  hostTaskId: string
  parentSessionId: string
  childName?: string
  agent: string
  description: string
}

export interface DshJobRecord {
  id: string
  host: string
  hostTaskId: string
  parentSessionId: string
  childName?: string
  alias: string
  agent: string
  description: string
  executionState: "running" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted"
  notificationState?: "pending" | "injected" | "acknowledged"
  launchedAt: number
  updatedAt: number
  terminalAt?: number
  cancelRequestedAt?: number
  revision: number
  resultSummary?: unknown
  error?: unknown
  [field: string]: unknown
}

export interface DshTerminalUpdate {
  state: "completed" | "failed" | "cancelled" | "interrupted"
  resultSummary?: unknown
  error?: unknown
}

export type DshRecoveryUpdate =
  | { kind: "active" }
  | ({ kind: "terminal" } & DshTerminalUpdate)
  | { kind: "missing" | "unreadable"; reason: string }

export interface DshJobBoard {
  readonly diagnostics: readonly HealthDiagnostic[]
  readonly revision: number
  now(): number
  get(idOrAlias: string): DshJobRecord | undefined
  list(options?: { parentSessionId?: string }): DshJobRecord[]
  listPendingOutcomes(parentSessionId?: string): DshJobRecord[]
  subscribe(listener: (event: { revision: number; jobId?: string }) => void): () => void
  registerLaunch(launch: DshJobLaunch): DshJobRecord
  requestCancellation(idOrAlias: string): DshJobRecord | undefined
  markTerminal(idOrAlias: string, update: DshTerminalUpdate): DshJobRecord | undefined
  markInjected(ids: readonly string[]): void
  acknowledgeInjected(parentSessionId: string): void
  reconcile(options: {
    query: (job: DshJobRecord) => Promise<DshRecoveryUpdate>
  }): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

export interface DshRuntime {
  board: DshJobBoard
  health: DshHealth
  dispose(): Promise<void>
}

function resolveActiveProfileDirectory(ctx: Context): string {
  if (!ctx.baseUrl) {
    throw new Error("OmAgents requires the DSH Loader baseUrl to resolve the active profile")
  }

  const baseUrl = new URL(ctx.baseUrl)
  if (baseUrl.protocol !== "file:") {
    throw new Error(`OmAgents requires a file: DSH Loader baseUrl, received ${ctx.baseUrl}`)
  }

  const basePath = fileURLToPath(baseUrl)
  const configDirectory = resolve(baseUrl.pathname.endsWith("/") ? basePath : dirname(basePath))
  const profilesDirectory = resolve(resolveDshHome(), "profiles")
  const profileName = relative(profilesDirectory, configDirectory)
  if (
    !profileName ||
    profileName === "." ||
    profileName === ".." ||
    profileName === "node_modules" ||
    profileName.includes(sep) ||
    isAbsolute(profileName)
  ) {
    throw new Error(
      `OmAgents cannot resolve an active DSH profile from Loader baseUrl ${ctx.baseUrl}`
    )
  }

  return join(profilesDirectory, profileName)
}

export async function createDshRuntime(ctx: Context): Promise<DshRuntime> {
  const profileDirectory = resolveActiveProfileDirectory(ctx)
  const store = new JsonJobStore({
    filePath: join(profileDirectory, "omagents", "job-board.json"),
  })
  const board = await JobBoard.open({ store })
  const health = createHealthRecords(() => board.diagnostics as readonly HealthDiagnostic[])
  let disposal: Promise<void> | undefined

  return {
    board: board as DshJobBoard,
    health,
    dispose() {
      disposal ??= (async () => {
        try {
          await board.flush()
        } finally {
          await board.close()
        }
      })()
      return disposal
    },
  }
}
