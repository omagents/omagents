import fs from "node:fs"
import path from "node:path"
import { getCorePaths } from "../paths.js"
import { parseSkillFrontmatter, selectSkillPath, SKILL_HOSTS } from "./render.js"

function discoverSkills(skillsRoot, source, host) {
  let entries
  try {
    entries = fs.readdirSync(skillsRoot, { withFileTypes: true })
  } catch {
    return []
  }

  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_")
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const directory = path.join(skillsRoot, entry.name)
      const sharedPath = path.join(directory, "SKILL.md")
      if (!fs.existsSync(sharedPath)) return []

      const selectedPath = selectSkillPath(directory, host)
      const { frontmatter } = parseSkillFrontmatter(fs.readFileSync(selectedPath, "utf8"))
      return [
        {
          id: entry.name,
          name: frontmatter.name || entry.name,
          ...(frontmatter.description ? { description: frontmatter.description } : {}),
          source,
          directory,
          sharedPath,
          path: selectedPath,
        },
      ]
    })
}

/** List OmAgents and Superpowers file-based skills for one explicit host. */
export function listSkillDefinitions({ host } = {}) {
  if (!SKILL_HOSTS.includes(host)) {
    throw new RangeError(`Unsupported skill host: ${host}. Expected one of ${SKILL_HOSTS.join(", ")}`)
  }

  const paths = getCorePaths()
  return [
    ...discoverSkills(paths.skillsDir, "omagents", host),
    ...discoverSkills(path.join(paths.superpowersDir, "skills"), "superpowers", host),
  ]
}
