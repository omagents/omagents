import type { Context } from "@deepseek-ai/cordis";
import { type DshRecoveryOutcome } from "./subagent-queries.js";
import type { DshJobBoard, DshJobRecord } from "./runtime.js";
export interface DshSubagentTracker {
    query(job: DshJobRecord): Promise<DshRecoveryOutcome>;
    cancel(job: DshJobRecord): Promise<void>;
    dispose(): void;
}
/** Adapt native DSH lifecycle events to the durable Core Board. */
export declare function createSubagentTracker(ctx: Context, board: DshJobBoard): DshSubagentTracker;
