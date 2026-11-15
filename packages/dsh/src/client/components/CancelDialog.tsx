import React, { useEffect, useId, useRef } from "react"
import type { KeyboardEvent } from "react"

import type { JobDto } from "../../host/remote-types.js"
import { styles } from "../classes.js"

export interface CancelDialogProps {
  job: JobDto
  pending: boolean
  onClose(): void
  onConfirm(): void
}

export function CancelDialog({ job, pending, onClose, onConfirm }: CancelDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => previous?.focus()
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== "Tab") return
    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
    if (!buttons || buttons.length === 0) return
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className={styles.dialogBackdrop}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>Cancel {job.description}?</h2>
        <p id={descriptionId}>
          Cancellation asks the Host to interrupt this run; it is not confirmation that the run has
          stopped. Local interruption stops only this child&apos;s current turn, and its descendants
          continue unless cancelled separately. External one-shot runs stop permanently and cannot
          be resumed.
        </p>
        <div className={styles.dialogActions}>
          <button
            ref={closeRef}
            type="button"
            className={styles.button}
            disabled={pending}
            onClick={onClose}
          >
            Keep running
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.dangerButton}`}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Cancelling…" : "Confirm cancellation"}
          </button>
        </div>
      </div>
    </div>
  )
}
