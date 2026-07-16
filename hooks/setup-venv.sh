#!/usr/bin/env bash
set -e

AGENT_VENV="${HOME}/.venvs/omagents"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[omagents] Python 3 is not installed. Please install Python 3.11+." >&2
  exit 1
fi

if [ ! -d "$AGENT_VENV" ]; then
  echo "[omagents] Creating agent venv at $AGENT_VENV" >&2
  python3 -m venv "$AGENT_VENV"
fi

"$AGENT_VENV/bin/pip" install -q jinja2 2>&1 || true

# Copy skill helper scripts into the venv so wrapper scripts can invoke them.
SKILL_SCRIPTS_DIR="$SCRIPT_DIR/../skills"
if [ -d "$SKILL_SCRIPTS_DIR" ]; then
  mkdir -p "$AGENT_VENV/scripts"
  for src_dir in "$SKILL_SCRIPTS_DIR"/*/scripts; do
    if [ -d "$src_dir" ]; then
      cp -R "$src_dir"/* "$AGENT_VENV/scripts/"
    fi
  done
fi

echo "[omagents] venv ready at $AGENT_VENV" >&2
echo '{}'
