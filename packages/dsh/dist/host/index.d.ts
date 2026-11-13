import type { Context } from "@deepseek-ai/cordis";
import { type DshRuntime } from "./runtime.js";
import { OmAgentsRemote } from "./remote-service.js";
export { createDshRuntime } from "./runtime.js";
export type { DshRuntime } from "./runtime.js";
export { registerDshCommands } from "./register-commands.js";
export { registerDshContext } from "./register-context.js";
export { registerDshMcp } from "./register-mcp.js";
export { provisionDshPython } from "./register-python.js";
export { registerDshSkills } from "./register-skills.js";
export { registerDshTools } from "./register-tools.js";
export { authorizeRemoteScope } from "./remote-access.js";
export type { AuthorizeScope } from "./remote-access.js";
export { OmAgentsRemote } from "./remote-service.js";
export type { OmAgentsRemoteOptions } from "./remote-service.js";
export type { HealthDto, JobDto, JobScope, JobWatchFrame } from "./remote-types.js";
export { createSubagentTracker } from "./subagent-tracker.js";
export type { DshSubagentTracker } from "./subagent-tracker.js";
export type { DshCapability, DshHealth, HealthDiagnostic, HealthRecord, HealthStatus, } from "./health.js";
declare module "@deepseek-ai/cordis" {
    interface Context {
        omagents?: DshRuntime;
        omagentsRemote?: OmAgentsRemote;
    }
}
export declare const name = "omagents";
export declare const inject: string[];
export declare function apply(ctx: Context): Promise<void>;
