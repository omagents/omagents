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
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SKILL_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = SKILL_DIR / "scripts"
LOOP_ENGINE = SKILL_DIR.parent / "_shared" / "scripts" / "loop_engine.py"
PRE_RESEARCH_SCRIPT = SCRIPTS_DIR / "pre_research.py"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return result.stdout.strip()


def state_path(workspace: Path) -> Path:
    return workspace / "orchestration_state.json"


def load_state(workspace: Path) -> dict[str, Any] | None:
    path = state_path(workspace)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def save_state(workspace: Path, state: dict[str, Any]) -> None:
    path = state_path(workspace)
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Loop engine helpers
# ---------------------------------------------------------------------------

def get_next_task() -> dict[str, Any] | None:
    """Check loop_engine for the next pending task."""
    result = subprocess.run(
        [sys.executable, str(LOOP_ENGINE), "next", "deep-research"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return None
    output = result.stdout.strip()
    if not output or output == "null":
        return None
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return None


def get_pending_tasks(batch_size: int) -> list[dict[str, Any]]:
    """Get up to batch_size pending tasks from the loop engine."""
    tasks: list[dict[str, Any]] = []
    for _ in range(batch_size):
        task = get_next_task()
        if task is None:
            break
        tasks.append(task)
    return tasks


def init_loop_engine(tasks: list[dict[str, Any]]) -> None:
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
        [sys.executable, str(LOOP_ENGINE), "init", "deep-research", json.dumps(task_list)],
        check=False,
    )


def add_gap_tasks(new_tasks: list[dict[str, Any]]) -> None:
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
            [sys.executable, str(LOOP_ENGINE), "add", "deep-research", task_json],
            check=False,
        )


# ---------------------------------------------------------------------------
# Pre-research helpers
# ---------------------------------------------------------------------------

def pre_research_next(workspace: Path) -> dict[str, Any] | None:
    """Get next pending pre-research task."""
    output = _run_capture([sys.executable, str(PRE_RESEARCH_SCRIPT), "next", "-w", str(workspace)])
    if not output or output == "null":
        return None
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return None


def pre_research_init(workspace: Path, query: str, max_loops: int = 2) -> None:
    """Initialize pre-research loop."""
    subprocess.run([
        sys.executable, str(PRE_RESEARCH_SCRIPT), "init",
        "-q", query, "-w", str(workspace),
        "--max-loops", str(max_loops),
    ], check=False)


def pre_research_complete(workspace: Path, task_id: str) -> None:
    """Complete a pre-research task."""
    subprocess.run([
        sys.executable, str(PRE_RESEARCH_SCRIPT), "complete",
        task_id, "-w", str(workspace),
    ], check=False)


def pre_research_evaluate(workspace: Path) -> dict[str, Any]:
    """Evaluate pre-research coverage."""
    output = _run_capture([sys.executable, str(PRE_RESEARCH_SCRIPT), "evaluate", "-w", str(workspace)])
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return {"should_continue": False}


def pre_research_finalize(workspace: Path) -> None:
    """Finalize pre-research into pre_research.json."""
    subprocess.run([
        sys.executable, str(PRE_RESEARCH_SCRIPT), "finalize", "-w", str(workspace),
    ], check=False)


# ---------------------------------------------------------------------------
# Dispatch helpers
# ---------------------------------------------------------------------------

def output_dispatch_instructions(tasks: list[dict[str, Any]], workspace: Path) -> None:
    """Output JSON instructions for the agent to dispatch subagents."""
    date_str = _current_date_string()
    year_str = _current_year()
    date_context = f"Current date: {date_str}. Include '{year_str}' in search queries. Do NOT rely on training data. "

    if len(tasks) == 1:
        print(json.dumps({
            "action": "dispatch_subagent",
            "current_date": date_str,
            "task": tasks[0],
            "instruction": (
                date_context +
                "Dispatch a subagent for the task above using task(background: true). "
                "The subagent MUST search for the latest information and cite sources with dates. "
                "After the subagent completes and findings are written, run: "
                f"deep_research.py run-all --resume --workspace {workspace}"
            ),
        }, indent=2, ensure_ascii=False))
    else:
        print(json.dumps({
            "action": "dispatch_subagents_batch",
            "current_date": date_str,
            "tasks": tasks,
            "instruction": (
                date_context +
                f"Dispatch a subagent for EACH task above using task(background: true). "
                f"All {len(tasks)} tasks can run in parallel. "
                "Each subagent MUST search for the latest information and cite sources with dates. "
                "After all subagents complete and findings are written, run: "
                f"deep_research.py run-all --resume --workspace {workspace}"
            ),
        }, indent=2, ensure_ascii=False))


def output_pre_research_instructions(task_data: dict[str, Any], workspace: Path) -> None:
    """Output JSON instructions for the agent to do pre-research search."""
    date_str = _current_date_string()
    year_str = _current_year()
    task_id = task_data.get("task_id", "pre-1")
    print(json.dumps({
        "action": "pre_research_search",
        "current_date": date_str,
        "task": task_data,
        "instruction": (
            f"Current date: {date_str}. "
            "Use WebSearch to search for the MOST RECENT information about the research topic. "
            f"Include '{year_str}' or '{date_str}' in your search queries to get current results. "
            "Do NOT rely on your training data - it may be outdated. "
            "Extract key entities (models, frameworks, projects, etc.) with their latest versions, "
            "vendors, and source URLs. "
            f"Write findings to {workspace}/pre_findings/{task_id}.json using Bash. "
            f"After writing findings, run: deep_research.py run-all --resume --workspace {workspace}"
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
    workspace.mkdir(parents=True, exist_ok=True)
    state = load_state(workspace) if resume else None

    # Phase 0: Pre-research (Landscape Scan)
    if state is None and not skip_pre_research:
        state = {
            "phase": "pre_research",
            "loop": 0,
            "query": query,
            "template": template,
            "workspace": str(workspace),
            "started_at": now(),
        }
        save_state(workspace, state)

        pre_research_init(workspace, query)
        print("Phase 0: Pre-research (landscape scan) initialized.")

    if state is None and skip_pre_research:
        state = {
            "phase": "planning",
            "loop": 0,
            "query": query,
            "template": template,
            "workspace": str(workspace),
            "started_at": now(),
        }
        save_state(workspace, state)

    state["last_resumed_at"] = now()
    save_state(workspace, state)

    # Phase 0: Pre-research
    if state["phase"] == "pre_research":
        pre_task = pre_research_next(workspace)
        if pre_task:
            output_pre_research_instructions(pre_task, workspace)
            return 0  # Pause - agent needs to do search

        # No more pending tasks, try to complete any in-progress
        # and evaluate
        eval_result = pre_research_evaluate(workspace)
        if eval_result.get("should_continue"):
            pre_task = pre_research_next(workspace)
            if pre_task:
                output_pre_research_instructions(pre_task, workspace)
                return 0

        # Pre-research complete, finalize
        pre_research_finalize(workspace)
        print("Phase 0: Pre-research complete. pre_research.json generated.")
        state["phase"] = "planning"
        save_state(workspace, state)

    # Phase 1: Planning
    if state["phase"] == "planning":
        print("Phase 1: Creating research plan...")
        pre_research_path = workspace / "pre_research.json"
        plan_template = state.get("template", template)
        plan_cmd = [
            "--query", state.get("query", query) or query,
            "--template", plan_template,
            "--output", str(workspace / "plan.json"),
        ]
        if pre_research_path.exists():
            plan_cmd.extend(["--pre-research", str(pre_research_path)])
        rc = run_script("plan.py", plan_cmd)
        if rc != 0:
            return rc

        plan = json.loads((workspace / "plan.json").read_text(encoding="utf-8"))
        init_loop_engine(plan.get("tasks", []))

        state["phase"] = "dispatch"
        save_state(workspace, state)

    # Phase 2: Dispatch / Research (batch-aware)
    if state["phase"] == "dispatch":
        plan = json.loads((workspace / "plan.json").read_text(encoding="utf-8"))
        batch_size = plan.get("config", {}).get("batch_size", 3)

        pending = get_pending_tasks(batch_size)
        if pending:
            output_dispatch_instructions(pending, workspace)
            return 0  # Pause - agent needs to dispatch subagents

        state["phase"] = "gap_analysis"
        save_state(workspace, state)

    # Phase 3: Gap Analysis
    if state["phase"] == "gap_analysis":
        print("Phase 3: Running gap analysis...")
        run_script("gap_analysis.py", [
            "--plan", str(workspace / "plan.json"),
            "--findings-dir", str(workspace / "findings"),
            "--output", str(workspace / "gap_report.json"),
        ])

        gap_path = workspace / "gap_report.json"
        if gap_path.exists():
            try:
                gap_report = json.loads(gap_path.read_text(encoding="utf-8"))
                if gap_report.get("should_continue"):
                    add_gap_tasks(gap_report.get("new_tasks", []))
                    state["phase"] = "dispatch"
                    state["loop"] += 1
                    save_state(workspace, state)
                    plan_template = state.get("template", template)
                    return run_all(query, workspace, plan_template, resume=True, skip_pre_research=True)
            except json.JSONDecodeError:
                pass

        state["phase"] = "merging"
        save_state(workspace, state)

    # Phase 4: Merge
    if state["phase"] == "merging":
        print("Phase 4: Merging findings...")
        artifacts = workspace / "artifacts"
        artifacts.mkdir(parents=True, exist_ok=True)
        run_script("merge.py", [
            "--input-dir", str(workspace / "findings"),
            "--output", str(artifacts / "findings_merged.json"),
        ])
        state["phase"] = "reporting"
        save_state(workspace, state)

    # Phase 5: Report
    if state["phase"] == "reporting":
        print("Phase 5: Generating report...")
        run_script("synthesize.py", [
            "--plan", str(workspace / "plan.json"),
            "--findings-dir", str(workspace / "findings"),
            "--output", str(workspace / "report.md"),
        ])
        state["phase"] = "polishing"
        save_state(workspace, state)

    # Phase 5b: Polish (LLM-powered, pauses for agent)
    if state["phase"] == "polishing":
        print("Phase 5b: Preparing report for LLM polishing...")
        report_path = workspace / "report.md"
        artifacts = workspace / "artifacts"
        artifacts.mkdir(parents=True, exist_ok=True)
        raw_path = artifacts / "report_raw.md"

        if report_path.exists():
            import shutil
            shutil.copy2(report_path, raw_path)

        plan: dict[str, Any] = {}
        plan_path = workspace / "plan.json"
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
                "Read the raw report at artifacts/report_raw.md and the plan context above. "
                "Rewrite the report into a polished, coherent narrative following "
                "the polish prompt file. Save the polished version to report.md "
                "(overwrite). Keep SVG charts and source citations intact. "
                "After polishing, run: deep_research.py run-all --resume --workspace "
                + str(workspace)
            ),
        }, indent=2, ensure_ascii=False))
        state["phase"] = "auditing"
        save_state(workspace, state)
        return 0  # Pause - agent needs to polish

    # Phase 6: Audit
    if state["phase"] == "auditing":
        print("Phase 6: Running integrity audit...")
        artifacts = workspace / "artifacts"
        artifacts.mkdir(parents=True, exist_ok=True)
        run_script("audit.py", [
            "--plan", str(workspace / "plan.json"),
            "--findings-dir", str(workspace / "findings"),
            "--output", str(artifacts / "audit_report.json"),
        ])
        state["phase"] = "packaging"
        save_state(workspace, state)

    # Phase 7: Package
    if state["phase"] == "packaging":
        print("Phase 7: Generating artifact package...")
        run_script("package.py", ["--workspace", str(workspace)])
        state["phase"] = "done"
        save_state(workspace, state)
        print(f"\n{'=' * 50}")
        print(f"Research complete! Report: {workspace / 'report.md'}")
        print(f"{'=' * 50}")
        return 0

    return 0


def get_status(workspace: Path) -> dict[str, Any]:
    """Check workspace state and return current status."""
    state = load_state(workspace)
    if state is None:
        return {
            "phase": "not_started",
            "message": "No orchestration state found. Run 'run-all' to start.",
        }

    plan_exists = (workspace / "plan.json").exists()
    report_exists = (workspace / "report.md").exists()
    pre_research_exists = (workspace / "pre_research.json").exists()
    audit_exists = (workspace / "artifacts" / "audit_report.json").exists()
    package_exists = (workspace / "artifacts" / "package.json").exists()

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
    sys.exit(main())
