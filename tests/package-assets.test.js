import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { getCorePaths } from "../packages/core/src/paths.js"

const ROOT = path.resolve(import.meta.dirname, "..")
const NPM = process.platform === "win32" ? "npm.cmd" : "npm"
const CORE_PATHS = getCorePaths()
const SUPERPOWERS_SKILLS = [
  "brainstorming",
  "test-driven-development",
  "systematic-debugging",
  "writing-plans",
  "executing-plans",
  "requesting-code-review",
  "receiving-code-review",
  "using-git-worktrees",
  "verification-before-completion",
  "writing-skills",
  "subagent-driven-development",
  "dispatching-parallel-agents",
  "finishing-a-development-branch",
  "using-superpowers",
  "diagnosing-superpowers",
]

test("workspace-packed Core bundles the pinned Superpowers plugin and all 15 skills", () => {
  const superpowersPackage = JSON.parse(
    fs.readFileSync(path.join(CORE_PATHS.superpowersDir, "package.json"), "utf8")
  )
  const result = spawnSync(NPM, ["pack", "--workspace", "@omagents/core", "--dry-run", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const [artifact] = JSON.parse(result.stdout)
  const packedPaths = new Set([...artifact.files.map((file) => file.path), ...artifact.bundled])
  const expected = [
    superpowersPackage.main,
    ...SUPERPOWERS_SKILLS.map((skill) => `skills/${skill}/SKILL.md`),
  ]

  for (const relativePath of expected) {
    const bundledPath = `node_modules/superpowers/${relativePath}`
    assert.ok(packedPaths.has(bundledPath), `Core tarball must contain ${bundledPath}`)
  }
  assert.ok(artifact.bundled.includes("superpowers"), "npm must bundle Superpowers itself")
})
