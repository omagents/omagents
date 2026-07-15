#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

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

# Build a Perl script that performs word-boundary replacements for all mapped tools.
# Perl gives us consistent \b semantics across macOS and Linux.
PL_SCRIPT=$(mktemp)
{
  cat <<'PL_HEADER'
use strict;
use warnings;
my %map = (
PL_HEADER
  while IFS='|' read -r opencode_tool claude_val codex_val; do
    # Trim surrounding whitespace
    opencode_tool="${opencode_tool#"${opencode_tool%%[![:space:]]*}"}"
    opencode_tool="${opencode_tool%"${opencode_tool##*[![:space:]]}"}"
    # Skip comments and blank lines
    [[ -z "$opencode_tool" || "$opencode_tool" == \#* ]] && continue
    if [[ "$PLATFORM" == "claude" ]]; then
      val="$claude_val"
    else
      val="$codex_val"
    fi
    # Escape characters that would break a Perl double-quoted string
    key_escaped=$(printf '%s' "$opencode_tool" | sed 's/["$@\\]/\\&/g')
    val_escaped=$(printf '%s' "$val" | sed 's/["$@\\]/\\&/g')
    printf '  "%s" => "%s",\n' "$key_escaped" "$val_escaped"
  done < "$MAP_FILE"
  cat <<'PL_FOOTER'
);
my @keys = sort { length($b) <=> length($a) } keys %map;
while (<>) {
  for my $k (@keys) {
    s/\b\Q$k\E\b/$map{$k}/g;
  }
  print;
}
PL_FOOTER
} > "$PL_SCRIPT"

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
  perl "$PL_SCRIPT" "$src" > "$SKILL_TARGET_DIR/$skill_name/SKILL.md"

  # Copy optional skill subdirectories and apply tool mapping only to Markdown files
  for subdir in scripts templates agents; do
    if [[ -d "$skill_dir/$subdir" ]]; then
      target_subdir="$SKILL_TARGET_DIR/$skill_name/$subdir"
      mkdir -p "$target_subdir"
      cp -R "$skill_dir/$subdir/"* "$target_subdir/"
      find "$target_subdir" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
      find "$target_subdir" -type f -not -path '*/__pycache__/*' -not -name '.DS_Store' -name '*.md' -print0 | while IFS= read -r -d '' file; do
        tmp=$(mktemp)
        perl "$PL_SCRIPT" "$file" > "$tmp"
        mv "$tmp" "$file"
      done
    fi
  done
done

# Copy shared scripts and apply tool mapping only to Markdown files
if [[ -d "$SKILL_SOURCE_DIR/_shared" ]]; then
  target_shared="$SKILL_TARGET_DIR/_shared"
  rm -rf "$target_shared"
  cp -R "$SKILL_SOURCE_DIR/_shared" "$target_shared"
  find "$target_shared" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
  find "$target_shared" -type f -not -path '*/__pycache__/*' -not -name '.DS_Store' -name '*.md' -print0 | while IFS= read -r -d '' file; do
    tmp=$(mktemp)
    perl "$PL_SCRIPT" "$file" > "$tmp"
    mv "$tmp" "$file"
  done
fi

rm "$PL_SCRIPT"

echo "[sync] generated skeleton for $PLATFORM"
