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

sed -e "s/{{VERSION}}/$VERSION/g" -e "s/{{DESCRIPTION}}/$DESCRIPTION/g" \
  "$SCRIPT_DIR/templates/plugin.$PLATFORM.json" > "$ROOT_DIR/.$PLATFORM-plugin/plugin.json"

node - "$ROOT_DIR/mcp-servers/base.json" "$ROOT_DIR/.$PLATFORM-plugin/.mcp.json" <<'JS'
const fs = require("fs");
const base = JSON.parse(fs.readFileSync(process.argv[2], "utf-8"));
const out = {};
for (const [name, defn] of Object.entries(base)) {
  const entry = { type: defn.type };
  if (defn.type === "local") {
    entry.command = defn.command[0];
    entry.args = defn.command.slice(1);
  } else {
    entry.url = defn.url;
  }
  out[name] = entry;
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2) + "\n");
JS

# Copy skills with platform-specific tool mapping and overrides
SKILL_SOURCE_DIR="$ROOT_DIR/skills"
SKILL_TARGET_DIR="$ROOT_DIR/.$PLATFORM-plugin/skills"
MAP_FILE="$SCRIPT_DIR/tool-mapping.txt"

mkdir -p "$SKILL_TARGET_DIR"

SED_SCRIPT=$(mktemp)
while IFS='|' read -r placeholder claude_val codex_val; do
  [[ -z "$placeholder" ]] && continue
  if [[ "$PLATFORM" == "claude" ]]; then
    val="$claude_val"
  else
    val="$codex_val"
  fi
  printf 's|%s|%s|g\n' "$placeholder" "$val" >> "$SED_SCRIPT"
done < "$MAP_FILE"

for skill_dir in "$SKILL_SOURCE_DIR"/*/; do
  skill_name=$(basename "$skill_dir")
  src="$skill_dir/SKILL.md"

  if [[ "$skill_name" == _* || "$skill_name" == .* ]]; then
    continue
  fi

  if [[ "$PLATFORM" == "claude" && -f "$skill_dir/SKILL.claude.md" ]]; then
    src="$skill_dir/SKILL.claude.md"
  elif [[ "$PLATFORM" == "codex" && -f "$skill_dir/SKILL.codex.md" ]]; then
    src="$skill_dir/SKILL.codex.md"
  fi

  mkdir -p "$SKILL_TARGET_DIR/$skill_name"
  sed -f "$SED_SCRIPT" "$src" > "$SKILL_TARGET_DIR/$skill_name/SKILL.md"
done

rm "$SED_SCRIPT"

echo "[sync] generated skeleton for $PLATFORM"
