import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { DshHealth } from "./health.js";
import { type AuthorizeScope } from "./remote-access.js";
import type { HealthDto, JobDto, JobScope, JobWatchFrame } from "./remote-types.js";
import type { DshJobBoard } from "./runtime.js";
import type { DshSubagentTracker } from "./subagent-tracker.js";
export interface OmAgentsRemoteOptions {
    board: DshJobBoard;
    tracker: DshSubagentTracker;
    health: DshHealth;
    authorizeScope: AuthorizeScope;
}
/** Authorized Remote face of the active profile's Core Board. */
export declare class OmAgentsRemote extends TypertRemoteService {
    private readonly board;
    private readonly tracker;
    private readonly health;
    private readonly authorizeScope;
    private readonly lifetime;
    constructor(ctx: Context, options: OmAgentsRemoteOptions);
    listJobs(scope: JobScope): Promise<JobDto[]>;
    cancelJob(jobId: string): Promise<JobDto>;
    getHealth(): HealthDto;
    watchJobs(scope: JobScope, signal: AbortSignal): AsyncIterable<JobWatchFrame>;
    private streamJobs;
    private reconcile;
    private assertAuthorized;
    private readJobs;
    private frame;
}
