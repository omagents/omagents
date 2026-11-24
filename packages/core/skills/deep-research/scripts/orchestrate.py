#!/usr/bin/env python3
"""Meta-orchestration for deep-research: pausable state machine.

Runs all Python-side phases automatically and pauses only when
subagent dispatch is needed. The agent calls `--resume` after
subagents complete.

Phases:
  0. pre_research  - Iterative landscape scan (loop-based)
  1. plan          - Create plan.json from pre-research results
  2. dispatch      - Dispatch research subagents (pauses, batch-aware)
  3. gap_analysis  - Detect coverage gaps, add new tasks if needed
  4. merging       - Merge findings
  5. reporting     - Generate report.md
  5b. polishing    - LLM polish (pauses)
  6. auditing      - Integrity audit
  7. packaging     - Artifact package
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from layout import LayoutError, ResearchLayout

SKILL_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = SKILL_DIR / "scripts"
LOOP_ENGINE = SKILL_DIR.parent / "_shared" / "scripts" / "loop_engine.py"
PRE_RESEARCH_SCRIPT = SCRIPTS_DIR / "pre_research.py"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def command_arg(value: str | Path) -> str:
    if os.name == "nt":
        return "'" + str(value).replace("'", "''") + "'"
    return shlex.quote(str(value))


def shell_name() -> str:
    return "powershell" if os.name == "nt" else "posix"


def resume_command(layout: ResearchLayout) -> dict[str, Any]:
    """Return the canonical, PATH-independent machine-readable resume command."""
    return {
        "executable": sys.executable,
        "args": [
            str(SCRIPTS_DIR / "deep_research.py"),
            "run-all",
            "--resume",
            "--workspace",
            str(layout.workspace),
        ],
    }


def legacy_resume_command(layout: ResearchLayout) -> dict[str, Any]:
    """Retain the former metadata separately for older consumers."""
    return {
        "executable": "deep_research.py",
        "args": ["run-all", "--resume", "--workspace", str(layout.workspace)],
    }


def _current_date_string() -> str:
    """Return a human-readable current date for search context injection."""
    return datetime.now(timezone.utc).strftime("%B %Y")


def _current_year() -> str:
    """Return the current year as a string."""
    return str(datetime.now(timezone.utc).year)


def run_script(script_name: str, extra_args: list[str]) -> int:
    cmd = [sys.executable, str(SCRIPTS_DIR / script_name), *extra_args]
    return subprocess.run(cmd, check=False).returncode


def _run_capture(cmd: list[str]) -> str:
    """Run a command and return stdout."""
    result = subprocess.run(cmd, capture_output=True, encoding="utf-8", check=False)
    return result.stdout.strip()


def state_path(layout: ResearchLayout) -> Path:
    return layout.orchestration_state_path


def load_state(layout: ResearchLayout) -> dict[str, Any] | None:
    path = state_path(layout)
    if not path.exists():
        return None
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(state, dict) or not isinstance(state.get("phase"), str):
        return None
    return state


def save_state(layout: ResearchLayout, state: dict[str, Any]) -> None:
    path = state_path(layout)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Loop engine helpers
# ---------------------------------------------------------------------------

def get_pending_tasks(batch_size: int, layout: ResearchLayout) -> list[dict[str, Any]]:
    """Read a distinct pending batch from the durable loop queue.

    `loop_engine.py next` is a read-only single-task view, so invoking it
    repeatedly without completing a task would return the same row repeatedly.
    """
    queue_path = layout.loop_state_path()
    try:
        state = json.loads(queue_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise LayoutError(f"Research loop queue is missing: {queue_path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise LayoutError(f"Research loop queue is unreadable: {queue_path}: {exc}") from exc
    if not isinstance(state, dict) or not isinstance(state.get("tasks"), list):
        raise LayoutError(f"Research loop queue is invalid: {queue_path}: expected a tasks array")
    tasks = state["tasks"]
    for index, task in enumerate(tasks):
        if not isinstance(task, dict):
            raise LayoutError(
                f"Research loop queue is invalid: {queue_path}: task row {index} must be an object"
            )
        task_id = task.get("task_id")
        if not isinstance(task_id, str) or not task_id.strip():
            raise LayoutError(
                f"Research loop queue is invalid: {queue_path}: task row {index} requires a non-empty string task_id"
            )
        status = task.get("status")
        if not isinstance(status, str) or not status.strip():
            raise LayoutError(
                f"Research loop queue is invalid: {queue_path}: task row {index} requires a non-empty string status"
            )
    return [task for task in tasks if task["status"] == "pending"][:batch_size]


def init_loop_engine(tasks: list[dict[str, Any]], layout: ResearchLayout) -> None:
    """Initialize the loop engine with research tasks."""
    task_list = [
        {
            "task_id": t["id"],
            "type": t.get("type", "web"),
            "item_id": t.get("item_id", ""),
            "field_ids": t.get("field_ids", []),
            "focus": t.get("focus", ""),
            "description": t.get("focus", ""),
        }
        for t in tasks
    ]
    subprocess.run(
        [sys.executable, str(LOOP_ENGINE), "init", layout.loop_skill(), json.dumps(task_list)],
        check=False,
    )


def add_gap_tasks(new_tasks: list[dict[str, Any]], layout: ResearchLayout) -> None:
    """Add gap-fill tasks to the loop engine."""
    for task in new_tasks:
        task_json = json.dumps({
            "task_id": task["id"],
            "type": task.get("type", "web"),
            "item_id": task.get("item_id", ""),
            "field_ids": task.get("field_ids", []),
            "focus": task.get("focus", ""),
            "description": task.get("focus", ""),
        })
        subprocess.run(
            [sys.executable, str(LOOP_ENGINE), "add", layout.loop_skill(), task_json],
            check=False,
        )


# ---------------------------------------------------------------------------
# Pre-research helpers
# ---------------------------------------------------------------------------

def pre_research_next(
    workspace: Path, layout: ResearchLayout
) -> dict[str, Any] | None:
    """Get next pending pre-research task."""
    output = _run_capture([sys.executable, str(PRE_RESEARCH_SCRIPT), "next", "-w", str(layout.workspace)])
    if not output or output == "null":
        return None
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return None


def pre_research_init(
    workspace: Path, query: str, layout: ResearchLayout, max_loops: int = 2
) -> None:
    """Initialize pre-research loop."""
    subprocess.run([
        sys.executable, str(PRE_RESEARCH_SCRIPT), "init",
        "-q", query, "-w", str(layout.workspace),
        "--max-loops", str(max_loops),
    ], check=False)


def pre_research_complete(
    workspace: Path, task_id: str, layout: ResearchLayout
) -> None:
    """Complete a pre-research task."""
    subprocess.run([
        sys.executable, str(PRE_RESEARCH_SCRIPT), "complete",
        task_id, "-w", str(layout.workspace),
    ], check=False)


def pre_research_evaluate(
    workspace: Path, layout: ResearchLayout
) -> dict[str, Any]:
    """Evaluate pre-research coverage."""
    output = _run_capture([sys.executable, str(PRE_RESEARCH_SCRIPT), "evaluate", "-w", str(layout.workspace)])
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return {"should_continue": False}


def pre_research_finalize(workspace: Path, layout: ResearchLayout) -> None:
    """Finalize pre-research into pre_research.json."""
    subprocess.run([
        sys.executable, str(PRE_RESEARCH_SCRIPT), "finalize", "-w", str(layout.workspace),
    ], check=False)


# ---------------------------------------------------------------------------
# Dispatch helpers
# ---------------------------------------------------------------------------

def _resume_invocation(layout: ResearchLayout) -> str:
    """Return a resume command that does not depend on PATH injection."""
    return (
        f"{command_arg(sys.executable)} {command_arg(SCRIPTS_DIR / 'deep_research.py')} "
        f"run-all --resume --workspace {command_arg(layout.workspace)}"
    )


def _search_provider() -> str:
    """Resolve the configured web provider, preserving the zero-config auto default."""
    provider = os.environ.get("OMAGENTS_SEARCH_PROVIDER") or "auto"
    if provider not in {"auto", "exa", "keenable", "youcom"}:
        raise LayoutError(
            f'Unsupported OMAGENTS_SEARCH_PROVIDER "{provider}"; expected "auto", "exa", "keenable", or "youcom"'
        )
    return provider


def _search_tool_instruction(provider: str) -> str:
    """Embed unambiguous provider routing in prompts consumed by fresh host children."""
    if provider == "auto":
        return (
            "For web research, use only the local Search MCP Proxy. Search with "
            "`websearch_search` on OpenCode or `mcp__websearch__search` on Codex/DSH, "
            "then fetch promising sources with `websearch_fetch` on OpenCode or "
            "`mcp__websearch__fetch` on Codex/DSH. The Proxy follows Exa → Keenable → "
            "You.com and programmatically makes at most one attempt per eligible position, "
            "advancing only after a fallback-eligible failure at that position; do not "
            "perform provider fallback yourself. Do not use direct Exa, direct Keenable, "
            "or direct You.com tools. Do not use native web search/fetch tools: "
            "`websearch_web_search_exa`, `webfetch`, `web_search`, or `web_fetch`."
        )
    if provider == "youcom":
        return (
            "For web research, use only You.com tools. Search with `youdotcom_you-search` "
            "on OpenCode or `mcp__youdotcom__you-search` on Codex/DSH, then fetch promising "
            "sources with `youdotcom_you-extract` on OpenCode or "
            "`mcp__youdotcom__you-extract` on Codex/DSH. Do not use Exa, Keenable, the "
            "Search MCP Proxy, or native web search/fetch tools."
        )
    if provider == "keenable":
        return (
            "For web research, use only Keenable tools. Search with "
            "`keenable_search_web_pages` on OpenCode or `mcp__keenable__search_web_pages` "
            "on Codex/DSH, then fetch promising sources with `keenable_fetch_page_content` "
            "on OpenCode or `mcp__keenable__fetch_page_content` on Codex/DSH. "
            "Do not use Exa. Do not use native web search/fetch tools: "
            "`websearch_web_search_exa`, `webfetch`, `web_search`, or `web_fetch`."
        )
    return (
        "For web research, use only Exa tools. Search with `websearch_web_search_exa` "
        "on OpenCode or `web_search` on Codex/DSH, then fetch promising sources with "
        "`webfetch` on OpenCode or `web_fetch` on Codex/DSH. Do not use Keenable tools: "
        "`keenable_search_web_pages`, `keenable_fetch_page_content`, "
        "`mcp__keenable__search_web_pages`, or `mcp__keenable__fetch_page_content`."
    )


def _research_plan(layout: ResearchLayout) -> dict[str, Any]:
    """Load the canonical plan that supplies fresh children with full context."""
    try:
        plan = json.loads(layout.plan_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise LayoutError(f"Research plan is missing: {layout.plan_path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise LayoutError(f"Research plan is unreadable: {layout.plan_path}: {exc}") from exc
    if not isinstance(plan, dict):
        raise LayoutError(f"Research plan is invalid: {layout.plan_path}: expected an object")
    return plan


def _subagent_dispatch(
    task: dict[str, Any], layout: ResearchLayout, date_str: str, year_str: str,
    plan: dict[str, Any],
) -> dict[str, Any]:
    """Describe one host-neutral delegation and its complete child prompt."""
    provider = _search_provider()
    task_id = task["task_id"]
    output_path = Path(task["output_path"])
    validate_invocation = (
        f"{command_arg(sys.executable)} {command_arg(SCRIPTS_DIR / 'deep_research.py')} "
        f"validate --task-id {command_arg(task_id)} --workspace {command_arg(layout.workspace)}"
    )
    field_ids = task.get("field_ids", [])
    item_id = task.get("item_id", "")
    items = plan.get("items", [])
    if not isinstance(items, list):
        items = []
    item = next(
        (candidate for candidate in items if isinstance(candidate, dict) and candidate.get("id") == item_id),
        {"id": item_id},
    )
    plan_fields = plan.get("fields", [])
    if not isinstance(plan_fields, list):
        plan_fields = []
    fields_by_id = {
        field.get("id"): field for field in plan_fields
        if isinstance(field, dict) and isinstance(field.get("id"), str)
    }
    fields = [fields_by_id.get(field_id, {"id": field_id}) for field_id in field_ids]
    prompt = "\n".join([
        f"Research {task_id}: {task.get('focus') or task.get('description') or task_id}",
        "",
        f"Research query: {plan.get('query', '')}",
        f"Item details (complete JSON): {json.dumps(item, ensure_ascii=False)}",
        f"Field definitions (complete JSON for every requested field): {json.dumps(fields, indent=2, ensure_ascii=False)}",
        f"Plan path: {layout.plan_path}",
        "The query, item details, and every requested field definition are embedded above. Read the absolute plan path only for additional context; field IDs are not self-describing.",
        f"Current date: {date_str}. Include '{year_str}' in search queries and use current sources; do not rely on training data.",
        f"Task type: {task.get('type', 'web')}",
        f"Item ID: {item_id}",
        f"Field IDs: {json.dumps(field_ids, ensure_ascii=False)}",
        f"Run ID: {layout.run_id}",
        f"Findings directory: {layout.findings_dir}",
        f"Output path: {output_path}",
        f"Shell-quoted output path: {task['output_path_quoted']}",
        f"Shell: {shell_name()}",
        "",
        f"Use the research tools appropriate to the task type. {_search_tool_instruction(provider)} For GitHub or codebase tasks, use the corresponding repository or local-code tools. Read key sources, extract every requested field, cite original sources with publication dates when available, mark uncertainty explicitly, and perform targeted follow-up searches for missing or contradictory evidence.",
        "Write one JSON object to the exact output path with this shape:",
        json.dumps({
            "type": task.get("type", "web"),
            "task_id": task_id,
            "item_id": task.get("item_id", ""),
            "field_ids": field_ids,
            "focus": task.get("focus", ""),
            "iteration": task.get("iteration", 0),
            "findings": [{
                "source": "URL, repository, or file",
                "title": "...",
                "published_date": "YYYY-MM-DD or null",
                "field_data": {field_id: "evidence" for field_id in field_ids},
                "summary": "...",
                "key_quotes": ["..."],
                "relevance": "high|medium|low",
                "uncertain": False,
            }],
            "gaps": ["..."],
        }, indent=2, ensure_ascii=False),
        "Create the parent directory if needed. Use the supplied absolute output path and shell-safe quoted value when writing through a shell.",
        f"Validate the findings with: {validate_invocation}",
        "Return a concise evidence summary to the parent agent. The parent will resume the orchestrator after all delegated findings are complete.",
    ])
    return {
        "action": "dispatch_subagent",
        "search_provider": provider,
        "description": f"Research {task_id}",
        "prompt": prompt,
        "name": task_id,
        "cwd": str(layout.project_root),
    }


def output_dispatch_instructions(
    tasks: list[dict[str, Any]], workspace: Path, layout: ResearchLayout
) -> None:
    """Output structured, host-neutral instructions for native subagent dispatch."""
    tasks_with_paths = []
    for task in tasks:
        output_path = layout.findings_dir / f"{task['task_id']}.json"
        tasks_with_paths.append({
            **task,
            "output_path": str(output_path),
            "output_path_quoted": command_arg(output_path),
        })
    date_str = _current_date_string()
    year_str = _current_year()
    plan = _research_plan(layout)
    dispatches = [
        _subagent_dispatch(task, layout, date_str, year_str, plan)
        for task in tasks_with_paths
    ]
    common = {
        "search_provider": _search_provider(),
        "workspace": str(layout.workspace),
        "run_id": layout.run_id,
        "findings_dir": str(layout.findings_dir),
        "shell": shell_name(),
        "workspace_quoted": command_arg(layout.workspace),
        "resume_command": resume_command(layout),
        "legacy_resume_command": legacy_resume_command(layout),
        "current_date": date_str,
    }

    if len(dispatches) == 1:
        print(json.dumps({
            "action": "dispatch_subagent",
            **common,
            **{key: value for key, value in dispatches[0].items() if key != "action"},
            "task": tasks_with_paths[0],
            "instruction": (
                "Translate dispatch_subagent into the current host's native asynchronous subagent mechanism. "
                f"After the child completes and its findings are validated, resume with: {_resume_invocation(layout)}"
            ),
        }, indent=2, ensure_ascii=False))
    else:
        print(json.dumps({
            "action": "dispatch_subagents_batch",
            **common,
            "tasks": tasks_with_paths,
            "dispatches": dispatches,
            "instruction": (
                "Translate every dispatch_subagent entry into the current host's native asynchronous subagent mechanism and start independent entries concurrently. "
                f"After all children complete and their findings are validated, resume with: {_resume_invocation(layout)}"
            ),
        }, indent=2, ensure_ascii=False))


def output_pre_research_instructions(
    task_data: dict[str, Any], workspace: Path, layout: ResearchLayout
) -> None:
    """Output JSON instructions for the agent to do pre-research search."""
    provider = _search_provider()
    date_str = _current_date_string()
    year_str = _current_year()
    task_id = task_data.get("task_id", "pre-1")
    output_path = layout.pre_findings_dir / f"{task_id}.json"
    print(json.dumps({
        "action": "pre_research_search",
        "search_provider": provider,
        "workspace": str(layout.workspace),
        "run_id": layout.run_id,
        "pre_findings_dir": str(layout.pre_findings_dir),
        "output_path": str(output_path),
        "output_path_quoted": command_arg(output_path),
        "shell": shell_name(),
        "workspace_quoted": command_arg(layout.workspace),
        "resume_command": resume_command(layout),
        "legacy_resume_command": legacy_resume_command(layout),
        "current_date": date_str,
        "task": task_data,
        "instruction": (
            f"Current date: {date_str}. "
            f"{_search_tool_instruction(provider)} "
            "Search for the MOST RECENT information about the research topic. "
            f"Include '{year_str}' or '{date_str}' in your search queries to get current results. "
            "Do NOT rely on your training data - it may be outdated. "
            "Extract key entities (models, frameworks, projects, etc.) with their latest versions, "
            "vendors, and source URLs. "
            f"Write findings to {command_arg(output_path)} using a {shell_name()} shell command. "
            "The same value is available as output_path and output_path_quoted. "
            f"After writing findings, run: {_resume_invocation(layout)}"
        ),
        "output_schema": {
            "task_id": task_id,
            "focus": "...",
            "candidates": [{"name": "...", "vendor": "...", "note": "...", "source": "https://..."}],
            "sources": ["https://..."],
            "summary": "Brief overview of the current landscape",
        },
    }, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Main state machine
# ---------------------------------------------------------------------------

def run_all(
    query: str,
    workspace: Path,
    template: str,
    resume: bool = False,
    skip_pre_research: bool = False,
) -> int:
    """Run the full research pipeline with pause/resume support."""
    layout = ResearchLayout.resolve(workspace)
    if resume and not layout.orchestration_state_path.exists():
        print(
            f"Error: no orchestration checkpoint found for --resume in {layout.workspace}",
            file=sys.stderr,
        )
        return 1

    layout.workspace.mkdir(parents=True, exist_ok=True)
    state = load_state(layout) if resume else None
    if resume and state is None:
        print(
            f"Error: could not read orchestration checkpoint in {layout.workspace}",
            file=sys.stderr,
        )
        return 1

    # Phase 0: Pre-research (Landscape Scan)
    if state is None and not skip_pre_research:
        state = {
            "phase": "pre_research",
            "loop": 0,
            "query": query,
            "template": template,
            "workspace": str(layout.workspace),
            "run_id": layout.run_id,
            "started_at": now(),
        }
        save_state(layout, state)

        pre_research_init(workspace, query, layout)
        print("Phase 0: Pre-research (landscape scan) initialized.")

    if state is None and skip_pre_research:
        state = {
            "phase": "planning",
            "loop": 0,
            "query": query,
            "template": template,
            "workspace": str(layout.workspace),
            "run_id": layout.run_id,
            "started_at": now(),
        }
        save_state(layout, state)

    state["last_resumed_at"] = now()
    save_state(layout, state)

    # Phase 0: Pre-research
    if state["phase"] == "pre_research":
        pre_task = pre_research_next(workspace, layout)
        if pre_task:
            output_pre_research_instructions(pre_task, workspace, layout)
            return 0  # Pause - agent needs to do search

        # No more pending tasks, try to complete any in-progress
        # and evaluate
        eval_result = pre_research_evaluate(workspace, layout)
        if eval_result.get("should_continue"):
            pre_task = pre_research_next(workspace, layout)
            if pre_task:
                output_pre_research_instructions(pre_task, workspace, layout)
                return 0

        # Pre-research complete, finalize
        pre_research_finalize(workspace, layout)
        print("Phase 0: Pre-research complete. pre_research.json generated.")
        state["phase"] = "planning"
        save_state(layout, state)

    # Phase 1: Planning
    if state["phase"] == "planning":
        print("Phase 1: Creating research plan...")
        pre_research_path = layout.pre_research_path
        plan_template = state.get("template", template)
        plan_cmd = [
            "--query", state.get("query", query) or query,
            "--template", plan_template,
            "--output", str(layout.plan_path),
        ]
        if pre_research_path.exists():
            plan_cmd.extend(["--pre-research", str(pre_research_path)])
        rc = run_script("plan.py", plan_cmd)
        if rc != 0:
            return rc

        plan = json.loads(layout.plan_path.read_text(encoding="utf-8"))
        init_loop_engine(plan.get("tasks", []), layout)

        state["phase"] = "dispatch"
        save_state(layout, state)

    # Phase 2: Dispatch / Research (batch-aware)
    if state["phase"] == "dispatch":
        plan = json.loads(layout.plan_path.read_text(encoding="utf-8"))
        batch_size = plan.get("config", {}).get("batch_size", 3)

        pending = get_pending_tasks(batch_size, layout)
        if pending:
            output_dispatch_instructions(pending, workspace, layout)
            return 0  # Pause - agent needs to dispatch subagents

        state["phase"] = "gap_analysis"
        save_state(layout, state)

    # Phase 3: Gap Analysis
    if state["phase"] == "gap_analysis":
        print("Phase 3: Running gap analysis...")
        run_script("gap_analysis.py", [
            "--plan", str(layout.plan_path),
            "--findings-dir", str(layout.findings_dir),
            "--output", str(layout.gap_path),
        ])

        gap_path = layout.gap_path
        if layout.legacy and not gap_path.exists():
            gap_path = layout.storage_dir / "gap_report.json"
        if gap_path.exists():
            try:
                gap_report = json.loads(gap_path.read_text(encoding="utf-8"))
                if gap_report.get("should_continue"):
                    add_gap_tasks(gap_report.get("new_tasks", []), layout)
                    state["phase"] = "dispatch"
                    state["loop"] += 1
                    save_state(layout, state)
                    plan_template = state.get("template", template)
                    return run_all(query, workspace, plan_template, resume=True, skip_pre_research=True)
            except json.JSONDecodeError:
                pass

        state["phase"] = "merging"
        save_state(layout, state)

    # Phase 4: Merge
    if state["phase"] == "merging":
        print("Phase 4: Merging findings...")
        layout.artifacts_dir.mkdir(parents=True, exist_ok=True)
        run_script("merge.py", [
            "--input-dir", str(layout.findings_dir),
            "--output", str(layout.merged_path),
        ])
        state["phase"] = "reporting"
        save_state(layout, state)

    # Phase 5: Report
    if state["phase"] == "reporting":
        print("Phase 5: Generating report...")
        run_script("synthesize.py", [
            "--plan", str(layout.plan_path),
            "--findings-dir", str(layout.findings_dir),
            "--output", str(layout.report_path),
        ])
        state["phase"] = "polishing"
        save_state(layout, state)

    # Phase 5b: Polish (LLM-powered, pauses for agent)
    if state["phase"] == "polishing":
        print("Phase 5b: Preparing report for LLM polishing...")
        report_path = layout.report_path
        layout.artifacts_dir.mkdir(parents=True, exist_ok=True)
        raw_path = layout.raw_report_path

        if report_path.exists():
            import shutil
            shutil.copy2(report_path, raw_path)

        plan: dict[str, Any] = {}
        plan_path = layout.plan_path
        if plan_path.exists():
            plan = json.loads(plan_path.read_text(encoding="utf-8"))

        plan_context = {
            "query": plan.get("query", ""),
            "context": plan.get("context", ""),
            "objectives": plan.get("objectives", []),
            "language": plan.get("config", {}).get("language", "auto"),
            "items": [i.get("name", i.get("id", "")) for i in plan.get("items", [])],
            "fields": [f.get("name", f.get("id", "")) for f in plan.get("fields", [])],
        }

        polish_prompt = SKILL_DIR / "prompts" / "polish_report.md"

        print(json.dumps({
            "action": "polish_report",
            "raw_report": str(raw_path),
            "output": str(report_path),
            "plan_context": plan_context,
            "prompt_file": str(polish_prompt),
            "instruction": (
                f"Read the raw report at {raw_path} and the plan context above. "
                "Rewrite the report into a polished, coherent narrative following "
                f"the polish prompt file. Save the polished version to {report_path} "
                "(overwrite). Keep SVG charts and source citations intact. "
                f"After polishing, run: {_resume_invocation(layout)}"
            ),
        }, indent=2, ensure_ascii=False))
        state["phase"] = "auditing"
        save_state(layout, state)
        return 0  # Pause - agent needs to polish

    # Phase 6: Audit
    if state["phase"] == "auditing":
        print("Phase 6: Running integrity audit...")
        layout.artifacts_dir.mkdir(parents=True, exist_ok=True)
        run_script("audit.py", [
            "--plan", str(layout.plan_path),
            "--findings-dir", str(layout.findings_dir),
            "--output", str(layout.audit_path),
        ])
        state["phase"] = "packaging"
        save_state(layout, state)

    # Phase 7: Package
    if state["phase"] == "packaging":
        print("Phase 7: Generating artifact package...")
        run_script("package.py", ["--workspace", str(layout.workspace)])
        state["phase"] = "done"
        save_state(layout, state)
        print(f"\n{'=' * 50}")
        print(f"Research complete! Report: {layout.report_path}")
        print(f"{'=' * 50}")
        return 0

    return 0


def get_status(workspace: Path) -> dict[str, Any]:
    """Check workspace state and return current status."""
    layout = ResearchLayout.resolve(workspace)
    state = load_state(layout)
    if state is None:
        return {
            "phase": "not_started",
            "message": "No orchestration state found. Run 'run-all' to start.",
        }

    plan_exists = layout.plan_path.exists()
    report_exists = layout.report_path.exists()
    pre_research_exists = layout.pre_research_path.exists()
    audit_exists = layout.audit_path.exists()
    package_exists = layout.package_path.exists()

    return {
        "phase": state.get("phase", "unknown"),
        "loop": state.get("loop", 0),
        "query": state.get("query", ""),
        "started_at": state.get("started_at", ""),
        "files": {
            "pre_research": pre_research_exists,
            "plan": plan_exists,
            "report": report_exists,
            "audit": audit_exists,
            "package": package_exists,
        },
        "next_action": _recommend_next_action(state.get("phase", "unknown")),
    }


def _recommend_next_action(phase: str) -> str:
    actions = {
        "pre_research": "Complete pre-research search tasks, then run: run-all --resume",
        "planning": "Run: run-all --resume (will create plan automatically)",
        "dispatch": "Dispatch subagents for pending tasks, then run: run-all --resume",
        "gap_analysis": "Run: run-all --resume (will process gaps automatically)",
        "merging": "Run: run-all --resume (will merge automatically)",
        "reporting": "Run: run-all --resume (will generate report automatically)",
        "polishing": "Polish the report (read report_raw.md, rewrite, save to report.md), then run: run-all --resume",
        "auditing": "Run: run-all --resume (will audit automatically)",
        "packaging": "Run: run-all --resume (will package automatically)",
        "done": "Research complete. No further action needed.",
        "not_started": "Run: run-all --query '...' --workspace ...",
    }
    return actions.get(phase, "Run: run-all --resume")


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Orchestrate deep-research pipeline.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # run-all
    run_parser = subparsers.add_parser("run-all", help="Run the full research pipeline")
    run_parser.add_argument("--query", "-q", help="Research query (required for first run)")
    run_parser.add_argument("--template", "-t", default="survey",
                          choices=["comparison", "survey", "technical", "custom"])
    run_parser.add_argument("--workspace", "-w", required=True, help="Workspace directory")
    run_parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    run_parser.add_argument("--skip-pre-research", action="store_true",
                          help="Skip pre-research landscape scan phase")

    # status
    status_parser = subparsers.add_parser("status", help="Check orchestration status")
    status_parser.add_argument("--workspace", "-w", required=True, help="Workspace directory")

    args = parser.parse_args()

    if args.command == "run-all":
        workspace = Path(args.workspace)
        if not args.resume and not args.query:
            print("Error: --query is required for first run (or use --resume)", file=sys.stderr)
            return 1
        return run_all(
            args.query or "", workspace, args.template,
            resume=args.resume, skip_pre_research=args.skip_pre_research,
        )

    if args.command == "status":
        workspace = Path(args.workspace)
        status = get_status(workspace)
        print(json.dumps(status, indent=2, ensure_ascii=False))
        return 0

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except LayoutError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
