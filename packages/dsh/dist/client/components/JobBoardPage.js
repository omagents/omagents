import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useMemo, useState } from "react";
import { useSyncExternalStore } from "react";
import { styles } from "../classes.js";
import { JobTable } from "./JobTable.js";
const terminalStates = new Set([
    "completed",
    "failed",
    "cancelled",
    "interrupted",
]);
function matchesFilter(job, filter) {
    if (filter === "all")
        return true;
    if (filter === "running") {
        return job.executionState === "running" || job.executionState === "cancelling";
    }
    if (filter === "finished")
        return terminalStates.has(job.executionState);
    return (job.executionState === "failed" ||
        job.executionState === "interrupted" ||
        job.notificationState === "pending");
}
function degradedDiagnostics(health) {
    if (!health)
        return [];
    return Object.values(health).flatMap((record) => record.status === "degraded" ? record.diagnostics : []);
}
function ConnectionNotice({ snapshot }) {
    if (snapshot.status === "loading") {
        return _jsx("p", { role: "status", className: styles.notice, children: "Loading background jobs\u2026" });
    }
    if (snapshot.status === "stale") {
        return (_jsx("p", { role: "status", className: styles.stale, children: "Disconnected. Showing the last known jobs while reconnecting." }));
    }
    if (snapshot.status === "permission-denied") {
        return (_jsxs("div", { role: "alert", className: styles.error, children: [_jsx("strong", { children: "Permission denied." }), _jsx("p", { children: snapshot.error ?? "You do not have access to this Job Board scope." })] }));
    }
    if (snapshot.status === "error") {
        return (_jsxs("div", { role: "alert", className: styles.error, children: [_jsx("strong", { children: "The Job Board could not be loaded." }), _jsx("p", { children: snapshot.error ?? "Remote unavailable" })] }));
    }
    return null;
}
export function JobBoardPage({ store }) {
    const snapshot = useSyncExternalStore((listener) => store.subscribe(listener), () => store.getSnapshot(), () => store.getSnapshot());
    const [filter, setFilter] = useState("all");
    const jobs = useMemo(() => snapshot.jobs.filter((job) => matchesFilter(job, filter)), [snapshot.jobs, filter]);
    const diagnostics = degradedDiagnostics(snapshot.health);
    const filters = [
        { id: "all", label: "All" },
        { id: "running", label: "Running" },
        { id: "attention", label: "Attention required" },
        { id: "finished", label: "Finished" },
    ];
    const showJobs = snapshot.status === "ready" || snapshot.status === "stale" || snapshot.jobs.length > 0;
    return (_jsxs("section", { className: styles.page, "aria-labelledby": "omagents-job-board-title", children: [_jsxs("header", { className: styles.header, children: [_jsx("h1", { id: "omagents-job-board-title", className: styles.title, children: "OmAgents Job Board" }), _jsxs("div", { className: styles.actions, children: [_jsx("button", { type: "button", className: styles.button, onClick: () => void store.refresh(), children: "Refresh" }), _jsx("button", { type: "button", className: styles.button, onClick: () => void store.reconnect(), children: "Reconnect" })] })] }), _jsx(ConnectionNotice, { snapshot: snapshot }), snapshot.actionError && (_jsxs("div", { role: "alert", className: styles.error, children: [_jsx("span", { children: snapshot.actionError }), " ", _jsx("button", { type: "button", className: styles.button, onClick: () => store.clearActionError(), children: "Dismiss" })] })), diagnostics.length > 0 && (_jsxs("section", { role: "status", className: styles.degraded, "aria-label": "Degraded OmAgents capabilities", children: [_jsx("strong", { children: "Some OmAgents capabilities are degraded." }), _jsx("ul", { children: diagnostics.map((diagnostic, index) => (_jsx("li", { children: diagnostic.message }, `${diagnostic.code}-${index}`))) })] })), showJobs && (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.filters, role: "group", "aria-label": "Filter background jobs", children: filters.map((item) => (_jsx("button", { type: "button", className: `${styles.filterButton} ${filter === item.id ? styles.filterButtonActive : ""}`, "aria-pressed": filter === item.id, onClick: () => setFilter(item.id), children: item.label }, item.id))) }), jobs.length > 0 ? (_jsx(JobTable, { jobs: jobs, now: snapshot.now, cancellingIds: snapshot.cancellingIds, onCancel: (job) => store.cancelJob(job.id) })) : (_jsx("p", { className: styles.empty, children: snapshot.jobs.length === 0 && filter === "all"
                            ? "No background jobs yet."
                            : "No background jobs match this filter." }))] }))] }));
}
