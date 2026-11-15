import React from "react";
import type { JobDto } from "../../host/remote-types.js";
export interface CancelDialogProps {
    job: JobDto;
    pending: boolean;
    onClose(): void;
    onConfirm(): void;
}
export declare function CancelDialog({ job, pending, onClose, onConfirm }: CancelDialogProps): React.JSX.Element;
