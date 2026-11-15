import type { RemoteResult, RemoteStreamHandle } from "@deepseek-ai/dsh-typert-protocol";
import type { HealthDto, JobDto, JobScope, JobWatchFrame } from "../host/remote-types.js";
/** Host-for-Client Remote metadata mounted by the browser Client. */
export declare const TYPERT_REMOTE: import("@deepseek-ai/dsh-typert-protocol").TypertRemoteInfo<Readonly<Record<string, import("@deepseek-ai/dsh-typert-protocol").TypertRemoteMethod<object, unknown, "unary", never, unknown> | import("@deepseek-ai/dsh-typert-protocol").TypertRemoteMethod<object, unknown, "stream", unknown, unknown>>>>;
declare module "@deepseek-ai/dsh-typert-protocol" {
    interface TypertRemoteNamespace$6f6d6167656e7473 {
        listJobs(scope: JobScope): Promise<RemoteResult<JobDto[]>>;
        cancelJob(jobId: string): Promise<RemoteResult<JobDto>>;
        getHealth(): Promise<RemoteResult<HealthDto>>;
        watchJobs(scope: JobScope, signal?: AbortSignal): RemoteStreamHandle<JobWatchFrame, never>;
    }
    interface TypertRemoteMap {
        "omagents/listJobs": (scope: JobScope) => Promise<RemoteResult<JobDto[]>>;
        "omagents/cancelJob": (jobId: string) => Promise<RemoteResult<JobDto>>;
        "omagents/getHealth": () => Promise<RemoteResult<HealthDto>>;
        "omagents/watchJobs": (scope: JobScope, signal?: AbortSignal) => RemoteStreamHandle<JobWatchFrame, never>;
    }
    interface TypertRemoteNamespaceMap {
        omagents: TypertRemoteNamespace$6f6d6167656e7473;
    }
}
