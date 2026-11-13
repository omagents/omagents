import type { Context } from "@deepseek-ai/cordis";
import { type DshHealth, type HealthDiagnostic } from "./health.js";
export interface DshJobLaunch {
    host: string;
    hostTaskId: string;
    parentSessionId: string;
    childName?: string;
    agent: string;
    description: string;
}
export interface DshJobRecord {
    id: string;
    [field: string]: unknown;
}
export interface DshJobBoard {
    readonly diagnostics: readonly HealthDiagnostic[];
    readonly revision: number;
    now(): number;
    list(options?: {
        parentSessionId?: string;
    }): DshJobRecord[];
    listPendingOutcomes(parentSessionId?: string): DshJobRecord[];
    registerLaunch(launch: DshJobLaunch): DshJobRecord;
    flush(): Promise<void>;
    close(): Promise<void>;
}
export interface DshRuntime {
    board: DshJobBoard;
    health: DshHealth;
    dispose(): Promise<void>;
}
export declare function createDshRuntime(ctx: Context): Promise<DshRuntime>;
