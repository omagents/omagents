import { after, afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { mock } from "node:test"

import React from "react"
import { JSDOM } from "jsdom"

import type { HealthDto, JobDto } from "../src/host/remote-types.ts"
import {
  createJobBoardStore,
  type JobBoardSnapshot,
  type JobBoardStore,
  type OmAgentsJobRemote,
} from "../src/client/remote-store.ts"
import { JobBoardPage } from "../src/client/components/JobBoardPage.tsx"
import { JobTable } from "../src/client/components/JobTable.tsx"
import { JobDetails } from "../src/client/components/JobDetails.tsx"
import { StatusBadge } from "../src/client/components/StatusBadge.tsx"

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
})

{
  const window = dom.window as unknown as Window & typeof globalThis
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: window.navigator,
  })
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
}

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react")
const { act } = React

afterEach(() => cleanup())
after(() => dom.window.close())

const healthy: HealthDto = {
  host: { status: "ready", diagnostics: [] },
  persistence: { status: "ready", diagnostics: [] },
  skills: { status: "ready", diagnostics: [] },
  mcp: { status: "ready", diagnostics: [] },
  python: { status: "ready", diagnostics: [] },
  tools: { status: "ready", diagnostics: [] },
  commands: { status: "ready", diagnostics: [] },
  context: { status: "ready", diagnostics: [] },
}

function job(id: string, patch: Partial<JobDto> = {}): JobDto {
  return {
    id,
    host: "dsh",
    hostTaskId: `child-session-${id}`,
    parentSessionId: `parent-session-${id}`,
    childName: `child-name-${id}`,
    alias: `alias-${id}`,
    agent: "explore",
    description: `Research ${id}`,
    executionState: "running",
    notificationState: "pending",
    launchedAt: 1_000,
    updatedAt: 2_000,
    revision: 1,
    ...patch,
  }
}

function snapshot(patch: Partial<JobBoardSnapshot> = {}): JobBoardSnapshot {
  return {
    jobs: [],
    revision: 0,
    status: "ready",
    health: healthy,
    now: 61_000,
    cancellingIds: [],
    ...patch,
  }
}

function storeFixture(initial: JobBoardSnapshot) {
  let current = initial
  const listeners = new Set<() => void>()
  const store: JobBoardStore & {
    cancelJob: ReturnType<typeof mock.fn>
    refresh: ReturnType<typeof mock.fn>
    reconnect: ReturnType<typeof mock.fn>
    setSnapshot(next: JobBoardSnapshot): void
  } = {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async refresh() {},
    async reconnect() {},
    async cancelJob() {},
    clearActionError() {},
    dispose() {},
    setSnapshot(next) {
      current = next
      for (const listener of listeners) listener()
    },
  }
  store.cancelJob = mock.fn(async () => {})
  store.refresh = mock.fn(async () => {})
  store.reconnect = mock.fn(async () => {})
  return store
}

test("JobTable exposes every required column and computes live and terminal elapsed time", () => {
  const running = job("running", { description: "Live research" })
  const finished = job("finished", {
    description: "Finished research",
    executionState: "completed",
    terminalAt: 11_000,
  })
  render(<JobTable jobs={[running, finished]} now={61_000} onCancel={() => {}} />)

  const table = screen.getByRole("table", { name: /background jobs/i })
  for (const heading of [
    "Status",
    "Task",
    "Agent",
    "Elapsed",
    "Notification",
    "Started",
    "Actions",
  ]) {
    assert.ok(within(table).getByRole("columnheader", { name: heading }))
  }
  const liveRow = screen.getByText("Live research").closest("tr")
  const finishedRow = screen.getByText("Finished research").closest("tr")
  assert.ok(liveRow)
  assert.ok(finishedRow)
  assert.ok(within(liveRow).getByText("1m 0s"))
  assert.ok(within(finishedRow).getByText("10s"))
  assert.ok(within(finishedRow).queryByRole("button", { name: /cancel/i }) === null)
})

test("Cancel requires confirmation, explains descendant and one-shot behavior, and submits once", async () => {
  const onCancel = mock.fn(async () => {})
  render(<JobTable jobs={[job("one")]} now={61_000} onCancel={onCancel} />)

  fireEvent.click(screen.getByRole("button", { name: "Cancel Research one" }))
  const dialog = screen.getByRole("alertdialog", { name: /cancel research one/i })
  assert.equal(dialog.getAttribute("aria-modal"), "true")
  assert.match(dialog.textContent ?? "", /descendants continue unless cancelled separately/i)
  assert.match(
    dialog.textContent ?? "",
    /external one-shot runs stop permanently and cannot be resumed/i
  )
  assert.equal(onCancel.mock.callCount(), 0)

  const confirm = within(dialog).getByRole("button", { name: /confirm cancellation/i })
  await act(async () => {
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await Promise.resolve()
  })
  assert.equal(onCancel.mock.callCount(), 1)
})

test("Cancel confirmation closes on Escape without calling the Remote", () => {
  const onCancel = mock.fn(async () => {})
  render(<JobTable jobs={[job("one")]} now={61_000} onCancel={onCancel} />)
  fireEvent.click(screen.getByRole("button", { name: "Cancel Research one" }))
  fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" })
  assert.equal(screen.queryByRole("alertdialog"), null)
  assert.equal(onCancel.mock.callCount(), 0)
})

test("cancelling state disables repeated cancellation and exposes its status", () => {
  const onCancel = mock.fn(async () => {})
  render(
    <JobTable
      jobs={[job("one", { executionState: "cancelling", cancelRequestedAt: 2_000 })]}
      now={61_000}
      onCancel={onCancel}
    />
  )
  const button = screen.getByRole("button", { name: /cancelling research one/i })
  assert.equal((button as HTMLButtonElement).disabled, true)
  fireEvent.click(button)
  assert.equal(onCancel.mock.callCount(), 0)
  assert.equal(screen.queryByRole("alertdialog"), null)
})

test("StatusBadge and table copy cover every execution and notification state", () => {
  for (const state of [
    "running",
    "cancelling",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ] as const) {
    const view = render(<StatusBadge state={state} />)
    assert.equal(screen.getByRole("status").textContent, state[0].toUpperCase() + state.slice(1))
    view.unmount()
  }

  for (const notificationState of ["pending", "injected", "acknowledged"] as const) {
    const view = render(
      <JobTable
        jobs={[job(notificationState, { notificationState })]}
        now={61_000}
        onCancel={() => {}}
      />
    )
    const row = screen.getByText(`Research ${notificationState}`).closest("tr")
    assert.ok(row)
    assert.match(row.textContent ?? "", new RegExp(notificationState, "i"))
    view.unmount()
  }

  render(
    <JobTable
      jobs={[job("none", { notificationState: undefined })]}
      now={61_000}
      onCancel={() => {}}
    />
  )
  assert.ok(screen.getByText("No notification"))
})

test("details expose result/error and parent/child identity without changing notification state", () => {
  const value = job("one", {
    executionState: "failed",
    notificationState: "injected",
    resultSummary: { files: 3, summary: "Partial result" },
    error: { code: "native-error", message: "Model stopped" },
  })
  render(<JobDetails job={value} />)
  assert.ok(screen.getByText("parent-session-one"))
  assert.ok(screen.getByText("child-session-one"))
  assert.ok(screen.getByText("child-name-one"))
  assert.ok(screen.getByText(/Partial result/))
  assert.ok(screen.getByText(/Model stopped/))
  assert.equal(value.notificationState, "injected")
})

test("details disclosure is keyboard accessible and viewing never acknowledges a notification", () => {
  const store = storeFixture(snapshot({ jobs: [job("one", { notificationState: "pending" })] }))
  const acknowledge = mock.fn()
  Object.assign(store, { acknowledgeInjected: acknowledge })
  render(<JobBoardPage store={store} />)

  const disclosure = screen.getByRole("button", { name: /details for research one/i })
  assert.equal(disclosure.getAttribute("aria-expanded"), "false")
  fireEvent.keyDown(disclosure, { key: "Enter" })
  fireEvent.click(disclosure)
  assert.equal(disclosure.getAttribute("aria-expanded"), "true")
  assert.ok(screen.getByText("parent-session-one"))
  assert.equal(store.getSnapshot().jobs[0].notificationState, "pending")
  assert.equal(acknowledge.mock.callCount(), 0)
})

test("a real Remote store does not restart its watch across baseline renders", async (t) => {
  const remote = {
    watchJobs: mock.fn(async function* () {
      yield { revision: 0, jobs: [] }
      await new Promise(() => {})
    }),
    listJobs: mock.fn(async () => ({ ok: true, value: [] })),
    getHealth: mock.fn(async () => ({ ok: true, value: healthy })),
    cancelJob: mock.fn(),
  } as unknown as OmAgentsJobRemote
  const store = createJobBoardStore(remote)
  t.after(() => store.dispose())
  const view = render(<JobBoardPage store={store} />)
  t.after(() => view.unmount())

  await act(async () => {
    await Promise.resolve()
  })
  assert.ok(screen.getByText("No background jobs yet."))
  assert.equal(remote.watchJobs.mock.callCount(), 1)
})

test("all, running, attention, and finished filters are accessible and filter the whole set", () => {
  const jobs = [
    job("live", { executionState: "running", notificationState: "acknowledged" }),
    job("done", {
      executionState: "completed",
      notificationState: "acknowledged",
      terminalAt: 2_000,
    }),
    job("failed", {
      executionState: "failed",
      notificationState: "injected",
      terminalAt: 2_000,
    }),
    job("notice", {
      executionState: "completed",
      notificationState: "pending",
      terminalAt: 2_000,
    }),
  ]
  render(<JobBoardPage store={storeFixture(snapshot({ jobs }))} />)

  const all = screen.getByRole("button", { name: "All" })
  const running = screen.getByRole("button", { name: "Running" })
  const attention = screen.getByRole("button", { name: "Attention required" })
  const finished = screen.getByRole("button", { name: "Finished" })
  assert.equal(all.getAttribute("aria-pressed"), "true")

  fireEvent.click(running)
  assert.equal(running.getAttribute("aria-pressed"), "true")
  assert.ok(screen.getByText("Research live"))
  assert.equal(screen.queryByText("Research done"), null)

  fireEvent.click(attention)
  assert.ok(screen.getByText("Research failed"))
  assert.ok(screen.getByText("Research notice"))
  assert.equal(screen.queryByText("Research live"), null)
  assert.equal(screen.queryByText("Research done"), null)

  fireEvent.click(finished)
  assert.ok(screen.getByText("Research failed"))
  assert.ok(screen.getByText("Research notice"))
  assert.ok(screen.getByText("Research done"))
  assert.equal(screen.queryByText("Research live"), null)

  fireEvent.click(all)
  assert.equal(screen.getAllByRole("row").length, jobs.length + 1)
})

test("empty, loading, stale, permission, action error, and degraded-health states are announced", () => {
  const cases: Array<{
    state: JobBoardSnapshot
    text: RegExp
  }> = [
    { state: snapshot(), text: /no background jobs yet/i },
    {
      state: snapshot({ status: "loading" }),
      text: /loading background jobs/i,
    },
    {
      state: snapshot({ status: "stale", jobs: [job("cached")] }),
      text: /disconnected.*last known jobs/i,
    },
    {
      state: snapshot({ status: "permission-denied", error: "Session access denied" }),
      text: /permission denied/i,
    },
    {
      state: snapshot({ status: "error", error: "Remote unavailable" }),
      text: /remote unavailable/i,
    },
    {
      state: snapshot({ actionError: "Cancellation was refused" }),
      text: /cancellation was refused/i,
    },
    {
      state: snapshot({
        health: {
          ...healthy,
          persistence: {
            status: "degraded",
            diagnostics: [{ code: "write-failed", message: "Persistence is delayed" }],
          },
        },
      }),
      text: /persistence is delayed/i,
    },
  ]

  for (const item of cases) {
    const store = storeFixture(item.state)
    const view = render(<JobBoardPage store={store} />)
    assert.match(document.body.textContent ?? "", item.text)
    view.unmount()
  }
})

test("manual refresh and reconnect call only their explicit store actions", () => {
  const store = storeFixture(snapshot({ status: "stale", jobs: [job("cached")] }))
  render(<JobBoardPage store={store} />)
  fireEvent.click(screen.getByRole("button", { name: /refresh/i }))
  fireEvent.click(screen.getByRole("button", { name: /reconnect/i }))
  assert.equal(store.refresh.mock.callCount(), 1)
  assert.equal(store.reconnect.mock.callCount(), 1)
})
