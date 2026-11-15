import { SessionId } from "@deepseek-ai/dsh-session";
import { principalOf, RemoteError } from "@deepseek-ai/dsh-typert-protocol";
/**
 * Adapt DSH's real remote-access rules to Job Board parent-session scopes.
 * Unscoped reads are admitted here and filtered per job by the Remote service.
 */
export function authorizeRemoteScope(ctx, scope) {
    if (scope.parentSessionId === undefined)
        return true;
    // principalOf returns undefined for both the owner and trusted in-process calls.
    if (principalOf(ctx.invocation) === undefined)
        return true;
    const remoteAccess = ctx.get("remoteAccess");
    if (!remoteAccess)
        return false;
    return remoteAccess.allows({ kind: "session", id: SessionId(scope.parentSessionId) });
}
export function scopeDenied(action, reason) {
    return new RemoteError("remote-access/denied", "OmAgents Job Board access is not authorized for this session scope", { action, reason });
}
export function jobNotFound(jobId) {
    return new RemoteError("omagents/job-not-found", "No OmAgents background job exists for the supplied ID", { jobId });
}
export function cancellationFailed(jobId, cause) {
    return new RemoteError("omagents/cancel-failed", "The native subagent cancellation could not be admitted", { jobId }, { cause });
}
export function badJobRequest(path, message) {
    return new RemoteError("gateway/bad-request", message, {
        issues: [{ path, message }],
    });
}
