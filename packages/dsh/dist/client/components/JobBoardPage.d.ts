import React from "react";
import type { JobBoardStore } from "../remote-store.js";
export interface JobBoardPageProps {
    store: JobBoardStore;
}
export type JobFilter = "all" | "running" | "attention" | "finished";
export declare function JobBoardPage({ store }: JobBoardPageProps): React.JSX.Element;
