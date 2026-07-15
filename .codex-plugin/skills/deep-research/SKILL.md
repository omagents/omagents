---
name: deep-research
description: "Run a multi-source, iterative deep research workflow using structured items × fields and produce a Markdown report."
---

# OpenCode Deep Research

Conduct iterative, multi-source research and produce a high-quality Markdown report.

This skill combines the **structured items × fields approach** (inspired by RhinoInsight and Weizhena's Deep Research skills) with the **dynamic gap-detection loop** from LangChain's Open Deep Research, while staying native to OpenCode's subagent and MCP infrastructure.

**Loop Engine:** Research task state is managed by the shared `loop_engine.py` (see `skills/_shared/scripts/loop_engine.py`). This provides durable state that survives context clearing, retry logic, and a unified summary across all loop-based skills.

## When to Use

- You need more than a quick answer — a structured, cited research report.
- The topic may span web sources, open-source repositories, and/or local code.
- You want parallel sub-investigations, automatic gap detection, and human-in-the-loop control.

## Dependencies

- Python 3.11+ (see agents-python-tools skill for venv setup)
- `jinja2` (install via the agents-python-tools skill)
- OpenCode's built-in web search, GitHub, and codegraph tools (or MCP equivalents)

## Sources Supported

| Source | Tools to Use |
|--------|--------------|
| Web | `websearch_web_search_exa`, `webfetch`, `websearch_web_fetch_exa` |
| GitHub | `github_search_code`, `github_search_issues`, `github_search_pull_requests`, `github_list_releases` |
| Codebase | `codegraph_codegraph_explore`, `grep`, `glob`, `read` |

## Commands

| Command | Phase | Description |
|---------|-------|-------------|
| `/research <topic>` | Plan | Generate a structured research plan with items, fields, and tasks. |
| `/research-add-items` | Confirm | Add more research objects to the plan. |
| `/research-add-fields` | Confirm | Add more research dimensions to the plan. |
| `/research-deep` | Research | Execute research tasks in parallel subagents, then run the gap loop. |
| `/research-report` | Report | Merge findings and generate the Markdown report (with inline SVG charts). |
| `/research-polish` | Polish | Prepare the raw report for LLM polishing (backup raw, output instructions). The agent then rewrites the report into coherent prose. |
| `/research-audit` | Audit | Run integrity audit on findings (missing sources, conflicts, gaps, duplicates). |
| `/research-package` | Package | Generate artifact package manifest and README index. |
| `/research-provenance` | Provenance | View provenance log (phase-level event timeline). |
| `/research-status` | Status | Check orchestration state and recommended next action. |
| `/research-run` | All | Run the full pipeline with pause/resume (pre-research -> plan -> dispatch -> gaps -> report -> polish -> audit -> package). |
| `/research-scan` | Pre-Research | Run pre-research landscape scan to identify current entities before planning. |

Under the hood these commands map to:

```bash
deep_research.py <subcommand> --workspace <workspace>
```

New subcommands: `audit`, `package`, `provenance`, `status`, `polish`, `run-all`, `scan`, `scan-next`, `scan-complete`, `scan-evaluate`, `scan-finalize`.

## Workflow

### Phase 0: Landscape Scan (Pre-Research)

**CRITICAL:** Before generating any plan, a pre-research landscape scan MUST run. This ensures research items are based on current, real-world data rather than potentially outdated model knowledge.

The pre-research phase uses the loop engine (skill key: `deep-research-pre`) to iteratively scan the web for current entities. The current date is automatically injected into all task descriptions and search instructions to ensure the agent searches for the most recent information.

1. **Initialize**: `pre_research.py init --query "..." --workspace <dir>` creates a broad search task. Task description includes the current date (e.g., "Current date: July 2026").
2. **Search**: Agent does web search (must include current year in queries), extracts candidates, writes to `pre_findings/<task_id>.json`.
3. **Evaluate**: `pre_research.py evaluate` checks if enough candidates/sources found. If not, adds targeted search tasks (also date-injected).
4. **Loop**: Repeat steps 2-3 until coverage is sufficient or `max_pre_research_loops` (default 2) is reached.
5. **Finalize**: `pre_research.py finalize` merges all pre-findings into `pre_research.json`.

`pre_research.json` format:
```json
{
  "query": "current top LLMs",
  "scanned_at": "2025-07-10T...",
  "summary": "Brief landscape overview",
  "candidates": [
    {"name": "DeepSeek-V4", "vendor": "DeepSeek", "note": "...", "source": "https://..."},
    {"name": "Kimi K2", "vendor": "Moonshot AI", "note": "...", "source": "https://..."}
  ],
  "sources": ["https://..."],
  "loops_completed": 2
}
```

This file feeds directly into Phase 1 to generate `items` from real candidates.

### Phase 1: Generate Plan (`/research <topic>`)

Generate a `plan.json` with:

- `query`: original question
- `items`: list of research objects (auto-populated from `pre_research.json` if available)
- `fields`: dimensions to collect for each item (template-aware: comparison gets version/strengths/weaknesses, technical gets architecture/API)
- `tasks`: parallel research tasks covering ALL items x fields (not just the first item)
- `config`: max loops, batch size, search tools, confidence weights, audit weights, etc.

Example:

```bash
deep_research.py plan \
  --query "AI agent frameworks" \
  --template comparison \
  --workspace agent-frameworks
```

If `pre_research.json` exists in the workspace, items are automatically generated from its candidates. You can also explicitly pass `--pre-research <path>`.

Config overrides:
```bash
deep_research.py plan \
  --query "..." \
  --template comparison \
  --max-loops 3 \
  --batch-size 5 \
  --search-tools websearch,github \
  --language zh \
  --workspace agent-frameworks
```

> `--workspace` is the output directory name. Use a slug of the research topic (lowercase, hyphenated, e.g. "AI Agent Frameworks" -> `ai-agent-frameworks`). It will be created in the current working directory.

After generating the plan, initialize the loop engine with the research tasks:

```bash
loop_engine.py init deep-research '[
  {"task_id": "task-1", "type": "web", "item_id": "item-1", "field_ids": ["field-1"], "focus": "...", "description": "Research LangGraph overview"},
  {"task_id": "task-2", "type": "github", "item_id": "item-2", "field_ids": ["field-2"], "focus": "...", "description": "Research AutoGPT license"}
]'
```

### Phase 2: Confirm and Refine (`/research-add-items`, `/research-add-fields`)

Review the generated plan. If items or fields are missing, add them:

```bash
deep_research.py add-items \
  --workspace agent-frameworks \
  --items-json '[{"name":"LangGraph","type":"framework","description":"LangChain agent framework"}]'

deep_research.py add-fields \
  --workspace agent-frameworks \
  --fields-json '[{"name":"License","category":"Legal","description":"Software license","required":false}]'
```

### Phase 3: Execute Research (`/research-deep`)

Managed by the loop engine. Get the next pending task, dispatch it as a subagent, and mark complete when done.

**Step 1: Get next task**

```bash
loop_engine.py next deep-research
```

If output is `null`, proceed to Phase 4 (gap detection).

**Step 2: Dispatch subagent**

For each task returned, launch a subagent using `task(background: true)`. Multiple `task` calls in one response execute simultaneously. Each subagent:

1. Searches the appropriate source (web, GitHub, or codebase).
2. Reads key sources.
3. Extracts data into `field_data` keyed by field IDs.
4. Writes findings to `<workspace>/findings/<task_id>.json` **using bash** (e.g. `cat > <path> << 'EOF' ... EOF`), not the `write` tool — subagent sessions run in a temporary working directory, so the `write` tool may trigger a confirmation dialog for paths outside it.
5. Runs validation.

Do not wait for all subagents to return before proceeding. Background task completions are automatically injected via the Background Job Board. When all tasks are done, proceed to Phase 4.

#### Web Research Subagent Prompt

```
You are a web research specialist. Research the following item and collect the specified fields.

Current date: {current_date}
IMPORTANT: Include the current year ({current_year}) in your search queries. Do NOT rely on your training data - it may be outdated. Search for the most recent sources available.

Item: {item_name}
Description: {item_description}
Fields to collect:
{for each field: "- {field_name} ({field_category}): {field_description} [required: {required}]"}
Focus: {task_focus}
Workspace: {workspace}

Instructions:
1. Use web_search to find relevant sources. Include the current year in queries.
2. For each promising source, use webfetch or websearch_web_fetch_exa to read it.
3. Extract data for EACH field listed above.
4. Mark uncertain values with [uncertain].
5. If information is missing or contradictory, do additional targeted searches (up to 3 iterations).
6. For each finding, record the publication date if available.
7. Write findings to {workspace}/findings/{task_id}.json. IMPORTANT: Use a bash
   command (e.g. `cat > {workspace}/findings/{task_id}.json << 'ENDOFFILE' ... ENDOFILE`)
   instead of the `write` tool - subagent sessions run in a temporary directory, so
   the `write` tool may trigger a confirmation dialog for paths outside it.
   Use this JSON schema:
   {
     "type": "web",
     "task_id": "{task_id}",
     "item_id": "{item_id}",
     "field_ids": [{field_ids}],
     "focus": "{task_focus}",
     "iteration": {iteration},
     "findings": [
       {
         "source": "URL",
         "title": "...",
         "published_date": "YYYY-MM-DD or null",
         "field_data": { "field-1": "data", "field-2": "data" },
         "summary": "...",
         "key_quotes": ["..."],
         "relevance": "high|medium|low",
         "uncertain": false
       }
     ],
     "gaps": ["..."]
   }
8. Validate:
   validate.py --plan {workspace}/plan.json --findings {workspace}/findings/{task_id}.json
```

GitHub and codebase subagents follow the same structure but use their respective tools.

**Step 3: Mark task complete**

When a subagent finishes and its findings are written and validated:

```bash
loop_engine.py complete deep-research <id> "Found 5 sources, coverage: high"
```

If the subagent fails (no findings, validation error):

```bash
loop_engine.py fail deep-research <id> "No web sources found for this item"
```

**Step 4: Loop**

Repeat from Step 1. When `next` returns `null`, all initial tasks are done. Proceed to Phase 4.

### Phase 4: Detect Gaps and Re-Research (Loop)

**Step 1: Run gap analysis**

```bash
deep_research.py gaps --workspace agent-frameworks
```

This builds an `item x field` coverage matrix, identifies missing or low-confidence coverage, and outputs `gap_report.json` with `new_tasks` and `should_continue`.

**Step 2: Add gap tasks to loop engine**

If `should_continue` is true, add each new task from the gap report:

```bash
loop_engine.py add deep-research '{"task_id": "task-r1-1", "type": "web", "item_id": "item-1", "field_ids": ["field-2"], "focus": "Supplemental research for LangGraph on field License", "description": "Gap fill: LangGraph License"}'
```

**Step 3: Loop back to Phase 3**

Return to Phase 3 to execute the new gap-fill tasks. The loop continues until:
- `next` returns `null` (all tasks complete), AND
- `should_continue` is false (no more gaps or `max_research_loops` reached)

**Step 4: Check final status**

```bash
loop_engine.py summary deep-research
```

When the loop is complete, proceed to Phase 5.

### Phase 5: Synthesize Report (`/research-report`)

```bash
deep_research.py merge --workspace agent-frameworks
deep_research.py report --workspace agent-frameworks
```

This produces `report.md` using the selected Jinja2 template (`survey`, `comparison`, or `technical`).

### Phase 5b: Polish Report (`/research-polish`)

The template-generated report is mechanically assembled and may feel stiff. This phase uses the LLM (the agent itself) to rewrite it into coherent prose.

```bash
deep_research.py report --polish --workspace agent-frameworks
# or standalone:
deep_research.py polish --workspace agent-frameworks
```

This will:
1. Generate the template-based report (if `--polish` is used with `report`)
2. Back up the raw report to `report_raw.md`
3. Output JSON instructions with plan context and the polish prompt file path

**The agent then:**
1. Reads `report_raw.md` and the plan context
2. Reads `prompts/polish_report.md` for instructions
3. Rewrites the report: merges "Supplemental" bullets into flowing prose, writes a real executive summary, ensures language consistency, keeps SVG charts and source citations
4. Saves the polished version to `report.md` (overwrite)
5. Continues to audit/package

In the `run-all` pipeline, this phase pauses automatically — the agent polishes, then resumes with `run-all --resume`.

## Data Schemas

### plan.json (v2)

```json
{
  "version": 2,
  "query": "AI agent frameworks",
  "context": "",
  "template": "comparison",
  "objectives": ["..."],
  "items": [
    {
      "id": "item-1",
      "name": "LangGraph",
      "type": "framework",
      "description": "LangChain's agent framework"
    }
  ],
  "fields": [
    {
      "id": "field-1",
      "name": "Overview",
      "category": "General",
      "description": "General description",
      "required": true,
      "detail_level": "moderate"
    }
  ],
  "tasks": [
    {
      "id": "task-1",
      "type": "web",
      "item_id": "item-1",
      "field_ids": ["field-1"],
      "focus": "...",
      "status": "pending",
      "iteration": 0
    }
  ],
  "config": {
    "max_research_loops": 2,
    "batch_size": 3,
    "items_per_agent": 1,
    "search_tools": ["websearch", "github", "codegraph"],
    "report_sections": ["executive_summary", "comparison_table", "detailed_findings", "cross_cutting_insights", "gaps", "sources"],
    "language": "auto",
    "max_pre_research_loops": 2,
    "min_pre_research_candidates": 5,
    "min_pre_research_sources": 3,
    "confidence_weights": {"source_count_high": 2, "relevance_high": 3, "cross_source_bonus": 1},
    "audit_weights": {"info": 0, "warning": 5, "error": 15, "critical": 30}
  },
  "metadata": {
    "created_at": "...",
    "updated_at": "...",
    "research_loops_completed": 0
  }
}
```

### findings JSON

```json
{
  "type": "web",
  "task_id": "task-1",
  "item_id": "item-1",
  "field_ids": ["field-1", "field-2"],
  "focus": "...",
  "iteration": 0,
  "findings": [
    {
      "source": "URL",
      "title": "...",
      "published_date": "YYYY-MM-DD or null",
      "field_data": { "field-1": "data", "field-2": "data" },
      "summary": "...",
      "key_quotes": ["..."],
      "relevance": "high",
      "uncertain": false
    }
  ],
  "gaps": ["..."]
}
```

### gap_report.json

```json
{
  "loop": 1,
  "coverage_matrix": { "item-1": { "field-1": { "covered": true, "sources": 2, "confidence": "high" } } },
  "overall_coverage": 0.75,
  "gaps": [
    { "item_id": "item-1", "field_id": "field-2", "reason": "no_findings", "severity": "high" }
  ],
  "new_tasks": [ { "id": "task-r1-1", "type": "github", "item_id": "item-1", "field_ids": ["field-2"], ... } ],
  "should_continue": true
}
```

## Report Templates

Templates live in `templates/`:

- `survey.md.tmpl` — general research report
- `comparison.md.tmpl` — side-by-side comparison
- `technical.md.tmpl` — architecture/implementation analysis

To use a template, set `plan.template` to `survey`, `comparison`, or `technical`.

## Report Format

The final `report.md` includes:

1. **Executive Summary** — main conclusions in 3–5 bullets
2. **Research Questions / Scope** — what was investigated
3. **Comparison Table** (for comparison template)
4. **Detailed Findings** — per item/field
5. **Cross-Cutting Insights** — source/relevance distribution and emerging themes
6. **Open Questions / Gaps** — remaining uncertainties
7. **Sources** — web URLs, GitHub repos, and local files

## SVG Charts

The report includes inline SVG charts (rendered by `scripts/svg_charts.py`):

| Chart | Description |
|-------|-------------|
| Coverage Heatmap | item x field grid, color-coded by confidence (green/yellow/red/gray) |
| Source Distribution Donut | web/github/codebase source proportion |
| Research Timeline | horizontal timeline of phase-level events (from provenance) |
| Comparison Radar | multi-dimensional radar chart (comparison template, 2+ items) |
| Confidence Bar Chart | high/medium/low/none confidence distribution |

SVG is embedded directly in Markdown. No external dependencies or JavaScript.

## Provenance

Every research workspace tracks phase-level events in `artifacts/provenance.jsonl`:

| Event | Trigger |
|-------|---------|
| `plan_created` | `plan.py` creates plan.json |
| `gap_detected` | `gap_analysis.py` detects gaps |
| `report_generated` | `synthesize.py` generates report.md |
| `audit_completed` | `audit.py` runs audit |

View with: `deep_research.py provenance --workspace <dir>`

Provenance is optional and backward-compatible. Old workspaces without provenance simply omit timeline charts.

## Integrity Audit

Run automated checks on research findings:

```bash
deep_research.py audit --workspace agent-frameworks
```

| Check | What it detects | Severity |
|-------|----------------|----------|
| `missing_sources` | Finding entries without source/url/file | warning |
| `conflicting_data` | Same field, different values from different sources | error |
| `coverage_gaps` | Required fields with no data | error |
| `source_duplicates` | Same source referenced by multiple tasks | warning |

Output: `artifacts/audit_report.json` with overall score (0-100) and recommendations. Results are also embedded in the Markdown report.

## Artifact Package

Generate a complete package manifest:

```bash
deep_research.py package --workspace agent-frameworks
```

Produces:
- `artifacts/package.json` - manifest with metadata, file list, and stats
- `artifacts/README.md` - quick index of all artifacts

Workspace structure:
```
<workspace>/
  pre_research.json       # Pre-research landscape scan results
  pre_findings/           # Pre-research search findings (per task)
  plan.json              # Research plan
  findings/              # Raw findings JSON from subagents
  artifacts/             # Intermediate/derived artifacts
    findings_merged.json # Merged findings
    gap_report.json      # Gap analysis results
    audit_report.json    # Integrity audit
    provenance.jsonl     # Provenance trail
    report_raw.md        # Pre-polish report backup
    package.json         # Package manifest
    README.md            # Quick index
  report.md              # Final deliverable: polished report (Markdown + SVG)
  summary.md             # Final deliverable: executive summary
```

## Run-All (Meta-Orchestration)

Run the full pipeline with pause/resume:

```bash
# First run
deep_research.py run-all --query "AI agent frameworks" --template comparison --workspace agent-frameworks

# After subagents complete
deep_research.py run-all --resume --workspace agent-frameworks
```

The orchestrator (`orchestrate.py`) is a pausable state machine:

0. **pre_research** - Iterative landscape scan via loop engine (pauses for agent searches)
1. **planning** - Creates plan.json from pre-research results, initializes loop_engine (automatic)
2. **dispatch** - Outputs batch JSON task instructions (up to `batch_size` tasks at once) for the agent to dispatch subagents (pauses)
3. **gap_analysis** - Runs gap detection with source-aware task types, adds new tasks if needed (automatic)
4. **merge** - Merges findings (automatic)
5. **report** - Generates report.md with SVG charts (automatic)
5b. **polish** - LLM polish (pauses)
6. **audit** - Runs integrity audit with configurable weights (automatic)
7. **package** - Generates artifact package (automatic)

The agent calls `--resume` after subagents complete. The state machine picks up from where it left off via `orchestration_state.json`.

To skip pre-research (not recommended): `--skip-pre-research`

Check status: `deep_research.py status --workspace <dir>`

## Tips for Best Results

- **Always include the current date in searches.** The pre-research and dispatch instructions automatically inject the current date. Never search without a year qualifier - your training data may be months out of date.
- **Always run pre-research.** The landscape scan ensures your research items are current. Skipping it risks researching outdated entities.
- Keep each research task focused. A task should answer one specific sub-question.
- Run independent tasks in parallel using `task(background: true)`. The orchestrator dispatches up to `batch_size` tasks at once.
- Always cite the original URL/repo/file for every claim. Include publication dates when available.
- If sources conflict, report both sides and explain which evidence is stronger. Prefer more recent sources.
- Use the gap loop aggressively - the first pass rarely tells the whole story. Gap tasks now pick the right source type based on field category.
- Mark uncertain values with `[uncertain]` so the gap analyzer can flag them.
- Use `--template comparison` for side-by-side comparisons (gets version/strengths/weaknesses fields automatically).
- Use `--template technical` for architecture analysis (gets architecture/API/performance fields automatically).
