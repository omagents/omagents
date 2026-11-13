import type { Context } from "@deepseek-ai/cordis";
import { type DshHealth } from "./health.js";
import type { DshJobBoard } from "./runtime.js";
/** Register only the read-only status tool; cancellation is added by the lifecycle adapter. */
export declare function registerDshTools(ctx: Context, board: DshJobBoard, health?: DshHealth): () => void;
