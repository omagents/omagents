export type HealthStatus = "ready" | "degraded"

export interface HealthDiagnostic {
  code: string
  message: string
}

export interface HealthRecord {
  status: HealthStatus
  diagnostics: readonly HealthDiagnostic[]
}

export interface DshHealth {
  readonly host: HealthRecord
  readonly persistence: HealthRecord
}

export function createHealthRecords(
  readPersistenceDiagnostics: () => readonly HealthDiagnostic[]
): DshHealth {
  const host: HealthRecord = { status: "ready", diagnostics: [] }

  return {
    host,
    get persistence(): HealthRecord {
      const diagnostics = readPersistenceDiagnostics()
      return {
        status: diagnostics.length === 0 ? "ready" : "degraded",
        diagnostics,
      }
    },
  }
}
