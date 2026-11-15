import React from "react";
import type { JobDto } from "../../host/remote-types.js";
export interface JobTableProps {
    jobs: readonly JobDto[];
    now: number;
    cancellingIds?: readonly string[];
    onCancel(job: JobDto): void | Promise<void>;
}
export declare function formatElapsed(job: JobDto, now: number): string;
export declare function JobTable({ jobs, now, cancellingIds, onCancel }: JobTableProps): React.JSX.Element;
