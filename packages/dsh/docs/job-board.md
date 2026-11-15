# DSH Web Job Board Guide

The DSH Web Job Board is the authorized browser view of the same Core Board used by native subagent tracking, `/ps`, `parallel_status`, and `cancel_task`. It has no independent browser job database and never infers success from inactivity.

## UI

Open **OmAgents** in the DSH Web sidebar. The Client registers a keyed `main` panel through DSH slots and follows the active DSH theme.

### Filters and details

| Filter | Included jobs |
| :--- | :--- |
| **All** | Every job in the authorized scope |
| **Running** | `running` and `cancelling` |
| **Attention required** | `failed`, `interrupted`, or a job whose parent notification is `pending` |
| **Finished** | `completed`, `failed`, `cancelled`, or `interrupted` |

The table shows status, task, agent, elapsed time, notification state, start time, and actions. Details include result or structured error information and parent/child identity. The panel also presents loading, empty, stale/disconnected, permission-denied, action-error, and degraded-health states.

Execution state and notification state are deliberately separate:

- Execution: `running`, `cancelling`, `completed`, `failed`, `cancelled`, `interrupted`.
- Notification: `pending`, `injected`, `acknowledged` when an outcome needs parent delivery.

**Viewing details never acknowledges a model notification.** For recovered outcomes, `injected` records that the pending outcome ID and details actually entered the owning parent's context; the parent's native `agent/turn-stopping` boundary advances it to `acknowledged`, preventing a second parent turn from repeating the notice. Direct native settlement retains its existing `injected` semantics. Neither state is a human read receipt, and parent scopes acknowledge independently.

### Updates and reconnection

`watchJobs` is a Remote stream of revisioned whole-set frames:

1. The Host attaches its Core listener synchronously before reconciliation and the baseline so a racing commit is retained.
2. Each new stream reconciles authorized active jobs, yields a complete baseline, and then emits complete authorized-set replacements after Core changes without further native polling.
3. The browser replaces its ephemeral view from each fresh baseline and ignores stale post-baseline revisions.
4. On reconnect, a new stream starts with a new baseline. The last authorized set may remain visible only with a clear stale/disconnected notice.
5. Elapsed time ticks locally. Explicit **Refresh** uses `listJobs`; there is no periodic running-job poll.

Permission denial clears the visible set. Capability health is read independently, so an unavailable health request does not overwrite authoritative watch data.

## Cancellation

Use the job's cancellation action and read the confirmation dialog before proceeding. The action is disabled while the same request is in flight, preventing duplicate Host interrupts.

Cancellation admission means only that DSH accepted an interrupt request. The Board enters `cancelling` and waits for authoritative settlement; it must not jump directly to `cancelled`.

| Run kind | Actual behavior |
| :--- | :--- |
| **Local child** | Stops the current turn. Its descendants continue unless cancelled separately. Native continuation may still exist, but OmAgents adds no new resume feature. |
| **External one-shot** | Stops permanently and cannot resume or receive follow-ups. |

The Remote response is the current Board record after admission, normally `cancelling`. Terminal state arrives only from native lifecycle information or authoritative reconciliation. Repeated cancellation of unknown, terminal, or already-settled work does not invent a new outcome.

Structured failures include `omagents/job-not-found` for an unknown job and `omagents/cancel-failed` when native cancellation cannot be admitted. Authorization failures use `remote-access/denied`.

## Recovery

The Host stores the Board in the active DSH profile:

```text
$DSH_HOME/profiles/<active-profile>/omagents/job-board.json
```

Writes are serialized and use atomic replacement. Running, cancelling, and outcome-pending jobs are not discarded by terminal-history retention. After a storage read/write/flush failure, DSH preserves the current in-memory Board and continues reconciliation plus Remote list/watch operations; current jobs are not discarded merely because persistence failed. This fallback is not durable, and the failure remains visible through degraded persistence health rather than being silently reported as healthy. The DSH adapter serializes save admission and drains its queue on flush/close, so every queued save re-checks degradation before entering Core's write queue. The degraded runtime does not resume disk writes even if the path becomes writable again, preventing an unreadable startup store or newer repaired snapshot from being overwritten; reopen the runtime after repairing storage. Tracking lifecycle observation has an independent health record.

Recovery triggers are startup after live-Agent and Session-query capabilities activate, manual refresh through `listJobs`, every new `watchJobs` stream (including reconnection), and authoritative lifecycle events. Startup reconciliation waits for those query capabilities; Remote refreshes and initial/reconnect baselines reconcile only authorized active jobs, while lifecycle events apply their native outcomes directly. Cold Remote queries also defer until the query capabilities are available. There is no periodic running-job poll:

| Persisted situation | Reconciled result |
| :--- | :--- |
| Native run is still active | Preserve `running` or `cancelling` |
| Native run settled with a readable outcome | Record `completed`, `failed`, `cancelled`, or `interrupted` as supported by that outcome |
| Native run or outcome is missing/unreadable and no active run is authoritatively observable | Record `interrupted` with an explicit reason and pending parent notification |
| An observed active external run has a cold, missing Session read | Keep it active; do not misclassify an in-flight run as interrupted |
| Terminal job still needs parent delivery | Retain the outcome and deliver it without duplicating an earlier notice |

No timer marks a quiet job complete. `interrupted` communicates an unconfirmed outcome and must not be presented as success. Local research/hyperplan recovery retains the original host task IDs, run IDs, and run-scoped queues; external one-shot runs remain interrupted and cannot resume.

## Authorization and Security

Authorization has two layers:

1. **Profile isolation**: the Host opens only the active DSH profile's Board. A Client cannot select another profile by supplying a path or arbitrary scope.
2. **Session access**: `JobScope` accepts only an optional `parentSessionId`. The Remote service evaluates the invocation-derived Context with DSH `remoteAccess.allows()` for session resources.

Unscoped reads are admitted only with per-job filtering. Explicit denied scopes and denied job actions throw `remote-access/denied`; they do not return an empty successful response that could conceal an authorization problem. Cancellation checks authorization for the target job as well.

The Client retains only the latest authorized ephemeral set. Carrier loss can make that set stale, while permission denial clears it. Refresh, viewing details, and reconnecting never acknowledge model notifications. The UI uses DSH Remote and slot surfaces, not private Host UI internals, an iframe, direct DOM application mounting, or a browser-owned persistence layer.

## Troubleshooting

### Loading never completes

Confirm that the bare `@omagents/omagents-dsh` Loader row is enabled and restart DSH. Check that the installed DSH version is within `>=0.2.2-rc.1 <0.2.3-0` and that the Remote contribution mounted with the Host. Do not register a separate Client Loader row.

### Permission denied

Verify that the current Web identity may access the requested parent session in the active DSH profile. A denied response intentionally clears jobs. Copying another profile's `job-board.json` is not a supported workaround.

### Stale or disconnected data

Select **Reconnect** and wait for a fresh baseline. The stale label means the displayed set is the last authorized snapshot, not live state. Check Web/Gateway connectivity and Host health if reconnection repeatedly fails.

### Missing completion or duplicate notification concerns

Compare `/ps` or `parallel_status` with the Web details; all read the same Core Board. Recovery retains pending outcomes and repeated native settlement is idempotent. Viewing the UI is not a delivery acknowledgement and cannot resolve a parent-notification problem.

### Cancellation does not become `cancelled`

Admission alone only produces `cancelling`. Inspect native settlement and capability diagnostics. For local children, the current turn stops but descendants continue. For an external one-shot, the run cannot resume even if its final outcome is unavailable.

### Degraded capability diagnostics

Read the specific Host, persistence, tracking, skills, MCP, Python, tools, commands, or context diagnostic. Capabilities fail independently; a degraded Python or MCP record does not imply that Job Board execution state is invalid. A persistence diagnostic means the in-memory fallback is not durable; a tracking diagnostic means native lifecycle observation or recovery is degraded rather than an empty Board being healthy.

### Python-backed skills fail

Confirm Python 3.11+ on PATH and use the `agents-python-tools` skill for environment instructions. Only `jinja2` is automatically provisioned; optional tools install on demand. Do not delete either Python environment as a first troubleshooting step.
