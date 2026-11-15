import React, { useRef, useState } from "react"

import type { JobDto } from "../../host/remote-types.js"
import { styles } from "../classes.js"
import { CancelDialog } from "./CancelDialog.js"
import { JobDetails } from "./JobDetails.js"
import { StatusBadge } from "./StatusBadge.js"

export interface JobTableProps {
  jobs: readonly JobDto[]
  now: number
  cancellingIds?: readonly string[]
  onCancel(job: JobDto): void | Promise<void>
}

const notificationLabels = {
  pending: "Pending notification",
  injected: "Injected notification",
  acknowledged: "Acknowledged notification",
} as const

function elapsedMilliseconds(job: JobDto, now: number): number {
  const end = job.terminalAt ?? now
  return Math.max(0, end - job.launchedAt)
}

export function formatElapsed(job: JobDto, now: number): string {
  const seconds = Math.floor(elapsedMilliseconds(job, now) / 1_000)
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${remainder}s`
  if (minutes > 0) return `${minutes}m ${remainder}s`
  return `${remainder}s`
}

export function JobTable({ jobs, now, cancellingIds = [], onCancel }: JobTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [cancelTarget, setCancelTarget] = useState<JobDto | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  function toggleDetails(jobId: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  async function confirmCancellation() {
    if (!cancelTarget || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      await onCancel(cancelTarget)
      setCancelTarget(undefined)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className={styles.tableWrapper}>
        <table className={styles.table} aria-label="OmAgents background jobs">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Task</th>
              <th scope="col">Agent</th>
              <th scope="col">Elapsed</th>
              <th scope="col">Notification</th>
              <th scope="col">Started</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const isExpanded = expanded.has(job.id)
              const detailsId = `omagents-job-details-${job.id}`
              const isCancelling =
                job.executionState === "cancelling" || cancellingIds.includes(job.id)
              const canCancel = job.executionState === "running" || job.executionState === "cancelling"
              return (
                <JobRows
                  key={job.id}
                  job={job}
                  now={now}
                  isExpanded={isExpanded}
                  detailsId={detailsId}
                  isCancelling={isCancelling}
                  canCancel={canCancel}
                  onToggle={() => toggleDetails(job.id)}
                  onCancel={() => setCancelTarget(job)}
                />
              )
            })}
          </tbody>
        </table>
      </div>
      {cancelTarget && (
        <CancelDialog
          job={cancelTarget}
          pending={submitting}
          onClose={() => {
            if (!submittingRef.current) setCancelTarget(undefined)
          }}
          onConfirm={() => void confirmCancellation()}
        />
      )}
    </>
  )
}

interface JobRowsProps {
  job: JobDto
  now: number
  isExpanded: boolean
  detailsId: string
  isCancelling: boolean
  canCancel: boolean
  onToggle(): void
  onCancel(): void
}

function JobRows({
  job,
  now,
  isExpanded,
  detailsId,
  isCancelling,
  canCancel,
  onToggle,
  onCancel,
}: JobRowsProps) {
  return (
    <>
      <tr>
        <td><StatusBadge state={job.executionState} /></td>
        <td>
          <button
            type="button"
            className={styles.taskButton}
            aria-label={`Details for ${job.description}`}
            aria-expanded={isExpanded}
            aria-controls={isExpanded ? detailsId : undefined}
            onClick={onToggle}
          >
            {job.description}
          </button>
        </td>
        <td>{job.agent}</td>
        <td>{formatElapsed(job, now)}</td>
        <td>{job.notificationState ? notificationLabels[job.notificationState] : "No notification"}</td>
        <td>
          <time dateTime={new Date(job.launchedAt).toISOString()}>
            {new Date(job.launchedAt).toLocaleString()}
          </time>
        </td>
        <td>
          {canCancel && (
            <button
              type="button"
              className={`${styles.button} ${styles.dangerButton}`}
              disabled={isCancelling}
              aria-label={`${isCancelling ? "Cancelling" : "Cancel"} ${job.description}`}
              onClick={onCancel}
            >
              {isCancelling ? "Cancelling…" : "Cancel"}
            </button>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7}>
            <JobDetails id={detailsId} job={job} />
          </td>
        </tr>
      )}
    </>
  )
}
