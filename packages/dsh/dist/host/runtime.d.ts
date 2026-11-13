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
    host: string;
    hostTaskId: string;
    parentSessionId: string;
    childName?: string;
    alias: string;
    agent: string;
    description: string;
    executionState: "running" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
    notificationState?: "pending" | "injected" | "acknowledged";
    launchedAt: number;
    updatedAt: number;
    terminalAt?: number;
    cancelRequestedAt?: number;
    revision: number;
    resultSummary?: unknown;
    error?: unknown;
    [field: string]: unknown;
}
export interface DshTerminalUpdate {
    state: "completed" | "failed" | "cancelled" | "interrupted";
    resultSummary?: unknown;
    error?: unknown;
}
export type DshRecoveryUpdate = {
    kind: "active";
} | ({
    kind: "terminal";
} & DshTerminalUpdate) | {
    kind: "missing" | "unreadable";
    reason: string;
};
export interface DshJobBoard {
    readonly diagnostics: readonly HealthDiagnostic[];
    readonly revision: number;
    now(): number;
    get(idOrAlias: string): DshJobRecord | undefined;
    list(options?: {
        parentSessionId?: string;
    }): DshJobRecord[];
    listPendingOutcomes(parentSessionId?: string): DshJobRecord[];
    subscribe(listener: (event: {
        revision: number;
        jobId?: string;
    }) => void): () => void;
    registerLaunch(launch: DshJobLaunch): DshJobRecord;
    requestCancellation(idOrAlias: string): DshJobRecord | undefined;
    markTerminal(idOrAlias: string, update: DshTerminalUpdate): DshJobRecord | undefined;
    markInjected(ids: readonly string[]): void;
    acknowledgeInjected(parentSessionId: string): void;
    reconcile(options: {
        query: (job: DshJobRecord) => Promise<DshRecoveryUpdate>;
    }): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
}
export interface DshRuntime {
    board: DshJobBoard;
    health: DshHealth;
    dispose(): Promise<void>;
}
export declare function createDshRuntime(ctx: Context): Promise<DshRuntime>;
