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
│   ├── .gitignore              # Ignores node_modules, package.json, etc.
│   ├── package.json            # @opencode-ai/plugin SDK dependency
│   └── plugins/
│       ├── index.js            # Plugin entry point (merges superpowers + omagents hooks)
│       └── parallel.js         # Parallel execution engine (607 lines)
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
│   └── playwright-web-scraping/# Web scraping with Playwright
│       ├── SKILL.md
│       └── scripts/
├── package.json                # superpowers as git dependency (pinned to commit)
├── package-lock.json
├── CHANGELOG.md
├── CONTRIBUTING.md
├── README.md
└── LICENSE
```

**IMPORTANT:** There is NO root-level `templates/` directory. Jinja2 templates live in `skills/deep-research/templates/`.

## Plugin Entry Point (`.opencode/plugins/index.js`)

The plugin does the following on load:

1. **Load superpowers** via `import("superpowers")` with graceful degradation
2. **Register skills** from `skills/` directory via `config.skills.paths`
3. **Register MCP servers** (see below)
4. **Merge hooks** from superpowers + parallel execution engine
5. **Provision Python venv** at `~/.venvs/omagents` on `session.created`, auto-installs `jinja2`
6. **Inject PATH** via `shell.env` hook: venv bin + skill script dirs + existing PATH

Key variables:
- `OMAGENTS_DIR` = project root (parent of `.opencode/`)
- `SKILLS_DIR` = `OMAGENTS_DIR/skills`
- `AGENT_VENV` = `~/.venvs/omagents`
- `AGENT_PYTHON` = `~/.venvs/omagents/bin/python`
- `SKILL_SCRIPT_DIRS` = script directories from deep-research, markitdown-converter, playwright-web-scraping

## Parallel Execution Engine (`.opencode/plugins/parallel.js`)

The parallel execution engine (607 lines):

- Intercepts `task` tool calls with `background: true`
- Maintains in-memory Job Board (`Map<taskID, JobRecord>`)
- Injects Job Board status into LLM context via `experimental.chat.messages.transform`
- Injects parallel execution system prompt via `experimental.chat.system.transform`
- Auto-enables background subagents by writing `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` to shell config
- Provides custom tools: `parallel_status`, `cancel_task`
- Registers `/ps` command
- Writes TUI state to `~/.local/share/opencode/storage/omagents/tui-state.json`

**Known limitations:**
- Job Board is in-memory only (lost on restart)
- Job Board injects ALL sessions' jobs into every session (cross-session leak)

## MCP Servers

Registered automatically via `config` hook. User config takes precedence (won't override existing).

| MCP | Type | Config |
|-----|------|--------|
| `agentmemory` | local | `npx -y @agentmemory/mcp` |
| `codegraph` | local | `npx -y @colbymchenry/codegraph serve --mcp` |
| `context7` | remote | `https://mcp.context7.com/mcp` |
| `websearch` | remote | `https://mcp.exa.ai/mcp` |
| `github` | remote | `https://api.githubcopilot.com/mcp/` (requires `GITHUB_TOKEN`) |
| `grep_app` | remote | `https://mcp.grep.app` (fallback when no `GITHUB_TOKEN`) |

## Skills

### OmAgents Skills (17)

| Skill | Description | Has scripts? | Has agents/? | Loop? |
|-------|-------------|-------------|-------------|-------|
| `deep-research` | Multi-source iterative research with items x fields, gap detection, Jinja2 reports | Yes (6 Python files) | Yes | Yes (loop_engine + gap loop) |
| `parallel-execution` | Background task dispatch with Job Board tracking | No | No | No |
| `agents-python-tools` | Route Python tooling to `~/.venvs/omagents` | No | Yes | No |
| `markitdown-converter` | Convert documents (PDF/DOCX/XLSX/...) to Markdown | Yes | Yes | No |
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

### Superpowers Skills (14, bundled via dependency)

brainstorming, test-driven-development, systematic-debugging, writing-plans, executing-plans, requesting-code-review, receiving-code-review, using-git-worktrees, verification-before-completion, writing-skills, subagent-driven-development, dispatching-parallel-agents, finishing-a-development-branch, using-superpowers

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
- **Local testing:** Point OpenCode config to local clone:
  ```json
  { "plugin": ["omagents@git+file:///path/to/omagents"] }
  ```
- **No tests yet** - only syntax checks in CI. (Planned: add unit tests in P2)

## CI/CD

- **CI** (`ci.yml`): Syntax check JS + Python on push/PR to main. Node 24.
- **Publish** (`publish.yml`): OIDC trusted publishing on `v*` tag push. No npm token needed.
- **Publishing:** `npm version patch && git push && git push --tags`

## Dependencies

| Dependency | Type | Version |
|-----------|------|---------|
| `superpowers` | git (pinned to commit) | 6.1.1 (`d884ae04`) |
| `@opencode-ai/plugin` | dev (in `.opencode/`) | 1.17.16 |

**superpowers is pinned to a specific commit** to prevent breaking changes from upstream main branch. To update, change the commit SHA in `package.json`, run `npm install`, and verify.

## Version History

| Version | Tag | Key changes |
|---------|-----|-------------|
| 0.1.0 | - | Initial release |
| 0.1.1 | - | Scoped package, bundle superpowers, OIDC auto-publish |
| 0.1.2 | v0.1.2 | OIDC trusted publishing fix |
| 0.1.3 | - | Node 24, CI upgrades |
| 0.1.4 | v0.1.4 | Version bump |

## Design Principles

1. **Prefer loop engineering over one-shot prompts.** When a skill involves processing multiple items (files, issues, categories, tasks), use the shared `loop_engine.py` to manage state. This provides durability (survives context clearing), retry logic, and a unified summary. Don't write a skill that says "scan everything and fix it" -- instead, build a task queue, process one item at a time, verify, and record the result.
2. **Infrastructure, not methodology.** OmAgents provides tools and capabilities. Development methodology (OpenSpec, gstack, etc.) is the user's choice. Don't bundle methodology into the plugin.
3. **Don't duplicate what the host provides.** OpenCode has LSP, edit tools, and search. Don't bundle alternatives. Instead, write skills that guide agents to use the right tool at the right time.
4. **Pin dependencies.** Superpowers is pinned to a commit. Don't unpin without testing.

## Common Mistakes to Avoid

1. **Don't reference `templates/` as a root-level directory.** Templates are in `skills/deep-research/templates/`.
2. **Don't claim tools are "pre-installed".** Only `jinja2` is auto-installed. Others are on-demand.
3. **Don't duplicate venv path info.** The `agents-python-tools` skill covers this. Reference it.
4. **Don't unpin superpowers.** It's pinned to a commit for stability.
5. **Don't add `templates/` to project structure diagrams.** It doesn't exist at root.
6. **Don't forget `.opencode/` has its own `.gitignore`** that excludes `node_modules`, `package.json`, etc. Those are not committed.
7. **Don't confuse bundled skills with superpowers skills.** OmAgents has 5; superpowers has 14. They're registered separately.
