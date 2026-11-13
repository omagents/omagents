import { appendDshCapabilityDiagnostic, setDshCapabilityDiagnostics, } from "./health.js";
import { buildDshStatePreservationContext, buildDshTopLevelInstructions, DSH_JOB_BOARD_CONTEXT_NAME, DSH_PARALLEL_SECTION_NAME, DSH_STATE_PRESERVATION_NOTE, } from "./prompt.js";
const CONTEXT_ASSEMBLY_ERROR = "ERR_DSH_CONTEXT_ASSEMBLY";
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Register native instructions and required runtime state outside compactable message history. */
export function registerDshContext(ctx, board, health) {
    if (health)
        setDshCapabilityDiagnostics(health, "context", []);
    const disposers = [];
    let capabilityFiber;
    let activeCleanup;
    let disposed = false;
    const report = (code, message) => {
        if (health)
            appendDshCapabilityDiagnostic(health, "context", { code, message });
    };
    const reportAssemblyFailure = (error) => {
        if (!health)
            return;
        setDshCapabilityDiagnostics(health, "context", [
            ...health.context.diagnostics.filter((diagnostic) => diagnostic.code !== CONTEXT_ASSEMBLY_ERROR),
            {
                code: CONTEXT_ASSEMBLY_ERROR,
                message: `Unable to project the DSH Job Board into model context: ${errorMessage(error)}`,
            },
        ]);
    };
    const clearAssemblyFailure = () => {
        if (!health)
            return;
        const remaining = health.context.diagnostics.filter((diagnostic) => diagnostic.code !== CONTEXT_ASSEMBLY_ERROR);
        if (remaining.length !== health.context.diagnostics.length) {
            setDshCapabilityDiagnostics(health, "context", remaining);
        }
    };
    const cleanup = () => {
        if (activeCleanup === cleanup)
            activeCleanup = undefined;
        for (const dispose of disposers.splice(0).reverse()) {
            try {
                dispose();
            }
            catch (error) {
                report("ERR_DSH_CONTEXT_DISPOSAL", `Unable to unregister DSH model context: ${errorMessage(error)}`);
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
            setDshCapabilityDiagnostics(health, "context", []);
        if (typeof inner.systemPrompt?.section !== "function" || !inner.systemPrompt.context) {
            report("ERR_DSH_CONTEXT_UNAVAILABLE", "Unable to initialize DSH model context: the systemPrompt registry is unavailable");
            return cleanup;
        }
        try {
            disposers.push(inner.systemPrompt.section({
                name: DSH_PARALLEL_SECTION_NAME,
                order: inner.systemPrompt.getSectionOrder("TOOL_SUBAGENT") + 1,
                text: (assembly) => {
                    const session = assembly.agent?.session;
                    return buildDshTopLevelInstructions(session?.origin === "subagent");
                },
                interpolate: false,
            }));
        }
        catch (error) {
            report("ERR_DSH_CONTEXT_REGISTRATION", `Unable to register DSH parallel instructions: ${errorMessage(error)}`);
        }
        try {
            disposers.push(inner.systemPrompt.context({
                name: DSH_JOB_BOARD_CONTEXT_NAME,
                order: inner.systemPrompt.getContextOrder("SUBAGENT_DELEGATION") + 1,
                required: true,
                interpolate: false,
                text: (assembly) => {
                    try {
                        const agent = assembly.agent;
                        const text = buildDshStatePreservationContext(board, agent?.session.id);
                        clearAssemblyFailure();
                        return text;
                    }
                    catch (error) {
                        reportAssemblyFailure(error);
                        // A Board projection problem must never reject a model request.
                        return DSH_STATE_PRESERVATION_NOTE;
                    }
                },
            }));
        }
        catch (error) {
            report("ERR_DSH_CONTEXT_REGISTRATION", `Unable to register DSH Job Board context: ${errorMessage(error)}`);
        }
        return cleanup;
    };
    try {
        if (typeof ctx.inject === "function" &&
            typeof ctx.get === "function" &&
            !ctx.get("systemPrompt")) {
            capabilityFiber = ctx.inject(["systemPrompt"], activate);
        }
        else {
            activate(ctx);
        }
    }
    catch (error) {
        report("ERR_DSH_CONTEXT_UNAVAILABLE", `Unable to subscribe to DSH systemPrompt availability: ${errorMessage(error)}`);
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
                    report("ERR_DSH_CONTEXT_DISPOSAL", `Unable to dispose DSH systemPrompt availability: ${errorMessage(error)}`);
                });
            }
        }
        catch (error) {
            report("ERR_DSH_CONTEXT_DISPOSAL", `Unable to dispose DSH systemPrompt availability: ${errorMessage(error)}`);
        }
    };
}
