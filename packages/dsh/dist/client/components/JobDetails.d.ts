import React from "react";
import type { JobDto } from "../../host/remote-types.js";
export interface JobDetailsProps {
    job: JobDto;
    id?: string;
}
export declare function JobDetails({ job, id }: JobDetailsProps): React.JSX.Element;
