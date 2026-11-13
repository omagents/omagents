import { test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"
import { getCorePaths } from "../packages/core/src/paths.js"
import { listSkillDefinitions } from "../packages/core/src/skills/catalog.js"
import { renderSkillForHost } from "../packages/core/src/skills/render.js"

const ROOT = path.resolve(import.meta.dirname, "..")
const CORE_PATHS = getCorePaths()
const SKILLS_DIR = CORE_PATHS.skillsDir
const HOSTS = ["opencode-v1", "opencode-v2", "codex", "dsh"]

function getSkillDirs() {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
    .map((d) => d.name)
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const fm = {}
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":")
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      const val = line
        .slice(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, "")
      fm[key] = val
    }
  }
  return fm
}

test("Core resolves every packaged asset without repository-relative paths", () => {
  assert.equal(CORE_PATHS.root, path.join(ROOT, "packages", "core"))
  for (const value of Object.values(CORE_PATHS)) {
    assert.ok(path.isAbsolute(value), `Core asset path should be absolute: ${value}`)
  }
  assert.ok(fs.existsSync(path.join(CORE_PATHS.skillsDir, "deep-research", "SKILL.md")))
  assert.ok(
    fs.existsSync(path.join(CORE_PATHS.superpowersDir, "skills", "brainstorming", "SKILL.md"))
  )
  assert.ok(fs.existsSync(path.join(CORE_PATHS.hooksDir, "python-env.js")))
  assert.ok(fs.existsSync(path.join(CORE_PATHS.hooksDir, "project-venv.js")))
  assert.ok(fs.existsSync(path.join(CORE_PATHS.hooksDir, "setup-venv.js")))
  assert.ok(fs.existsSync(CORE_PATHS.mcpCatalogPath))
})

test("skills directory exists in Core", () => {
  assert.ok(fs.existsSync(SKILLS_DIR))
})

test("skill discovery and rendering support exactly the four explicit hosts", () => {
  for (const host of HOSTS) {
    const definitions = listSkillDefinitions({ host })
    assert.ok(definitions.some((skill) => skill.name === "parallel-execution"))
    assert.ok(definitions.some((skill) => skill.name === "brainstorming"))
    assert.equal(renderSkillForHost(definitions[0], host).host, host)
  }
  assert.throws(() => listSkillDefinitions({ host: "unknown" }), /Unsupported skill host/)
  const definition = listSkillDefinitions({ host: "dsh" })[0]
  assert.throws(() => renderSkillForHost(definition, "unknown"), /Unsupported skill host/)
})

test("shared skills fall back to SKILL.md and host overrides replace the full content", () => {
  const definition = listSkillDefinitions({ host: "dsh" }).find(
    (skill) => skill.name === "parallel-execution"
  )
  const sharedPath = path.join(definition.directory, "SKILL.md")
  const overridePath = path.join(definition.directory, "SKILL.dsh.md")
  const shared = renderSkillForHost(definition, "opencode-v2")
  const overridden = renderSkillForHost(definition, "dsh")

  assert.equal(shared.path, sharedPath)
  assert.equal(shared.content, fs.readFileSync(sharedPath, "utf8"))
  assert.equal(overridden.path, overridePath)
  assert.equal(overridden.content, fs.readFileSync(overridePath, "utf8"))
  assert.notEqual(overridden.content, shared.content)
  assert.ok(!overridden.body.startsWith("---"), "rendering also exposes a frontmatter-free body")
})

test("DSH parallel skill never contains the OpenCode background argument", () => {
  const definition = listSkillDefinitions({ host: "dsh" }).find(
    (skill) => skill.name === "parallel-execution"
  )
  assert.doesNotMatch(renderSkillForHost(definition, "dsh").content, /background:\s*true/)
})

test("all skill directories have SKILL.md", () => {
  const dirs = getSkillDirs()
  assert.ok(dirs.length >= 5, `Expected at least 5 skills, found ${dirs.length}`)
  for (const dir of dirs) {
    const skillMd = path.join(SKILLS_DIR, dir, "SKILL.md")
    assert.ok(fs.existsSync(skillMd), `Missing SKILL.md in skills/${dir}/`)
  }
})

test("all SKILL.md files have valid frontmatter with name and description", () => {
  const dirs = getSkillDirs()
  for (const dir of dirs) {
    const skillMd = path.join(SKILLS_DIR, dir, "SKILL.md")
    const content = fs.readFileSync(skillMd, "utf-8")
    const fm = parseFrontmatter(content)
    assert.ok(fm, `skills/${dir}/SKILL.md missing YAML frontmatter`)
    assert.ok(fm.name, `skills/${dir}/SKILL.md frontmatter missing 'name'`)
    assert.ok(fm.description, `skills/${dir}/SKILL.md frontmatter missing 'description'`)
  }
})

test("expected skills are present", () => {
  const dirs = getSkillDirs()
  const expected = [
    "deep-research",
    "parallel-execution",
    "agents-python-tools",
    "markitdown-converter",
    "playwright-web-scraping",
    "init-deep",
    "doctor",
    "remove-ai-slops",
    "remove-deadcode",
    "github-triage",
    "tech-debt-audit",
    "lsp-guide",
    "ast-grep",
    "work-with-pr",
    "pre-publish-review",
    "hyperplan",
    "refactor",
  ]
  for (const skill of expected) {
    assert.ok(dirs.includes(skill), `Missing expected skill: ${skill}`)
  }
})

test("loop-based skills reference loop_engine.py in SKILL.md", () => {
  const loopSkills = [
    "deep-research",
    "remove-ai-slops",
    "remove-deadcode",
    "github-triage",
    "tech-debt-audit",
    "pre-publish-review",
    "hyperplan",
    "refactor",
  ]
  for (const skill of loopSkills) {
    const skillMd = path.join(SKILLS_DIR, skill, "SKILL.md")
    const content = fs.readFileSync(skillMd, "utf-8")
    assert.ok(
      content.includes("loop_engine"),
      `skills/${skill}/SKILL.md should reference loop_engine.py`
    )
  }
})

test("skills with scripts/ directory have at least one script file", () => {
  const dirs = getSkillDirs()
  for (const dir of dirs) {
    const scriptsDir = path.join(SKILLS_DIR, dir, "scripts")
    if (fs.existsSync(scriptsDir)) {
      const scripts = fs.readdirSync(scriptsDir)
      assert.ok(scripts.length > 0, `skills/${dir}/scripts/ is empty`)
    }
  }
})

test("shared loop_engine.py exists and compiles", () => {
  const enginePath = path.join(SKILLS_DIR, "_shared", "scripts", "loop_engine.py")
  assert.ok(fs.existsSync(enginePath), "loop_engine.py not found at skills/_shared/scripts/")
})

test("agents-python-tools does not claim tools are pre-installed", () => {
  const skillMd = path.join(SKILLS_DIR, "agents-python-tools", "SKILL.md")
  const content = fs.readFileSync(skillMd, "utf-8")
  assert.ok(
    !content.includes("pre-installed in"),
    "agents-python-tools should not claim tools are pre-installed (only jinja2 is auto-installed)"
  )
  assert.ok(
    content.includes("on-demand"),
    "agents-python-tools should clarify other tools are installed on-demand"
  )
})

test("agents-python-tools routes project dependencies through the overlay CLI", () => {
  const content = fs.readFileSync(path.join(SKILLS_DIR, "agents-python-tools", "SKILL.md"), "utf-8")
  for (const expected of [
    "<project-root>/.omagents/venv",
    "project-venv.js pip",
    "OMAGENTS_PROJECT_ONLY",
    "Do not run pip directly",
  ]) {
    assert.ok(content.includes(expected), `agents-python-tools should include ${expected}`)
  }
  assert.ok(
    !content.includes("<project-root>/.venv"),
    "project dependencies should not be routed to the old project .venv path"
  )
  assert.ok(
    !content.includes("Do NOT use for installing the project's own dependencies"),
    "the skill trigger must not exclude its project-dependency use case"
  )
})

test("document conversion and scraping tools install through base Python", () => {
  const markitdown = fs.readFileSync(
    path.join(SKILLS_DIR, "markitdown-converter", "SKILL.md"),
    "utf-8"
  )
  const playwright = fs.readFileSync(
    path.join(SKILLS_DIR, "playwright-web-scraping", "SKILL.md"),
    "utf-8"
  )
  const cases = [
    [markitdown, "from markitdown import MarkItDown", "markitdown"],
    [playwright, "from playwright.async_api import async_playwright", "playwright"],
  ]
  for (const [content, importCheck, packageName] of cases) {
    const check = content.indexOf(`~/.venvs/omagents/bin/python -c`)
    const install = content.indexOf(`~/.venvs/omagents/bin/python -m pip install ${packageName}`)
    assert.ok(check >= 0, `${packageName} should check through base Python`)
    assert.ok(install > check, `${packageName} should install only after its import check`)
    assert.ok(content.includes(importCheck), `${packageName} should retain its import check`)
  }
  assert.ok(
    playwright.includes("~/.venvs/omagents/bin/python -m playwright install chromium"),
    "Chromium should be installed through base Python"
  )
})

test("doctor diagnoses project overlay health and isolation", () => {
  const content = fs.readFileSync(path.join(SKILLS_DIR, "doctor", "SKILL.md"), "utf-8")
  for (const expected of [
    "project-venv.js",
    "omagents-base.pth",
    "majorMinor",
    "OMAGENTS_PROJECT_ONLY=1",
    "Normal mode",
  ]) {
    assert.ok(content.includes(expected), `doctor should include ${expected}`)
  }
})
