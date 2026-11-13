import type { Context } from "@deepseek-ai/cordis"
import type { RemoteAccessService } from "@deepseek-ai/dsh-api-remote-access"
import { SessionId } from "@deepseek-ai/dsh-session"
import {
  principalOf,
  RemoteError,
  type RemoteErrorCode,
} from "@deepseek-ai/dsh-typert-protocol"

import type { JobScope } from "./remote-types.js"

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap {
    "omagents/job-not-found": {
      readonly jobId: string
    }
    "omagents/cancel-failed": {
      readonly jobId: string
    }
  }
}

/** Business authorization evaluated against the invocation-derived Service Context. */
export type AuthorizeScope = (ctx: Context, scope: Readonly<JobScope>) => boolean

/**
 * Adapt DSH's real remote-access rules to Job Board parent-session scopes.
 * Unscoped reads are admitted here and filtered per job by the Remote service.
 */
export function authorizeRemoteScope(ctx: Context, scope: Readonly<JobScope>): boolean {
  if (scope.parentSessionId === undefined) return true
  // principalOf returns undefined for both the owner and trusted in-process calls.
  if (principalOf(ctx.invocation) === undefined) return true
  const remoteAccess = ctx.remoteAccess as RemoteAccessService | undefined
  if (!remoteAccess) return false
  return remoteAccess.allows({ kind: "session", id: SessionId(scope.parentSessionId) })
}

export function scopeDenied(
  action: string,
  reason: "session-scope-unauthorized" | "job-unauthorized"
): RemoteError<RemoteErrorCode> {
  return new RemoteError(
    "remote-access/denied",
    "OmAgents Job Board access is not authorized for this session scope",
    { action, reason }
  )
}

export function jobNotFound(jobId: string): RemoteError<"omagents/job-not-found"> {
  return new RemoteError(
    "omagents/job-not-found",
    "No OmAgents background job exists for the supplied ID",
    { jobId }
  )
}

export function cancellationFailed(jobId: string, cause: unknown): RemoteError<"omagents/cancel-failed"> {
  return new RemoteError(
    "omagents/cancel-failed",
    "The native subagent cancellation could not be admitted",
    { jobId },
    { cause }
  )
}

export function badJobRequest(path: string, message: string): RemoteError<"gateway/bad-request"> {
  return new RemoteError("gateway/bad-request", message, {
    issues: [{ path, message }],
  })
}
