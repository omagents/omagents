import type { Context } from "@deepseek-ai/cordis";
import { type DshRuntime } from "./runtime.js";
export { createDshRuntime } from "./runtime.js";
export type { DshRuntime } from "./runtime.js";
export type { DshHealth, HealthDiagnostic, HealthRecord, HealthStatus } from "./health.js";
declare module "@deepseek-ai/cordis" {
    interface Context {
        omagents?: DshRuntime;
    }
}
export declare const name = "omagents";
export declare const inject: string[];
export declare function apply(ctx: Context): Promise<void>;
