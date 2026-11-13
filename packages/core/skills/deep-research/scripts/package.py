#!/usr/bin/env python3
"""Generate an artifact package manifest for a deep-research workspace."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from layout import ResearchLayout


class PackageInputError(ValueError):
    """Raised when a required package input is invalid."""


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _required_plan(path: Path) -> dict[str, Any]:
    try:
        plan = load_json(path)
    except (OSError, json.JSONDecodeError) as exc:
        raise PackageInputError(f"invalid plan.json at {path}: {exc}") from exc
    if not isinstance(plan, dict):
        raise PackageInputError(f"plan.json must contain an object: {path}")
    for field in ("version", "query", "items", "fields", "tasks"):
        if field not in plan:
            raise PackageInputError(f"invalid plan.json at {path}: missing {field}")
    return plan


def _existing_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return load_json(path)
    except json.JSONDecodeError:
        return {}


def _derived_path(layout: ResearchLayout, canonical: Path, legacy_name: str) -> Path:
    if layout.legacy and not canonical.exists():
        return layout.storage_dir / legacy_name
    return canonical


def _deliverable_link(layout: ResearchLayout, path: Path) -> str:
    relative = os.path.relpath(path, layout.readme_path.parent).replace(os.sep, "/")
    return quote(relative, safe="/")


def _markdown_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")


def generate_package(workspace: Path) -> dict[str, Any]:
    """Generate package.json manifest and a human deliverable index."""
    layout = ResearchLayout.resolve(workspace)
    layout.artifacts_dir.mkdir(parents=True, exist_ok=True)

    plan = _required_plan(layout.plan_path)
    gap_path = _derived_path(layout, layout.gap_path, "gap_report.json")
    audit_path = _derived_path(layout, layout.audit_path, "audit_report.json")
    gap_report = _existing_json(gap_path)
    audit_report = _existing_json(audit_path)

    items_count = len(plan.get("items", []))
    fields_count = len(plan.get("fields", []))
    tasks = plan.get("tasks", [])
    tasks_completed = sum(1 for task in tasks if task.get("status") == "completed")
    research_loops = plan.get("metadata", {}).get("research_loops_completed", 0)

    expected_files = {
        "report": layout.report_path,
        "summary": layout.summary_path,
        "plan": layout.plan_path,
        "findings": layout.findings_dir,
        "merged": layout.merged_path,
        "gaps": gap_path,
        "provenance": layout.provenance_path,
        "audit": audit_path,
        "pre_research": layout.pre_research_path,
    }
    files: dict[str, str | None] = {}
    for key, path in expected_files.items():
        files[key] = layout.display_path(path) if path.exists() else None

    deliverables: dict[str, str] = {}
    for key in ("report", "summary"):
        path = expected_files[key]
        if path.exists():
            deliverables[key] = _deliverable_link(layout, path)

    for path in sorted(layout.workspace.glob("*.md")):
        if path.name in {"README.md", "report.md", "summary.md"}:
            continue
        key = f"deliverable_{path.stem}"
        deliverables[key] = _deliverable_link(layout, path)
        files[key] = layout.display_path(path)

    if layout.artifacts_dir.exists():
        known = {value for value in files.values() if value}
        for entry in sorted(layout.artifacts_dir.iterdir()):
            if entry.is_file() and entry.name not in ("package.json", "README.md"):
                displayed = layout.display_path(entry)
                if displayed not in known:
                    files[f"artifact_{entry.stem}"] = displayed
                    known.add(displayed)

    manifest: dict[str, Any] = {
        "version": 1,
        "query": plan.get("query", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "template": plan.get("template", ""),
        "workspace": layout.display_path(layout.workspace),
        "run_id": layout.run_id,
        "layout": "legacy" if layout.legacy else "run",
        "files": files,
        "deliverables": deliverables,
        "stats": {
            "items": items_count,
            "fields": fields_count,
            "tasks_completed": tasks_completed,
            "research_loops": research_loops,
            "overall_coverage": gap_report.get("overall_coverage"),
            "audit_score": audit_report.get("overall_score"),
        },
    }

    layout.package_path.parent.mkdir(parents=True, exist_ok=True)
    layout.package_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    readme = generate_readme(manifest)
    layout.readme_path.parent.mkdir(parents=True, exist_ok=True)
    layout.readme_path.write_text(readme, encoding="utf-8")

    return manifest


def generate_readme(manifest: dict[str, Any]) -> str:
    """Generate a README index containing only public deliverables."""
    stats = manifest.get("stats", {})
    deliverables = manifest.get("deliverables", {})

    lines = [
        f"# Research Package: {manifest.get('query', 'Unknown')}",
        "",
        f"**Template:** {manifest.get('template', 'N/A')}  ",
        f"**Created:** {manifest.get('created_at', 'N/A')}",
        "",
        "## Statistics",
        "",
        f"- Items: {stats.get('items', 0)}",
        f"- Fields: {stats.get('fields', 0)}",
        f"- Tasks completed: {stats.get('tasks_completed', 0)}",
        f"- Research loops: {stats.get('research_loops', 0)}",
    ]

    coverage = stats.get("overall_coverage")
    if coverage is not None:
        lines.append(f"- Overall coverage: {coverage * 100:.0f}%")
    else:
        lines.append("- Overall coverage: N/A")

    audit = stats.get("audit_score")
    if audit is not None:
        lines.append(f"- Audit score: {audit}/100")
    else:
        lines.append("- Audit score: N/A")

    lines.extend(["", "## Deliverables", ""])
    labels = {
        "report": "Main Report",
        "summary": "Executive Summary",
    }
    for key, label in labels.items():
        link = deliverables.get(key)
        if link:
            lines.append(f"- [{label}]({link})")

    for key, link in deliverables.items():
        if key.startswith("deliverable_"):
            label = key.removeprefix("deliverable_").replace("_", " ").title()
            lines.append(f"- [{_markdown_label(label)}]({link})")

    if not deliverables:
        lines.append("- _No public deliverables available_")

    return "\n".join(lines) + "\n"


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Generate artifact package for a deep-research workspace.")
    parser.add_argument("--workspace", "-w", required=True, help="Workspace directory")
    args = parser.parse_args()

    workspace = Path(args.workspace)
    if not workspace.exists():
        print(f"Error: workspace not found: {workspace}", file=sys.stderr)
        return 1

    layout = ResearchLayout.resolve(workspace)
    if not layout.plan_path.exists():
        print(f"Error: no plan.json found for {layout.workspace}", file=sys.stderr)
        return 1

    try:
        manifest = generate_package(layout.workspace)
    except PackageInputError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    print(f"Package manifest written to {layout.package_path}")
    print(f"  Items: {manifest['stats']['items']}, Fields: {manifest['stats']['fields']}")
    print(f"  Coverage: {manifest['stats'].get('overall_coverage', 'N/A')}")
    print(f"  Audit score: {manifest['stats'].get('audit_score', 'N/A')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
