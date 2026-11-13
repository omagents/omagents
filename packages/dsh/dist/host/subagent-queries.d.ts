import type { Context } from "@deepseek-ai/cordis";
import { type SubagentRunEndInfo, type SubagentRunInfo } from "@deepseek-ai/dsh-subagent";
import type { DshJobRecord } from "./runtime.js";
export type DshTerminalState = "completed" | "failed" | "cancelled" | "interrupted";
export interface DshTerminalOutcome {
    state: DshTerminalState;
    resultSummary?: string;
    error?: {
        code: string;
        message: string;
    };
}
export type DshRecoveryOutcome = {
    kind: "active";
} | ({
    kind: "terminal";
} & DshTerminalOutcome) | {
    kind: "missing";
    reason: string;
} | {
    kind: "unreadable";
    reason: string;
};
export interface DshObservedRun {
    info: SubagentRunInfo;
    parentSessionId: string;
    outputStart?: number;
}
export interface DshQueryObservation {
    run?: DshObservedRun;
    terminal?: DshTerminalOutcome;
    hasActiveDescendants?: boolean;
}
export declare function summarizeAssistantMessage(message: SubagentRunEndInfo["lastAssistantMessage"]): string | undefined;
export declare function outcomeFromSubagentEnd(info: SubagentRunEndInfo): DshTerminalOutcome;
/** Query only observable lifecycle state and readable Session outcomes; never poll or infer success. */
export declare function queryDshSubagent(ctx: Context, job: DshJobRecord, observation?: DshQueryObservation): Promise<DshRecoveryOutcome>;
