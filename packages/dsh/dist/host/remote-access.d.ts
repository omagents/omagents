import type { Context } from "@deepseek-ai/cordis";
import { RemoteError, type RemoteErrorCode } from "@deepseek-ai/dsh-typert-protocol";
import type { JobScope } from "./remote-types.js";
declare module "@deepseek-ai/dsh-typert-protocol" {
    interface RemoteErrorDetailsMap {
        "omagents/job-not-found": {
            readonly jobId: string;
        };
        "omagents/cancel-failed": {
            readonly jobId: string;
        };
    }
}
/** Business authorization evaluated against the invocation-derived Service Context. */
export type AuthorizeScope = (ctx: Context, scope: Readonly<JobScope>) => boolean;
/**
 * Adapt DSH's real remote-access rules to Job Board parent-session scopes.
 * Unscoped reads are admitted here and filtered per job by the Remote service.
 */
export declare function authorizeRemoteScope(ctx: Context, scope: Readonly<JobScope>): boolean;
export declare function scopeDenied(action: string, reason: "session-scope-unauthorized" | "job-unauthorized"): RemoteError<RemoteErrorCode>;
export declare function jobNotFound(jobId: string): RemoteError<"omagents/job-not-found">;
export declare function cancellationFailed(jobId: string, cause: unknown): RemoteError<"omagents/cancel-failed">;
export declare function badJobRequest(path: string, message: string): RemoteError<"gateway/bad-request">;
