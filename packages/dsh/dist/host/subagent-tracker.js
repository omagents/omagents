import { carrierKeyOf } from "@deepseek-ai/dsh-scope";
import { SessionId } from "@deepseek-ai/dsh-session";
import { outcomeFromSubagentEnd, queryDshSubagent, } from "./subagent-queries.js";
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "interrupted"]);
function correlationKey(parentSessionId, childId) {
    return JSON.stringify([parentSessionId, childId]);
}
function activationId(exec, result) {
    if (exec.name !== "subagent" || result.isError)
        return undefined;
    const value = result.value;
    if (typeof value !== "object" || value === null || !("kind" in value) || !("subagentId" in value)) {
        return undefined;
    }
    return value.kind === "activation" && typeof value.subagentId === "string" && value.subagentId
        ? value.subagentId
        : undefined;
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
export function createSubagentTracker(ctx, board) {
    const pendingResults = new Map();
    const pendingStarts = new Map();
    const runs = new Map();
    const runByJob = new Map();
    const jobByRun = new Map();
    const ends = new Map();
    const activeRuns = new Set();
    const parentByChild = new Map();
    const pendingCancels = new Map();
    const disposers = [];
    let capabilityFiber;
    let activeCleanup;
    let disposed = false;
    const report = (message, error) => {
        ctx.logger.warn(`omagents: ${message}: ${errorMessage(error)}`);
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
    const query = async (job) => {
        if (disposed)
            return { kind: "active" };
        const run = runByJob.get(job.id);
        const terminal = run ? ends.get(run.info.runId) : undefined;
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
    const onToolResult = (exec, result) => {
        if (disposed)
            return;
        const childId = activationId(exec, result);
        const parentSessionId = exec.agent?.session.id;
        if (!childId || !parentSessionId)
            return;
        const key = correlationKey(parentSessionId, childId);
        const pending = pendingResults.get(key) ?? [];
        pending.push({ exec, parentSessionId });
        pendingResults.set(key, pending);
        correlate(key);
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
    const onStart = function (info) {
        if (disposed)
            return;
        const parentAgent = carrierKeyOf(this);
        const parentSessionId = parentAgent?.session.id;
        if (parentSessionId)
            observeStart(info, parentSessionId);
    };
    const onEnd = function (info) {
        if (disposed)
            return;
        if (!jobByRun.has(info.runId)) {
            const parentAgent = carrierKeyOf(this);
            const parentSessionId = parentAgent?.session.id;
            const existing = board.list().find((job) => job.host === "dsh" &&
                job.hostTaskId === info.id &&
                (!parentSessionId || job.parentSessionId === parentSessionId));
            if (existing) {
                const run = {
                    info: {
                        runId: info.runId,
                        provider: info.provider,
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
                report("Unable to remove a DSH subagent listener", error);
            }
        }
    };
    const recover = () => {
        void board.reconcile({ query }).catch((error) => {
            if (!disposed)
                report("Unable to reconcile DSH subagent jobs", error);
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
            recover();
        }
        catch (error) {
            report("Unable to observe DSH subagent lifecycles", error);
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
        report("Unable to subscribe to DSH subagent availability", error);
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
                subagents.interrupt(SessionId(current.hostTaskId), {
                    kind: "user",
                    parentSessionId: SessionId(current.parentSessionId),
                });
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
                        report("Unable to dispose DSH subagent availability", error);
                    });
                }
            }
            catch (error) {
                report("Unable to dispose DSH subagent availability", error);
            }
            pendingResults.clear();
            pendingStarts.clear();
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
