import React from "react"

import type { JobDto } from "../../host/remote-types.js"
import { styles } from "../classes.js"

const labels: Record<JobDto["executionState"], string> = {
  running: "Running",
  cancelling: "Cancelling",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
}

const stateStyles: Record<JobDto["executionState"], string> = {
  running: styles.badgeRunning,
  cancelling: styles.badgeCancelling,
  completed: styles.badgeCompleted,
  failed: styles.badgeFailed,
  cancelled: styles.badgeCancelled,
  interrupted: styles.badgeInterrupted,
}

export interface StatusBadgeProps {
  state: JobDto["executionState"]
}

export function StatusBadge({ state }: StatusBadgeProps) {
  return (
    <span role="status" aria-live="off" className={`${styles.badge} ${stateStyles[state]}`}>
      {labels[state]}
    </span>
  )
}
