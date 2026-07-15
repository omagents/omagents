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
    const [opencode, claude, codex] = trimmed.split("|")
    if (opencode && claude && codex) {
      mapping.push({ opencode: opencode.trim(), claude: claude.trim(), codex: codex.trim() })
    }
  }
  return mapping
}

test("sync script copies wrapper scripts to claude bin directory", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })

  const binDir = path.join(ROOT, ".claude-plugin", "bin")
  assert.ok(fs.existsSync(binDir), ".claude-plugin/bin should exist")

  const expectedWrappers = ["loop_engine", "deep_research", "markitdown"]
  for (const wrapper of expectedWrappers) {
    const wrapperPath = path.join(binDir, wrapper)
    assert.ok(fs.existsSync(wrapperPath), `.claude-plugin/bin/${wrapper} should exist`)

    try {
      fs.accessSync(wrapperPath, fs.constants.X_OK)
    } catch {
      assert.fail(`.claude-plugin/bin/${wrapper} should be executable`)
    }

    const content = fs.readFileSync(wrapperPath, "utf-8")
    assert.ok(
      content.includes(".venvs/omagents/bin/python"),
      `.claude-plugin/bin/${wrapper} should reference the omagents venv Python`
    )
  }

  for (const wrapper of expectedWrappers) {
    assert.ok(
      !fs.existsSync(path.join(ROOT, ".codex-plugin", "bin", wrapper)),
      `.codex-plugin/bin/${wrapper} should not be copied for Codex`
    )
  }
})

test("sync script generates claude and codex directories", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const base = path.join(ROOT, `.${platform}-plugin`)

    for (const dir of ["skills", "hooks", "bin"]) {
      assert.ok(fs.existsSync(path.join(base, dir)), `.${platform}-plugin/${dir} should exist`)
    }

    const pluginJsonPath = path.join(base, "plugin.json")
    assert.ok(fs.existsSync(pluginJsonPath), `.${platform}-plugin/plugin.json should exist`)

    const plugin = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"))
    assert.ok(
      plugin && typeof plugin === "object",
      `.${platform}-plugin/plugin.json should be valid JSON`
    )

    assert.strictEqual(
      plugin.name,
      "omagents",
      `.${platform}-plugin/plugin.json name should be omagents`
    )
    assert.ok(plugin.version, `.${platform}-plugin/plugin.json should have a version`)
    assert.ok(plugin.description, `.${platform}-plugin/plugin.json should have a description`)
    assert.deepStrictEqual(
      plugin.author,
      { name: "OmAgents" },
      `.${platform}-plugin/plugin.json author should be OmAgents`
    )
    assert.strictEqual(
      plugin.license,
      "MIT",
      `.${platform}-plugin/plugin.json license should be MIT`
    )

    if (platform === "codex") {
      assert.ok(plugin.interface, `.${platform}-plugin/plugin.json should have an interface block`)
      assert.strictEqual(
        plugin.interface.displayName,
        "OmAgents",
        `.${platform}-plugin/plugin.json interface.displayName should be OmAgents`
      )
      assert.strictEqual(
        plugin.interface.category,
        "Developer Tools",
        `.${platform}-plugin/plugin.json interface.category should be Developer Tools`
      )
      assert.deepStrictEqual(
        plugin.interface.capabilities,
        ["Read", "Write"],
        `.${platform}-plugin/plugin.json interface.capabilities should be Read, Write`
      )
    }
  }
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
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const skillPath = path.join(ROOT, `.${platform}-plugin`, "skills", "deep-research", "SKILL.md")
    assert.ok(
      fs.existsSync(skillPath),
      `.${platform}-plugin/skills/deep-research/SKILL.md should exist`
    )

    const content = fs.readFileSync(skillPath, "utf-8")
    const expectedTool = platform === "claude" ? "WebSearch" : "web_search"
    assert.ok(
      content.includes(expectedTool),
      `.${platform}-plugin deep-research skill should contain ${expectedTool}`
    )
    assert.ok(
      !content.includes("websearch_web_search_exa"),
      `.${platform}-plugin deep-research skill should not contain OpenCode websearch tool name`
    )
  }
})

test("sync script supports SKILL.claude.md and SKILL.codex.md overrides", () => {
  const testSkillDir = path.join(ROOT, "skills", "zz-test-override")
  fs.mkdirSync(testSkillDir, { recursive: true })
  fs.writeFileSync(
    path.join(testSkillDir, "SKILL.md"),
    "---\nname: zz-test-override\ndescription: default\n---\n# Default\n"
  )
  fs.writeFileSync(
    path.join(testSkillDir, "SKILL.claude.md"),
    "---\nname: zz-test-override\ndescription: claude\n---\n# Claude Override\n"
  )
  fs.writeFileSync(
    path.join(testSkillDir, "SKILL.codex.md"),
    "---\nname: zz-test-override\ndescription: codex\n---\n# Codex Override\n"
  )

  try {
    execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
    execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

    const claudeContent = fs.readFileSync(
      path.join(ROOT, ".claude-plugin", "skills", "zz-test-override", "SKILL.md"),
      "utf-8"
    )
    const codexContent = fs.readFileSync(
      path.join(ROOT, ".codex-plugin", "skills", "zz-test-override", "SKILL.md"),
      "utf-8"
    )

    assert.ok(
      claudeContent.includes("Claude Override"),
      "claude should use SKILL.claude.md override"
    )
    assert.ok(!claudeContent.includes("Default"), "claude override should replace default skill")
    assert.ok(codexContent.includes("Codex Override"), "codex should use SKILL.codex.md override")
    assert.ok(!codexContent.includes("Default"), "codex override should replace default skill")
  } finally {
    fs.rmSync(testSkillDir, { recursive: true, force: true })
    for (const platform of ["claude", "codex"]) {
      const generatedSkillDir = path.join(ROOT, `.${platform}-plugin`, "skills", "zz-test-override")
      if (fs.existsSync(generatedSkillDir)) {
        fs.rmSync(generatedSkillDir, { recursive: true, force: true })
      }
    }
  }
})

test("sync script maps OpenCode tool names to platform-specific names", () => {
  const testSkillDir = path.join(ROOT, "skills", "zz-test-tool-mapping")
  fs.mkdirSync(testSkillDir, { recursive: true })
  fs.writeFileSync(
    path.join(testSkillDir, "SKILL.md"),
    "---\nname: zz-test-tool-mapping\ndescription: test tool mapping\n---\nUse github_search_code and codegraph_codegraph_explore here.\nAlso read, write, edit and bash.\n"
  )

  try {
    execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
    execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

    for (const platform of ["claude", "codex"]) {
      const content = fs.readFileSync(
        path.join(ROOT, `.${platform}-plugin`, "skills", "zz-test-tool-mapping", "SKILL.md"),
        "utf-8"
      )
      assert.ok(
        content.includes("mcp__github__search_code"),
        `.${platform}-plugin zz-test-tool-mapping should contain mcp__github__search_code`
      )
      assert.ok(
        content.includes("mcp__codegraph__explore"),
        `.${platform}-plugin zz-test-tool-mapping should contain mcp__codegraph__explore`
      )
      assert.ok(
        !content.includes("{{tool:"),
        `.${platform}-plugin zz-test-tool-mapping should not contain unresolved tool placeholders`
      )
      assert.ok(
        !content.includes("github_search_code"),
        `.${platform}-plugin zz-test-tool-mapping should not contain OpenCode github_search_code`
      )
      assert.ok(
        !content.includes("codegraph_codegraph_explore"),
        `.${platform}-plugin zz-test-tool-mapping should not contain OpenCode codegraph_codegraph_explore`
      )

      const expectedRead = platform === "claude" ? "Read" : "Read"
      const expectedWrite = platform === "claude" ? "Write" : "Write"
      const expectedEdit = platform === "claude" ? "Edit" : "Edit"
      const expectedBash = platform === "claude" ? "Bash" : "Bash"
      assert.ok(
        content.includes(expectedRead),
        `.${platform}-plugin should map read to ${expectedRead}`
      )
      assert.ok(
        content.includes(expectedWrite),
        `.${platform}-plugin should map write to ${expectedWrite}`
      )
      assert.ok(
        content.includes(expectedEdit),
        `.${platform}-plugin should map edit to ${expectedEdit}`
      )
      assert.ok(
        content.includes(expectedBash),
        `.${platform}-plugin should map bash to ${expectedBash}`
      )
    }
  } finally {
    fs.rmSync(testSkillDir, { recursive: true, force: true })
    for (const platform of ["claude", "codex"]) {
      const generatedSkillDir = path.join(
        ROOT,
        `.${platform}-plugin`,
        "skills",
        "zz-test-tool-mapping"
      )
      if (fs.existsSync(generatedSkillDir)) {
        fs.rmSync(generatedSkillDir, { recursive: true, force: true })
      }
    }
  }
})

test("generated skills contain no unresolved tool placeholders", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const skillsDir = path.join(ROOT, `.${platform}-plugin`, "skills")
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
  }
})

test("generated skills contain no mapped OpenCode tool names", () => {
  const mapping = parseToolMapping()
  assert.ok(mapping.length > 0, "tool-mapping.txt should contain mappings")

  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const skillsDir = path.join(ROOT, `.${platform}-plugin`, "skills")
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
  }
})

test("sync script copies skill subdirectories (scripts, templates, agents)", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const generatedSkillDir = path.join(ROOT, `.${platform}-plugin`, "skills", "deep-research")

    for (const subdir of ["scripts", "templates", "agents"]) {
      const fullPath = path.join(generatedSkillDir, subdir)
      assert.ok(
        fs.existsSync(fullPath),
        `.${platform}-plugin/skills/deep-research/${subdir} should exist`
      )
      assert.ok(
        fs.readdirSync(fullPath).length > 0,
        `.${platform}-plugin/skills/deep-research/${subdir} should not be empty`
      )
    }
  }
})

test("sync script copies skills/_shared", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const sharedDir = path.join(ROOT, `.${platform}-plugin`, "skills", "_shared")
    assert.ok(fs.existsSync(sharedDir), `.${platform}-plugin/skills/_shared should exist`)

    const scriptsDir = path.join(sharedDir, "scripts")
    assert.ok(fs.existsSync(scriptsDir), `.${platform}-plugin/skills/_shared/scripts should exist`)
    assert.ok(
      fs.existsSync(path.join(scriptsDir, "loop_engine.py")),
      `.${platform}-plugin/skills/_shared/scripts/loop_engine.py should exist`
    )
  }
})

test("sync script bundles superpowers skills into generated plugins", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const superpowersDir = path.join(ROOT, `.${platform}-plugin`, "skills", "superpowers")
    assert.ok(fs.existsSync(superpowersDir), `.${platform}-plugin/skills/superpowers should exist`)

    const brainstormingPath = path.join(superpowersDir, "brainstorming", "SKILL.md")
    assert.ok(
      fs.existsSync(brainstormingPath),
      `.${platform}-plugin/skills/superpowers/brainstorming/SKILL.md should exist`
    )

    const content = fs.readFileSync(brainstormingPath, "utf-8")
    assert.ok(
      content.length > 0,
      `.${platform}-plugin superpowers brainstorming skill should not be empty`
    )
  }
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

test("sync script bundles the same superpowers skills for claude and codex", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  const getSkills = (platform) => {
    const dir = path.join(ROOT, `.${platform}-plugin`, "skills", "superpowers")
    return fs
      .readdirSync(dir)
      .filter((name) => fs.statSync(path.join(dir, name)).isDirectory())
      .sort()
  }

  assert.deepStrictEqual(
    getSkills("claude"),
    getSkills("codex"),
    "claude and codex should bundle the same superpowers skills"
  )
})

test("each bundled superpowers skill has YAML frontmatter", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const superpowersDir = path.join(ROOT, `.${platform}-plugin`, "skills", "superpowers")
    const dirs = fs.readdirSync(superpowersDir).filter((name) => {
      return fs.statSync(path.join(superpowersDir, name)).isDirectory()
    })

    for (const skillName of dirs) {
      const skillMd = path.join(superpowersDir, skillName, "SKILL.md")
      assert.ok(
        fs.existsSync(skillMd),
        `${platform} superpowers skill ${skillName} should have SKILL.md`
      )

      const content = fs.readFileSync(skillMd, "utf-8")
      assert.ok(
        content.startsWith("---"),
        `${platform} superpowers skill ${skillName} SKILL.md should start with YAML frontmatter`
      )
    }
  }
})

test("sync script generates .mcp.json for claude and codex", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const mcpJsonPath = path.join(ROOT, `.${platform}-plugin`, ".mcp.json")
    assert.ok(fs.existsSync(mcpJsonPath), `.${platform}-plugin/.mcp.json should exist`)

    const mcp = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"))
    assert.ok(mcp && typeof mcp === "object", `.${platform}-plugin/.mcp.json should be valid JSON`)

    for (const name of ["agentmemory", "codegraph", "context7", "websearch"]) {
      assert.ok(mcp[name], `.${platform}-plugin/.mcp.json should contain ${name}`)
    }

    assert.strictEqual(
      mcp.agentmemory.type,
      "local",
      `.${platform}-plugin/.mcp.json agentmemory should be local`
    )
    assert.strictEqual(
      mcp.agentmemory.command,
      "npx",
      `.${platform}-plugin/.mcp.json agentmemory command should be npx`
    )
    assert.ok(
      Array.isArray(mcp.agentmemory.args),
      `.${platform}-plugin/.mcp.json agentmemory args should be an array`
    )

    assert.strictEqual(
      mcp.context7.type,
      "remote",
      `.${platform}-plugin/.mcp.json context7 should be remote`
    )
    assert.ok(mcp.context7.url, `.${platform}-plugin/.mcp.json context7 should have a url`)
  }
})

test("sync script generates hooks referencing setup-venv.sh", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const hooksPath = path.join(ROOT, `.${platform}-plugin`, "hooks", "hooks.json")
    assert.ok(fs.existsSync(hooksPath), `.${platform}-plugin/hooks/hooks.json should exist`)

    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf-8"))
    assert.ok(
      hooks && typeof hooks === "object",
      `.${platform}-plugin/hooks/hooks.json should be valid JSON`
    )
    assert.ok(
      Array.isArray(hooks.hooks?.SessionStart),
      `.${platform}-plugin/hooks/hooks.json should contain SessionStart hooks`
    )

    const command = hooks.hooks.SessionStart[0]?.hooks?.[0]?.command
    assert.ok(
      command && command.includes("setup-venv.sh"),
      `.${platform}-plugin/hooks/hooks.json SessionStart should reference setup-venv.sh`
    )

    const setupScriptPath = path.join(ROOT, `.${platform}-plugin`, "hooks", "setup-venv.sh")
    assert.ok(
      fs.existsSync(setupScriptPath),
      `.${platform}-plugin/hooks/setup-venv.sh should exist`
    )

    try {
      fs.accessSync(setupScriptPath, fs.constants.X_OK)
    } catch {
      assert.fail(`.${platform}-plugin/hooks/setup-venv.sh should be executable`)
    }
  }
})

test("integration checklist pre-conditions are satisfied", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const pluginJsonPath = path.join(ROOT, `.${platform}-plugin`, "plugin.json")
    const mcpJsonPath = path.join(ROOT, `.${platform}-plugin`, ".mcp.json")
    const hooksJsonPath = path.join(ROOT, `.${platform}-plugin`, "hooks", "hooks.json")

    const plugin = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"))
    assert.ok(
      plugin && typeof plugin === "object",
      `.${platform}-plugin/plugin.json should be valid JSON`
    )
    assert.strictEqual(
      plugin.name,
      "omagents",
      `.${platform}-plugin/plugin.json name should be omagents`
    )

    const mcp = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"))
    assert.ok(mcp && typeof mcp === "object", `.${platform}-plugin/.mcp.json should be valid JSON`)
    for (const name of ["agentmemory", "codegraph", "context7", "websearch"]) {
      assert.ok(mcp[name], `.${platform}-plugin/.mcp.json should contain ${name}`)
    }

    const hooks = JSON.parse(fs.readFileSync(hooksJsonPath, "utf-8"))
    assert.ok(
      hooks && typeof hooks === "object",
      `.${platform}-plugin/hooks/hooks.json should be valid JSON`
    )
    assert.ok(
      Array.isArray(hooks.hooks?.SessionStart),
      `.${platform}-plugin/hooks/hooks.json should contain SessionStart hooks`
    )

    const command = hooks.hooks.SessionStart[0]?.hooks?.[0]?.command
    assert.ok(
      command && command.includes("setup-venv.sh"),
      `.${platform}-plugin/hooks/hooks.json SessionStart should reference setup-venv.sh`
    )
  }
})

test("sync script generates valid Python files", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const skillsDir = path.join(ROOT, `.${platform}-plugin`, "skills")
    if (!fs.existsSync(skillsDir)) continue

    for (const file of walkSync(skillsDir)) {
      if (path.extname(file) === ".py") {
        execSync(`python3 -m py_compile "${file}"`, { cwd: ROOT, stdio: "ignore" })
      }
    }
  }
})
