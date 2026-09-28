# AGENTS.md

> This file gives AI agents the context they need to work on the OmAgents project.
> Read this before making any changes.

## What Is This Project?

OmAgents (`@omagents/omagents`) is an OpenCode plugin that bundles agent skills, MCP servers, parallel execution, and superpowers into a single npm package. Users install it by adding `@omagents/omagents` to their `opencode.json` plugin array.

## Architecture (Layered)

```
┌─────────────────────────────────────────────────┐
│  User Choice Layer (NOT bundled)                 │
│  OpenSpec · gstack · custom workflows · none     │
├─────────────────────────────────────────────────┤
│  Process Skills Layer (bundled: superpowers)     │
│  Brainstorming · TDD · Debugging · Plans ·       │
│  Code Review · Git Worktrees · Verification      │
├─────────────────────────────────────────────────┤
│  Infrastructure Layer (bundled: OmAgents)        │
│  MCP servers · Parallel execution ·              │
│  Deep research · Python tooling · venv           │
├─────────────────────────────────────────────────┤
│  OpenCode runtime                                │
└─────────────────────────────────────────────────┘
```

- **OmAgents** = infrastructure layer. Provides tools and capabilities.
- **Superpowers** = process skills layer. Provides development workflows.
- **User choice layer** is NOT bundled. OmAgents stays neutral on methodology.

## Project Structure

```
omagents/
├── .opencode/
│   ├── .gitignore              # Ignores host-generated artifacts (see note below)
│   └── plugins/
│       ├── index.js            # Plugin entry point (dual V1/V2; merges superpowers + omagents)
│       └── parallel.js         # Parallel execution engine (V1 + V2 wiring, shared job board)
├── .github/
│   ├── ISSUE_TEMPLATE/         # bug_report.md, feature_request.md
│   └── workflows/
│       ├── ci.yml              # Syntax check on push/PR
│       └── publish.yml         # OIDC trusted publishing on tag push
├── skills/                     # Bundled OpenCode skills
│   ├── _shared/scripts/        # Shared scripts (loop_engine.py)
│   ├── deep-research/          # Multi-source research workflow
│   │   ├── SKILL.md
│   │   ├── agents/
│   │   ├── scripts/            # Python scripts (deep_research.py, plan.py, etc.)
│   │   └── templates/          # Jinja2 report templates (comparison, survey, technical)
│   ├── parallel-execution/     # Background task dispatch guide
│   │   └── SKILL.md
│   ├── agents-python-tools/    # Python venv management
│   │   └── SKILL.md
│   ├── markitdown-converter/   # Document to Markdown conversion
│   │   ├── SKILL.md
│   │   └── scripts/
│   ├── officecli/              # Create and edit Office documents (.docx, .xlsx, .pptx)
│   │   └── SKILL.md
│   └── playwright-web-scraping/# Web scraping with Playwright
│       ├── SKILL.md
│       └── scripts/
├── setup/
│   └── opencode.js             # OpenCode setup command (npx @omagents/omagents opencode)
├── package.json                # superpowers as git dependency (pinned to commit)
├── package-lock.json
├── CHANGELOG.md
├── CONTRIBUTING.md
├── README.md
└── LICENSE
```

**IMPORTANT:** There is NO root-level `templates/` directory. Jinja2 templates live in `skills/deep-research/templates/`.

## Plugin Entry Point (`.opencode/plugins/index.js`)

The default export is a **dual V1/V2 descriptor** (same pattern as superpowers >= 6.4):

```js
export default { id: "omagents", server: OmagentsPlugin, setup: setupV2 }
```

- **V1 (opencode 1.x)**: calls `server()` (>= 1.18.29) or scans the named `OmagentsPlugin` export (older). `server()` returns the V1 hooks object. Note V1 hosts may also invoke `default.setup` with a V1-shaped ctx — `setupV2` detects this (missing `ctx.session.hook`/`ctx.skill.transform`) and returns quietly.
- **V2 (opencode 2.x)**: reads `id` + `setup()` and never calls `server()`. `setupV2(ctx)` registers everything through the V2 plugin context: skills via `ctx.skill.transform`, MCP servers via `ctx.mcp.transform`, `/ps` command via `ctx.command.transform`, tools via `ctx.tool.transform`, PATH injection via `ctx.shell.hook("create.before")`, job board + system prompt via `ctx.session.hook("context")`, compaction note via `ctx.session.hook("compaction")`, lifecycle via `ctx.event.subscribe()`.

No `@opencode/plugin` import — the descriptor is a plain object, keeping the package dependency-free and loadable by both runtimes.

**Self-repo dedup guard:** when OpenCode runs inside the OmAgents source repo itself, the repo's `.opencode/plugins/*.js` are auto-discovered as project plugins *on top of* any globally-installed `@omagents/omagents`. The published (node_modules) copy detects this (project `package.json` name + project-local `.opencode/plugins/index.js`, walking up from `ctx.location.directory` on V2 / `ctx.directory` on V1) and yields, so the local working-tree checkout is the single active copy. Never remove this guard — without it everything registers twice in this repo. Note: `opencode plugin list` is a static inventory of *loadable* modules and still lists all entries (npm + local + parallel-engine); the guard only prevents the npm copy's `setup()`/`server()` from activating. (Project `opencode.json` with `"plugin": []` does NOT disable globally-configured plugins — the arrays merge — so a config-level fix is not possible.)

On load the plugin:

1. **Load superpowers** via `import("superpowers")` with graceful degradation; `loadSuperpowers()` resolves both halves (`server` for V1, `setup` for V2)
2. **Register skills** from `skills/` (V1: `config.skills.paths`; V2: per-skill `ctx.skill.transform` with frontmatter parsing)
3. **Register MCP servers** (V1: `config.mcp` with `enabled`; V2: `ctx.mcp.transform` with the `enabled` key stripped). User config takes precedence (won't override existing)
4. **Merge hooks** from superpowers + parallel execution engine (V1)
5. **Provision Python venv** at `~/.venvs/omagents`, auto-installs `jinja2` (V1: on `session.created`; V2: at plugin setup, non-blocking). Uses `node:child_process`, runs once per process
6. **Inject PATH** via shell hook: venv bin + skill script dirs + existing PATH (deduped)

Key variables:
- `OMAGENTS_DIR` = project root (parent of `.opencode/`)
- `SKILLS_DIR` = `OMAGENTS_DIR/skills`
- `AGENT_VENV` = `~/.venvs/omagents`
- `AGENT_PYTHON` = `~/.venvs/omagents/bin/python`
- `SKILL_SCRIPT_DIRS` = script directories from deep-research, markitdown-converter, playwright-web-scraping, _shared

## Parallel Execution Engine (`.opencode/plugins/parallel.js`)

The parallel execution engine:

- **V1**: intercepts `task` tool calls with `background: true`; auto-enables background subagents by writing `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` to shell config
- **V2**: intercepts native `subagent` tool calls with `background: true` (no env var needed); the child session ID comes from the tool result's structured `metadata.sessionID` (text parsing as fallback); completion notices arrive as synthetic `<subagent sessionID="..." state="...">` user messages scanned by the `context` hook; `session.idle` / `session.execution.{succeeded,failed,interrupted}` events are the fallback/reconcile path; cancel uses `ctx.session.interrupt`
- Maintains Job Board (`Map<taskID, JobRecord>`), persisted to `~/.local/share/opencode/storage/omagents/job-board.json`
- Injects Job Board status into LLM context (V1: `experimental.chat.messages.transform`; V2: `ctx.session.hook("context")`); sentinel-guarded against double injection
- Injects parallel execution system prompt (V1: `experimental.chat.system.transform` with `task(...)`; V2: `event.system` with `subagent(...)`)
- Provides custom tools: `parallel_status`, `cancel_task`
- Registers `/ps` command (V1: `config.command`; V2: `ctx.command.transform`, skipped if the user defined their own `ps`)
- Writes TUI state to `~/.local/share/opencode/storage/omagents/tui-state.json`
- Its default export is a `{ id, server, setup }` descriptor too (V2 auto-discovery requires object defaults); `setup` is a deliberate no-op — the real wiring is done by `index.js` via the named exports

## MCP Servers

Registered automatically (V1: `config` hook; V2: `ctx.mcp.transform`). User config takes precedence (won't override existing).

| MCP | Type | Config |
|-----|------|--------|
| `agentmemory` | local | `npx -y @agentmemory/mcp` |
| `codegraph` | local | `npx -y @colbymchenry/codegraph serve --mcp` |
| `context7` | remote | `https://mcp.context7.com/mcp` |
| `websearch` | remote | `https://mcp.exa.ai/mcp` |
| `github` | remote | `https://api.githubcopilot.com/mcp/` (requires `GITHUB_TOKEN`) |
| `grep_app` | remote | `https://mcp.grep.app` (fallback when no `GITHUB_TOKEN`) |

## Skills

### OmAgents Skills (18)

| Skill | Description | Has scripts? | Has agents/? | Loop? |
|-------|-------------|-------------|-------------|-------|
| `deep-research` | Multi-source iterative research with items x fields, gap detection, Jinja2 reports | Yes (6 Python files) | Yes | Yes (loop_engine + gap loop) |
| `parallel-execution` | Background task dispatch with Job Board tracking | No | No | No |
| `agents-python-tools` | Route Python tooling to `~/.venvs/omagents` | No | Yes | No |
| `markitdown-converter` | Convert documents (PDF/DOCX/XLSX/...) to Markdown | Yes | Yes | No |
| `officecli` | Create, analyze, proofread, and modify Office documents (.docx, .xlsx, .pptx) via officecli | No | No | No |
| `playwright-web-scraping` | Web scraping with Playwright headless browser | Yes | Yes | No |
| `init-deep` | Auto-generate hierarchical AGENTS.md files | No | Yes | No |
| `doctor` | Diagnose OmAgents installation and configuration | No | Yes | No |
| `remove-ai-slops` | Clean up AI-generated code artifacts | No | Yes | Yes (loop_engine) |
| `remove-deadcode` | Find and remove unreferenced code | No | Yes | Yes (loop_engine) |
| `github-triage` | Triage and categorize GitHub issues | No | Yes | Yes (loop_engine) |
| `tech-debt-audit` | Audit codebase for technical debt | No | Yes | Yes (loop_engine) |
| `lsp-guide` | Guide agents to use the right code intelligence tool | No | Yes | No |
| `ast-grep` | AST-aware code search and rewrite | No | Yes | Optional (loop for refactor mode) |
| `work-with-pr` | PR lifecycle management with github MCP | No | Yes | No |
| `pre-publish-review` | Pre-publish release gate checklist | No | Yes | Yes (loop_engine) |
| `hyperplan` | Adversarial plan review with 3 parallel critics | No | Yes | Yes (loop_engine + parallel) |
| `refactor` | Systematic code refactoring with verification | No | Yes | Yes (loop_engine) |

### Superpowers Skills (15, bundled via dependency)

brainstorming, test-driven-development, systematic-debugging, writing-plans, executing-plans, requesting-code-review, receiving-code-review, using-git-worktrees, verification-before-completion, writing-skills, subagent-driven-development, dispatching-parallel-agents, finishing-a-development-branch, using-superpowers, diagnosing-superpowers

## Python Venv

**IMPORTANT - Common mistake:** Only `jinja2` is auto-installed by the plugin. Other tools (markitdown, playwright, etc.) are installed ON-DEMAND by their respective skills when first needed. Do NOT claim they are "pre-installed".

- Agent tools venv: `~/.venvs/omagents` (managed by plugin + agents-python-tools skill)
- Project deps venv: `<project-root>/.venv` (managed by the project, never mixed)

The `agents-python-tools` skill has full documentation on venv paths, cross-platform paths, and decision rules. Do not duplicate that information elsewhere - reference the skill instead.

## How to Add a New Skill

1. Create `skills/<skill-name>/SKILL.md` with YAML frontmatter:
   ```yaml
   ---
   name: <skill-name>
   description: "<short description for when to trigger>"
   ---
   ```
2. Optionally add:
   - `scripts/` directory for helper scripts (Python, shell)
   - `agents/openai.yaml` for agent display name
3. If the skill has scripts, add the script directory to `SKILL_SCRIPT_DIRS` in `.opencode/plugins/index.js`
4. The skill is auto-discovered via `config.skills.paths` - no other registration needed

## Loop Engine

Skills that process items iteratively (remove-ai-slops, remove-deadcode, github-triage, tech-debt-audit) use a shared loop engine at `skills/_shared/scripts/loop_engine.py`.

The loop engine provides a durable task queue stored in `.omagents/loops/<skill>/tasks.json` within the project directory. State survives context clearing and can be resumed.

**Commands:**

| Command | Usage |
|---------|-------|
| `init <skill> '<tasks_json>'` | Initialize task queue |
| `next <skill>` | Get next pending task (outputs JSON or `null`) |
| `complete <skill> <id> [result]` | Mark task complete |
| `fail <skill> <id> [error]` | Mark task failed (retries up to 3 times, then blocked) |
| `status <skill>` | Print stats (total/completed/pending/blocked) |
| `summary <skill>` | Print full task list with icons |
| `reset <skill>` | Clear task queue |
| `add <skill> '<task_json>'` | Add a task to existing queue |

**Task state machine:** `pending` -> (execute) -> `completed` (success) or `pending`/retry (fail, attempts < 3) or `blocked` (fail, attempts >= 3)

## Development

- **No build step.** Plugin code is plain JavaScript (ESM). Skills are plain Markdown + optional Python.
- **Syntax check:** `node --check .opencode/plugins/index.js`
- **Python check:** `python3 -m py_compile skills/deep-research/scripts/*.py`
- **Unit tests:** `node --test tests/*.test.js` (plugin structure, skills frontmatter, loop engine workflow)
- **Local testing:** Point OpenCode config to local clone:
  ```json
  { "plugin": ["omagents@git+file:///path/to/omagents"] }
  ```

## CI/CD

- **CI** (`ci.yml`): Syntax check JS + Python on push/PR to main. Node 24.
- **Publish** (`publish.yml`): OIDC trusted publishing on `v*` tag push. No npm token needed.

## Publishing

Follow these steps **in order** to publish a new release:

1. **Bump version** in `package.json` (e.g. `"version": "0.4.2"`).
2. **Update CHANGELOG.md** — add a new `## [x.y.z] - YYYY-MM-DD` section at the top with the changes.
3. **Commit and tag**:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "release: vX.Y.Z"
   git tag vX.Y.Z
   ```
4. **Push and create GitHub release**:
   ```bash
   git push && git push --tags
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(awk '/^## \[X.Y.Z\]/{f=1} f; /^## \[/{if(f&&!first){exit} first=1}' CHANGELOG.md) --verify-tag
   ```
   The release notes are extracted from the corresponding CHANGELOG.md section for this version (replace `X.Y.Z` with the actual version numbers, escaping `.` as needed).

The tag push triggers `publish.yml` which auto-publishes to npm via OIDC. GitHub release must be created manually (it is NOT automated in the workflow).

## Dependencies

| Dependency | Type | Version |
|-----------|------|---------|
| `superpowers` | git (pinned to commit) | 6.4.2 (`8ca22dba`) |
| `prettier` | dev | ^3.9.9 |

**superpowers is pinned to a specific commit** to prevent breaking changes from upstream main branch. To update, change the commit SHA in `package.json`, run `npm install`, and verify. Note: superpowers >= 6.4 exports a V2 descriptor object as `default`; the V1 plugin function is `default.server` (also the named export `SuperpowersPlugin`). `loadSuperpowers()` in `.opencode/plugins/index.js` handles both shapes.

## Version History

| Version | Tag | Key changes |
|---------|-----|-------------|
| 0.1.0 | - | Initial release |
| 0.1.1 | - | Scoped package, bundle superpowers, OIDC auto-publish |
| 0.1.2 | v0.1.2 | OIDC trusted publishing fix |
| 0.1.3 | - | Node 24, CI upgrades |
| 0.1.4 | v0.1.4 | Version bump |
| 0.2.1 | v0.2.1 | Loop engine, 12 new skills, Job Board persistence + isolation, compaction hook, multilingual README, project governance |
| 0.9.0 | v0.9.0 | superpowers 6.1.1 -> 6.4.2 (V2 export compat fix), prettier ^3.9.9, lock file sync |
| 0.9.1 | v0.9.1 | Fix: move OpenCode setup script out of auto-discovered `.opencode/plugins/` (startup crash in this repo); gitignore host-generated SDK artifacts |
| 0.9.2 | v0.9.2 | Fix: package `main` back to plugin entry — CLI wrapper as `main` made `opencode run` exit(1) on plugin load (0.7.0–0.9.1) |
| 0.10.0 | v0.10.0 | OpenCode 2.x support: dual V1/V2 plugin entry (`{ id, server, setup }`), V2 wiring for skills/MCPs/tools/hooks, parallel engine on native `subagent` tool, hook idempotency fixes |

## Design Principles

1. **Prefer loop engineering over one-shot prompts.** When a skill involves processing multiple items (files, issues, categories, tasks), use the shared `loop_engine.py` to manage state. This provides durability (survives context clearing), retry logic, and a unified summary. Don't write a skill that says "scan everything and fix it" -- instead, build a task queue, process one item at a time, verify, and record the result.
2. **Infrastructure, not methodology.** OmAgents provides tools and capabilities. Development methodology (OpenSpec, gstack, etc.) is the user's choice. Don't bundle methodology into the plugin.
3. **Don't duplicate what the host provides.** OpenCode has LSP, edit tools, and search. Don't bundle alternatives. Instead, write skills that guide agents to use the right tool at the right time.
4. **Pin dependencies.** Superpowers is pinned to a commit. Don't unpin without testing.
5. **Keep README in sync with all languages.** README.md exists in 4 languages: English (README.md), Simplified Chinese (README.zh-cn.md), Japanese (README.ja.md), Korean (README.ko.md). Any change to README.md MUST be reflected in all language versions in the same commit. If a translation cannot be completed immediately, add `<!-- TODO: sync with README.md -->` at the top of the untranslated file.
6. **Analyze README impact on every change.** Before committing any change, ask: "Does this change affect what users see in README?" If yes -- new skill added, feature changed, installation steps modified, architecture updated -- update README.md (and all language versions) in the same commit. Don't let README go stale.
7. **Cross-platform compatibility.** Every code change must work on Linux, macOS, and Windows. Specifically:
   - **Venv paths**: Use `Scripts` on Windows, `bin` on Unix. Detect with `process.platform === "win32"`.
   - **Python command**: Use `python` on Windows, `python3` on Unix.
   - **PATH separator**: Use `;` on Windows, `:` on Unix.
   - **No bash-only scripts**: Hooks and helper scripts must be Node.js (`.js`), not bash (`.sh`). Use `node` to execute them.
   - **File paths**: Always use `path.join()` / `path.resolve()`, never hardcode `/` or `\\`.
   - **Executables**: On Windows, Python/pip executables have `.exe` extension (e.g., `python.exe`, `pip.exe`).

## Common Mistakes to Avoid

1. **Don't reference `templates/` as a root-level directory.** Templates are in `skills/deep-research/templates/`.
2. **Don't claim tools are "pre-installed".** Only `jinja2` is auto-installed. Others are on-demand.
3. **Don't duplicate venv path info.** The `agents-python-tools` skill covers this. Reference it.
4. **Don't unpin superpowers.** It's pinned to a commit for stability.
5. **Don't add `templates/` to project structure diagrams.** It doesn't exist at root.
6. **Don't forget `.opencode/` has its own `.gitignore`** that excludes `node_modules`, `package.json`, and `package-lock.json`. OpenCode itself auto-generates these (it installs the `@opencode-ai/plugin` SDK into `.opencode/` when loading project plugins) — they are host artifacts and must not be committed.
7. **Don't confuse bundled skills with superpowers skills.** OmAgents has 18; superpowers has 15. They're registered separately.
8. **Don't change README.md without updating all language versions.** README exists in 4 languages (EN, ZH-CN, JA, KO). All must be updated in the same commit.
9. **Don't commit without checking README impact.** If your change adds a skill, changes a feature, or modifies installation steps, update README first.
10. **Don't put non-plugin scripts in `.opencode/plugins/`.** OpenCode auto-discovers and loads EVERY `.js` file in the project's `.opencode/plugins/` directory as a plugin, calling exported functions. A CLI script there (this broke startup when developing in this repo — see v0.9.1) crashes plugin init. CLI entry scripts live in `setup/` instead; only true plugin files belong in `.opencode/plugins/`.
11. **Don't point package `main` at the CLI wrapper.** OpenCode imports the plugin via `main`; module-level `process.argv` dispatch (plus `process.exit`) in that file kills the host process (this broke `opencode run` for npm installs of 0.7.0–0.9.1 — see v0.9.2). `main` must be the plugin entry (`.opencode/plugins/index.js`); only `bin` may point at the CLI wrapper.
12. **Don't export a bare function as `default` from `.opencode/plugins/*.js`.** OpenCode V2 requires the default export to be a `{ id, setup }` descriptor object and hard-fails the plugin otherwise (`PluginModule.LoadError`). Keep the dual shape `{ id, server, setup }`: `server` is the V1 plugin function, `setup` the V2 one. V1 hosts may invoke exported functions (including `setup`) with a V1-shaped ctx — guard V2 entry points by checking V2-only domains (e.g. `typeof ctx.session?.hook === "function"`) and return quietly.
13. **Don't import `@opencode/plugin` (V2 SDK) or `@opencode-ai/plugin` (V1 SDK) in plugin code.** The dual entry point is a plain object; importing a host SDK package breaks the other runtime. superpowers does the same.
