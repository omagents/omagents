import { foldConsumedWork } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import { finalAssistantOutput, foldSubagentDescriptor, } from "@deepseek-ai/dsh-subagent";
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function isMissingSessionError(error) {
    return ((error instanceof Error && error.name === "SessionPersistenceNotFoundError") ||
        (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "SESSION_QUERY_SESSION_NOT_FOUND"));
}
export function summarizeAssistantMessage(message) {
    if (!message || message.length === 0)
        return undefined;
    const summary = message
        .map((block) => (block.type === "text" ? block.text : JSON.stringify(block)))
        .filter((text) => text.length > 0)
        .join("\n");
    return summary || undefined;
}
function stopReasonError(stopReason) {
    switch (stopReason) {
        case "error":
            return { code: "SUBAGENT_ERROR", message: "Subagent turn ended with error" };
        case "max-tokens":
            return { code: "SUBAGENT_MAX_TOKENS", message: "Subagent reached its token ceiling" };
        case "refusal":
            return { code: "SUBAGENT_REFUSAL", message: "Subagent declined the task" };
        default:
            return {
                code: "SUBAGENT_UNKNOWN_STOP_REASON",
                message: `Subagent ended abnormally (${String(stopReason)})`,
            };
    }
}
function outcomeFromStopReason(stopReason, resultSummary) {
    const summary = resultSummary === undefined ? {} : { resultSummary };
    if (stopReason === "completed")
        return { state: "completed", ...summary };
    if (stopReason === "interrupted")
        return { state: "interrupted", ...summary };
    if (stopReason === "aborted")
        return { state: "cancelled", ...summary };
    return { state: "failed", ...summary, error: stopReasonError(stopReason) };
}
export function outcomeFromSubagentEnd(info) {
    return outcomeFromStopReason(info.stopReason, summarizeAssistantMessage(info.lastAssistantMessage));
}
function hasOpenTurn(events) {
    const open = new Set();
    for (const event of events) {
        if (event.type === "turn/start")
            open.add(event.data.turn);
        else if (event.type === "turn/end")
            open.delete(event.data.turn);
    }
    return open.size > 0;
}
function stopReasonFromEvents(events) {
    const { end, droppedUnrun } = foldConsumedWork(events);
    if (!end)
        return droppedUnrun ? "aborted" : undefined;
    switch (end.data.reason.kind) {
        case "completed":
            return droppedUnrun ? "aborted" : "completed";
        case "aborted":
            return "aborted";
        case "interrupted":
            return "interrupted";
        case "error":
            return "error";
        case "max-tokens":
            return "max-tokens";
        case "blocked":
            return "refusal";
        default:
            return "error";
    }
}
function ownEvents(snapshot) {
    return snapshot.events.slice(snapshot.inheritedEventCount ?? 0);
}
function activationEvents(snapshot, outputStart, requireDescriptor) {
    if (outputStart !== undefined)
        return snapshot.events.slice(outputStart);
    const events = ownEvents(snapshot);
    const descriptorIndex = events.findIndex((event) => event.type === "subagent/descriptor");
    if (descriptorIndex < 0)
        return requireDescriptor ? undefined : events;
    try {
        if (foldSubagentDescriptor(events) === undefined)
            return undefined;
    }
    catch {
        return undefined;
    }
    return events.slice(descriptorIndex + 1);
}
function outcomeFromSnapshot(snapshot, observation, liveAgent) {
    const events = activationEvents(snapshot, observation.run?.outputStart, !observation.run);
    if (!events) {
        return {
            kind: "unreadable",
            reason: "The subagent Session has no supported descriptor or activation boundary",
        };
    }
    const mayStillBeActive = liveAgent || observation.run !== undefined;
    if (hasOpenTurn(events)) {
        return mayStillBeActive
            ? { kind: "active" }
            : { kind: "missing", reason: "The stored subagent turn has no terminal outcome" };
    }
    const stopReason = stopReasonFromEvents(events);
    if (!stopReason) {
        return mayStillBeActive
            ? { kind: "active" }
            : { kind: "missing", reason: "The stored subagent Session has no readable terminal outcome" };
    }
    const summary = summarizeAssistantMessage(finalAssistantOutput(events));
    return { kind: "terminal", ...outcomeFromStopReason(stopReason, summary) };
}
function missingOutcome(job) {
    return {
        kind: "missing",
        reason: `No live Agent or readable outcome exists for ${job.agent === "external" ? "external " : ""}subagent "${job.hostTaskId}"`,
    };
}
/** Query only observable lifecycle state and readable Session outcomes; never poll or infer success. */
export async function queryDshSubagent(ctx, job, observation = {}) {
    if (observation.terminal)
        return { kind: "terminal", ...observation.terminal };
    if (observation.hasActiveDescendants)
        return { kind: "active" };
    const agent = ctx.get("agents")?.get(SessionId(job.hostTaskId));
    if (agent) {
        if (agent.status === "running")
            return { kind: "active" };
        try {
            return outcomeFromSnapshot({
                events: agent.session.snapshotEvents(),
                inheritedEventCount: agent.session.inheritedEventCount,
            }, observation, true);
        }
        catch (error) {
            return { kind: "unreadable", reason: errorMessage(error) };
        }
    }
    const sessionQuery = ctx.get("sessionQuery");
    if (typeof sessionQuery?.readSession === "function") {
        try {
            const snapshot = await sessionQuery.readSession(SessionId(job.hostTaskId));
            if (observation.hasActiveDescendants)
                return { kind: "active" };
            return outcomeFromSnapshot({
                events: snapshot.events,
                ...(snapshot.inheritedEventCount === undefined
                    ? {}
                    : { inheritedEventCount: snapshot.inheritedEventCount }),
            }, observation, false);
        }
        catch (error) {
            if (isMissingSessionError(error)) {
                if (observation.run)
                    return { kind: "active" };
                return { kind: "missing", reason: errorMessage(error) };
            }
            return { kind: "unreadable", reason: errorMessage(error) };
        }
    }
    if (observation.run)
        return { kind: "active" };
    return missingOutcome(job);
}
