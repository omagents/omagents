import React from "react";
import type { Context } from "@deepseek-ai/cordis";
export { createJobBoardStore } from "./remote-store.js";
export type { JobBoardConnectionStatus, JobBoardSnapshot, JobBoardStore, OmAgentsJobRemote, } from "./remote-store.js";
export declare const PANEL_ID = "omagents";
export declare const inject: string[];
interface JobBoardIconProps {
    size?: number;
}
export declare function JobBoardIcon({ size }: JobBoardIconProps): React.ReactSVGElement;
/** Mount the Host Remote and attach the native panel to the package-root fiber. */
export declare function apply(ctx: Context): Promise<() => Promise<void>>;
