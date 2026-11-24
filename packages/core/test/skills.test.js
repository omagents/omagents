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

test("deep research exposes explicit search providers with host-native tool names", () => {
  const expectedTools = {
    "opencode-v1": [
      "websearch_web_search_exa",
      "webfetch",
      "keenable_search_web_pages",
      "keenable_fetch_page_content",
      "youdotcom_you-search",
      "youdotcom_you-extract",
    ],
    "opencode-v2": [
      "websearch_web_search_exa",
      "webfetch",
      "keenable_search_web_pages",
      "keenable_fetch_page_content",
      "youdotcom_you-search",
      "youdotcom_you-extract",
    ],
    codex: [
      "web_search",
      "web_fetch",
      "mcp__keenable__search_web_pages",
      "mcp__keenable__fetch_page_content",
      "mcp__youdotcom__you-search",
      "mcp__youdotcom__you-extract",
    ],
    dsh: [
      "web_search",
      "web_fetch",
      "mcp__keenable__search_web_pages",
      "mcp__keenable__fetch_page_content",
      "mcp__youdotcom__you-search",
      "mcp__youdotcom__you-extract",
    ],
  }

  for (const [host, tools] of Object.entries(expectedTools)) {
    const definition = listSkillDefinitions({ host }).find(
      (entry) => entry.source === "omagents" && entry.id === "deep-research"
    )
    const content = renderSkillForHost(definition, host).content
    assert.match(content, /OMAGENTS_SEARCH_PROVIDER/, host)
    for (const tool of tools) {
      assert.ok(content.includes(`\`${tool}\``), `${host} must expose ${tool}`)
    }
  }
})

test("deep research renders auto provider guidance on every host", () => {
  const genericTools = {
    "opencode-v1": ["websearch_search", "websearch_fetch"],
    "opencode-v2": ["websearch_search", "websearch_fetch"],
    codex: ["mcp__websearch__search", "mcp__websearch__fetch"],
    dsh: ["mcp__websearch__search", "mcp__websearch__fetch"],
  }
  const privacyGuidance =
    "Automatic routing can disclose the same query, optional `objective`, or target URL to the initial Exa attempt and then to eligible Keenable and You.com fallback attempts; You.com does not natively receive `objective`. Select an explicit provider when that disclosure is unacceptable."
  const loosePrivacyGuidance =
    "Fallback can send the same search or URL to Exa, Keenable, and You.com after eligible failures; select an explicit provider when that disclosure is unacceptable."
  const staleGuidance = [
    "`OMAGENTS_SEARCH_PROVIDER` selects `auto` (the default when `OMAGENTS_SEARCH_PROVIDER` is unset or empty), `exa`, or `keenable`.",
    "The Proxy calls Exa first and programmatically makes at most one Keenable attempt only after a fallback-eligible Exa failure:",
    "When both providers fail, the error identifies both with bounded, redacted failure categories.",
    "Fallback can send the same search or URL to Keenable after an eligible Exa failure; select an explicit provider when that disclosure is unacceptable.",
  ]
  const requiredGuidance = [
    "`auto` (the default when `OMAGENTS_SEARCH_PROVIDER` is unset or empty)",
    "local stdio `websearch` Search MCP Proxy",
    "`exa`, `keenable`, or `youcom`",
    "fallback-eligible",
    "zero search hits",
    "Exa → Keenable → You.com",
    "at most one attempt per eligible position",
    "Provider:",
    "Provider: exa|keenable|youcom",
    "Fallback:",
    "_meta.omagents.provider",
    "_meta.omagents.fallback",
    "_meta.omagents.fallbacks",
    "When all three providers fail",
    "Host-native web tools",
    "user-overridden `websearch`",
    "credential presence only",
    privacyGuidance,
  ]

  for (const [host, tools] of Object.entries(genericTools)) {
    const definition = listSkillDefinitions({ host }).find(
      (entry) => entry.source === "omagents" && entry.id === "deep-research"
    )
    const content = renderSkillForHost(definition, host).content
    for (const stale of staleGuidance) {
      assert.ok(!content.includes(stale), `${host} deep research must not retain ${stale}`)
    }
    for (const required of requiredGuidance) {
      assert.ok(content.includes(required), `${host} deep research must explain ${required}`)
    }
    assert.ok(
      !content.includes(loosePrivacyGuidance),
      `${host} deep research must not describe Exa as a fallback destination`
    )
    for (const tool of tools) {
      assert.ok(content.includes(`\`${tool}\``), `${host} deep research must expose ${tool}`)
    }
    assert.match(content, /authentication/i, host)
    assert.match(content, /invalid-parameter/i, host)
    assert.match(content, /caller cancellation/i, host)
    assert.match(content, /never print API key values or authorization headers/i, host)
    assert.match(content, /bounded, redacted/i, host)
    assert.doesNotMatch(content, /selects `exa` \(the default\)/i, host)
  }
})

test("generic Proxy tool names render only as MCP names for Codex and DSH", (t) => {
  const source = "Search: `websearch_search`\nFetch: `websearch_fetch`\n"
  const definition = makeSkillFixture(t, "omagents", source)
  const expected = {
    "opencode-v1": source,
    "opencode-v2": source,
    codex: "Search: `mcp__websearch__search`\nFetch: `mcp__websearch__fetch`\n",
    dsh: "Search: `mcp__websearch__search`\nFetch: `mcp__websearch__fetch`\n",
  }

  for (const host of ["opencode-v1", "opencode-v2", "codex", "dsh"]) {
    assert.equal(renderSkillForHost(definition, host).body, expected[host], host)
  }
})

test("direct You.com tool names render only as MCP names for Codex and DSH", (t) => {
  const source = "Search: `youdotcom_you-search`\nFetch: `youdotcom_you-extract`\n"
  const definition = makeSkillFixture(t, "omagents", source)
  const expected = {
    "opencode-v1": source,
    "opencode-v2": source,
    codex: "Search: `mcp__youdotcom__you-search`\nFetch: `mcp__youdotcom__you-extract`\n",
    dsh: "Search: `mcp__youdotcom__you-search`\nFetch: `mcp__youdotcom__you-extract`\n",
  }

  for (const host of ["opencode-v1", "opencode-v2", "codex", "dsh"]) {
    assert.equal(renderSkillForHost(definition, host).body, expected[host], host)
  }
})

test("doctor renders auto provider guidance on every host", () => {
  const genericTools = {
    "opencode-v1": ["websearch_search", "websearch_fetch"],
    "opencode-v2": ["websearch_search", "websearch_fetch"],
    codex: ["mcp__websearch__search", "mcp__websearch__fetch"],
    dsh: ["mcp__websearch__search", "mcp__websearch__fetch"],
  }
  const requiredGuidance = [
    "`auto` (the default when `OMAGENTS_SEARCH_PROVIDER` is unset or empty)",
    "local stdio `websearch` Search MCP Proxy",
    "`exa`, `keenable`, or `youcom`",
    "fallback-eligible",
    "zero search hits",
    "Exa → Keenable → You.com",
    "at most one attempt per eligible position",
    "Provider:",
    "Provider: exa|keenable|youcom",
    "Fallback:",
    "_meta.omagents.provider",
    "_meta.omagents.fallback",
    "_meta.omagents.fallbacks",
    "When all three providers fail",
    "Host-native web tools",
    "user-overridden `websearch`",
    "credential presence only",
  ]
  const staleGuidance = [
    "`OMAGENTS_SEARCH_PROVIDER` selects `auto` (the default when `OMAGENTS_SEARCH_PROVIDER` is unset or empty), `exa`, or `keenable`.",
    "The Proxy calls Exa first and programmatically makes at most one Keenable attempt only after a fallback-eligible Exa failure:",
    "When both providers fail, the error identifies both with bounded, redacted categories.",
  ]

  for (const [host, tools] of Object.entries(genericTools)) {
    const definition = listSkillDefinitions({ host }).find(
      (entry) => entry.source === "omagents" && entry.id === "doctor"
    )
    const content = renderSkillForHost(definition, host).content
    for (const stale of staleGuidance) {
      assert.ok(!content.includes(stale), `${host} doctor must not retain ${stale}`)
    }
    for (const required of requiredGuidance) {
      assert.ok(content.includes(required), `${host} doctor must explain ${required}`)
    }
    for (const tool of tools) {
      assert.ok(content.includes(`\`${tool}\``), `${host} doctor must expose ${tool}`)
    }
    assert.match(content, /authentication/i, host)
    assert.match(content, /invalid-parameter/i, host)
    assert.match(content, /caller cancellation/i, host)
    assert.match(content, /never print API key values or authorization headers/i, host)
    assert.match(content, /bounded, redacted/i, host)
    assert.doesNotMatch(content, /selects `exa` \(the default\)/i, host)
  }
})

test("doctor checks configured routes, runtime providers, and keyed/keyless endpoints on every host", () => {
  const staleGuidance = [
    "`OMAGENTS_SEARCH_PROVIDER` selects `auto` (the default when `OMAGENTS_SEARCH_PROVIDER` is unset or empty), `exa`, or `keenable`.",
    "Use the actual response's prepended `Provider: exa|keenable` and optional `Fallback: exa failed (<code>)` lines, or `_meta.omagents.provider` and `_meta.omagents.fallback`, as runtime provider/fallback evidence rather than configuration inference.",
  ]

  for (const host of ["opencode-v1", "opencode-v2", "codex", "dsh"]) {
    const definition = listSkillDefinitions({ host }).find(
      (entry) => entry.source === "omagents" && entry.id === "doctor"
    )
    const content = renderSkillForHost(definition, host).content
    for (const stale of staleGuidance) {
      assert.ok(!content.includes(stale), `${host} doctor must not retain ${stale}`)
    }
    for (const required of [
      "OMAGENTS_SEARCH_PROVIDER",
      "`exa`, `keenable`, or `youcom`",
      "KEENABLE_API_KEY",
      "https://api.keenable.ai/mcp",
      "https://api.keenable.ai/mcp-public",
      "X-API-Key",
      "`youdotcom` with explicit You.com",
      "YDC_API_KEY",
      "https://api.you.com/mcp",
      "https://api.you.com/mcp/free",
      "Authorization: Bearer",
      "configured route",
      "runtime provider evidence",
      "ordered two-fallback history",
    ]) {
      assert.ok(content.includes(required), `${host} doctor must check ${required}`)
    }
  }
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
