#!/usr/bin/env python3
"""Merge multiple findings JSON files into a single structured view."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load_findings(input_dir: Path) -> list[dict[str, Any]]:
    """Load all findings JSON files from a directory."""
    if not input_dir.exists():
        return []

    findings: list[dict[str, Any]] = []
    for path in sorted(input_dir.glob("*.json")):
        if path.name == "merged.json" or path.name.endswith("_merged.json"):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"Warning: skipping invalid JSON {path}: {exc}")
            continue

        if isinstance(data, dict):
            findings.append(data)
        elif isinstance(data, list):
            findings.extend(data)
        else:
            print(f"Warning: unexpected format in {path}")

    return findings


def merge_findings(findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge findings into a single structure grouped by source type."""
    merged: dict[str, Any] = {
        "web": [],
        "github": [],
        "codebase": [],
        "gaps": [],
    }

    seen_sources: set[str] = set()

    for finding in findings:
        ftype = finding.get("type", "web")
        if ftype not in merged:
            ftype = "web"

        items = finding.get("findings", [])
        for item in items:
            source = item.get("source") or item.get("url") or item.get("file") or item.get("repo")
            if source and source in seen_sources:
                continue
            if source:
                seen_sources.add(source)
            merged[ftype].append(item)

        for gap in finding.get("gaps", []) or []:
            if gap and gap not in merged["gaps"]:
                merged["gaps"].append(gap)

    # Add metadata
    merged["summary"] = {
        "total_findings": sum(len(merged[t]) for t in ("web", "github", "codebase")),
        "web_count": len(merged["web"]),
        "github_count": len(merged["github"]),
        "codebase_count": len(merged["codebase"]),
        "gap_count": len(merged["gaps"]),
    }

    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge deep-research findings.")
    parser.add_argument("--input-dir", "-i", required=True, help="Directory containing findings JSON files")
    parser.add_argument("--output", "-o", help="Output file (default: stdout)")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    findings = load_findings(input_dir)
    merged = merge_findings(findings)

    merged_json = json.dumps(merged, indent=2, ensure_ascii=False)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(merged_json, encoding="utf-8")
        print(f"Merged findings written to {args.output}")
    else:
        print(merged_json)


if __name__ == "__main__":
    main()
