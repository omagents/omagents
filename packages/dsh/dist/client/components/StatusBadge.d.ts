import React from "react";
import type { JobDto } from "../../host/remote-types.js";
export interface StatusBadgeProps {
    state: JobDto["executionState"];
}
export declare function StatusBadge({ state }: StatusBadgeProps): React.JSX.Element;
