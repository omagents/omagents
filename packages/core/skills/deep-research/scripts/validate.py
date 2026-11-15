#!/usr/bin/env python3
"""Validate a findings JSON file against a deep-research plan.

Checks that the findings file:
1. Conforms to the expected v2 schema
2. References valid item_id and field_ids from the plan
3. Provides data for all required fields when possible
4. Marks uncertain values appropriately
"""

from __future__ import annotations

import argparse
import json
import sys
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


def validate_findings(findings: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    """Validate a single findings file."""
    result = {
        "valid": True,
        "errors": [],
        "warnings": [],
        "coverage": {},
    }

    if not isinstance(findings, dict):
        result["valid"] = False
        result["errors"].append("Findings must be a JSON object")
        return result

    # Check required top-level fields
    for field in ["type", "task_id", "item_id", "field_ids", "findings"]:
        if field not in findings:
            result["valid"] = False
            result["errors"].append(f"Missing required field: {field}")

    if not result["valid"]:
        return result

    # Validate type
    if findings.get("type") not in {"web", "github", "codebase"}:
        result["valid"] = False
        result["errors"].append(
            f"Invalid type '{findings.get('type')}'. Must be web/github/codebase."
        )

    # Validate item_id
    item_id = findings.get("item_id")
    valid_items = {item["id"]: item for item in plan.get("items", [])}
    if item_id not in valid_items:
        result["valid"] = False
        result["errors"].append(f"Unknown item_id '{item_id}'")

    # Validate field_ids
    valid_fields = {field["id"]: field for field in plan.get("fields", [])}
    field_ids = findings.get("field_ids", [])
    for fid in field_ids:
        if fid not in valid_fields:
            result["valid"] = False
            result["errors"].append(f"Unknown field_id '{fid}'")

    # Validate findings array
    findings_list = findings.get("findings", [])
    if not isinstance(findings_list, list):
        result["valid"] = False
        result["errors"].append("'findings' must be a list")
        return result

    for i, finding in enumerate(findings_list):
        if not isinstance(finding, dict):
            result["valid"] = False
            result["errors"].append(f"findings[{i}] must be an object")
            continue

        # Each finding should have a source reference
        if not finding.get("source") and not finding.get("url") and not finding.get("file"):
            result["warnings"].append(f"findings[{i}] missing source/url/file reference")

        # Validate field_data
        field_data = finding.get("field_data", {})
        if not isinstance(field_data, dict):
            result["valid"] = False
            result["errors"].append(f"findings[{i}].field_data must be an object")

        # Check relevance
        relevance = finding.get("relevance")
        if relevance and relevance not in {"high", "medium", "low"}:
            result["warnings"].append(
                f"findings[{i}] has invalid relevance '{relevance}'. Use high/medium/low."
            )

    # Coverage: check which of the task's field_ids are covered by at least one finding
    covered_fields: set[str] = set()
    for finding in findings_list:
        field_data = finding.get("field_data", {})
        if isinstance(field_data, dict):
            for fid, value in field_data.items():
                if value and not (isinstance(value, str) and "[uncertain]" in value):
                    covered_fields.add(fid)

    result["coverage"] = {
        fid: ("covered" if fid in covered_fields else "missing")
        for fid in field_ids
    }

    missing = set(field_ids) - covered_fields
    if missing:
        result["warnings"].append(
            f"Fields with no non-uncertain coverage: {sorted(missing)}"
        )

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate findings JSON against a plan.")
    parser.add_argument("--plan", "-p", required=True, help="Path to plan.json")
    parser.add_argument("--findings", "-f", required=True, help="Path to findings JSON file")
    args = parser.parse_args()

    plan_path = Path(args.plan)
    findings_path = Path(args.findings)

    if not plan_path.exists():
        print(f"Error: plan not found: {plan_path}", file=sys.stderr)
        return 1
    if not findings_path.exists():
        print(f"Error: findings not found: {findings_path}", file=sys.stderr)
        return 1

    try:
        plan = load_plan(plan_path)
        findings = load_json(findings_path)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    result = validate_findings(findings, plan)

    print(f"Validation: {'PASS' if result['valid'] else 'FAIL'}")
    if result["warnings"]:
        print(f"Warnings ({len(result['warnings'])}):")
        for warning in result["warnings"]:
            print(f"  - {warning}")
    if result["errors"]:
        print(f"Errors ({len(result['errors'])}):")
        for error in result["errors"]:
            print(f"  - {error}")

    return 0 if result["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
