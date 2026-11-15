import React from "react"

import type { JobDto } from "../../host/remote-types.js"
import { styles } from "../classes.js"

export interface JobDetailsProps {
  job: JobDto
  id?: string
}

function printable(value: unknown): string {
  if (value === undefined) return "None"
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

export function JobDetails({ job, id }: JobDetailsProps) {
  const identities = [
    ["Job ID", job.id],
    ["Alias", job.alias],
    ["Parent session", job.parentSessionId],
    ["Child session", job.hostTaskId],
    ["Child name", job.childName ?? "Not supplied"],
    ["Agent", job.agent],
    ["Host", job.host],
    ["Notification", job.notificationState ?? "None"],
  ]
  return (
    <section id={id} className={styles.details} aria-label={`Details for ${job.description}`}>
      <dl className={styles.detailsGrid}>
        {identities.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={styles.detailValue}>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>Result</h3>
      <pre>{printable(job.resultSummary)}</pre>
      <h3>Error</h3>
      <pre>{printable(job.error)}</pre>
    </section>
  )
}
