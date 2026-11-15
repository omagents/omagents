import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import {
  computeLockfileFingerprint,
  computeSourceFingerprint,
  PACKAGE_WORKSPACES,
  readPackManifest,
  ROOT,
} from "./pack-all.js"

export const PUBLISH_ORDER = Object.freeze(PACKAGE_WORKSPACES.map(({ id }) => id))
export const CORE_PACKAGE = "@omagents/core"

const HOST_PACKAGE_NAMES = PACKAGE_WORKSPACES.slice(1).map(({ name }) => name)
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]
const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

export function assertExactSemver(version) {
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(
      `Expected exact SemVer such as 1.2.3 or 1.2.3-rc.1; received ${JSON.stringify(version)}`
    )
  }
  return version
}

export function readReleasePlan(root = ROOT) {
  const absoluteRoot = path.resolve(root)
  const rootManifestPath = path.join(absoluteRoot, "package.json")
  const rootManifest = readJson(rootManifestPath)
  assertExactSemver(rootManifest.version)

  const packages = PACKAGE_WORKSPACES.map((definition) => {
    const directory = path.join(absoluteRoot, "packages", definition.id)
    const manifestPath = path.join(directory, "package.json")
    const manifest = readJson(manifestPath)
    if (manifest.name !== definition.name) {
      throw new Error(`${manifestPath} must be named ${definition.name}; received ${manifest.name}`)
    }
    assertExactSemver(manifest.version)
    return { ...manifest, ...definition, directory, manifestPath }
  })

  const versions = new Set([rootManifest.version, ...packages.map((pkg) => pkg.version)])
  if (versions.size !== 1) {
    throw new Error(
      `The private root and all four packages must have aligned versions; received ${[
        ...versions,
      ].join(", ")}`
    )
  }
  const version = rootManifest.version
  const hosts = packages.slice(1)
  for (const host of hosts) {
    if (host.dependencies?.[CORE_PACKAGE] !== version) {
      throw new Error(
        `${host.name} must depend on exact ${CORE_PACKAGE}@${version}; received ${host.dependencies?.[CORE_PACKAGE]}`
      )
    }
    for (const field of DEPENDENCY_FIELDS) {
      for (const hostName of HOST_PACKAGE_NAMES) {
        if (host[field]?.[hostName] !== undefined) {
          throw new Error(`${host.name} must not depend on another host: ${field}.${hostName}`)
        }
      }
    }
  }

  const lockfilePath = path.join(absoluteRoot, "package-lock.json")
  const lockfile = readJson(lockfilePath)
  if (lockfile.version !== version || lockfile.packages?.[""]?.version !== version) {
    throw new Error(`${lockfilePath} must contain aligned private-root version ${version}`)
  }
  for (const pkg of packages) {
    const entry = lockfile.packages?.[`packages/${pkg.id}`]
    if (!entry || entry.version !== version) {
      throw new Error(`${lockfilePath} must contain ${pkg.name}@${version}`)
    }
    if (pkg.id !== "core" && entry.dependencies?.[CORE_PACKAGE] !== version) {
      throw new Error(
        `${lockfilePath} must record ${pkg.name}'s exact ${CORE_PACKAGE}@${version} dependency`
      )
    }
  }

  return {
    root: absoluteRoot,
    version,
    publishOrder: [...PUBLISH_ORDER],
    packages,
    hosts,
  }
}

export function readGitStatus(root = ROOT) {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Unable to inspect the Git working tree: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

export function assertCleanWorkingTree(root = ROOT, gitStatus = readGitStatus) {
  const status = gitStatus(root)
  if (status.trim()) {
    throw new Error(`A clean working tree is required before release:\n${status.trimEnd()}`)
  }
}

export function inspectReleaseArtifacts(plan) {
  const manifest = readPackManifest()
  if (manifest.version !== plan.version) {
    throw new Error(`Pack manifest version ${manifest.version} does not match ${plan.version}`)
  }
  if (manifest.sourceSha256 !== computeSourceFingerprint()) {
    throw new Error("Pack manifest source fingerprint is stale")
  }
  if (manifest.lockfileSha256 !== computeLockfileFingerprint()) {
    throw new Error("Pack manifest lockfile fingerprint is stale")
  }
  if (manifest.artifacts.length !== plan.packages.length) {
    throw new Error("Pack manifest must contain exactly four artifacts")
  }
  for (const [index, pkg] of plan.packages.entries()) {
    const artifact = manifest.artifacts[index]
    if (artifact.id !== pkg.id || artifact.name !== pkg.name || artifact.version !== pkg.version) {
      throw new Error(`Pack artifact ${index + 1} does not match ${pkg.name}@${pkg.version}`)
    }
  }
  return manifest
}
