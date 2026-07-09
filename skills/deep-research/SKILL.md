---
name: deep-research
description: "Run a multi-source, iterative deep research workflow using structured items × fields and produce a Markdown report."
---

# OpenCode Deep Research

Conduct iterative, multi-source research and produce a high-quality Markdown report.

This skill combines the **structured items × fields approach** (inspired by RhinoInsight and Weizhena's Deep Research skills) with the **dynamic gap-detection loop** from LangChain's Open Deep Research, while staying native to OpenCode's subagent and MCP infrastructure.

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
| `/research-report` | Report | Merge findings and generate the Markdown report. |

Under the hood these commands map to:

```bash
deep_research.py <subcommand> --workspace <workspace>
```

## Workflow

### Phase 1: Generate Plan (`/research <topic>`)

Generate a `plan.json` with:

- `query`: original question
- `items`: list of research objects
- `fields`: dimensions to collect for each item
- `tasks`: parallel research tasks (web/github/codebase)
- `config`: max loops, batch size, report sections, etc.

Example:

```bash
deep_research.py plan \
  --query "AI agent frameworks" \
  --template comparison \
  --workspace ./research/agent-frameworks
```

### Phase 2: Confirm and Refine (`/research-add-items`, `/research-add-fields`)

Review the generated plan. If items or fields are missing, add them:

```bash
deep_research.py add-items \
  --workspace ./research/agent-frameworks \
  --items-json '[{"name":"LangGraph","type":"framework","description":"LangChain agent framework"}]'

deep_research.py add-fields \
  --workspace ./research/agent-frameworks \
  --fields-json '[{"name":"License","category":"Legal","description":"Software license","required":false}]'
```

### Phase 3: Execute Research (`/research-deep`)

For each pending task, launch a subagent using `task(background: true)` so they run in parallel. Multiple `task` calls in one response execute simultaneously. Each subagent:

1. Searches the appropriate source (web, GitHub, or codebase).
2. Reads key sources.
3. Extracts data into `field_data` keyed by field IDs.
4. Writes findings to `<workspace>/findings/<task_id>.json`.
5. Runs validation.

Do not wait for all subagents to return before proceeding. Background task completions are automatically injected via the Background Job Board. When all tasks are done, proceed to Phase 4.

#### Web Research Subagent Prompt

```
You are a web research specialist. Research the following item and collect the specified fields.

Item: {item_name}
Description: {item_description}
Fields to collect:
{for each field: "- {field_name} ({field_category}): {field_description} [required: {required}]"}
Focus: {task_focus}
Workspace: {workspace}

Instructions:
1. Use websearch_web_search_exa to find relevant sources.
2. For each promising source, use webfetch or websearch_web_fetch_exa to read it.
3. Extract data for EACH field listed above.
4. Mark uncertain values with [uncertain].
5. If information is missing or contradictory, do additional targeted searches (up to 3 iterations).
6. Write findings to {workspace}/findings/{task_id}.json with schema:
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
         "field_data": { "field-1": "data", "field-2": "data" },
         "summary": "...",
         "key_quotes": ["..."],
         "relevance": "high|medium|low",
         "uncertain": false
       }
     ],
     "gaps": ["..."]
   }
7. Validate:
   validate.py --plan {workspace}/plan.json --findings {workspace}/findings/{task_id}.json
```

GitHub and codebase subagents follow the same structure but use their respective tools.

### Phase 4: Detect Gaps and Re-Research (Loop)

Automatically:

1. Run gap analysis:
   ```bash
   deep_research.py gaps --workspace ./research/agent-frameworks
   ```
2. Build an `item × field` coverage matrix.
3. Identify missing or low-confidence coverage.
4. Generate new tasks to fill gaps.
5. If `max_research_loops` is not reached, dispatch new subagents via `task(background: true)` and repeat.

### Phase 5: Synthesize Report (`/research-report`)

```bash
deep_research.py merge --workspace ./research/agent-frameworks
deep_research.py report --workspace ./research/agent-frameworks
```

This produces `report.md` using the selected Jinja2 template (`survey`, `comparison`, or `technical`).

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
    "language": "auto"
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
  "new_tasks": [ { "id": "task-r1-1", "type": "web", "item_id": "item-1", "field_ids": ["field-2"], ... } ],
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

## Tips for Best Results

- Keep each research task focused. A task should answer one specific sub-question.
- Run independent tasks in parallel using `task(background: true)`. Multiple calls in one response run simultaneously.
- Always cite the original URL/repo/file for every claim.
- If sources conflict, report both sides and explain which evidence is stronger.
- Use the gap loop aggressively — the first pass rarely tells the whole story.
- Mark uncertain values with `[uncertain]` so the gap analyzer can flag them.
