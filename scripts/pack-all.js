import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)))
export const ARTIFACT_ROOT = path.join(ROOT, ".omagents", "release-artifacts")
export const TARBALL_DIRECTORY = path.join(ARTIFACT_ROOT, "tarballs")
export const PACK_MANIFEST = path.join(ARTIFACT_ROOT, "pack-manifest.json")

export const PACKAGE_WORKSPACES = Object.freeze([
  { id: "core", name: "@omagents/core" },
  { id: "opencode", name: "@omagents/omagents" },
  { id: "codex", name: "@omagents/omagents-codex" },
  { id: "dsh", name: "@omagents/omagents-dsh" },
])

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const processTree = options.timeoutMs > 0
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: processTree && process.platform !== "win32",
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let timeout
    let forceKill
    const terminate = (signal) => {
      try {
        if (process.platform === "win32") {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          })
          killer.on("error", () => child.kill(signal))
        } else {
          process.kill(-child.pid, signal)
        }
      } catch (error) {
        if (error.code !== "ESRCH") child.kill(signal)
      }
    }
    if (processTree) {
      timeout = setTimeout(() => {
        timedOut = true
        terminate("SIGTERM")
        forceKill = setTimeout(() => terminate("SIGKILL"), 3_000)
      }, options.timeoutMs)
    }
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      if (options.echo) process.stdout.write(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
      if (options.echo) process.stderr.write(chunk)
    })
    child.on("error", (error) => {
      clearTimeout(timeout)
      clearTimeout(forceKill)
      reject(error)
    })
    child.on("close", (code, signal) => {
      clearTimeout(timeout)
      clearTimeout(forceKill)
      const result = { code: code ?? 1, signal, stdout, stderr, timedOut }
      if (code === 0 && !signal && !timedOut) resolve(result)
      else {
        reject(
          new Error(
            `${command} ${args.join(" ")} ${timedOut ? `timed out after ${options.timeoutMs}ms` : `failed (${signal ?? code})`}\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        )
      }
    })
  })
}

export function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args], options)
  }
  return run(process.platform === "win32" ? "npm.cmd" : "npm", args, options)
}

function digestFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

export async function packAll({ echo = true } = {}) {
  fs.mkdirSync(TARBALL_DIRECTORY, { recursive: true })
  for (const entry of fs.readdirSync(TARBALL_DIRECTORY)) {
    if (entry.endsWith(".tgz")) fs.rmSync(path.join(TARBALL_DIRECTORY, entry), { force: true })
  }

  const packages = PACKAGE_WORKSPACES.map((workspace) => {
    const manifestPath = path.join(ROOT, "packages", workspace.id, "package.json")
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    return { ...workspace, manifestPath, manifest }
  })
  const versions = [...new Set(packages.map(({ manifest }) => manifest.version))]
  if (versions.length !== 1) {
    throw new Error(
      `All workspace packages must be version-aligned; received ${versions.join(", ")}`
    )
  }

  const artifacts = []
  for (const workspace of packages) {
    if (echo) console.log(`Packing ${workspace.name}@${workspace.manifest.version}`)
    const { stdout } = await runNpm([
      "pack",
      "--workspace",
      workspace.name,
      "--pack-destination",
      TARBALL_DIRECTORY,
      "--json",
    ])
    const jsonOffset = stdout.search(/^\[$/m)
    if (jsonOffset < 0)
      throw new Error(`npm pack returned no JSON for ${workspace.name}:\n${stdout}`)
    const [artifact] = JSON.parse(stdout.slice(jsonOffset))
    if (!artifact) throw new Error(`npm pack returned no artifact for ${workspace.name}`)
    const tarball = path.join(TARBALL_DIRECTORY, path.basename(artifact.filename))
    if (!fs.existsSync(tarball)) throw new Error(`Packed tarball is missing: ${tarball}`)
    artifacts.push({
      id: workspace.id,
      name: workspace.name,
      version: workspace.manifest.version,
      filename: path.basename(tarball),
      tarball,
      sha256: digestFile(tarball),
      integrity: artifact.integrity,
      files: artifact.files.map((file) => file.path),
      bundled: artifact.bundled ?? [],
    })
  }

  const manifest = {
    schemaVersion: 1,
    version: versions[0],
    createdAt: new Date().toISOString(),
    artifacts,
  }
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true })
  fs.writeFileSync(PACK_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  if (echo) {
    for (const artifact of artifacts)
      console.log(`  ${artifact.filename} (${artifact.files.length} files)`)
    console.log(`Pack manifest: ${PACK_MANIFEST}`)
  }
  return manifest
}

export function readPackManifest() {
  const manifest = JSON.parse(fs.readFileSync(PACK_MANIFEST, "utf8"))
  if (manifest.artifacts?.length !== 4) {
    throw new Error(`Expected four packed artifacts in ${PACK_MANIFEST}`)
  }
  for (const artifact of manifest.artifacts) {
    if (!fs.existsSync(artifact.tarball))
      throw new Error(`Missing packed tarball: ${artifact.tarball}`)
    if (digestFile(artifact.tarball) !== artifact.sha256) {
      throw new Error(`Packed tarball checksum changed: ${artifact.tarball}`)
    }
  }
  return manifest
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packAll()
}
