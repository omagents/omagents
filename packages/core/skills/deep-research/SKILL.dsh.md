---
name: deep-research
description: "Run a multi-source, iterative deep research workflow using structured items × fields and produce a Markdown report with native DSH subagents."
---

# DSH Deep Research

Conduct iterative, multi-source research and produce a cited Markdown report. Use the structured items × fields plan, durable loop queues, parallel native DSH research children, and automatic gap detection.

## When to Use

- The request needs more than a quick answer or a single web search.
- Evidence spans web pages, repositories, and/or the local codebase.
- Independent research lanes, resumable checkpoints, and a final audited report are useful.

## DSH Resources and Tools

The native skill result supplies this skill's absolute base directory. Call it `<skill-dir>` and resolve every referenced resource against it. Do not assume any skill script is on `PATH`.

- `<python>` is the persistent base interpreter from `agents-python-tools` (`~/.venvs/omagents/bin/python` on Unix; `Scripts/python.exe` in the base on Windows).
- Run the CLI as `<python> <skill-dir>/scripts/deep_research.py`.
- Run the durable queue as `<python> <skill-dir>/../_shared/scripts/loop_engine.py`.
- Only `jinja2` is provisioned automatically. Other Python packages remain on demand through `agents-python-tools`.

Use DSH 0.2.2's actual tool names. `OMAGENTS_SEARCH_PROVIDER` selects `auto` (the default when `OMAGENTS_SEARCH_PROVIDER` is unset or empty), `exa`, `keenable`, or `youcom`. Explicit providers use only their own direct tools. In `auto`, OmAgents registers a local stdio `websearch` Search MCP Proxy; use only its generic search/fetch tools for the web route.

| Evidence source | Native tools |
|-----------------|--------------|
| Web with auto Proxy | `mcp__websearch__search`, then `mcp__websearch__fetch` for selected sources |
| Web with explicit Exa | `web_search`, then `web_fetch` for selected sources |
| Web with explicit Keenable | `mcp__keenable__search_web_pages`, then `mcp__keenable__fetch_page_content` for selected sources |
| Web with explicit You.com | `mcp__youdotcom__you-search`, then `mcp__youdotcom__you-extract` for selected sources |
| GitHub MCP | `mcp__github__search_code`, `mcp__github__search_issues`, `mcp__github__search_pull_requests`, `mcp__github__list_releases` |
| Codegraph MCP | `mcp__codegraph__codegraph_explore` |
| Local code | `grep`, `glob`, `read` |
| Shell and file output | `bash`, `write` |
| Delegation | `subagent` with `description`, `prompt`, and optional `cwd` |
| Status and cancellation | `parallel_status`, `cancel_task` |

### Auto Proxy routing and evidence

The Proxy follows Exa → Keenable → You.com and programmatically makes at most one attempt per eligible position, advancing only after a fallback-eligible failure at that position: transport/session failures, timeouts, MCP protocol or malformed responses, HTTP 408/429/5xx, explicit temporary/rate-limit/retryable failures, or an otherwise unclassified backend `isError`. A valid success, including zero search hits, never falls back. Local validation, backend tool/page HTTP 400/401/403/404/422, known authentication, authorization, invalid-parameter, and permission failures, `Retryable: no`, caller cancellation, stdin closure, and shutdown stop the chain without another provider attempt. After a fallback-eligible Exa failure, every later call in the same Proxy process uses Keenable → You.com → Exa until the Proxy is recreated; this memory-only state has no cooldown or persistence. The model must not implement its own fallback. In auto, do not use direct Exa, direct Keenable, or direct You.com tools.

Read the actual response's prepended `Provider: exa|keenable|youcom` and optional `Fallback: <from> failed (<code>)` lines, or `_meta.omagents.provider`, `_meta.omagents.fallback`, and `_meta.omagents.fallbacks`, for provider/fallback evidence; do not infer the backend from configuration. A You.com success after two eligible failures carries ordered two-fallback history in `fallbacks`. When all three providers fail, the error identifies every attempted provider in route order with bounded, redacted failure categories.

Only calls through the OmAgents-registered Proxy have this failover guarantee. Host-native web tools and a user-overridden `websearch` server are not wrapped and are outside automatic failover. Report credential presence only; never print API key values or authorization headers, and do not replace redacted Proxy errors with raw backend payloads. Automatic routing can disclose the same query, optional `objective`, or target URL to Exa, Keenable, and You.com as eligible provider attempts occur; You.com does not natively receive `objective`. Select an explicit provider when that disclosure is unacceptable.

`websearch`, `github`, and `codegraph` remain internal plan configuration values; they are not tool invocations.

## Storage Layout

`--workspace` is the **public deliverable directory**. It contains only `report.md`, optional promoted Markdown deliverables, and the generated `README.md`. A new run is rejected before writes if the workspace would contain `.omagents/deep-research/` or `.omagents/loops/` (including the default project-root workspace). Select a separate child workspace such as `research/topic`.

Each new run keeps internal state beneath `.omagents/deep-research/<run-id>/` under the invocation project root:

- `plan.json`, `pre_research.json`, optional `pre_research_curated.json`, `findings/`, and `pre_findings/` are durable inputs and evidence.
- `state/` holds resume checkpoints.
- `artifacts/` holds retained, rebuildable derivatives.
- `logs/provenance.jsonl` is the append-only phase log.
- Queue keys are `deep-research-<run-id>` and `deep-research-pre-<run-id>` under `.omagents/loops/`.

The run ID is `<slug>-<digest>`. The digest input is the absolute workspace path relative to the resolved project root when possible (otherwise the absolute path), encoded with POSIX separators. SHA-256 that UTF-8 value and take the first eight lowercase hex characters. The slug uses NFKD normalization, ASCII removal, lowercasing, and non-alphanumeric runs replaced by hyphens; `research` is the fallback. Runs therefore survive project relocation and same-named workspaces in different directories remain independent.

Dispatch JSON supplies absolute `findings_dir`, `pre_findings_dir`, `output_path`, `output_path_quoted`, and `shell` (`posix` or `powershell`). Always use those values rather than reconstructing paths. Cross-run evidence reuse is explicit input only; never share writable evidence between runs.

Existing legacy workspaces retain their original files and unnamespaced `deep-research` / `deep-research-pre` queue keys. Resume them in place. Never migrate or delete them automatically.

## Full Pipeline

Start from the project root:

```bash
<python> <skill-dir>/scripts/deep_research.py run-all \
  --query "AI agent frameworks" \
  --template comparison \
  --workspace research/agent-frameworks
```

Resume the same lane after every agent-side pause:

```bash
<python> <skill-dir>/scripts/deep_research.py run-all \
  --resume --workspace research/agent-frameworks
```

The orchestrator emits absolute resume instructions as well. `--skip-pre-research` exists but is not recommended because the landscape scan prevents stale plan items. `status --workspace <dir>` reports the checkpoint and next action.

### Phase 0: Landscape Scan

Pre-research is mandatory by default.

1. The orchestrator initializes the run-scoped pre-research queue and emits `pre_research_search` JSON.
2. Follow the actual instruction's provider route: with auto, use `mcp__websearch__search` and then `mcp__websearch__fetch`; with explicit Exa, use `web_search` and then `web_fetch`; with explicit Keenable, use `mcp__keenable__search_web_pages` and then `mcp__keenable__fetch_page_content`; with explicit You.com, use `mcp__youdotcom__you-search` and then `mcp__youdotcom__you-extract`. Include the supplied current year/date and extract current real candidates, vendors, source URLs, and a landscape summary. In auto, the Proxy—not the model—owns any fallback.
3. Write the requested schema to the exact `output_path`; use `output_path_quoted` in shell commands.
4. Resume. Evaluation can add targeted searches until coverage is sufficient or `max_pre_research_loops` is reached.
5. Finalization writes internal `pre_research.json` and planning begins.

The pre-research schema is:

```json
{
  "task_id": "pre-1",
  "focus": "...",
  "candidates": [{"name": "...", "vendor": "...", "note": "...", "source": "https://..."}],
  "sources": ["https://..."],
  "summary": "Brief overview of the current landscape"
}
```

### Phase 1: Plan and Confirm

Planning creates internal `plan.json` with `query`, `items`, `fields`, `tasks`, and `config`. Pre-research candidates populate items automatically. Templates are `survey`, `comparison`, `technical`, and `custom`; comparison adds version/strengths/weaknesses/pricing fields, while technical adds architecture/API/performance fields.

Advanced standalone operations use the same CLI:

```bash
<python> <skill-dir>/scripts/deep_research.py plan --query "..." --template comparison --workspace research/topic
<python> <skill-dir>/scripts/deep_research.py add-items --workspace research/topic --items-json '[{"name":"LangGraph","type":"framework"}]'
<python> <skill-dir>/scripts/deep_research.py add-fields --workspace research/topic --fields-json '[{"name":"License","category":"Legal","required":false}]'
```

The orchestrator initializes `deep-research-<run-id>` from the planned tasks. Manual queue inspection uses:

```bash
<python> <skill-dir>/../_shared/scripts/loop_engine.py status deep-research-<run-id>
<python> <skill-dir>/../_shared/scripts/loop_engine.py next deep-research-<run-id>
<python> <skill-dir>/../_shared/scripts/loop_engine.py summary deep-research-<run-id>
```

### Phase 2: Translate Structured Dispatch to Native `subagent`

A single research pause emits an object with this contract:

```json
{
  "action": "dispatch_subagent",
  "description": "Research task-1",
  "prompt": "Complete self-contained research instructions and output schema",
  "name": "task-1",
  "cwd": "/absolute/project/root"
}
```

A batch pause has `action: "dispatch_subagents_batch"` and a `dispatches` array containing those same singular objects, alongside the legacy task/path metadata. For **every** singular object:

1. Call native `subagent` with `description` and `prompt`; pass `cwd` when present.
2. Start all independent entries in one batch concurrently. Native DSH delegation is asynchronous and needs no launch-mode argument.
3. Treat `name` as the research/loop correlation hint, not as a native tool argument.
4. Continue useful work while children run. Do not poll; native completion and the OmAgents Job Board deliver outcomes.

The prompt is self-contained because a child has its own context. It includes the research query, complete item details, every requested field's name/description/requirements, the absolute plan path, current date, task type, item and field IDs, run ID, absolute output path, findings schema, and absolute validation command. The structured `resume_command` uses absolute Python and CLI paths; `legacy_resume_command` is only backward-compatibility metadata. Each child must read current sources, cite URLs/repositories/files and dates, collect every field, mark uncertainty, write its JSON, validate it, and return a concise result.

Findings use this shape:

```json
{
  "type": "web",
  "task_id": "task-1",
  "item_id": "item-1",
  "field_ids": ["field-1"],
  "focus": "...",
  "iteration": 0,
  "findings": [
    {
      "source": "URL, repository, or file",
      "title": "...",
      "published_date": "YYYY-MM-DD or null",
      "field_data": {"field-1": "evidence"},
      "summary": "...",
      "key_quotes": ["..."],
      "relevance": "high",
      "uncertain": false
    }
  ],
  "gaps": []
}
```

After a child finishes, inspect its actual outcome and output. Do not infer success from inactivity. Only after findings exist and validation succeeds, record the loop result:

```bash
<python> <skill-dir>/../_shared/scripts/loop_engine.py complete deep-research-<run-id> task-1 "Sources found and validated"
```

On failure:

```bash
<python> <skill-dir>/../_shared/scripts/loop_engine.py fail deep-research-<run-id> task-1 "No usable findings"
```

To cancel a running lane, call `cancel_task` with its Job Board ID or alias. Acceptance enters `cancelling`; only native settlement confirms `cancelled`. Local interruption preserves descendants, and external one-shot children cannot resume. Never record a cancelled child as completed research.

When every task in the batch is settled and its queue result is recorded, resume the orchestrator. Two research workspaces can run concurrently: their run IDs, queues, checkpoints, findings, and public outputs stay independent.

### Phase 3: Gap Loop Resume

With no pending initial tasks, the orchestrator runs gap analysis automatically. It builds the item × field coverage matrix and writes internal `artifacts/gap_report.json`. If `should_continue` is true, it adds `new_tasks` to the **same run-scoped queue**, increments the checkpoint loop, and emits another structured dispatch.

Research and validate those gap tasks exactly like initial tasks, record completion/failure, and resume again. Repeat until no gaps remain or `max_research_loops` is reached. Never create a replacement run while resuming: a missing or unreadable checkpoint is an error.

Standalone inspection remains available:

```bash
<python> <skill-dir>/scripts/deep_research.py gaps --workspace research/topic
```

### Phases 4–7: Merge, Report, Polish, Audit, Package

The resumed state machine performs these phases automatically:

1. **Merge** combines findings into `artifacts/findings_merged.json`.
2. **Report** renders the selected Jinja2 template with citations and inline SVG charts.
3. **Polish** pauses with `polish_report` JSON. Read `artifacts/report_raw.md`, the plan context, and `<skill-dir>/prompts/polish_report.md`; rewrite a coherent narrative while preserving citations and SVG, then overwrite public `report.md` and resume.
4. **Audit** checks missing sources, conflicts, gaps, and duplicate sources into `artifacts/audit_report.json`.
5. **Package** writes `artifacts/package.json` and the public `README.md` index.

Standalone equivalents are `merge`, `report`, `polish`, `audit`, and `package`, all through `<python> <skill-dir>/scripts/deep_research.py ... --workspace <dir>`.

Templates live under `<skill-dir>/templates/`: `survey.md.tmpl`, `comparison.md.tmpl`, and `technical.md.tmpl`. Never create or reference a repository-root `templates/` directory.

Topic-specific Markdown drafts stay in internal `artifacts/`. Promote a finished document by writing it to `<workspace>/<name>.md`; the next package operation indexes it without rewriting its content. Legacy workspaces keep their original `artifacts/README.md` and root/artifact provenance fallback behavior.

## Completion Rules

- Search with the current date and cite original evidence for every claim.
- Keep independent lanes concurrent and write scopes separate.
- Use absolute orchestrator-supplied evidence paths and script paths.
- Resume from the same project root and workspace after each pause.
- Synthesize only after all required children reach authoritative outcomes.
- Keep uncertain values marked `[uncertain]` so gap analysis can detect them.
- Leave legacy storage untouched and optional Python packages on demand.
