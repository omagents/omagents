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
  [field: string]: unknown
}

export interface DshJobBoard {
  readonly diagnostics: readonly HealthDiagnostic[]
  list(options?: { parentSessionId?: string }): DshJobRecord[]
  registerLaunch(launch: DshJobLaunch): DshJobRecord
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
