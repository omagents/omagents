import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { getCorePaths } from "../packages/core/src/paths.js"
import { getVenvPython } from "../packages/core/hooks/python-env.js"
import { withCorePackLock } from "./core-pack-lock.js"
import { runNpm } from "./npm-launcher.js"

const ROOT = path.resolve(import.meta.dirname, "..")
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
    runNpm(["pack", "--workspace", "@omagents/core", "--dry-run", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    })
  )

  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)
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

test("browser installation and packed probes have bounded process lifecycles", () => {
  const browser = fs.readFileSync(path.join(ROOT, "scripts", "test-browser.js"), "utf8")
  assert.match(browser, /OMAGENTS_BROWSER_INSTALL_TIMEOUT_MS/)
  assert.match(browser, /timeoutMs: installTimeoutMs/)

  const packed = fs.readFileSync(path.join(ROOT, "scripts", "test-packed-installs.js"), "utf8")
  assert.match(packed, /OMAGENTS_PACKED_PROBE_TIMEOUT_MS \?\? 120_000/)
  assert.match(packed, /timeout: 30_000/)
  assert.match(packed, /finally \{/)
  assert.match(packed, /server\?\.listening/)
  assert.match(packed, /Promise\.resolve\(entry\.fiber\.dispose\(\)\)/)
})

test("CI compiles Python directories without shell-specific wildcard expansion", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8")
  assert.match(workflow, /python -m compileall -q packages\/core\/skills\/deep-research\/scripts/)
  assert.match(workflow, /python -m compileall -q packages\/core\/skills\/_shared\/scripts/)
  assert.doesNotMatch(workflow, /python -m py_compile[^\n]*\*\.py/)
})

test("browser CI provisions and passes an isolated interpreter on every OS", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8")
  const browserJob = workflow.split("  browser:")[1]
  assert.ok(browserJob, "the browser job must exist")
  assert.match(browserJob, /actions\/setup-python@v6/)
  assert.match(browserJob, /python -m venv \.omagents\/ci-venv/)
  assert.match(browserJob, /python_bin: \.omagents\/ci-venv\/bin\/python/)
  assert.match(browserJob, /python_bin: \.omagents\/ci-venv\/Scripts\/python\.exe/)
  assert.match(
    browserJob,
    /OMAGENTS_TEST_PYTHON: \$\{\{ github\.workspace \}\}\/\$\{\{ matrix\.python_bin \}\}/
  )
  const browserSpec = fs.readFileSync(
    path.join(ROOT, "packages", "dsh", "test", "browser-job-board.spec.ts"),
    "utf8"
  )
  assert.doesNotMatch(browserSpec, /process\.env\.OMAGENTS_TEST_PYTHON \|\| "python3"/)
})

test("CI matrix Python key uses expression-safe underscore naming", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8")
  assert.doesNotMatch(workflow, /python-bin:/)
  assert.doesNotMatch(workflow, /matrix\.python-bin/)
  assert.match(workflow, /python_bin:/)
  assert.match(workflow, /matrix\.python_bin/)
})

test("CI matrix Python paths stay relative while test interpreters are absolute", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8")
  assert.doesNotMatch(workflow, /python_bin:\s*\$\{\{/)
  assert.match(workflow, /python_bin: \.omagents\/ci-venv\/bin\/python/)
  assert.match(workflow, /python_bin: \.omagents\/ci-venv\/Scripts\/python\.exe/)
  assert.match(workflow, /OMAGENTS_TEST_PYTHON: \$\{\{ github\.workspace \}\}/)
})

test("packed Python and CLI path rules remain Windows-safe", () => {
  const windowsVenv = "C:\\Users\\release\\.venvs\\omagents"
  assert.equal(
    getVenvPython(windowsVenv, "win32"),
    "C:\\Users\\release\\.venvs\\omagents\\Scripts\\python.exe"
  )
  assert.equal(getVenvPython("/opt/omagents", "linux"), path.join("/opt/omagents", "bin", "python"))
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

test("Windows checkouts preserve LF and platform-correct Unix Python expectations", () => {
  const attributesPath = path.join(ROOT, ".gitattributes")
  assert.equal(
    fs.existsSync(attributesPath),
    true,
    ".gitattributes must normalize checkout line endings"
  )
  const attributes = fs.readFileSync(attributesPath, "utf8")
  assert.match(attributes, /^\* text=auto eol=lf$/m)
  const probe = fs.readFileSync(path.join(ROOT, "scripts", "test-packed-installs.js"), "utf8")
  assert.match(probe, /path\.join\("\/opt\/release", "bin", "python"\)/)
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
