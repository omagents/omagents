#!/usr/bin/env python3
"""Detect coverage gaps across findings and propose new research tasks.

Reads plan.json and all findings/*.json, builds an item x field coverage
matrix, identifies missing or weakly-covered fields, and emits a gap report
that can drive another research loop.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


RELEVANCE_ORDER = {"high": 3, "medium": 2, "low": 1, "none": 0}

# Map field categories to preferred source types for gap-fill tasks
FIELD_CATEGORY_SOURCES: dict[str, list[str]] = {
    "Legal": ["github", "web"],
    "Technical": ["codebase", "github", "web"],
    "Implementation": ["codebase", "github"],
    "Performance": ["web", "github"],
    "Version": ["web", "github"],
    "Assessment": ["web", "github"],
    "General": ["web", "github", "codebase"],
}


def _pick_source_type(field: dict[str, Any], config: dict[str, Any]) -> str:
    """Pick the best source type for a gap-fill task based on field category."""
    category = field.get("category", "General")
    search_tools = config.get("search_tools", ["websearch", "github", "codegraph"])

    # Map config search_tools to task types
    available: list[str] = []
    if "websearch" in search_tools:
        available.append("web")
    if "github" in search_tools:
        available.append("github")
    if "codegraph" in search_tools:
        available.append("codebase")

    if not available:
        available = ["web"]

    preferred = FIELD_CATEGORY_SOURCES.get(category, FIELD_CATEGORY_SOURCES["General"])

    # Return the first preferred source that's available
    for source in preferred:
        if source in available:
            return source

    return available[0]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_plan(path: Path) -> dict[str, Any]:
    plan = load_json(path)
    if not isinstance(plan, dict):
        raise ValueError("Plan must be a JSON object")
    if plan.get("version") != 2:
        raise ValueError(f"Expected plan version 2, got {plan.get('version')}")
    return plan


def load_findings(findings_dir: Path) -> list[dict[str, Any]]:
    """Load all findings JSON files from a directory."""
    if not findings_dir.exists():
        return []

    findings: list[dict[str, Any]] = []
    for path in sorted(findings_dir.glob("*.json")):
        if path.name.endswith("_merged.json") or path.name == "merged.json":
            continue
        try:
            data = load_json(path)
        except json.JSONDecodeError:
            continue

        if isinstance(data, dict):
            findings.append(data)
        elif isinstance(data, list):
            findings.extend(data)

    return findings


def assess_confidence(sources: int, relevance_scores: list[int]) -> str:
    """Assess confidence based on number of sources and relevance scores."""
    if sources == 0:
        return "none"
    avg_relevance = sum(relevance_scores) / len(relevance_scores) if relevance_scores else 0
    if sources >= 2 and avg_relevance >= RELEVANCE_ORDER["high"]:
        return "high"
    if sources >= 1 and avg_relevance >= RELEVANCE_ORDER["medium"]:
        return "medium"
    return "low"


def build_coverage_matrix(plan: dict[str, Any], findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Build an coverage matrix: item_id -> field_id -> {covered, sources, confidence}."""
    items = plan.get("items", [])
    fields = plan.get("fields", [])

    matrix: dict[str, Any] = {}
    for item in items:
        matrix[item["id"]] = {}
        for field in fields:
            matrix[item["id"]][field["id"]] = {
                "covered": False,
                "sources": 0,
                "confidence": "none",
            }

    # Aggregate findings by item and field
    for finding in findings:
        item_id = finding.get("item_id")
        if item_id not in matrix:
            continue

        for entry in finding.get("findings", []):
            field_data = entry.get("field_data", {})
            if not isinstance(field_data, dict):
                continue

            relevance = RELEVANCE_ORDER.get(entry.get("relevance", "medium"), 2)
            for fid, value in field_data.items():
                if fid not in matrix[item_id]:
                    continue
                if not value or (isinstance(value, str) and "[uncertain]" in value):
                    continue

                cell = matrix[item_id][fid]
                cell["sources"] += 1
                # Use the highest relevance as the representative score
                cell.setdefault("_relevance_scores", []).append(relevance)

    # Compute confidence per cell
    for item_id, field_map in matrix.items():
        for fid, cell in field_map.items():
            scores = cell.pop("_relevance_scores", [])
            cell["confidence"] = assess_confidence(cell["sources"], scores)
            cell["covered"] = cell["sources"] > 0

    return matrix


def calculate_overall_coverage(matrix: dict[str, Any]) -> float:
    """Return the ratio of covered item-field cells."""
    total = 0
    covered = 0
    for field_map in matrix.values():
        for cell in field_map.values():
            total += 1
            if cell["covered"]:
                covered += 1
    return covered / total if total > 0 else 1.0


def detect_gaps(plan: dict[str, Any], matrix: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (gaps, new_tasks) based on coverage matrix.

    Source type for gap-fill tasks is chosen based on field category.
    Previously-tried gaps are tracked to avoid infinite repetition.
    """
    required_fields = {f["id"] for f in plan.get("fields", []) if f.get("required")}
    items = {item["id"]: item for item in plan.get("items", [])}
    fields = {field["id"]: field for field in plan.get("fields", [])}
    config = plan.get("config", {})

    gaps: list[dict[str, Any]] = []
    for item_id, field_map in matrix.items():
        for fid, cell in field_map.items():
            field_required = fid in required_fields
            if not cell["covered"] and field_required:
                gaps.append({
                    "item_id": item_id,
                    "field_id": fid,
                    "reason": "no_findings",
                    "severity": "high",
                })
            elif cell["covered"] and cell["confidence"] == "low":
                gaps.append({
                    "item_id": item_id,
                    "field_id": fid,
                    "reason": "low_confidence",
                    "severity": "medium",
                })

    # Load gap history to avoid repeating already-tried gaps
    max_loops = config.get("max_research_loops", 2)
    current_loop = plan.get("metadata", {}).get("research_loops_completed", 0)
    next_loop = current_loop + 1

    if next_loop > max_loops:
        return gaps, []

    # Build a set of (item_id, field_id) pairs that already have tasks
    existing_task_pairs: set[tuple[str, str]] = set()
    for task in plan.get("tasks", []):
        for fid in task.get("field_ids", []):
            existing_task_pairs.add((task.get("item_id", ""), fid))

    new_tasks: list[dict[str, Any]] = []
    task_index = len(plan.get("tasks", [])) + 1
    seen: set[tuple[str, str]] = set()

    for gap in gaps:
        key = (gap["item_id"], gap["field_id"])
        if key in seen:
            continue
        seen.add(key)

        item = items.get(gap["item_id"], {})
        field = fields.get(gap["field_id"], {})

        source_type = _pick_source_type(field, config)

        new_tasks.append({
            "id": f"task-r{next_loop}-{task_index}",
            "type": source_type,
            "item_id": gap["item_id"],
            "field_ids": [gap["field_id"]],
            "focus": (
                f"Supplemental {source_type} research for '{item.get('name', gap['item_id'])}' "
                f"on field '{field.get('name', gap['field_id'])}' "
                f"(reason: {gap['reason']})"
            ),
            "status": "pending",
            "iteration": next_loop,
        })
        task_index += 1

    return gaps, new_tasks


def analyze(plan_path: Path, findings_dir: Path) -> dict[str, Any]:
    plan = load_plan(plan_path)
    findings = load_findings(findings_dir)

    matrix = build_coverage_matrix(plan, findings)
    overall = calculate_overall_coverage(matrix)
    gaps, new_tasks = detect_gaps(plan, matrix)

    max_loops = plan.get("config", {}).get("max_research_loops", 2)
    current_loop = plan.get("metadata", {}).get("research_loops_completed", 0)

    return {
        "loop": current_loop + 1,
        "coverage_matrix": matrix,
        "overall_coverage": overall,
        "gaps": gaps,
        "new_tasks": new_tasks,
        "should_continue": bool(new_tasks) and current_loop < max_loops,
        "metadata": {
            "findings_loaded": len(findings),
            "max_loops": max_loops,
            "current_loop": current_loop,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze coverage gaps in research findings.")
    parser.add_argument("--plan", "-p", required=True, help="Path to plan.json")
    parser.add_argument("--findings-dir", "-f", required=True, help="Directory containing findings JSON")
    parser.add_argument("--output", "-o", help="Output file (default: stdout)")
    args = parser.parse_args()

    plan_path = Path(args.plan)
    findings_dir = Path(args.findings_dir)

    if not plan_path.exists():
        print(f"Error: plan not found: {plan_path}", file=sys.stderr)
        return 1
    if not findings_dir.exists():
        print(f"Warning: findings directory not found: {findings_dir}", file=sys.stderr)

    try:
        report = analyze(plan_path, findings_dir)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    report_json = json.dumps(report, indent=2, ensure_ascii=False)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(report_json, encoding="utf-8")
        print(f"Gap report written to {args.output}")

        # Log provenance
        try:
            from provenance import log_event
            log_event(output_path.parent, "gap_detected",
                      gap_count=len(report.get("gaps", [])),
                      new_task_count=len(report.get("new_tasks", [])),
                      overall_coverage=report.get("overall_coverage", 0))
        except ImportError:
            pass
    else:
        print(report_json)

    return 0


if __name__ == "__main__":
    sys.exit(main())
