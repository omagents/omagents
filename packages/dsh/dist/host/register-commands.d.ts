import type { Context } from "@deepseek-ai/cordis";
import { type DshHealth } from "./health.js";
import type { DshJobBoard } from "./runtime.js";
/** Register a direct human command; its handler never creates a model prompt or message. */
export declare function registerDshCommands(ctx: Context, board: DshJobBoard, health?: DshHealth): () => void;
