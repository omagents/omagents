import type { DshHealth } from "./health.js";
import type { DshJobRecord } from "./runtime.js";
/** The only session selection accepted by the Remote Job Board API. */
export interface JobScope {
    parentSessionId?: string;
}
/** A detached, transport-safe snapshot of one Core Job Board record. */
export type JobDto = DshJobRecord;
/** A point-in-time snapshot; later records do not mutate this health frame. */
export type HealthDto = DshHealth;
/** One complete authorized Job Board set at a Core Board revision. */
export interface JobWatchFrame {
    revision: number;
    jobs: JobDto[];
}
