import { test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"
import { execSync } from "child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const SCRIPT = path.join(ROOT, "scripts", "sync-platform.sh")

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

test("sync script copies skills and replaces tool placeholders", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const skillPath = path.join(ROOT, `.${platform}-plugin`, "skills", "deep-research", "SKILL.md")
    assert.ok(
      fs.existsSync(skillPath),
      `.${platform}-plugin/skills/deep-research/SKILL.md should exist`
    )

    const content = fs.readFileSync(skillPath, "utf-8")
    assert.ok(
      !content.includes("{{tool:websearch}}"),
      `.${platform}-plugin deep-research skill should not contain unresolved tool placeholder`
    )

    const expectedTool = platform === "claude" ? "WebSearch" : "web_search"
    assert.ok(
      content.includes(expectedTool),
      `.${platform}-plugin deep-research skill should contain ${expectedTool}`
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

test("sync script replaces github_search_code and codegraph_explore placeholders", () => {
  const testSkillDir = path.join(ROOT, "skills", "zz-test-tool-mapping")
  fs.mkdirSync(testSkillDir, { recursive: true })
  fs.writeFileSync(
    path.join(testSkillDir, "SKILL.md"),
    "---\nname: zz-test-tool-mapping\ndescription: test tool mapping\n---\nUse {{tool:github_search_code}} and {{tool:codegraph_explore}} here.\n"
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
      return fs.statSync(full).isDirectory() && !name.startsWith("_") && !name.startsWith(".")
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
