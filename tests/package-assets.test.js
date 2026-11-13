import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { getCorePaths } from "../packages/core/src/paths.js"
import { getVenvPython } from "../packages/core/hooks/python-env.js"
import { withCorePackLock } from "./core-pack-lock.js"

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
  const result = withCorePackLock(() =>
    spawnSync(NPM, ["pack", "--workspace", "@omagents/core", "--dry-run", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    })
  )

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

test("release verification exposes aligned pack, clean-room, and browser automation", () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
  assert.equal(rootPackage.scripts["pack:all"], "node scripts/pack-all.js")
  assert.equal(rootPackage.scripts["test:packed"], "node --test scripts/test-packed-installs.js")
  assert.equal(rootPackage.scripts["test:browser"], "node scripts/test-browser.js")

  const packages = ["core", "opencode", "codex", "dsh"].map((directory) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, "packages", directory, "package.json"), "utf8"))
  )
  assert.deepEqual([...new Set(packages.map((pkg) => pkg.version))], [rootPackage.version])
  for (const pkg of packages) {
    assert.equal(pkg.scripts?.prepare, undefined, `${pkg.name} must not require user-side prepare`)
    assert.equal(pkg.scripts?.postinstall, undefined, `${pkg.name} must not require postinstall`)
  }
})

test("standalone browser preparation is bounded separately and precedes the browser watchdog", () => {
  const launcher = fs.readFileSync(path.join(ROOT, "scripts", "test-browser.js"), "utf8")
  const preparation = fs.readFileSync(
    path.join(ROOT, "scripts", "prepare-browser-clean-room.js"),
    "utf8"
  )
  const prepareIndex = launcher.indexOf(
    'path.join(ROOT, "scripts", "prepare-browser-clean-room.js")'
  )
  const browserIndex = launcher.indexOf(
    'path.join(ROOT, "packages", "dsh", "test", "browser-job-board.spec.ts")'
  )
  assert.ok(prepareIndex > 0, "the bounded preparation child must exist")
  assert.ok(browserIndex > prepareIndex, "package preparation must precede the browser test")
  assert.match(launcher, /OMAGENTS_BROWSER_PREPARE_TIMEOUT_MS \?\? 900_000/)
  assert.match(launcher, /timeoutMs: preparationTimeoutMs/)
  assert.match(launcher, /OMAGENTS_BROWSER_TEST_TIMEOUT_MS \?\? 120_000/)
  assert.match(launcher, /timeoutMs: browserTimeoutMs/)
  assert.match(preparation, /ensureCleanRoom\(\)/, "valid packed-first installs must be reused")
  assert.match(preparation, /reused: summary\.reused === true/)
})

test("packed Python and CLI path rules remain Windows-safe", () => {
  const windowsVenv = "C:\\Users\\release\\.venvs\\omagents"
  assert.equal(
    getVenvPython(windowsVenv, "win32"),
    "C:\\Users\\release\\.venvs\\omagents\\Scripts\\python.exe"
  )
  assert.equal(getVenvPython("/opt/omagents", "linux"), "/opt/omagents/bin/python")
  for (const directory of ["opencode", "codex"]) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "packages", directory, "package.json"), "utf8")
    )
    for (const cli of Object.values(pkg.bin ?? {})) {
      const source = fs.readFileSync(path.join(ROOT, "packages", directory, cli), "utf8")
      assert.ok(source.startsWith("#!/usr/bin/env node\n"), `${cli} needs a portable Node launcher`)
      assert.doesNotMatch(
        source,
        /(?:^|[^\w])(?:bash|sh)\s+-c/,
        `${cli} must not require a Unix shell`
      )
    }
  }
})

test("DSH skill overrides never add an OpenCode background launch argument", () => {
  const overrideRoot = path.join(CORE_PATHS.skillsDir)
  const stack = [overrideRoot]
  const overrides = []
  while (stack.length > 0) {
    const directory = stack.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) stack.push(entryPath)
      else if (entry.name.endsWith(".dsh.md")) overrides.push(entryPath)
    }
  }
  assert.ok(overrides.length >= 5)
  for (const override of overrides) {
    const source = fs.readFileSync(override, "utf8")
    assert.doesNotMatch(source, /subagent\([^\n)]*\bbackground\s*:/i, override)
    assert.doesNotMatch(source, /OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS/, override)
  }
})
