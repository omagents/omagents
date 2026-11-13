import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useRef, useState } from "react";
import { styles } from "../classes.js";
import { CancelDialog } from "./CancelDialog.js";
import { JobDetails } from "./JobDetails.js";
import { StatusBadge } from "./StatusBadge.js";
const notificationLabels = {
    pending: "Pending notification",
    injected: "Injected notification",
    acknowledged: "Acknowledged notification",
};
function elapsedMilliseconds(job, now) {
    const end = job.terminalAt ?? now;
    return Math.max(0, end - job.launchedAt);
}
export function formatElapsed(job, now) {
    const seconds = Math.floor(elapsedMilliseconds(job, now) / 1_000);
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainder = seconds % 60;
    if (hours > 0)
        return `${hours}h ${minutes}m ${remainder}s`;
    if (minutes > 0)
        return `${minutes}m ${remainder}s`;
    return `${remainder}s`;
}
export function JobTable({ jobs, now, cancellingIds = [], onCancel }) {
    const [expanded, setExpanded] = useState(new Set());
    const [cancelTarget, setCancelTarget] = useState();
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    function toggleDetails(jobId) {
        setExpanded((current) => {
            const next = new Set(current);
            if (next.has(jobId))
                next.delete(jobId);
            else
                next.add(jobId);
            return next;
        });
    }
    async function confirmCancellation() {
        if (!cancelTarget || submittingRef.current)
            return;
        submittingRef.current = true;
        setSubmitting(true);
        try {
            await onCancel(cancelTarget);
            setCancelTarget(undefined);
        }
        finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    }
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.tableWrapper, children: _jsxs("table", { className: styles.table, "aria-label": "OmAgents background jobs", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Status" }), _jsx("th", { scope: "col", children: "Task" }), _jsx("th", { scope: "col", children: "Agent" }), _jsx("th", { scope: "col", children: "Elapsed" }), _jsx("th", { scope: "col", children: "Notification" }), _jsx("th", { scope: "col", children: "Started" }), _jsx("th", { scope: "col", children: "Actions" })] }) }), _jsx("tbody", { children: jobs.map((job) => {
                                const isExpanded = expanded.has(job.id);
                                const detailsId = `omagents-job-details-${job.id}`;
                                const isCancelling = job.executionState === "cancelling" || cancellingIds.includes(job.id);
                                const canCancel = job.executionState === "running" || job.executionState === "cancelling";
                                return (_jsx(JobRows, { job: job, now: now, isExpanded: isExpanded, detailsId: detailsId, isCancelling: isCancelling, canCancel: canCancel, onToggle: () => toggleDetails(job.id), onCancel: () => setCancelTarget(job) }, job.id));
                            }) })] }) }), cancelTarget && (_jsx(CancelDialog, { job: cancelTarget, pending: submitting, onClose: () => {
                    if (!submittingRef.current)
                        setCancelTarget(undefined);
                }, onConfirm: () => void confirmCancellation() }))] }));
}
function JobRows({ job, now, isExpanded, detailsId, isCancelling, canCancel, onToggle, onCancel, }) {
    return (_jsxs(_Fragment, { children: [_jsxs("tr", { children: [_jsx("td", { children: _jsx(StatusBadge, { state: job.executionState }) }), _jsx("td", { children: _jsx("button", { type: "button", className: styles.taskButton, "aria-label": `Details for ${job.description}`, "aria-expanded": isExpanded, "aria-controls": isExpanded ? detailsId : undefined, onClick: onToggle, children: job.description }) }), _jsx("td", { children: job.agent }), _jsx("td", { children: formatElapsed(job, now) }), _jsx("td", { children: job.notificationState ? notificationLabels[job.notificationState] : "No notification" }), _jsx("td", { children: _jsx("time", { dateTime: new Date(job.launchedAt).toISOString(), children: new Date(job.launchedAt).toLocaleString() }) }), _jsx("td", { children: canCancel && (_jsx("button", { type: "button", className: `${styles.button} ${styles.dangerButton}`, disabled: isCancelling, "aria-label": `${isCancelling ? "Cancelling" : "Cancel"} ${job.description}`, onClick: onCancel, children: isCancelling ? "Cancelling…" : "Cancel" })) })] }), isExpanded && (_jsx("tr", { children: _jsx("td", { colSpan: 7, children: _jsx(JobDetails, { id: detailsId, job: job }) }) }))] }));
}
