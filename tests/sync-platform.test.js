import { test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"
import { execSync } from "child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const SCRIPT = path.join(ROOT, "scripts", "sync-platform.sh")
const MAPPING_FILE = path.join(ROOT, "scripts", "tool-mapping.txt")

function walkSync(dir) {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkSync(full))
    } else if (entry.isFile()) {
      results.push(full)
    }
  }
  return results
}

function parseToolMapping() {
  const mapping = []
  const content = fs.readFileSync(MAPPING_FILE, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const [opencode, codex] = trimmed.split("|")
    if (opencode && codex) {
      mapping.push({ opencode: opencode.trim(), codex: codex.trim() })
    }
  }
  return mapping
}

function findSessionStartCommand(hooks) {
  const sessionStart = hooks?.hooks?.SessionStart
  if (!Array.isArray(sessionStart)) return null
  for (const entry of sessionStart) {
    if (!Array.isArray(entry?.hooks)) continue
    for (const hook of entry.hooks) {
      if (hook?.command && hook.command.includes("setup-venv.sh")) {
        return hook.command
      }
    }
  }
  return null
}

function runSync() {
  execSync(`bash "${SCRIPT}"`, { cwd: ROOT, stdio: "ignore" })
}

test("sync script generates codex plugin directory", () => {
  runSync()

  const base = path.join(ROOT, ".codex-plugin")

  for (const dir of ["skills", "hooks"]) {
    assert.ok(fs.existsSync(path.join(base, dir)), `.codex-plugin/${dir} should exist`)
  }

  const pluginJsonPath = path.join(base, "plugin.json")
  assert.ok(fs.existsSync(pluginJsonPath), ".codex-plugin/plugin.json should exist")

  const plugin = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"))
  assert.strictEqual(plugin.name, "omagents")
  assert.ok(plugin.version)
  assert.ok(plugin.description)
  assert.deepStrictEqual(plugin.author, { name: "OmAgents" })
  assert.strictEqual(plugin.license, "MIT")
  assert.ok(plugin.interface, "plugin.json should have an interface block")
  assert.strictEqual(plugin.interface.displayName, "OmAgents")
  assert.strictEqual(plugin.interface.category, "Developer Tools")
  assert.deepStrictEqual(plugin.interface.capabilities, ["Read", "Write"])
})

test("source skill files contain no unresolved tool placeholders", () => {
  const skillsDir = path.join(ROOT, "skills")
  const skillDirs = fs.readdirSync(skillsDir).filter((name) => {
    const full = path.join(skillsDir, name)
    return fs.statSync(full).isDirectory()
  })

  for (const skillName of skillDirs) {
    const skillDir = path.join(skillsDir, skillName)
    for (const file of walkSync(skillDir)) {
      const content = fs.readFileSync(file, "utf-8")
      assert.ok(!content.includes("{{tool:"), `${file} contains unresolved tool placeholder`)
    }
  }
})

test("sync script applies reverse tool mapping to generated skills", () => {
  runSync()

  const skillPath = path.join(ROOT, ".codex-plugin", "skills", "deep-research", "SKILL.md")
  assert.ok(fs.existsSync(skillPath), ".codex-plugin/skills/deep-research/SKILL.md should exist")

  const content = fs.readFileSync(skillPath, "utf-8")
  assert.ok(content.includes("web_search"), "codex deep-research skill should contain web_search")
  assert.ok(
    !content.includes("websearch_web_search_exa"),
    "codex deep-research skill should not contain OpenCode websearch tool name"
  )
})

test("sync script supports SKILL.codex.md overrides", () => {
  const testSkillDir = path.join(ROOT, "skills", "zz-test-override")
  fs.mkdirSync(testSkillDir, { recursive: true })
  fs.writeFileSync(
    path.join(testSkillDir, "SKILL.md"),
    "---\nname: zz-test-override\ndescription: default\n---\n# Default\n"
  )
  fs.writeFileSync(
    path.join(testSkillDir, "SKILL.codex.md"),
    "---\nname: zz-test-override\ndescription: codex\n---\n# Codex Override\n"
  )

  try {
    runSync()

    const codexContent = fs.readFileSync(
      path.join(ROOT, ".codex-plugin", "skills", "zz-test-override", "SKILL.md"),
      "utf-8"
    )

    assert.ok(codexContent.includes("Codex Override"), "codex should use SKILL.codex.md override")
    assert.ok(!codexContent.includes("Default"), "codex override should replace default skill")
  } finally {
    fs.rmSync(testSkillDir, { recursive: true, force: true })
    const generatedSkillDir = path.join(ROOT, ".codex-plugin", "skills", "zz-test-override")
    if (fs.existsSync(generatedSkillDir)) {
      fs.rmSync(generatedSkillDir, { recursive: true, force: true })
    }
  }
})

test("sync script maps OpenCode tool names to Codex-specific names", () => {
  const testSkillDir = path.join(ROOT, "skills", "zz-test-tool-mapping")
  fs.mkdirSync(testSkillDir, { recursive: true })
  fs.writeFileSync(
    path.join(testSkillDir, "SKILL.md"),
    "---\nname: zz-test-tool-mapping\ndescription: test tool mapping\n---\nUse github_search_code and codegraph_codegraph_explore here.\n"
  )

  try {
    runSync()

    const content = fs.readFileSync(
      path.join(ROOT, ".codex-plugin", "skills", "zz-test-tool-mapping", "SKILL.md"),
      "utf-8"
    )
    assert.ok(
      content.includes("mcp__github__search_code"),
      "codex zz-test-tool-mapping should contain mcp__github__search_code"
    )
    assert.ok(
      content.includes("mcp__codegraph__explore"),
      "codex zz-test-tool-mapping should contain mcp__codegraph__explore"
    )
    assert.ok(
      !content.includes("github_search_code"),
      "codex zz-test-tool-mapping should not contain OpenCode github_search_code"
    )
    assert.ok(
      !content.includes("codegraph_codegraph_explore"),
      "codex zz-test-tool-mapping should not contain OpenCode codegraph_codegraph_explore"
    )
  } finally {
    fs.rmSync(testSkillDir, { recursive: true, force: true })
    const generatedSkillDir = path.join(ROOT, ".codex-plugin", "skills", "zz-test-tool-mapping")
    if (fs.existsSync(generatedSkillDir)) {
      fs.rmSync(generatedSkillDir, { recursive: true, force: true })
    }
  }
})

test("generated skills contain no unresolved tool placeholders", () => {
  runSync()

  const skillsDir = path.join(ROOT, ".codex-plugin", "skills")
  const skillDirs = fs.readdirSync(skillsDir).filter((name) => {
    const full = path.join(skillsDir, name)
    return fs.statSync(full).isDirectory()
  })

  for (const skillName of skillDirs) {
    const skillDir = path.join(skillsDir, skillName)
    for (const file of walkSync(skillDir)) {
      const content = fs.readFileSync(file, "utf-8")
      assert.ok(!content.includes("{{tool:"), `${file} contains unresolved tool placeholder`)
    }
  }
})

function getOpenCodeToolNames() {
  return parseToolMapping().map(({ opencode }) => opencode)
}

test("generated skills contain no mapped OpenCode tool names", () => {
  const mapping = parseToolMapping()
  assert.ok(mapping.length > 0, "tool-mapping.txt should contain mappings")

  runSync()

  const skillsDir = path.join(ROOT, ".codex-plugin", "skills")
  const skillDirs = fs.readdirSync(skillsDir).filter((name) => {
    const full = path.join(skillsDir, name)
    return fs.statSync(full).isDirectory()
  })

  for (const skillName of skillDirs) {
    if (skillName === "superpowers") continue
    const skillDir = path.join(skillsDir, skillName)
    for (const file of walkSync(skillDir)) {
      if (path.extname(file) !== ".md") continue
      const content = fs.readFileSync(file, "utf-8")
      for (const { opencode } of mapping) {
        const re = new RegExp("\\b" + opencode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b")
        assert.ok(!re.test(content), `${file} contains mapped OpenCode tool name ${opencode}`)
      }
    }
  }
})

test("generated Python files contain no OpenCode tool names", () => {
  const opencodeNames = getOpenCodeToolNames()
  assert.ok(opencodeNames.length > 0, "tool-mapping.txt should contain OpenCode tool names")

  runSync()

  const skillsDir = path.join(ROOT, ".codex-plugin", "skills")
  if (!fs.existsSync(skillsDir)) return

  const skillDirs = fs.readdirSync(skillsDir).filter((name) => {
    const full = path.join(skillsDir, name)
    return fs.statSync(full).isDirectory()
  })

  for (const skillName of skillDirs) {
    if (skillName === "superpowers") continue
    const skillDir = path.join(skillsDir, skillName)
    for (const file of walkSync(skillDir)) {
      if (path.extname(file) !== ".py") continue
      const content = fs.readFileSync(file, "utf-8")
      for (const opencode of opencodeNames) {
        const re = new RegExp("\\b" + opencode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b")
        assert.ok(!re.test(content), `${file} contains OpenCode tool name ${opencode}`)
      }
    }
  }
})

test("sync script copies skill subdirectories (scripts, templates, agents)", () => {
  runSync()

  const generatedSkillDir = path.join(ROOT, ".codex-plugin", "skills", "deep-research")

  for (const subdir of ["scripts", "templates", "agents"]) {
    const fullPath = path.join(generatedSkillDir, subdir)
    assert.ok(fs.existsSync(fullPath), `.codex-plugin/skills/deep-research/${subdir} should exist`)
    assert.ok(
      fs.readdirSync(fullPath).length > 0,
      `.codex-plugin/skills/deep-research/${subdir} should not be empty`
    )
  }
})

test("sync script copies skills/_shared", () => {
  runSync()

  const sharedDir = path.join(ROOT, ".codex-plugin", "skills", "_shared")
  assert.ok(fs.existsSync(sharedDir), ".codex-plugin/skills/_shared should exist")

  const scriptsDir = path.join(sharedDir, "scripts")
  assert.ok(fs.existsSync(scriptsDir), ".codex-plugin/skills/_shared/scripts should exist")
  assert.ok(
    fs.existsSync(path.join(scriptsDir, "loop_engine.py")),
    ".codex-plugin/skills/_shared/scripts/loop_engine.py should exist"
  )
})

test("sync script bundles superpowers skills into codex plugin", () => {
  runSync()

  const superpowersDir = path.join(ROOT, ".codex-plugin", "skills", "superpowers")
  assert.ok(fs.existsSync(superpowersDir), ".codex-plugin/skills/superpowers should exist")

  const brainstormingPath = path.join(superpowersDir, "brainstorming", "SKILL.md")
  assert.ok(
    fs.existsSync(brainstormingPath),
    ".codex-plugin/skills/superpowers/brainstorming/SKILL.md should exist"
  )

  const content = fs.readFileSync(brainstormingPath, "utf-8")
  assert.ok(content.length > 0, "codex superpowers brainstorming skill should not be empty")
})

test("node_modules/superpowers/skills exists and contains at least 14 skill directories", () => {
  const superpowersDir = path.join(ROOT, "node_modules", "superpowers", "skills")
  assert.ok(fs.existsSync(superpowersDir), "node_modules/superpowers/skills should exist")

  const dirs = fs.readdirSync(superpowersDir).filter((name) => {
    const full = path.join(superpowersDir, name)
    return fs.statSync(full).isDirectory() && !name.startsWith("_") && !name.startsWith(".")
  })

  assert.ok(
    dirs.length >= 14,
    `expected at least 14 superpowers skill directories, found ${dirs.length}`
  )
})

test("each bundled superpowers skill has YAML frontmatter", () => {
  runSync()

  const superpowersDir = path.join(ROOT, ".codex-plugin", "skills", "superpowers")
  const dirs = fs.readdirSync(superpowersDir).filter((name) => {
    return fs.statSync(path.join(superpowersDir, name)).isDirectory()
  })

  for (const skillName of dirs) {
    const skillMd = path.join(superpowersDir, skillName, "SKILL.md")
    assert.ok(fs.existsSync(skillMd), `superpowers skill ${skillName} should have SKILL.md`)

    const content = fs.readFileSync(skillMd, "utf-8")
    assert.ok(
      content.startsWith("---"),
      `superpowers skill ${skillName} SKILL.md should start with YAML frontmatter`
    )
  }
})

test("sync script generates .mcp.json for codex", () => {
  runSync()

  const mcpJsonPath = path.join(ROOT, ".codex-plugin", ".mcp.json")
  assert.ok(fs.existsSync(mcpJsonPath), ".codex-plugin/.mcp.json should exist")

  const mcp = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"))
  assert.ok(mcp && typeof mcp === "object", ".codex-plugin/.mcp.json should be valid JSON")

  for (const name of ["agentmemory", "codegraph", "context7", "websearch"]) {
    assert.ok(mcp[name], `.codex-plugin/.mcp.json should contain ${name}`)
  }

  assert.strictEqual(mcp.agentmemory.type, "local")
  assert.strictEqual(mcp.agentmemory.command, "npx")
  assert.ok(Array.isArray(mcp.agentmemory.args))

  assert.strictEqual(mcp.context7.type, "remote")
  assert.ok(mcp.context7.url)
})

test("sync script generates hooks referencing setup-venv.sh", () => {
  runSync()

  const hooksPath = path.join(ROOT, ".codex-plugin", "hooks", "hooks.json")
  assert.ok(fs.existsSync(hooksPath), ".codex-plugin/hooks/hooks.json should exist")

  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf-8"))
  assert.ok(
    hooks && typeof hooks === "object",
    ".codex-plugin/hooks/hooks.json should be valid JSON"
  )
  assert.ok(
    Array.isArray(hooks.hooks?.SessionStart),
    ".codex-plugin/hooks/hooks.json should contain SessionStart hooks"
  )

  const command = findSessionStartCommand(hooks)
  assert.ok(command, ".codex-plugin/hooks/hooks.json SessionStart should reference setup-venv.sh")

  const setupScriptPath = path.join(ROOT, ".codex-plugin", "hooks", "setup-venv.sh")
  assert.ok(fs.existsSync(setupScriptPath), ".codex-plugin/hooks/setup-venv.sh should exist")

  try {
    fs.accessSync(setupScriptPath, fs.constants.X_OK)
  } catch {
    assert.fail(".codex-plugin/hooks/setup-venv.sh should be executable")
  }
})

test("sync script generates valid Python files", () => {
  runSync()

  const skillsDir = path.join(ROOT, ".codex-plugin", "skills")
  if (!fs.existsSync(skillsDir)) return

  for (const file of walkSync(skillsDir)) {
    if (path.extname(file) === ".py") {
      execSync(`python3 -m py_compile "${file}"`, { cwd: ROOT, stdio: "ignore" })
    }
  }
})
