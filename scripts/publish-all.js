import path from "node:path"
import { fileURLToPath } from "node:url"

import { checkRelease } from "./check-release.js"
import { ROOT, runNpm } from "./pack-all.js"
import { inspectReleaseArtifacts, readReleasePlan } from "./release-utils.js"

export async function getPublishedVersion(pkg) {
  let stdout
  try {
    ;({ stdout } = await runNpm(["view", `${pkg.name}@${pkg.version}`, "version", "--json"], {
      cwd: ROOT,
      echo: false,
    }))
  } catch (error) {
    if (/\bE404\b|404 Not Found/i.test(error.message)) return null
    throw error
  }
  const published = JSON.parse(stdout.trim())
  if (published !== pkg.version) {
    throw new Error(`Registry returned ${JSON.stringify(published)} for ${pkg.name}@${pkg.version}`)
  }
  return published
}

export async function publishArtifact(pkg, artifact, { root = ROOT, echo = true } = {}) {
  await runNpm(["publish", artifact.tarball, "--access", "public"], { cwd: root, echo })
}

// npm returns "+ pkg@version" immediately after `npm publish`, but registry
// propagation routinely takes a minute or more, so the confirmation budget is
// ~5 minutes (29 waits × 10s) instead of the old 60s that forced manual reruns.
export const REGISTRY_CONFIRM_ATTEMPTS = 30
export const REGISTRY_CONFIRM_INTERVAL_MS = 10_000

async function confirmRegistryVersion(
  pkg,
  { getPublishedVersion, delay, attempts = REGISTRY_CONFIRM_ATTEMPTS }
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const published = await getPublishedVersion(pkg)
    if (published === pkg.version) return
    if (published !== null) {
      throw new Error(`Registry confirmation failed for ${pkg.name}@${pkg.version}`)
    }
    if (attempt < attempts) await delay(REGISTRY_CONFIRM_INTERVAL_MS)
  }
  throw new Error(`Timed out waiting for ${pkg.name}@${pkg.version} in npm`)
}

export async function publishAll({
  root = ROOT,
  execute = false,
  releaseTag = process.env.GITHUB_REF_NAME,
  preflight = checkRelease,
  inspectArtifacts = inspectReleaseArtifacts,
  getPublishedVersion: viewVersion = getPublishedVersion,
  publishPackage = publishArtifact,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  echo = true,
} = {}) {
  const plan = readReleasePlan(root)
  if (!execute) {
    return {
      execute: false,
      version: plan.version,
      publishOrder: plan.publishOrder,
      packages: plan.packages.map(({ id, name, version }) => ({ id, name, version })),
    }
  }
  if (releaseTag && releaseTag !== `v${plan.version}`) {
    throw new Error(`Release tag ${releaseTag} does not match v${plan.version}`)
  }

  await preflight({ root, allowDirty: false, echo })
  const artifactManifest = await inspectArtifacts(plan)
  const artifacts = new Map(artifactManifest.artifacts.map((artifact) => [artifact.id, artifact]))
  for (const pkg of plan.packages) {
    if (typeof artifacts.get(pkg.id)?.tarball !== "string") {
      throw new Error(`No inspected tarball is available for ${pkg.name}@${pkg.version}`)
    }
  }

  const registry = new Map()
  for (const pkg of plan.packages) {
    const published = await viewVersion(pkg)
    if (published !== null && published !== pkg.version) {
      throw new Error(`Registry confirmation failed for ${pkg.name}@${pkg.version}`)
    }
    registry.set(pkg.id, published)
  }

  const results = []
  for (const pkg of plan.packages) {
    if (registry.get(pkg.id) === pkg.version) {
      if (echo) console.log(`Skipping already-published ${pkg.name}@${pkg.version}`)
      results.push({ id: pkg.id, name: pkg.name, version: pkg.version, action: "skipped" })
      continue
    }
    if (echo) console.log(`Publishing ${pkg.name}@${pkg.version}`)
    await publishPackage(pkg, artifacts.get(pkg.id), { root, echo })
    await confirmRegistryVersion(pkg, { getPublishedVersion: viewVersion, delay })
    registry.set(pkg.id, pkg.version)
    results.push({ id: pkg.id, name: pkg.name, version: pkg.version, action: "published" })
  }
  return results
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== "--execute") || args.length > 1) {
    console.error("Usage: node scripts/publish-all.js [--execute]")
    process.exitCode = 1
  } else {
    try {
      const execute = args.includes("--execute")
      const result = await publishAll({ execute })
      if (!execute) {
        console.log(
          `Dry run for aligned release ${result.version}: ${result.publishOrder.join(" → ")}`
        )
        console.log(
          "No checks, registry calls, or publishes ran. Re-run with --execute only after explicit authorization."
        )
      }
    } catch (error) {
      console.error(error.stack || error.message)
      process.exitCode = 1
    }
  }
}
