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
const SEARCH_PROXY_MODULES = [
  "backends.mjs",
  "errors.mjs",
  "index.mjs",
  "remote-client.mjs",
  "router.mjs",
  "stdio-server.mjs",
]
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

test("Core npm pack includes all six self-contained search proxy modules", () => {
  const result = withCorePackLock(() =>
    runNpm(["pack", "--workspace", "@omagents/core", "--dry-run", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    })
  )

  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)
  const [artifact] = JSON.parse(result.stdout)
  const packedPaths = new Set(artifact.files.map((file) => file.path))
  for (const name of SEARCH_PROXY_MODULES) {
    const relativePath = `mcp-servers/search-proxy/${name}`
    assert.ok(packedPaths.has(relativePath), `Core tarball must contain ${relativePath}`)
  }
})

test("clean-room environments scrub all search credentials and live smoke covers fallback", () => {
  const packed = fs.readFileSync(path.join(ROOT, "scripts", "test-packed-installs.js"), "utf8")
  const harness = fs.readFileSync(path.join(ROOT, "scripts", "packed-harness.js"), "utf8")
  const browser = fs.readFileSync(
    path.join(ROOT, "packages", "dsh", "test", "browser-job-board.spec.ts"),
    "utf8"
  )
  const live = fs.readFileSync(
    path.join(ROOT, "packages", "core", "test", "search-proxy-live.test.js"),
    "utf8"
  )

  function objectAfter(source, marker, fromIndex = 0) {
    const markerIndex = source.indexOf(marker, fromIndex)
    assert.notEqual(markerIndex, -1, `missing source marker: ${marker}`)
    const open = source.indexOf("{", markerIndex + marker.length)
    assert.notEqual(open, -1, `missing object after source marker: ${marker}`)
    let depth = 0
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1
      if (source[index] === "}") {
        depth -= 1
        if (depth === 0) return source.slice(open, index + 1)
      }
    }
    assert.fail(`unclosed object after source marker: ${marker}`)
  }

  const missingCredentials = []
  function assertEnvironment(block, label) {
    for (const key of ["EXA_API_KEY", "KEENABLE_API_KEY", "YDC_API_KEY"]) {
      if (!new RegExp(`\\b${key}:\\s*""`).test(block)) {
        missingCredentials.push(`${label}: ${key}`)
      }
    }
  }

  const handshake = objectAfter(packed, "function assertSearchProxyHandshake(entry)")
  assertEnvironment(objectAfter(handshake, "env:"), "packed Proxy handshake")
  const cli = objectAfter(packed, "function runCli(packageName, relativeCli, cwd)")
  assertEnvironment(objectAfter(cli, "env:"), "packed CLI")
  const probe = objectAfter(packed, "async function runProbe(name, source, cwd)")
  assertEnvironment(objectAfter(probe, "env:"), "outer packed probe")
  const offline = objectAfter(harness, "function offlineEnvironment(home)")
  assertEnvironment(objectAfter(offline, "return"), "offlineEnvironment()")
  const host = objectAfter(browser, "async function startHost(summary, port)")
  assertEnvironment(objectAfter(host, "values:"), "browser Host launch")
  const outerBrowserStart = browser.indexOf("const previousEnv = new Map()")
  assert.notEqual(outerBrowserStart, -1, "missing outer browser environment scope")
  assertEnvironment(
    objectAfter(browser, "const env =", outerBrowserStart),
    "outer browser environment"
  )
  const anonymous = objectAfter(live, "function anonymousEnvironment()")
  assertEnvironment(objectAfter(anonymous, "return"), "anonymous live environment")
  assert.deepEqual(
    missingCredentials,
    [],
    "every applicable environment block must explicitly clear all three search credentials"
  )

  assert.match(live, /forced Exa and Keenable transport failures reach anonymous live You\.com/)
  assert.match(live, /config\.provider === "exa" \|\| config\.provider === "keenable"/)
  assert.match(
    live,
    /assert\.deepEqual\(\s*metadata\.fallbacks,\s*\[\s*\{ from: "exa", code: "transport" \},\s*\{ from: "keenable", code: "transport" \},?\s*\],?\s*\)/
  )
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
  assert.match(packed, /OMAGENTS_PACKED_TEST_TIMEOUT_MS \?\? 1_800_000/)
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
