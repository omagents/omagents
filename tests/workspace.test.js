import { test } from "node:test"
import assert from "node:assert"
import { runNpm } from "./npm-launcher.js"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"))
}

test("root is private and exposes the OpenCode workspace package", () => {
  const root = readJson("package.json")
  const opencode = readJson("packages/opencode/package.json")

  assert.equal(root.private, true)
  assert.deepEqual(root.workspaces, ["packages/*"])
  assert.equal(root.name, "@omagents/omagents")
  assert.equal(opencode.name, "@omagents/omagents")
  assert.equal(opencode.version, "0.14.0")
  assert.equal(opencode.version, root.version)
})

test("OpenCode depends on Core and Core bundles pinned Superpowers assets", () => {
  const pkg = readJson("packages/opencode/package.json")
  const core = readJson("packages/core/package.json")

  assert.equal(pkg.type, "module")
  assert.equal(pkg.main, "src/index.js")
  assert.deepEqual(pkg.bin, { omagents: "bin/install.js" })
  assert.equal(pkg.dependencies["@omagents/core"], "0.14.0")
  assert.equal(pkg.dependencies.superpowers, undefined)
  assert.ok(core.dependencies.superpowers.includes("#8ca22dba9a94f28898bbce59f2537ff4d87c747d"))
  assert.ok(core.bundledDependencies.includes("superpowers"))
})

test("every workspace with tests is discovered exactly once, including Codex", () => {
  const root = readJson("package.json")
  assert.doesNotMatch(root.scripts.test, /packages\/codex\/test/)
  assert.doesNotMatch(root.scripts.test, /packages\/core\/test/)

  const workspaceDirectories = fs
    .readdirSync(path.join(ROOT, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  for (const directory of workspaceDirectories) {
    const testDirectory = path.join(ROOT, "packages", directory, "test")
    if (!fs.existsSync(testDirectory)) continue
    const pkg = readJson(`packages/${directory}/package.json`)
    assert.ok(
      pkg.scripts?.test,
      `${pkg.name} has test files but npm test --workspaces would skip them`
    )
  }

  const result = runNpm(["test", "--workspaces", "--if-present", "--dry-run"], {
    cwd: ROOT,
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const output = `${result.stdout}\n${result.stderr}`
  assert.equal(output.match(/@omagents\/omagents-codex/g)?.length, 1, output)
  assert.equal(output.match(/@omagents\/omagents-dsh/g)?.length, 1, output)
})

test("development entry only re-exports the packaged OpenCode implementation", () => {
  const developmentEntry = path.join(ROOT, ".opencode", "plugins", "index.js")
  const packageSource = path.join(ROOT, "packages", "opencode", "src")

  assert.equal(
    fs.readFileSync(developmentEntry, "utf8"),
    'export { default, OmagentsPlugin } from "../../packages/opencode/src/index.js"\n'
  )
  assert.ok(fs.existsSync(path.join(packageSource, "index.js")))
  assert.ok(fs.existsSync(path.join(packageSource, "parallel.js")))
  assert.deepEqual(
    fs.readdirSync(path.dirname(developmentEntry)).filter((file) => file.endsWith(".js")),
    ["index.js"],
    "the parallel engine must not be auto-discovered from the repository root"
  )
})
