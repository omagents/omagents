import { SessionId } from "@deepseek-ai/dsh-session";
import { appendDshCapabilityDiagnostic, setDshCapabilityDiagnostics, } from "./health.js";
import { outcomeFromSubagentEnd, queryDshSubagent, } from "./subagent-queries.js";
const TRACKING_LISTENER_ERROR = "ERR_DSH_TRACKING_LISTENERS";
const TRACKING_ACTIVATION_ERROR = "ERR_DSH_TRACKING_ACTIVATION";
const TRACKING_RECOVERY_ERROR = "ERR_DSH_TRACKING_RECOVERY";
const TRACKING_SUBSCRIPTION_ERROR = "ERR_DSH_TRACKING_SUBSCRIPTION";
const TRACKING_DISPOSAL_ERROR = "ERR_DSH_TRACKING_DISPOSAL";
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "interrupted"]);
function correlationKey(parentSessionId, childId) {
    return JSON.stringify([parentSessionId, childId]);
}
function activationReference(exec, result) {
    if (exec.name !== "subagent" || result.isError)
        return undefined;
    const value = result.value;
    if (typeof value !== "object" || value === null)
        return undefined;
    if (!("kind" in value) || value.kind !== "activation")
        return undefined;
    for (const field of ["subagentId", "childId"]) {
        const id = value[field];
        if (typeof id === "string" && id)
            return { childId: id };
    }
    // DSH 0.2.2-rc.2+ reports only the model-facing child name; it is resolved
    // back to the durable child Session id that lifecycle events carry.
    const name = value.name;
    return typeof name === "string" && name ? { name } : undefined;
}
function activationDescription(exec, childId) {
    const args = exec.arguments;
    if (typeof args === "object" && args !== null && "description" in args) {
        const description = args.description;
        if (typeof description === "string" && description.trim())
            return description;
    }
    return childId;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Adapt native DSH lifecycle events to the durable Core Board. */
export function createSubagentTracker(ctx, board, health) {
    if (health)
        setDshCapabilityDiagnostics(health, "tracking", []);
    const pendingResults = new Map();
    const pendingStarts = new Map();
    const orphanEnds = new Map();
    const runs = new Map();
    const runByJob = new Map();
    const jobByRun = new Map();
    const ends = new Map();
    const activeRuns = new Set();
    const parentByChild = new Map();
    const pendingCancels = new Map();
    const disposers = [];
    let capabilityFiber;
    let recoveryFiber;
    let activeCleanup;
    let disposed = false;
    const clearFailure = (code) => {
        if (!health)
            return;
        const remaining = health.tracking.diagnostics.filter((diagnostic) => diagnostic.code !== code);
        if (remaining.length !== health.tracking.diagnostics.length) {
            setDshCapabilityDiagnostics(health, "tracking", remaining);
        }
    };
    const report = (code, message, error) => {
        const detail = `${message}: ${errorMessage(error)}`;
        ctx.logger.warn(`omagents: ${detail}`);
        if (!health)
            return;
        clearFailure(code);
        appendDshCapabilityDiagnostic(health, "tracking", { code, message: detail });
    };
    const hasActiveDescendants = (rootSessionId) => {
        for (const runId of activeRuns) {
            const run = runs.get(runId);
            if (!run)
                continue;
            let parent = run.parentSessionId;
            const visited = new Set();
            while (parent && !visited.has(parent)) {
                if (parent === rootSessionId)
                    return true;
                visited.add(parent);
                parent = parentByChild.get(parent) ?? "";
            }
        }
        return false;
    };
    const queryNative = async (job) => {
        if (disposed)
            return { kind: "active" };
        const run = runByJob.get(job.id);
        const terminal = run ? ends.get(run.info.runId) : undefined;
        const agents = ctx.get("agents");
        const liveAgent = agents?.get(SessionId(job.hostTaskId));
        if (!terminal &&
            !liveAgent &&
            (!agents || typeof ctx.get("sessionQuery")?.readSession !== "function")) {
            // Remote reads may arrive before recovery capabilities activate. A cold
            // native query is not safe until both live-Agent and Session lookup exist.
            return { kind: "active" };
        }
        const outcome = await queryDshSubagent(ctx, job, {
            ...(run ? { run } : {}),
            ...(terminal ? { terminal } : {}),
            ...(run && hasActiveDescendants(job.hostTaskId) ? { hasActiveDescendants: true } : {}),
        });
        // A native settlement racing a slow Session read is newer authoritative data.
        const latestRun = runByJob.get(job.id);
        const latestTerminal = latestRun ? ends.get(latestRun.info.runId) : undefined;
        return latestTerminal ? { kind: "terminal", ...latestTerminal } : outcome;
    };
    const query = async (job) => {
        try {
            const outcome = await queryNative(job);
            clearFailure(TRACKING_RECOVERY_ERROR);
            return outcome;
        }
        catch (error) {
            report(TRACKING_RECOVERY_ERROR, "Unable to query DSH subagent recovery state", error);
            throw error;
        }
    };
    const applyTerminal = (runId, outcome) => {
        const jobId = jobByRun.get(runId);
        if (!jobId)
            return;
        board.markTerminal(jobId, outcome);
        const job = board.get(jobId);
        if (job?.notificationState === "pending")
            board.markInjected([jobId]);
    };
    const correlate = (key) => {
        const starts = pendingStarts.get(key);
        const results = pendingResults.get(key);
        while (starts?.length && results?.length) {
            const start = starts.shift();
            const result = results.shift();
            const { run } = start;
            const job = board.registerLaunch({
                host: "dsh",
                hostTaskId: run.info.id,
                parentSessionId: result.parentSessionId,
                childName: run.info.id,
                agent: run.info.provider,
                description: activationDescription(result.exec, run.info.id),
            });
            jobByRun.set(run.info.runId, job.id);
            runByJob.set(job.id, run);
            const end = ends.get(run.info.runId);
            if (end)
                applyTerminal(run.info.runId, end);
        }
        if (starts?.length === 0)
            pendingStarts.delete(key);
        if (results?.length === 0)
            pendingResults.delete(key);
    };
    const recordActivationResult = (exec, parentSessionId, childId) => {
        const key = correlationKey(parentSessionId, childId);
        const pending = pendingResults.get(key) ?? [];
        pending.push({ exec, parentSessionId });
        pendingResults.set(key, pending);
        const orphans = orphanEnds.get(key);
        const orphan = orphans?.shift();
        if (orphan) {
            observeStart(orphan, parentSessionId);
            activeRuns.delete(orphan.runId);
            if (orphans?.length === 0)
                orphanEnds.delete(key);
        }
        correlate(key);
    };
    const onToolResult = (exec, result) => {
        if (disposed)
            return;
        const reference = activationReference(exec, result);
        const caller = exec.agent;
        const parentSessionId = caller?.session.id;
        if (!reference || !caller || !parentSessionId)
            return;
        if (reference.childId) {
            recordActivationResult(exec, parentSessionId, reference.childId);
            return;
        }
        const subagents = ctx.get("subagents");
        const name = reference.name;
        if (!name || typeof subagents?.resolveName !== "function")
            return;
        void subagents
            .resolveName(caller, name, exec.signal)
            .then((childId) => {
            if (!disposed)
                recordActivationResult(exec, parentSessionId, childId);
        })
            .catch((error) => {
            if (!disposed) {
                report(TRACKING_ACTIVATION_ERROR, `Unable to resolve subagent "${name}"`, error);
            }
        });
    };
    const recordEnd = (info) => {
        if (disposed)
            return;
        activeRuns.delete(info.runId);
        const next = outcomeFromSubagentEnd(info);
        const previous = ends.get(info.runId);
        const outcome = previous && previous.state === next.state
            ? {
                state: previous.state,
                ...(previous.resultSummary !== undefined || next.resultSummary !== undefined
                    ? { resultSummary: previous.resultSummary ?? next.resultSummary }
                    : {}),
                ...(previous.error !== undefined || next.error !== undefined
                    ? { error: previous.error ?? next.error }
                    : {}),
            }
            : previous ?? next;
        ends.set(info.runId, outcome);
        applyTerminal(info.runId, outcome);
    };
    const observeStart = (info, parentSessionId) => {
        const child = ctx.get("agents")?.get(info.id);
        const run = {
            info,
            parentSessionId,
            ...(child?.session.seq === undefined ? {} : { outputStart: child.session.seq }),
        };
        runs.set(info.runId, run);
        activeRuns.add(info.runId);
        parentByChild.set(info.id, parentSessionId);
        const key = correlationKey(parentSessionId, info.id);
        const pending = pendingStarts.get(key) ?? [];
        pending.push({ run });
        pendingStarts.set(key, pending);
        correlate(key);
    };
    const onStart = (info) => {
        if (disposed)
            return;
        if (info.parentSessionId)
            observeStart(info, info.parentSessionId);
    };
    const onEnd = (info) => {
        if (disposed)
            return;
        if (!jobByRun.has(info.runId)) {
            const parentSessionId = info.parentSessionId;
            const existing = board.list().find((job) => job.host === "dsh" &&
                job.hostTaskId === info.id &&
                (!parentSessionId || job.parentSessionId === parentSessionId));
            if (existing) {
                const run = {
                    info: {
                        runId: info.runId,
                        provider: info.provider,
                        parentSessionId: info.parentSessionId,
                        id: info.id,
                        local: info.local,
                    },
                    parentSessionId: existing.parentSessionId,
                };
                runs.set(info.runId, run);
                runByJob.set(existing.id, run);
                jobByRun.set(info.runId, existing.id);
                parentByChild.set(info.id, existing.parentSessionId);
            }
            else if (parentSessionId && pendingResults.has(correlationKey(parentSessionId, info.id))) {
                // The activation result can be observed even if this adapter attached after start.
                observeStart(info, parentSessionId);
            }
            else if (parentSessionId) {
                // Retain end-before-result metadata by the same identity used for activation results.
                const key = correlationKey(parentSessionId, info.id);
                const pending = orphanEnds.get(key) ?? [];
                pending.push(info);
                orphanEnds.set(key, pending);
            }
        }
        recordEnd(info);
    };
    const cleanup = () => {
        if (activeCleanup === cleanup)
            activeCleanup = undefined;
        for (const dispose of disposers.splice(0).reverse()) {
            try {
                dispose();
            }
            catch (error) {
                report(TRACKING_DISPOSAL_ERROR, "Unable to remove a DSH subagent listener", error);
            }
        }
    };
    const recover = () => {
        void board
            .reconcile({ query })
            .then(() => {
            if (!disposed)
                clearFailure(TRACKING_RECOVERY_ERROR);
        })
            .catch((error) => {
            if (!disposed) {
                report(TRACKING_RECOVERY_ERROR, "Unable to reconcile DSH subagent jobs", error);
            }
        });
    };
    const activate = (inner) => {
        if (disposed)
            return cleanup;
        if (activeCleanup)
            return activeCleanup;
        activeCleanup = cleanup;
        try {
            disposers.push(inner.on("tools/result", onToolResult), inner.on("subagent/start", onStart), inner.on("subagent/end", onEnd));
            clearFailure(TRACKING_LISTENER_ERROR);
            clearFailure(TRACKING_SUBSCRIPTION_ERROR);
        }
        catch (error) {
            report(TRACKING_LISTENER_ERROR, "Unable to observe DSH subagent lifecycles", error);
            cleanup();
        }
        return cleanup;
    };
    try {
        if (typeof ctx.inject === "function" &&
            typeof ctx.get === "function" &&
            (!ctx.get("tools") || !ctx.get("subagents"))) {
            capabilityFiber = ctx.inject(["tools", "subagents"], activate);
        }
        else {
            activate(ctx);
        }
    }
    catch (error) {
        report(TRACKING_SUBSCRIPTION_ERROR, "Unable to subscribe to DSH subagent availability", error);
    }
    const activateRecovery = (_inner) => {
        if (!disposed)
            recover();
        return () => { };
    };
    try {
        if (typeof ctx.inject === "function" &&
            typeof ctx.get === "function" &&
            (!ctx.get("tools") || !ctx.get("subagents") || !ctx.get("agents") || !ctx.get("sessionQuery"))) {
            recoveryFiber = ctx.inject(["tools", "subagents", "agents", "sessionQuery"], activateRecovery);
        }
        else {
            activateRecovery(ctx);
        }
    }
    catch (error) {
        report(TRACKING_SUBSCRIPTION_ERROR, "Unable to subscribe to DSH recovery availability", error);
    }
    return {
        query,
        async cancel(job) {
            if (disposed)
                throw new Error("The DSH subagent tracker is disposed");
            const current = board.get(job.id) ?? job;
            if (TERMINAL_STATES.has(current.executionState) || current.executionState === "cancelling") {
                return;
            }
            const pending = pendingCancels.get(job.id);
            if (pending)
                return pending;
            const cancellation = (async () => {
                const subagents = ctx.get("subagents");
                if (typeof subagents?.interrupt !== "function") {
                    throw new Error("DSH subagent interruption is unavailable");
                }
                // DSH 0.2.2's user-authority interrupt returns after admission, not settlement.
                subagents.interrupt(SessionId(current.hostTaskId), { kind: "user" });
                if (!disposed)
                    board.requestCancellation(job.id);
            })();
            pendingCancels.set(job.id, cancellation);
            try {
                await cancellation;
            }
            finally {
                pendingCancels.delete(job.id);
            }
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            cleanup();
            try {
                const capabilityDisposal = capabilityFiber?.dispose();
                if (capabilityDisposal) {
                    void capabilityDisposal.catch((error) => {
                        report(TRACKING_DISPOSAL_ERROR, "Unable to dispose DSH subagent availability", error);
                    });
                }
            }
            catch (error) {
                report(TRACKING_DISPOSAL_ERROR, "Unable to dispose DSH subagent availability", error);
            }
            try {
                const recoveryDisposal = recoveryFiber?.dispose();
                if (recoveryDisposal) {
                    void recoveryDisposal.catch((error) => {
                        report(TRACKING_DISPOSAL_ERROR, "Unable to dispose DSH recovery availability", error);
                    });
                }
            }
            catch (error) {
                report(TRACKING_DISPOSAL_ERROR, "Unable to dispose DSH recovery availability", error);
            }
            pendingResults.clear();
            pendingStarts.clear();
            orphanEnds.clear();
            runs.clear();
            runByJob.clear();
            jobByRun.clear();
            ends.clear();
            activeRuns.clear();
            parentByChild.clear();
            pendingCancels.clear();
        },
    };
}
