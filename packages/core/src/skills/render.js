import fs from "node:fs"
import path from "node:path"

import { AGENT_VENV, AGENT_VENV_BIN, getVenvPython } from "../../hooks/python-env.js"

export const SKILL_HOSTS = Object.freeze(["opencode-v1", "opencode-v2", "codex", "dsh"])

const CODEX_TOOL_MAPPING = {
  "# OpenCode Deep Research": "# Codex Deep Research",
  "native to OpenCode's subagent and MCP infrastructure": "native to Codex subagents and MCP infrastructure",
  "- OpenCode's built-in web search, GitHub, and codegraph tools (or MCP equivalents)": "- Codex-native subagents plus web search, GitHub, and codegraph tools (or MCP equivalents)",
  "Background task completions are automatically injected via the Background Job Board.": "Codex delivers native subagent completion results to your mailbox.",
  "`task(background: true)`": "`spawn_agent` with `fork_turns: \"none\"`",
  "Multiple `task` calls in one response execute simultaneously.": "Independent `spawn_agent` calls execute asynchronously; continue useful work while they run.",
  websearch_web_search_exa: "web_search",
  webfetch: "web_fetch",
  codegraph_codegraph_explore: "mcp__codegraph__explore",
  github_list_issues: "mcp__github__list_issues",
  github_issue_read: "mcp__github__issue_read",
  github_search_issues: "mcp__github__search_issues",
  github_issue_write: "mcp__github__issue_write",
  github_add_issue_comment: "mcp__github__add_issue_comment",
  github_create_pull_request: "mcp__github__create_pull_request",
  github_pull_request_read: "mcp__github__pull_request_read",
  github_update_pull_request: "mcp__github__update_pull_request",
  github_update_pull_request_branch: "mcp__github__update_pull_request_branch",
  github_pull_request_review_write: "mcp__github__pull_request_review_write",
  github_add_comment_to_pending_review: "mcp__github__add_comment_to_pending_review",
  github_merge_pull_request: "mcp__github__merge_pull_request",
  github_add_reply_to_pull_request_comment: "mcp__github__add_reply_to_pull_request_comment",
  github_search_code: "mcp__github__search_code",
  github_search_pull_requests: "mcp__github__search_pull_requests",
  github_list_releases: "mcp__github__list_releases",
}

const OPENCODE_V2_TOOL_MAPPING = {
  "`task(background: true)`": "`subagent(..., background: true)`",
  "task(background=true,": "subagent(background=true,",
  "Multiple `task` calls": "Multiple `subagent` calls",
}

const DSH_TOOL_MAPPING = {
  websearch_web_search_exa: "web_search",
  websearch_web_fetch_exa: "web_fetch",
  webfetch: "web_fetch",
  codegraph_codegraph_explore: "mcp__codegraph__codegraph_explore",
  "`load_skill`": "`skill`",
  github_list_issues: "mcp__github__list_issues",
  github_issue_read: "mcp__github__issue_read",
  github_search_issues: "mcp__github__search_issues",
  github_issue_write: "mcp__github__issue_write",
  github_add_issue_comment: "mcp__github__add_issue_comment",
  github_create_pull_request: "mcp__github__create_pull_request",
  github_pull_request_read: "mcp__github__pull_request_read",
  github_update_pull_request: "mcp__github__update_pull_request",
  github_update_pull_request_branch: "mcp__github__update_pull_request_branch",
  github_pull_request_review_write: "mcp__github__pull_request_review_write",
  github_add_comment_to_pending_review: "mcp__github__add_comment_to_pending_review",
  github_merge_pull_request: "mcp__github__merge_pull_request",
  github_add_reply_to_pull_request_comment: "mcp__github__add_reply_to_pull_request_comment",
  github_search_code: "mcp__github__search_code",
  github_search_pull_requests: "mcp__github__search_pull_requests",
  github_list_releases: "mcp__github__list_releases",
}

// Hosts are explicit API inputs. Never infer a host from the runtime or cwd.
const TOOL_MAPPINGS = {
  "opencode-v1": {},
  "opencode-v2": OPENCODE_V2_TOOL_MAPPING,
  codex: CODEX_TOOL_MAPPING,
  dsh: DSH_TOOL_MAPPING,
}

const SORTED_TOOL_NAMES = Object.fromEntries(
  SKILL_HOSTS.map((host) => [
    host,
    Object.keys(TOOL_MAPPINGS[host]).sort((a, b) => b.length - a.length),
  ])
)

function assertSkillHost(host) {
  if (!SKILL_HOSTS.includes(host)) {
    throw new RangeError(`Unsupported skill host: ${host}. Expected one of ${SKILL_HOSTS.join(", ")}`)
  }
}

export function selectSkillPath(directory, host) {
  assertSkillHost(host)
  const overridePath = path.join(directory, `SKILL.${host}.md`)
  return fs.existsSync(overridePath) ? overridePath : path.join(directory, "SKILL.md")
}

/** Parse the small YAML frontmatter surface used by bundled skills. */
export function parseSkillFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: raw }

  const frontmatter = {}
  let lastKey = null
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.replace(/\r$/, "")
    const colonIdx = line.indexOf(":")
    if (colonIdx > 0 && !/^\s/.test(line)) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      frontmatter[key] = /^(>[+-]?|\|[+-]?)$/.test(value) ? "" : value
      lastKey = key
    } else if (lastKey !== null && line.trim() !== "") {
      frontmatter[lastKey] = `${frontmatter[lastKey]} ${line.trim()}`.trim()
    }
  }

  for (const key of Object.keys(frontmatter)) {
    frontmatter[key] = frontmatter[key].replace(/^(["'])([\s\S]*)\1$/, "$2")
  }

  return { frontmatter, body: match[2] }
}

function applyToolMapping(content, host) {
  let rendered = content
  const mapping = TOOL_MAPPINGS[host]
  for (const toolName of SORTED_TOOL_NAMES[host]) {
    rendered = rendered.replaceAll(toolName, mapping[toolName])
  }
  return rendered
}

/**
 * Resolve DSH skill resources without assuming a cwd, PATH injection, or a
 * source checkout. Model-tool mappings stay separate from CLI subcommands.
 */
const BARE_PACKAGED_SCRIPT =
  /(?<![\w/.-])(?:\.\.\/[a-z0-9-]+\/scripts\/|scripts\/)[a-z0-9_.-]+/g

function isPackagedScriptCommand(lines, index) {
  const line = lines[index]
  const previous = index > 0 ? lines[index - 1] : ""
  return (
    /\b(?:run|invoke|execute)\b/i.test(line) ||
    (/\b(?:run|invoke|execute)\b/i.test(previous) && /^\s*[`"']/.test(line)) ||
    /^\s*[`"']?\s*(?:scripts\/|\.\.\/[a-z0-9-]+\/scripts\/)/i.test(line)
  )
}

/** Resolve only actual command tokens that name existing packaged files. */
function resolveBarePackagedScripts(content, skillDirectory) {
  const lines = content.split("\n")
  return lines
    .map((line, index) => {
      if (!isPackagedScriptCommand(lines, index)) return line
      return line.replace(BARE_PACKAGED_SCRIPT, (script) => {
        const absolute = path.resolve(skillDirectory, script)
        return fs.existsSync(absolute) ? absolute : script
      })
    })
    .join("\n")
}

function applyDshResourceMapping(content, definition, sharedSkill) {
  const python = getVenvPython(AGENT_VENV)
  const skillDirectory = definition.directory
  let rendered = content

  for (const interpreter of ["bash", "node", "python", "python3"]) {
    const commandPython = interpreter.startsWith("python") ? python : interpreter
    const invocation = new RegExp(`\\b${interpreter} ((?:\\./)?scripts/[a-z0-9_.-]+)`, "g")
    rendered = rendered.replace(invocation, (command, relative) => {
      const absolute = path.resolve(skillDirectory, relative)
      return fs.existsSync(absolute) ? `${commandPython} ${absolute}` : command
    })
  }
  rendered = rendered.replaceAll(
    "node ./render-graphs.js",
    `node ${path.join(skillDirectory, "render-graphs.js")}`
  )
  rendered = resolveBarePackagedScripts(rendered, skillDirectory)

  if (definition.source === "omagents") {
    const coreRoot = path.resolve(skillDirectory, "..", "..")
    const coreSkills = path.join(coreRoot, "skills")
    const loopEngine = path.join(coreSkills, "_shared", "scripts", "loop_engine.py")
    const deepResearch = path.join(coreSkills, "deep-research", "scripts", "deep_research.py")
    const preResearch = path.join(coreSkills, "deep-research", "scripts", "pre_research.py")

    rendered = rendered
      .replaceAll(
        "packages/core/skills/deep-research/scripts/",
        `${path.dirname(deepResearch)}${path.sep}`
      )
      .replaceAll("packages/core/skills/_shared/scripts/loop_engine.py", loopEngine)
      .replaceAll("<omagents-core>", coreRoot)

    if (sharedSkill) {
      rendered = rendered
        .replaceAll("loop_engine.py ", `${python} ${loopEngine} `)
        .replaceAll("deep_research.py ", `${python} ${deepResearch} `)
        .replaceAll("pre_research.py ", `${python} ${preResearch} `)
    }
  }

  if (definition.name === "markitdown-converter") {
    const executable = path.join(
      AGENT_VENV_BIN,
      process.platform === "win32" ? "markitdown.exe" : "markitdown"
    )
    rendered = rendered
      .replace(/^[ \t]*markitdown\s+/gm, `${executable} `)
      .replaceAll("| markitdown ", `| ${executable} `)
  }

  return rendered
    .replaceAll("<skill-dir>/..", path.dirname(skillDirectory))
    .replaceAll("<skill-dir>", skillDirectory)
    .replaceAll("<python>", python)
    .replaceAll("<base-venv>", AGENT_VENV)
}

/**
 * Render one discovered skill for an explicit host. A SKILL.<host>.md file is
 * a complete replacement for SKILL.md, not a patch. `content` retains the full
 * Markdown document; `body` is provided for hosts that require no frontmatter.
 */
export function renderSkillForHost(definition, host) {
  assertSkillHost(host)
  if (!definition || typeof definition.directory !== "string") {
    throw new TypeError("A skill definition with a directory is required")
  }

  const skillPath = selectSkillPath(definition.directory, host)
  const sharedSkill = skillPath === path.join(definition.directory, "SKILL.md")
  let content = applyToolMapping(fs.readFileSync(skillPath, "utf8"), host)
  if (host === "dsh") {
    content = applyDshResourceMapping(content, definition, sharedSkill)
  }
  const { frontmatter, body } = parseSkillFrontmatter(content)

  return {
    ...definition,
    name: frontmatter.name || definition.name,
    description: frontmatter.description || definition.description,
    host,
    path: skillPath,
    content,
    body,
    frontmatter,
  }
}
