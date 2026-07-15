#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLATFORM="${1:-}"

if [[ "$PLATFORM" != "claude" && "$PLATFORM" != "codex" ]]; then
  echo "Usage: $0 <claude|codex>" >&2
  exit 1
fi

mkdir -p "$ROOT_DIR/.$PLATFORM-plugin/skills"
mkdir -p "$ROOT_DIR/.$PLATFORM-plugin/hooks"
mkdir -p "$ROOT_DIR/.$PLATFORM-plugin/bin"

NAME="omagents"
DISPLAY_NAME="OmAgents"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
DESCRIPTION="Agent toolkit: deep research, loop workflows, MCP servers, and Python tooling."

if [[ "$PLATFORM" == "claude" ]]; then
  cat > "$ROOT_DIR/.$PLATFORM-plugin/plugin.json" <<EOF
{
  "name": "$NAME",
  "displayName": "$DISPLAY_NAME",
  "version": "$VERSION",
  "description": "$DESCRIPTION",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json"
}
EOF
else
  cat > "$ROOT_DIR/.$PLATFORM-plugin/plugin.json" <<EOF
{
  "name": "$NAME",
  "version": "$VERSION",
  "description": "$DESCRIPTION",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json",
  "interface": {
    "displayName": "$DISPLAY_NAME",
    "shortDescription": "Agent toolkit for research, loops, and tooling.",
    "longDescription": "$DESCRIPTION",
    "developerName": "$DISPLAY_NAME",
    "category": "Developer Tools",
    "capabilities": ["Read", "Write"]
  }
}
EOF
fi

echo "[sync] generated skeleton for $PLATFORM"
