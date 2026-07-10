#!/usr/bin/env python3
"""Integrity audit for deep-research findings.

Runs automated checks on research findings and produces an audit report.
Checks: missing_sources, conflicting_data, coverage_gaps, source_duplicates.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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


def check_missing_sources(findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Check for finding entries without source/url/file references."""
    issues: list[dict[str, Any]] = []
    for finding in findings:
        task_id = finding.get("task_id", "unknown")
        for i, entry in enumerate(finding.get("findings", [])):
            if not entry.get("source") and not entry.get("url") and not entry.get("file"):
                issues.append({
                    "task_id": task_id,
                    "finding_index": i,
                    "message": "Finding entry has no source/url/file reference",
                })
    return {
        "check": "missing_sources",
        "count": len(issues),
        "severity": "warning" if issues else "info",
        "items": issues,
    }


def check_conflicting_data(plan: dict[str, Any], findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Check for conflicting values across sources for the same field."""
    field_data: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for finding in findings:
        item_id = finding.get("item_id")
        if not item_id:
            continue
        for entry in finding.get("findings", []):
            source = entry.get("source") or entry.get("url") or entry.get("file") or "unknown"
            fd = entry.get("field_data", {})
            if not isinstance(fd, dict):
                continue
            for fid, value in fd.items():
                if not value or (isinstance(value, str) and "[uncertain]" in value):
                    continue
                key = (item_id, fid)
                field_data.setdefault(key, []).append((str(value), source))

    issues: list[dict[str, Any]] = []
    for (item_id, fid), values in field_data.items():
        unique = set(v for v, _ in values)
        if len(unique) > 1:
            issues.append({
                "item_id": item_id,
                "field_id": fid,
                "values": list(unique),
                "sources": [s for _, s in values],
                "message": f"Conflicting values for {item_id}/{fid}",
            })
    return {
        "check": "conflicting_data",
        "count": len(issues),
        "severity": "error" if issues else "info",
        "items": issues,
    }


def check_coverage_gaps(plan: dict[str, Any], findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Check for required fields with no data."""
    required_fields = {f["id"] for f in plan.get("fields", []) if f.get("required")}
    items = {item["id"] for item in plan.get("items", [])}

    covered: set[tuple[str, str]] = set()
    for finding in findings:
        item_id = finding.get("item_id")
        if not item_id or item_id not in items:
            continue
        for entry in finding.get("findings", []):
            fd = entry.get("field_data", {})
            if not isinstance(fd, dict):
                continue
            for fid, value in fd.items():
                if value and not (isinstance(value, str) and "[uncertain]" in value):
                    covered.add((item_id, fid))

    issues: list[dict[str, Any]] = []
    for item_id in items:
        for fid in required_fields:
            if (item_id, fid) not in covered:
                issues.append({
                    "item_id": item_id,
                    "field_id": fid,
                    "message": f"Required field {fid} has no data for {item_id}",
                })
    return {
        "check": "coverage_gaps",
        "count": len(issues),
        "severity": "error" if issues else "info",
        "items": issues,
    }


def check_source_duplicates(findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Check for duplicate source references across different tasks."""
    source_map: dict[str, list[str]] = {}
    for finding in findings:
        task_id = finding.get("task_id", "unknown")
        for entry in finding.get("findings", []):
            source = entry.get("source") or entry.get("url") or entry.get("file")
            if source:
                source_map.setdefault(source, []).append(task_id)

    issues: list[dict[str, Any]] = []
    for source, task_ids in source_map.items():
        unique_tasks = list(set(task_ids))
        if len(unique_tasks) > 1:
            issues.append({
                "source": source,
                "task_ids": unique_tasks,
                "message": f"Source referenced by {len(unique_tasks)} different tasks",
            })
    return {
        "check": "source_duplicates",
        "count": len(issues),
        "severity": "warning" if issues else "info",
        "items": issues,
    }


def calculate_score(checks: list[dict[str, Any]]) -> int:
    """Calculate an overall audit score (0-100)."""
    penalties = {"info": 0, "warning": 5, "error": 15, "critical": 30}
    total_penalty = 0
    for check in checks:
        severity = check.get("severity", "info")
        count = check.get("count", 0)
        total_penalty += penalties.get(severity, 0) * min(count, 5)
    return max(0, 100 - total_penalty)


def generate_recommendations(checks: list[dict[str, Any]]) -> list[str]:
    """Generate human-readable recommendations based on audit results."""
    recommendations: list[str] = []
    for check in checks:
        if check["count"] > 0:
            if check["check"] == "missing_sources":
                recommendations.append(
                    f"Add source references to {check['count']} finding entries lacking citations."
                )
            elif check["check"] == "conflicting_data":
                recommendations.append(
                    f"Resolve {check['count']} conflicting data points by verifying with additional sources."
                )
            elif check["check"] == "coverage_gaps":
                recommendations.append(
                    f"Fill {check['count']} required field gaps with additional research."
                )
            elif check["check"] == "source_duplicates":
                recommendations.append(
                    f"Review {check['count']} sources referenced by multiple tasks for potential redundancy."
                )
    if not recommendations:
        recommendations.append("No issues found. Research integrity looks good.")
    return recommendations


def run_audit(plan_path: Path, findings_dir: Path) -> dict[str, Any]:
    """Run all audit checks and return the audit report."""
    plan = load_plan(plan_path)
    findings = load_findings(findings_dir)

    checks = [
        check_missing_sources(findings),
        check_conflicting_data(plan, findings),
        check_coverage_gaps(plan, findings),
        check_source_duplicates(findings),
    ]

    score = calculate_score(checks)

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "overall_score": score,
        "checks": {c["check"]: c for c in checks},
        "recommendations": generate_recommendations(checks),
    }


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Run integrity audit on deep-research findings.")
    parser.add_argument("--plan", "-p", required=True, help="Path to plan.json")
    parser.add_argument("--findings-dir", "-f", required=True, help="Directory containing findings JSON files")
    parser.add_argument("--output", "-o", required=True, help="Output audit report path")
    args = parser.parse_args()

    plan_path = Path(args.plan)
    findings_dir = Path(args.findings_dir)
    output_path = Path(args.output)

    if not plan_path.exists():
        print(f"Error: plan not found: {plan_path}", file=sys.stderr)
        return 1

    try:
        report = run_audit(plan_path, findings_dir)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    score = report["overall_score"]
    total_issues = sum(c["count"] for c in report["checks"].values())
    print(f"Audit complete: score {score}/100, {total_issues} issue(s) found.")
    print(f"Report written to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
