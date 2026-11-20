# OmAgents Cross-Platform Plugin Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate installable Claude Code (`.claude-plugin/`) and Codex (`.codex-plugin/`) plugin artifacts from a single source-of-truth, while keeping the existing OpenCode plugin unchanged.

**Architecture:** A shared `mcp-servers/` definition, shared `hooks/` scripts, and a `scripts/sync-platform.sh` generator produce per-platform manifests, skills, hooks, and wrapper scripts. OpenCode keeps its JS plugin runtime. The parallel execution engine is not ported.

**Tech Stack:** bash, Node 24, Python 3.11+, npm, git.

## Global Constraints

- Node version: 24 (matching CI).
- Python version: 3.11+ for skill scripts.
- Generated `.claude-plugin/` and `.codex-plugin/` directories must be committed to the repo.
- OpenCode plugin `.opencode/plugins/index.js` must continue to work without user-facing changes.
- `superpowers` dependency must remain pinned.
- Only `jinja2` is auto-installed into the agent venv; other packages are installed on-demand by skills.
- README changes must be mirrored in all four language files (`README.md`, `README.zh-cn.md`, `README.ja.md`, `README.ko.md`).

---

## File Overview

| File | Responsibility |
|---|---|
| `mcp-servers/base.json` | Source-of-truth for built-in MCP server definitions |
| `.opencode/plugins/index.js` | OpenCode plugin entry; imports `mcp-servers/base.json` |
| `hooks/setup-venv.sh` | Creates `~/.venvs/omagents` and installs `jinja2` |
| `scripts/sync-platform.sh` | Main generator for `.claude-plugin/` and `.codex-plugin/` |
| `scripts/templates/` | JSON templates for generated `plugin.json` files |
| `scripts/tool-mapping.txt` | Per-platform tool name substitutions for skills |
| `bin-src/` | Wrapper scripts installed into the agent venv |
| `.claude-plugin/` | Generated Claude plugin |
| `.codex-plugin/` | Generated Codex plugin |
| `tests/sync-platform.test.js` | Node tests for the generator |
| `.github/workflows/ci.yml` | CI checks including sync and dirty-tree check |

---

### Task 1: Extract shared MCP definitions

**Files:**
- Create: `mcp-servers/base.json`
- Modify: `.opencode/plugins/index.js`
- Modify: `tests/plugin.test.js`

**Interfaces:**
- Consumes: existing hard-coded `BUILTIN_MCPS` in `.opencode/plugins/index.js`.
- Produces: a JSON file other generators can read.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin.test.js` addition:

```js
import { test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"

const ROOT = path.resolve(import.meta.dirname, "..")

test("mcp-servers/base.json exists and contains expected servers", () => {
  const basePath = path.join(ROOT, "mcp-servers", "base.json")
  assert.ok(fs.existsSync(basePath), "mcp-servers/base.json should exist")
  const data = JSON.parse(fs.readFileSync(basePath, "utf-8"))
  for (const name of ["agentmemory", "codegraph", "context7", "websearch"]) {
    assert.ok(data[name], `Missing MCP server: ${name}`)
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/plugin.test.js
```

Expected: FAIL with "mcp-servers/base.json should exist".

- [ ] **Step 3: Create `mcp-servers/base.json`**

```json
{
  "agentmemory": {
    "type": "local",
    "command": ["npx", "-y", "@agentmemory/mcp"]
  },
  "codegraph": {
    "type": "local",
    "command": ["npx", "-y", "@colbymchenry/codegraph", "serve", "--mcp"]
  },
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp"
  },
  "websearch": {
    "type": "remote",
    "url": "https://mcp.exa.ai/mcp"
  },
  "grep_app": {
    "type": "remote",
    "url": "https://mcp.grep.app"
  }
}
```

- [ ] **Step 4: Refactor `.opencode/plugins/index.js` to import `base.json`**

Add near the top:

```js
import baseMcps from "../../mcp-servers/base.json" with { type: "json" }
```

Replace the old `BUILTIN_MCPS` object construction with:

```js
const BUILTIN_MCPS = {}
for (const [name, def] of Object.entries(baseMcps)) {
  BUILTIN_MCPS[name] = { ...def, enabled: true }
}
```

Keep the existing `GITHUB_TOKEN` conditional logic for `github` / `grep_app` fallback.

- [ ] **Step 5: Run the test to verify it passes**

```bash
node --test tests/plugin.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mcp-servers/base.json .opencode/plugins/index.js tests/plugin.test.js
git commit -m "refactor: share MCP definitions in mcp-servers/base.json"
```

---

### Task 2: Add shared Python venv setup hook script

**Files:**
- Create: `hooks/setup-venv.sh`

**Interfaces:**
- Consumes: system `python3` and `pip`.
- Produces: a working `~/.venvs/omagents` with `jinja2` installed.

- [ ] **Step 1: Create the script**

```bash
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
```

Make it executable:

```bash
chmod +x hooks/setup-venv.sh
```

- [ ] **Step 2: Test the script**

```bash
rm -rf ~/.venvs/omagents
./hooks/setup-venv.sh
~/.venvs/omagents/bin/python -c "import jinja2; print('ok')"
```

Expected output contains "venv ready" and the Python command prints "ok".

- [ ] **Step 3: Commit**

```bash
git add hooks/setup-venv.sh
git commit -m "feat: add shared python venv setup hook"
```

---

### Task 3: Create the sync script skeleton

**Files:**
- Create: `scripts/sync-platform.sh`
- Create: `scripts/templates/.gitkeep` (temporary, removed later)
- Modify: `.gitignore` if needed (do not ignore generated directories)

**Interfaces:**
- Consumes: `package.json`, `mcp-servers/base.json`.
- Produces: empty `.claude-plugin/` and `.codex-plugin/` directory trees.

- [ ] **Step 1: Write the failing test**

Create `tests/sync-platform.test.js`:

```js
import { test } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"
import { execSync } from "child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const SCRIPT = path.join(ROOT, "scripts", "sync-platform.sh")

test("sync script generates claude and codex directories", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })
  assert.ok(fs.existsSync(path.join(ROOT, ".claude-plugin", "plugin.json")))
  assert.ok(fs.existsSync(path.join(ROOT, ".codex-plugin", "plugin.json")))
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/sync-platform.test.js
```

Expected: FAIL (script not yet implemented).

- [ ] **Step 3: Implement the skeleton `scripts/sync-platform.sh`**

```bash
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

echo "[sync] generated skeleton for $PLATFORM"
```

Make it executable:

```bash
chmod +x scripts/sync-platform.sh
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/sync-platform.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-platform.sh tests/sync-platform.test.js
git commit -m "feat: add sync-platform.sh skeleton"
```

---

### Task 4: Generate Claude plugin manifest and MCP config

**Files:**
- Create: `scripts/templates/plugin.claude.json`
- Modify: `scripts/sync-platform.sh`
- Modify: `tests/sync-platform.test.js`

**Interfaces:**
- Consumes: `package.json`, `mcp-servers/base.json`, template.
- Produces: `.claude-plugin/plugin.json`, `.claude-plugin/.mcp.json`.

- [ ] **Step 1: Create the Claude plugin template**

Create `scripts/templates/plugin.claude.json`:

```json
{
  "name": "omagents",
  "displayName": "OmAgents",
  "version": "{{VERSION}}",
  "description": "Opencode agent toolkit: bundled skills, MCP servers, and Python tooling.",
  "author": {
    "name": "OmAgents"
  },
  "homepage": "https://github.com/omagents/omagents",
  "repository": "https://github.com/omagents/omagents",
  "license": "MIT",
  "keywords": ["skills", "mcp", "agents", "research"],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json",
  "dependencies": [
    {
      "name": "superpowers",
      "version": "~6.1.0"
    }
  ]
}
```

- [ ] **Step 2: Update sync script to generate Claude manifest**

In `scripts/sync-platform.sh`, after the `mkdir` lines, add for the `claude` platform:

```bash
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"

sed "s/{{VERSION}}/$VERSION/g" "$ROOT_DIR/scripts/templates/plugin.claude.json" \
  > "$ROOT_DIR/.claude-plugin/plugin.json"

python3 - "$ROOT_DIR/mcp-servers/base.json" "$ROOT_DIR/.claude-plugin/.mcp.json" <<'PY'
import json, sys
from pathlib import Path
base = json.loads(Path(sys.argv[1]).read_text())
out = {}
for name, defn in base.items():
    entry = {"type": defn["type"]}
    if defn["type"] == "local":
        entry["command"] = defn["command"][0]
        entry["args"] = defn["command"][1:]
    else:
        entry["url"] = defn["url"]
    out[name] = entry
Path(sys.argv[2]).write_text(json.dumps(out, indent=2) + "\n")
PY
```

- [ ] **Step 3: Update the test**

Add to `tests/sync-platform.test.js` inside the existing test or as a new test:

```js
test("claude plugin.json and .mcp.json are valid and correct", () => {
  const claudeJson = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf-8"))
  assert.strictEqual(claudeJson.name, "omagents")
  assert.ok(claudeJson.version)
  assert.ok(claudeJson.skills)
  assert.ok(claudeJson.mcpServers)
  assert.deepStrictEqual(claudeJson.dependencies, [{ name: "superpowers", version: "~6.1.0" }])

  const mcpJson = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", ".mcp.json"), "utf-8"))
  assert.ok(mcpJson.agentmemory)
  assert.ok(mcpJson.codegraph)
  assert.strictEqual(mcpJson.agentmemory.type, "local")
})
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/sync-platform.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/templates/plugin.claude.json scripts/sync-platform.sh tests/sync-platform.test.js
git commit -m "feat: generate claude plugin manifest and mcp config"
```

---

### Task 5: Generate Codex plugin manifest and MCP config

**Files:**
- Create: `scripts/templates/plugin.codex.json`
- Modify: `scripts/sync-platform.sh`
- Modify: `tests/sync-platform.test.js`

**Interfaces:**
- Consumes: same as Task 4 but for Codex format.
- Produces: `.codex-plugin/plugin.json`, `.codex-plugin/.mcp.json`.

- [ ] **Step 1: Create the Codex plugin template**

Create `scripts/templates/plugin.codex.json`:

```json
{
  "name": "omagents",
  "version": "{{VERSION}}",
  "description": "Opencode agent toolkit: bundled skills, MCP servers, and Python tooling.",
  "author": {
    "name": "OmAgents"
  },
  "homepage": "https://github.com/omagents/omagents",
  "repository": "https://github.com/omagents/omagents",
  "license": "MIT",
  "keywords": ["skills", "mcp", "agents", "research"],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "hooks": "./hooks/hooks.json",
  "interface": {
    "displayName": "OmAgents",
    "shortDescription": "Agent toolkit for research, loops, and tooling.",
    "longDescription": "OmAgents bundles deep-research, loop workflows, MCP servers, and Python tooling for agentic development.",
    "developerName": "OmAgents",
    "category": "Developer Tools",
    "capabilities": ["Read", "Write"]
  }
}
```

- [ ] **Step 2: Update sync script for Codex**

In the `codex` branch, add:

```bash
sed "s/{{VERSION}}/$VERSION/g" "$ROOT_DIR/scripts/templates/plugin.codex.json" \
  > "$ROOT_DIR/.codex-plugin/plugin.json"

python3 - "$ROOT_DIR/mcp-servers/base.json" "$ROOT_DIR/.codex-plugin/.mcp.json" <<'PY'
import json, sys
from pathlib import Path
base = json.loads(Path(sys.argv[1]).read_text())
out = {}
for name, defn in base.items():
    entry = {"type": defn["type"]}
    if defn["type"] == "local":
        entry["command"] = defn["command"][0]
        entry["args"] = defn["command"][1:]
    else:
        entry["url"] = defn["url"]
    out[name] = entry
Path(sys.argv[2]).write_text(json.dumps(out, indent=2) + "\n")
PY
```

Consider extracting the Python snippet into a helper to avoid duplication (optional but recommended).

- [ ] **Step 3: Update the test**

Add:

```js
test("codex plugin.json and .mcp.json are valid and correct", () => {
  const codexJson = JSON.parse(fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf-8"))
  assert.strictEqual(codexJson.name, "omagents")
  assert.ok(codexJson.version)
  assert.ok(codexJson.interface)
  assert.ok(codexJson.skills)

  const mcpJson = JSON.parse(fs.readFileSync(path.join(ROOT, ".codex-plugin", ".mcp.json"), "utf-8"))
  assert.ok(mcpJson.agentmemory)
  assert.strictEqual(mcpJson.agentmemory.type, "local")
})
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/sync-platform.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/templates/plugin.codex.json scripts/sync-platform.sh tests/sync-platform.test.js
git commit -m "feat: generate codex plugin manifest and mcp config"
```

---

### Task 6: Implement skill transformation and overrides

**Files:**
- Create: `scripts/tool-mapping.txt`
- Modify: `scripts/sync-platform.sh`
- Modify: `tests/sync-platform.test.js`
- Create: temporary test skill under `skills/` or use existing

**Interfaces:**
- Consumes: `skills/` source files, `scripts/tool-mapping.txt`, optional `SKILL.<platform>.md` overrides.
- Produces: `.<platform>-plugin/skills/<skill-name>/SKILL.md`.

- [ ] **Step 1: Create the tool mapping file**

Create `scripts/tool-mapping.txt`:

```
# Format: placeholder|claude_value|codex_value
{{tool:websearch}}|WebSearch|web_search
{{tool:webfetch}}|WebFetch|web_fetch
{{tool:read}}|Read|Read
{{tool:write}}|Write|Write
{{tool:edit}}|Edit|Edit
{{tool:bash}}|Bash|Bash
{{tool:subagent_parallel}}|Agent|subagent
{{tool:github_search_code}}|mcp__github__search_code|mcp__github__search_code
{{tool:codegraph_explore}}|mcp__codegraph__explore|mcp__codegraph__explore
```

- [ ] **Step 2: Add skill copy/transform logic to sync script**

After manifest generation in both branches, add:

```bash
# Copy skills with optional override
for skill_dir in "$ROOT_DIR"/skills/*/; do
  skill_name="$(basename "$skill_dir")"
  src="$skill_dir/SKILL.md"
  override="$skill_dir/SKILL.$PLATFORM.md"
  dest_dir="$ROOT_DIR/.$PLATFORM-plugin/skills/$skill_name"
  mkdir -p "$dest_dir"
  if [ -f "$override" ]; then
    cp "$override" "$dest_dir/SKILL.md"
  else
    cp "$src" "$dest_dir/SKILL.md"
  fi

  # Apply tool mapping
  while IFS='|' read -r placeholder claude_value codex_value; do
    # skip comments and blank lines
    [[ -z "$placeholder" || "${placeholder:0:1}" == "#" ]] && continue
    value="${claude_value}"
    [ "$PLATFORM" == "codex" ] && value="${codex_value}"
    sed -i.bak "s|${placeholder}|${value}|g" "$dest_dir/SKILL.md"
  done < "$ROOT_DIR/scripts/tool-mapping.txt"
  rm -f "$dest_dir/SKILL.md.bak"
done
```

- [ ] **Step 3: Update the test**

Add:

```js
import { execSync } from "child_process"

test("skills are transformed with correct tool names", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  const claudeDeep = fs.readFileSync(path.join(ROOT, ".claude-plugin", "skills", "deep-research", "SKILL.md"), "utf-8")
  const codexDeep = fs.readFileSync(path.join(ROOT, ".codex-plugin", "skills", "deep-research", "SKILL.md"), "utf-8")

  assert.ok(claudeDeep.includes("WebSearch"), "Claude skill should mention WebSearch")
  assert.ok(codexDeep.includes("web_search"), "Codex skill should mention web_search")
})
```

Note: this test assumes `{{tool:websearch}}` placeholder exists in the source skill. If not, add a placeholder first or pick an existing literal tool name to test.

- [ ] **Step 4: Add at least one placeholder to a source skill**

Edit `skills/deep-research/SKILL.md` and replace one instance of `websearch_web_search_exa` with `{{tool:websearch}}`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
node --test tests/sync-platform.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/tool-mapping.txt scripts/sync-platform.sh tests/sync-platform.test.js skills/deep-research/SKILL.md
git commit -m "feat: transform skills per platform with tool mapping"
```

---

### Task 7: Generate platform hook configs

**Files:**
- Create: `scripts/templates/hooks.claude.json`
- Create: `scripts/templates/hooks.codex.json`
- Modify: `scripts/sync-platform.sh`
- Modify: `tests/sync-platform.test.js`

**Interfaces:**
- Consumes: `hooks/setup-venv.sh`.
- Produces: `.<platform>-plugin/hooks/hooks.json`.

- [ ] **Step 1: Create hook templates**

`scripts/templates/hooks.claude.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/setup-venv.sh",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

`scripts/templates/hooks.codex.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "${PLUGIN_ROOT}/hooks/setup-venv.sh",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Update sync script**

Add in both branches:

```bash
cp "$ROOT_DIR/scripts/templates/hooks.$PLATFORM.json" "$ROOT_DIR/.$PLATFORM-plugin/hooks/hooks.json"
cp "$ROOT_DIR/hooks/setup-venv.sh" "$ROOT_DIR/.$PLATFORM-plugin/hooks/setup-venv.sh"
chmod +x "$ROOT_DIR/.$PLATFORM-plugin/hooks/setup-venv.sh"
```

- [ ] **Step 3: Update the test**

```js
test("hooks are generated and reference setup-venv", () => {
  const claudeHooks = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "hooks", "hooks.json"), "utf-8"))
  assert.ok(claudeHooks.hooks.SessionStart[0].hooks[0].command.includes("setup-venv.sh"))

  const codexHooks = JSON.parse(fs.readFileSync(path.join(ROOT, ".codex-plugin", "hooks", "hooks.json"), "utf-8"))
  assert.ok(codexHooks.hooks.SessionStart[0].hooks[0].command.includes("setup-venv.sh"))
})
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/sync-platform.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/templates/hooks.claude.json scripts/templates/hooks.codex.json scripts/sync-platform.sh tests/sync-platform.test.js
git commit -m "feat: generate platform hook configs"
```

---

### Task 8: Create wrapper scripts and install helpers

**Files:**
- Create: `bin-src/loop_engine`
- Create: `bin-src/deep_research`
- Create: `bin-src/markitdown`
- Modify: `scripts/sync-platform.sh`
- Modify: `tests/sync-platform.test.js`

**Interfaces:**
- Consumes: `~/.venvs/omagents/bin/python`.
- Produces: wrapper scripts in `bin-src/` and copied to `.claude-plugin/bin/`.

- [ ] **Step 1: Create wrapper scripts**

`bin-src/loop_engine`:

```bash
#!/usr/bin/env bash
exec ~/.venvs/omagents/bin/python ~/.venvs/omagents/scripts/loop_engine.py "$@"
```

`bin-src/deep_research`:

```bash
#!/usr/bin/env bash
exec ~/.venvs/omagents/bin/python ~/.venvs/omagents/scripts/deep_research.py "$@"
```

`bin-src/markitdown`:

```bash
#!/usr/bin/env bash
exec ~/.venvs/omagents/bin/python ~/.venvs/omagents/scripts/markitdown.py "$@"
```

Make them executable:

```bash
chmod +x bin-src/*
```

- [ ] **Step 2: Update setup-venv.sh to copy helper scripts**

Add after jinja2 install:

```bash
# Copy skill helper scripts into a stable location
mkdir -p ~/.venvs/omagents/scripts
rsync -q "$SCRIPT_DIR/../skills/_shared/scripts/" ~/.venvs/omagents/scripts/ || true
rsync -q "$SCRIPT_DIR/../skills/deep-research/scripts/" ~/.venvs/omagents/scripts/ || true
```

Note: `SCRIPT_DIR` in `setup-venv.sh` must be defined. Replace the existing `SCRIPT_DIR` calculation if needed, or use plugin root passed via hook environment variable. For the initial version, rely on the script being copied next to the original source and compute its own directory.

- [ ] **Step 3: Update sync script to copy wrappers**

For Claude:

```bash
cp "$ROOT_DIR/bin-src/"* "$ROOT_DIR/.claude-plugin/bin/"
chmod +x "$ROOT_DIR/.claude-plugin/bin/"*
```

For Codex, wrappers live in the generated plugin and are symlinked by the venv setup hook; no extra copy needed.

- [ ] **Step 4: Update the test**

```js
test("claude bin wrappers are generated", () => {
  assert.ok(fs.existsSync(path.join(ROOT, ".claude-plugin", "bin", "loop_engine")))
  assert.ok(fs.existsSync(path.join(ROOT, ".claude-plugin", "bin", "deep_research")))
})
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node --test tests/sync-platform.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add bin-src scripts/sync-platform.sh hooks/setup-venv.sh tests/sync-platform.test.js
git commit -m "feat: add venv wrapper scripts and install helpers"
```

---

### Task 9: Bundle superpowers skills for Claude and Codex

**Files:**
- Modify: `scripts/sync-platform.sh`
- Modify: `tests/sync-platform.test.js`

**Interfaces:**
- Consumes: `node_modules/superpowers/skills/`.
- Produces: `.claude-plugin/skills/superpowers/*` and `.codex-plugin/skills/superpowers/*`.

Superpowers skills are bundled into both Claude and Codex plugins. They are not declared as a plugin dependency, so the generated `plugin.json` does not list `superpowers` under `dependencies`. The bundled skills are copied verbatim without applying the OmAgents tool-name mapping, so they retain their original Superpowers tool references.

- [ ] **Step 1: Update sync script to bundle superpowers skills for both platforms**

After copying OmAgents skills, add:

```bash
SUPERPOWERS_SOURCE_DIR="$ROOT_DIR/node_modules/superpowers/skills"
SUPERPOWERS_TARGET_DIR="$SKILL_TARGET_DIR/superpowers"

if [[ -d "$SUPERPOWERS_SOURCE_DIR" ]]; then
  mkdir -p "$SUPERPOWERS_TARGET_DIR"
  for super_skill_dir in "$SUPERPOWERS_SOURCE_DIR"/*/; do
    super_skill_name=$(basename "$super_skill_dir")

    if [[ "$super_skill_name" == _* || "$super_skill_name" == .* ]]; then
      continue
    fi

    super_target_dir="$SUPERPOWERS_TARGET_DIR/$super_skill_name"
    rm -rf "$super_target_dir"
    mkdir -p "$super_target_dir"
    cp -R "$super_skill_dir/"* "$super_target_dir/"

    find "$super_target_dir" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
  done
else
  echo "[sync] warning: superpowers skills not found at $SUPERPOWERS_SOURCE_DIR" >&2
fi
```

Do not apply the OmAgents tool-name mapping to the copied superpowers skills.

- [ ] **Step 2: Update the tests**

```js
test("node_modules/superpowers/skills exists and contains at least 14 skill directories", () => {
  const superpowersDir = path.join(ROOT, "node_modules", "superpowers", "skills")
  assert.ok(fs.existsSync(superpowersDir), "node_modules/superpowers/skills should exist")

  const dirs = fs
    .readdirSync(superpowersDir)
    .filter((name) => {
      const full = path.join(superpowersDir, name)
      return fs.statSync(full).isDirectory() && !name.startsWith("_") && !name.startsWith(".")
    })

  assert.ok(dirs.length >= 14, `expected at least 14 superpowers skill directories, found ${dirs.length}`)
})

test("sync script bundles the same superpowers skills for claude and codex", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  const getSkills = (platform) => {
    const dir = path.join(ROOT, `.${platform}-plugin`, "skills", "superpowers")
    return fs
      .readdirSync(dir)
      .filter((name) => fs.statSync(path.join(dir, name)).isDirectory())
      .sort()
  }

  assert.deepStrictEqual(getSkills("claude"), getSkills("codex"))
})

test("each bundled superpowers skill has YAML frontmatter", () => {
  execSync(`bash "${SCRIPT}" claude`, { cwd: ROOT, stdio: "ignore" })
  execSync(`bash "${SCRIPT}" codex`, { cwd: ROOT, stdio: "ignore" })

  for (const platform of ["claude", "codex"]) {
    const superpowersDir = path.join(ROOT, `.${platform}-plugin`, "skills", "superpowers")
    const dirs = fs.readdirSync(superpowersDir).filter((name) => {
      return fs.statSync(path.join(superpowersDir, name)).isDirectory()
    })

    for (const skillName of dirs) {
      const skillMd = path.join(superpowersDir, skillName, "SKILL.md")
      assert.ok(fs.existsSync(skillMd))
      const content = fs.readFileSync(skillMd, "utf-8")
      assert.ok(content.startsWith("---"))
    }
  }
})
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
npm install
node --test tests/sync-platform.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-platform.sh tests/sync-platform.test.js
git commit -m "feat: bundle superpowers skills for claude and codex"
```

---

### Task 10: Add npm scripts and CI checks

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/sync-platform.test.js`

**Interfaces:**
- Consumes: `scripts/sync-platform.sh`.
- Produces: `npm run sync`, CI sync check.

- [ ] **Step 1: Add npm scripts**

In `package.json`:

```json
{
  "scripts": {
    "build:pack": "npm pack",
    "test": "node --test tests/*.test.js",
    "format": "prettier --write .opencode/plugins/*.js tests/*.js",
    "format:check": "prettier --check .opencode/plugins/*.js tests/*.js",
    "sync": "bash scripts/sync-platform.sh claude && bash scripts/sync-platform.sh codex",
    "sync:check": "npm run sync && git diff --exit-code .claude-plugin .codex-plugin"
  }
}
```

- [ ] **Step 2: Update CI**

Add to `.github/workflows/ci.yml` after the existing steps:

```yaml
      - name: Sync platform plugins
        run: npm run sync

      - name: Check generated files are up to date
        run: git diff --exit-code .claude-plugin .codex-plugin

      - name: Run sync tests
        run: node --test tests/sync-platform.test.js
```

- [ ] **Step 3: Run the full CI-like checks locally**

```bash
npm run sync
git diff --exit-code .claude-plugin .codex-plugin
node --test tests/*.test.js
```

Expected: no diff, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/ci.yml tests/sync-platform.test.js
git commit -m "ci: add sync scripts and generated-file check"
```

---

### Task 11: Update README installation docs for all languages

**Files:**
- Modify: `README.md`
- Modify: `README.zh-cn.md`
- Modify: `README.ja.md`
- Modify: `README.ko.md`

**Interfaces:**
- Consumes: generated plugin directories.
- Produces: updated installation instructions.

- [ ] **Step 1: Add a cross-platform installation section**

Add after the existing OpenCode TL;DR in all four files:

```markdown
### Claude Code

Install from the repository root (must contain `.claude-plugin/plugin.json`):

```bash
claude plugin install /path/to/omagents
```

### Codex

Install from the repository root (must contain `.codex-plugin/plugin.json`):

```bash
codex plugin add /path/to/omagents
```
```

- [ ] **Step 2: Note feature limitations**

In each README, add a note:

```markdown
> **Note for Claude/Codex users:** The OpenCode-specific parallel execution engine and `shell.env` PATH injection are not available in manifest-based plugins. Python tooling is set up via `SessionStart` hooks and `bin/` wrappers.
```

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh-cn.md README.ja.md README.ko.md
git commit -m "docs: add claude and codex installation instructions"
```

---

### Task 12: Integration test checklist

**Files:**
- None (manual verification).

**Interfaces:**
- Verifies end-to-end behavior in real harnesses.

- [ ] **Step 1: Claude Code smoke test**

```bash
# In the repo root
claude plugin install "$(pwd)"
```

Then in a Claude Code session:

```
Let's make a react todo list
```

Expected: `brainstorming` skill auto-triggers (if superpowers is installed or bundled).

- [ ] **Step 2: Codex smoke test**

```bash
# In the repo root
codex plugin add "$(pwd)"
```

Then in a Codex session:

```
Let's make a react todo list
```

Expected: `brainstorming` skill auto-triggers.

- [ ] **Step 3: Verify venv setup**

After the first session start in either harness, check:

```bash
ls ~/.venvs/omagents/bin/python
~/.venvs/omagents/bin/python -c "import jinja2; print('ok')"
```

Expected: venv exists and `jinja2` is importable.

- [ ] **Step 4: Commit integration notes**

If integration reveals issues, create follow-up tasks rather than blocking the plan.

```bash
git add docs/integration-test-notes.md  # if created
# or skip if no file changes
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - Single source-of-truth: ✅ `mcp-servers/base.json`, `hooks/setup-venv.sh`, `scripts/sync-platform.sh`.
   - Claude plugin generation: ✅ Task 4.
   - Codex plugin generation: ✅ Task 5.
   - Skill platformization: ✅ Task 6.
   - venv/hooks: ✅ Task 2, Task 7, Task 8.
   - Superpowers bundling for Codex: ✅ Task 9.
   - CI and docs: ✅ Task 10, Task 11.
   - Integration testing: ✅ Task 12.

2. **Placeholder scan:**
   - No `TODO`, `TBD`, or vague steps.
   - Every code block contains concrete content.

3. **Type consistency:**
   - `mcp-servers/base.json` uses array commands; sync script converts to per-platform format consistently in Tasks 4 and 5.
   - Hook env vars: `${CLAUDE_PLUGIN_ROOT}` for Claude, `${PLUGIN_ROOT}` for Codex, matching each harness's docs.
