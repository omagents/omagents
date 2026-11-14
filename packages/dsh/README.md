# @omagents/omagents-dsh

Complete DeepSeek Harness integration for OmAgents: 33 skills, native asynchronous subagent lifecycle tracking, durable recovery, `/ps`, `parallel_status`, `cancel_task`, an authorized Remote watch stream, and a native React Web Job Board. The package contains both the Host and Web Client; it is not a skills-only plugin.

## Installation

```bash
dsh plugin --profile web add @omagents/omagents-dsh
```

Requirements:

- Node.js 24.9 or newer.
- DSH `>=0.2.2-rc.1 <0.2.3-0`.
- Python 3.11+ on PATH for Python-backed skills.

Restart DSH after installation. The bare package-root Loader row enables the Host and its attached Web Client together. `@omagents/core` is installed automatically as a dependency; do not install it separately. Users receive built Host and browser artifacts and never need to compile TypeScript or React source.

Only `jinja2` is automatically provisioned. Optional Python tools are installed on demand by the skills that need them. See the `agents-python-tools` skill for environment selection and commands.

## Included Capabilities

- **33 skills**: 18 OmAgents plus 15 Superpowers, rendered with DSH-native tool and delegation semantics.
- **Native background execution**: asynchronous `subagent` without an OpenCode `background` argument, authoritative lifecycle tracking, and exactly-once parent-outcome delivery.
- **Shared status and control**: `/ps`, `parallel_status`, and idempotent `cancel_task` use the same Core Board as the Web UI.
- **Durable state**: profile-scoped `job-board.json`, restart reconciliation, pending-outcome recovery, and visible degraded-health diagnostics.
- **Built-in integrations**: Core MCP resolution, Superpowers bootstrap, deep research, hyperplan, and on-demand Python project overlays.

## Native Web Job Board

Open **OmAgents** from the DSH Web sidebar to display the keyed main panel. The native React UI provides:

- All, Running, Attention required, and Finished filters.
- Execution status, task, agent, elapsed time, notification state, start time, parent/child identity, and result/error details.
- Confirmed, non-repeatable cancellation with a visible `cancelling` state.
- Loading, empty, stale/disconnected, permission-denied, and degraded-health presentations.
- DSH slot and theme-token integration without an iframe or second application root.

The Client consumes the authorized Remote `watchJobs` stream. Every stream starts with a whole-set baseline, later frames replace the complete authorized set, and reconnection starts a fresh baseline. There is no periodic running-job poll. Elapsed time ticks locally, and `listJobs` is used only for explicit refresh.

**Viewing details never acknowledges a model notification.** Notification delivery to the parent agent is independent of whether a human has opened the panel.

See the [complete Job Board guide](https://github.com/omagents/omagents/blob/main/packages/dsh/docs/job-board.md) for the UI and recovery model.

## Cancellation

A cancellation request asks the Host to interrupt the run. Admission changes the job to `cancelling`; it does **not** prove that execution stopped. Only authoritative native settlement produces `cancelled`, `completed`, `failed`, or `interrupted`.

- **Local child**: interruption stops the current turn, and its descendants continue unless cancelled separately. Native DSH continuation behavior is not replaced by a new OmAgents resume feature.
- **External one-shot** run: it stops permanently and cannot resume or receive follow-ups.

Repeated cancellation requests return current state without duplicate Host interrupts. Unknown jobs and failed native admission return structured errors rather than fabricated settlement.

## Recovery

The Board persists beneath the active DSH profile at:

```text
$DSH_HOME/profiles/<active-profile>/omagents/job-board.json
```

Recovery triggers are startup after live-Agent and Session-query capabilities activate, manual refresh through `listJobs`, every new `watchJobs` stream (including reconnection), and authoritative lifecycle events. Startup reconciliation waits for those query capabilities; Remote refreshes and initial/reconnect baselines reconcile only authorized active jobs, while lifecycle events apply their native outcomes directly. Cold Remote queries also defer until the query capabilities are available. There is no periodic running-job poll:

- Still-active work remains `running` or `cancelling`.
- Readable completed outcomes become the appropriate terminal state.
- Missing or unreadable outcomes become `interrupted` with an explicit reason only when no active run is authoritatively observable, never successful completion.
- An observed active external run remains active on a cold session-not-found instead of being misclassified as `interrupted`.
- Terminal jobs with pending parent outcomes remain eligible for delivery after restart.

Repeated events do not duplicate parent notifications. Persistence and other capability failures appear as degraded health instead of being hidden behind an overall success claim.

## Authorization and Security

The active DSH profile is the outer data-isolation boundary. Remote calls also enforce DSH session-resource access through the invocation-derived Context and `remoteAccess.allows()`:

- An optional `parentSessionId` selects an explicit session scope.
- Unscoped reads are filtered per job rather than exposing the whole profile indiscriminately.
- Denied scopes or jobs return `remote-access/denied`; unknown jobs return `omagents/job-not-found`; failed cancellation admission returns `omagents/cancel-failed`.
- A permission-denied Client clears its visible jobs. A temporary carrier loss may show only the last authorized set as stale.

The browser keeps an ephemeral view, not an independent job database. Remote results distinguish success from structured failure, and UI reads never change model-notification acknowledgement.

## Troubleshooting

| Symptom | Checks and action |
| :--- | :--- |
| Host or sidebar panel is missing | Confirm DSH and Node versions, restart DSH, and verify the bare `@omagents/omagents-dsh` Loader row is enabled. Do not add a separate Client row. |
| Jobs do not load or show permission denied | Check access to the parent session and the active profile. Use an authorized DSH Web identity; do not copy another profile's `job-board.json`. |
| Panel is stale or disconnected | Use **Reconnect**. The Client opens a fresh baseline stream; the last authorized set remains visibly stale until synchronization resumes. |
| A job is `interrupted` after restart | Inspect the recovery reason and native Session outcome. `interrupted` means the result could not be confirmed, not that the job succeeded. |
| Cancellation stays `cancelling` | Wait for authoritative native settlement. Remember that local descendants continue and external one-shot runs cannot resume. |
| A capability is degraded | Read the independent Host, persistence, skills, MCP, Python, tools, commands, and context diagnostics in the panel. One failed capability does not prove the others failed. |
| Python-backed skill cannot run | Verify Python 3.11+ on PATH and follow the `agents-python-tools` skill. Only `jinja2` is automatic; install optional tools through their skills on demand. |

## Development and Verification

```bash
npm run typecheck --workspace @omagents/omagents-dsh
npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh
npm test
npm run test:packed
npm run test:browser
```

Current release-candidate verification ran locally on **macOS arm64** with the **`chromium_headless_shell-1228`** override. Linux, Windows, and the default pinned Chromium require **first CI confirmation**; this document does not claim those runs already passed.

## License

MIT — see [LICENSE](https://github.com/omagents/omagents/blob/main/LICENSE).
