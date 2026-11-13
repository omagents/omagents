import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import { styles } from "../classes.js";
const labels = {
    running: "Running",
    cancelling: "Cancelling",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
};
const stateStyles = {
    running: styles.badgeRunning,
    cancelling: styles.badgeCancelling,
    completed: styles.badgeCompleted,
    failed: styles.badgeFailed,
    cancelled: styles.badgeCancelled,
    interrupted: styles.badgeInterrupted,
};
export function StatusBadge({ state }) {
    return (_jsx("span", { role: "status", "aria-live": "off", className: `${styles.badge} ${stateStyles[state]}`, children: labels[state] }));
}
