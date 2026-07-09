/**
 * OmAgents Parallel Execution Plugin
 *
 * Intercepts OpenCode's native `task` tool with `background: true` to track
 * background jobs, inject job status into the orchestrator's context, and
 * provide a `/ps` command for checking running tasks.
 *
 * Inspired by oh-my-opencode-slim's task-session-manager.
 */

import path from "path"
import fs from "fs"
import os from "os"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── Job Board ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} JobRecord
 * @property {string} taskID
 * @property {string} parentSessionID
 * @property {string} agent
 * @property {string} description
 * @property {string} state - "running" | "completed" | "error" | "cancelled" | "reconciled"
 * @property {string} [terminalState]
 * @property {boolean} terminalUnreconciled
 * @property {string} [resultSummary]
 * @property {number} launchedAt
 * @property {number} [completedAt]
 * @property {string} [alias]
 */

/** @type {Map<string, JobRecord>} taskID -> JobRecord */
const jobBoard = new Map()

/** @type {Map<string, {callId: string, parentSessionId: string, agentType: string, label: string}>} */
const pendingCalls = new Map()

/** @type {Set<string>} */
const processedCompletions = new Set()
const MAX_PROCESSED = 500

// ─── Parallel Execution System Prompt ───────────────────────────────────────
// Injected into ALL agents (build, plan, custom) via system.transform.

const PARALLEL_SYSTEM_PROMPT = `<Parallel_Execution>
You have parallel execution capabilities via background tasks.

## When to parallelize
- Researching multiple items (e.g., "compare frameworks A, B, C" -> 3 parallel research tasks)
- Exploring different parts of a codebase simultaneously
- Implementing independent features or fixes in different files/modules
- Any work where subtasks don't depend on each other

## How to parallelize
1. Decompose the user's request into independent subtasks
2. Call \`task(subagent_type, description, prompt, background: true)\` for each - multiple calls in one response run in parallel
3. Continue working on other things while they run
4. Background task completions are automatically injected into your context via the Background Job Board - do NOT poll
5. When all background tasks are done, synthesize their results

## For dependent tasks
If task B needs results from task A: launch A with \`background: true\`, continue other work, and when A's result appears in the Job Board, launch B with A's results in the prompt.

## Rules
- Prefer \`task(..., background: true)\` for delegated work that can run independently
- Do NOT poll running tasks. The plugin notifies you when they complete.
- Acknowledge completed tasks from the Job Board before your final response.
- Parallel background tasks are allowed only when their write scopes do not conflict.
- You can launch up to 5-8 parallel tasks. For more, batch them.
- Use \`cancel_task\` only when the user asks, or when a running lane is obsolete or wrong.
- For trivial tasks or tiny mechanical edits, direct execution is fine.
</Parallel_Execution>`

// Alias counter
let aliasCounter = 0
function nextAlias(agent) {
  const prefix = (agent || "task").slice(0, 3)
  aliasCounter++
  return `${prefix}-${aliasCounter}`
}

// ─── TUI State File ─────────────────────────────────────────────────────────

const ENV_NAME = "OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS"
const START_MARKER = "# >>> omagents background subagents >>>"
const END_MARKER = "# <<< omagents background subagents <<<"

function isBackgroundSubagentsEnabled() {
  const val = process.env[ENV_NAME]
  if (!val) return false
  const norm = val.trim().toLowerCase()
  return norm !== "" && !["0", "false", "no", "off"].includes(norm)
}

function detectShellConfigPath() {
  const shell = process.env.SHELL?.split("/").pop()
  const home = os.homedir()
  if (shell === "zsh") return path.join(home, ".zshrc")
  if (shell === "bash") return path.join(home, ".bashrc")
  if (shell === "fish") {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
    return path.join(xdg, "fish", "conf.d", "omagents-background-subagents.fish")
  }
  return undefined
}

function ensureBackgroundSubagentsEnv() {
  if (isBackgroundSubagentsEnabled()) return

  const targetPath = detectShellConfigPath()
  if (!targetPath) {
    console.warn("[omagents] Could not detect shell config file. Set OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true manually.")
    return
  }

  try {
    const isFish = targetPath.endsWith(".fish")
    const command = isFish ? `set -gx ${ENV_NAME} true` : `export ${ENV_NAME}=true`
    const block = `${START_MARKER}\n${command}\n${END_MARKER}`

    let content = ""
    try {
      content = fs.readFileSync(targetPath, "utf8")
    } catch {
      // file doesn't exist yet
    }

    // Check if block already exists
    if (content.includes(START_MARKER)) return

    // Append block
    const prefix = content.length > 0 && !content.endsWith("\n") ? "\n\n" : ""
    const newContent = `${content}${prefix}${block}\n`
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, newContent)
    console.log(`[omagents] Added ${ENV_NAME}=true to ${targetPath}. Restart your shell or OpenCode for background subagents.`)
  } catch (err) {
    console.warn(`[omagents] Could not write to shell config: ${err.message}`)
  }
}

function getTuiStatePath() {
  const dataDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  return path.join(dataDir, "opencode", "storage", "omagents", "tui-state.json")
}

function writeTuiState() {
  try {
    const statePath = getTuiStatePath()
    fs.mkdirSync(path.dirname(statePath), { recursive: true })

    const jobs = [...jobBoard.values()]
    const snapshot = {
      version: 1,
      updatedAt: Date.now(),
      running: jobs.filter(j => j.state === "running").length,
      completed: jobs.filter(j => j.state === "completed" || j.state === "reconciled").length,
      error: jobs.filter(j => j.state === "error").length,
      jobs: jobs.map(j => ({
        alias: j.alias,
        agent: j.agent,
        description: j.description,
        state: j.state,
        elapsed: j.state === "running" ? Date.now() - j.launchedAt : (j.completedAt || Date.now()) - j.launchedAt,
      })),
    }
    fs.writeFileSync(statePath, JSON.stringify(snapshot, null, 2) + "\n")
  } catch {
    // best-effort
  }
}

// ─── Task Output Parsing ────────────────────────────────────────────────────

function parseTaskIdFromOutput(output) {
  if (typeof output !== "string") return undefined
  const xmlMatch = /<task\s+[^>]*\bid=["']([^"']+)["'][^>]*>/i.exec(output)
  if (xmlMatch) return xmlMatch[1]
  for (const line of output.split(/\r?\n/)) {
    const match = /^task_id:\s*([^\s()]+)/.exec(line.trim())
    if (match) return match[1]
  }
  return undefined
}

function parseTaskStateFromOutput(output) {
  if (typeof output !== "string") return undefined
  const xmlMatch = /<task\s+[^>]*\bstate=["'](running|completed|error|cancelled)["'][^>]*>/i.exec(output)
  if (xmlMatch) return xmlMatch[1].toLowerCase()
  for (const line of output.split(/\r?\n/)) {
    const match = /^state:\s*(running|completed|error|cancelled)/i.exec(line.trim())
    if (match) return match[1].toLowerCase()
  }
  return undefined
}

function parseTaskResultFromOutput(output) {
  if (typeof output !== "string") return undefined
  const match = /<task_(result|error)>\s*([\s\S]*?)\s*<\/task_\1>/m.exec(output)
  return match?.[2]?.trim() || undefined
}

// ─── Job Board Operations ───────────────────────────────────────────────────

function registerLaunch(taskID, parentSessionID, agent, description) {
  const alias = nextAlias(agent)
  /** @type {JobRecord} */
  const record = {
    taskID,
    parentSessionID,
    agent: agent || "unknown",
    description: description || "(no description)",
    state: "running",
    terminalUnreconciled: false,
    launchedAt: Date.now(),
    alias,
  }
  jobBoard.set(taskID, record)
  writeTuiState()
  return record
}

function updateJobStatus(taskID, state, result) {
  const job = jobBoard.get(taskID)
  if (!job) return
  if (job.state === "reconciled" || job.state === "cancelled") return

  job.state = state
  job.terminalState = state
  job.terminalUnreconciled = state === "completed" || state === "error"
  job.resultSummary = result
  job.completedAt = Date.now()
  writeTuiState()
}

function reconcileJobs(parentSessionID) {
  for (const job of jobBoard.values()) {
    if (job.parentSessionID === parentSessionID && job.terminalUnreconciled) {
      job.state = "reconciled"
      job.terminalUnreconciled = false
    }
  }
  writeTuiState()
}

function getJobsForSession(parentSessionID) {
  return [...jobBoard.values()].filter(j => j.parentSessionID === parentSessionID)
}

function getUnreconciledJobs(parentSessionID) {
  return getJobsForSession(parentSessionID).filter(j => j.terminalUnreconciled)
}

function getRunningJobs(parentSessionID) {
  return getJobsForSession(parentSessionID).filter(j => j.state === "running")
}

// ─── Job Board Context for LLM ──────────────────────────────────────────────

function buildJobBoardText(sessionID) {
  const running = getRunningJobs(sessionID)
  const unreconciled = getUnreconciledJobs(sessionID)

  if (running.length === 0 && unreconciled.length === 0) return ""

  const lines = [
    "### Background Job Board",
    "SENTINEL: omagents-job-board-v1",
    "Do not poll running jobs. Wait for hook-driven completion notifications.",
    "",
  ]

  if (running.length > 0) {
    lines.push("#### Running")
    for (const job of running) {
      lines.push(`- ${job.alias} / ${job.taskID} / ${job.agent} / running`)
      lines.push(`  Objective: ${job.description}`)
    }
    lines.push("")
  }

  if (unreconciled.length > 0) {
    lines.push("#### Completed (unreconciled)")
    for (const job of unreconciled) {
      lines.push(`- ${job.alias} / ${job.taskID} / ${job.agent} / ${job.terminalState}`)
      lines.push(`  Objective: ${job.description}`)
      if (job.resultSummary) {
        const summary = job.resultSummary.slice(0, 500)
        lines.push(`  Result: ${summary}`)
      }
    }
    lines.push("")
    lines.push("Acknowledge completed jobs before your final response.")
  }

  return lines.join("\n")
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

/**
 * @param {{ client: any, serverUrl: URL, $: any }} ctx
 */
export function createParallelHooks(ctx) {
  const { client } = ctx

  // Auto-enable background subagents on first load
  try {
    ensureBackgroundSubagentsEnv()
  } catch {
    // best-effort
  }

  return {
    // ── Inject parallel instructions into ALL agents' system prompts ────────

    "experimental.chat.system.transform": async (_input, output) => {
      output.system = output.system || []
      output.system.push(PARALLEL_SYSTEM_PROMPT)
    },

    // ── Intercept task tool ─────────────────────────────────────────────────

    "tool.execute.before": async (input, output) => {
      if (input.tool !== "task") return

      const args = output.args
      if (!args) return

      // Track pending call
      const callId = input.callID
      pendingCalls.set(callId, {
        callId,
        parentSessionId: input.sessionID,
        agentType: args.subagent_type || "general",
        label: args.description || "",
      })
    },

    "tool.execute.after": async (input, output) => {
      if (input.tool !== "task") return

      const pending = pendingCalls.get(input.callID)
      if (!pending) return
      pendingCalls.delete(input.callID)

      const outputText = typeof output.output === "string" ? output.output : ""
      const taskID = parseTaskIdFromOutput(outputText)
      const state = parseTaskStateFromOutput(outputText)

      if (!taskID) return

      // Register or update job
      if (state === "running") {
        registerLaunch(taskID, pending.parentSessionId, pending.agentType, pending.label)
      } else if (state === "completed" || state === "error" || state === "cancelled") {
        const result = parseTaskResultFromOutput(outputText)
        registerLaunch(taskID, pending.parentSessionId, pending.agentType, pending.label)
        updateJobStatus(taskID, state, result)
      }
    },

    // ── Inject job board into LLM context ───────────────────────────────────

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages || output.messages.length === 0) return

      // 1. Process synthetic completion messages
      for (const msg of output.messages) {
        if (msg.info?.role !== "user") continue
        for (const part of msg.parts) {
          if (!part.synthetic) continue
          if (typeof part.text !== "string") continue

          const taskID = parseTaskIdFromOutput(part.text)
          const state = parseTaskStateFromOutput(part.text)
          if (!taskID || !state) continue

          const occId = `${msg.info.id}:${part.id || ""}:${taskID}:${state}`
          if (processedCompletions.has(occId)) continue
          processedCompletions.add(occId)
          if (processedCompletions.size > MAX_PROCESSED) {
            const first = processedCompletions.values().next().value
            if (first) processedCompletions.delete(first)
          }

          const result = parseTaskResultFromOutput(part.text)
          updateJobStatus(taskID, state, result)
        }
      }

      // 2. Inject job board into the last user message
      // Find the last user message
      let lastUser = null
      for (let i = output.messages.length - 1; i >= 0; i--) {
        if (output.messages[i].info?.role === "user") {
          lastUser = output.messages[i]
          break
        }
      }
      if (!lastUser) return

      // Extract session ID from the message context
      // We use the first job's parentSessionID as the session context
      const sessionJobs = [...jobBoard.values()]
      if (sessionJobs.length === 0) return

      // Try to find jobs for this session - we don't have direct sessionID here
      // so we inject for all sessions that have active jobs
      const boardText = buildJobBoardTextForAll()
      if (!boardText) return

      // Guard: don't double-inject
      const existingText = lastUser.parts[0]?.text || ""
      if (typeof existingText === "string" && existingText.includes("SENTINEL: omagents-job-board-v1")) return

      // Prepend job board to the first text part
      const firstPart = lastUser.parts.find(p => p.type === "text")
      if (firstPart) {
        firstPart.text = `${boardText}\n\n${firstPart.text || ""}`
      } else {
        lastUser.parts.unshift({ type: "text", text: boardText })
      }
    },

    // ── Event listener for session lifecycle ────────────────────────────────

    event: async ({ event }) => {
      if (event.type === "session.idle" || (event.type === "session.status" && event.properties?.type === "idle")) {
        const sessionID = event.properties?.sessionID || event.properties?.id
        if (!sessionID) return

        // Check if this is a parent session going idle -> reconcile
        reconcileJobs(sessionID)

        // Check if this is a child session that went idle while still marked running
        const job = jobBoard.get(sessionID)
        if (job && job.state === "running") {
          updateJobStatus(sessionID, "completed", undefined)
        }
      }

      if (event.type === "session.status" && event.properties?.type === "busy") {
        const sessionID = event.properties?.sessionID || event.properties?.id
        if (sessionID && jobBoard.has(sessionID)) {
          // Confirm still running
          writeTuiState()
        }
      }

      if (event.type === "session.deleted") {
        const sessionID = event.properties?.sessionID || event.properties?.id
        if (sessionID) {
          jobBoard.delete(sessionID)
          // Clean pending calls
          for (const [key, pending] of pendingCalls) {
            if (pending.parentSessionId === sessionID) {
              pendingCalls.delete(key)
            }
          }
          writeTuiState()
        }
      }
    },

    // ── Register /ps command ────────────────────────────────────────────────

    config: async (config) => {
      // Register /ps command
      config.command = config.command || {}
      if (!config.command.ps) {
        config.command.ps = {
          template: "List all background tasks for the current session. Use the parallel_status tool to get the current status, then display as a concise table with columns: Alias | Agent | Status | Elapsed | Description. If no tasks are running, say 'No background tasks.'",
          description: "Show running background tasks",
        }
      }
    },

    // ── Custom tools ────────────────────────────────────────────────────────

    tool: {
      parallel_status: {
        description: "Check the status of all background tasks for the current session. Returns a JSON summary of all tracked background jobs including their state (running/completed/error), elapsed time, and result summaries.",
        args: {
          session_id: {
            type: "string",
            description: "Optional session ID. If not provided, returns all jobs.",
          },
        },
        async execute(args, context) {
          let jobs
          if (args.session_id) {
            jobs = getJobsForSession(args.session_id)
          } else {
            // Return all jobs - the LLM can filter
            jobs = [...jobBoard.values()]
          }

          if (jobs.length === 0) {
            return JSON.stringify({ total: 0, message: "No background tasks found." })
          }

          const summary = {
            total: jobs.length,
            running: jobs.filter(j => j.state === "running").length,
            completed: jobs.filter(j => j.state === "completed" || j.state === "reconciled").length,
            error: jobs.filter(j => j.state === "error").length,
            tasks: jobs.map(j => ({
              alias: j.alias,
              task_id: j.taskID,
              agent: j.agent,
              description: j.description,
              state: j.state,
              elapsed_s: Math.round((j.state === "running" ? Date.now() - j.launchedAt : (j.completedAt || Date.now()) - j.launchedAt) / 1000),
              result: j.resultSummary?.slice(0, 200),
            })),
          }

          return JSON.stringify(summary, null, 2)
        },
      },

      cancel_task: {
        description: "Cancel a running background task by its task ID or alias. Aborts the underlying session.",
        args: {
          task_id: {
            type: "string",
            description: "The task ID or alias of the background task to cancel.",
          },
        },
        async execute(args, context) {
          const id = args.task_id
          if (!id) return "Error: task_id is required."

          // Find job by taskID or alias
          let job = jobBoard.get(id)
          if (!job) {
            job = [...jobBoard.values()].find(j => j.alias === id)
          }
          if (!job) {
            return `Error: No background task found with ID or alias '${id}'.`
          }
          if (job.state !== "running") {
            return `Task '${job.alias}' is already in state: ${job.state}.`
          }

          try {
            // Abort the session
            if (client) {
              await client.session.abort({ path: { id: job.taskID } })
            }
            updateJobStatus(job.taskID, "cancelled", undefined)
            return `Cancelled task '${job.alias}' (${job.taskID}).`
          } catch (err) {
            return `Error cancelling task '${job.alias}': ${err.message}`
          }
        },
      },
    },
  }
}

// ── Helper: build job board for all sessions ────────────────────────────────

function buildJobBoardTextForAll() {
  const running = [...jobBoard.values()].filter(j => j.state === "running")
  const unreconciled = [...jobBoard.values()].filter(j => j.terminalUnreconciled)

  if (running.length === 0 && unreconciled.length === 0) return ""

  const lines = [
    "### Background Job Board",
    "SENTINEL: omagents-job-board-v1",
    "Do not poll running jobs. Wait for hook-driven completion notifications.",
    "",
  ]

  if (running.length > 0) {
    lines.push("#### Running")
    for (const job of running) {
      lines.push(`- ${job.alias} / ${job.taskID} / ${job.agent} / running`)
      lines.push(`  Objective: ${job.description}`)
    }
    lines.push("")
  }

  if (unreconciled.length > 0) {
    lines.push("#### Completed (unreconciled)")
    for (const job of unreconciled) {
      lines.push(`- ${job.alias} / ${job.taskID} / ${job.agent} / ${job.terminalState}`)
      lines.push(`  Objective: ${job.description}`)
      if (job.resultSummary) {
        const summary = job.resultSummary.slice(0, 500)
        lines.push(`  Result: ${summary}`)
      }
    }
    lines.push("")
    lines.push("Acknowledge completed jobs before your final response.")
  }

  return lines.join("\n")
}

export default createParallelHooks
