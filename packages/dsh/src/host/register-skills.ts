import type { Context } from "@deepseek-ai/cordis"
import type { SkillRegistration } from "@deepseek-ai/dsh-skill"
import { listSkillDefinitions, renderSkillForHost } from "@omagents/core"

import {
  appendDshCapabilityDiagnostic,
  setDshCapabilityDiagnostics,
  type DshHealth,
} from "./health.js"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Register Core's complete DSH-rendered catalog when the native registry is available. */
export function registerDshSkills(ctx: Context, health: DshHealth): () => void {
  setDshCapabilityDiagnostics(health, "skills", [])
  const disposers: Array<() => void> = []
  let capabilityFiber: ReturnType<Context["inject"]> | undefined
  let active = false
  let disposed = false

  const cleanup = () => {
    if (!active && disposers.length === 0) return
    active = false
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch (error) {
        appendDshCapabilityDiagnostic(health, "skills", {
          code: "ERR_DSH_SKILL_DISPOSAL",
          message: `Unable to unregister a DSH skill: ${errorMessage(error)}`,
        })
      }
    }
  }

  const activate = (inner: Context) => {
    if (disposed || active) return cleanup
    active = true
    setDshCapabilityDiagnostics(health, "skills", [])

    try {
      const registry = (inner as Context & { skills?: Context["skills"] }).skills
      if (!registry) throw new Error("The DSH skill registry is unavailable")

      for (const definition of listSkillDefinitions({ host: "dsh" })) {
        try {
          const rendered = renderSkillForHost(definition, "dsh")
          const registration: SkillRegistration = {
            name: rendered.name,
            description: rendered.description ?? "",
            path: rendered.path,
            source: definition.source,
            provider: definition.source,
            content: rendered.body,
            resourceBase: {
              kind: "directory",
              path: definition.directory,
            },
          }
          disposers.push(registry.register(registration))
        } catch (error) {
          appendDshCapabilityDiagnostic(health, "skills", {
            code: "ERR_DSH_SKILL_REGISTRATION",
            message: `Unable to register skill "${definition.name}": ${errorMessage(error)}`,
          })
        }
      }
    } catch (error) {
      appendDshCapabilityDiagnostic(health, "skills", {
        code: "ERR_DSH_SKILLS_UNAVAILABLE",
        message: `Unable to discover DSH skills: ${errorMessage(error)}`,
      })
    }
    return cleanup
  }

  try {
    if (typeof ctx.inject === "function" && typeof ctx.get === "function" && !ctx.get("skills")) {
      capabilityFiber = ctx.inject(["skills"], activate)
    } else {
      activate(ctx)
    }
  } catch (error) {
    appendDshCapabilityDiagnostic(health, "skills", {
      code: "ERR_DSH_SKILLS_UNAVAILABLE",
      message: `Unable to subscribe to DSH skill availability: ${errorMessage(error)}`,
    })
  }

  return () => {
    if (disposed) return
    disposed = true
    const capabilityDisposal = capabilityFiber?.dispose()
    if (capabilityDisposal) {
      void capabilityDisposal.catch((error) => {
        appendDshCapabilityDiagnostic(health, "skills", {
          code: "ERR_DSH_SKILL_DISPOSAL",
          message: `Unable to dispose DSH skill availability: ${errorMessage(error)}`,
        })
      })
    }
    cleanup()
  }
}
