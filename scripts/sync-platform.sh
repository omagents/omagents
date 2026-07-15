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
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
DESCRIPTION="$(node -p "require('$ROOT_DIR/package.json').description")"

cat > "$ROOT_DIR/.$PLATFORM-plugin/plugin.json" <<EOF
{
  "name": "$NAME",
  "version": "$VERSION",
  "description": "$DESCRIPTION"
}
EOF

echo "[sync] generated skeleton for $PLATFORM"
