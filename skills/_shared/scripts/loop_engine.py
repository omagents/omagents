#!/usr/bin/env python3
"""
Loop Engine - Durable task queue for iterative skill workflows.

Manages a JSON-based task queue per skill, stored in .omagents/loops/<skill>/tasks.json.
Supports: init, next, complete, fail (with retry), status, summary, reset, add.

Usage:
    loop_engine.py init <skill> '<tasks_json>'
    loop_engine.py next <skill>
    loop_engine.py complete <skill> <task_id> [result]
    loop_engine.py fail <skill> <task_id> [error]
    loop_engine.py status <skill>
    loop_engine.py summary <skill>
    loop_engine.py reset <skill>
    loop_engine.py add <skill> '<task_json>'

State machine per task:
    pending -> (execute) -> completed (success) or pending/retry (fail, attempts < 3) or blocked (fail, attempts >= 3)
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

MAX_ATTEMPTS = 3
LOOP_BASE = Path(".omagents") / "loops"


def _state_path(skill):
    return LOOP_BASE / skill / "tasks.json"


def _load(skill):
    path = _state_path(skill)
    if not path.exists():
        print(json.dumps({"error": f"No loop found for '{skill}'. Run 'init' first."}))
        sys.exit(1)
    return json.loads(path.read_text(encoding="utf-8"))


def _save(skill, state):
    path = _state_path(skill)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


def cmd_init(skill, tasks_json):
    tasks = json.loads(tasks_json)
    for i, t in enumerate(tasks):
        t.setdefault("id", i + 1)
        t["status"] = "pending"
        t["attempts"] = 0
    state = {
        "skill": skill,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "tasks": tasks,
        "stats": {
            "total": len(tasks),
            "pending": len(tasks),
            "completed": 0,
            "blocked": 0,
            "retried": 0,
        },
    }
    _save(skill, state)
    print(f"Initialized {len(tasks)} tasks for '{skill}' at {_state_path(skill)}")


def cmd_next(skill):
    state = _load(skill)
    for task in state["tasks"]:
        if task["status"] == "pending":
            print(json.dumps(task, ensure_ascii=False))
            return
    print("null")


def cmd_complete(skill, task_id, result=""):
    state = _load(skill)
    for task in state["tasks"]:
        if task["id"] == int(task_id):
            task["status"] = "completed"
            task["result"] = result
            task["completed_at"] = datetime.now().isoformat()
            state["stats"]["completed"] += 1
            state["stats"]["pending"] -= 1
            state["updated_at"] = datetime.now().isoformat()
            _save(skill, state)
            print(f"Task {task_id} completed: {result}")
            return
    print(f"Task {task_id} not found")


def cmd_fail(skill, task_id, error=""):
    state = _load(skill)
    for task in state["tasks"]:
        if task["id"] == int(task_id):
            task["attempts"] += 1
            task["last_error"] = error
            if task["attempts"] >= MAX_ATTEMPTS:
                task["status"] = "blocked"
                task["error"] = error
                state["stats"]["blocked"] += 1
                state["stats"]["pending"] -= 1
                print(f"Task {task_id} BLOCKED after {MAX_ATTEMPTS} attempts: {error}")
            else:
                task["status"] = "pending"
                state["stats"]["retried"] += 1
                print(
                    f"Task {task_id} retry {task['attempts']}/{MAX_ATTEMPTS}: {error}"
                )
            state["updated_at"] = datetime.now().isoformat()
            _save(skill, state)
            return
    print(f"Task {task_id} not found")


def cmd_status(skill):
    state = _load(skill)
    s = state["stats"]
    print(
        f"Total: {s['total']} | "
        f"Completed: {s['completed']} | "
        f"Pending: {s['pending']} | "
        f"Blocked: {s['blocked']} | "
        f"Retried: {s['retried']}"
    )


def cmd_summary(skill):
    state = _load(skill)
    icons = {"completed": "[x]", "blocked": "[!]", "pending": "[ ]"}
    for task in state["tasks"]:
        icon = icons.get(task["status"], "[?]")
        desc = task.get("description", task.get("file", task.get("name", "unknown")))
        extra = ""
        if task["status"] == "blocked":
            extra = f"  ERROR: {task.get('error', 'unknown')}"
        elif task["status"] == "completed":
            extra = f"  -> {task.get('result', '')}"
        elif task.get("attempts", 0) > 0:
            extra = f"  (attempts: {task['attempts']})"
        print(f"{icon} #{task['id']} {desc}{extra}")
    s = state["stats"]
    print(f"\nCompleted: {s['completed']}/{s['total']} | Blocked: {s['blocked']} | Pending: {s['pending']}")


def cmd_reset(skill):
    path = _state_path(skill)
    if path.exists():
        path.unlink()
        print(f"Reset loop for '{skill}'")
    else:
        print(f"No loop found for '{skill}'")


def cmd_add(skill, task_json):
    state = _load(skill)
    task = json.loads(task_json)
    max_id = max((t["id"] for t in state["tasks"]), default=0)
    task["id"] = max_id + 1
    task["status"] = "pending"
    task["attempts"] = 0
    state["tasks"].append(task)
    state["stats"]["total"] += 1
    state["stats"]["pending"] += 1
    state["updated_at"] = datetime.now().isoformat()
    _save(skill, state)
    print(f"Added task #{task['id']} to '{skill}'")


COMMANDS = {
    "init": lambda args: cmd_init(args[0], args[1]),
    "next": lambda args: cmd_next(args[0]),
    "complete": lambda args: cmd_complete(args[0], args[1], args[2] if len(args) > 2 else ""),
    "fail": lambda args: cmd_fail(args[0], args[1], args[2] if len(args) > 2 else ""),
    "status": lambda args: cmd_status(args[0]),
    "summary": lambda args: cmd_summary(args[0]),
    "reset": lambda args: cmd_reset(args[0]),
    "add": lambda args: cmd_add(args[0], args[1]),
}


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    args = sys.argv[2:]
    COMMANDS[cmd](args)


if __name__ == "__main__":
    main()
