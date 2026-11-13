export type HealthStatus = "ready" | "degraded";
export interface HealthDiagnostic {
    code: string;
    message: string;
}
export interface HealthRecord {
    status: HealthStatus;
    diagnostics: readonly HealthDiagnostic[];
}
export type DshCapability = "skills" | "mcp" | "python" | "tools" | "commands" | "context";
export interface DshHealth {
    readonly host: HealthRecord;
    readonly persistence: HealthRecord;
    readonly skills: HealthRecord;
    readonly mcp: HealthRecord;
    readonly python: HealthRecord;
    readonly tools: HealthRecord;
    readonly commands: HealthRecord;
    readonly context: HealthRecord;
}
export declare function setDshCapabilityDiagnostics(health: DshHealth, capability: DshCapability, diagnostics: readonly HealthDiagnostic[]): void;
export declare function appendDshCapabilityDiagnostic(health: DshHealth, capability: DshCapability, diagnostic: HealthDiagnostic): void;
export declare function createHealthRecords(readPersistenceDiagnostics: () => readonly HealthDiagnostic[]): DshHealth;
