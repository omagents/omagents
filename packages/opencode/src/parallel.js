/**
 * OpenCode lifecycle adapter for the shared Core Job Board.
 *
 * Tool-call correlation, host parsing, interruption, event subscription, and
 * TUI projection stay here. Job state, notifications, recovery transitions,
 * and durable JSON persistence are owned by Core.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { JobBoard, JsonJobStore } from "../../core/src/index.js"
import {
  buildLegacyParallelStatus,
  buildOpenCodeJobBoardContext,
  buildTuiState,
} from "./job-presenters.js"
import { getJobStorePath, getTuiStatePath } from "./job-store-paths.js"

const HOST = "opencode"
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

const PARALLEL_SYSTEM_PROMPT_V2 = `<Parallel_Execution>
You have parallel execution capabilities via background tasks.

## When to parallelize
- Researching multiple items (e.g., "compare frameworks A, B, C" -> 3 parallel research tasks)
- Exploring different parts of a codebase simultaneously
- Implementing independent features or fixes in different files/modules
- Any work where subtasks don't depend on each other

## How to parallelize
1. Decompose the user's request into independent subtasks
2. Call \`subagent(agent, description, prompt)\` for each - multiple calls in one response run in parallel; every subagent runs in the background
3. Continue working on other things while they run
4. Background task completions are automatically delivered to you and tracked on the Background Job Board - do NOT poll
5. When all background tasks are done, synthesize their results

## For dependent tasks
If task B needs results from task A: launch A with \`subagent(...)\`, continue other work, and when A's result appears in the Job Board, launch B with A's results in the prompt.

## Rules
- Prefer \`subagent(...)\` for delegated work that can run independently
- Do NOT poll running tasks. Completion notifications arrive automatically.
- Acknowledge completed tasks from the Job Board before your final response.
- Parallel background tasks are allowed only when their write scopes do not conflict.
- You can launch up to 5-8 parallel tasks. For more, batch them.
- Use \`cancel_task\` only when the user asks, or when a running lane is obsolete or wrong.
- For trivial tasks or tiny mechanical edits, direct execution is fine.
</Parallel_Execution>`

const PS_COMMAND_TEMPLATE =
  "List all background tasks for the current session. Use the parallel_status tool to get the current status, then display as a concise table with columns: Alias | Agent | Status | Elapsed | Description. If no tasks are running, say 'No background tasks.'"

const ENV_NAME = "OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS"
const START_MARKER = "# >>> omagents background subagents >>>"
const END_MARKER = "# <<< omagents background subagents <<<"

function warnIfDebug(...args) {
  if (process.env.OMAGENTS_DEBUG === "1") console.warn(...args)
}

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
  process.env[ENV_NAME] = "true"
  if (isBackgroundSubagentsEnabled() && process.env[ENV_NAME] !== "true") {
    process.env[ENV_NAME] = "true"
  }

  const targetPath = detectShellConfigPath()
  if (!targetPath) return

  try {
    const isFish = targetPath.endsWith(".fish")
    const command = isFish ? `set -gx ${ENV_NAME} true` : `export ${ENV_NAME}=true`
    const block = `${START_MARKER}\n${command}\n${END_MARKER}`
    let content = ""
    try {
      content = fs.readFileSync(targetPath, "utf8")
    } catch {
      // The file does not exist yet.
    }
    if (content.includes(START_MARKER)) return
    const prefix = content.length > 0 && !content.endsWith("\n") ? "\n\n" : ""
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, `${content}${prefix}${block}\n`)
  } catch {
    // The current process is enabled even when persistence is unavailable.
  }
}

function writeTuiState(board, statePath) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, `${JSON.stringify(buildTuiState(board), null, 2)}\n`)
  } catch {
    // TUI projection is best-effort; Core persistence is independent.
  }
}

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
  const xmlMatch =
    /<task\s+[^>]*\bstate=["'](running|completed|error|failed|cancelled|interrupted)["'][^>]*>/i.exec(
      output
    )
  if (xmlMatch) return xmlMatch[1].toLowerCase()
  for (const line of output.split(/\r?\n/)) {
    const match = /^state:\s*(running|completed|error|failed|cancelled|interrupted)/i.exec(
      line.trim()
    )
    if (match) return match[1].toLowerCase()
  }
  return undefined
}

function parseTaskResultFromOutput(output) {
  if (typeof output !== "string") return undefined
  const match = /<task_(result|error)>\s*([\s\S]*?)\s*<\/task_\1>/m.exec(output)
  return match?.[2]?.trim() || undefined
}

// File-backed Boards are process-wide by storage identity. Explicitly injected
// test Boards remain context-scoped and are never closed by the adapter.
const boardEntriesByPath = new Map()
const injectedBoardEntries = new WeakMap()

function getBoardEntry(ctx) {
  const injected = ctx?.omagents?.jobBoard
  if (injected) {
    if (ctx && typeof ctx === "object" && injectedBoardEntries.has(ctx)) {
      return injectedBoardEntries.get(ctx)
    }
    const entry = {
      owned: false,
      promise: Promise.resolve(injected),
      references: 0,
    }
    if (ctx && typeof ctx === "object") injectedBoardEntries.set(ctx, entry)
    return entry
  }

  const filePath = path.resolve(ctx?.omagents?.jobStorePath || getJobStorePath())
  if (boardEntriesByPath.has(filePath)) return boardEntriesByPath.get(filePath)

  const entry = {
    filePath,
    owned: true,
    promise: JobBoard.open({ store: new JsonJobStore({ filePath }) }),
    references: 0,
  }
  boardEntriesByPath.set(filePath, entry)
  return entry
}

function acquireBoardRuntime(entry, ctx, query) {
  entry.references += 1
  entry.tuiStatePath ??= ctx?.omagents?.tuiStatePath || getTuiStatePath()
  entry.runtimePromise ??= entry.promise
    .then(async (board) => {
      entry.board = board
      entry.unsubscribe = board.subscribe(() => writeTuiState(board, entry.tuiStatePath))
      try {
        await board.reconcile({ query })
      } catch (error) {
        warnIfDebug("[omagents] job recovery failed:", error.message)
      }
      return { board }
    })
    .catch((error) => {
      // An unreadable store must not reject every model-context transformation.
      warnIfDebug("[omagents] job store initialization failed:", error.message)
      const board = new JobBoard()
      entry.board = board
      entry.unsubscribe = board.subscribe(() => writeTuiState(board, entry.tuiStatePath))
      return { board }
    })
  return { entry, ready: entry.runtimePromise, tuiStatePath: entry.tuiStatePath }
}

function createBoardRuntime(ctx, query) {
  const entry = getBoardEntry(ctx)
  if (!entry.closingPromise) return acquireBoardRuntime(entry, ctx, query)

  const runtime = { entry, tuiStatePath: entry.tuiStatePath }
  runtime.ready = (async () => {
    try {
      await entry.closingPromise
    } catch {
      // The original cleanup observes the close failure; reopening is still safe
      // once the closing promise has settled and detached the old store.
    }
    const reopened = acquireBoardRuntime(getBoardEntry(ctx), ctx, query)
    runtime.entry = reopened.entry
    runtime.tuiStatePath = reopened.tuiStatePath
    return reopened.ready
  })()
  return runtime
}

async function releaseBoardRuntime(runtime) {
  const { entry } = runtime
  entry.references = Math.max(0, entry.references - 1)
  if (entry.references > 0) {
    const { board } = await runtime.ready
    await board.flush()
    return
  }

  if (!entry.owned) {
    const { board } = await runtime.ready
    entry.unsubscribe?.()
    await board.flush()
    return
  }

  // Keep the closing entry installed until every write and close has settled.
  // Concurrent setup waits here, then opens the next Board from the quiescent store.
  entry.closingPromise = (async () => {
    const { board } = await runtime.ready
    entry.unsubscribe?.()
    try {
      await board.close()
    } finally {
      if (boardEntriesByPath.get(entry.filePath) === entry) {
        boardEntriesByPath.delete(entry.filePath)
      }
    }
  })()
  await entry.closingPromise
}

function findJob(board, idOrAlias) {
  return board.get(idOrAlias) || board.list().find((job) => job.hostTaskId === idOrAlias)
}

function findHostJob(board, hostTaskId) {
  return board.list().find((job) => job.host === HOST && job.hostTaskId === hostTaskId)
}

function registerLaunch(board, hostTaskId, parentSessionId, agent, description) {
  return board.registerLaunch({
    host: HOST,
    hostTaskId,
    parentSessionId,
    agent,
    description,
  })
}

function normalizeTerminalState(state) {
  if (state === "error") return "failed"
  if (state === "interrupted") return "cancelled"
  return state
}

function markHostTerminal(board, hostTaskId, state, { resultSummary, error } = {}) {
  const job = findHostJob(board, hostTaskId)
  if (!job) return undefined
  const terminalState = normalizeTerminalState(state)
  return board.markTerminal(job.id, {
    state: terminalState,
    ...(resultSummary !== undefined ? { resultSummary } : {}),
    ...(error !== undefined
      ? { error }
      : terminalState === "failed" && resultSummary
        ? { error: { message: resultSummary } }
        : {}),
  })
}

function recoveryError(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status
  const missing =
    status === 404 ||
    error?.code === "ENOENT" ||
    error?.code === "NOT_FOUND" ||
    error?.name === "NotFoundError"
  return {
    kind: missing ? "missing" : "unreadable",
    reason: typeof error?.message === "string" ? error.message : String(error),
  }
}

function sessionOutcome(response) {
  const hasSessionState =
    response &&
    typeof response === "object" &&
    (["executionState", "state", "status", "outcome"].some((field) => field in response) ||
      typeof response.execution?.state === "string")
  if (response?.error && !hasSessionState) return recoveryError(response.error)
  const session =
    response && typeof response === "object" && "data" in response ? response.data : response
  if (!session) return { kind: "missing", reason: "host session not found" }

  const statusValue =
    session.executionState ??
    session.state ??
    (typeof session.status === "string" ? session.status : session.status?.type) ??
    session.execution?.state ??
    session.outcome
  const status = typeof statusValue === "string" ? statusValue.toLowerCase() : undefined
  const resultSummary = [session.resultSummary, session.result, session.output].find(
    (value) => typeof value === "string"
  )
  const errorMessage =
    typeof session.error === "string"
      ? session.error
      : typeof session.error?.message === "string"
        ? session.error.message
        : undefined

  if (["completed", "succeeded", "success", "idle"].includes(status)) {
    return { kind: "terminal", state: "completed", resultSummary }
  }
  if (["error", "failed"].includes(status)) {
    return {
      kind: "terminal",
      state: "failed",
      resultSummary,
      error: errorMessage ? { message: errorMessage } : { message: "host session failed" },
    }
  }
  if (["cancelled", "canceled", "interrupted", "aborted"].includes(status)) {
    return { kind: "terminal", state: "cancelled", resultSummary }
  }
  if (["running", "busy", "active", "cancelling", "pending"].includes(status)) {
    return { kind: "active" }
  }
  return {
    kind: "unreadable",
    reason: status
      ? `Unrecognized host session state: ${status}`
      : "Host session has no readable execution state or outcome",
  }
}

async function queryV1Session(client, job) {
  if (typeof client?.session?.get !== "function") {
    return { kind: "unreadable", reason: "OpenCode session query is unavailable" }
  }
  try {
    return sessionOutcome(await client.session.get({ path: { id: job.hostTaskId } }))
  } catch (error) {
    return recoveryError(error)
  }
}

async function queryV2Session(ctx, job) {
  if (typeof ctx.session?.get !== "function") {
    return { kind: "unreadable", reason: "OpenCode session query is unavailable" }
  }
  try {
    return sessionOutcome(await ctx.session.get({ sessionID: job.hostTaskId }))
  } catch (error) {
    return recoveryError(error)
  }
}

const JOB_BOARD_HEADING = "### Background Job Board"
const JOB_BOARD_END = "<!-- omagents-job-board-end -->"
const JOB_BOARD_ACK = "Acknowledge completed jobs before your final response."

function formatJobBoardBlock(boardText) {
  return `${boardText}\n${JOB_BOARD_END}`
}

function remainingTextAfterBoard(text, end, hasReplacement) {
  const remainder = text.slice(end)
  return hasReplacement ? remainder : remainder.replace(/^\r?\n\r?\n/, "")
}

function replaceExistingJobBoard(text, boardText) {
  const start = text.indexOf(JOB_BOARD_HEADING)
  if (start < 0 || !text.slice(start).includes("SENTINEL: omagents-job-board-v1")) {
    return undefined
  }
  const replacement = boardText ? formatJobBoardBlock(boardText) : ""

  const markedEnd = text.indexOf(JOB_BOARD_END, start)
  if (markedEnd >= 0) {
    const end = markedEnd + JOB_BOARD_END.length
    const remainder = remainingTextAfterBoard(text, end, !!replacement)
    return `${text.slice(0, start)}${replacement}${remainder}`
  }

  // Blocks written before the end marker existed end with the acknowledgement
  // when outcomes were present, or with a trailing newline for active-only
  // Boards (followed by the two-newline user-text separator).
  const acknowledged = text.indexOf(JOB_BOARD_ACK, start)
  const activeOnlySeparator = text.indexOf("\n\n\n", start)
  if (acknowledged >= 0 && (activeOnlySeparator < 0 || acknowledged < activeOnlySeparator)) {
    const end = acknowledged + JOB_BOARD_ACK.length
    const remainder = remainingTextAfterBoard(text, end, !!replacement)
    return `${text.slice(0, start)}${replacement}${remainder}`
  }
  if (activeOnlySeparator >= 0) {
    const end = activeOnlySeparator + 1
    const remainder = remainingTextAfterBoard(text, end, !!replacement)
    return `${text.slice(0, start)}${replacement}${remainder}`
  }
  return undefined
}

function injectBoardIntoParts(board, sessionID, parts) {
  const boardText = buildOpenCodeJobBoardContext(board, sessionID)
  let updated = false
  let foundExisting = false

  for (const part of parts) {
    if (part?.type !== "text" || typeof part.text !== "string") continue
    if (!part.text.includes("SENTINEL: omagents-job-board-v1")) continue
    foundExisting = true
    const replaced = replaceExistingJobBoard(part.text, boardText)
    if (replaced === undefined) return
    part.text = replaced
    updated = true
    break
  }

  if (!foundExisting && boardText) {
    const block = formatJobBoardBlock(boardText)
    const firstPart = parts.find((part) => part?.type === "text")
    if (firstPart) firstPart.text = `${block}\n\n${firstPart.text || ""}`
    else parts.unshift({ type: "text", text: block })
    updated = true
  }
  if (!updated) return

  const contextText = parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
  const injectedIds = board
    .listPendingOutcomes(sessionID)
    .filter((job) => contextText.includes(`- ${job.alias} / ${job.hostTaskId} /`))
    .map((job) => job.id)
  board.markInjected(injectedIds)
}

/**
 * Create the OpenCode 1.x hooks. The returned hook shape remains synchronous;
 * each Board-dependent hook awaits the same opened Core Board.
 */
export function createParallelHooks(ctx) {
  const { client } = ctx || {}
  const pendingCalls = new Map()
  const runtime = createBoardRuntime(ctx, (job) => queryV1Session(client, job))

  try {
    ensureBackgroundSubagentsEnv()
  } catch {
    // Best-effort host capability setup.
  }

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system = output.system || []
      if (output.system.includes(PARALLEL_SYSTEM_PROMPT)) return
      output.system.push(PARALLEL_SYSTEM_PROMPT)
    },

    "tool.execute.before": async (input, output) => {
      if (input.tool !== "task") return
      const args = output.args
      if (!args) return
      pendingCalls.set(input.callID, {
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
      if (!taskID || !state) return

      const { board } = await runtime.ready
      registerLaunch(board, taskID, pending.parentSessionId, pending.agentType, pending.label)
      if (state !== "running") {
        markHostTerminal(board, taskID, state, {
          resultSummary: parseTaskResultFromOutput(outputText),
        })
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages || output.messages.length === 0) return
      const { board } = await runtime.ready

      for (const msg of output.messages) {
        if (msg.info?.role !== "user") continue
        for (const part of msg.parts || []) {
          if (!part.synthetic || typeof part.text !== "string") continue
          const taskID = parseTaskIdFromOutput(part.text)
          const state = parseTaskStateFromOutput(part.text)
          if (!taskID || !state || state === "running") continue
          markHostTerminal(board, taskID, state, {
            resultSummary: parseTaskResultFromOutput(part.text),
          })
        }
      }

      let lastUser = null
      for (let index = output.messages.length - 1; index >= 0; index -= 1) {
        if (output.messages[index].info?.role === "user") {
          lastUser = output.messages[index]
          break
        }
      }
      if (!lastUser) return
      lastUser.parts = lastUser.parts || []

      const sessionID =
        output.messages[0]?.info?.sessionID ||
        output.messages[0]?.sessionID ||
        _input?.sessionID ||
        undefined
      injectBoardIntoParts(board, sessionID, lastUser.parts)
    },

    event: async ({ event }) => {
      const { board } = await runtime.ready
      const type = event?.type
      const properties = event?.properties || {}
      const sessionID = properties.sessionID || properties.id

      if (
        (type === "session.idle" || (type === "session.status" && properties.type === "idle")) &&
        sessionID
      ) {
        board.acknowledgeInjected(sessionID)
        const job = findHostJob(board, sessionID)
        if (job?.executionState === "running") {
          markHostTerminal(board, sessionID, "completed")
        }
        return
      }

      if (type === "session.status" && properties.type === "busy") {
        if (sessionID && findHostJob(board, sessionID)) writeTuiState(board, runtime.tuiStatePath)
        return
      }

      if (type === "session.execution.succeeded" && sessionID) {
        markHostTerminal(board, sessionID, "completed")
        return
      }
      if (
        (type === "session.execution.failed" ||
          (type === "session.status" && ["error", "failed"].includes(properties.type))) &&
        sessionID
      ) {
        const message = properties.error?.message
        markHostTerminal(board, sessionID, "failed", {
          ...(message ? { error: { message } } : {}),
        })
        return
      }
      if (
        (type === "session.execution.interrupted" ||
          (type === "session.status" && ["cancelled", "interrupted"].includes(properties.type))) &&
        sessionID
      ) {
        markHostTerminal(board, sessionID, "cancelled")
        return
      }

      if (type === "session.deleted" && sessionID) {
        const job = findHostJob(board, sessionID)
        if (job && ["running", "cancelling"].includes(job.executionState)) {
          board.markTerminal(job.id, {
            state: "interrupted",
            error: { code: "HOST_MISSING", message: "host session was deleted" },
          })
        }
        for (const [key, pending] of pendingCalls) {
          if (pending.parentSessionId === sessionID) pendingCalls.delete(key)
        }
      }
    },

    config: async (config) => {
      config.command = config.command || {}
      if (!config.command.ps) {
        config.command.ps = {
          template: PS_COMMAND_TEMPLATE,
          description: "Show running background tasks",
        }
      }
    },

    tool: {
      parallel_status: {
        description:
          "Check the status of all background tasks for the current session. Returns a JSON summary of all tracked background jobs including their state (running/completed/error), elapsed time, and result summaries.",
        args: {
          session_id: {
            type: "string",
            description: "Optional session ID. If not provided, returns all jobs.",
          },
        },
        async execute(args) {
          const { board } = await runtime.ready
          return JSON.stringify(buildLegacyParallelStatus(board, args.session_id), null, 2)
        },
      },

      cancel_task: {
        description:
          "Cancel a running background task by its task ID or alias. Aborts the underlying session.",
        args: {
          task_id: {
            type: "string",
            description: "The task ID or alias of the background task to cancel.",
          },
        },
        async execute(args) {
          const id = args.task_id
          if (!id) return "Error: task_id is required."
          const { board } = await runtime.ready
          const job = findJob(board, id)
          if (!job) return `Error: No background task found with ID or alias '${id}'.`
          if (job.executionState !== "running") {
            return `Task '${job.alias}' is already in state: ${job.executionState}.`
          }
          if (typeof client?.session?.abort !== "function") {
            return `Error cancelling task '${job.alias}': OpenCode session abort is unavailable.`
          }

          try {
            await client.session.abort({ path: { id: job.hostTaskId } })
            board.requestCancellation(job.id)
            return `Cancellation requested for task '${job.alias}' (${job.hostTaskId}).`
          } catch (error) {
            return `Error cancelling task '${job.alias}': ${error.message}`
          }
        },
      },
    },
  }
}

// ─── OpenCode V2 host parsing ────────────────────────────────────────────────

const V2_SUBAGENT_COMPLETION_RE =
  /<subagent\s+sessionID="([^"]+)"\s+state="(completed|error|failed|cancelled|interrupted)"[^>]*>([\s\S]*?)<\/subagent>/

function extractV2ChildSessionID(result) {
  if (!result || typeof result !== "object") return undefined
  if (typeof result.metadata?.sessionID === "string" && result.metadata.sessionID) {
    return result.metadata.sessionID
  }
  if (typeof result.output?.sessionID === "string" && result.output.sessionID) {
    return result.output.sessionID
  }
  const text = typeof result.content === "string" ? result.content : ""
  return /sessionID:\s*([^\s()]+)/.exec(text)?.[1]
}

function extractV2ResultStatus(result) {
  if (!result || typeof result !== "object") return undefined
  if (typeof result.metadata?.status === "string") return result.metadata.status
  if (typeof result.output?.status === "string") return result.output.status
  return undefined
}

function scanV2CompletionText(board, text) {
  if (typeof text !== "string" || !text.includes("<subagent")) return
  const match = V2_SUBAGENT_COMPLETION_RE.exec(text)
  if (!match) return
  const [, sessionID, state, body] = match
  markHostTerminal(board, sessionID, state, { resultSummary: body?.trim() || undefined })
}

function handleV2Event(board, pendingCalls, event, tuiStatePath) {
  const type = event?.type
  if (typeof type !== "string") return
  const data = event.data && typeof event.data === "object" ? event.data : {}
  const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined

  if (type === "session.idle") {
    if (!sessionID) return
    board.acknowledgeInjected(sessionID)
    const job = findHostJob(board, sessionID)
    if (job?.executionState === "running") markHostTerminal(board, sessionID, "completed")
    return
  }
  if (type === "session.status" && data.type === "busy") {
    if (sessionID && findHostJob(board, sessionID)) writeTuiState(board, tuiStatePath)
    return
  }
  if (type === "session.execution.succeeded") {
    if (sessionID) markHostTerminal(board, sessionID, "completed")
    return
  }
  if (type === "session.execution.failed") {
    const message = typeof data.error?.message === "string" ? data.error.message : undefined
    if (sessionID) {
      markHostTerminal(board, sessionID, "failed", {
        ...(message ? { error: { message } } : {}),
      })
    }
    return
  }
  if (type === "session.execution.interrupted") {
    if (sessionID) markHostTerminal(board, sessionID, "cancelled")
    return
  }
  if (type === "session.deleted" && sessionID) {
    const job = findHostJob(board, sessionID)
    if (job && ["running", "cancelling"].includes(job.executionState)) {
      board.markTerminal(job.id, {
        state: "interrupted",
        error: { code: "HOST_MISSING", message: "host session was deleted" },
      })
    }
    for (const [key, pending] of pendingCalls) {
      if (pending.parentSessionId === sessionID) pendingCalls.delete(key)
    }
  }
}

/** Register the Core-backed parallel engine with an OpenCode 2.x context. */
export async function setupParallelV2(ctx) {
  if (!ctx || typeof ctx.tool?.hook !== "function" || typeof ctx.session?.hook !== "function") {
    return
  }

  const pendingCalls = new Map()
  const runtime = createBoardRuntime(ctx, (job) => queryV2Session(ctx, job))
  const { board } = await runtime.ready

  await ctx.tool.hook("execute.before", (event) => {
    try {
      if (event.tool !== "subagent") return
      const args = event.input
      if (!args || typeof args !== "object") return
      // A sessionID continuation is another round of an existing native child.
      // Keep its original terminal Board record sticky; native completion delivery
      // owns later rounds and historical notices must not reactivate old jobs.
      if (typeof args.sessionID === "string" && args.sessionID.length > 0) return
      pendingCalls.set(event.id, {
        parentSessionId: event.sessionID,
        agentType: typeof args.agent === "string" ? args.agent : "general",
        label: typeof args.description === "string" ? args.description : "",
      })
    } catch (error) {
      warnIfDebug("[omagents] v2 execute.before hook failed:", error.message)
    }
  })

  await ctx.tool.hook("execute.after", (event) => {
    try {
      if (event.tool !== "subagent") return
      const pending = pendingCalls.get(event.id)
      if (!pending) return
      pendingCalls.delete(event.id)
      if (event.status !== "completed") return

      const result = event.result
      const childID = extractV2ChildSessionID(result)
      if (!childID) return
      registerLaunch(board, childID, pending.parentSessionId, pending.agentType, pending.label)
      const status = extractV2ResultStatus(result)
      if (["completed", "error", "failed", "cancelled", "interrupted"].includes(status)) {
        const text = typeof result?.output?.output === "string" ? result.output.output : undefined
        markHostTerminal(board, childID, status, { resultSummary: text })
      }
    } catch (error) {
      warnIfDebug("[omagents] v2 execute.after hook failed:", error.message)
    }
  })

  await ctx.session.hook("context", (event) => {
    try {
      event.system = event.system || []
      if (
        !event.system.some(
          (part) => part?.type === "text" && part.text === PARALLEL_SYSTEM_PROMPT_V2
        )
      ) {
        event.system.push({ type: "text", text: PARALLEL_SYSTEM_PROMPT_V2 })
      }

      const messages = event.messages
      if (!Array.isArray(messages) || messages.length === 0) return
      for (const message of messages) {
        if (message.role !== "user") continue
        for (const part of message.content || []) {
          if (part?.type === "text") scanV2CompletionText(board, part.text)
        }
      }

      let lastUser = null
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "user") {
          lastUser = messages[index]
          break
        }
      }
      if (!lastUser || !event.sessionID) return
      lastUser.content = lastUser.content || []
      injectBoardIntoParts(board, event.sessionID, lastUser.content)
    } catch (error) {
      warnIfDebug("[omagents] v2 context hook failed:", error.message)
    }
  })

  const controller = new AbortController()
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        try {
          handleV2Event(board, pendingCalls, event, runtime.tuiStatePath)
        } catch (error) {
          warnIfDebug("[omagents] v2 event handling failed:", error.message)
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        warnIfDebug("[omagents] v2 event stream ended:", error?.message || error)
      }
    }
  })()

  await ctx.tool.transform((editor) => {
    editor.add({
      name: "parallel_status",
      description:
        "Check the status of all background tasks for the current session. Returns a JSON summary of all tracked background jobs including their state (running/completed/error), elapsed time, and result summaries.",
      input: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "Optional session ID. If not provided, returns all jobs.",
          },
        },
        additionalProperties: false,
      },
      execute: async (args) => ({
        content: JSON.stringify(buildLegacyParallelStatus(board, args?.session_id), null, 2),
      }),
    })

    editor.add({
      name: "cancel_task",
      description:
        "Cancel a running background task by its task ID or alias. Aborts the underlying session.",
      input: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "The task ID or alias of the background task to cancel.",
          },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const id = args?.task_id
        if (!id) return { content: "Error: task_id is required." }
        const job = findJob(board, id)
        if (!job) {
          return { content: `Error: No background task found with ID or alias '${id}'.` }
        }
        if (job.executionState !== "running") {
          return { content: `Task '${job.alias}' is already in state: ${job.executionState}.` }
        }
        if (typeof ctx.session?.interrupt !== "function") {
          return {
            content: `Error cancelling task '${job.alias}': OpenCode session interruption is unavailable.`,
          }
        }

        try {
          const result = await ctx.session.interrupt({
            sessionID: job.hostTaskId,
            continue: false,
          })
          if (result?.interrupted !== true) {
            return {
              content: `Host did not accept cancellation for task '${job.alias}' (${job.hostTaskId}).`,
            }
          }
          board.requestCancellation(job.id)
          return {
            content: `Cancellation requested for task '${job.alias}' (${job.hostTaskId}).`,
          }
        } catch (error) {
          return { content: `Error cancelling task '${job.alias}': ${error.message}` }
        }
      },
    })
  })

  try {
    const existing = await ctx.command.list()
    const items = Array.isArray(existing) ? existing : existing?.commands || existing?.items || []
    if (!items.some((command) => command?.name === "ps")) {
      await ctx.command.transform((editor) => {
        editor.add({
          name: "ps",
          description: "Show running background tasks",
          execute: async ({ sessionID, prompt, delivery }) => {
            await ctx.session.prompt({
              ...prompt,
              sessionID,
              text: PS_COMMAND_TEMPLATE,
              delivery,
            })
          },
        })
      })
    }
  } catch (error) {
    warnIfDebug("[omagents] v2 /ps command registration failed:", error.message)
  }

  let cleaned = false
  return async () => {
    if (cleaned) return
    cleaned = true
    controller.abort()
    await releaseBoardRuntime(runtime)
  }
}

// Auto-discovery accepts this descriptor, while index.js invokes the named
// exports to avoid registering a second engine.
export default {
  id: "omagents.parallel-engine",
  server: createParallelHooks,
  setup: () => {},
}
