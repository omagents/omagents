#!/usr/bin/env bash
set -e

AGENT_VENV="${HOME}/.venvs/omagents"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[omagents] Python 3 is not installed. Please install Python 3.11+." >&2
  exit 1
fi

if [ ! -d "$AGENT_VENV" ]; then
  echo "[omagents] Creating agent venv at $AGENT_VENV"
  python3 -m venv "$AGENT_VENV"
fi

"$AGENT_VENV/bin/pip" install -q jinja2 || true

echo "[omagents] venv ready at $AGENT_VENV"
