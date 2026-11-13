import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { styles } from "../classes.js";
function printable(value) {
    if (value === undefined)
        return "None";
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    }
    catch {
        return String(value);
    }
}
export function JobDetails({ job, id }) {
    const identities = [
        ["Job ID", job.id],
        ["Alias", job.alias],
        ["Parent session", job.parentSessionId],
        ["Child session", job.hostTaskId],
        ["Child name", job.childName ?? "Not supplied"],
        ["Agent", job.agent],
        ["Host", job.host],
        ["Notification", job.notificationState ?? "None"],
    ];
    return (_jsxs("section", { id: id, className: styles.details, "aria-label": `Details for ${job.description}`, children: [_jsx("dl", { className: styles.detailsGrid, children: identities.map(([label, value]) => (_jsxs("div", { children: [_jsx("dt", { children: label }), _jsx("dd", { className: styles.detailValue, children: value })] }, label))) }), _jsx("h3", { children: "Result" }), _jsx("pre", { children: printable(job.resultSummary) }), _jsx("h3", { children: "Error" }), _jsx("pre", { children: printable(job.error) })] }));
}
