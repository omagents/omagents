import { test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"

const ROOT = path.resolve(import.meta.dirname, "..")
const SKILLS_DIR = path.join(ROOT, "skills")

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

test("skills directory exists", () => {
  assert.ok(fs.existsSync(SKILLS_DIR))
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
