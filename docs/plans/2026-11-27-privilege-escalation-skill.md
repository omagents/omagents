# Privilege Escalation Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 19th OmAgents skill, `privilege-escalation`, that routes privileged commands through `sudo -n` → `pkexec` → `run0` → `doas` instead of bare `sudo`, which hangs or is denied in TTY-less agent shells.

**Architecture:** A plain Markdown skill directory under Core's existing skills root is auto-discovered by `listSkillDefinitions` for all four hosts — no adapter, catalog, or script-registration code changes. Every pinned skill-count assertion (18/33) and every documentation reference moves to 19/34 in the same change, repo rule.

**Tech Stack:** Markdown + YAML frontmatter (skill), Node.js `node:test` (existing suites), TypeScript DSH tests via `node --import tsx --test`.

**Spec:** `docs/specs/2026-11-27-privilege-escalation-skill-design.md`

## Global Constraints

- No Git mutations: do not run `git commit`, `git push`, `git reset`, or `git rebase`. Leave every change uncommitted unless the user separately authorizes a Git operation.
- Update English, Simplified Chinese, Japanese, and Korean README files in the same change, plus affected AGENTS guides, CONTRIBUTING.md, and CHANGELOG.
- OmAgents skill count moves 18 → 19 and total 33 → 34. Superpowers stays 15. Historical CHANGELOG entries, `docs/plans/*`, and `docs/specs/*` (past features) keep their original numbers — never rewrite them.
- CHANGELOG uses a new `## [Unreleased]` → `### Added` entry above `## [0.16.3]`; no package.json version bumps (release versioning requires separate authorization).
- The skill has no `scripts/` directory, no `SKILL.dsh.md` override, and no `SKILL_SCRIPT_DIRS` change.
- Skill content must not contain any of: `OPENCODE_`, `webfetch`, `codegraph_codegraph_explore`, `github_`-prefixed tool names, `task(` with `background`, or `background: true` — these trip the DSH leak scans in `tests/skills.test.js:196-198` that run over every rendered skill.
- New prose mentions of skill counts use "19 OmAgents", "15 Superpowers", "34" total.

## Review Focus

- **DSH leak scan trips on the new skill** (OpenCode-only strings rendered for `dsh`): pinned by Task 1's new rendering test asserting `doesNotMatch(/OPENCODE_|\bwebfetch\b/)` plus the existing per-skill leak scan.
- **pkexec environment scrubbing** (relative command names fail because PATH is reset): pinned by Task 1's new test requiring the phrase "absolute path" in every host render.
- **Redirection-as-caller trap** (`pkexec echo x > /etc/f` writes as the normal user): pinned by Task 1's new test requiring `tee` coverage.
- **DSH doctor reports the stale count after the skill exists**: pinned by Task 1's `/34/` assertion on the rendered DSH doctor content and Task 2's doctor content update.
- **Historical changelog entries get rewritten** (0.14.0/0.16.3 "33"): pinned by the existing `tests/documentation.test.js` changelog tests, which must keep passing untouched in Task 4.

---

### Task 1: Pin the 19th skill and new counts in tests (RED)

**Files:**
- Modify: `tests/skills.test.js:176-180,238,346-366` (counts, doctor regex, expected list) and append one new test
- Modify: `tests/plugin-v2.test.js:173-176`
- Modify: `tests/documentation.test.js:82-83,686`
- Modify: `packages/dsh/test/loader.test.ts:185,217,279,295,366`
- Modify: `packages/dsh/test/skills.test.ts:18,41-44,99`
- Modify: `packages/dsh/test/superpowers.test.ts:145`

**Interfaces:**
- Consumes: existing `listSkillDefinitions({ host })` / `renderSkillForHost(definition, host)` exports already imported by `tests/skills.test.js`.
- Produces: the expected skill name `"privilege-escalation"` and count values 34/19/15 that Task 2's files must satisfy; a new test named `privilege-escalation skill renders host-neutral guidance for every host`.

- [ ] **Step 1: Update `tests/skills.test.js` counts, doctor regex, and expected list**

In the test at line 176 rename the title to "DSH discovers all 34 skills and renders every skill without wrong-host control flow", change line 178 `assert.equal(definitions.length, 33)` → `34`, line 179 `..., 18)` → `19`. Line 238: `assert.match(doctor, /33/)` → `assert.match(doctor, /34/)`. In the `expected` array (line 346+) insert `"privilege-escalation",` immediately after `"parallel-execution",`.

- [ ] **Step 2: Append the new rendering test to `tests/skills.test.js`**

Add after the "DSH discovers all …" test, matching the file's existing style:

```js
test("privilege-escalation skill renders host-neutral guidance for every host", () => {
  for (const host of HOSTS) {
    const definition = listSkillDefinitions({ host }).find(
      (skill) => skill.name === "privilege-escalation"
    )
    assert.ok(definition, `missing privilege-escalation for ${host}`)
    const rendered = renderSkillForHost(definition, host)
    for (const required of ["sudo -n", "pkexec", "run0", "doas", "tee"]) {
      assert.ok(
        rendered.body.includes(required),
        `privilege-escalation must cover ${required} for ${host}`
      )
    }
    assert.match(rendered.body, /absolute path/i)
    assert.doesNotMatch(rendered.content, /OPENCODE_|\bwebfetch\b/)
  }
})
```

- [ ] **Step 3: Run `tests/skills.test.js` and verify RED**

Run: `node --test tests/skills.test.js`
Expected: FAIL — "Missing expected skill: privilege-escalation", count assertion 34 ≠ 33, and doctor `/34/` no-match. All other tests in the file pass.

- [ ] **Step 4: Update `tests/plugin-v2.test.js`**

Line 173: `expected.length >= 18, "repo should bundle at least 18 skills"` → `>= 19, "repo should bundle at least 19 skills"`. Lines 175–176: both `assert.equal(..., 33, ...)` → `34` (keep the assertion messages).

- [ ] **Step 5: Run `tests/plugin-v2.test.js` and verify RED**

Run: `node --test tests/plugin-v2.test.js`
Expected: FAIL on the skills count assertions (34 expected, 33 registered). No other failures.

- [ ] **Step 6: Update `tests/documentation.test.js`**

Line 82: `"33",` → `"34",`. Line 83: `"18",` → `"19",`. Line 686: `"33 skills",` → `"34 skills",`. Do not touch line 821 (0.14.0 changelog) or any other "33".

- [ ] **Step 7: Update the three DSH test files**

`packages/dsh/test/loader.test.ts` lines 185, 279, 295, 366: `assert.equal(..., 33)` → `34`; line 217: `if (batch.registrations.length === 33)` → `=== 34`.
`packages/dsh/test/skills.test.ts` line 18 test title: "DSH registers all 33 bundled skills …" → "… all 34 bundled skills …"; lines 41, 42, 43, 99: `33` → `34`; line 44: `18` → `19`.
`packages/dsh/test/superpowers.test.ts` line 145: `assert.equal(catalog.source.entries.length, 33)` → `34`.

- [ ] **Step 8: Run the targeted DSH suites and verify RED**

Run: `npm test --workspace @omagents/omagents-dsh -- skills superpowers loader`
Expected: FAIL on the 33→34 count assertions in `skills.test.ts`, `superpowers.test.ts`, and `loader.test.ts` (skill not present yet). No unrelated failures.

### Task 2: Create the skill and refresh the DSH doctor count (GREEN)

**Files:**
- Create: `packages/core/skills/privilege-escalation/SKILL.md`
- Create: `packages/core/skills/privilege-escalation/agents/openai.yaml`
- Modify: `packages/core/skills/doctor/SKILL.dsh.md:28,123`

**Interfaces:**
- Consumes: Task 1's expected name `"privilege-escalation"`, counts 34/19, and the required content tokens `sudo -n`, `pkexec`, `run0`, `doas`, `tee`, `absolute path`.
- Produces: a Core catalog entry with valid frontmatter (`name`, `description`) that every host renders host-neutrally.

- [ ] **Step 1: Create `SKILL.md` with this exact frontmatter and section skeleton**

```yaml
---
name: privilege-escalation
description: "Run commands that need root from non-interactive agent shells. Trigger when sudo fails, hangs, times out, is denied, or reports no TTY or askpass, and for privileged work like system package installs, /etc or /usr edits, system services, mounts, and kernel modules. Provides a probe-first chain through sudo -n, pkexec, run0, and doas."
---
```

Body sections (write the prose; each bullet is a must-cover fact):
1. `# Privilege Escalation for Agent Shells` — agent shells have no TTY; bare `sudo` blocks on a password prompt until the tool timeout kills it, and some hosts deny `sudo` patterns outright.
2. `## When to Use` — bullets: command needs root (system package install, `/etc`/`/usr` writes, system `systemctl` units, mounts, user/group management, privileged `journalctl`); `sudo` already failed with "a terminal is required"/"no askpass program"/"sudo: a password is required" or timed out; the host denied the `sudo` pattern.
3. `## Probe First, Then Escalate` — decision tree code block: (a) command already elevates itself (`sudo`, `pkexec`, `su`, …) → run as-is, never wrap; (b) `sudo -n true` succeeds (passwordless/cached/askpass) → `sudo -n <cmd>`; (c) `command -v pkexec` and a desktop polkit agent → `pkexec <absolute-path> …`; (d) `command -v run0` (systemd ≥ 257) → `run0 <cmd>`; (e) `command -v doas` → `doas <cmd>`; (f) nothing works → print the exact command for the user and stop.
4. `## pkexec Rules` — Polkit shows a GUI password dialog the human can approve; environment is scrubbed, so pass the absolute executable path (resolve first with `command -v <cmd>`, e.g. `command -v pacman` then `pkexec /usr/bin/pacman -Syu`); pipes and redirections execute as the calling user, so write root files with `pkexec tee` (e.g. `printf '%s\n' value | pkexec tee /etc/...`) or wrap compound commands as `pkexec sh -c '…'`; requires a polkit authentication agent (typical on desktop sessions; headless/SSH usually has none → fall through); GUI apps are not launchable (DISPLAY/XAUTHORITY dropped).
5. `## run0 and doas` — `run0` is systemd's sudo replacement (v257+), polkit-backed like pkexec but keeps a saner environment; `doas` is the OpenBSD-style alternative configured in `/etc/doas.conf`.
6. `## Never` — never bare interactive `sudo` in an agent shell (hangs until timeout); never pipe or embed passwords (`echo '<pw>' | sudo -S`); never edit sudoers/NOPASSWD policy just to unblock an agent; never double-wrap (`sudo pkexec …`, `pkexec sudo …`); never run destructive root commands (`rm -rf`-class) without quoting the exact command to the user first.
7. `## Platform Notes` — macOS: only `sudo` exists; if `sudo -n` fails, hand the command to the user. Windows: no pkexec/run0/doas; privileged commands need an elevated shell — always hand to the user. Linux without a desktop: pkexec/run0 usually cannot prompt → fall through to the manual step.
8. `## When Every Tool Fails` — print the exact command (absolute path, full arguments) for the user to run in their own terminal, then stop; do not retry-loop escalation attempts.

Do not include any `scripts/` references, `OPENCODE_` variables, or host tool names (see Global Constraints).

- [ ] **Step 2: Create `agents/openai.yaml`**

```yaml
interface:
  display_name: "Privilege Escalation"
  short_description: "Run root commands without a TTY"
  default_prompt: "Use $privilege-escalation to pick a non-interactive privilege escalation tool before running a command that needs root."
```

- [ ] **Step 3: Update the DSH doctor skill counts**

`packages/core/skills/doctor/SKILL.dsh.md` line 28: "all 33 packaged entries are present: 18 OmAgents and 15 Superpowers" → "all 34 packaged entries are present: 19 OmAgents and 15 Superpowers" (rest of the line unchanged). Line 123: `| Native skills | PASS | 33 entries (18 OmAgents + 15 Superpowers) |` → `34 entries (19 OmAgents + 15 Superpowers)`.

- [ ] **Step 4: Run `tests/skills.test.js` and verify PASS**

Run: `node --test tests/skills.test.js`
Expected: PASS — all tests including the new rendering test, the 34/19 counts, and doctor `/34/`.

- [ ] **Step 5: Run the Core workspace suite and `tests/plugin-v2.test.js`**

Run: `npm test --workspace @omagents/core` then `node --test tests/plugin-v2.test.js`
Expected: PASS both.

### Task 3: Documentation and changelog sync (GREEN for docs tests)

**Files:**
- Modify: `README.md:11,70-72,106-108`, `README.zh-cn.md:11,70-72,106-108`, `README.ja.md:11,70-72,106-108`, `README.ko.md:11,70-72,106-108`
- Modify: `packages/dsh/README.md:3,23`
- Modify: `AGENTS.md:119,142,144,192-210,283,376`
- Modify: `packages/core/AGENTS.md:17`, `packages/dsh/AGENTS.md:23`, `packages/opencode/AGENTS.md:18`, `packages/codex/AGENTS.md:20`
- Modify: `CONTRIBUTING.md:33`
- Modify: `CHANGELOG.md` (new `[Unreleased]` entry at the top)

**Interfaces:**
- Consumes: Task 2's skill name and the counts 19/15/34.
- Produces: documentation state satisfying `tests/documentation.test.js` (README matrix "34"/"19"/"15", DSH README "34 skills").

- [ ] **Step 1: Update all four README languages in one pass**

Each of `README.md`, `README.zh-cn.md`, `README.ja.md`, `README.ko.md`:
- Line 11 prose: "18 OmAgents skills" (or the language's equivalent: 18 个 / 18個の / 18개의) → 19.
- Lines 70–72 support matrix, three rows: `**33**: 18 OmAgents + 15 Superpowers` (language variants: `**33**：18 个`, `**33**：OmAgents 18`, `**33**: OmAgents 18`) → `**34**` and 19, keeping each language's phrasing.
- Line 106: "The 18 OmAgents skills are:" (language equivalent) → 19.
- Line 108 skill list: insert `` `privilege-escalation`, `` immediately after `` `parallel-execution`, `` (skill names stay in English in every language).

- [ ] **Step 2: Run `tests/documentation.test.js` and verify PASS**

Run: `node --test tests/documentation.test.js`
Expected: PASS — matrix now contains "34", "19", "15"; DSH README check still needs Step 3.

- [ ] **Step 3: Update `packages/dsh/README.md`**

Line 3: "Complete DeepSeek Harness integration for OmAgents: 33 skills," → "34 skills,". Line 23: `- **33 skills**: 18 OmAgents plus 15 Superpowers,` → `- **34 skills**: 19 OmAgents plus 15 Superpowers,`.

- [ ] **Step 4: Run `tests/documentation.test.js` again and verify PASS**

Run: `node --test tests/documentation.test.js`
Expected: PASS (DSH README "34 skills" present).

- [ ] **Step 5: Update the AGENTS guides and CONTRIBUTING.md**

- Root `AGENTS.md`: line 119 "for all 33 skills" → "all 34 skills"; line 142 "registers exactly 18 OmAgents + 15 Superpowers skills" → "exactly 19 OmAgents + 15 Superpowers skills" and "All 33 DSH skills" → "All 34 DSH skills"; line 144 "live 33-entry catalog" → "34-entry catalog"; line 283 "33 native skills" → "34 native skills"; line 376 "OmAgents has 18" → "OmAgents has 19".
- Root `AGENTS.md` skills table: heading `### OmAgents Skills (18)` → `(19)`; insert row `| \`privilege-escalation\` | Non-interactive root commands: probe-first sudo -n, pkexec, run0, doas | No | Yes | No |` after the `parallel-execution` row.
- `packages/core/AGENTS.md:17`: "18 OmAgents skills" → "19 OmAgents skills".
- `packages/dsh/AGENTS.md:23`: "Register all 33 skills (18 OmAgents + 15 Superpowers)" → "Register all 34 skills (19 OmAgents + 15 Superpowers)".
- `packages/opencode/AGENTS.md:18`: "all 33 skills exactly once" → "all 34 skills exactly once".
- `packages/codex/AGENTS.md:20`: "Core supplies 18 OmAgents skills and pinned Superpowers supplies 15, for 33 total." → "…19…, for 34 total."
- `CONTRIBUTING.md:33`: "# 18 OmAgents skills and shared scripts" → "# 19 OmAgents skills and shared scripts".

- [ ] **Step 6: Add the CHANGELOG `[Unreleased]` entry**

Insert above `## [0.16.3] - 2026-11-27`:

```markdown
## [Unreleased]

### Added

- **Privilege escalation skill:** a 19th OmAgents skill, `privilege-escalation`, stops agents from dying on bare `sudo` in TTY-less shells. Privileged commands route through a probe-first chain — `sudo -n`, `pkexec`, `run0`, `doas` — with correct pkexec mechanics (absolute executable paths, `tee`/`sh -c` for root file writes), never-rules (no bare sudo, no password piping, no double-wrapping self-elevating commands, no sudoers weakening), platform fallbacks, and a manual hand-off when no tool can prompt. Skill counts move to 19 OmAgents / 34 total across all README languages, AGENTS guides, the DSH doctor skill, and pinned tests.
```

### Task 4: Full verification

**Files:**
- No new modifications. Verification only; fix any fallout in the files this plan already lists.

**Interfaces:**
- Consumes: the complete change from Tasks 1–3.
- Produces: verified green suites across root, Core, and DSH.

- [ ] **Step 1: Run the full root and workspace test suite**

Run: `npm test`
Expected: PASS — root `tests/*.test.js` including `skills`, `plugin-v2`, `documentation`, `package-assets`, then Core, Codex, and DSH workspace suites.

- [ ] **Step 2: Build DSH and run its full suite with artifacts**

Run: `npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh`
Expected: PASS — all 17 DSH test files with the 34-count assertions green.

- [ ] **Step 3: Prettier check over the modified JavaScript tests**

Run: `npm run format:check`
Expected: PASS (no formatting drift in `tests/skills.test.js`, `tests/plugin-v2.test.js`, `tests/documentation.test.js`).

- [ ] **Step 4: Confirm no stale 18/33 skill references remain**

Run: `grep -rnE "33 (skills|native)|18 (OmAgents|skills)|33-entry|33 entries|all 33" --include="*.md" --include="*.js" --include="*.ts" . | grep -v node_modules | grep -v "\.git/" | grep -v CHANGELOG | grep -v docs/plans | grep -v docs/specs`
Expected: no output (the only historical mentions live in CHANGELOG and past plans/specs, which stay untouched).

- [ ] **Step 5: Report completion**

Summarize: files created (2), files modified, suites run with results. Leave everything uncommitted per Global Constraints.
