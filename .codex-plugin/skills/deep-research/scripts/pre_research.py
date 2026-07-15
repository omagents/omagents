#!/usr/bin/env python3
"""Pre-research landscape scan for deep-research.

Uses the shared loop_engine to iteratively scan the current landscape
before generating a research plan. This ensures items are based on
real-world, up-to-date data rather than stale model knowledge.

Subcommands:
    init      Initialize pre-research loop with broad search tasks
    next      Get next pending pre-research task (outputs JSON or null)
    complete  Mark a task complete (reads agent-written findings)
    evaluate  Check if pre-research should continue (adds tasks if needed)
    finalize  Merge all pre-findings into pre_research.json
    status    Print pre-research loop status
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SKILL_DIR = Path(__file__).resolve().parent.parent
LOOP_ENGINE = SKILL_DIR.parent / "_shared" / "scripts" / "loop_engine.py"
PRE_SKILL_KEY = "deep-research-pre"

DEFAULT_MAX_PRE_LOOPS = 2
DEFAULT_MIN_CANDIDATES = 5
DEFAULT_MIN_SOURCES = 3


def _current_date_string() -> str:
    """Return a human-readable current date for search context injection.

    Example: 'July 2026'
    """
    now = datetime.now(timezone.utc)
    return now.strftime("%B %Y")


def _current_year() -> str:
    """Return the current year as a string."""
    return str(datetime.now(timezone.utc).year)


def _search_context() -> str:
    """Build a search context string with the current date.

    This is injected into task descriptions so the agent searches for
    the most recent information rather than relying on training data.
    """
    return f"Current date: {_current_date_string()}. Search for the latest information available as of {_current_year()}."


def _run_loop(cmd: list[str]) -> str:
    """Run loop_engine.py and return stdout."""
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return result.stdout.strip()


def _workspace_pre_findings_dir(workspace: Path) -> Path:
    d = workspace / "pre_findings"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_pre_findings(workspace: Path) -> list[dict[str, Any]]:
    """Load all pre-research finding files."""
    d = _workspace_pre_findings_dir(workspace)
    findings: list[dict[str, Any]] = []
    for path in sorted(d.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                findings.append(data)
        except (json.JSONDecodeError, OSError):
            continue
    return findings


def cmd_init(args: argparse.Namespace) -> int:
    """Initialize the pre-research loop with a broad search task."""
    workspace = Path(args.workspace)
    workspace.mkdir(parents=True, exist_ok=True)

    query = args.query
    max_loops = args.max_loops
    date_str = _current_date_string()

    initial_tasks = [
        {
            "task_id": "pre-1",
            "focus": f"Broad landscape scan: {query}",
            "description": (
                f"Current date: {date_str}. "
                f"Search the web for the current state of '{query}' as of {date_str}. "
                "Identify ALL major entities (models, frameworks, projects, tools, etc.), "
                "their latest versions, vendors/creators, and key differentiators. "
                "Focus on information from the last 6 months. "
                "Do NOT rely on training data - search for the most recent sources."
            ),
            "iteration": 0,
        }
    ]

    task_json = json.dumps(initial_tasks, ensure_ascii=False)
    _run_loop([sys.executable, str(LOOP_ENGINE), "init", PRE_SKILL_KEY, task_json])

    state = {
        "query": query,
        "max_pre_loops": max_loops,
        "workspace": str(workspace),
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    (workspace / "pre_research_state.json").write_text(
        json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(json.dumps({
        "action": "pre_research_initialized",
        "query": query,
        "max_loops": max_loops,
        "message": "Pre-research loop initialized. Run 'next' to get the first task.",
    }, indent=2, ensure_ascii=False))
    return 0


def cmd_next(args: argparse.Namespace) -> int:
    """Get the next pending pre-research task.

    Outputs just the task JSON (or null), consistent with loop_engine.
    The orchestrator wraps it with instructions.
    """
    output = _run_loop([sys.executable, str(LOOP_ENGINE), "next", PRE_SKILL_KEY])
    if not output or output == "null":
        print("null")
        return 0

    task = json.loads(output)
    # Clean up loop_engine internal fields
    task.pop("id", None)
    task.pop("status", None)
    task.pop("attempts", None)

    print(json.dumps(task, ensure_ascii=False, indent=2))
    return 0


def cmd_complete(args: argparse.Namespace) -> int:
    """Mark a pre-research task complete."""
    result = args.result if args.result else "Pre-research search completed"
    _run_loop([sys.executable, str(LOOP_ENGINE), "complete", PRE_SKILL_KEY, args.task_id, result])
    print(f"Pre-research task {args.task_id} completed.")
    return 0


def cmd_evaluate(args: argparse.Namespace) -> int:
    """Evaluate pre-research coverage and add tasks if needed."""
    workspace = Path(args.workspace)
    state_path = workspace / "pre_research_state.json"
    if not state_path.exists():
        print(json.dumps({"should_continue": False, "reason": "No pre-research state found"}))
        return 0

    state = json.loads(state_path.read_text(encoding="utf-8"))
    max_loops = state.get("max_pre_loops", DEFAULT_MAX_PRE_LOOPS)

    loop_status = _run_loop([sys.executable, str(LOOP_ENGINE), "status", PRE_SKILL_KEY])
    findings = _load_pre_findings(workspace)

    all_candidates: list[dict[str, Any]] = []
    all_sources: list[str] = []
    for f in findings:
        all_candidates.extend(f.get("candidates", []))
        for s in f.get("sources", []):
            if s not in all_sources:
                all_sources.append(s)

    loop_count = state.get("loops_completed", 0)
    min_candidates = args.min_candidates or DEFAULT_MIN_CANDIDATES
    min_sources = args.min_sources or DEFAULT_MIN_SOURCES

    reasons: list[str] = []
    should_continue = True

    if loop_count >= max_loops:
        should_continue = False
        reasons.append(f"Max pre-research loops ({max_loops}) reached")

    if len(all_candidates) < min_candidates:
        reasons.append(f"Only {len(all_candidates)} candidates found (need {min_candidates})")
    elif len(all_sources) < min_sources:
        reasons.append(f"Only {len(all_sources)} sources (need {min_sources})")
    else:
        should_continue = False
        reasons.append(f"Sufficient coverage: {len(all_candidates)} candidates from {len(all_sources)} sources")

    if should_continue and loop_count < max_loops:
        next_loop = loop_count + 1
        date_str = _current_date_string()
        new_task = {
            "task_id": f"pre-{next_loop + 1}",
            "focus": f"Targeted supplemental scan (loop {next_loop}): {state['query']}",
            "description": (
                f"Current date: {date_str}. "
                f"Search for additional entities or updates not yet found for '{state['query']}' as of {date_str}. "
                f"Current candidates: {', '.join(c.get('name', '') for c in all_candidates[:10])}. "
                "Look for emerging or niche players, recent version updates, or regional variants "
                "that may have been missed in previous searches. "
                "Do NOT rely on training data - search for the most recent sources."
            ),
            "iteration": next_loop,
        }
        _run_loop([sys.executable, str(LOOP_ENGINE), "add", PRE_SKILL_KEY, json.dumps(new_task, ensure_ascii=False)])
        state["loops_completed"] = next_loop
        state_path.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
        reasons.append(f"Added targeted search task pre-{next_loop + 1}")

    print(json.dumps({
        "should_continue": should_continue,
        "loop_count": loop_count,
        "max_loops": max_loops,
        "candidate_count": len(all_candidates),
        "source_count": len(all_sources),
        "reasons": reasons,
    }, indent=2, ensure_ascii=False))
    return 0


def cmd_finalize(args: argparse.Namespace) -> int:
    """Merge all pre-research findings into pre_research.json."""
    workspace = Path(args.workspace)
    findings = _load_pre_findings(workspace)

    state_path = workspace / "pre_research_state.json"
    state = {}
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))

    all_candidates: list[dict[str, Any]] = []
    all_sources: list[str] = []
    summaries: list[str] = []

    seen_names: set[str] = set()
    for f in findings:
        for c in f.get("candidates", []):
            name = c.get("name", "").strip()
            if name and name.lower() not in seen_names:
                seen_names.add(name.lower())
                all_candidates.append(c)
        for s in f.get("sources", []):
            if s not in all_sources:
                all_sources.append(s)
        summary = f.get("summary", "")
        if summary:
            summaries.append(summary)

    pre_research = {
        "query": state.get("query", ""),
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "summary": " ".join(summaries) if summaries else "",
        "candidates": all_candidates,
        "sources": all_sources,
        "loops_completed": state.get("loops_completed", 0),
        "finding_count": len(findings),
    }

    output_path = workspace / "pre_research.json"
    output_path.write_text(json.dumps(pre_research, indent=2, ensure_ascii=False), encoding="utf-8")

    _run_loop([sys.executable, str(LOOP_ENGINE), "reset", PRE_SKILL_KEY])

    print(json.dumps({
        "action": "pre_research_finalized",
        "output": str(output_path),
        "candidate_count": len(all_candidates),
        "source_count": len(all_sources),
        "candidates": [c.get("name", "") for c in all_candidates],
    }, indent=2, ensure_ascii=False))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    """Print pre-research loop status."""
    output = _run_loop([sys.executable, str(LOOP_ENGINE), "status", PRE_SKILL_KEY])
    print(output)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Pre-research landscape scan for deep-research.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="Initialize pre-research loop")
    init_parser.add_argument("--query", "-q", required=True, help="Research query")
    init_parser.add_argument("--workspace", "-w", required=True, help="Workspace directory")
    init_parser.add_argument("--max-loops", type=int, default=DEFAULT_MAX_PRE_LOOPS, help="Max pre-research loops")
    init_parser.set_defaults(func=cmd_init)

    next_parser = subparsers.add_parser("next", help="Get next pending task")
    next_parser.add_argument("--workspace", "-w", required=True, help="Workspace directory")
    next_parser.set_defaults(func=cmd_next)

    complete_parser = subparsers.add_parser("complete", help="Mark task complete")
    complete_parser.add_argument("task_id", help="Task ID to complete")
    complete_parser.add_argument("--result", "-r", default="", help="Completion result")
    complete_parser.add_argument("--workspace", "-w", required=True, help="Workspace directory")
    complete_parser.set_defaults(func=cmd_complete)

    eval_parser = subparsers.add_parser("evaluate", help="Evaluate coverage and add tasks if needed")
    eval_parser.add_argument("--workspace", "-w", required=True, help="Workspace directory")
    eval_parser.add_argument("--min-candidates", type=int, default=0, help="Override min candidates")
    eval_parser.add_argument("--min-sources", type=int, default=0, help="Override min sources")
    eval_parser.set_defaults(func=cmd_evaluate)

    finalize_parser = subparsers.add_parser("finalize", help="Merge findings into pre_research.json")
    finalize_parser.add_argument("--workspace", "-w", required=True, help="Workspace directory")
    finalize_parser.set_defaults(func=cmd_finalize)

    status_parser = subparsers.add_parser("status", help="Print loop status")
    status_parser.set_defaults(func=cmd_status)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
