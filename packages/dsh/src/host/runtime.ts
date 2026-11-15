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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * DSH keeps its current in-memory Board usable after storage failures. Core's
 * stricter sticky-write contract remains unchanged for hosts that need it.
 */
function createDegradingJobStore(store: JsonJobStore) {
  const failures: HealthDiagnostic[] = []
  let degraded = false
  const record = (code: string, operation: string, error: unknown) => {
    const message = `DSH Job Board persistence ${operation} failed; continuing in memory: ${errorMessage(error)}`
    if (failures.some((diagnostic) => diagnostic.code === code && diagnostic.message === message)) {
      return
    }
    failures.push({ code, message })
  }

  return {
    get diagnostics(): HealthDiagnostic[] {
      return [
        // Corrupt-load diagnostics originate in Core. Write failures are
        // represented once by the host-local diagnostics below.
        ...store.diagnostics.filter((diagnostic) => diagnostic.code !== "ERR_JOB_STORE_WRITE"),
        ...failures,
      ]
    },
    async load() {
      try {
        return await store.load()
      } catch (error) {
        degraded = true
        record("ERR_DSH_JOB_STORE_LOAD", "read", error)
        return { version: 1, revision: 0, jobs: [] }
      }
    },
    async save(snapshot: unknown) {
      if (degraded) return
      try {
        await store.save(snapshot)
      } catch (error) {
        degraded = true
        record("ERR_DSH_JOB_STORE_SAVE", "write", error)
      }
    },
    async flush() {
      if (degraded) return
      try {
        await store.flush()
      } catch (error) {
        degraded = true
        record("ERR_DSH_JOB_STORE_FLUSH", "flush", error)
      }
    },
    async close() {
      try {
        await store.close()
      } catch (error) {
        record("ERR_DSH_JOB_STORE_CLOSE", "close", error)
      }
    },
  }
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
  const store = createDegradingJobStore(
    new JsonJobStore({
      filePath: join(profileDirectory, "omagents", "job-board.json"),
    })
  )
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
