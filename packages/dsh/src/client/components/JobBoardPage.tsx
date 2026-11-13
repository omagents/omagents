import React, { useMemo, useState } from "react"
import { useSyncExternalStore } from "react"

import type { JobBoardStore, JobBoardSnapshot } from "../remote-store.js"
import type { HealthDto, JobDto } from "../../host/remote-types.js"
import { styles } from "../classes.js"
import { JobTable } from "./JobTable.js"

export interface JobBoardPageProps {
  store: JobBoardStore
}

export type JobFilter = "all" | "running" | "attention" | "finished"

const terminalStates = new Set<JobDto["executionState"]>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
])

function matchesFilter(job: JobDto, filter: JobFilter): boolean {
  if (filter === "all") return true
  if (filter === "running") {
    return job.executionState === "running" || job.executionState === "cancelling"
  }
  if (filter === "finished") return terminalStates.has(job.executionState)
  return (
    job.executionState === "failed" ||
    job.executionState === "interrupted" ||
    job.notificationState === "pending"
  )
}

function degradedDiagnostics(health: HealthDto | undefined) {
  if (!health) return []
  return Object.values(health).flatMap((record) =>
    record.status === "degraded" ? record.diagnostics : []
  )
}

function ConnectionNotice({ snapshot }: { snapshot: JobBoardSnapshot }) {
  if (snapshot.status === "loading") {
    return <p role="status" className={styles.notice}>Loading background jobs…</p>
  }
  if (snapshot.status === "stale") {
    return (
      <p role="status" className={styles.stale}>
        Disconnected. Showing the last known jobs while reconnecting.
      </p>
    )
  }
  if (snapshot.status === "permission-denied") {
    return (
      <div role="alert" className={styles.error}>
        <strong>Permission denied.</strong>
        <p>{snapshot.error ?? "You do not have access to this Job Board scope."}</p>
      </div>
    )
  }
  if (snapshot.status === "error") {
    return (
      <div role="alert" className={styles.error}>
        <strong>The Job Board could not be loaded.</strong>
        <p>{snapshot.error ?? "Remote unavailable"}</p>
      </div>
    )
  }
  return null
}

export function JobBoardPage({ store }: JobBoardPageProps) {
  const snapshot = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot()
  )
  const [filter, setFilter] = useState<JobFilter>("all")
  const jobs = useMemo(
    () => snapshot.jobs.filter((job) => matchesFilter(job, filter)),
    [snapshot.jobs, filter]
  )
  const diagnostics = degradedDiagnostics(snapshot.health)
  const filters: Array<{ id: JobFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "running", label: "Running" },
    { id: "attention", label: "Attention required" },
    { id: "finished", label: "Finished" },
  ]
  const showJobs =
    snapshot.status === "ready" || snapshot.status === "stale" || snapshot.jobs.length > 0

  return (
    <section className={styles.page} aria-labelledby="omagents-job-board-title">
      <header className={styles.header}>
        <h1 id="omagents-job-board-title" className={styles.title}>OmAgents Job Board</h1>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => void store.refresh()}>
            Refresh
          </button>
          <button type="button" className={styles.button} onClick={() => void store.reconnect()}>
            Reconnect
          </button>
        </div>
      </header>

      <ConnectionNotice snapshot={snapshot} />
      {snapshot.actionError && (
        <div role="alert" className={styles.error}>
          <span>{snapshot.actionError}</span>{" "}
          <button type="button" className={styles.button} onClick={() => store.clearActionError()}>
            Dismiss
          </button>
        </div>
      )}
      {diagnostics.length > 0 && (
        <section role="status" className={styles.degraded} aria-label="Degraded OmAgents capabilities">
          <strong>Some OmAgents capabilities are degraded.</strong>
          <ul>
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${index}`}>{diagnostic.message}</li>
            ))}
          </ul>
        </section>
      )}

      {showJobs && (
        <>
          <div className={styles.filters} role="group" aria-label="Filter background jobs">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.filterButton} ${filter === item.id ? styles.filterButtonActive : ""}`}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {jobs.length > 0 ? (
            <JobTable
              jobs={jobs}
              now={snapshot.now}
              cancellingIds={snapshot.cancellingIds}
              onCancel={(job) => store.cancelJob(job.id)}
            />
          ) : (
            <p className={styles.empty}>
              {snapshot.jobs.length === 0 && filter === "all"
                ? "No background jobs yet."
                : "No background jobs match this filter."}
            </p>
          )}
        </>
      )}
    </section>
  )
}
