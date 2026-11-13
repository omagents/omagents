import { homedir } from "node:os";
import { join } from "node:path";
import { CORE_PYTHON_PACKAGES, ensureBaseEnvironment } from "@omagents/core";
import { appendDshCapabilityDiagnostic, setDshCapabilityDiagnostics, } from "./health.js";
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Start Core base provisioning without making DSH startup wait for Python or pip. */
export function provisionDshPython(ctx, health) {
    ctx.effect(() => {
        let active = true;
        setDshCapabilityDiagnostics(health, "python", []);
        const provisionBase = ctx.get("omagentsPython")?.ensureBaseEnvironment ?? ensureBaseEnvironment;
        const venvPath = join(homedir(), ".venvs", "omagents");
        const env = { ...process.env };
        void (async () => {
            try {
                await provisionBase({
                    venvPath,
                    corePackages: CORE_PYTHON_PACKAGES,
                    env,
                });
                if (active)
                    setDshCapabilityDiagnostics(health, "python", []);
            }
            catch (error) {
                if (!active)
                    return;
                appendDshCapabilityDiagnostic(health, "python", {
                    code: "ERR_DSH_PYTHON_PROVISIONING",
                    message: `Unable to provision the OmAgents Python base at ${venvPath}: ${errorMessage(error)}. ` +
                        "Python 3.11+ is required; install it and restart DSH. Project overlays remain on demand.",
                });
            }
        })();
        return () => {
            active = false;
        };
    }, "omagents python provisioning");
}
