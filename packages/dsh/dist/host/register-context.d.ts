import type { Context } from "@deepseek-ai/cordis";
import { type DshHealth } from "./health.js";
import type { DshJobBoard } from "./runtime.js";
/** Register native instructions and required runtime state outside compactable message history. */
export declare function registerDshContext(ctx: Context, board: DshJobBoard, health?: DshHealth): () => void;
