# Privilege Escalation Skill Design

Date: 2026-11-27
Status: Approved (design confirmed in conversation, 2026-11-27)

## Intent and Why

Agent shells run without an interactive TTY. When a model runs `sudo ...`, the
command either blocks waiting for a password that can never be typed (until the
tool timeout kills it) or is denied outright by host permission rules (this
repo user's OpenCode config denies `sudo *`, for example). Privileged tasks —
installing packages, editing `/etc`, restarting system services — fail or stall.

Omarchy solves this on its systems with a "Privilege Escalation" section in its
`omarchy` agent skill: `sudo` when a visible terminal exists, `pkexec` when the
caller cannot interact with a password prompt. OmAgents should ship the same
guidance as a bundled skill so OpenCode, Codex, and DSH agents on Linux
desktops escalate non-interactively through Polkit (`pkexec`, `run0`) instead
of dying on bare `sudo`.

## Goals

- A 19th OmAgents skill, `privilege-escalation`, discovered and rendered for
  all four hosts (`opencode-v1`, `opencode-v2`, `codex`, `dsh`) through the
  normal Core catalog — no adapter code changes, no scripts, no host override.
- Probe-first guidance that routes privileged commands to tools that work
  without a TTY, in order: `sudo -n` (fails fast, never hangs) → `pkexec`
  (Polkit, GUI password dialog on desktop sessions) → `run0` (systemd ≥ 257) →
  `doas`; probed with `command -v` before use.
- Correct `pkexec` mechanics: the environment is scrubbed, so commands must be
  absolute paths (resolve with `command -v` first); pipes and redirections run
  as the calling user, so root writes go through `pkexec tee` or
  `pkexec sh -c '...'`.
- Explicit never-rules: never bare interactive `sudo` (hangs), never
  `echo <password> | sudo -S`, never weaken sudoers policy to unblock an
  agent, never double-wrap commands that elevate themselves.
- A final fallback that prints the exact command for the user to run manually
  when no escalation tool is available or authorized.

## Non-Goals

- No privilege-granting infrastructure: the skill only changes which commands
  the agent emits; Polkit/sudo policy stays the user's.
- No `scripts/`, no loop engine, no `SKILL_SCRIPT_DIRS` change, no
  `SKILL.dsh.md` override (content is host-neutral).
- No installer, MCP, or host adapter code changes.

## Anti-Goals

- Never encouraging password disclosure or persistent policy weakening
  (NOPASSWD edits) — a security regression even when it "works".
- No Windows elevation emulation and no macOS `pkexec` substitute: those
  platforms get the explicit manual hand-off (macOS has only `sudo`; Windows
  needs an elevated shell the agent cannot open).

## Constraints

- Counts move in the same change, everywhere: OmAgents 18 → 19, total 33 → 34,
  across root + 4 package AGENTS.md files, CONTRIBUTING.md, all four README
  languages, `packages/dsh/README.md`, the DSH `doctor` skill, and every pinned
  test assertion. Historical CHANGELOG entries and past docs/plans,
  docs/specs keep their original numbers.
- Skill content must pass the DSH leak scans in `tests/skills.test.js`: no
  `OPENCODE_` variables, `webfetch`, `codegraph_codegraph_explore`,
  `github_[a-z_]+`, `task(background`, or `background: true` strings.
- Frontmatter requires `name: privilege-escalation` and a trigger-rich
  `description` (tests assert both exist).
- CHANGELOG gets a `## [Unreleased]` → `### Added` entry (repo convention from
  0.16.3's feature commit); no version bump — release versioning requires
  separate user authorization.

## Approaches Considered

1. **Bundled Core skill (chosen).** Ships to every OmAgents user on every host
   through the existing discovery/rendering path; zero adapter code. Costs the
   full count and documentation sync, which the repo already treats as a
   single-change obligation.
2. **User-level `~/.agents/skills` skill, not packaged.** Like Omarchy's
   per-machine symlink. No count churn, but OmAgents users on other machines
   never receive it — fails the intent of adding a skill to OmAgents.
3. **System-prompt injection in the OpenCode adapter.** Reaches only OpenCode,
   mixes usage guidance into infrastructure code, and duplicates what a
   declarative skill already does for all hosts.

## Design

- Directory: `packages/core/skills/privilege-escalation/` with `SKILL.md` and
  `agents/openai.yaml` (display name "Privilege Escalation").
- `SKILL.md` sections: When to Use; Why bare sudo fails; Probe-first decision
  tree (`sudo -n` → `pkexec` → `run0` → `doas`, self-elevating commands never
  wrapped); pkexec rules (absolute paths, `tee`, `sh -c`, auth-agent
  requirement, no GUI apps); run0 and doas notes; editing root files; the
  never-list; platform fallbacks (macOS/Windows); final manual hand-off.
- Tests: pinned counts 34/19/15 across `tests/skills.test.js`,
  `tests/plugin-v2.test.js`, `tests/documentation.test.js`, and
  `packages/dsh/test/{loader,skills,superpowers}.test.*`; the DSH `doctor`
  skill content 33 → 34 / 18 → 19; a new rendering test asserting the skill
  covers `sudo -n`, `pkexec`, `run0`, `doas`, `tee`, and absolute paths for
  every host without OpenCode-only strings.

## Left to the Builder

- Exact prose of the skill body within the pinned section structure.
- Phrasing of the three translated READMEs (skill names stay in English).
