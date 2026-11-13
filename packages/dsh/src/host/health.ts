export type HealthStatus = "ready" | "degraded"

export interface HealthDiagnostic {
  code: string
  message: string
}

export interface HealthRecord {
  status: HealthStatus
  diagnostics: readonly HealthDiagnostic[]
}

export type DshCapability = "skills" | "mcp" | "python" | "tools" | "commands" | "context"

export interface DshHealth {
  readonly host: HealthRecord
  readonly persistence: HealthRecord
  readonly skills: HealthRecord
  readonly mcp: HealthRecord
  readonly python: HealthRecord
  readonly tools: HealthRecord
  readonly commands: HealthRecord
  readonly context: HealthRecord
}

type CapabilityDiagnostics = Record<DshCapability, readonly HealthDiagnostic[]>

const capabilityUpdaters = new WeakMap<
  DshHealth,
  (capability: DshCapability, diagnostics: readonly HealthDiagnostic[]) => void
>()

function healthRecord(diagnostics: readonly HealthDiagnostic[]): HealthRecord {
  return {
    status: diagnostics.length === 0 ? "ready" : "degraded",
    diagnostics,
  }
}

export function setDshCapabilityDiagnostics(
  health: DshHealth,
  capability: DshCapability,
  diagnostics: readonly HealthDiagnostic[]
): void {
  const update = capabilityUpdaters.get(health)
  if (!update) throw new TypeError("OmAgents health records must come from createHealthRecords()")
  update(capability, diagnostics)
}

export function appendDshCapabilityDiagnostic(
  health: DshHealth,
  capability: DshCapability,
  diagnostic: HealthDiagnostic
): void {
  setDshCapabilityDiagnostics(health, capability, [
    ...health[capability].diagnostics,
    diagnostic,
  ])
}

export function createHealthRecords(
  readPersistenceDiagnostics: () => readonly HealthDiagnostic[]
): DshHealth {
  const host: HealthRecord = { status: "ready", diagnostics: [] }
  const diagnostics: CapabilityDiagnostics = {
    skills: [],
    mcp: [],
    python: [],
    tools: [],
    commands: [],
    context: [],
  }
  const health: DshHealth = {
    host,
    get persistence(): HealthRecord {
      return healthRecord(readPersistenceDiagnostics())
    },
    get skills(): HealthRecord {
      return healthRecord(diagnostics.skills)
    },
    get mcp(): HealthRecord {
      return healthRecord(diagnostics.mcp)
    },
    get python(): HealthRecord {
      return healthRecord(diagnostics.python)
    },
    get tools(): HealthRecord {
      return healthRecord(diagnostics.tools)
    },
    get commands(): HealthRecord {
      return healthRecord(diagnostics.commands)
    },
    get context(): HealthRecord {
      return healthRecord(diagnostics.context)
    },
  }

  capabilityUpdaters.set(health, (capability, nextDiagnostics) => {
    diagnostics[capability] = Object.freeze([...nextDiagnostics])
  })
  return health
}
