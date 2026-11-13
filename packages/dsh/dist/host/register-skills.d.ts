import type { Context } from "@deepseek-ai/cordis";
import { type DshHealth } from "./health.js";
/** Register Core's complete DSH-rendered catalog in the native DSH registry. */
export declare function registerDshSkills(ctx: Context, health: DshHealth): () => void;
