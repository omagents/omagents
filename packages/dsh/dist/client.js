window.__ModuleLoader__.load({
  id: "@omagents/omagents-dsh",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
// \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
let react = require("react");
react = __toESM(react, 1);
let react_jsx_runtime = require("react/jsx-runtime");
let zod = require("zod");
// src/client/job-board.module.css
const css = ".omagents-job-board {\n  box-sizing: border-box;\n  min-height: 100%;\n  padding: 24px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  font-size: 13px;\n  line-height: 1.5;\n}\n\n.omagents-job-board *,\n.omagents-job-board *::before,\n.omagents-job-board *::after {\n  box-sizing: inherit;\n}\n\n.omagents-job-board__header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  margin-bottom: 20px;\n}\n\n.omagents-job-board__title {\n  margin: 0;\n  color: var(--dsw-alias-label-primary);\n  font-size: 22px;\n  line-height: 1.25;\n}\n\n.omagents-job-board__actions,\n.omagents-job-board__filters,\n.omagents-job-board__dialog-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n.omagents-job-board__filters {\n  margin: 16px 0 12px;\n  padding-bottom: 12px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.omagents-job-board__button,\n.omagents-job-board__filter,\n.omagents-job-board__task {\n  min-height: 32px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  padding: 5px 10px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-1);\n  font: inherit;\n  cursor: pointer;\n}\n\n.omagents-job-board__filter--active {\n  border-color: var(--dsw-alias-brand-primary);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-active);\n}\n\n.omagents-job-board__button--danger {\n  border-color: var(--dsw-alias-state-error-primary);\n  color: var(--dsw-alias-state-error-primary);\n  background: var(--dsw-alias-bg-layer-1);\n}\n\n.omagents-job-board__button--primary {\n  border-color: var(--dsw-alias-button-primary-fill);\n  color: var(--dsw-alias-label-primary-foreground);\n  background: var(--dsw-alias-button-primary-fill);\n}\n\n.omagents-job-board__button:hover:not(:disabled),\n.omagents-job-board__filter:hover:not(:disabled),\n.omagents-job-board__task:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.omagents-job-board__button:focus-visible,\n.omagents-job-board__filter:focus-visible,\n.omagents-job-board__task:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.omagents-job-board__button:disabled {\n  cursor: not-allowed;\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-layer-2);\n}\n\n.omagents-job-board__task {\n  min-height: 28px;\n  border-color: var(--dsw-alias-border-l1);\n  padding: 3px 7px;\n  color: var(--dsw-alias-label-primary);\n  text-align: left;\n}\n\n.omagents-job-board__notice,\n.omagents-job-board__error,\n.omagents-job-board__stale,\n.omagents-job-board__degraded,\n.omagents-job-board__empty {\n  margin: 12px 0;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 8px;\n  padding: 12px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-1);\n}\n\n.omagents-job-board__error {\n  border-color: var(--dsw-alias-state-error-primary);\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.omagents-job-board__stale,\n.omagents-job-board__degraded {\n  border-color: var(--dsw-alias-state-warn-primary);\n  color: var(--dsw-alias-state-warn-label);\n}\n\n.omagents-job-board__error p,\n.omagents-job-board__degraded ul {\n  margin: 6px 0 0;\n}\n\n.omagents-job-board__table-wrapper {\n  overflow-x: auto;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1);\n}\n\n.omagents-job-board__table {\n  width: 100%;\n  border-collapse: collapse;\n  color: var(--dsw-alias-label-primary);\n}\n\n.omagents-job-board__table th,\n.omagents-job-board__table td {\n  padding: 10px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n  text-align: left;\n  vertical-align: top;\n}\n\n.omagents-job-board__table th {\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-layer-2);\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.omagents-job-board__table tbody tr:last-child > td {\n  border-bottom-color: var(--dsw-alias-border-l1);\n}\n\n.omagents-job-board__badge {\n  display: inline-flex;\n  align-items: center;\n  min-height: 24px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 999px;\n  padding: 2px 8px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n  font-size: 12px;\n  white-space: nowrap;\n}\n\n.omagents-job-board__badge--running {\n  border-color: var(--dsw-alias-state-business-primary);\n  color: var(--dsw-alias-state-business-primary);\n}\n\n.omagents-job-board__badge--cancelling,\n.omagents-job-board__badge--interrupted {\n  border-color: var(--dsw-alias-state-warn-primary);\n  color: var(--dsw-alias-state-warn-label);\n}\n\n.omagents-job-board__badge--completed {\n  border-color: var(--dsw-alias-state-success-primary);\n  color: var(--dsw-alias-state-success-primary);\n}\n\n.omagents-job-board__badge--failed {\n  border-color: var(--dsw-alias-state-error-primary);\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.omagents-job-board__badge--cancelled {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.omagents-job-board__details {\n  padding: 8px 4px;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.omagents-job-board__details h3 {\n  margin: 14px 0 6px;\n  color: var(--dsw-alias-label-primary);\n  font-size: 13px;\n}\n\n.omagents-job-board__details pre {\n  max-height: 260px;\n  overflow: auto;\n  margin: 0;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 6px;\n  padding: 10px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n.omagents-job-board__details-grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));\n  gap: 10px;\n  margin: 0;\n}\n\n.omagents-job-board__details-grid dt {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n  font-weight: 600;\n  text-transform: uppercase;\n}\n\n.omagents-job-board__details-grid dd {\n  margin: 2px 0 0;\n}\n\n.omagents-job-board__detail-value {\n  color: var(--dsw-alias-label-primary);\n  overflow-wrap: anywhere;\n}\n\n.omagents-job-board__dialog-backdrop {\n  position: fixed;\n  inset: 0;\n  z-index: 1000;\n  display: grid;\n  place-items: center;\n  padding: 20px;\n  background: var(--dsw-alias-bg-base);\n}\n\n.omagents-job-board__dialog {\n  width: min(520px, 100%);\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 12px;\n  padding: 20px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-layer-3);\n}\n\n.omagents-job-board__dialog h2 {\n  margin: 0 0 10px;\n  color: var(--dsw-alias-label-primary);\n  font-size: 18px;\n}\n\n.omagents-job-board__dialog p {\n  color: var(--dsw-alias-label-secondary);\n}\n\n.omagents-job-board__dialog-actions {\n  justify-content: flex-end;\n  margin-top: 18px;\n}\n\n.omagents-job-board__icon {\n  display: block;\n  color: var(--dsw-alias-label-secondary);\n  fill: var(--dsw-alias-label-secondary);\n}\n\n.omagents-job-board__muted {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n@media (max-width: 760px) {\n  .omagents-job-board {\n    padding: 14px;\n  }\n\n  .omagents-job-board__header {\n    align-items: flex-start;\n    flex-direction: column;\n  }\n}\n";
const tagId = "@omagents/omagents-dsh/job-board.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "@omagents/omagents-dsh";
	tag.dataset.pluginCss = tagId;
	tag.textContent = css;
	document.head.appendChild(tag);
}
// src/client/classes.ts
/** Stable, plugin-owned CSS-module keys shared by source tests and the Client build. */
const styles = {
	page: "omagents-job-board",
	header: "omagents-job-board__header",
	title: "omagents-job-board__title",
	actions: "omagents-job-board__actions",
	filters: "omagents-job-board__filters",
	filterButton: "omagents-job-board__filter",
	filterButtonActive: "omagents-job-board__filter--active",
	notice: "omagents-job-board__notice",
	error: "omagents-job-board__error",
	stale: "omagents-job-board__stale",
	degraded: "omagents-job-board__degraded",
	tableWrapper: "omagents-job-board__table-wrapper",
	table: "omagents-job-board__table",
	taskButton: "omagents-job-board__task",
	badge: "omagents-job-board__badge",
	badgeRunning: "omagents-job-board__badge--running",
	badgeCancelling: "omagents-job-board__badge--cancelling",
	badgeCompleted: "omagents-job-board__badge--completed",
	badgeFailed: "omagents-job-board__badge--failed",
	badgeCancelled: "omagents-job-board__badge--cancelled",
	badgeInterrupted: "omagents-job-board__badge--interrupted",
	details: "omagents-job-board__details",
	detailsGrid: "omagents-job-board__details-grid",
	detailValue: "omagents-job-board__detail-value",
	dialogBackdrop: "omagents-job-board__dialog-backdrop",
	dialog: "omagents-job-board__dialog",
	dialogActions: "omagents-job-board__dialog-actions",
	button: "omagents-job-board__button",
	primaryButton: "omagents-job-board__button--primary",
	dangerButton: "omagents-job-board__button--danger",
	icon: "omagents-job-board__icon",
	empty: "omagents-job-board__empty",
	muted: "omagents-job-board__muted"
};
// src/client/components/CancelDialog.tsx
function CancelDialog({ job, pending, onClose, onConfirm }) {
	const titleId = (0, react.useId)();
	const descriptionId = (0, react.useId)();
	const dialogRef = (0, react.useRef)(null);
	const closeRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
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
		if (event.key !== "Tab") return;
		const buttons = dialogRef.current?.querySelectorAll("button:not(:disabled)");
		if (!buttons || buttons.length === 0) return;
		const first = buttons[0];
		const last = buttons[buttons.length - 1];
		if (!first || !last) return;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: styles.dialogBackdrop,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			ref: dialogRef,
			className: styles.dialog,
			role: "alertdialog",
			"aria-modal": "true",
			"aria-labelledby": titleId,
			"aria-describedby": descriptionId,
			onKeyDown: handleKeyDown,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h2", {
					id: titleId,
					children: [
						"Cancel ",
						job.description,
						"?"
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					id: descriptionId,
					children: "Cancellation asks the Host to interrupt this run; it is not confirmation that the run has stopped. Local interruption stops only this child's current turn, and its descendants continue unless cancelled separately. External one-shot runs stop permanently and cannot be resumed."
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.dialogActions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						ref: closeRef,
						type: "button",
						className: styles.button,
						disabled: pending,
						onClick: onClose,
						children: "Keep running"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: `${styles.button} ${styles.dangerButton}`,
						disabled: pending,
						onClick: onConfirm,
						children: pending ? "Cancelling…" : "Confirm cancellation"
					})]
				})
			]
		})
	});
}
// src/client/components/JobDetails.tsx
function printable(value) {
	if (value === void 0) return "None";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}
function JobDetails({ job, id }) {
	const identities = [
		["Job ID", job.id],
		["Alias", job.alias],
		["Parent session", job.parentSessionId],
		["Child session", job.hostTaskId],
		["Child name", job.childName ?? "Not supplied"],
		["Agent", job.agent],
		["Host", job.host],
		["Notification", job.notificationState ?? "None"]
	];
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		id,
		className: styles.details,
		"aria-label": `Details for ${job.description}`,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
				className: styles.detailsGrid,
				children: identities.map(([label, value]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
					className: styles.detailValue,
					children: value
				})] }, label))
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Result" }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: printable(job.resultSummary) }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Error" }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: printable(job.error) })
		]
	});
}
// src/client/components/StatusBadge.tsx
const labels = {
	running: "Running",
	cancelling: "Cancelling",
	completed: "Completed",
	failed: "Failed",
	cancelled: "Cancelled",
	interrupted: "Interrupted"
};
const stateStyles = {
	running: styles.badgeRunning,
	cancelling: styles.badgeCancelling,
	completed: styles.badgeCompleted,
	failed: styles.badgeFailed,
	cancelled: styles.badgeCancelled,
	interrupted: styles.badgeInterrupted
};
function StatusBadge({ state }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		role: "status",
		"aria-live": "off",
		className: `${styles.badge} ${stateStyles[state]}`,
		children: labels[state]
	});
}
// src/client/components/JobTable.tsx
const notificationLabels = {
	pending: "Pending notification",
	injected: "Injected notification",
	acknowledged: "Acknowledged notification"
};
function elapsedMilliseconds(job, now) {
	const end = job.terminalAt ?? now;
	return Math.max(0, end - job.launchedAt);
}
function formatElapsed(job, now) {
	const seconds = Math.floor(elapsedMilliseconds(job, now) / 1e3);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor(seconds % 3600 / 60);
	const remainder = seconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m ${remainder}s`;
	if (minutes > 0) return `${minutes}m ${remainder}s`;
	return `${remainder}s`;
}
function JobTable({ jobs, now, cancellingIds = [], onCancel }) {
	const [expanded, setExpanded] = (0, react.useState)(/* @__PURE__ */ new Set());
	const [cancelTarget, setCancelTarget] = (0, react.useState)();
	const [submitting, setSubmitting] = (0, react.useState)(false);
	const submittingRef = (0, react.useRef)(false);
	function toggleDetails(jobId) {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(jobId)) next.delete(jobId);
			else next.add(jobId);
			return next;
		});
	}
	async function confirmCancellation() {
		if (!cancelTarget || submittingRef.current) return;
		submittingRef.current = true;
		setSubmitting(true);
		try {
			await onCancel(cancelTarget);
			setCancelTarget(void 0);
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	}
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: styles.tableWrapper,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
			className: styles.table,
			"aria-label": "OmAgents background jobs",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
					scope: "col",
					children: "Status"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
					scope: "col",
					children: "Task"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
					scope: "col",
					children: "Agent"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
					scope: "col",
					children: "Elapsed"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
					scope: "col",
					children: "Notification"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
					scope: "col",
					children: "Started"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
					scope: "col",
					children: "Actions"
				})
			] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: jobs.map((job) => {
				const isExpanded = expanded.has(job.id);
				const detailsId = `omagents-job-details-${job.id}`;
				const isCancelling = job.executionState === "cancelling" || cancellingIds.includes(job.id);
				const canCancel = job.executionState === "running" || job.executionState === "cancelling";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JobRows, {
					job,
					now,
					isExpanded,
					detailsId,
					isCancelling,
					canCancel,
					onToggle: () => toggleDetails(job.id),
					onCancel: () => setCancelTarget(job)
				}, job.id);
			}) })]
		})
	}), cancelTarget && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CancelDialog, {
		job: cancelTarget,
		pending: submitting,
		onClose: () => {
			if (!submittingRef.current) setCancelTarget(void 0);
		},
		onConfirm: () => void confirmCancellation()
	})] });
}
function JobRows({ job, now, isExpanded, detailsId, isCancelling, canCancel, onToggle, onCancel }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusBadge, { state: job.executionState }) }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			className: styles.taskButton,
			"aria-label": `Details for ${job.description}`,
			"aria-expanded": isExpanded,
			"aria-controls": isExpanded ? detailsId : void 0,
			onClick: onToggle,
			children: job.description
		}) }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: job.agent }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatElapsed(job, now) }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: job.notificationState ? notificationLabels[job.notificationState] : "No notification" }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
			dateTime: new Date(job.launchedAt).toISOString(),
			children: new Date(job.launchedAt).toLocaleString()
		}) }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: canCancel && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			className: `${styles.button} ${styles.dangerButton}`,
			disabled: isCancelling,
			"aria-label": `${isCancelling ? "Cancelling" : "Cancel"} ${job.description}`,
			onClick: onCancel,
			children: isCancelling ? "Cancelling…" : "Cancel"
		}) })
	] }), isExpanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
		colSpan: 7,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JobDetails, {
			id: detailsId,
			job
		})
	}) })] });
}
// src/client/components/JobBoardPage.tsx
const terminalStates = /* @__PURE__ */ new Set([
	"completed",
	"failed",
	"cancelled",
	"interrupted"
]);
function matchesFilter(job, filter) {
	if (filter === "all") return true;
	if (filter === "running") return job.executionState === "running" || job.executionState === "cancelling";
	if (filter === "finished") return terminalStates.has(job.executionState);
	return job.executionState === "failed" || job.executionState === "interrupted" || job.notificationState === "pending";
}
function degradedDiagnostics(health) {
	if (!health) return [];
	return Object.values(health).flatMap((record) => record.status === "degraded" ? record.diagnostics : []);
}
function ConnectionNotice({ snapshot }) {
	if (snapshot.status === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		role: "status",
		className: styles.notice,
		children: "Loading background jobs…"
	});
	if (snapshot.status === "stale") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		role: "status",
		className: styles.stale,
		children: "Disconnected. Showing the last known jobs while reconnecting."
	});
	if (snapshot.status === "permission-denied") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		role: "alert",
		className: styles.error,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Permission denied." }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: snapshot.error ?? "You do not have access to this Job Board scope." })]
	});
	if (snapshot.status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		role: "alert",
		className: styles.error,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "The Job Board could not be loaded." }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: snapshot.error ?? "Remote unavailable" })]
	});
	return null;
}
function JobBoardPage({ store }) {
	const subscribe = (0, react.useCallback)((listener) => store.subscribe(listener), [store]);
	const getSnapshot = (0, react.useCallback)(() => store.getSnapshot(), [store]);
	const snapshot = (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
	const [filter, setFilter] = (0, react.useState)("all");
	const jobs = (0, react.useMemo)(() => snapshot.jobs.filter((job) => matchesFilter(job, filter)), [snapshot.jobs, filter]);
	const diagnostics = degradedDiagnostics(snapshot.health);
	const filters = [
		{
			id: "all",
			label: "All"
		},
		{
			id: "running",
			label: "Running"
		},
		{
			id: "attention",
			label: "Attention required"
		},
		{
			id: "finished",
			label: "Finished"
		}
	];
	const showJobs = snapshot.status === "ready" || snapshot.status === "stale" || snapshot.jobs.length > 0;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: styles.page,
		"aria-labelledby": "omagents-job-board-title",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				className: styles.header,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
					id: "omagents-job-board-title",
					className: styles.title,
					children: "OmAgents Job Board"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: styles.actions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: styles.button,
						onClick: () => void store.refresh(),
						children: "Refresh"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: styles.button,
						onClick: () => void store.reconnect(),
						children: "Reconnect"
					})]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConnectionNotice, { snapshot }),
			snapshot.actionError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "alert",
				className: styles.error,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: snapshot.actionError }),
					" ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: styles.button,
						onClick: () => store.clearActionError(),
						children: "Dismiss"
					})
				]
			}),
			diagnostics.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				role: "status",
				className: styles.degraded,
				"aria-label": "Degraded OmAgents capabilities",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Some OmAgents capabilities are degraded." }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: diagnostics.map((diagnostic, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: diagnostic.message }, `${diagnostic.code}-${index}`)) })]
			}),
			showJobs && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: styles.filters,
				role: "group",
				"aria-label": "Filter background jobs",
				children: filters.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: `${styles.filterButton} ${filter === item.id ? styles.filterButtonActive : ""}`,
					"aria-pressed": filter === item.id,
					onClick: () => setFilter(item.id),
					children: item.label
				}, item.id))
			}), jobs.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JobTable, {
				jobs,
				now: snapshot.now,
				cancellingIds: snapshot.cancellingIds,
				onCancel: (job) => store.cancelJob(job.id)
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: styles.empty,
				children: snapshot.jobs.length === 0 && filter === "all" ? "No background jobs yet." : "No background jobs match this filter."
			})] })
		]
	});
}
// src/client/remote-store.ts
const systemScheduler = {
	setInterval(callback, milliseconds) {
		return globalThis.setInterval(callback, milliseconds);
	},
	clearInterval(handle) {
		globalThis.clearInterval(handle);
	},
	setTimeout(callback, milliseconds) {
		return globalThis.setTimeout(callback, milliseconds);
	},
	clearTimeout(handle) {
		globalThis.clearTimeout(handle);
	}
};
function errorMessage(error) {
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = Reflect.get(error, "message");
		if (typeof message === "string" && message.length > 0) return message;
	}
	return String(error);
}
function isPermissionDenied(error) {
	return typeof error === "object" && error !== null && "code" in error && Reflect.get(error, "code") === "remote-access/denied";
}
function isTerminalExecutionState(state) {
	return state === "completed" || state === "failed" || state === "cancelled" || state === "interrupted";
}
var RemoteJobBoardStore = class {
	remote;
	scope;
	readNow;
	scheduler;
	tickIntervalMs;
	reconnectDelayMs;
	listeners = /* @__PURE__ */ new Set();
	cancellations = /* @__PURE__ */ new Map();
	snapshot;
	running = false;
	disposed = false;
	watch;
	generation = 0;
	watchMutation = 0;
	tickHandle;
	reconnectHandle;
	constructor(remote, options) {
		this.remote = remote;
		this.scope = options.scope ?? {};
		this.readNow = options.now ?? Date.now;
		this.scheduler = options.scheduler ?? systemScheduler;
		this.tickIntervalMs = options.tickIntervalMs ?? 1e3;
		this.reconnectDelayMs = options.reconnectDelayMs ?? 1e3;
		this.snapshot = {
			jobs: [],
			revision: 0,
			status: "loading",
			now: this.readNow(),
			cancellingIds: []
		};
	}
	getSnapshot() {
		return this.snapshot;
	}
	subscribe(listener) {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		if (!this.running) queueMicrotask(() => {
			if (!this.disposed && !this.running && this.listeners.size > 0) this.start();
		});
		let subscribed = true;
		return () => {
			if (!subscribed) return;
			subscribed = false;
			this.listeners.delete(listener);
			if (this.listeners.size === 0) this.stop();
		};
	}
	async refresh() {
		if (this.disposed) return;
		const watchMutation = this.watchMutation;
		try {
			const [listed, health] = await Promise.all([this.remote.listJobs(this.scope), this.remote.getHealth()]);
			if (this.disposed || watchMutation !== this.watchMutation) return;
			if (!listed.ok) {
				this.applyReadFailure(listed.error);
				return;
			}
			if (!health.ok && isPermissionDenied(health.error)) {
				this.applyReadFailure(health.error);
				return;
			}
			this.publish({
				...this.snapshot,
				jobs: listed.value,
				health: health.ok ? health.value : this.snapshot.health,
				status: "ready",
				error: void 0,
				lastUpdatedAt: this.readNow()
			});
		} catch (error) {
			if (!this.disposed && watchMutation === this.watchMutation) this.applyReadFailure(error);
		}
	}
	async reconnect() {
		if (this.disposed) return;
		this.clearReconnect();
		if (!this.running) {
			this.start();
			return;
		}
		this.openWatch();
	}
	cancelJob(jobId) {
		const existing = this.cancellations.get(jobId);
		if (existing) return existing;
		const cancellation = this.performCancellation(jobId);
		this.cancellations.set(jobId, cancellation);
		return cancellation;
	}
	clearActionError() {
		if (this.snapshot.actionError === void 0) return;
		this.publish({
			...this.snapshot,
			actionError: void 0
		});
	}
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.stop();
		this.listeners.clear();
	}
	async performCancellation(jobId) {
		const watchMutation = this.watchMutation;
		this.publish({
			...this.snapshot,
			cancellingIds: [...this.snapshot.cancellingIds, jobId],
			actionError: void 0
		});
		try {
			const result = await this.remote.cancelJob(jobId);
			if (this.disposed || watchMutation !== this.watchMutation) return;
			if (!result.ok) {
				if (isPermissionDenied(result.error)) this.applyReadFailure(result.error);
				else this.publish({
					...this.snapshot,
					actionError: errorMessage(result.error)
				});
				return;
			}
			const currentJob = this.snapshot.jobs.find((job) => job.id === jobId);
			if (!currentJob || result.value.id !== jobId) return;
			if (result.value.revision < currentJob.revision) return;
			if (isTerminalExecutionState(currentJob.executionState) && !isTerminalExecutionState(result.value.executionState)) return;
			const jobs = this.snapshot.jobs.map((job) => job.id === result.value.id ? result.value : job);
			this.publish({
				...this.snapshot,
				jobs,
				lastUpdatedAt: this.readNow()
			});
		} catch (error) {
			if (!this.disposed && watchMutation === this.watchMutation) {
				if (isPermissionDenied(error)) this.applyReadFailure(error);
				else this.publish({
					...this.snapshot,
					actionError: errorMessage(error)
				});
			}
		} finally {
			this.cancellations.delete(jobId);
			if (!this.disposed) this.publish({
				...this.snapshot,
				cancellingIds: this.snapshot.cancellingIds.filter((id) => id !== jobId)
			});
		}
	}
	start() {
		if (this.disposed || this.running) return;
		this.running = true;
		this.tickHandle = this.scheduler.setInterval(() => {
			this.publish({
				...this.snapshot,
				now: this.readNow()
			});
		}, this.tickIntervalMs);
		this.openWatch();
	}
	stop() {
		this.running = false;
		this.generation += 1;
		if (this.tickHandle !== void 0) {
			this.scheduler.clearInterval(this.tickHandle);
			this.tickHandle = void 0;
		}
		this.clearReconnect();
		this.closeWatch();
	}
	openWatch() {
		if (!this.running || this.disposed) return;
		this.generation += 1;
		const generation = this.generation;
		this.closeWatch();
		const controller = new AbortController();
		const hasSnapshot = this.snapshot.lastUpdatedAt !== void 0;
		this.publish({
			...this.snapshot,
			status: hasSnapshot ? "stale" : "loading",
			error: void 0,
			now: this.readNow()
		});
		try {
			const watch = {
				controller,
				iterator: this.remote.watchJobs(this.scope, controller.signal)[Symbol.asyncIterator]()
			};
			this.watch = watch;
			this.consumeWatch(watch, generation);
		} catch (error) {
			this.handleWatchFailure(error, generation, hasSnapshot);
		}
	}
	async consumeWatch(watch, generation) {
		let baseline = true;
		let hasSnapshot = this.snapshot.lastUpdatedAt !== void 0;
		try {
			while (this.watch === watch && this.generation === generation) {
				const next = await watch.iterator.next();
				if (this.watch !== watch || this.generation !== generation) return;
				if (next.done) throw new Error("The OmAgents Job Board watch ended unexpectedly");
				if (!baseline && next.value.revision < this.snapshot.revision) continue;
				const isBaseline = baseline;
				this.applyFrame(next.value);
				baseline = false;
				hasSnapshot = true;
				if (isBaseline && this.watch === watch && this.generation === generation) this.loadHealth(generation, this.watchMutation);
			}
		} catch (error) {
			if (this.watch !== watch || this.generation !== generation || watch.controller.signal.aborted) return;
			this.watch = void 0;
			this.handleWatchFailure(error, generation, hasSnapshot);
		}
	}
	applyFrame(frame) {
		this.watchMutation += 1;
		this.publish({
			...this.snapshot,
			jobs: frame.jobs,
			revision: frame.revision,
			status: "ready",
			error: void 0,
			lastUpdatedAt: this.readNow(),
			now: this.readNow()
		});
	}
	async loadHealth(generation, watchMutation) {
		try {
			const result = await this.remote.getHealth();
			if (this.disposed || this.generation !== generation || this.watchMutation !== watchMutation) return;
			if (result.ok) this.publish({
				...this.snapshot,
				health: result.value
			});
			else if (isPermissionDenied(result.error)) this.applyReadFailure(result.error);
		} catch {}
	}
	handleWatchFailure(error, generation, hasSnapshot) {
		if (this.disposed || this.generation !== generation) return;
		if (isPermissionDenied(error)) {
			this.enterPermissionDenied(error);
			return;
		}
		this.publish({
			...this.snapshot,
			status: hasSnapshot ? "stale" : "error",
			error: errorMessage(error)
		});
		this.scheduleReconnect();
	}
	scheduleReconnect() {
		if (!this.running || this.reconnectHandle !== void 0) return;
		const generation = this.generation;
		const handle = this.scheduler.setTimeout(() => {
			if (this.reconnectHandle !== handle) return;
			this.reconnectHandle = void 0;
			if (!this.running || this.disposed || this.generation !== generation || this.snapshot.status === "permission-denied") return;
			this.openWatch();
		}, this.reconnectDelayMs);
		this.reconnectHandle = handle;
	}
	enterPermissionDenied(error) {
		this.clearReconnect();
		this.generation += 1;
		this.watchMutation += 1;
		this.closeWatch();
		this.publish({
			...this.snapshot,
			jobs: [],
			status: "permission-denied",
			error: errorMessage(error)
		});
	}
	applyReadFailure(error) {
		if (isPermissionDenied(error)) {
			this.enterPermissionDenied(error);
			return;
		}
		this.publish({
			...this.snapshot,
			status: this.snapshot.lastUpdatedAt === void 0 ? "error" : this.snapshot.status,
			error: errorMessage(error),
			actionError: errorMessage(error)
		});
	}
	closeWatch() {
		const watch = this.watch;
		this.watch = void 0;
		if (!watch) return;
		watch.controller.abort();
		if (watch.iterator.return) watch.iterator.return().catch(() => {});
	}
	clearReconnect() {
		if (this.reconnectHandle === void 0) return;
		this.scheduler.clearTimeout(this.reconnectHandle);
		this.reconnectHandle = void 0;
	}
	publish(next) {
		this.snapshot = next;
		for (const listener of this.listeners) listener();
	}
};
/**
* Create the browser's ephemeral view of the authorized Host Board. Frames are
* whole-set replacements; only elapsed time and reconnect timing are local.
*/
function createJobBoardStore(remote, options = {}) {
	return new RemoteJobBoardStore(remote, options);
}
// ../../node_modules/@deepseek-ai/dsh-typert-protocol/lib/types/remote-info.js
/** Lazy assembly of generated Remote definitions using caller-supplied Zod; no runtime imports. */
/**
* Retain one generated definition per endpoint without constructing parsers or projections.
* The class instance builds its shared descriptor/method index on first access;
* input schemas and JSON Schema projections are cached only when requested.
* @param spec - compiler-produced method facts and Zod factories.
* @param zod - the generated artifact's Zod runtime for named-input parsers.
* @returns a lazy, mountable info instance with no registration or transport effects.
*/
function createTypertRemoteInfo(spec, zod) {
	return new RemoteInfo(spec, zod);
}
var RemoteInfo = class {
	spec;
	zod;
	index;
	constructor(spec, zod) {
		this.spec = spec;
		this.zod = zod;
	}
	get package() {
		return this.spec.package;
	}
	get descriptors() {
		return this.resolve().descriptors;
	}
	get methods() {
		return this.resolve().methods;
	}
	resolve() {
		if (this.index !== void 0) return this.index;
		const zod = this.zod;
		const descriptors = [];
		const methods = Object.create(null);
		for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
			const separator = endpoint.indexOf("/");
			const namespace = endpoint.slice(0, separator);
			const method = endpoint.slice(separator + 1);
			const parameters = definition.parameters.map((parameter) => ({
				...parameter,
				wire: parameter.wire ?? parameter.name
			}));
			const descriptor = {
				...definition,
				id: `${this.spec.package}#${endpoint}`,
				namespace,
				method,
				parameters,
				result: definition.result.description === void 0 ? definition.result : new ResultValue(definition.result)
			};
			if (definition.invocation.kind === "direct") {
				const inputs = [];
				methods[endpoint] = Object.assign(descriptor, {
					input(options) {
						const strict = options?.strict === true;
						return inputs[strict ? 1 : 0] ??= new NamedInput(parameters, strict, zod);
					},
					invoke(remote, input, signal) {
						const named = input;
						const values = parameters.map((parameter) => named[parameter.wire]);
						if (definition.cancellation !== void 0) values.push(signal);
						const receiver = Reflect.get(remote, namespace);
						return Reflect.get(receiver, method).apply(receiver, values);
					}
				});
			}
			descriptors.push(descriptor);
		}
		return this.index = {
			descriptors,
			methods
		};
	}
};
function optional(parameter) {
	return parameter.source === "json" && parameter.acceptsUndefined === true;
}
var NamedInput = class {
	parameters;
	strict;
	zod;
	schema;
	projection;
	constructor(parameters, strict, zod) {
		this.parameters = parameters;
		this.strict = strict;
		this.zod = zod;
	}
	codec(parameter) {
		return this.strict ? parameter.strictCodec : parameter.codec;
	}
	create = () => this.schema ??= this.zod.strictObject(Object.fromEntries(this.parameters.map((parameter) => {
		const value = this.codec(parameter).create();
		return [parameter.wire, optional(parameter) ? value.optional() : value.nonoptional()];
	})));
	get jsonSchema() {
		return this.project().jsonSchema;
	}
	get jsonSchemaError() {
		return this.project().jsonSchemaError;
	}
	project() {
		if (this.projection !== void 0) return this.projection;
		const unavailable = this.parameters.find((parameter) => this.codec(parameter).jsonSchema === void 0);
		if (unavailable !== void 0) return this.projection = { jsonSchemaError: this.codec(unavailable).jsonSchemaError ?? `No JSON Schema for parameter ${unavailable.wire}` };
		return this.projection = { jsonSchema: {
			type: "object",
			properties: Object.fromEntries(this.parameters.map((parameter) => [parameter.wire, {
				...this.codec(parameter).jsonSchema,
				...parameter.description === void 0 ? {} : { description: parameter.description }
			}])),
			required: this.parameters.filter((parameter) => !optional(parameter)).map((parameter) => parameter.wire),
			additionalProperties: false
		} };
	}
};
var ResultValue = class {
	spec;
	projection;
	constructor(spec) {
		this.spec = spec;
	}
	get mode() {
		return this.spec.mode;
	}
	get typeSymbol() {
		return this.spec.typeSymbol;
	}
	get create() {
		return this.spec.create;
	}
	get decode() {
		return this.spec.decode;
	}
	get encode() {
		return this.spec.encode;
	}
	get description() {
		return this.spec.description;
	}
	get jsonSchemaError() {
		return this.spec.jsonSchemaError;
	}
	get jsonSchema() {
		if (this.projection === void 0) {
			const schema = this.spec.jsonSchema;
			this.projection = { value: schema === void 0 ? void 0 : {
				...schema,
				description: this.spec.description
			} };
		}
		return this.projection.value;
	}
};
// src/client/remote-contribution.ts
const scopeSchema = zod.z.object({ parentSessionId: zod.z.string().optional() });
const strictScopeSchema = zod.z.strictObject({ parentSessionId: zod.z.string().optional() });
const jobSchema = zod.z.looseObject({
	id: zod.z.string(),
	host: zod.z.string(),
	hostTaskId: zod.z.string(),
	parentSessionId: zod.z.string(),
	childName: zod.z.string().optional(),
	alias: zod.z.string(),
	agent: zod.z.string(),
	description: zod.z.string(),
	executionState: zod.z.union([
		zod.z.literal("running"),
		zod.z.literal("cancelling"),
		zod.z.literal("completed"),
		zod.z.literal("failed"),
		zod.z.literal("cancelled"),
		zod.z.literal("interrupted")
	]),
	notificationState: zod.z.union([
		zod.z.literal("pending"),
		zod.z.literal("injected"),
		zod.z.literal("acknowledged")
	]).optional(),
	launchedAt: zod.z.number(),
	updatedAt: zod.z.number(),
	terminalAt: zod.z.number().optional(),
	cancelRequestedAt: zod.z.number().optional(),
	revision: zod.z.number(),
	resultSummary: zod.z.unknown().optional(),
	error: zod.z.unknown().optional()
});
const healthRecordSchema = zod.z.object({
	status: zod.z.union([zod.z.literal("ready"), zod.z.literal("degraded")]),
	diagnostics: zod.z.array(zod.z.object({
		code: zod.z.string(),
		message: zod.z.string()
	}))
});
const healthSchema = zod.z.object({
	host: healthRecordSchema,
	persistence: healthRecordSchema,
	tracking: healthRecordSchema,
	skills: healthRecordSchema,
	mcp: healthRecordSchema,
	python: healthRecordSchema,
	tools: healthRecordSchema,
	commands: healthRecordSchema,
	context: healthRecordSchema
});
const frameSchema = zod.z.object({
	revision: zod.z.number(),
	jobs: zod.z.array(jobSchema)
});
function codec(typeSymbol, schema, jsonSchema) {
	return {
		mode: "strict",
		typeSymbol,
		create: () => schema,
		jsonSchema
	};
}
function parameter(name, typeSymbol, schema, strictSchema, jsonSchema) {
	return {
		name,
		source: "json",
		codec: codec(typeSymbol, schema, jsonSchema),
		strictCodec: codec(typeSymbol, strictSchema, jsonSchema)
	};
}
const scopeJson = {
	type: "object",
	properties: { parentSessionId: { type: "string" } },
	additionalProperties: false
};
const jobJson = {
	type: "object",
	additionalProperties: true
};
/** Host-for-Client Remote metadata mounted by the browser Client. */
const TYPERT_REMOTE = createTypertRemoteInfo({
	package: "@omagents/omagents-dsh",
	methods: {
		"omagents/listJobs": {
			service: "omagentsRemote",
			invocation: { kind: "direct" },
			parameters: [parameter("scope", "JobScope", scopeSchema, strictScopeSchema, scopeJson)],
			result: codec("JobDto[]", zod.z.array(jobSchema), {
				type: "array",
				items: jobJson
			})
		},
		"omagents/cancelJob": {
			service: "omagentsRemote",
			invocation: { kind: "direct" },
			parameters: [parameter("jobId", "string", zod.z.string(), zod.z.string(), { type: "string" })],
			result: codec("JobDto", jobSchema, jobJson)
		},
		"omagents/getHealth": {
			service: "omagentsRemote",
			invocation: { kind: "direct" },
			parameters: [],
			result: codec("HealthDto", healthSchema, {
				type: "object",
				additionalProperties: false
			})
		},
		"omagents/watchJobs": {
			service: "omagentsRemote",
			invocation: { kind: "direct" },
			mode: "stream",
			parameters: [parameter("scope", "JobScope", scopeSchema, strictScopeSchema, scopeJson)],
			cancellation: { parameter: "signal" },
			result: codec("JobWatchFrame", frameSchema, {
				type: "object",
				additionalProperties: false
			})
		}
	}
}, zod.z);
// src/client/index.ts
const PANEL_ID = "omagents";
const inject = ["slots", "remote"];
function JobBoardIcon({ size = 20 }) {
	return react.default.createElement("svg", {
		className: "omagents-job-board__icon",
		width: size,
		height: size,
		viewBox: "0 0 20 20",
		"aria-hidden": true,
		focusable: "false"
	}, react.default.createElement("path", { d: "M3 3.5h14v3H3zM3 8.5h14v3H3zM3 13.5h14v3H3z" }));
}
/** Mount the Host Remote and attach the native panel to the package-root fiber. */
async function apply(ctx) {
	const unmount = await ctx.remote.$mount(TYPERT_REMOTE);
	let store;
	const disposers = [];
	const ui = ctx.inject(["remote.omagents"], (inner) => {
		store = createJobBoardStore(inner.remote.omagents);
		disposers.push(inner.slots.inject("main", () => inner.slots.register({
			name: "main",
			key: PANEL_ID,
			inject: () => ({ store })
		}, JobBoardPage)));
		disposers.push(inner.slots.inject("sidebar.panellist", () => inner.slots.register({
			name: "sidebar.panellist",
			id: PANEL_ID,
			order: 20,
			label: "OmAgents"
		}, JobBoardIcon)));
	});
	try {
		await ui;
	} catch (error) {
		for (const dispose of disposers.reverse()) dispose();
		store?.dispose();
		await ui.dispose();
		await unmount();
		throw error;
	}
	return async () => {
		for (const dispose of disposers.reverse()) dispose();
		store?.dispose();
		await ui.dispose();
		await unmount();
	};
}
exports.JobBoardIcon = JobBoardIcon;
exports.PANEL_ID = PANEL_ID;
exports.apply = apply;
exports.createJobBoardStore = createJobBoardStore;
exports.inject = inject;

    return module.exports;
  }
});
//# sourceMappingURL=client.js.map