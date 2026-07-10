#!/usr/bin/env python3
"""Synthesize a deep-research plan and findings into a Markdown report.

Uses Jinja2 templates stored in templates/<template>.md.tmpl.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

try:
    from jinja2 import Environment, FileSystemLoader, select_autoescape
except ImportError as exc:
    print(f"Error: jinja2 is required. Install it first: {exc}", file=sys.stderr)
    sys.exit(1)

try:
    from svg_charts import (
        coverage_heatmap,
        source_donut,
        research_timeline,
        comparison_radar,
        confidence_bars,
    )
except ImportError:
    coverage_heatmap = None
    source_donut = None
    research_timeline = None
    comparison_radar = None
    confidence_bars = None

try:
    from provenance import load_events, log_event
except ImportError:
    load_events = None
    log_event = None


SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = SKILL_DIR / "templates"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


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


def load_gap_report(workspace: Path) -> dict[str, Any] | None:
    # Try artifacts/ first, fall back to root for backward compat
    for gap_path in [workspace / "artifacts" / "gap_report.json", workspace / "gap_report.json"]:
        if gap_path.exists():
            try:
                return load_json(gap_path)
            except json.JSONDecodeError:
                pass
    return None


def collect_sources(findings: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Collect web URLs, GitHub repos, and code files from findings."""
    web_urls: list[str] = []
    github_repos: list[str] = []
    code_files: list[str] = []

    for finding in findings:
        ftype = finding.get("type", "web")
        for item in finding.get("findings", []):
            if ftype == "web":
                url = item.get("source")
                if url and url not in web_urls:
                    web_urls.append(url)
            elif ftype == "github":
                repo = item.get("repo")
                url = item.get("url")
                if repo and repo not in github_repos:
                    github_repos.append(repo)
                if not repo and url and url not in web_urls:
                    web_urls.append(url)
            elif ftype == "codebase":
                file_path = item.get("file")
                if file_path and file_path not in code_files:
                    code_files.append(file_path)

    return {
        "web": web_urls,
        "github": github_repos,
        "codebase": code_files,
    }


def build_item_field_data(
    plan: dict[str, Any], findings: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """Build data[item_id][field_id] from raw findings."""
    field_ids = {f["id"] for f in plan.get("fields", [])}
    data: dict[str, dict[str, Any]] = {}

    for finding in findings:
        item_id = finding.get("item_id")
        if not item_id:
            continue
        if item_id not in data:
            data[item_id] = {}

        for entry in finding.get("findings", []):
            field_data = entry.get("field_data", {})
            if not isinstance(field_data, dict):
                continue

            relevance = entry.get("relevance", "medium")
            source = entry.get("source") or entry.get("url") or entry.get("file") or "unknown"

            for fid, value in field_data.items():
                if fid not in field_ids:
                    continue
                if not value or (isinstance(value, str) and "[uncertain]" in value):
                    continue

                cell = data[item_id].setdefault(
                    fid,
                    {
                        "values": [],
                        "sources": [],
                        "relevance_scores": [],
                        "conflicts": [],
                    },
                )
                cell["values"].append(value)
                if source not in cell["sources"]:
                    cell["sources"].append(source)
                cell["relevance_scores"].append(relevance)

    return data


def assess_confidence(
    sources: list[str],
    relevance_scores: list[str],
    config: dict[str, Any] | None = None,
) -> str:
    """Assess confidence based on sources, relevance, and cross-source agreement.

    Dimensions:
    - Source count: more independent sources = higher confidence
    - Relevance: higher average relevance = higher confidence
    - Cross-source agreement: multiple sources with consistent data = bonus
    """
    cfg = config or {}
    weights = cfg.get("confidence_weights", {})

    order = {"high": 3, "medium": 2, "low": 1}
    score_sum = sum(order.get(s, 2) for s in relevance_scores)
    avg = score_sum / len(relevance_scores) if relevance_scores else 2
    source_count = len(sources)

    # Base score from source count and relevance
    base_score = 0
    if source_count >= weights.get("source_count_high", 2):
        base_score += weights.get("source_count_high", 2)
    elif source_count >= 1:
        base_score += weights.get("source_count_medium", 1)

    # Relevance contribution
    if avg >= order["high"]:
        base_score += weights.get("relevance_high", 3)
    elif avg >= order["medium"]:
        base_score += weights.get("relevance_medium", 2)
    else:
        base_score += weights.get("relevance_low", 1)

    # Cross-source agreement bonus: multiple sources with high relevance
    cross_source_bonus = 0
    if source_count >= 2 and avg >= order["high"]:
        cross_source_bonus = weights.get("cross_source_bonus", 1)
        base_score += cross_source_bonus

    # Determine confidence level
    high_threshold = weights.get("source_count_high", 2) + weights.get("relevance_high", 3) + cross_source_bonus
    medium_threshold = weights.get("source_count_medium", 1) + weights.get("relevance_medium", 2)

    if source_count >= 2 and base_score >= high_threshold:
        return "high"
    if source_count >= 1 and base_score >= medium_threshold:
        return "medium"
    return "low"


def build_enriched_items(
    plan: dict[str, Any], findings: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Build a list of items enriched with field data."""
    raw = build_item_field_data(plan, findings)
    fields = {f["id"]: f for f in plan.get("fields", [])}
    config = plan.get("config", {})

    enriched: list[dict[str, Any]] = []
    for item in plan.get("items", []):
        item_id = item["id"]
        item_data = raw.get(item_id, {})

        enriched_fields: dict[str, Any] = {}
        for fid, field in fields.items():
            cell = item_data.get(fid, {"values": [], "sources": [], "relevance_scores": [], "conflicts": []})
            values = cell.get("values", [])
            sources = cell.get("sources", [])
            relevance_scores = cell.get("relevance_scores", [])

            # Merge all unique values into a single coherent text
            unique_values: list[str] = []
            seen: set[str] = set()
            for v in values:
                vs = str(v).strip()
                if vs and vs not in seen:
                    seen.add(vs)
                    unique_values.append(vs)

            if unique_values:
                primary = max(unique_values, key=len)
                others = [v for v in unique_values if v != primary]
                if others:
                    value = primary + "\n\n**Supplemental**:\n" + "\n".join(f"- {v}" for v in others)
                else:
                    value = primary
            else:
                value = "_No data_"

            # Short value for comparison table (word-aware truncation, single line)
            short_value = str(value).replace("\n", " ").replace("\r", "")
            max_len = config.get("comparison_table_cell_limit", 150)
            if len(short_value) > max_len:
                # Try to cut at a word boundary
                cut = short_value[:max_len]
                last_space = cut.rfind(" ")
                if last_space > max_len * 0.7:
                    short_value = cut[:last_space] + "..."
                else:
                    short_value = cut + "..."
            short_value = short_value.replace("|", "\\|")

            enriched_fields[fid] = {
                "name": field["name"],
                "value": value,
                "short_value": short_value,
                "confidence": assess_confidence(sources, relevance_scores, config),
                "sources": sources,
                "conflicts": [],
                "covered": len(values) > 0,
            }

        enriched.append(
            {
                "id": item_id,
                "name": item.get("name", item_id),
                "type": item.get("type", "concept"),
                "description": item.get("description", ""),
                "fields": enriched_fields,
            }
        )

    return enriched


def calculate_coverage(plan: dict[str, Any], enriched_items: list[dict[str, Any]]) -> float:
    total = 0
    covered = 0
    for item in enriched_items:
        for field_data in item["fields"].values():
            total += 1
            if field_data["covered"]:
                covered += 1
    return covered / total if total > 0 else 1.0


def build_sources_context(sources: dict[str, list[str]]) -> dict[str, Any]:
    """Wrap source lists for the template."""
    return {
        "web": sources["web"],
        "github": sources["github"],
        "codebase": sources["codebase"],
    }


def generate_cross_cutting_insights(findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Generate simple cross-cutting insights from findings."""
    relevance_counts: Counter[str] = Counter()
    source_type_counts: Counter[str] = Counter()
    all_summaries: list[str] = []

    for finding in findings:
        ftype = finding.get("type", "web")
        source_type_counts[ftype] += 1
        for item in finding.get("findings", []):
            relevance = item.get("relevance", "medium")
            if relevance:
                relevance_counts[relevance] += 1
            summary = item.get("summary", "")
            if summary:
                all_summaries.append(summary)

    keywords = []
    if all_summaries:
        words: Counter[str] = Counter()
        for summary in all_summaries:
            # Unicode-aware tokenization: matches CJK characters and Latin words
            for word in re.findall(r"[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+|[a-zA-Z]{4,}", summary):
                words[word.lower()] += 1
        keywords = [word for word, _ in words.most_common(10)]

    total = sum(relevance_counts.values())
    high_pct = (relevance_counts.get("high", 0) / total * 100) if total else 0

    return {
        "source_distribution": dict(source_type_counts),
        "relevance_distribution": dict(relevance_counts),
        "keywords": keywords,
        "consensus": high_pct >= 50,
        "high_relevance_pct": high_pct,
    }


def generate_report(
    plan: dict[str, Any],
    findings: list[dict[str, Any]],
    output_path: Path,
) -> str:
    """Generate a Markdown report from a plan and findings."""
    template_name = plan.get("template", "survey")
    template_path = TEMPLATES_DIR / f"{template_name}.md.tmpl"
    if not template_path.exists():
        template_path = TEMPLATES_DIR / "survey.md.tmpl"

    enriched_items = build_enriched_items(plan, findings)
    coverage = calculate_coverage(plan, enriched_items)
    sources = collect_sources(findings)
    insights = generate_cross_cutting_insights(findings)
    gaps_report = load_gap_report(output_path.parent)

    # Build coverage matrix for heatmap
    coverage_matrix: dict[str, dict[str, dict[str, Any]]] = {}
    for item in enriched_items:
        coverage_matrix[item["id"]] = {}
        for fid, fdata in item["fields"].items():
            coverage_matrix[item["id"]][fid] = {
                "covered": fdata["covered"],
                "sources": len(fdata.get("sources", [])),
                "confidence": fdata.get("confidence", "none"),
            }

    # Confidence counts for bar chart
    confidence_counts: dict[str, int] = {"high": 0, "medium": 0, "low": 0, "none": 0}
    for item in enriched_items:
        for fdata in item["fields"].values():
            conf = fdata.get("confidence", "none")
            confidence_counts[conf] = confidence_counts.get(conf, 0) + 1

    # Generate SVG charts (if available)
    svg_charts: dict[str, str] = {}
    if coverage_heatmap:
        svg_charts["coverage_heatmap"] = coverage_heatmap(
            plan.get("items", []), plan.get("fields", []), coverage_matrix
        )
    if source_donut:
        svg_charts["source_donut"] = source_donut(
            len(sources["web"]), len(sources["github"]), len(sources["codebase"])
        )
    if confidence_bars:
        svg_charts["confidence_bars"] = confidence_bars(confidence_counts)
    if comparison_radar and template_name == "comparison" and len(enriched_items) >= 2:
        svg_charts["comparison_radar"] = comparison_radar(
            plan.get("items", []), plan.get("fields", []), enriched_items
        )
    if research_timeline and load_events:
        events = load_events(output_path.parent)
        if events:
            svg_charts["timeline"] = research_timeline(events)

    # Load audit report if it exists (try artifacts/ first, then root)
    audit_report: dict[str, Any] | None = None
    workspace = output_path.parent
    for audit_path in [workspace / "artifacts" / "audit_report.json", workspace / "audit_report.json"]:
        if audit_path.exists():
            try:
                audit_report = load_json(audit_path)
            except json.JSONDecodeError:
                pass
            break

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(disabled_extensions=("tmpl", "md")),
    )
    env.filters["percent"] = lambda x: f"{x * 100:.0f}%"
    env.filters["slug"] = lambda x: re.sub(r"[^\w]", "-", str(x)).lower()

    tmpl = env.get_template(template_path.name)

    context = {
        "plan": plan,
        "items": enriched_items,
        "fields": plan.get("fields", []),
        "coverage": coverage,
        "sources": build_sources_context(sources),
        "insights": insights,
        "gaps": gaps_report.get("gaps", []) if gaps_report else [],
        "total_findings": sum(len(f.get("findings", [])) for f in findings),
        "svg": svg_charts,
        "audit": audit_report,
    }

    report = tmpl.render(context)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8")

    # Log provenance
    if log_event:
        log_event(output_path.parent, "report_generated",
                  output=str(output_path.name), template=template_name)

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Synthesize deep-research findings into a Markdown report.")
    parser.add_argument("--plan", "-p", required=True, help="Path to plan.json")
    parser.add_argument("--findings-dir", "-f", required=True, help="Directory containing findings JSON files")
    parser.add_argument("--output", "-o", required=True, help="Output Markdown report path")
    args = parser.parse_args()

    plan_path = Path(args.plan)
    findings_dir = Path(args.findings_dir)
    output_path = Path(args.output)

    if not plan_path.exists():
        print(f"Error: plan not found: {plan_path}", file=sys.stderr)
        sys.exit(1)

    plan = load_json(plan_path)
    if not isinstance(plan, dict) or plan.get("version") != 2:
        print("Error: plan.json must be v2 schema", file=sys.stderr)
        sys.exit(1)

    findings = load_findings(findings_dir)

    if not findings:
        print(f"Warning: no findings found in {findings_dir}", file=sys.stderr)

    generate_report(plan, findings, output_path)
    print(f"Report written to {output_path}")


if __name__ == "__main__":
    main()
