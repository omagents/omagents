#!/usr/bin/env python3
"""Generate an artifact package manifest for a deep-research workspace."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def generate_package(workspace: Path) -> dict[str, Any]:
    """Generate package.json manifest and README.md index."""
    artifacts_dir = workspace / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    plan_path = workspace / "plan.json"
    report_path = workspace / "report.md"
    findings_dir = workspace / "findings"
    merged_path = artifacts_dir / "findings_merged.json"
    gap_path = artifacts_dir / "gap_report.json"
    provenance_path = artifacts_dir / "provenance.jsonl"
    audit_path = artifacts_dir / "audit_report.json"

    plan = load_json(plan_path) if plan_path.exists() else {}

    items_count = len(plan.get("items", []))
    fields_count = len(plan.get("fields", []))
    tasks = plan.get("tasks", [])
    tasks_completed = sum(1 for t in tasks if t.get("status") == "completed")
    research_loops = plan.get("metadata", {}).get("research_loops_completed", 0)

    overall_coverage = None
    if gap_path.exists():
        try:
            gap_report = load_json(gap_path)
            overall_coverage = gap_report.get("overall_coverage")
        except json.JSONDecodeError:
            pass

    audit_score = None
    if audit_path.exists():
        try:
            audit_report = load_json(audit_path)
            audit_score = audit_report.get("overall_score")
        except json.JSONDecodeError:
            pass

    files: dict[str, str | None] = {}
    expected_files = {
        "report": report_path,
        "findings": findings_dir,
        "merged": merged_path,
        "gaps": gap_path,
        "provenance": provenance_path,
        "audit": audit_path,
        "pre_research": workspace / "pre_research.json",
    }
    for key, path in expected_files.items():
        files[key] = str(path.relative_to(workspace)) if path.exists() else None

    # Dynamically discover any additional artifacts
    if artifacts_dir.exists():
        for entry in sorted(artifacts_dir.iterdir()):
            if entry.is_file() and entry.name not in ("package.json", "README.md"):
                rel = str(entry.relative_to(workspace))
                if rel not in [v for v in files.values() if v]:
                    files[f"artifact_{entry.stem}"] = rel

    manifest: dict[str, Any] = {
        "version": 1,
        "query": plan.get("query", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "template": plan.get("template", ""),
        "files": files,
        "stats": {
            "items": items_count,
            "fields": fields_count,
            "tasks_completed": tasks_completed,
            "research_loops": research_loops,
            "overall_coverage": overall_coverage,
            "audit_score": audit_score,
        },
    }

    manifest_path = artifacts_dir / "package.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    readme = generate_readme(manifest)
    (artifacts_dir / "README.md").write_text(readme, encoding="utf-8")

    return manifest


def generate_readme(manifest: dict[str, Any]) -> str:
    """Generate a README.md index for the research package."""
    stats = manifest.get("stats", {})
    files = manifest.get("files", {})

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

    lines.extend(["", "## Files", ""])

    file_labels = {
        "report": "Main Report",
        "findings": "Raw Findings",
        "merged": "Merged Findings",
        "gaps": "Gap Report",
        "provenance": "Provenance Log",
        "audit": "Audit Report",
        "pre_research": "Pre-Research Scan",
    }

    for key, label in file_labels.items():
        path = files.get(key)
        if path:
            lines.append(f"- [{label}]({path})")
        else:
            lines.append(f"- {label}: _not available_")

    # Add any dynamically discovered artifacts
    for key, path in files.items():
        if key.startswith("artifact_") and path:
            label = key.replace("artifact_", "").replace("_", " ").title()
            lines.append(f"- [{label}]({path})")

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

    if not (workspace / "plan.json").exists():
        print(f"Error: no plan.json found in {workspace}", file=sys.stderr)
        return 1

    manifest = generate_package(workspace)
    print(f"Package manifest written to {workspace / 'artifacts' / 'package.json'}")
    print(f"  Items: {manifest['stats']['items']}, Fields: {manifest['stats']['fields']}")
    print(f"  Coverage: {manifest['stats'].get('overall_coverage', 'N/A')}")
    print(f"  Audit score: {manifest['stats'].get('audit_score', 'N/A')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
