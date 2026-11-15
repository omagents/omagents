import React from "react"
import type { Context } from "@deepseek-ai/cordis"
import type {} from "@deepseek-ai/dsh-api-remotes/client"
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client"
import type {} from "@deepseek-ai/dsh-client-ui-layout/client"
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client"

import { JobBoardPage } from "./components/JobBoardPage.js"
import { createJobBoardStore } from "./remote-store.js"
import { TYPERT_REMOTE } from "./remote-contribution.js"

export { createJobBoardStore } from "./remote-store.js"
export type {
  JobBoardConnectionStatus,
  JobBoardSnapshot,
  JobBoardStore,
  OmAgentsJobRemote,
} from "./remote-store.js"

export const PANEL_ID = "omagents"
export const inject = ["slots", "remote"]

interface JobBoardIconProps {
  size?: number
}

export function JobBoardIcon({ size = 20 }: JobBoardIconProps) {
  return React.createElement(
    "svg",
    {
      className: "omagents-job-board__icon",
      width: size,
      height: size,
      viewBox: "0 0 20 20",
      "aria-hidden": true,
      focusable: "false",
    },
    React.createElement("path", {
      d: "M3 3.5h14v3H3zM3 8.5h14v3H3zM3 13.5h14v3H3z",
    })
  )
}

/** Mount the Host Remote and attach the native panel to the package-root fiber. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE)
  let store: ReturnType<typeof createJobBoardStore> | undefined
  const disposers: Array<() => void> = []
  const ui = ctx.inject(["remote.omagents"], (inner) => {
    store = createJobBoardStore(inner.remote.omagents)
    disposers.push(
      inner.slots.inject("main", () =>
        inner.slots.register(
          {
            name: "main",
            key: PANEL_ID,
            inject: () => ({ store: store! }),
          },
          JobBoardPage
        )
      )
    )
    disposers.push(
      inner.slots.inject("sidebar.panellist", () =>
        inner.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: 20,
            label: "OmAgents",
          },
          JobBoardIcon
        )
      )
    )
  })
  try {
    await ui
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    store?.dispose()
    await ui.dispose()
    await unmount()
    throw error
  }

  return async () => {
    for (const dispose of disposers.reverse()) dispose()
    store?.dispose()
    await ui.dispose()
    await unmount()
  }
}
