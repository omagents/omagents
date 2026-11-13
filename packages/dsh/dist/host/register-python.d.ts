import type { Context } from "@deepseek-ai/cordis";
import { ensureBaseEnvironment } from "@omagents/core";
import { type DshHealth } from "./health.js";
export interface DshPythonEnvironment {
    ensureBaseEnvironment: typeof ensureBaseEnvironment;
}
declare module "@deepseek-ai/cordis" {
    interface Context {
        /** Internal provisioning seam; production uses Core, tests inject an isolated implementation. */
        omagentsPython?: DshPythonEnvironment;
    }
}
/** Start Core base provisioning without making DSH startup wait for Python or pip. */
export declare function provisionDshPython(ctx: Context, health: DshHealth): void;
