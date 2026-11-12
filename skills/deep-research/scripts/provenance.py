#!/usr/bin/env python3
"""Provenance tracking for deep-research workspaces.

Append-only JSONL logger that records phase-level research events.
Each event has: timestamp, event_type, and event-specific details.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from layout import ResearchLayout, internal_run_root


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _anchor_layout(anchor: Path) -> ResearchLayout:
    layout = ResearchLayout.resolve(anchor)
    if layout.legacy or anchor.name != "artifacts":
        return layout

    parent = anchor.parent
    legacy_markers = (
        parent / "plan.json",
        parent / "orchestration_state.json",
        parent / "pre_research_state.json",
    )
    if any(path.exists() for path in legacy_markers):
        return ResearchLayout.resolve(parent)
    return layout


def _provenance_path(anchor: Path) -> Path:
    """Return the single canonical write path for a run or workspace anchor."""
    run_root = internal_run_root(anchor)
    if run_root is not None:
        return run_root / "logs" / "provenance.jsonl"

    return _anchor_layout(anchor).provenance_path


def _read_paths(anchor: Path) -> list[Path]:
    run_root = internal_run_root(anchor)
    if run_root is not None:
        return [run_root / "logs" / "provenance.jsonl"]

    layout = _anchor_layout(anchor)
    if not layout.legacy:
        return [layout.provenance_path]
    return [layout.workspace / "provenance.jsonl", layout.provenance_path]


def log_event(anchor: Path, event_type: str, **details: Any) -> None:
    """Append a provenance event to the canonical log for anchor."""
    event: dict[str, Any] = {
        "timestamp": now(),
        "event_type": event_type,
    }
    event.update(details)
    provenance_path = _provenance_path(anchor)
    provenance_path.parent.mkdir(parents=True, exist_ok=True)
    with provenance_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def load_events(anchor: Path) -> list[dict[str, Any]]:
    """Load all provenance events, including split legacy timelines."""
    events: list[dict[str, Any]] = []
    seen_paths: set[Path] = set()
    for provenance_path in _read_paths(anchor):
        resolved = provenance_path.resolve()
        if resolved in seen_paths or not provenance_path.exists():
            continue
        seen_paths.add(resolved)
        for line in provenance_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    events.sort(key=lambda event: event.get("timestamp", ""))
    return events


def get_timeline(workspace: Path) -> list[dict[str, Any]]:
    """Get provenance events as a timeline for SVG rendering."""
    return load_events(workspace)


def export_summary(workspace: Path) -> dict[str, Any]:
    """Export a summary of provenance events."""
    events = load_events(workspace)
    if not events:
        return {"event_count": 0, "events": []}

    event_types: dict[str, int] = {}
    for event in events:
        etype = event.get("event_type", "unknown")
        event_types[etype] = event_types.get(etype, 0) + 1

    return {
        "event_count": len(events),
        "event_types": event_types,
        "first_event": events[0].get("timestamp") if events else None,
        "last_event": events[-1].get("timestamp") if events else None,
        "events": events,
    }


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="View provenance for a deep-research workspace.")
    parser.add_argument("--workspace", "-w", required=True, help="Workspace directory")
    parser.add_argument("--format", "-f", default="summary", choices=["summary", "json", "timeline"],
                        help="Output format (default: summary)")
    args = parser.parse_args()

    workspace = Path(args.workspace)
    if args.format == "json":
        events = load_events(workspace)
        print(json.dumps(events, indent=2, ensure_ascii=False))
    elif args.format == "timeline":
        events = get_timeline(workspace)
        for event in events:
            print(f"  {event.get('timestamp', '?')}  {event.get('event_type', '?')}")
    else:
        summary = export_summary(workspace)
        print(f"Provenance for: {workspace}")
        print(f"  Events: {summary['event_count']}")
        if summary.get("first_event"):
            print(f"  First: {summary['first_event']}")
        if summary.get("last_event"):
            print(f"  Last:  {summary['last_event']}")
        if summary.get("event_types"):
            print("  By type:")
            for etype, count in summary["event_types"].items():
                print(f"    {etype}: {count}")


if __name__ == "__main__":
    import sys

    sys.exit(main())
