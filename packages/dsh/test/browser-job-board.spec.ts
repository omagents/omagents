// @ts-nocheck
import assert from "node:assert/strict"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"

import { chromium } from "playwright"

import { ARTIFACT_ROOT } from "../../../scripts/pack-all.js"
import { ensureCleanRoom } from "../../../scripts/packed-harness.js"

const PARENT = "browser-parent"
const OTHER_PARENT = "other-parent"
const EVIDENCE = path.join(ARTIFACT_ROOT, "browser-verification.json")

function importFrom(root, specifier) {
  return import(pathToFileURL(path.join(root, ...specifier.split("/"))).href)
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const { port } = address
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function within(promise, timeout = 5_000) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeout)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function waitFor(callback, label, timeout = 20_000) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeout) {
    try {
      const value = await callback()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`)
}

function runtimeOf(ctx) {
  const direct = ctx.get("omagents")
  if (direct) return direct
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name === "@omagents/omagents-dsh") {
      const runtime = entry.fiber?.ctx.get("omagents")
      if (runtime) return runtime
    }
  }
  throw new Error("The packed OmAgents runtime is unavailable")
}

async function startHost(summary, port) {
  const profile = summary.profileDirectory
  const { runProfile } = await importFrom(
    profile,
    "node_modules/@deepseek-ai/dsh/lib/profile-boot.js"
  )
  const { createLaunchEnvironmentSnapshot } = await importFrom(
    profile,
    "node_modules/@deepseek-ai/dsh-launch-environment/lib/index.js"
  )
  const environment = createLaunchEnvironmentSnapshot([
    {
      source: "process",
      values: {
        HOME: summary.home,
        USERPROFILE: summary.home,
        DSH_HOME: summary.dshHome,
        DSH_TELEMETRY_DISABLED: "1",
      },
    },
  ])
  const running = await runProfile({
    environment,
    profile: "web",
    patchFiles: [],
    args: ["--no-open", "--host", "127.0.0.1", "--port", String(port)],
  })
  try {
    const { ctx, shutdown } = running
    await ctx.loader.await()
    const runtime = runtimeOf(ctx)
    assert.equal(runtime.health.host.status, "ready")
    assert.equal(runtime.health.persistence.status, "ready")
    await waitFor(
      () => ctx.tools.get("mcp__agentmemory__echo") && ctx.tools.get("mcp__websearch__echo"),
      "local MCP registration"
    )
    const mcpRows = [...ctx.loader.entries()].filter(
      (entry) => entry.options.name === "@deepseek-ai/dsh-mcp-client"
    )
    assert.equal(mcpRows.length, 5)
    assert.ok(mcpRows.every((entry) => entry.options.config.transport === "stdio"))
    assert.ok(mcpRows.every((entry) => entry.options.config.command === process.execPath))
    console.log(
      "[browser] capability health",
      JSON.stringify(
        {
          skills: runtime.health.skills,
          mcp: runtime.health.mcp,
          tools: runtime.health.tools,
          commands: runtime.health.commands,
          context: runtime.health.context,
        },
        null,
        2
      )
    )
    await waitFor(() => ctx.tools.get("parallel_status"), "OmAgents parallel_status registration")
    const url = ctx.connection.authenticatedUrl(ctx.webServer.getOrigin())
    const { scopeTarget } = await importFrom(
      profile,
      "node_modules/@deepseek-ai/dsh-scope/lib/index.js"
    )
    const { Peer } = await importFrom(
      profile,
      "node_modules/@deepseek-ai/dsh-client-connection/lib/index.js"
    )
    return { ctx, shutdown, runtime, url, scopeTarget, Peer, mcpRows: mcpRows.length }
  } catch (error) {
    await within(running.ctx.fiber.dispose())
    throw error
  }
}

function owner(id = PARENT) {
  return { id, session: { id }, status: "idle", promptCalls: [] }
}

function startJob(host, { id, description, local = true, provider = "spawn", parent = PARENT }) {
  const agent = owner(parent)
  const run = { runId: `run-${id}`, provider, id, local }
  host.ctx.emit(host.scopeTarget(host.ctx.subagents, agent), "subagent/start", run)
  const exec = {
    callId: `call-${id}`,
    rootCallId: `call-${id}`,
    name: "subagent",
    arguments: { description, prompt: `Complete ${description}` },
    agent,
    signal: new AbortController().signal,
    token: Symbol(id),
  }
  host.ctx.emit(host.scopeTarget(host.ctx.tools, agent), "tools/result", exec, {
    isError: false,
    value: { kind: "activation", subagentId: id },
    content: [{ type: "text", text: `started ${id}` }],
  })
  const job = host.runtime.board.list().find((candidate) => candidate.hostTaskId === id)
  assert.ok(job, `No Board job was correlated for ${id}`)
  return { run, job, parent }
}

function endJob(host, lane, stopReason = "completed", text = `${lane.job.description} settled`) {
  host.ctx.emit(host.scopeTarget(host.ctx.subagents, owner(lane.parent)), "subagent/end", {
    ...lane.run,
    stopReason,
    lastAssistantMessage: [{ type: "text", text }],
  })
  return lane.job
}

async function hostSnapshot(host, parent = PARENT) {
  const status = await host.ctx.tools.get("parallel_status").execute({}, {})
  const agent = owner(parent)
  const command = host.ctx.commands.find(agent, "ps")
  assert.ok(command)
  const ps = await command.handler({ agent, rawInput: "" })
  assert.equal(ps.kind, "success")
  return { status, ps }
}

function assertHostAgreement(host, lane, state) {
  return waitFor(async () => {
    const { status, ps } = await hostSnapshot(host, lane.parent)
    const task = status.tasks.find((candidate) => candidate.id === lane.job.id)
    assert.equal(task?.executionState, state)
    assert.equal(lane.job.executionState, state)
    assert.match(ps.text, new RegExp(lane.job.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    return true
  }, `${lane.job.description} Host agreement (${state})`)
}

async function assertWebAgreement(page, lane, state) {
  const row = page.getByRole("row").filter({ hasText: lane.job.description }).first()
  await row.waitFor({ state: "visible", timeout: 20_000 })
  await waitFor(
    async () => (await row.innerText()).includes(state),
    `${lane.job.description} Web agreement (${state})`
  )
  const { status } = await hostSnapshot(page.host, lane.parent)
  const task = status.tasks.find((candidate) => candidate.id === lane.job.id)
  assert.equal(task.executionState, state.toLowerCase())
  assert.match(await row.innerText(), new RegExp(lane.job.agent))
}

async function cancelThroughWeb(page, host, lane) {
  const row = page.getByRole("row").filter({ hasText: lane.job.description }).first()
  await row.getByRole("button", { name: `Cancel ${lane.job.description}`, exact: true }).click()
  const dialog = page.getByRole("alertdialog")
  await dialog.waitFor({ state: "visible" })
  assert.match(
    await dialog.innerText(),
    /External one-shot runs stop permanently and cannot be resumed/
  )
  await dialog.getByRole("button", { name: "Confirm cancellation", exact: true }).click()
  await assertHostAgreement(host, lane, "cancelling")
  await assertWebAgreement(page, lane, "Cancelling")
}

async function testNonOwnerGateway(host, allowedLane, secretLane) {
  const { ctx, Peer } = host
  const actions = ["omagents/listJobs", "omagents/watchJobs"]
  const removePolicy = ctx.remoteAccess.registerPolicy("guest", {
    bindings() {
      return [
        {
          role: { name: "job-global", resource: "global", actions },
          resource: { kind: "global" },
        },
        {
          role: { name: "job-session", resource: "session", actions },
          resource: { kind: "session", id: PARENT },
        },
      ]
    },
  })
  const peer = new Peer(ctx, { principal: { kind: "guest" }, interactions: "none" })
  try {
    const listed = await ctx.typertGateway.invoke({
      namespace: "omagents",
      method: "listJobs",
      args: { scope: {} },
      peer,
    })
    assert.ok(listed.some((job) => job.id === allowedLane.job.id))
    assert.equal(
      listed.some((job) => job.id === secretLane.job.id),
      false
    )
    assert.ok(listed.every((job) => job.parentSessionId === PARENT))

    await assert.rejects(
      ctx.typertGateway.invoke({
        namespace: "omagents",
        method: "listJobs",
        args: { scope: { parentSessionId: OTHER_PARENT } },
        peer,
      }),
      (error) => error.code === "remote-access/denied"
    )
    const deniedStream = await ctx.typertGateway.stream({
      namespace: "omagents",
      method: "watchJobs",
      args: { scope: { parentSessionId: OTHER_PARENT } },
      peer,
      signal: new AbortController().signal,
    })
    await assert.rejects(deniedStream[Symbol.asyncIterator]().next(), (error) => {
      assert.equal(error.code, "remote-access/denied")
      return true
    })

    const controller = new AbortController()
    const stream = await ctx.typertGateway.stream({
      namespace: "omagents",
      method: "watchJobs",
      args: { scope: {} },
      peer,
      signal: controller.signal,
    })
    const iterator = stream[Symbol.asyncIterator]()
    const baseline = await iterator.next()
    assert.equal(baseline.done, false)
    assert.ok(baseline.value.jobs.every((job) => job.parentSessionId === PARENT))
    assert.equal(
      baseline.value.jobs.some((job) => job.id === secretLane.job.id),
      false
    )
    controller.abort()
    await iterator.return?.()
    return { unaryFiltered: true, unaryDenied: true, streamFiltered: true, streamDenied: true }
  } finally {
    await peer.dispose()
    removePolicy()
  }
}

async function openJobBoard(browser, url) {
  const context = await browser.newContext({
    colorScheme: "light",
    viewport: { width: 1440, height: 1000 },
  })
  const page = await context.newPage()
  const pageErrors = []
  const clientResponses = []
  const consoleMessages = []
  const failedResponses = []
  const requestFailures = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("console", (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() })
  })
  page.on("response", (response) => {
    if (/omagents/i.test(response.url())) clientResponses.push(response.url())
    if (response.status() >= 400)
      failedResponses.push({ url: response.url(), status: response.status() })
  })
  page.on("requestfailed", (request) => {
    requestFailures.push({ url: request.url(), error: request.failure()?.errorText })
  })
  if (process.env.OMAGENTS_BROWSER_TRACE_CLIENT === "1") {
    await page.addInitScript(() => {
      let loader
      Object.defineProperty(window, "__ModuleLoader__", {
        configurable: true,
        get() {
          return loader
        },
        set(value) {
          loader = value
          if (value.create) {
            const create = value.create.bind(value)
            value.create = (options) => {
              const modules = create(options)
              const start = modules.entries.start.bind(modules.entries)
              modules.entries.start = async (clientLoader, manifest) => {
                const result = await start(clientLoader, manifest)
                const awaitLoader = clientLoader.await.bind(clientLoader)
                clientLoader.await = async () => {
                  const awaited = await awaitLoader()
                  for (const entry of clientLoader.entries()) {
                    if (entry.options.name !== "@omagents/omagents-dsh") continue
                    const fiber = entry.fiber
                    console.error("[omagents-trace] fiber", {
                      state: fiber?.state,
                      properties: fiber ? Object.getOwnPropertyNames(fiber) : [],
                      error: fiber?.error,
                      reason: fiber?.reason,
                      _error: fiber?._error,
                      runtimeError: fiber?.runtime?.error,
                    })
                    console.error(
                      "[omagents-trace] fiber error stack",
                      fiber?.error?.stack ?? fiber?._error?.stack
                    )
                  }
                  return awaited
                }
                return result
              }
              return modules
            }
          }
          const load = value.load.bind(value)
          value.load = (registration) => {
            if (registration.id === "@omagents/omagents-dsh") {
              const factory = registration.factory
              registration.factory = (require) => {
                const exports = factory(require)
                const apply = exports.apply
                exports.apply = async function (ctx) {
                  console.log("[omagents-trace] Client apply started")
                  try {
                    const result = await apply.call(this, ctx)
                    console.log("[omagents-trace] Client apply succeeded")
                    return result
                  } catch (error) {
                    console.error(
                      "[omagents-trace] Client apply failed",
                      error,
                      error?.stack,
                      error?.cause
                    )
                    throw error
                  }
                }
                return exports
              }
            }
            return load(registration)
          }
        },
      })
    })
  }
  try {
    const startupTimeout = Number(process.env.OMAGENTS_BROWSER_STARTUP_TIMEOUT_MS ?? 60_000)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: startupTimeout })
    console.log("[browser] navigation completed")
    const sidebar = page.getByRole("button", { name: "OmAgents", exact: true })
    await sidebar.waitFor({ state: "visible", timeout: startupTimeout })
    console.log("[browser] sidebar visible")
    for (let index = 0; index < 2; index += 1) {
      const dialog = page
        .locator(
          'div[role="dialog"][aria-label="Preview Notice"], div[role="dialog"][aria-label="Get started"]'
        )
        .first()
      const visible = await dialog
        .waitFor({ state: "visible", timeout: Math.min(startupTimeout, 5_000) })
        .then(() => true)
        .catch((error) => {
          if (error.name === "TimeoutError") return false
          throw error
        })
      if (!visible) break
      const dialogElement = await dialog.elementHandle()
      const label = await dialog.getAttribute("aria-label")
      console.log(`[browser] onboarding dialog: ${label}`)
      if (label === "Preview Notice") {
        await dialog.getByRole("button", { name: "Continue", exact: true }).click()
      } else {
        await dialog.getByRole("button", { name: "Close", exact: true }).click()
      }
      await page.waitForFunction((element) => !element.isConnected, dialogElement, {
        timeout: startupTimeout,
      })
      console.log(`[browser] onboarding dialog detached: ${label}`)
    }
    await sidebar.click()
    console.log("[browser] sidebar clicked")
    await page.getByRole("heading", { name: "OmAgents Job Board", exact: true }).waitFor({
      state: "visible",
      timeout: 30_000,
    })
    await page.getByText("No background jobs yet.", { exact: true }).waitFor({ state: "visible" })
    return { context, page, pageErrors, clientResponses }
  } catch (error) {
    await page
      .screenshot({ path: path.join(ARTIFACT_ROOT, "browser-failure.png"), fullPage: true })
      .catch(() => {})
    fs.writeFileSync(
      path.join(ARTIFACT_ROOT, "browser-startup-failure.json"),
      `${JSON.stringify(
        {
          url: page.url(),
          html: await page.content().catch(() => ""),
          pageErrors,
          consoleMessages,
          failedResponses,
          requestFailures,
          clientResponses,
          error: error.message,
        },
        null,
        2
      )}\n`
    )
    throw error
  }
}

test(
  "packed DSH Web composition keeps Host, tools, and browser state consistent",
  { timeout: 600_000 },
  async (t) => {
    const summary = await ensureCleanRoom({ pack: true })
    fs.rmSync(path.join(summary.profileDirectory, "omagents", "job-board.json"), { force: true })
    const port = await freePort()
    const previousEnv = new Map()
    const env = {
      HOME: summary.home,
      USERPROFILE: summary.home,
      DSH_HOME: summary.dshHome,
      DSH_TELEMETRY_DISABLED: "1",
      DEEPSEEK_API_KEY: "",
      GITHUB_TOKEN: "",
      EXA_API_KEY: "",
      CONTEXT7_API_KEY: "",
      NODE_PATH: "",
    }
    for (const [key, value] of Object.entries(env)) {
      previousEnv.set(key, process.env[key])
      process.env[key] = value
    }

    let browser
    let host
    let pageBundle
    const scenarios = []
    try {
      console.log("[browser] starting packed DSH Web Host")
      host = await startHost(summary, port)
      console.log("[browser] Host ready; launching Chromium")
      assert.ok(
        fs
          .realpathSync(summary.clientArtifact)
          .startsWith(fs.realpathSync(summary.cleanRoot) + path.sep)
      )
      browser = await chromium.launch({
        headless: true,
        ...(process.env.OMAGENTS_PLAYWRIGHT_EXECUTABLE
          ? { executablePath: process.env.OMAGENTS_PLAYWRIGHT_EXECUTABLE }
          : {}),
      })
      pageBundle = await openJobBoard(browser, host.url)
      console.log("[browser] Job Board opened")
      const { page } = pageBundle
      page.host = host
      scenarios.push("startup/sidebar/main-panel")

      const completed = startJob(host, {
        id: "browser-complete",
        description: "Browser completion lane",
      })
      const local = startJob(host, { id: "browser-local", description: "Local cancellation lane" })
      const secret = startJob(host, {
        id: "browser-secret",
        description: "Other session secret lane",
        parent: OTHER_PARENT,
        provider: "external",
        local: false,
      })
      await assertHostAgreement(host, completed, "running")
      await assertWebAgreement(page, completed, "Running")
      await assertWebAgreement(page, local, "Running")
      scenarios.push("multiple-subagents/parallel-status-ps-Web")

      endJob(host, completed, "completed", "Browser completion injected exactly once")
      await assertHostAgreement(host, completed, "completed")
      await assertWebAgreement(page, completed, "Completed")
      assert.equal(completed.job.notificationState, "injected")
      assert.equal(completed.job.resultSummary, "Browser completion injected exactly once")
      const completedRevision = host.runtime.board.revision
      endJob(host, completed, "completed", "Browser completion injected exactly once")
      endJob(host, completed, "completed", "Browser completion injected exactly once")
      assert.equal(host.runtime.board.revision, completedRevision)
      assert.equal(completed.job.notificationState, "injected")
      scenarios.push("completion-injected-once")

      const descendant = startJob(host, {
        id: "browser-local-descendant",
        description: "Local descendant continuation lane",
        parent: "browser-local",
      })
      await cancelThroughWeb(page, host, local)
      endJob(host, local, "aborted", "Local cancellation settled")
      await assertHostAgreement(host, local, "cancelled")
      await assertWebAgreement(page, local, "Cancelled")
      assert.equal(descendant.job.executionState, "running")
      endJob(host, descendant, "completed", "Descendant completed independently")
      await assertWebAgreement(page, descendant, "Completed")
      scenarios.push("local-cancellation/descendant-continues")

      const external = startJob(host, {
        id: "browser-external",
        description: "External one-shot cancellation lane",
        provider: "external",
        local: false,
      })
      await cancelThroughWeb(page, host, external)
      endJob(host, external, "aborted", "External one-shot cancellation settled")
      await assertHostAgreement(host, external, "cancelled")
      await assertWebAgreement(page, external, "Cancelled")
      scenarios.push("external-cancellation")

      const gateway = await testNonOwnerGateway(host, completed, secret)
      scenarios.push("non-owner-real-Gateway-invocation-and-stream")

      const researchOne = startJob(host, {
        id: "research-one",
        description: "deep-research evidence lane",
      })
      const researchTwo = startJob(host, {
        id: "research-two",
        description: "deep-research gap-analysis lane",
        provider: "external",
        local: false,
      })
      const criticOne = startJob(host, {
        id: "critic-one",
        description: "hyperplan security critic",
      })
      const criticTwo = startJob(host, {
        id: "critic-two",
        description: "hyperplan architecture critic",
      })
      const criticThree = startJob(host, {
        id: "critic-three",
        description: "hyperplan edge-case critic",
        provider: "external",
        local: false,
      })
      for (const lane of [researchOne, researchTwo, criticOne, criticTwo, criticThree]) {
        await assertWebAgreement(page, lane, "Running")
      }
      endJob(host, researchOne, "completed", "Evidence validated")
      endJob(host, criticOne, "completed", "Security critique complete")
      endJob(host, criticTwo, "failed", "Architecture critique failed deterministically")
      for (const [lane, state] of [
        [researchOne, "Completed"],
        [criticOne, "Completed"],
        [criticTwo, "Failed"],
      ]) {
        await assertWebAgreement(page, lane, state)
      }
      scenarios.push("deep-research-hyperplan-concurrent")

      const board = page.locator("section[aria-labelledby=omagents-job-board-title]")
      const theme = async () =>
        page.evaluate(() => {
          const body = getComputedStyle(document.body)
          const section = document.querySelector(
            "section[aria-labelledby=omagents-job-board-title]"
          )
          return {
            bodyBackground: body.backgroundColor,
            bodyColor: body.color,
            sectionBackground: section ? getComputedStyle(section).backgroundColor : "",
            sectionColor: section ? getComputedStyle(section).color : "",
          }
        })
      await page.emulateMedia({ colorScheme: "light" })
      const light = await theme()
      await board.screenshot({ path: path.join(ARTIFACT_ROOT, "browser-light.png") })
      await page.emulateMedia({ colorScheme: "dark" })
      await page.waitForTimeout(250)
      const dark = await theme()
      assert.notDeepEqual(
        dark,
        light,
        "DSH alias theme tokens must change with light/dark color schemes"
      )
      await board.screenshot({ path: path.join(ARTIFACT_ROOT, "browser-dark.png") })
      scenarios.push("light-dark-themes")

      await host.runtime.board.flush()
      const persisted = JSON.parse(
        fs.readFileSync(path.join(summary.profileDirectory, "omagents", "job-board.json"), "utf8")
      )
      assert.ok(
        persisted.jobs.some(
          (job) => job.id === completed.job.id && job.notificationState === "injected"
        )
      )
      const completedId = completed.job.id
      await host.shutdown.shutdown(0)
      host = await startHost(summary, port)
      page.host = host
      const restored = host.runtime.board.get(completedId)
      assert.equal(restored.executionState, "completed")
      assert.equal(restored.notificationState, "injected")
      assert.ok(
        ["running", "interrupted"].includes(
          host.runtime.board.get(researchTwo.job.id).executionState
        )
      )
      assert.ok(
        ["running", "interrupted"].includes(
          host.runtime.board.get(criticThree.job.id).executionState
        )
      )
      await page.getByRole("button", { name: "Reconnect", exact: true }).click()
      await assertWebAgreement(page, { job: restored, parent: PARENT }, "Completed")
      const restoredRevision = host.runtime.board.revision
      endJob(
        host,
        { run: completed.run, job: restored, parent: PARENT },
        "completed",
        "Browser completion injected exactly once"
      )
      assert.equal(host.runtime.board.revision, restoredRevision)
      assert.equal(restored.notificationState, "injected")
      scenarios.push("restart-recovery/reconnect/no-reinjection")

      const resumedResearch = startJob(host, {
        id: "research-resumed",
        description: "deep-research resumed gap sweep",
      })
      const resumedHyperplan = startJob(host, {
        id: "hyperplan-resumed",
        description: "hyperplan resumed final review",
      })
      endJob(host, resumedResearch, "completed", "Recovered research queue completed")
      endJob(host, resumedHyperplan, "completed", "Recovered hyperplan queue completed")
      await assertWebAgreement(page, resumedResearch, "Completed")
      await assertWebAgreement(page, resumedHyperplan, "Completed")
      scenarios.push("deep-research-hyperplan-recovery")

      await host.runtime.board.flush()
      await page.screenshot({
        path: path.join(ARTIFACT_ROOT, "browser-reconnected.png"),
        fullPage: true,
      })
      assert.deepEqual(
        pageBundle.pageErrors,
        [],
        `Browser page errors:\n${pageBundle.pageErrors.join("\n")}`
      )
      const evidence = {
        schemaVersion: 1,
        completedAt: new Date().toISOString(),
        cleanRoom: summary.cleanRoot,
        profileDirectory: summary.profileDirectory,
        clientArtifact: summary.clientArtifact,
        dshEngine: "0.2.2-rc.1",
        localMcpServers: host.mcpRows,
        externalModelCredentials: false,
        prepareScriptsRun: summary.prepareScriptsRun,
        scenarios,
        gateway,
        pageErrors: pageBundle.pageErrors,
        omagentsClientResponses: [...new Set(pageBundle.clientResponses)],
        screenshots: ["browser-light.png", "browser-dark.png", "browser-reconnected.png"],
        finalJobs: host.runtime.board.list().map((job) => ({
          id: job.id,
          description: job.description,
          executionState: job.executionState,
          notificationState: job.notificationState,
        })),
      }
      fs.writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`)
    } catch (error) {
      if (pageBundle?.page) {
        await pageBundle.page
          .screenshot({ path: path.join(ARTIFACT_ROOT, "browser-failure.png"), fullPage: true })
          .catch(() => {})
      }
      throw error
    } finally {
      await pageBundle?.context.close().catch(() => {})
      await browser?.close().catch(() => {})
      await host?.shutdown.shutdown(0).catch(() => {})
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }
)
