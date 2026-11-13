import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { HealthDto, JobDto, JobScope, JobWatchFrame } from "../host/remote-types.js";
export interface OmAgentsJobRemote {
    listJobs(scope: JobScope): Promise<RemoteResult<JobDto[]>>;
    getHealth(): Promise<RemoteResult<HealthDto>>;
    cancelJob(jobId: string): Promise<RemoteResult<JobDto>>;
    watchJobs(scope: JobScope, signal: AbortSignal): AsyncIterable<JobWatchFrame>;
}
export interface JobBoardScheduler {
    setInterval(callback: () => void, milliseconds: number): unknown;
    clearInterval(handle: unknown): void;
    setTimeout(callback: () => void, milliseconds: number): unknown;
    clearTimeout(handle: unknown): void;
}
export interface JobBoardStoreOptions {
    scope?: JobScope;
    now?: () => number;
    scheduler?: JobBoardScheduler;
    tickIntervalMs?: number;
    reconnectDelayMs?: number;
}
export type JobBoardConnectionStatus = "loading" | "ready" | "stale" | "permission-denied" | "error";
export interface JobBoardSnapshot {
    readonly jobs: readonly JobDto[];
    readonly revision: number;
    readonly status: JobBoardConnectionStatus;
    readonly health?: HealthDto | undefined;
    readonly now: number;
    readonly cancellingIds: readonly string[];
    readonly error?: string | undefined;
    readonly actionError?: string | undefined;
    readonly lastUpdatedAt?: number | undefined;
}
export interface JobBoardStore {
    getSnapshot(): JobBoardSnapshot;
    subscribe(listener: () => void): () => void;
    refresh(): Promise<void>;
    reconnect(): Promise<void>;
    cancelJob(jobId: string): Promise<void>;
    clearActionError(): void;
    dispose(): void;
}
/**
 * Create the browser's ephemeral view of the authorized Host Board. Frames are
 * whole-set replacements; only elapsed time and reconnect timing are local.
 */
export declare function createJobBoardStore(remote: OmAgentsJobRemote, options?: JobBoardStoreOptions): JobBoardStore;
