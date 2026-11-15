import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ROOT } from "./pack-all.js"
import {
  assertCleanWorkingTree,
  assertExactSemver,
  CORE_PACKAGE,
  readGitStatus,
  readReleasePlan,
} from "./release-utils.js"

function serialized(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function setReleaseVersion(version, { root = ROOT, gitStatus = readGitStatus } = {}) {
  assertExactSemver(version)
  assertCleanWorkingTree(root, gitStatus)
  const current = readReleasePlan(root)

  const rootManifestPath = path.join(current.root, "package.json")
  const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, "utf8"))
  const lockfilePath = path.join(current.root, "package-lock.json")
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, "utf8"))
  const manifests = current.packages.map((pkg) => ({
    pkg,
    value: JSON.parse(fs.readFileSync(pkg.manifestPath, "utf8")),
  }))

  rootManifest.version = version
  lockfile.version = version
  lockfile.packages[""].version = version
  for (const { pkg, value } of manifests) {
    value.version = version
    const lockEntry = lockfile.packages[`packages/${pkg.id}`]
    lockEntry.version = version
    if (pkg.id !== "core") {
      value.dependencies[CORE_PACKAGE] = version
      lockEntry.dependencies[CORE_PACKAGE] = version
    }
  }

  fs.writeFileSync(rootManifestPath, serialized(rootManifest))
  for (const { pkg, value } of manifests) fs.writeFileSync(pkg.manifestPath, serialized(value))
  fs.writeFileSync(lockfilePath, serialized(lockfile))
  return readReleasePlan(current.root)
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const args = process.argv.slice(2)
  if (args.length !== 1) {
    console.error("Usage: node scripts/set-release-version.js <exact-version>")
    process.exitCode = 1
  } else {
    try {
      const plan = setReleaseVersion(args[0])
      console.log(`Aligned all four packages and workspace lockfile at ${plan.version}`)
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
