#!/usr/bin/env python3
"""Unified CLI for the OpenCode Deep Research skill.

This script wraps the individual research helpers (plan, validate, gap,
merge, synthesize) into a single command-line entry point.

Typical workflow:

    deep_research.py plan --query "..." --workspace ./research
    # run research subagents, writing findings to <workspace>/findings/
    deep_research.py gaps --workspace ./research   # optional loop
    deep_research.py merge --workspace ./research
    deep_research.py report --workspace ./research

If --workspace is omitted, the CLI defaults to the current working directory.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = SKILL_DIR / "scripts"


def resolve_workspace(args: argparse.Namespace) -> Path:
    """Resolve workspace from CLI args or fall back to current working directory."""
    if args.workspace:
        return Path(args.workspace)
    return Path.cwd()


def run_script(script_name: str, extra_args: list[str]) -> int:
    """Run a helper script with the current Python interpreter."""
    cmd = [sys.executable, str(SCRIPTS_DIR / script_name), *extra_args]
    return subprocess.run(cmd, check=False).returncode


def run_plan(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    workspace.mkdir(parents=True, exist_ok=True)
    plan_path = workspace / "plan.json"

    cmd_args: list[str] = [
        "--query", args.query,
        "--template", args.template,
        "--output", str(plan_path),
    ]
    if args.context:
        cmd_args.extend(["--context", args.context])
    return run_script("plan.py", cmd_args)


def run_add_items(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    plan_path = workspace / "plan.json"

    if not plan_path.exists():
        print(f"Error: no plan.json found in {workspace}", file=sys.stderr)
        return 1

    return run_script("plan.py", [
        "--input", str(plan_path),
        "--add-items", args.items_json,
        "--output", str(plan_path),
    ])


def run_add_fields(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    plan_path = workspace / "plan.json"

    if not plan_path.exists():
        print(f"Error: no plan.json found in {workspace}", file=sys.stderr)
        return 1

    return run_script("plan.py", [
        "--input", str(plan_path),
        "--add-fields", args.fields_json,
        "--output", str(plan_path),
    ])


def run_merge(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    findings_dir = workspace / "findings"
    output = workspace / "findings_merged.json"

    return run_script("merge.py", [
        "--input-dir", str(findings_dir),
        "--output", str(output),
    ])


def run_gaps(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    plan_path = workspace / "plan.json"
    findings_dir = workspace / "findings"
    output = workspace / "gap_report.json"

    if not plan_path.exists():
        print(f"Error: no plan.json found in {workspace}", file=sys.stderr)
        return 1

    return run_script("gap_analysis.py", [
        "--plan", str(plan_path),
        "--findings-dir", str(findings_dir),
        "--output", str(output),
    ])


def run_validate(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    plan_path = workspace / "plan.json"
    findings_path = workspace / "findings" / f"{args.task_id}.json"

    if not plan_path.exists():
        print(f"Error: no plan.json found in {workspace}", file=sys.stderr)
        return 1
    if not findings_path.exists():
        print(f"Error: findings not found: {findings_path}", file=sys.stderr)
        return 1

    return run_script("validate.py", [
        "--plan", str(plan_path),
        "--findings", str(findings_path),
    ])


def run_report(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    findings_dir = workspace / "findings"
    plan_path = workspace / "plan.json"
    output = workspace / "report.md"

    if not plan_path.exists() and not args.plan:
        print(
            "Error: no plan.json found in workspace. Run `plan` first or pass --plan.",
            file=sys.stderr,
        )
        return 1

    used_plan = Path(args.plan) if args.plan else plan_path

    return run_script("synthesize.py", [
        "--plan", str(used_plan),
        "--findings-dir", str(findings_dir),
        "--output", str(output),
    ])


def run_audit(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    plan_path = workspace / "plan.json"
    findings_dir = workspace / "findings"
    output = workspace / "audit_report.json"

    if not plan_path.exists():
        print(f"Error: no plan.json found in {workspace}", file=sys.stderr)
        return 1

    return run_script("audit.py", [
        "--plan", str(plan_path),
        "--findings-dir", str(findings_dir),
        "--output", str(output),
    ])


def run_package(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    return run_script("package.py", ["--workspace", str(workspace)])


def run_provenance(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    return run_script("provenance.py", [
        "--workspace", str(workspace),
        "--format", args.format,
    ])


def run_status(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    return run_script("orchestrate.py", [
        "status", "--workspace", str(workspace),
    ])


def run_pipeline(args: argparse.Namespace) -> int:
    workspace = resolve_workspace(args)
    extra_args = ["run-all", "--workspace", str(workspace)]
    if args.resume:
        extra_args.append("--resume")
    elif args.query:
        extra_args.extend(["--query", args.query])
        if args.template:
            extra_args.extend(["--template", args.template])
    else:
        print("Error: --query or --resume required", file=sys.stderr)
        return 1
    return run_script("orchestrate.py", extra_args)


def run_all(args: argparse.Namespace) -> int:
    """Plan + prompt for research."""
    workspace = resolve_workspace(args)
    workspace.mkdir(parents=True, exist_ok=True)

    rc = run_plan(args)
    if rc != 0:
        return rc

    print(
        "\nPlan created. Now run your web/github/codebase subagents and write "
        f"findings to {workspace / 'findings'}/. Then run:\n\n"
        f"  deep_research.py gaps --workspace {workspace}\n"
        f"  deep_research.py merge --workspace {workspace}\n"
        f"  deep_research.py report --workspace {workspace}\n"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="deep_research",
        description="OpenCode Deep Research unified CLI",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # plan
    plan_parser = subparsers.add_parser("plan", help="Generate a research plan")
    plan_parser.add_argument("--query", "-q", required=True, help="Research query")
    plan_parser.add_argument("--context", "-c", default="", help="Additional research context")
    plan_parser.add_argument("--template", "-t", default="survey", choices=["comparison", "survey", "technical", "custom"],
                            help="Report template (default: survey)")
    plan_parser.add_argument("--workspace", "-w", help="Working directory (default: current directory)")
    plan_parser.set_defaults(func=run_plan)

    # add-items
    add_items_parser = subparsers.add_parser("add-items", help="Add research items to an existing plan")
    add_items_parser.add_argument("--items-json", required=True, help="JSON list of items to add")
    add_items_parser.add_argument("--workspace", "-w", help="Working directory")
    add_items_parser.set_defaults(func=run_add_items)

    # add-fields
    add_fields_parser = subparsers.add_parser("add-fields", help="Add research fields to an existing plan")
    add_fields_parser.add_argument("--fields-json", required=True, help="JSON list of fields to add")
    add_fields_parser.add_argument("--workspace", "-w", help="Working directory")
    add_fields_parser.set_defaults(func=run_add_fields)

    # merge
    merge_parser = subparsers.add_parser("merge", help="Merge findings into a single view")
    merge_parser.add_argument("--workspace", "-w", help="Working directory")
    merge_parser.set_defaults(func=run_merge)

    # gaps
    gaps_parser = subparsers.add_parser("gaps", help="Detect coverage gaps and propose new tasks")
    gaps_parser.add_argument("--workspace", "-w", help="Working directory")
    gaps_parser.set_defaults(func=run_gaps)

    # validate
    validate_parser = subparsers.add_parser("validate", help="Validate a findings file against the plan")
    validate_parser.add_argument("--task-id", required=True, help="Task ID whose findings to validate")
    validate_parser.add_argument("--workspace", "-w", help="Working directory")
    validate_parser.set_defaults(func=run_validate)

    # report
    report_parser = subparsers.add_parser("report", help="Generate the Markdown report from findings")
    report_parser.add_argument("--workspace", "-w", help="Working directory")
    report_parser.add_argument("--plan", "-p", help="Path to a custom plan.json")
    report_parser.set_defaults(func=run_report)

    # audit
    audit_parser = subparsers.add_parser("audit", help="Run integrity audit on findings")
    audit_parser.add_argument("--workspace", "-w", help="Working directory")
    audit_parser.set_defaults(func=run_audit)

    # package
    package_parser = subparsers.add_parser("package", help="Generate artifact package manifest")
    package_parser.add_argument("--workspace", "-w", help="Working directory")
    package_parser.set_defaults(func=run_package)

    # provenance
    provenance_parser = subparsers.add_parser("provenance", help="View provenance log")
    provenance_parser.add_argument("--workspace", "-w", help="Working directory")
    provenance_parser.add_argument("--format", "-f", default="summary",
                                  choices=["summary", "json", "timeline"])
    provenance_parser.set_defaults(func=run_provenance)

    # status
    status_parser = subparsers.add_parser("status", help="Check orchestration status")
    status_parser.add_argument("--workspace", "-w", help="Working directory")
    status_parser.set_defaults(func=run_status)

    # run-all
    runall_parser = subparsers.add_parser("run-all", help="Run full research pipeline (with pause/resume)")
    runall_parser.add_argument("--query", "-q", help="Research query (required for first run)")
    runall_parser.add_argument("--template", "-t", default="survey",
                              choices=["comparison", "survey", "technical", "custom"])
    runall_parser.add_argument("--workspace", "-w", help="Working directory")
    runall_parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    runall_parser.set_defaults(func=run_pipeline)

    # run
    run_parser = subparsers.add_parser("run", help="Create plan and prompt for research")
    run_parser.add_argument("--query", "-q", required=True, help="Research query")
    run_parser.add_argument("--context", "-c", default="", help="Additional research context")
    run_parser.add_argument("--template", "-t", default="survey", choices=["comparison", "survey", "technical", "custom"],
                           help="Report template (default: survey)")
    run_parser.add_argument("--workspace", "-w", help="Working directory")
    run_parser.set_defaults(func=run_all)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
