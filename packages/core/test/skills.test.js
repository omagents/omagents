import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { listSkillDefinitions, renderSkillForHost } from "../src/index.js"

function makeSkillFixture(t, source, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omagents-core-skill-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const directory = path.join(root, "fixture")
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, "SKILL.md"), content)
  return { id: "fixture", name: "fixture", source, directory }
}

test("Superpowers rendering flattens every docs root without changing similar path names", (t) => {
  const definition = makeSkillFixture(
    t,
    "superpowers",
    `---
name: fixture
---
Design: \`docs/superpowers/specs/example-design.md\`
Plan: \`docs/superpowers/plans/example.md\`
Review: \`docs/superpowers/reviews/example.md\`
Root: \`docs/superpowers\`
Keep: \`docs/superpowers-archive/example.md\` and \`notdocs/superpowers/example.md\`
`
  )

  const rendered = renderSkillForHost(definition, "codex")

  assert.equal(
    rendered.body,
    `Design: \`docs/specs/example-design.md\`
Plan: \`docs/plans/example.md\`
Review: \`docs/reviews/example.md\`
Root: \`docs\`
Keep: \`docs/superpowers-archive/example.md\` and \`notdocs/superpowers/example.md\`
`
  )
})

test("Superpowers rendering leaves OmAgents documentation paths untouched", (t) => {
  const definition = makeSkillFixture(
    t,
    "omagents",
    "Keep the historical path `docs/superpowers/specs/example-design.md`.\n"
  )

  const rendered = renderSkillForHost(definition, "dsh")

  assert.equal(
    rendered.body,
    "Keep the historical path `docs/superpowers/specs/example-design.md`.\n"
  )
})

test("all Core hosts render the current Superpowers design and plan paths beneath docs", () => {
  const definitions = listSkillDefinitions({ host: "codex" })
  const brainstorming = definitions.find(
    (definition) => definition.source === "superpowers" && definition.id === "brainstorming"
  )
  const writingPlans = definitions.find(
    (definition) => definition.source === "superpowers" && definition.id === "writing-plans"
  )
  assert.ok(brainstorming)
  assert.ok(writingPlans)

  for (const host of ["opencode-v1", "opencode-v2", "codex", "dsh"]) {
    const design = renderSkillForHost(brainstorming, host).content
    const plan = renderSkillForHost(writingPlans, host).content
    assert.match(design, /docs\/specs\//, host)
    assert.match(plan, /docs\/plans\//, host)
    assert.doesNotMatch(design, /docs\/superpowers(?:\/|`)/, host)
    assert.doesNotMatch(plan, /docs\/superpowers(?:\/|`)/, host)
  }
})
