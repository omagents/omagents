import type { Context } from "@deepseek-ai/cordis"

import { createDshRuntime, type DshRuntime } from "./runtime.js"

export { createDshRuntime } from "./runtime.js"
export type { DshRuntime } from "./runtime.js"
export type { DshHealth, HealthDiagnostic, HealthRecord, HealthStatus } from "./health.js"

declare module "@deepseek-ai/cordis" {
  interface Context {
    omagents?: DshRuntime
  }
}

export const name = "omagents"
export const inject = ["loader"]

export async function apply(ctx: Context): Promise<void> {
  const runtime = await createDshRuntime(ctx)
  ctx.effect(() => () => runtime.dispose(), "omagents runtime")
  ctx.provide("omagents", runtime)
}
