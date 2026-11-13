import { buildPsText } from "@omagents/core";
import { appendDshCapabilityDiagnostic, setDshCapabilityDiagnostics, } from "./health.js";
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Register a direct human command; its handler never creates a model prompt or message. */
export function registerDshCommands(ctx, board, health) {
    if (health)
        setDshCapabilityDiagnostics(health, "commands", []);
    const disposers = [];
    let capabilityFiber;
    let activeCleanup;
    let disposed = false;
    const report = (code, message) => {
        if (health)
            appendDshCapabilityDiagnostic(health, "commands", { code, message });
    };
    const cleanup = () => {
        if (activeCleanup === cleanup)
            activeCleanup = undefined;
        for (const dispose of disposers.splice(0).reverse()) {
            try {
                dispose();
            }
            catch (error) {
                report("ERR_DSH_COMMAND_DISPOSAL", `Unable to unregister a DSH command: ${errorMessage(error)}`);
            }
        }
    };
    const activate = (inner) => {
        if (disposed)
            return cleanup;
        if (activeCleanup)
            return activeCleanup;
        activeCleanup = cleanup;
        if (health)
            setDshCapabilityDiagnostics(health, "commands", []);
        try {
            if (typeof inner.commands?.register !== "function") {
                throw new Error("The DSH command registry is unavailable");
            }
            disposers.push(inner.commands.register({
                name: "ps",
                description: "Show tracked subagent jobs for the current session",
                recordInput: false,
                handler(invocation) {
                    try {
                        return {
                            kind: "success",
                            text: buildPsText(board, { parentSessionId: invocation.agent.session.id }),
                        };
                    }
                    catch (error) {
                        const message = `Unable to read the DSH Job Board: ${errorMessage(error)}`;
                        report("ERR_DSH_COMMAND_EXECUTION", message);
                        return { kind: "error", text: message };
                    }
                },
            }));
        }
        catch (error) {
            report("ERR_DSH_COMMAND_REGISTRATION", `Unable to register DSH /ps: ${errorMessage(error)}`);
        }
        return cleanup;
    };
    try {
        if (typeof ctx.inject === "function" &&
            typeof ctx.get === "function" &&
            !ctx.get("commands")) {
            capabilityFiber = ctx.inject(["commands"], activate);
        }
        else {
            activate(ctx);
        }
    }
    catch (error) {
        report("ERR_DSH_COMMANDS_UNAVAILABLE", `Unable to subscribe to DSH command availability: ${errorMessage(error)}`);
    }
    return () => {
        if (disposed)
            return;
        disposed = true;
        activeCleanup?.();
        try {
            const capabilityDisposal = capabilityFiber?.dispose();
            if (capabilityDisposal) {
                void capabilityDisposal.catch((error) => {
                    report("ERR_DSH_COMMAND_DISPOSAL", `Unable to dispose DSH command availability: ${errorMessage(error)}`);
                });
            }
        }
        catch (error) {
            report("ERR_DSH_COMMAND_DISPOSAL", `Unable to dispose DSH command availability: ${errorMessage(error)}`);
        }
    };
}
