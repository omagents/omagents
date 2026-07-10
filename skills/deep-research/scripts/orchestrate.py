#!/usr/bin/env python3
"""Meta-orchestration for deep-research: pausable state machine.

Runs all Python-side phases automatically and pauses only when
subagent dispatch is needed. The agent calls `--resume` after
subagents complete.
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


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_script(script_name: str, extra_args: list[str]) -> int:
    cmd = [sys.executable, str(SCRIPTS_DIR / script_name), *extra_args]
    return subprocess.run(cmd, check=False).returncode


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


def output_dispatch_instructions(pending: dict[str, Any]) -> None:
    """Output JSON instructions for the agent to dispatch subagents."""
    print(json.dumps({
        "action": "dispatch_subagents",
        "task": pending,
        "instruction": (
            "Dispatch a subagent for the task above using task(background: true). "
            "After the subagent completes and findings are written, run: "
            "deep_research.py run-all --resume --workspace <workspace>"
        ),
    }, indent=2, ensure_ascii=False))


def run_all(
    query: str,
    workspace: Path,
    template: str,
    resume: bool = False,
) -> int:
    """Run the full research pipeline with pause/resume support."""
    workspace.mkdir(parents=True, exist_ok=True)
    state = load_state(workspace) if resume else None

    # Phase 1: Planning
    if state is None:
        print("Phase 1: Creating research plan...")
        rc = run_script("plan.py", [
            "--query", query, "--template", template,
            "--output", str(workspace / "plan.json"),
        ])
        if rc != 0:
            return rc

        plan = json.loads((workspace / "plan.json").read_text(encoding="utf-8"))
        init_loop_engine(plan.get("tasks", []))

        state = {
            "phase": "dispatch",
            "loop": 0,
            "query": query,
            "workspace": str(workspace),
            "started_at": now(),
        }
        save_state(workspace, state)

    state["last_resumed_at"] = now()
    save_state(workspace, state)

    # Phase 2: Dispatch / Research
    if state["phase"] == "dispatch":
        pending = get_next_task()
        if pending:
            output_dispatch_instructions(pending)
            return 0  # Pause — agent needs to dispatch subagent

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
                    return run_all(query, workspace, template, resume=True)
            except json.JSONDecodeError:
                pass

        state["phase"] = "merging"
        save_state(workspace, state)

    # Phase 4: Merge
    if state["phase"] == "merging":
        print("Phase 4: Merging findings...")
        run_script("merge.py", [
            "--input-dir", str(workspace / "findings"),
            "--output", str(workspace / "findings_merged.json"),
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
        state["phase"] = "auditing"
        save_state(workspace, state)

    # Phase 6: Audit
    if state["phase"] == "auditing":
        print("Phase 6: Running integrity audit...")
        run_script("audit.py", [
            "--plan", str(workspace / "plan.json"),
            "--findings-dir", str(workspace / "findings"),
            "--output", str(workspace / "audit_report.json"),
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
    audit_exists = (workspace / "audit_report.json").exists()
    package_exists = (workspace / "package.json").exists()

    return {
        "phase": state.get("phase", "unknown"),
        "loop": state.get("loop", 0),
        "query": state.get("query", ""),
        "started_at": state.get("started_at", ""),
        "files": {
            "plan": plan_exists,
            "report": report_exists,
            "audit": audit_exists,
            "package": package_exists,
        },
        "next_action": _recommend_next_action(state.get("phase", "unknown")),
    }


def _recommend_next_action(phase: str) -> str:
    actions = {
        "dispatch": "Dispatch subagents for pending tasks, then run: run-all --resume",
        "gap_analysis": "Run: run-all --resume (will process gaps automatically)",
        "merging": "Run: run-all --resume (will merge automatically)",
        "reporting": "Run: run-all --resume (will generate report automatically)",
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

    # status
    status_parser = subparsers.add_parser("status", help="Check orchestration status")
    status_parser.add_argument("--workspace", "-w", required=True, help="Workspace directory")

    args = parser.parse_args()

    if args.command == "run-all":
        workspace = Path(args.workspace)
        if not args.resume and not args.query:
            print("Error: --query is required for first run (or use --resume)", file=sys.stderr)
            return 1
        return run_all(args.query or "", workspace, args.template, resume=args.resume)

    if args.command == "status":
        workspace = Path(args.workspace)
        status = get_status(workspace)
        print(json.dumps(status, indent=2, ensure_ascii=False))
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
