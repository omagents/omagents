#!/usr/bin/env python3
"""Generate or validate a deep-research plan.

This script uses only the Python standard library. The actual intelligence
of the research plan comes from the OpenCode agent; this script produces a
consistent v2 template and validates JSON structure.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PLAN_VERSION = 2

DEFAULT_OBJECTIVES = [
    "Understand the current landscape related to the query.",
    "Identify key technologies, projects, or arguments.",
    "Collect evidence from web, GitHub, and/or local codebase.",
]

DEFAULT_TEMPLATE = "survey"

DEFAULT_CONFIG: dict[str, Any] = {
    "max_research_loops": 2,
    "batch_size": 3,
    "items_per_agent": 1,
    "search_tools": ["websearch", "github", "codegraph"],
    "report_sections": [
        "executive_summary",
        "comparison_table",
        "detailed_findings",
        "cross_cutting_insights",
        "gaps",
        "sources",
    ],
    "language": "auto",
    "max_pre_research_loops": 2,
    "min_pre_research_candidates": 5,
    "min_pre_research_sources": 3,
    "confidence_weights": {
        "source_count_high": 2,
        "source_count_medium": 1,
        "relevance_high": 3,
        "relevance_medium": 2,
        "relevance_low": 1,
        "recency_bonus_days": 90,
        "recency_bonus": 1,
        "cross_source_bonus": 1,
    },
    "audit_weights": {
        "info": 0,
        "warning": 5,
        "error": 15,
        "critical": 30,
    },
}

REPORT_TEMPLATES = ("comparison", "survey", "technical", "custom")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_id(prefix: str, index: int) -> str:
    return f"{prefix}-{index + 1}"


def next_id(prefix: str, existing_ids: list[str]) -> str:
    """Generate the next sequential id for a given prefix, avoiding gaps and duplicates."""
    numbers: list[int] = []
    for id_str in existing_ids:
        if id_str.startswith(f"{prefix}-"):
            try:
                numbers.append(int(id_str.split("-", 1)[1]))
            except ValueError:
                pass
    next_num = max(numbers, default=0) + 1
    return f"{prefix}-{next_num}"


def default_fields(query: str, template: str = DEFAULT_TEMPLATE) -> list[dict[str, Any]]:
    """Generate fields appropriate for the report template."""
    base_fields = [
        {
            "id": "field-1",
            "name": "Overview",
            "category": "General",
            "description": f"General description and background about: {query}",
            "required": True,
            "detail_level": "moderate",
        },
        {
            "id": "field-2",
            "name": "Key Technologies/Projects",
            "category": "General",
            "description": "Important frameworks, tools, projects, or arguments mentioned.",
            "required": True,
            "detail_level": "moderate",
        },
        {
            "id": "field-3",
            "name": "Evidence and Sources",
            "category": "General",
            "description": "Supporting evidence, references, or source URLs.",
            "required": False,
            "detail_level": "brief",
        },
    ]

    if template == "comparison":
        return base_fields + [
            {
                "id": "field-4",
                "name": "Latest Version",
                "category": "Version",
                "description": "Most recent stable version or release.",
                "required": True,
                "detail_level": "brief",
            },
            {
                "id": "field-5",
                "name": "Strengths",
                "category": "Assessment",
                "description": "Key advantages and differentiators.",
                "required": True,
                "detail_level": "moderate",
            },
            {
                "id": "field-6",
                "name": "Weaknesses",
                "category": "Assessment",
                "description": "Known limitations, issues, or trade-offs.",
                "required": False,
                "detail_level": "moderate",
            },
            {
                "id": "field-7",
                "name": "Pricing/License",
                "category": "Legal",
                "description": "Cost, licensing model, or open-source license.",
                "required": False,
                "detail_level": "brief",
            },
        ]

    if template == "technical":
        return base_fields + [
            {
                "id": "field-4",
                "name": "Architecture",
                "category": "Technical",
                "description": "System architecture, design patterns, or internal structure.",
                "required": True,
                "detail_level": "detailed",
            },
            {
                "id": "field-5",
                "name": "API/Interface",
                "category": "Technical",
                "description": "Public API surface, SDK, or integration interface.",
                "required": True,
                "detail_level": "moderate",
            },
            {
                "id": "field-6",
                "name": "Performance",
                "category": "Technical",
                "description": "Benchmarks, throughput, latency, or resource usage.",
                "required": False,
                "detail_level": "moderate",
            },
        ]

    return base_fields


def default_items(query: str) -> list[dict[str, Any]]:
    return [
        {
            "id": "item-1",
            "name": query,
            "type": "concept",
            "description": f"General investigation of {query}",
        }
    ]


def build_tasks(
    items: list[dict[str, Any]],
    fields: list[dict[str, Any]],
    config: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Build tasks covering every item x field combination.

    For each item, generates one task per configured search source type.
    Each task covers a logical group of fields to balance granularity and efficiency.
    """
    if not items or not fields:
        return []

    cfg = config or DEFAULT_CONFIG
    search_tools = cfg.get("search_tools", ["websearch", "github", "codegraph"])

    # Map search_tools to task types
    source_types: list[str] = []
    if "websearch" in search_tools:
        source_types.append("web")
    if "github" in search_tools:
        source_types.append("github")
    if "codegraph" in search_tools:
        source_types.append("codebase")
    if not source_types:
        source_types = ["web"]

    all_field_ids = [f["id"] for f in fields]
    # Group fields into logical clusters for task efficiency
    required_fields = [f for f in fields if f.get("required", False)]
    optional_fields = [f for f in fields if not f.get("required", False)]
    required_field_ids = [f["id"] for f in required_fields] or all_field_ids[:2]
    optional_field_ids = [f["id"] for f in optional_fields]

    tasks: list[dict[str, Any]] = []
    task_index = 1

    for item in items:
        item_id = item.get("id", f"item-{task_index}")
        item_name = item.get("name", item_id)

        for source_type in source_types:
            # Primary task: cover all required fields
            if required_field_ids:
                focus_prefix = {
                    "web": "Current web sources and discussions about",
                    "github": "Open-source projects and community discussions about",
                    "codebase": "Relevant implementation patterns in the local codebase for",
                }.get(source_type, "Research about")

                tasks.append({
                    "id": f"task-{task_index}",
                    "type": source_type,
                    "item_id": item_id,
                    "field_ids": required_field_ids,
                    "focus": f"{focus_prefix}: {item_name}",
                    "status": "pending",
                    "iteration": 0,
                })
                task_index += 1

            # Supplemental task: cover optional fields (only for web and github)
            if optional_field_ids and source_type in ("web", "github"):
                tasks.append({
                    "id": f"task-{task_index}",
                    "type": source_type,
                    "item_id": item_id,
                    "field_ids": optional_field_ids,
                    "focus": f"Supplemental research for {item_name} (optional fields)",
                    "status": "pending",
                    "iteration": 0,
                })
                task_index += 1

    return tasks


def default_plan(
    query: str,
    context: str = "",
    template: str = DEFAULT_TEMPLATE,
    config_overrides: dict[str, Any] | None = None,
    pre_research_path: str | None = None,
) -> dict[str, Any]:
    """Return a v2 plan template for the given query.

    If pre_research_path is provided and the file exists, use its candidates
    to populate items instead of the default single-item plan.
    """
    if template not in REPORT_TEMPLATES:
        raise ValueError(f"Unknown template '{template}'. Choose from {REPORT_TEMPLATES}")

    config = DEFAULT_CONFIG.copy()
    if config_overrides:
        config.update(config_overrides)

    fields = default_fields(query, template)

    items: list[dict[str, Any]] = []
    if pre_research_path:
        items = items_from_pre_research(pre_research_path)
    if not items:
        items = default_items(query)

    tasks = build_tasks(items, fields, config)

    return {
        "version": PLAN_VERSION,
        "query": query,
        "context": context or "",
        "template": template,
        "objectives": DEFAULT_OBJECTIVES.copy(),
        "items": items,
        "fields": fields,
        "tasks": tasks,
        "config": config,
        "metadata": {
            "created_at": now(),
            "updated_at": now(),
            "research_loops_completed": 0,
        },
    }


def items_from_pre_research(pre_research_path: str | Path) -> list[dict[str, Any]]:
    """Generate plan items from pre_research.json candidates.

    Returns an empty list if the file doesn't exist or has no candidates.
    """
    path = Path(pre_research_path)
    if not path.exists():
        return []

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []

    candidates = data.get("candidates", [])
    if not candidates:
        return []

    items: list[dict[str, Any]] = []
    for i, candidate in enumerate(candidates):
        name = candidate.get("name", f"Candidate-{i+1}")
        items.append({
            "id": f"item-{i+1}",
            "name": name,
            "type": candidate.get("type", "concept"),
            "description": candidate.get("note", "") or candidate.get("description", ""),
        })

    return items


def _validate_id_list(name: str, obj: Any, required: bool = True) -> None:
    if not isinstance(obj, list):
        raise ValueError(f"'{name}' must be a list.")
    if required and len(obj) == 0:
        raise ValueError(f"'{name}' must not be empty.")
    for i, item in enumerate(obj):
        if not isinstance(item, dict):
            raise ValueError(f"'{name}[{i}]' must be an object.")


def validate_plan(plan: dict[str, Any]) -> None:
    """Validate the structure of a v2 research plan."""
    if not isinstance(plan, dict):
        raise ValueError("Plan must be a JSON object.")

    version = plan.get("version", 1)
    if version != PLAN_VERSION:
        raise ValueError(f"Expected plan version {PLAN_VERSION}, got {version}")

    required_top = ["query", "template", "objectives", "items", "fields", "tasks", "config"]
    for key in required_top:
        if key not in plan:
            raise ValueError(f"Plan must contain a '{key}' field.")

    if plan["template"] not in REPORT_TEMPLATES:
        raise ValueError(f"Unknown template '{plan['template']}'")

    _validate_id_list("items", plan["items"])
    _validate_id_list("fields", plan["fields"])
    _validate_id_list("tasks", plan["tasks"])

    item_ids = set()
    for i, item in enumerate(plan["items"]):
        item_id = item.get("id")
        if not item_id:
            raise ValueError(f"items[{i}] must have an 'id'")
        if item_id in item_ids:
            raise ValueError(f"Duplicate item id '{item_id}'")
        item_ids.add(item_id)

    field_ids = set()
    for i, field in enumerate(plan["fields"]):
        field_id = field.get("id")
        if not field_id:
            raise ValueError(f"fields[{i}] must have an 'id'")
        if field_id in field_ids:
            raise ValueError(f"Duplicate field id '{field_id}'")
        field_ids.add(field_id)

    for i, task in enumerate(plan["tasks"]):
        if not isinstance(task, dict):
            raise ValueError(f"tasks[{i}] must be an object.")
        task_id = task.get("id")
        if not task_id:
            raise ValueError(f"tasks[{i}] must have an 'id'")
        if task.get("type") not in {"web", "github", "codebase"}:
            raise ValueError(f"tasks[{i}] has invalid type '{task.get('type')}'")
        item_id = task.get("item_id")
        if not item_id or item_id not in item_ids:
            raise ValueError(f"tasks[{i}] references unknown item_id '{item_id}'")
        task_fields = task.get("field_ids", [])
        if not isinstance(task_fields, list):
            raise ValueError(f"tasks[{i}].field_ids must be a list")
        for fid in task_fields:
            if fid not in field_ids:
                raise ValueError(f"tasks[{i}] references unknown field_id '{fid}'")

    # Validate config
    config = plan.get("config", {})
    if not isinstance(config, dict):
        raise ValueError("'config' must be an object.")
    if "max_research_loops" in config and not isinstance(config["max_research_loops"], int):
        raise ValueError("'config.max_research_loops' must be an integer")


def add_items(plan: dict[str, Any], items_json: str) -> dict[str, Any]:
    """Add new items to the plan, generating tasks for them.

    Generates one task per configured search source type, covering all fields.
    Respects plan.config.search_tools.
    """
    new_items = json.loads(items_json)
    if not isinstance(new_items, list):
        raise ValueError("Items must be a JSON list")

    existing_ids = {item["id"] for item in plan["items"]}
    config = plan.get("config", DEFAULT_CONFIG)
    search_tools = config.get("search_tools", ["websearch", "github", "codegraph"])

    source_types: list[str] = []
    if "websearch" in search_tools:
        source_types.append("web")
    if "github" in search_tools:
        source_types.append("github")
    if "codegraph" in search_tools:
        source_types.append("codebase")
    if not source_types:
        source_types = ["web"]

    all_field_ids = [f["id"] for f in plan["fields"]]

    for item in new_items:
        if "id" not in item or not item["id"]:
            item["id"] = next_id("item", [i["id"] for i in plan["items"]])
        if item["id"] in existing_ids:
            raise ValueError(f"Duplicate item id '{item['id']}'")
        existing_ids.add(item["id"])
        plan["items"].append(item)

        item_name = item.get("name", item["id"])
        for source_type in source_types:
            focus_prefix = {
                "web": "Current web sources and discussions about",
                "github": "Open-source projects and community discussions about",
                "codebase": "Relevant implementation patterns in the local codebase for",
            }.get(source_type, "Research about")

            plan["tasks"].append({
                "id": next_id("task", [t["id"] for t in plan["tasks"]]),
                "type": source_type,
                "item_id": item["id"],
                "field_ids": all_field_ids,
                "focus": f"{focus_prefix}: {item_name}",
                "status": "pending",
                "iteration": 0,
            })

    plan["metadata"]["updated_at"] = now()
    validate_plan(plan)
    return plan


def add_fields(plan: dict[str, Any], fields_json: str) -> dict[str, Any]:
    """Add new fields to the plan and update existing tasks."""
    new_fields = json.loads(fields_json)
    if not isinstance(new_fields, list):
        raise ValueError("Fields must be a JSON list")

    existing_ids = {field["id"] for field in plan["fields"]}

    for field in new_fields:
        if "id" not in field or not field["id"]:
            field["id"] = next_id("field", [f["id"] for f in plan["fields"]])
        if field["id"] in existing_ids:
            raise ValueError(f"Duplicate field id '{field['id']}'")
        existing_ids.add(field["id"])
        plan["fields"].append(field)

    # Optionally add the new field to all existing tasks
    for task in plan["tasks"]:
        for field in new_fields:
            if field["id"] not in task.get("field_ids", []):
                task.setdefault("field_ids", []).append(field["id"])

    plan["metadata"]["updated_at"] = now()
    validate_plan(plan)
    return plan


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate or validate a deep-research plan.")
    parser.add_argument("--query", "-q", help="User's research query")
    parser.add_argument("--context", "-c", default="", help="Additional context for the research")
    parser.add_argument("--template", "-t", default=DEFAULT_TEMPLATE, choices=REPORT_TEMPLATES,
                        help=f"Report template (default: {DEFAULT_TEMPLATE})")
    parser.add_argument("--input", "-i", help="Path to an existing plan JSON to validate/normalize")
    parser.add_argument("--output", "-o", help="Output file (default: stdout)")
    parser.add_argument("--add-items", help="JSON list of items to add to an existing plan (requires --input)")
    parser.add_argument("--add-fields", help="JSON list of fields to add to an existing plan (requires --input)")
    parser.add_argument("--pre-research", help="Path to pre_research.json for generating items from landscape scan")
    parser.add_argument("--max-loops", type=int, help="Override max_research_loops in config")
    parser.add_argument("--batch-size", type=int, help="Override batch_size in config")
    parser.add_argument("--items-per-agent", type=int, help="Override items_per_agent in config")
    parser.add_argument("--search-tools", help="Comma-separated search tools (websearch,github,codegraph)")
    parser.add_argument("--language", help="Report language (auto, en, zh, ja, ko)")
    args = parser.parse_args()

    if args.input:
        plan = json.loads(Path(args.input).read_text(encoding="utf-8"))
        validate_plan(plan)
        if args.add_items:
            plan = add_items(plan, args.add_items)
        if args.add_fields:
            plan = add_fields(plan, args.add_fields)
    elif args.query:
        config_overrides: dict[str, Any] = {}
        if args.max_loops is not None:
            config_overrides["max_research_loops"] = args.max_loops
        if args.batch_size is not None:
            config_overrides["batch_size"] = args.batch_size
        if args.items_per_agent is not None:
            config_overrides["items_per_agent"] = args.items_per_agent
        if args.search_tools:
            config_overrides["search_tools"] = [t.strip() for t in args.search_tools.split(",")]
        if args.language:
            config_overrides["language"] = args.language

        pre_research_path = args.pre_research
        if not pre_research_path:
            default_pre = Path.cwd() / "pre_research.json"
            if default_pre.exists():
                pre_research_path = str(default_pre)

        plan = default_plan(
            args.query, args.context, args.template,
            config_overrides=config_overrides or None,
            pre_research_path=pre_research_path,
        )
        validate_plan(plan)
    else:
        parser.error("Provide either --query or --input")

    plan_json = json.dumps(plan, indent=2, ensure_ascii=False)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(plan_json, encoding="utf-8")
        print(f"Plan written to {args.output}")

        # Log provenance
        try:
            from provenance import log_event
            log_event(output_path.parent, "plan_created",
                      query=plan.get("query", ""), template=plan.get("template", ""),
                      items=len(plan.get("items", [])), tasks=len(plan.get("tasks", [])))
        except ImportError:
            pass
    else:
        print(plan_json)


if __name__ == "__main__":
    main()
