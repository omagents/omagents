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

/** Register Core's complete DSH-rendered catalog in the native DSH registry. */
export function registerDshSkills(ctx: Context, health: DshHealth): () => void {
  setDshCapabilityDiagnostics(health, "skills", [])
  const disposers: Array<() => void> = []

  try {
    const registry = (ctx as Context & { skills?: Context["skills"] }).skills
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

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
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
}
