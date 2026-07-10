#!/usr/bin/env python3
"""SVG chart generators for deep-research reports.

All functions return pure SVG strings (no JS, no external deps).
Designed for inline embedding in Markdown reports.
"""
from __future__ import annotations

import html
from typing import Any

# Color palette
COLOR_HIGH = "#22C55E"
COLOR_MEDIUM = "#EAB308"
COLOR_LOW = "#EF4444"
COLOR_NONE = "#9CA3AF"
COLOR_WEB = "#6366F1"
COLOR_GITHUB = "#8B5CF6"
COLOR_CODEBASE = "#06B6D4"
COLOR_TEXT = "#1E293B"
COLOR_GRID = "#E2E8F0"
COLOR_BG = "#F8FAFC"

CONFIDENCE_COLORS = {
    "high": COLOR_HIGH,
    "medium": COLOR_MEDIUM,
    "low": COLOR_LOW,
    "none": COLOR_NONE,
}


def _esc(text: str) -> str:
    """HTML-escape text for SVG."""
    return html.escape(str(text), quote=True)


def coverage_heatmap(
    items: list[dict[str, Any]],
    fields: list[dict[str, Any]],
    matrix: dict[str, dict[str, dict[str, Any]]],
) -> str:
    """Generate an item x field coverage heatmap as SVG."""
    if not items or not fields:
        return '<p><em>No data available for coverage heatmap.</em></p>'

    n_items = len(items)
    n_fields = len(fields)

    cell_w = 60
    cell_h = 40
    margin_left = 120
    margin_top = 80
    margin_right = 20
    margin_bottom = 20

    label_max = max(n_items, 1)
    svg_w = margin_left + n_fields * cell_w + margin_right
    svg_h = margin_top + n_items * cell_h + margin_bottom

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_w} {svg_h}" '
        f'width="{svg_w}" height="{svg_h}" font-family="system-ui, sans-serif" font-size="11">'
    ]

    # Title
    parts.append(f'<text x="{svg_w / 2}" y="20" text-anchor="middle" '
                 f'font-size="14" font-weight="600" fill="{COLOR_TEXT}">Coverage Heatmap</text>')

    # Field headers (rotated)
    for j, field in enumerate(fields):
        x = margin_left + j * cell_w + cell_w / 2
        y = margin_top - 8
        fname = _esc(field.get("name", field.get("id", "")))[:20]
        parts.append(f'<text x="{x}" y="{y}" text-anchor="end" '
                     f'transform="rotate(-35 {x} {y})" fill="{COLOR_TEXT}">{fname}</text>')

    # Item labels and cells
    for i, item in enumerate(items):
        y = margin_top + i * cell_h
        iname = _esc(item.get("name", item.get("id", "")))[:18]
        parts.append(f'<text x="{margin_left - 8}" y="{y + cell_h / 2 + 4}" '
                     f'text-anchor="end" fill="{COLOR_TEXT}">{iname}</text>')

        for j, field in enumerate(fields):
            x = margin_left + j * cell_w
            cell = matrix.get(item["id"], {}).get(field["id"], {})
            confidence = cell.get("confidence", "none")
            color = CONFIDENCE_COLORS.get(confidence, COLOR_NONE)
            sources = cell.get("sources", 0)

            parts.append(f'<rect x="{x}" y="{y}" width="{cell_w - 2}" height="{cell_h - 2}" '
                        f'rx="4" fill="{color}" opacity="0.85" />')
            if sources > 0:
                parts.append(f'<text x="{x + cell_w / 2}" y="{y + cell_h / 2 + 4}" '
                            f'text-anchor="middle" fill="white" font-size="12" font-weight="600">{sources}</text>')

    # Legend
    legend_y = svg_h - 6
    legend_items = [("High", COLOR_HIGH), ("Medium", COLOR_MEDIUM), ("Low", COLOR_LOW), ("None", COLOR_NONE)]
    lx = margin_left
    for label, color in legend_items:
        parts.append(f'<rect x="{lx}" y="{legend_y - 8}" width="10" height="10" rx="2" fill="{color}" opacity="0.85" />')
        parts.append(f'<text x="{lx + 14}" y="{legend_y}" fill="{COLOR_TEXT}" font-size="10">{label}</text>')
        lx += 60

    parts.append('</svg>')
    return '\n'.join(parts)


def source_donut(
    web_count: int,
    github_count: int,
    codebase_count: int,
) -> str:
    """Generate a source distribution donut chart as SVG."""
    total = web_count + github_count + codebase_count
    if total == 0:
        return '<p><em>No source data available.</em></p>'

    cx, cy = 100, 100
    r_outer = 80
    r_inner = 48

    segments = [
        ("Web", web_count, COLOR_WEB),
        ("GitHub", github_count, COLOR_GITHUB),
        ("Codebase", codebase_count, COLOR_CODEBASE),
    ]

    import math

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" '
        f'width="220" height="220" font-family="system-ui, sans-serif" font-size="11">'
    ]

    # Background ring
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r_outer}" fill="{COLOR_BG}" />')

    start_angle = -90.0  # Start at top
    for label, count, color in segments:
        if count == 0:
            continue
        angle = (count / total) * 360
        end_angle = start_angle + angle

        # Calculate arc path
        x1 = cx + r_outer * math.cos(math.radians(start_angle))
        y1 = cy + r_outer * math.sin(math.radians(start_angle))
        x2 = cx + r_outer * math.cos(math.radians(end_angle))
        y2 = cy + r_outer * math.sin(math.radians(end_angle))
        x3 = cx + r_inner * math.cos(math.radians(end_angle))
        y3 = cy + r_inner * math.sin(math.radians(end_angle))
        x4 = cx + r_inner * math.cos(math.radians(start_angle))
        y4 = cy + r_inner * math.sin(math.radians(start_angle))

        large_arc = 1 if angle > 180 else 0
        path = (
            f'M {x1:.1f} {y1:.1f} '
            f'A {r_outer} {r_outer} 0 {large_arc} 1 {x2:.1f} {y2:.1f} '
            f'L {x3:.1f} {y3:.1f} '
            f'A {r_inner} {r_inner} 0 {large_arc} 0 {x4:.1f} {y4:.1f} Z'
        )
        parts.append(f'<path d="{path}" fill="{color}" opacity="0.85" />')
        start_angle = end_angle

    # Center text
    parts.append(f'<text x="{cx}" y="{cy - 5}" text-anchor="middle" '
                 f'font-size="22" font-weight="700" fill="{COLOR_TEXT}">{total}</text>')
    parts.append(f'<text x="{cx}" y="{cy + 14}" text-anchor="middle" '
                 f'font-size="11" fill="{COLOR_TEXT}">sources</text>')

    # Legend
    ly = 180
    lx = 20
    for label, count, color in segments:
        pct = (count / total * 100) if total else 0
        parts.append(f'<rect x="{lx}" y="{ly}" width="10" height="10" rx="2" fill="{color}" />')
        parts.append(f'<text x="{lx + 14}" y="{ly + 9}" fill="{COLOR_TEXT}" font-size="10">'
                     f'{label} ({pct:.0f}%)</text>')
        lx += 65

    parts.append('</svg>')
    return '\n'.join(parts)


def research_timeline(events: list[dict[str, Any]]) -> str:
    """Generate a horizontal research timeline from provenance events."""
    if not events:
        return ""

    n = len(events)
    margin_left = 40
    margin_right = 40
    spacing = 140 if n > 1 else 0
    svg_w = margin_left + margin_right + max(n - 1, 0) * spacing + 40
    svg_h = 90
    line_y = 40

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_w} {svg_h}" '
        f'width="{svg_w}" height="{svg_h}" font-family="system-ui, sans-serif" font-size="10">'
    ]

    # Timeline line
    line_x1 = margin_left
    line_x2 = svg_w - margin_right
    parts.append(f'<line x1="{line_x1}" y1="{line_y}" x2="{line_x2}" y2="{line_y}" '
                f'stroke="{COLOR_GRID}" stroke-width="2" />')

    event_colors = {
        "plan_created": COLOR_WEB,
        "gap_detected": COLOR_MEDIUM,
        "report_generated": COLOR_HIGH,
        "audit_completed": COLOR_CODEBASE,
    }
    event_labels = {
        "plan_created": "Plan",
        "gap_detected": "Gaps",
        "report_generated": "Report",
        "audit_completed": "Audit",
    }

    for i, event in enumerate(events):
        x = margin_left + i * spacing
        etype = event.get("event_type", "unknown")
        color = event_colors.get(etype, COLOR_NONE)
        label = event_labels.get(etype, _esc(etype[:10]))

        # Dot
        parts.append(f'<circle cx="{x}" cy="{line_y}" r="6" fill="{color}" />')
        # Label above
        parts.append(f'<text x="{x}" y="{line_y - 14}" text-anchor="middle" '
                    f'fill="{COLOR_TEXT}" font-size="10" font-weight="500">{label}</text>')
        # Timestamp below (time only)
        ts = event.get("timestamp", "")
        time_part = ts[11:19] if len(ts) >= 19 else ts[:8]
        parts.append(f'<text x="{x}" y="{line_y + 22}" text-anchor="middle" '
                    f'fill="{COLOR_NONE}" font-size="9">{time_part}</text>')

    parts.append('</svg>')
    return '\n'.join(parts)


def comparison_radar(
    items: list[dict[str, Any]],
    fields: list[dict[str, Any]],
    enriched_items: list[dict[str, Any]],
) -> str:
    """Generate a comparison radar chart for multiple items across fields."""
    if len(items) < 2 or not fields:
        return ""

    import math

    n_axes = len(fields)
    if n_axes < 3:
        return '<p><em>Radar chart requires at least 3 fields.</em></p>'

    cx, cy = 150, 150
    max_r = 100
    svg_w = 320
    svg_h = 320

    confidence_values = {"high": 1.0, "medium": 0.66, "low": 0.33, "none": 0.0}
    item_colors = [COLOR_WEB, COLOR_GITHUB, COLOR_CODEBASE, COLOR_HIGH, COLOR_MEDIUM, COLOR_LOW]

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_w} {svg_h}" '
        f'width="{svg_w}" height="{svg_h}" font-family="system-ui, sans-serif" font-size="10">'
    ]

    # Grid rings
    for ring_pct in [0.25, 0.5, 0.75, 1.0]:
        r = max_r * ring_pct
        points = []
        for j in range(n_axes):
            angle = -90 + (360 / n_axes) * j
            x = cx + r * math.cos(math.radians(angle))
            y = cy + r * math.sin(math.radians(angle))
            points.append(f"{x:.1f},{y:.1f}")
        parts.append(f'<polygon points="{" ".join(points)}" fill="none" '
                    f'stroke="{COLOR_GRID}" stroke-width="1" />')

    # Axis lines and labels
    for j, field in enumerate(fields):
        angle = -90 + (360 / n_axes) * j
        x = cx + max_r * math.cos(math.radians(angle))
        y = cy + max_r * math.sin(math.radians(angle))
        parts.append(f'<line x1="{cx}" y1="{cy}" x2="{x:.1f}" y2="{y:.1f}" '
                    f'stroke="{COLOR_GRID}" stroke-width="1" />')
        # Label
        lx = cx + (max_r + 15) * math.cos(math.radians(angle))
        ly = cy + (max_r + 15) * math.sin(math.radians(angle))
        fname = _esc(field.get("name", field.get("id", "")))[:12]
        parts.append(f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle" '
                    f'fill="{COLOR_TEXT}" font-size="9">{fname}</text>')

    # Item polygons
    for i, item in enumerate(enriched_items):
        color = item_colors[i % len(item_colors)]
        points = []
        for j, field in enumerate(fields):
            angle = -90 + (360 / n_axes) * j
            field_data = item.get("fields", {}).get(field["id"], {})
            confidence = field_data.get("confidence", "none")
            value = confidence_values.get(confidence, 0) * max_r
            x = cx + value * math.cos(math.radians(angle))
            y = cy + value * math.sin(math.radians(angle))
            points.append(f"{x:.1f},{y:.1f}")

        parts.append(f'<polygon points="{" ".join(points)}" fill="{color}" '
                    f'fill-opacity="0.15" stroke="{color}" stroke-width="2" />')

    # Legend
    ly = svg_h - 15
    lx = 10
    for i, item in enumerate(enriched_items):
        color = item_colors[i % len(item_colors)]
        iname = _esc(item.get("name", item.get("id", "")))[:12]
        parts.append(f'<rect x="{lx}" y="{ly - 8}" width="8" height="8" rx="1" fill="{color}" />')
        parts.append(f'<text x="{lx + 12}" y="{ly}" fill="{COLOR_TEXT}" font-size="9">{iname}</text>')
        lx += len(iname) * 6 + 30

    parts.append('</svg>')
    return '\n'.join(parts)


def confidence_bars(counts: dict[str, int]) -> str:
    """Generate a confidence distribution bar chart as SVG."""
    total = sum(counts.values())
    if total == 0:
        return '<p><em>No confidence data available.</em></p>'

    bars = [("High", counts.get("high", 0), COLOR_HIGH),
            ("Medium", counts.get("medium", 0), COLOR_MEDIUM),
            ("Low", counts.get("low", 0), COLOR_LOW),
            ("None", counts.get("none", 0), COLOR_NONE)]

    svg_w = 280
    svg_h = 120
    bar_w = 44
    bar_gap = 16
    chart_top = 30
    chart_bottom = 95
    chart_h = chart_bottom - chart_top
    max_val = max(counts.values()) if counts else 1

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_w} {svg_h}" '
        f'width="{svg_w}" height="{svg_h}" font-family="system-ui, sans-serif" font-size="11">'
    ]

    # Title
    parts.append(f'<text x="{svg_w / 2}" y="16" text-anchor="middle" '
                f'font-size="12" font-weight="600" fill="{COLOR_TEXT}">Confidence Distribution</text>')

    # Bars
    x = 30
    for label, count, color in bars:
        bar_h = (count / max_val * chart_h) if max_val > 0 else 0
        y = chart_bottom - bar_h
        parts.append(f'<rect x="{x}" y="{y:.1f}" width="{bar_w}" height="{bar_h:.1f}" '
                    f'rx="3" fill="{color}" opacity="0.85" />')
        # Count on top
        if count > 0:
            parts.append(f'<text x="{x + bar_w / 2}" y="{y - 4:.1f}" text-anchor="middle" '
                        f'fill="{COLOR_TEXT}" font-size="11" font-weight="600">{count}</text>')
        # Label below
        parts.append(f'<text x="{x + bar_w / 2}" y="{chart_bottom + 14}" text-anchor="middle" '
                    f'fill="{COLOR_TEXT}" font-size="10">{label}</text>')
        x += bar_w + bar_gap

    parts.append('</svg>')
    return '\n'.join(parts)
