import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  ARTIFACT_ROOT,
  PACK_MANIFEST,
  PACKAGE_WORKSPACES,
  ROOT,
  computeLockfileFingerprint,
  computeSourceFingerprint,
  packAll,
  readPackManifest,
  runNpm,
} from "./pack-all.js"

export const CLEAN_ROOM_SUMMARY = path.join(ARTIFACT_ROOT, "clean-room.json")
export const OFFLINE_CACHE = path.join(ARTIFACT_ROOT, "offline-npm-cache")
const CACHE_SEAL = path.join(OFFLINE_CACHE, "omagents-seed.json")
const DSH_VERSION = "0.2.2-rc.3"
const MCP_NAMES = ["agentmemory", "codegraph", "context7", "websearch", "grep_app"]

function hash(value) {
  return createHash("sha256").update(value).digest("hex")
}

function temporaryRoot(prefix) {
  const base = process.env.OMAGENTS_TEST_TMP ?? os.tmpdir()
  fs.mkdirSync(base, { recursive: true })
  return fs.realpathSync(fs.mkdtempSync(path.join(base, prefix)))
}

function tarballDependency(artifact) {
  return pathToFileURL(artifact.tarball).href
}

function writePackage(directory, dependencies, extra = {}) {
  fs.mkdirSync(directory, { recursive: true })
  const manifest = {
    name: "omagents-clean-room-verification",
    private: true,
    type: "module",
    dependencies,
    ...extra,
  }
  fs.writeFileSync(path.join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function packageNameFromLockKey(key) {
  const marker = key.lastIndexOf("node_modules/")
  return marker < 0 ? undefined : key.slice(marker + "node_modules/".length)
}

function resolveLockDependency(packages, fromKey, dependency) {
  let directory = fromKey
  for (;;) {
    const candidate = directory
      ? `${directory}/node_modules/${dependency}`
      : `node_modules/${dependency}`
    if (packages[candidate]) return candidate
    if (!directory) break
    const marker = directory.lastIndexOf("node_modules/")
    directory = marker < 0 ? "" : directory.slice(0, marker).replace(/\/$/, "")
  }
  return undefined
}

function productionClosureEntries(lock) {
  const packages = lock.packages
  const dshSource = JSON.parse(
    fs.readFileSync(path.join(ROOT, "packages", "dsh", "package.json"), "utf8")
  )
  const roots = new Set([
    "node_modules/@deepseek-ai/dsh",
    "node_modules/@deepseek-ai/cordis-plugin-loader",
    "node_modules/@deepseek-ai/dsh-typert-loader",
  ])
  for (const dependency of Object.keys(dshSource.dependencies)) {
    if (dependency === "@omagents/core") continue
    roots.add(`node_modules/${dependency}`)
  }

  const visited = new Set()
  const queue = [...roots]
  while (queue.length > 0) {
    const key = queue.shift()
    if (!key || visited.has(key)) continue
    const entry = packages[key]
    if (!entry) throw new Error(`The lockfile is missing production dependency ${key}`)
    visited.add(key)
    const dependencies = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
    }
    for (const [peer, range] of Object.entries(entry.peerDependencies ?? {})) {
      if (!entry.peerDependenciesMeta?.[peer]?.optional) dependencies[peer] = range
    }
    for (const dependency of Object.keys(dependencies)) {
      const resolved = resolveLockDependency(packages, key, dependency)
      if (resolved) queue.push(resolved)
      else if (!entry.optionalDependencies?.[dependency]) {
        throw new Error(`Unable to resolve ${dependency} required by ${key}`)
      }
    }
  }

  return [...visited].map((key) => ({
    key,
    entry: packages[key],
    name: packageNameFromLockKey(key),
  }))
}

function productionDependencyClosure(lock) {
  return productionClosureEntries(lock)
    .filter(({ entry, name }) => name && entry.version && /^https?:/.test(entry.resolved ?? ""))
    .map(({ entry, name }) => ({
      name,
      version: entry.version,
      resolved: entry.resolved,
      spec: `${name}@${entry.version}`,
    }))
    .sort((a, b) => a.spec.localeCompare(b.spec))
}

function writeCleanLock(directory, manifest, packed) {
  const sourceLock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"))
  const packages = {
    "": {
      name: manifest.name,
      version: "0.0.0",
      dependencies: manifest.dependencies,
    },
  }
  for (const { key, entry } of productionClosureEntries(sourceLock)) {
    packages[key] = { ...entry }
    delete packages[key].dev
  }
  for (const artifact of packed.artifacts) {
    const dependency = manifest.dependencies[artifact.name]
    if (!dependency) continue
    const sourceManifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, "packages", artifact.id, "package.json"), "utf8")
    )
    packages[`node_modules/${artifact.name}`] = {
      name: artifact.name,
      version: artifact.version,
      resolved: dependency,
      integrity: artifact.integrity,
      ...(sourceManifest.dependencies ? { dependencies: sourceManifest.dependencies } : {}),
      ...(sourceManifest.bundledDependencies
        ? { bundledDependencies: sourceManifest.bundledDependencies }
        : {}),
      ...(sourceManifest.bin ? { bin: sourceManifest.bin } : {}),
      ...(sourceManifest.engines ? { engines: sourceManifest.engines } : {}),
    }
  }
  const lock = {
    name: manifest.name,
    version: "0.0.0",
    lockfileVersion: 3,
    requires: true,
    packages,
  }
  fs.writeFileSync(path.join(directory, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`)
}

export async function seedOfflineCache({ echo = true } = {}) {
  const lockPath = path.join(ROOT, "package-lock.json")
  const lockBytes = fs.readFileSync(lockPath)
  const lock = JSON.parse(lockBytes.toString("utf8"))
  const dependencies = productionDependencyClosure(lock)
  const seal = {
    schemaVersion: 1,
    lockSha256: hash(lockBytes),
    dependencies: dependencies.map(({ spec, resolved }) => ({ spec, resolved })),
  }
  if (fs.existsSync(CACHE_SEAL)) {
    const current = JSON.parse(fs.readFileSync(CACHE_SEAL, "utf8"))
    if (JSON.stringify(current) === JSON.stringify(seal)) {
      if (echo) console.log(`Offline npm cache is current (${dependencies.length} locked packages)`)
      return { ...seal, reused: true }
    }
  }

  fs.mkdirSync(OFFLINE_CACHE, { recursive: true })
  const registry = new URL(dependencies[0]?.resolved ?? "https://registry.npmjs.org/").origin
  if (echo) console.log(`Seeding ${dependencies.length} locked packages into ${OFFLINE_CACHE}`)
  let cursor = 0
  const failures = []
  const workers = Array.from({ length: Math.min(8, dependencies.length) }, async () => {
    while (cursor < dependencies.length) {
      const index = cursor++
      const dependency = dependencies[index]
      try {
        await runNpm(
          ["cache", "add", dependency.spec, "--cache", OFFLINE_CACHE, "--registry", registry],
          { env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" } }
        )
      } catch (error) {
        failures.push(`${dependency.spec}: ${error.message}`)
      }
      if (echo && (index + 1) % 50 === 0) {
        console.log(`  seeded ${index + 1}/${dependencies.length}`)
      }
    }
  })
  await Promise.all(workers)
  assert.deepEqual(failures, [], `Unable to seed the offline npm cache\n${failures.join("\n")}`)
  fs.writeFileSync(CACHE_SEAL, `${JSON.stringify(seal, null, 2)}\n`)
  return { ...seal, reused: false }
}

function offlineEnvironment(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    NODE_PATH: "",
    GITHUB_TOKEN: "",
    EXA_API_KEY: "",
    CONTEXT7_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    DSH_TELEMETRY_DISABLED: "1",
    npm_config_cache: OFFLINE_CACHE,
    npm_config_offline: "true",
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_fetch_retries: "0",
  }
}

async function installOffline(directory, home, packed) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"))
  writeCleanLock(directory, manifest, packed)
  const result = await runNpm(
    [
      "ci",
      "--offline",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--cache",
      OFFLINE_CACHE,
    ],
    {
      cwd: directory,
      env: offlineEnvironment(home),
    }
  )
  const lifecycle = `${result.stdout}\n${result.stderr}`.match(
    /^>[^\n]*(?:prepare|preinstall|postinstall)(?:\s|$)/gm
  )
  assert.equal(
    lifecycle,
    null,
    `User-side lifecycle scripts ran during install:\n${lifecycle?.join("\n")}`
  )
  return { prepareScriptsRun: 0, stdout: result.stdout, stderr: result.stderr }
}

function yamlString(value) {
  return JSON.stringify(value)
}

function configureDshProfile(profileDirectory, cleanRoot) {
  const packagePath = path.join(profileDirectory, "package.json")
  const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"))
  manifest.dsh = {
    profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] },
  }
  fs.writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)

  const fixtureDirectory = path.join(
    profileDirectory,
    "node_modules",
    "@omagents",
    "dsh-browser-fixture"
  )
  fs.mkdirSync(fixtureDirectory, { recursive: true })
  fs.writeFileSync(
    path.join(fixtureDirectory, "package.json"),
    `${JSON.stringify({ name: "@omagents/dsh-browser-fixture", version: "0.0.0", type: "module", main: "index.js" }, null, 2)}\n`
  )
  fs.writeFileSync(
    path.join(fixtureDirectory, "index.js"),
    `export const name = "omagents-browser-fixture"\n` +
      `export function apply(ctx) {\n` +
      `  ctx.provide("omagentsPython", { async ensureBaseEnvironment() { return { status: "browser-isolated" } } })\n` +
      `}\n`
  )
  const mcpFixture = path.join(cleanRoot, "local-mcp-server.mjs")
  fs.copyFileSync(
    path.join(ROOT, "packages", "dsh", "test", "fixtures", "stdio-mcp-server.mjs"),
    mcpFixture
  )

  const rows = [
    { id: "omagents-browser-fixture", name: "@omagents/dsh-browser-fixture" },
    ...MCP_NAMES.map((name) => ({
      id: `browser-local-mcp-${name}`,
      name: "@deepseek-ai/dsh-mcp-client",
      config: {
        transport: "stdio",
        serverName: name,
        command: process.execPath,
        args: [mcpFixture],
        failOnStartupError: true,
      },
    })),
    { id: "omagents", name: "@omagents/omagents-dsh" },
  ]
  const yaml = `- insert:\n${rows
    .map((row) => {
      const lines = [`  - id: ${yamlString(row.id)}`, `    name: ${yamlString(row.name)}`]
      if (row.config) {
        lines.push("    config:")
        for (const [key, value] of Object.entries(row.config)) {
          if (Array.isArray(value)) {
            lines.push(`      ${key}:`)
            for (const item of value) lines.push(`      - ${yamlString(item)}`)
          } else {
            lines.push(`      ${key}: ${yamlString(value)}`)
          }
        }
      }
      return lines.join("\n")
    })
    .join("\n")}`
  fs.writeFileSync(path.join(profileDirectory, "cordis.patch.yml"), `${yaml}\n`)
}

export async function prepareCleanRoom({ pack = false, echo = true } = {}) {
  if (pack || !fs.existsSync(PACK_MANIFEST)) await packAll({ echo })
  const packed = readPackManifest()
  const cache = await seedOfflineCache({ echo })
  const cleanRoot = temporaryRoot("omagents-clean-room-")
  const home = path.join(cleanRoot, "home")
  const hostProject = path.join(cleanRoot, "hosts")
  const dshHome = path.join(cleanRoot, "dsh-home")
  const profileDirectory = path.join(dshHome, "profiles", "web")
  fs.mkdirSync(home, { recursive: true })
  const artifacts = Object.fromEntries(packed.artifacts.map((artifact) => [artifact.id, artifact]))

  writePackage(hostProject, {
    "@omagents/core": tarballDependency(artifacts.core),
    "@omagents/omagents": tarballDependency(artifacts.opencode),
    "@omagents/omagents-codex": tarballDependency(artifacts.codex),
  })
  writePackage(profileDirectory, {
    "@omagents/core": tarballDependency(artifacts.core),
    "@omagents/omagents-dsh": tarballDependency(artifacts.dsh),
    "@deepseek-ai/dsh": DSH_VERSION,
    "@deepseek-ai/cordis-plugin-loader": "1.1.0",
    "@deepseek-ai/dsh-typert-loader": DSH_VERSION,
  })

  if (echo) console.log(`Installing Host tarballs offline in ${hostProject}`)
  const hostInstall = await installOffline(hostProject, home, packed)
  if (echo) console.log(`Installing DSH tarball and runtime offline in ${profileDirectory}`)
  const dshInstall = await installOffline(profileDirectory, home, packed)
  configureDshProfile(profileDirectory, cleanRoot)

  const installedRoots = Object.fromEntries(
    PACKAGE_WORKSPACES.map(({ id, name }) => {
      const parent = id === "dsh" ? profileDirectory : hostProject
      const packageDirectory = path.join(parent, "node_modules", ...name.split("/"))
      assert.ok(
        fs.existsSync(path.join(packageDirectory, "package.json")),
        `${name} was not installed`
      )
      const realPath = fs.realpathSync(packageDirectory)
      assert.ok(
        realPath.startsWith(`${fs.realpathSync(parent)}${path.sep}`),
        `${name} escaped its clean install`
      )
      assert.ok(!realPath.startsWith(`${ROOT}${path.sep}`), `${name} resolved to repository source`)
      return [id, packageDirectory]
    })
  )
  const clientArtifact = path.join(installedRoots.dsh, "dist", "client.js")
  assert.equal(
    fs.existsSync(clientArtifact),
    true,
    "the packed Client must be built before installation"
  )

  const summary = {
    schemaVersion: 1,
    reused: false,
    packSha256: hash(fs.readFileSync(PACK_MANIFEST)),
    sourceSha256: packed.sourceSha256,
    lockfileSha256: packed.lockfileSha256,
    cleanRoot,
    home,
    hostProject,
    dshHome,
    profileDirectory,
    installedRoots,
    clientArtifact,
    prepareScriptsRun: hostInstall.prepareScriptsRun + dshInstall.prepareScriptsRun,
    offlineCacheReused: cache.reused,
    packed,
  }
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true })
  fs.writeFileSync(CLEAN_ROOM_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`)
  return summary
}

export function readCleanRoom({ current = true } = {}) {
  const summary = JSON.parse(fs.readFileSync(CLEAN_ROOM_SUMMARY, "utf8"))
  for (const directory of [summary.cleanRoot, summary.hostProject, summary.profileDirectory]) {
    if (!fs.existsSync(directory)) throw new Error(`Clean-room directory is missing: ${directory}`)
  }
  if (current) {
    const packed = readPackManifest()
    const expected = hash(fs.readFileSync(PACK_MANIFEST))
    if (summary.packSha256 !== expected) throw new Error("The clean-room installation is stale")
    if (
      summary.sourceSha256 !== packed.sourceSha256 ||
      summary.sourceSha256 !== computeSourceFingerprint()
    ) {
      throw new Error("Package source or built artifacts changed since the clean-room install")
    }
    if (summary.lockfileSha256 !== packed.lockfileSha256) {
      throw new Error("The pack manifest's dependency lock is stale")
    }
    if (summary.lockfileSha256 !== computeLockfileFingerprint()) {
      throw new Error("package-lock.json changed since the clean-room install")
    }
  }
  return summary
}

export async function ensureCleanRoom(options = {}) {
  try {
    return { ...readCleanRoom(), reused: true }
  } catch {
    return prepareCleanRoom({ ...options, pack: true })
  }
}

export function assertInsideCleanRoom(summary, resolvedPath) {
  const real = fs.realpathSync(resolvedPath)
  const clean = fs.realpathSync(summary.cleanRoot)
  assert.ok(real.startsWith(`${clean}${path.sep}`), `${real} is outside ${clean}`)
  assert.ok(!real.startsWith(`${ROOT}${path.sep}`), `${real} resolves into repository source`)
  return real
}
