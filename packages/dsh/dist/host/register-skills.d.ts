import type { Context } from "@deepseek-ai/cordis";
import { type DshHealth } from "./health.js";
/** Register Core's complete DSH-rendered catalog when the native registry is available. */
export declare function registerDshSkills(ctx: Context, health: DshHealth): () => void;
