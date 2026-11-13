import type { Context } from "@deepseek-ai/cordis"

import { createDshRuntime, type DshRuntime } from "./runtime.js"
import { registerDshCommands } from "./register-commands.js"
import { registerDshContext } from "./register-context.js"
import { registerDshMcp } from "./register-mcp.js"
import { provisionDshPython } from "./register-python.js"
import { registerDshSkills } from "./register-skills.js"
import { registerDshTools } from "./register-tools.js"

export { createDshRuntime } from "./runtime.js"
export type { DshRuntime } from "./runtime.js"
export { registerDshCommands } from "./register-commands.js"
export { registerDshContext } from "./register-context.js"
export { registerDshMcp } from "./register-mcp.js"
export { provisionDshPython } from "./register-python.js"
export { registerDshSkills } from "./register-skills.js"
export { registerDshTools } from "./register-tools.js"
export type {
  DshCapability,
  DshHealth,
  HealthDiagnostic,
  HealthRecord,
  HealthStatus,
} from "./health.js"

declare module "@deepseek-ai/cordis" {
  interface Context {
    omagents?: DshRuntime
  }
}

export const name = "omagents"
export const inject = ["loader"]

export async function apply(ctx: Context): Promise<void> {
  const runtime = await createDshRuntime(ctx)
  const disposeSkills = registerDshSkills(ctx, runtime.health)
  const disposeMcp = registerDshMcp(ctx, process.env, runtime.health)
  const disposeTools = registerDshTools(ctx, runtime.board, runtime.health)
  const disposeCommands = registerDshCommands(ctx, runtime.board, runtime.health)
  const disposeContext = registerDshContext(ctx, runtime.board, runtime.health)
  ctx.effect(() => async () => {
    disposeContext()
    disposeCommands()
    disposeTools()
    disposeSkills()
    // Start closing the Board synchronously; Loader removal may call the
    // effect disposer twice without awaiting its first in-flight settlement.
    const runtimeDisposal = runtime.dispose()
    await disposeMcp()
    await runtimeDisposal
  }, "omagents capabilities and runtime")
  ctx.provide("omagents", runtime)
  // Python owns a separate effect so Loader teardown invalidates its late
  // completion independently of skill, MCP, and Board cleanup.
  provisionDshPython(ctx, runtime.health)
}
