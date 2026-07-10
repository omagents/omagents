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


def default_fields(query: str) -> list[dict[str, Any]]:
    return [
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


def default_items(query: str) -> list[dict[str, Any]]:
    return [
        {
            "id": "item-1",
            "name": query,
            "type": "concept",
            "description": f"General investigation of {query}",
        }
    ]


def build_tasks(items: list[dict[str, Any]], fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build a default set of tasks from the first item and first two fields."""
    first_item = items[0] if items else {"id": "item-1"}
    first_item_id = first_item.get("id", "item-1")

    field_ids = [f["id"] for f in fields if "id" in f]
    general_fields = field_ids[:2] if len(field_ids) >= 2 else field_ids
    evidence_field = [field_ids[2]] if len(field_ids) >= 3 else general_fields[:1]

    tasks = [
        {
            "id": "task-1",
            "type": "web",
            "item_id": first_item_id,
            "field_ids": general_fields,
            "focus": f"Current web sources and discussions about: {first_item.get('name', 'the topic')}",
            "status": "pending",
            "iteration": 0,
        },
        {
            "id": "task-2",
            "type": "github",
            "item_id": first_item_id,
            "field_ids": general_fields + evidence_field,
            "focus": f"Open-source projects and community discussions about: {first_item.get('name', 'the topic')}",
            "status": "pending",
            "iteration": 0,
        },
        {
            "id": "task-3",
            "type": "codebase",
            "item_id": first_item_id,
            "field_ids": evidence_field,
            "focus": f"Relevant implementation patterns in the local codebase for: {first_item.get('name', 'the topic')}",
            "status": "pending",
            "iteration": 0,
        },
    ]
    return tasks


def default_plan(query: str, context: str = "", template: str = DEFAULT_TEMPLATE) -> dict[str, Any]:
    """Return a minimal v2 plan template for the given query."""
    if template not in REPORT_TEMPLATES:
        raise ValueError(f"Unknown template '{template}'. Choose from {REPORT_TEMPLATES}")

    items = default_items(query)
    fields = default_fields(query)
    tasks = build_tasks(items, fields)

    return {
        "version": PLAN_VERSION,
        "query": query,
        "context": context or "",
        "template": template,
        "objectives": DEFAULT_OBJECTIVES.copy(),
        "items": items,
        "fields": fields,
        "tasks": tasks,
        "config": DEFAULT_CONFIG.copy(),
        "metadata": {
            "created_at": now(),
            "updated_at": now(),
            "research_loops_completed": 0,
        },
    }


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
    """Add new items to the plan, generating tasks for them."""
    new_items = json.loads(items_json)
    if not isinstance(new_items, list):
        raise ValueError("Items must be a JSON list")

    existing_ids = {item["id"] for item in plan["items"]}

    for item in new_items:
        if "id" not in item or not item["id"]:
            item["id"] = next_id("item", [i["id"] for i in plan["items"]])
        if item["id"] in existing_ids:
            raise ValueError(f"Duplicate item id '{item['id']}'")
        existing_ids.add(item["id"])
        plan["items"].append(item)

        # Create default tasks for this item across all fields
        all_field_ids = [f["id"] for f in plan["fields"]]
        plan["tasks"].append({
            "id": next_id("task", [t["id"] for t in plan["tasks"]]),
            "type": "web",
            "item_id": item["id"],
            "field_ids": all_field_ids,
            "focus": f"Research '{item.get('name', item['id'])}' across web sources",
            "status": "pending",
            "iteration": 0,
        })
        plan["tasks"].append({
            "id": next_id("task", [t["id"] for t in plan["tasks"]]),
            "type": "github",
            "item_id": item["id"],
            "field_ids": all_field_ids,
            "focus": f"Research '{item.get('name', item['id'])}' on GitHub",
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
    args = parser.parse_args()

    if args.input:
        plan = json.loads(Path(args.input).read_text(encoding="utf-8"))
        validate_plan(plan)
        if args.add_items:
            plan = add_items(plan, args.add_items)
        if args.add_fields:
            plan = add_fields(plan, args.add_fields)
    elif args.query:
        plan = default_plan(args.query, args.context, args.template)
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
                      query=plan.get("query", ""), template=plan.get("template", ""))
        except ImportError:
            pass
    else:
        print(plan_json)


if __name__ == "__main__":
    main()
