export type HealthStatus = "ready" | "degraded";
export interface HealthDiagnostic {
    code: string;
    message: string;
}
export interface HealthRecord {
    status: HealthStatus;
    diagnostics: readonly HealthDiagnostic[];
}
export interface DshHealth {
    readonly host: HealthRecord;
    readonly persistence: HealthRecord;
}
export declare function createHealthRecords(readPersistenceDiagnostics: () => readonly HealthDiagnostic[]): DshHealth;
