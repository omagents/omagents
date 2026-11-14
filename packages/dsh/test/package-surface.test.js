import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { evaluatePluginCompatibility } from "@deepseek-ai/dsh-app-boot"
import yaml from "js-yaml"

import { runNpm } from "./npm-launcher.js"

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageJsonPath = resolve(packageDir, "package.json")

async function readManifest() {
  return JSON.parse(await readFile(packageJsonPath, "utf8"))
}

test("package identity, built ESM entry, and exact Core dependency are aligned", async () => {
  const manifest = await readManifest()
  assert.equal(manifest.name, "@omagents/omagents-dsh")
  assert.equal(manifest.version, "0.13.1")
  assert.equal(manifest.type, "module")
  assert.equal(manifest.main, "./dist/host/index.js")
  assert.equal(manifest.exports["."].default, "./dist/host/index.js")
  assert.equal(manifest.exports["."].types, "./dist/host/index.d.ts")
  assert.equal(manifest.dependencies["@omagents/core"], "0.13.1")
  assert.equal(manifest.dependencies["@omagents/omagents"], undefined)
  assert.equal(manifest.dependencies["@omagents/omagents-codex"], undefined)
  assert.equal(manifest.exports["./client"].default, "./dist/client.js")
  assert.equal(manifest.exports["./client"].types, "./dist/client/index.d.ts")
  assert.equal(manifest.exports["./typert"].default, "./dist/host/typert.js")
  assert.equal(manifest.dsh.client.platform, "web")
})

test("Host module has only named plugin exports and no default or Client export", async () => {
  const host = await import("@omagents/omagents-dsh")
  assert.equal(Object.hasOwn(host, "default"), false)
  assert.equal(host.name, "omagents")
  assert.deepEqual(host.inject, ["loader"])
  assert.equal(typeof host.apply, "function")
  assert.equal(host.apply.constructor.name, "AsyncFunction")
  assert.equal(typeof host.createDshRuntime, "function")
  assert.equal(typeof host.registerDshSkills, "function")
  assert.equal(typeof host.registerDshMcp, "function")
  assert.equal(typeof host.provisionDshPython, "function")
  assert.equal(typeof host.registerDshTools, "function")
  assert.equal(typeof host.createSubagentTracker, "function")
  assert.equal(typeof host.registerDshCommands, "function")
  assert.equal(typeof host.registerDshContext, "function")
  assert.equal(typeof host.OmAgentsRemote, "function")
  assert.equal(typeof host.authorizeRemoteScope, "function")
  assert.equal(host.client, undefined)
})

test("bundle patch is a bare package-root row and DSH engine range is release-tested", async () => {
  const manifest = await readManifest()
  assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml")
  const patch = yaml.load(await readFile(resolve(packageDir, "cordis.patch.yml"), "utf8"))
  assert.deepEqual(patch, [{ id: "omagents", name: "@omagents/omagents-dsh" }])
  assert.equal(patch[0].name.includes("/dist/"), false)
  assert.equal(patch[0].name.endsWith("/host"), false)

  const dshManifestPath = fileURLToPath(import.meta.resolve("@deepseek-ai/dsh/package.json"))
  const dshManifest = JSON.parse(await readFile(dshManifestPath, "utf8"))
  assert.equal(dshManifest.version, "0.2.2-rc.1")
  assert.equal(evaluatePluginCompatibility(manifest, {}, dshManifest.version), undefined)
  for (const untested of ["0.2.1-rc.5", "0.2.3-alpha.1", "0.3.0-alpha.1"]) {
    const issue = evaluatePluginCompatibility(manifest, {}, untested)
    assert.ok(issue, `${untested} must not be claimed by engines.dsh`)
    assert.equal(issue.requirements["engines.dsh"], manifest.engines.dsh)
  }
})

test("publish dry-run contains built runtime artifacts but no source or test tooling", async () => {
  const { stdout } = await runNpm(["pack", "--dry-run", "--ignore-scripts", "--json"], {
    cwd: packageDir,
    env: { ...process.env, npm_config_ignore_scripts: "true" },
  })
  const [result] = JSON.parse(stdout)
  const paths = result.files.map((file) => file.path)

  for (const required of [
    "cordis.patch.yml",
    "dist/host/index.js",
    "dist/host/index.d.ts",
    "dist/host/runtime.js",
    "dist/host/health.js",
    "dist/host/register-skills.js",
    "dist/host/register-skills.d.ts",
    "dist/host/register-mcp.js",
    "dist/host/register-mcp.d.ts",
    "dist/host/register-python.js",
    "dist/host/register-python.d.ts",
    "dist/host/register-tools.js",
    "dist/host/register-tools.d.ts",
    "dist/host/subagent-tracker.js",
    "dist/host/subagent-tracker.d.ts",
    "dist/host/subagent-queries.js",
    "dist/host/subagent-queries.d.ts",
    "dist/host/register-commands.js",
    "dist/host/register-commands.d.ts",
    "dist/host/register-context.js",
    "dist/host/register-context.d.ts",
    "dist/host/remote-service.js",
    "dist/host/remote-service.d.ts",
    "dist/host/remote-access.js",
    "dist/host/remote-access.d.ts",
    "dist/host/remote-types.js",
    "dist/host/remote-types.d.ts",
    "dist/host/typert.js",
    "dist/host/typert.d.ts",
    "dist/host/prompt.js",
    "dist/host/prompt.d.ts",
    "dist/client.js",
    "dist/client.js.map",
    "dist/client/index.d.ts",
    "dist/client/remote-store.d.ts",
    "dist/client/components/JobBoardPage.d.ts",
    "dist/client/components/JobTable.d.ts",
    "dist/client/components/JobDetails.d.ts",
    "dist/client/components/CancelDialog.d.ts",
    "dist/client/components/StatusBadge.d.ts",
    "package.json",
  ]) {
    assert.ok(paths.includes(required), `${required} must be published`)
  }
  for (const path of paths) {
    assert.ok(
      path === "package.json" ||
        path === "README.md" ||
        path === "cordis.patch.yml" ||
        path.startsWith("dist/"),
      `unexpected publish path: ${path}`
    )
    assert.doesNotMatch(path, /(^|\/)(src|test|tests)(\/|$)|tsconfig|tsdown|\.tsbuildinfo/)
  }
})
