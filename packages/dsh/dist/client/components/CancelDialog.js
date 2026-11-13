import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import React, { useEffect, useId, useRef } from "react";
import { styles } from "../classes.js";
export function CancelDialog({ job, pending, onClose, onConfirm }) {
    const titleId = useId();
    const descriptionId = useId();
    const dialogRef = useRef(null);
    const closeRef = useRef(null);
    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeRef.current?.focus();
        return () => previous?.focus();
    }, []);
    function handleKeyDown(event) {
        if (event.key === "Escape" && !pending) {
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key !== "Tab")
            return;
        const buttons = dialogRef.current?.querySelectorAll("button:not(:disabled)");
        if (!buttons || buttons.length === 0)
            return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (!first || !last)
            return;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        }
        else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
    return (_jsx("div", { className: styles.dialogBackdrop, children: _jsxs("div", { ref: dialogRef, className: styles.dialog, role: "alertdialog", "aria-modal": "true", "aria-labelledby": titleId, "aria-describedby": descriptionId, onKeyDown: handleKeyDown, children: [_jsxs("h2", { id: titleId, children: ["Cancel ", job.description, "?"] }), _jsx("p", { id: descriptionId, children: "Cancellation asks the Host to interrupt this run; it is not confirmation that the run has stopped. Local interruption stops only this child's current turn, and its descendants continue unless cancelled separately. External one-shot runs stop permanently and cannot be resumed." }), _jsxs("div", { className: styles.dialogActions, children: [_jsx("button", { ref: closeRef, type: "button", className: styles.button, disabled: pending, onClick: onClose, children: "Keep running" }), _jsx("button", { type: "button", className: `${styles.button} ${styles.dangerButton}`, disabled: pending, onClick: onConfirm, children: pending ? "Cancelling…" : "Confirm cancellation" })] })] }) }));
}
