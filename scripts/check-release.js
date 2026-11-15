import path from "node:path"
import { fileURLToPath } from "node:url"

import { ROOT, runNpm } from "./pack-all.js"
import {
  assertCleanWorkingTree,
  inspectReleaseArtifacts,
  readGitStatus,
  readReleasePlan,
} from "./release-utils.js"

export async function checkRelease({
  root = ROOT,
  allowDirty = false,
  gitStatus = readGitStatus,
  runNpm: runNpmCommand = runNpm,
  inspectArtifacts = inspectReleaseArtifacts,
  echo = true,
} = {}) {
  if (!allowDirty) assertCleanWorkingTree(root, gitStatus)
  const plan = readReleasePlan(root)
  const runStep = async (args) => {
    if (echo) console.log(`\n> npm ${args.join(" ")}`)
    await runNpmCommand(args, { cwd: root, echo })
  }

  await runStep(["run", "build", "--workspace", "@omagents/omagents-dsh"])
  await runStep(["test"])
  await runStep(["run", "pack:all"])
  const artifacts = await inspectArtifacts(plan)
  await runStep(["run", "test:packed"])
  await runStep(["run", "test:browser"])
  if (!allowDirty) assertCleanWorkingTree(root, gitStatus)
  if (echo) console.log(`\nRelease gate passed for ${plan.version}`)
  return { plan, artifacts }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== "--allow-dirty") || args.length > 1) {
    console.error("Usage: node scripts/check-release.js [--allow-dirty]")
    process.exitCode = 1
  } else {
    try {
      await checkRelease({ allowDirty: args.includes("--allow-dirty") })
    } catch (error) {
      console.error(error.stack || error.message)
      process.exitCode = 1
    }
  }
}
