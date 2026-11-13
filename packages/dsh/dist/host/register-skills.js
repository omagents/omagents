import { listSkillDefinitions, renderSkillForHost } from "@omagents/core";
import { appendDshCapabilityDiagnostic, setDshCapabilityDiagnostics, } from "./health.js";
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Register Core's complete DSH-rendered catalog in the native DSH registry. */
export function registerDshSkills(ctx, health) {
    setDshCapabilityDiagnostics(health, "skills", []);
    const disposers = [];
    try {
        const registry = ctx.skills;
        if (!registry)
            throw new Error("The DSH skill registry is unavailable");
        for (const definition of listSkillDefinitions({ host: "dsh" })) {
            try {
                const rendered = renderSkillForHost(definition, "dsh");
                const registration = {
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
                };
                disposers.push(registry.register(registration));
            }
            catch (error) {
                appendDshCapabilityDiagnostic(health, "skills", {
                    code: "ERR_DSH_SKILL_REGISTRATION",
                    message: `Unable to register skill "${definition.name}": ${errorMessage(error)}`,
                });
            }
        }
    }
    catch (error) {
        appendDshCapabilityDiagnostic(health, "skills", {
            code: "ERR_DSH_SKILLS_UNAVAILABLE",
            message: `Unable to discover DSH skills: ${errorMessage(error)}`,
        });
    }
    let disposed = false;
    return () => {
        if (disposed)
            return;
        disposed = true;
        for (const dispose of disposers.splice(0).reverse()) {
            try {
                dispose();
            }
            catch (error) {
                appendDshCapabilityDiagnostic(health, "skills", {
                    code: "ERR_DSH_SKILL_DISPOSAL",
                    message: `Unable to unregister a DSH skill: ${errorMessage(error)}`,
                });
            }
        }
    };
}
