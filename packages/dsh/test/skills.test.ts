import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

import { Context } from "@deepseek-ai/cordis"
import SkillRegistry from "@deepseek-ai/dsh-skill"
import { listSkillDefinitions, renderSkillForHost } from "@omagents/core"

import { createHealthRecords } from "../dist/host/health.js"
import { registerDshSkills } from "../dist/host/register-skills.js"

function healthyRecords() {
  return createHealthRecords(() => [])
}

test("DSH registers all 33 bundled skills with absolute resources and native semantics", async (t) => {
  const registrations = []
  const active = new Set()
  const ctx = {
    skills: {
      register(skill) {
        registrations.push(skill)
        active.add(skill.name)
        return () => active.delete(skill.name)
      },
    },
  }
  const health = healthyRecords()
  const temporaryDirectory = await fs.mkdtemp(join(tmpdir(), "omagents-dsh-skills-cwd-"))
  const previousCwd = process.cwd()
  process.chdir(temporaryDirectory)
  t.after(async () => {
    process.chdir(previousCwd)
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  })

  const dispose = registerDshSkills(ctx, health)
  const definitions = listSkillDefinitions({ host: "dsh" })
  assert.equal(definitions.length, 33)
  assert.equal(registrations.length, 33)
  assert.equal(new Set(registrations.map((skill) => skill.name)).size, 33)
  assert.equal(registrations.filter((skill) => skill.source === "omagents").length, 18)
  assert.equal(registrations.filter((skill) => skill.source === "superpowers").length, 15)

  for (const registration of registrations) {
    const definition = definitions.find((candidate) => candidate.name === registration.name)
    assert.ok(definition, `missing Core definition for ${registration.name}`)
    const rendered = renderSkillForHost(definition, "dsh")
    assert.equal(registration.content, rendered.body)
    assert.ok(registration.content.length > 0)
    assert.equal(registration.description, rendered.description)
    assert.ok(isAbsolute(registration.path), `${registration.name} path must be absolute`)
    assert.equal(registration.resourceBase.kind, "directory")
    assert.ok(
      isAbsolute(registration.resourceBase.path),
      `${registration.name} resourceBase must not depend on cwd`
    )
    assert.equal(registration.resourceBase.path, definition.directory)
  }

  const parallel = registrations.find((skill) => skill.name === "parallel-execution")
  assert.ok(parallel)
  assert.doesNotMatch(parallel.content, /background:\s*true/)
  assert.match(parallel.content, /native DSH subagents/)

  const brainstorming = registrations.find((skill) => skill.name === "brainstorming")
  const writingPlans = registrations.find((skill) => skill.name === "writing-plans")
  assert.match(brainstorming.content, /docs\/specs\//)
  assert.match(writingPlans.content, /docs\/plans\//)
  assert.doesNotMatch(brainstorming.content, /docs\/superpowers\//)
  assert.doesNotMatch(writingPlans.content, /docs\/superpowers\//)

  const deepResearch = registrations.find((skill) => skill.name === "deep-research")
  const absoluteScript = resolve(deepResearch.resourceBase.path, "scripts", "orchestrate.py")
  assert.ok(isAbsolute(absoluteScript))
  await fs.access(absoluteScript)

  dispose()
  dispose()
  assert.equal(active.size, 0)
  assert.equal(health.skills.status, "ready")
  assert.equal(health.host.status, "ready")
})

test("real DSH skill discovery is invalidated by the composed disposer", async (t) => {
  const root = new Context()
  await root.plugin(SkillRegistry)
  t.after(() => root.fiber.dispose())
  const health = healthyRecords()
  let changes = 0
  root.on("skills/change", () => {
    changes += 1
  })

  const dispose = registerDshSkills(root, health)
  const listed = await root.skills.list()
  assert.equal(listed.length, 33)
  const parallel = await root.skills.get("parallel-execution")
  assert.ok(parallel)
  assert.doesNotMatch(parallel.content, /background:\s*true/)
  assert.ok(isAbsolute(parallel.resourceBase.path))

  dispose()
  assert.equal((await root.skills.list()).length, 0)
  assert.equal(await root.skills.get("parallel-execution"), undefined)
  assert.ok(changes > 0, "teardown must invalidate skill discovery")
})

test("one skill failure is visible without blocking other skills or capabilities", () => {
  const registrations = []
  const ctx = {
    skills: {
      register(skill) {
        if (skill.name === "doctor") throw new Error("skill registration exploded")
        registrations.push(skill)
        return () => {}
      },
    },
  }
  const health = healthyRecords()

  registerDshSkills(ctx, health)

  assert.equal(registrations.length, 32)
  assert.equal(health.skills.status, "degraded")
  assert.match(health.skills.diagnostics[0].message, /doctor/)
  assert.equal(health.host.status, "ready")
  assert.equal(health.persistence.status, "ready")
  assert.equal(health.mcp.status, "ready")
  assert.equal(health.python.status, "ready")
})
