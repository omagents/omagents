import type { Context } from "@deepseek-ai/cordis";
import { type DshRuntime } from "./runtime.js";
export { createDshRuntime } from "./runtime.js";
export type { DshRuntime } from "./runtime.js";
export { registerDshCommands } from "./register-commands.js";
export { registerDshContext } from "./register-context.js";
export { registerDshMcp } from "./register-mcp.js";
export { provisionDshPython } from "./register-python.js";
export { registerDshSkills } from "./register-skills.js";
export { registerDshTools } from "./register-tools.js";
export { createSubagentTracker } from "./subagent-tracker.js";
export type { DshSubagentTracker } from "./subagent-tracker.js";
export type { DshCapability, DshHealth, HealthDiagnostic, HealthRecord, HealthStatus, } from "./health.js";
declare module "@deepseek-ai/cordis" {
    interface Context {
        omagents?: DshRuntime;
    }
}
export declare const name = "omagents";
export declare const inject: string[];
export declare function apply(ctx: Context): Promise<void>;
