import { test } from "node:test"
import assert from "node:assert"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const CLI = path.join(ROOT, "packages", "opencode", "bin", "install.js")

function makeTempDir(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

function runCli(args, { cwd, home }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
    },
  })
}

function assertSuccess(result) {
  assert.equal(
    result.status,
    0,
    `CLI failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error || "none"}`
  )
}

test("OpenCode CLI installs into a new project with no host argument", async (t) => {
  const tempProject = makeTempDir(t, "omagents-opencode-project-")
  const tempHome = makeTempDir(t, "omagents-opencode-home-")

  const result = runCli([], { cwd: tempProject, home: tempHome })
  assertSuccess(result)

  const configPath = path.join(tempProject, "opencode.json")
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
  assert.ok(config.plugin.includes("@omagents/omagents"))
  assert.equal(config.websearch, false, "built-in websearch must default to disabled")
  assert.match(result.stdout, /websearch/, "stdout must explain the websearch default")
  assert.equal(fs.existsSync(path.join(tempHome, ".config", "opencode", "opencode.json")), false)

  const secondRun = runCli([], { cwd: tempProject, home: tempHome })
  assertSuccess(secondRun)
  const unchanged = JSON.parse(fs.readFileSync(configPath, "utf8"))
  assert.deepEqual(unchanged.plugin, ["@omagents/omagents"])
  assert.equal(unchanged.websearch, false)
})

test("OpenCode CLI --keep-websearch skips the built-in websearch default", async (t) => {
  const tempProject = makeTempDir(t, "omagents-opencode-project-")
  const tempHome = makeTempDir(t, "omagents-opencode-home-")

  const result = runCli(["--keep-websearch"], { cwd: tempProject, home: tempHome })
  assertSuccess(result)

  const configPath = path.join(tempProject, "opencode.json")
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
  assert.ok(config.plugin.includes("@omagents/omagents"))
  assert.equal(
    Object.hasOwn(config, "websearch"),
    false,
    "--keep-websearch must not write a websearch key"
  )
})

test("OpenCode CLI preserves an explicit websearch setting", async (t) => {
  const tempProject = makeTempDir(t, "omagents-opencode-project-")
  const tempHome = makeTempDir(t, "omagents-opencode-home-")
  const configPath = path.join(tempProject, "opencode.json")
  const explicit = { websearch: { provider: "tinyfish" } }
  fs.writeFileSync(configPath, JSON.stringify(explicit, null, 2) + "\n", "utf8")

  const result = runCli([], { cwd: tempProject, home: tempHome })
  assertSuccess(result)

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
  assert.deepEqual(
    config.websearch,
    { provider: "tinyfish" },
    "explicit websearch value must survive installer writes"
  )
  assert.ok(config.plugin.includes("@omagents/omagents"))
})

test("OpenCode CLI applies the websearch default to an already-installed plugin", async (t) => {
  const tempProject = makeTempDir(t, "omagents-opencode-project-")
  const tempHome = makeTempDir(t, "omagents-opencode-home-")
  const configPath = path.join(tempProject, "opencode.json")
  fs.writeFileSync(
    configPath,
    JSON.stringify({ plugin: ["@omagents/omagents"] }, null, 2) + "\n",
    "utf8"
  )

  const result = runCli([], { cwd: tempProject, home: tempHome })
  assertSuccess(result)

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
  assert.deepEqual(config.plugin, ["@omagents/omagents"])
  assert.equal(config.websearch, false, "reinstall must upgrade existing configs")
})

test("OpenCode CLI leaves an already-configured websearch untouched without rewriting", async (t) => {
  const tempProject = makeTempDir(t, "omagents-opencode-project-")
  const tempHome = makeTempDir(t, "omagents-opencode-home-")
  const configPath = path.join(tempProject, "opencode.json")
  const explicit =
    JSON.stringify({ plugin: ["@omagents/omagents"], websearch: false }, null, 2) + "\n"
  fs.writeFileSync(configPath, explicit, "utf8")

  const result = runCli([], { cwd: tempProject, home: tempHome })
  assertSuccess(result)
  assert.equal(fs.readFileSync(configPath, "utf8"), explicit, "no rewrite when nothing changes")
  assert.match(result.stdout, /websearch setting left untouched/)
})

test("OpenCode CLI prints help without installing", (t) => {
  const tempProject = makeTempDir(t, "omagents-opencode-project-")
  const tempHome = makeTempDir(t, "omagents-opencode-home-")

  const result = runCli(["--help"], { cwd: tempProject, home: tempHome })
  assertSuccess(result)
  assert.match(result.stdout, /Usage: npx @omagents\/omagents(?:\s|$)/)
  assert.match(result.stdout, /--help/)
  assert.match(result.stdout, /--version/)
  assert.match(result.stdout, /--keep-websearch/)
  assert.doesNotMatch(result.stdout, /<codex\|opencode>/)
  assert.equal(fs.existsSync(path.join(tempProject, "opencode.json")), false)
})

test("OpenCode CLI prints its package version without installing", (t) => {
  const tempProject = makeTempDir(t, "omagents-opencode-project-")
  const tempHome = makeTempDir(t, "omagents-opencode-home-")

  const result = runCli(["--version"], { cwd: tempProject, home: tempHome })
  assertSuccess(result)
  assert.equal(result.stdout.trim(), "0.17.1")
  assert.equal(fs.existsSync(path.join(tempProject, "opencode.json")), false)
})

test("OpenCode CLI rejects positional hosts and unknown arguments", async (t) => {
  for (const args of [
    ["opencode"],
    ["codex"],
    ["--unknown"],
    ["--help", "unexpected"],
    ["--keep-websearch", "--keep-websearch"],
  ]) {
    const tempProject = makeTempDir(t, "omagents-opencode-project-")
    const tempHome = makeTempDir(t, "omagents-opencode-home-")
    const result = runCli(args, { cwd: tempProject, home: tempHome })

    assert.notEqual(result.status, 0, `${args.join(" ")} should be rejected`)
    assert.match(result.stderr, /Usage: npx @omagents\/omagents/)
    assert.equal(fs.existsSync(path.join(tempProject, "opencode.json")), false)
  }
})

test("OpenCode CLI has a Node shebang and executable mode", () => {
  const source = fs.readFileSync(CLI, "utf8")
  assert.ok(source.startsWith("#!/usr/bin/env node\n"))
  if (process.platform !== "win32") {
    assert.notEqual(fs.statSync(CLI).mode & 0o111, 0)
  }
})
