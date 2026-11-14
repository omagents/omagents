import { test } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const READMES = ["README.md", "README.zh-cn.md", "README.ja.md", "README.ko.md"]
const PACKAGE_MANIFESTS = [
  "packages/core/package.json",
  "packages/opencode/package.json",
  "packages/codex/package.json",
  "packages/dsh/package.json",
]
const HOST_MANIFESTS = PACKAGE_MANIFESTS.slice(1)
const PACKAGE_NAMES = [
  "@omagents/core",
  "@omagents/omagents",
  "@omagents/omagents-codex",
  "@omagents/omagents-dsh",
]
const INSTALL_COMMANDS = [
  "npx @omagents/omagents",
  "npx @omagents/omagents-codex",
  "dsh plugin --profile web add @omagents/omagents-dsh",
]
const RELEASE_ORDER = PACKAGE_NAMES.join(" → ")
const DSH_WORKSPACE_TEST =
  "npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh"

function read(relativePath) {
  const filePath = path.join(ROOT, relativePath)
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath))
}

test("every README language has exactly the approved host installation surface", () => {
  for (const file of READMES) {
    const text = read(file)
    for (const command of INSTALL_COMMANDS) {
      assert.ok(text.includes(command), `${file} must contain: ${command}`)
    }
    assert.doesNotMatch(text, /npx\s+@omagents\/omagents\s+codex\b/, file)
    assert.doesNotMatch(text, /npx\s+@omagents\/omagents\s+opencode\b/, file)
    assert.ok(text.includes("@omagents/core"), `${file} must identify the shared Core package`)
    assert.ok(text.includes("0.13.1"), `${file} must identify the aligned release candidate`)
  }
})

test("every README language has a complete host and shared-Core support matrix", () => {
  for (const file of READMES) {
    const text = read(file)
    for (const packageName of PACKAGE_NAMES) {
      assert.ok(text.includes(packageName), `${file} omits ${packageName}`)
    }
    for (const required of [
      "OpenCode 1.x",
      "OpenCode 2.x",
      "Codex",
      "DeepSeek Harness",
      "33",
      "18",
      "15",
      "parallel_status",
      "cancel_task",
      "/ps",
      "Remote",
      "React",
      "job-board.json",
    ]) {
      assert.ok(text.includes(required), `${file} support matrix omits ${required}`)
    }
  }
})

test("release guidance keeps four versions aligned and publishes Core before sequential hosts", () => {
  assert.deepEqual(
    PACKAGE_MANIFESTS.map((file) => readJson(file).version),
    ["0.13.1", "0.13.1", "0.13.1", "0.13.1"]
  )
  for (const file of HOST_MANIFESTS) {
    const pkg = readJson(file)
    assert.equal(pkg.dependencies["@omagents/core"], "0.13.1", file)
    for (const otherHost of PACKAGE_NAMES.slice(1)) {
      assert.equal(
        pkg.dependencies[otherHost],
        undefined,
        `${file} must not depend on ${otherHost}`
      )
    }
  }
  for (const file of ["AGENTS.md", "CONTRIBUTING.md", ...READMES]) {
    assert.ok(read(file).includes(RELEASE_ORDER), `${file} omits the deterministic release order`)
  }
  for (const file of ["AGENTS.md", "CONTRIBUTING.md"]) {
    assert.match(
      read(file),
      /build, test, pack, and publish all four/i,
      `${file} must require build, test, pack, and publish for every aligned release`
    )
  }
})

test("workspace guidance uses package paths and current verification commands", () => {
  for (const file of ["AGENTS.md", "CONTRIBUTING.md"]) {
    const text = read(file)
    assert.ok(text.includes("packages/opencode/src/parallel.js"), file)
    assert.doesNotMatch(text, /\.opencode\/plugins\/parallel\.js/, file)
    assert.ok(text.includes("npm test --workspaces --if-present"), file)
    assert.ok(text.includes(DSH_WORKSPACE_TEST), file)
    assert.ok(text.includes("npm run typecheck --workspace @omagents/omagents-dsh"), file)
    assert.ok(text.includes("npm run pack:all"), file)
    assert.ok(text.includes("npm run test:packed"), file)
    assert.ok(text.includes("npm run test:browser"), file)
    assert.ok(text.includes("packages/core/hooks/project-venv.js"), file)
  }
})

test("documentation keeps templates scoped and optional Python tools on demand", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "templates")), false)
  for (const file of ["AGENTS.md", "CONTRIBUTING.md", "packages/core/AGENTS.md", ...READMES]) {
    const text = read(file)
    assert.doesNotMatch(text, /^[├└]── templates\//m, file)
    assert.ok(text.includes("packages/core/skills/deep-research/templates/"), file)
    assert.ok(text.includes("jinja2"), file)
    assert.doesNotMatch(
      text,
      /(?:markitdown|playwright|officecli)[^\n.]*\b(?:are|is)\s+pre-?installed\b/i,
      file
    )
    assert.doesNotMatch(text, /optional Python (?:tools|packages)[^\n.]*\bpre-?installed\b/i, file)
  }
  for (const file of [
    "packages/core/AGENTS.md",
    "packages/dsh/AGENTS.md",
    "packages/dsh/README.md",
  ]) {
    assert.ok(read(file).includes("agents-python-tools"), `${file} must reference the Python skill`)
  }
})

test("DSH documentation covers installation, native UI, cancellation, recovery, security, and troubleshooting", () => {
  const readme = read("packages/dsh/README.md")
  const jobBoard = read("packages/dsh/docs/job-board.md")
  for (const heading of [
    "## Installation",
    "## Native Web Job Board",
    "## Cancellation",
    "## Recovery",
    "## Authorization and Security",
    "## Troubleshooting",
  ]) {
    assert.ok(readme.includes(heading), `DSH README omits ${heading}`)
  }
  for (const heading of [
    "## UI",
    "## Cancellation",
    "## Recovery",
    "## Authorization and Security",
    "## Troubleshooting",
  ]) {
    assert.ok(jobBoard.includes(heading), `Job Board guide omits ${heading}`)
  }
  const combined = `${readme}\n${jobBoard}`
  for (const required of [
    "dsh plugin --profile web add @omagents/omagents-dsh",
    "33 skills",
    "current turn",
    "descendants continue",
    "External one-shot",
    "cannot resume",
    "Viewing details never acknowledges",
    "whole-set",
    "baseline",
    "remote-access/denied",
    "active DSH profile",
    "job-board.json",
    "interrupted",
    "parallel_status",
    "cancel_task",
    "/ps",
  ]) {
    assert.ok(combined.includes(required), `DSH documentation omits ${required}`)
  }
})

test("changelog has an Unreleased multi-host and full-DSH entry without a new version", () => {
  const changelog = read("CHANGELOG.md")
  const unreleased = changelog.split("## [0.13.1]")[0]
  assert.match(unreleased, /^## \[Unreleased\]$/m)
  assert.doesNotMatch(unreleased, /^## \[Unreleased\]\s+-\s+\d{4}-/m)
  for (const required of [
    "@omagents/core",
    "@omagents/omagents-codex",
    "@omagents/omagents-dsh",
    "Job Board",
    "33",
    "npm workspaces",
  ]) {
    assert.ok(unreleased.includes(required), `Unreleased changelog omits ${required}`)
  }
})

test("scoped package guides and approved multi-host design artifacts are present", () => {
  for (const file of [
    "packages/core/AGENTS.md",
    "packages/opencode/AGENTS.md",
    "packages/codex/AGENTS.md",
    "packages/dsh/AGENTS.md",
    "docs/superpowers/specs/2026-11-13-multi-host-packages-dsh-design.md",
    "docs/superpowers/plans/2026-11-13-multi-host-packages-dsh.md",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} must be included`)
    assert.ok(read(file).length > 0, `${file} must not be empty`)
  }
  assert.ok(read("packages/opencode/AGENTS.md").includes("npx @omagents/omagents"))
  assert.ok(read("packages/codex/AGENTS.md").includes("npx @omagents/omagents-codex"))
  assert.ok(read("packages/dsh/AGENTS.md").includes(DSH_WORKSPACE_TEST))
})

test("verification notes do not overclaim unconfirmed platforms or browser runs", () => {
  for (const file of ["CONTRIBUTING.md", "packages/dsh/README.md", "packages/dsh/AGENTS.md"]) {
    const text = read(file)
    assert.ok(text.includes("macOS arm64"), file)
    assert.ok(text.includes("chromium_headless_shell-1228"), file)
    assert.ok(text.includes("first CI confirmation"), file)
    assert.doesNotMatch(
      text,
      /Linux[^\n]*Windows[^\n]*(?:all\s+)?(?:tests|checks)\s+(?:pass|passed)/i,
      file
    )
  }
})
