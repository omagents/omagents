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

function assertDshResourceCommands(content, skillName) {
  assert.ok(
    !content.includes(`${CORE_PATHS.root}${path.sep}${CORE_PATHS.root}`),
    `${skillName} duplicated an absolute Core resource path`
  )
  const scriptCommands = {
    "loop_engine.py": ["init", "next", "complete", "fail", "status", "summary", "reset", "add"],
    "deep_research.py": [
      "plan",
      "add-items",
      "add-fields",
      "run-all",
      "validate",
      "gaps",
      "merge",
      "report",
      "polish",
      "audit",
      "package",
      "provenance",
      "status",
      "<subcommand>",
    ],
    "pre_research.py": ["init", "next", "complete", "evaluate", "finalize"],
  }
  for (const [script, commands] of Object.entries(scriptCommands)) {
    const pattern = new RegExp(`\\b${script.replace(".", "\\.")}\\s+(${commands.join("|")})`, "g")
    for (const match of content.matchAll(pattern)) {
      assert.ok(
        match.index > 0 && /[\\/]/.test(content[match.index - 1]),
        `${skillName} has a bare script invocation: ${match[0]}`
      )
    }
  }
  assert.doesNotMatch(
    content,
    /\b(?:bash|node|python|python3)\s+(?:\.\/)?scripts\//,
    `${skillName} resolves a bundled script through cwd instead of its absolute resourceBase`
  )
  assert.doesNotMatch(
    content,
    /\bpython3?\s+-m\s+py_compile\s+packages\/core\//,
    `${skillName} assumes a source-checkout relative Core path`
  )
  assert.doesNotMatch(content, /(?:^|\n)\s*markitdown\s+/, `${skillName} uses bare markitdown`)
  assert.doesNotMatch(content, /\|\s*markitdown\s+/, `${skillName} pipes into bare markitdown`)
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
  const shared = renderSkillForHost(definition, "opencode-v1")
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

test("DSH discovers all 33 skills and renders every skill without wrong-host control flow", () => {
  const definitions = listSkillDefinitions({ host: "dsh" })
  assert.equal(definitions.length, 33)
  assert.equal(definitions.filter((skill) => skill.source === "omagents").length, 18)
  assert.equal(definitions.filter((skill) => skill.source === "superpowers").length, 15)

  for (const definition of definitions) {
    const rendered = renderSkillForHost(definition, "dsh")
    assert.ok(rendered.body.trim(), `${definition.name} must have DSH instructions`)
    assert.doesNotMatch(
      rendered.content,
      /\btask\s*\(\s*background|background\s*[:=]\s*true|OPENCODE_/,
      `${definition.name} leaked OpenCode orchestration into DSH`
    )
    assert.doesNotMatch(
      rendered.content,
      /websearch_web_search_exa|websearch_web_fetch_exa|\bwebfetch\b|codegraph_codegraph_explore|\bgithub_[a-z_]+/,
      `${definition.name} leaked OpenCode tool names into DSH`
    )
    assertDshResourceCommands(rendered.content, definition.name)
  }
})

test("material DSH workflows use full overrides and native tool mappings", () => {
  const definitions = listSkillDefinitions({ host: "dsh" })
  for (const name of ["parallel-execution", "deep-research", "hyperplan", "doctor", "lsp-guide"]) {
    const definition = definitions.find((skill) => skill.name === name)
    assert.ok(definition, `missing ${name}`)
    assert.equal(
      renderSkillForHost(definition, "dsh").path,
      path.join(definition.directory, "SKILL.dsh.md"),
      `${name} must use a full DSH override`
    )
  }

  const byName = Object.fromEntries(definitions.map((definition) => [definition.name, definition]))
  const research = renderSkillForHost(byName["deep-research"], "dsh").content
  assert.match(research, /`subagent`/)
  assert.match(research, /dispatch_subagent/)
  assert.match(research, /web_search/)
  assert.match(research, /web_fetch/)
  assert.match(research, /mcp__codegraph__codegraph_explore/)
  assert.match(research, /mcp__github__search_code/)
  assert.ok(
    research.includes(path.join(byName["deep-research"].directory, "scripts", "deep_research.py")),
    "DSH research must render the absolute packaged CLI path"
  )

  const hyperplan = renderSkillForHost(byName.hyperplan, "dsh").content
  assert.equal(
    (hyperplan.match(/description:\s*["'](?:Security|Architecture|Edge cases) critic/g) || [])
      .length,
    3
  )
  assert.match(hyperplan, /cancel_task/)
  assert.match(hyperplan, /loop_engine\.py/)

  const doctor = renderSkillForHost(byName.doctor, "dsh").content
  assert.match(doctor, /@omagents\/omagents-dsh/)
  assert.match(doctor, /33/)
  assert.match(doctor, /native `subagent`|native DSH `subagent`/)
  assert.ok(
    doctor.includes(
      path.join(CORE_PATHS.root, "skills", "deep-research", "scripts", "deep_research.py")
    ),
    "doctor must diagnose the deep-research package, not its own scripts directory"
  )
  assert.ok(!doctor.includes(path.join(byName.doctor.directory, "scripts", "deep_research.py")))

  const lsp = renderSkillForHost(byName["lsp-guide"], "dsh").content
  assert.match(lsp, /mcp__codegraph__codegraph_explore/)
  assert.doesNotMatch(lsp, /opencode\.json|EXPERIMENTAL_LSP/)

  const office = renderSkillForHost(byName.officecli, "dsh").content
  assert.match(office, /`skill` once/)
  assert.ok(office.includes("`officecli load_skill <name>`"))
  assert.ok(office.includes("`officecli load_skill pitch-deck`"))
  assert.doesNotMatch(office, /officecli\s+skill(?:\s|$)/)
})

test("OpenCode and Codex keep their own native subagent rendering", () => {
  const definitions = listSkillDefinitions({ host: "opencode-v2" })
  const research = definitions.find((skill) => skill.name === "deep-research")
  const hyperplan = definitions.find((skill) => skill.name === "hyperplan")

  const v1Research = renderSkillForHost(research, "opencode-v1").content
  assert.match(v1Research, /task\(background:\s*true\)/)
  const v2Research = renderSkillForHost(research, "opencode-v2").content
  assert.match(v2Research, /subagent\([^)]*background:\s*true/)
  assert.doesNotMatch(v2Research, /\btask\s*\(/)
  const codexResearch = renderSkillForHost(research, "codex").content
  assert.match(codexResearch, /spawn_agent/)
  assert.doesNotMatch(codexResearch, /\btask\s*\(|background\s*[:=]\s*true/)

  const v2Hyperplan = renderSkillForHost(hyperplan, "opencode-v2").content
  assert.match(v2Hyperplan, /subagent\(background\s*=\s*true/)
  assert.doesNotMatch(v2Hyperplan, /\btask\s*\(/)
  const codexHyperplan = renderSkillForHost(hyperplan, "codex").content
  assert.match(codexHyperplan, /spawn_agent/)
  assert.doesNotMatch(codexHyperplan, /\btask\s*\(|background\s*[:=]\s*true/)
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
