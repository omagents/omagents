import type { Context } from "@deepseek-ai/cordis";
import { type DshHealth } from "./health.js";
import type { DshJobBoard } from "./runtime.js";
import type { DshSubagentTracker } from "./subagent-tracker.js";
/** Register canonical status and idempotent native-subagent cancellation tools. */
export declare function registerDshTools(ctx: Context, board: DshJobBoard, tracker?: DshSubagentTracker, health?: DshHealth): () => void;
