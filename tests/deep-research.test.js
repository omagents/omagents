import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const PYTHON_SETTING = process.env.OMAGENTS_TEST_PYTHON || "python3"
const PYTHON =
  PYTHON_SETTING.includes("/") || PYTHON_SETTING.includes("\\")
    ? path.resolve(ROOT, PYTHON_SETTING)
    : PYTHON_SETTING
const SCRIPTS = path.join(ROOT, "packages", "core", "skills", "deep-research", "scripts")
const LEGACY_CONSOLE = {
  PYTHONIOENCODING: "cp1252",
  PYTHONUTF8: "0",
  PYTHONCOERCECLOCALE: "0",
  LC_ALL: "C",
}
const PRE_RESEARCH = path.join(SCRIPTS, "pre_research.py")
const DEEP_RESEARCH = path.join(SCRIPTS, "deep_research.py")
const LOOP_ENGINE = path.join(
  ROOT,
  "packages",
  "core",
  "skills",
  "_shared",
  "scripts",
  "loop_engine.py"
)

function makeProject(t) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "omagents-research-")))
  t.after(() => fs.rmSync(project, { recursive: true, force: true }))
  return project
}

function runPython(script, args, cwd, expectedStatus = 0, environment = {}) {
  const result = spawnSync(PYTHON, [script, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...environment },
  })
  assert.strictEqual(
    result.status,
    expectedStatus,
    `Python command failed (${result.status}): ${result.stdout}\n${result.stderr}\n${result.error?.message || ""}`
  )
  return result
}

function runDir(project) {
  const parent = path.join(project, ".omagents", "deep-research")
  const entries = fs.readdirSync(parent)
  assert.strictEqual(entries.length, 1, `Expected one run in ${parent}`)
  return path.join(parent, entries[0])
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8")
}

function preFinding() {
  return {
    task_id: "pre-1",
    candidates: ["A", "B", "C", "D", "E"].map((name) => ({
      name,
      vendor: "Test",
      note: `${name} note`,
      source: `https://example.com/${name}`,
    })),
    sources: ["https://example.com/A", "https://example.com/B", "https://example.com/C"],
    summary: "Landscape summary",
  }
}

function dispatchFrom(output) {
  const normalized = output.replaceAll("\r\n", "\n")
  const start = normalized.lastIndexOf('{\n  "action"')
  assert.notStrictEqual(start, -1, `No dispatch JSON in output:\n${output}`)
  return JSON.parse(normalized.slice(start))
}

function shellRoundTrip(quoted) {
  if (process.platform === "win32") {
    return spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::Out.Write(${quoted})`,
      ],
      { encoding: "utf-8" }
    )
  }
  return spawnSync("/bin/sh", ["-c", `printf '%s' ${quoted}`], { encoding: "utf-8" })
}

test("dispatch parser accepts Windows CRLF output", () => {
  const dispatch = dispatchFrom(
    'Phase 1: Creating research plan...\r\n{\r\n  "action": "dispatch_subagent",\r\n  "run_id": "windows-crlf",\r\n  "tasks": []\r\n}\r\n'
  )
  assert.equal(dispatch.action, "dispatch_subagent")
  assert.equal(dispatch.run_id, "windows-crlf")
})

test("Python research layout resolver", () => {
  const result = spawnSync(
    PYTHON,
    ["-m", "unittest", "discover", "-s", "tests", "-p", "deep_research_*_test.py", "-v"],
    { cwd: ROOT, stdio: "inherit" }
  )

  assert.strictEqual(result.status, 0, result.error?.message)
})

test("test_pre_research_uses_internal_state_and_namespaced_loop", (t) => {
  const project = makeProject(t)
  const workspace = path.join(project, "topic")

  runPython(PRE_RESEARCH, ["init", "--query", "AI agents", "--workspace", "topic"], project)

  const internal = runDir(project)
  const runId = path.basename(internal)
  const queue = path.join(project, ".omagents", "loops", `deep-research-pre-${runId}`, "tasks.json")
  assert.ok(fs.existsSync(path.join(internal, "state", "pre_research_state.json")))
  assert.ok(fs.existsSync(queue))
  assert.ok(!fs.existsSync(path.join(workspace, "pre_research_state.json")))
  assert.ok(!fs.existsSync(path.join(workspace, "pre_findings")))

  const next = JSON.parse(runPython(PRE_RESEARCH, ["next", "-w", "topic"], project).stdout)
  assert.strictEqual(next.task_id, "pre-1")
  writeJson(path.join(internal, "pre_findings", "pre-1.json"), preFinding())
  runPython(PRE_RESEARCH, ["complete", "pre-1", "-w", "topic"], project)

  const evaluation = JSON.parse(
    runPython(PRE_RESEARCH, ["evaluate", "-w", "topic"], project).stdout
  )
  assert.strictEqual(evaluation.should_continue, false)
  runPython(PRE_RESEARCH, ["finalize", "-w", "topic"], project)

  const consolidated = JSON.parse(
    fs.readFileSync(path.join(internal, "pre_research.json"), "utf-8")
  )
  assert.strictEqual(consolidated.candidates.length, 5)
  assert.strictEqual(consolidated.summary, "Landscape summary")
  assert.ok(!fs.existsSync(path.join(workspace, "pre_research.json")))
  assert.ok(!fs.existsSync(path.join(workspace, "pre_findings")))
})

test("test_two_pre_research_runs_have_independent_queues", (t) => {
  const project = makeProject(t)
  for (const [workspace, query] of [
    ["alpha", "Alpha landscape"],
    ["beta", "Beta landscape"],
  ]) {
    runPython(PRE_RESEARCH, ["init", "--query", query, "--workspace", workspace], project)
  }

  const alpha = JSON.parse(runPython(PRE_RESEARCH, ["next", "-w", "alpha"], project).stdout)
  const beta = JSON.parse(runPython(PRE_RESEARCH, ["next", "-w", "beta"], project).stdout)
  assert.match(alpha.description, /Alpha landscape/)
  assert.match(beta.description, /Beta landscape/)

  const runsParent = path.join(project, ".omagents", "deep-research")
  const runIds = fs.readdirSync(runsParent)
  assert.strictEqual(runIds.length, 2)
  for (const runId of runIds) {
    assert.ok(
      fs.existsSync(
        path.join(project, ".omagents", "loops", `deep-research-pre-${runId}`, "tasks.json")
      )
    )
  }
})

test("test_pre_research_supports_unicode_workspace_with_spaces", (t) => {
  const project = makeProject(t)
  const workspace = "研究 topic with spaces"
  const query = "边缘计算 2026"
  const runWithLegacyConsole = (args) => runPython(PRE_RESEARCH, args, project, 0, LEGACY_CONSOLE)

  runWithLegacyConsole(["init", "--query", query, "--workspace", workspace])
  const next = JSON.parse(runWithLegacyConsole(["next", "-w", workspace]).stdout)
  assert.match(next.description, /边缘计算 2026/)

  const internal = runDir(project)
  writeJson(path.join(internal, "pre_findings", "pre-1.json"), preFinding())
  runWithLegacyConsole(["complete", "pre-1", "-w", workspace])
  runWithLegacyConsole(["finalize", "-w", workspace])
  const consolidated = JSON.parse(
    fs.readFileSync(path.join(internal, "pre_research.json"), "utf-8")
  )
  assert.strictEqual(consolidated.query, query)
  assert.ok(fs.existsSync(path.join(project, workspace)))
})

test("test_legacy_pre_research_uses_original_loop_key", (t) => {
  const project = makeProject(t)
  const workspace = path.join(project, "legacy")
  fs.mkdirSync(workspace)
  writeJson(path.join(workspace, "pre_research_state.json"), {
    query: "Legacy",
    max_pre_loops: 2,
  })

  runPython(PRE_RESEARCH, ["init", "--query", "Legacy", "--workspace", "legacy"], project)

  assert.ok(fs.existsSync(path.join(workspace, "pre_research_state.json")))
  assert.ok(
    fs.existsSync(path.join(project, ".omagents", "loops", "deep-research-pre", "tasks.json"))
  )
  assert.ok(!fs.existsSync(path.join(project, ".omagents", "deep-research")))
})

test("test_plan_and_run_all_keep_internal_files_out_of_workspace", (t) => {
  const project = makeProject(t)

  runPython(
    DEEP_RESEARCH,
    ["plan", "--query", "Standalone plan", "--workspace", "standalone"],
    project
  )
  const standaloneRun = runDir(project)
  const standaloneWorkspace = path.join(project, "standalone")
  assert.ok(fs.existsSync(path.join(standaloneRun, "plan.json")))
  assert.ok(!fs.existsSync(path.join(standaloneWorkspace, "plan.json")))
  assert.ok(!fs.existsSync(path.join(standaloneWorkspace, "provenance.jsonl")))

  const result = runPython(
    DEEP_RESEARCH,
    ["run-all", "--query", "Pipeline", "--workspace", "pipeline", "--skip-pre-research"],
    project
  )
  const dispatch = dispatchFrom(result.stdout)
  const pipelineWorkspace = path.join(project, "pipeline")
  const pipelineRun = path.join(project, ".omagents", "deep-research", dispatch.run_id)

  assert.strictEqual(dispatch.workspace, pipelineWorkspace)
  assert.strictEqual(dispatch.run_id, path.basename(pipelineRun))
  assert.strictEqual(dispatch.findings_dir, path.join(pipelineRun, "findings"))
  assert.ok(path.isAbsolute(dispatch.findings_dir))
  assert.ok(fs.existsSync(path.join(pipelineRun, "state", "orchestration_state.json")))
  assert.ok(
    fs.existsSync(
      path.join(project, ".omagents", "loops", `deep-research-${dispatch.run_id}`, "tasks.json")
    )
  )
  assert.ok(!fs.existsSync(path.join(pipelineWorkspace, "plan.json")))
  assert.ok(!fs.existsSync(path.join(pipelineWorkspace, "orchestration_state.json")))
})

test("test_two_main_research_runs_have_independent_queues", (t) => {
  const project = makeProject(t)
  const dispatches = []

  for (const workspace of ["main-a", "main-b"]) {
    const result = runPython(
      DEEP_RESEARCH,
      [
        "run-all",
        "--query",
        `Research ${workspace}`,
        "--workspace",
        workspace,
        "--skip-pre-research",
      ],
      project
    )
    dispatches.push(dispatchFrom(result.stdout))
  }

  assert.notStrictEqual(dispatches[0].run_id, dispatches[1].run_id)
  for (const dispatch of dispatches) {
    assert.ok(
      fs.existsSync(
        path.join(project, ".omagents", "loops", `deep-research-${dispatch.run_id}`, "tasks.json")
      )
    )
  }
})

test("test_resume_without_state_fails_without_creating_run", (t) => {
  const project = makeProject(t)
  const result = runPython(
    DEEP_RESEARCH,
    ["run-all", "--resume", "--workspace", "missing"],
    project,
    1
  )

  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /no orchestration checkpoint found for --resume/
  )
  assert.ok(!fs.existsSync(path.join(project, ".omagents", "deep-research")))
})

test("test_report_reads_new_derived_paths_and_legacy_root_fallback", (t) => {
  const project = makeProject(t)
  const gap = (itemId) => ({
    overall_coverage: 0.5,
    gaps: [
      {
        item_id: itemId,
        field_id: "field-1",
        reason: "sentinel",
        severity: "high",
      },
    ],
    new_tasks: [],
    should_continue: false,
  })

  runPython(
    DEEP_RESEARCH,
    ["plan", "--query", "New derived", "--workspace", "new-derived"],
    project
  )
  const internal = runDir(project)
  writeJson(path.join(internal, "artifacts", "gap_report.json"), gap("NEW_GAP"))
  runPython(DEEP_RESEARCH, ["report", "--workspace", "new-derived"], project)

  const newWorkspace = path.join(project, "new-derived")
  const newReport = fs.readFileSync(path.join(newWorkspace, "report.md"), "utf-8")
  assert.match(newReport, /NEW_GAP/)
  assert.ok(!fs.existsSync(path.join(newWorkspace, "provenance.jsonl")))
  assert.ok(fs.existsSync(path.join(internal, "logs", "provenance.jsonl")))

  const legacyWorkspace = path.join(project, "legacy-derived")
  fs.mkdirSync(legacyWorkspace)
  writeJson(path.join(legacyWorkspace, "plan.json"), {})
  runPython(
    DEEP_RESEARCH,
    ["plan", "--query", "Legacy derived", "--workspace", "legacy-derived"],
    project
  )
  writeJson(path.join(legacyWorkspace, "gap_report.json"), gap("LEGACY_ROOT_GAP"))
  runPython(DEEP_RESEARCH, ["report", "--workspace", "legacy-derived"], project)

  const legacyReport = fs.readFileSync(path.join(legacyWorkspace, "report.md"), "utf-8")
  assert.match(legacyReport, /LEGACY_ROOT_GAP/)
  assert.ok(!fs.existsSync(path.join(legacyWorkspace, "logs", "provenance.jsonl")))
})

test("test_completed_run_separates_deliverables_and_internal_artifacts", (t) => {
  const project = makeProject(t)
  const workspace = path.join(project, "complete")

  runPython(DEEP_RESEARCH, ["plan", "--query", "Complete run", "--workspace", "complete"], project)
  const internal = runDir(project)
  const runId = path.basename(internal)
  const planPath = path.join(internal, "plan.json")
  const plan = JSON.parse(fs.readFileSync(planPath, "utf-8"))
  plan.tasks = []
  plan.config.max_research_loops = 0
  writeJson(planPath, plan)
  runPython(LOOP_ENGINE, ["init", `deep-research-${runId}`, "[]"], project)
  writeJson(path.join(internal, "state", "orchestration_state.json"), {
    phase: "dispatch",
    loop: 0,
    query: "Complete run",
    template: "survey",
    workspace,
    run_id: runId,
    started_at: "2026-01-01T00:00:00+00:00",
  })

  runPython(DEEP_RESEARCH, ["run-all", "--resume", "--workspace", "complete"], project)
  const checkpoint = JSON.parse(
    fs.readFileSync(path.join(internal, "state", "orchestration_state.json"), "utf-8")
  )
  assert.strictEqual(checkpoint.phase, "auditing")

  const custom = new Map([
    ["summary.md", "# Custom summary\n"],
    ["execution_roadmap.md", "# Custom roadmap\n"],
    ["tco_model.md", "# Custom TCO\n"],
  ])
  for (const [name, content] of custom) {
    fs.writeFileSync(path.join(workspace, name), content, "utf-8")
  }

  runPython(DEEP_RESEARCH, ["run-all", "--resume", "--workspace", "complete"], project)

  for (const name of [
    "plan.json",
    "findings",
    "pre_findings",
    "artifacts",
    "orchestration_state.json",
    "pre_research_state.json",
    "provenance.jsonl",
  ]) {
    assert.ok(!fs.existsSync(path.join(workspace, name)), `Leaked ${name}`)
  }
  for (const name of ["report.md", "README.md", ...custom.keys()]) {
    assert.ok(fs.existsSync(path.join(workspace, name)), `Missing ${name}`)
  }
  for (const relative of [
    "artifacts/findings_merged.json",
    "artifacts/gap_report.json",
    "artifacts/audit_report.json",
    "artifacts/report_raw.md",
    "artifacts/package.json",
    "state/orchestration_state.json",
    "logs/provenance.jsonl",
  ]) {
    assert.ok(fs.existsSync(path.join(internal, relative)), `Missing ${relative}`)
  }

  const publicFiles = []
  const collectFiles = (directory, prefix = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name)
      if (entry.isDirectory()) {
        collectFiles(path.join(directory, entry.name), relative)
      } else {
        publicFiles.push(relative)
      }
    }
  }
  collectFiles(workspace)
  assert.deepStrictEqual(publicFiles.sort(), [
    "README.md",
    "execution_roadmap.md",
    "report.md",
    "summary.md",
    "tco_model.md",
  ])

  const manifest = JSON.parse(
    fs.readFileSync(path.join(internal, "artifacts", "package.json"), "utf-8")
  )
  assert.strictEqual(manifest.deliverables.report, "report.md")
  assert.strictEqual(manifest.deliverables.summary, "summary.md")
  assert.ok(manifest.files.plan)

  const readme = fs.readFileSync(path.join(workspace, "README.md"), "utf-8")
  assert.ok(!readme.includes(".omagents"))
  const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1])
  assert.strictEqual(links.length, 4, `README:\n${readme}`)
  for (const link of links) {
    assert.ok(!link.startsWith(".."), `Internal link exposed: ${link}`)
    assert.ok(fs.existsSync(path.resolve(workspace, link)), `Broken link ${link}`)
  }
  for (const [name, content] of custom) {
    assert.strictEqual(fs.readFileSync(path.join(workspace, name), "utf-8"), content)
  }
})

test("test_legacy_package_readme_links_resolve_from_artifacts", (t) => {
  const project = makeProject(t)
  const workspace = path.join(project, "legacy-package")
  fs.mkdirSync(workspace)
  writeJson(path.join(workspace, "plan.json"), {})
  runPython(
    DEEP_RESEARCH,
    ["plan", "--query", "Legacy package", "--workspace", "legacy-package"],
    project
  )
  fs.writeFileSync(path.join(workspace, "report.md"), "# Legacy report\n", "utf-8")
  fs.mkdirSync(path.join(workspace, "findings"), { recursive: true })

  runPython(DEEP_RESEARCH, ["package", "--workspace", "legacy-package"], project)

  const readmePath = path.join(workspace, "artifacts", "README.md")
  assert.ok(fs.existsSync(readmePath))
  assert.ok(!fs.existsSync(path.join(workspace, "README.md")))
  const readme = fs.readFileSync(readmePath, "utf-8")
  const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1])
  assert.ok(
    links.some((link) => link.startsWith("../")),
    `Legacy README:\n${readme}`
  )
  for (const link of links) {
    assert.ok(
      fs.existsSync(path.resolve(path.dirname(readmePath), link)),
      `Broken legacy link ${link}`
    )
  }
})

test("test_default_and_ancestor_workspaces_are_rejected_before_writes", (t) => {
  const project = makeProject(t)
  const originalReadme = "# Existing project readme\n"
  fs.writeFileSync(path.join(project, "README.md"), originalReadme, "utf-8")

  const defaultResult = runPython(
    DEEP_RESEARCH,
    ["plan", "--query", "Default workspace"],
    project,
    1
  )
  assert.match(`${defaultResult.stdout}\n${defaultResult.stderr}`, /separate child workspace/)
  assert.strictEqual(fs.readFileSync(path.join(project, "README.md"), "utf-8"), originalReadme)
  assert.ok(!fs.existsSync(path.join(project, ".omagents")))
  assert.ok(!fs.existsSync(path.join(project, "plan.json")))

  const nested = path.join(project, "nested")
  fs.mkdirSync(nested)
  const ancestorResult = runPython(
    DEEP_RESEARCH,
    ["plan", "--query", "Ancestor workspace", "--workspace", ".."],
    nested,
    1
  )
  assert.match(`${ancestorResult.stdout}\n${ancestorResult.stderr}`, /separate child workspace/)
  assert.ok(!fs.existsSync(path.join(nested, ".omagents")))
})

test("structured subagent dispatch is host-neutral and complete", (t) => {
  const project = makeProject(t)
  const plan = {
    query: "Compare Alpha and Beta agent frameworks in 2026",
    items: [
      {
        id: "item-1",
        name: "Alpha Framework",
        type: "framework",
        description: "Alpha's orchestration runtime and maintainer",
      },
      {
        id: "item-2",
        name: "Beta Framework",
        type: "framework",
        description: "Beta's graph runtime and maintainer",
      },
    ],
    fields: [
      {
        id: "field-1",
        name: "Latest Version",
        category: "Version",
        description: "Most recent stable upstream release with its release date",
        required: true,
      },
      {
        id: "field-2",
        name: "Strengths",
        category: "Assessment",
        description: "Evidence-backed architectural and developer-experience advantages",
        required: false,
      },
    ],
  }
  const source = `
import json
import sys
sys.path.insert(0, ${JSON.stringify(SCRIPTS)})
from layout import ResearchLayout
from orchestrate import output_dispatch_instructions
layout = ResearchLayout.resolve("structured", ${JSON.stringify(project)})
plan = json.loads(r'''${JSON.stringify(plan)}''')
layout.plan_path.parent.mkdir(parents=True, exist_ok=True)
layout.plan_path.write_text(json.dumps(plan), encoding="utf-8")
tasks = [
    {"task_id": "task-a", "type": "web", "item_id": "item-1", "field_ids": ["field-1", "field-2"], "focus": "Research Alpha", "description": "Research Alpha"},
    {"task_id": "task-b", "type": "github", "item_id": "item-2", "field_ids": ["field-2"], "focus": "Research Beta", "description": "Research Beta"},
]
output_dispatch_instructions(tasks[:1], layout.workspace, layout)
print("---BATCH---")
output_dispatch_instructions(tasks, layout.workspace, layout)
`
  const result = runPython("-c", [source], project)
  const [singleOutput, batchOutput] = result.stdout.split("---BATCH---")
  const single = dispatchFrom(singleOutput)
  const batch = dispatchFrom(batchOutput)

  for (const key of ["action", "description", "prompt", "name", "cwd"]) {
    assert.ok(single[key], `single dispatch is missing ${key}`)
  }
  assert.strictEqual(single.action, "dispatch_subagent")
  assert.strictEqual(single.name, "task-a")
  assert.strictEqual(single.cwd, project)
  assert.match(single.prompt, /Research Alpha/)
  assert.match(single.prompt, /task-a\.json/)
  assert.match(single.prompt, /deep_research\.py/)
  for (const expected of [
    "Compare Alpha and Beta agent frameworks in 2026",
    "Alpha Framework",
    "Alpha's orchestration runtime and maintainer",
    "Latest Version",
    "Most recent stable upstream release with its release date",
    '"required": true',
    "Strengths",
    "Evidence-backed architectural and developer-experience advantages",
    '"required": false',
    path.join(project, ".omagents", "deep-research", single.run_id, "plan.json"),
  ]) {
    assert.ok(
      single.prompt.includes(expected),
      `fresh child prompt is missing research context: ${expected}\n${single.prompt}`
    )
  }
  assert.ok(path.isAbsolute(single.resume_command.executable))
  assert.strictEqual(single.resume_command.args[0], path.join(SCRIPTS, "deep_research.py"))
  assert.deepStrictEqual(single.resume_command.args.slice(1), [
    "run-all",
    "--resume",
    "--workspace",
    path.join(project, "structured"),
  ])
  assert.strictEqual(single.legacy_resume_command.executable, "deep_research.py")
  assert.deepStrictEqual(single.legacy_resume_command.args, [
    "run-all",
    "--resume",
    "--workspace",
    path.join(project, "structured"),
  ])
  assert.doesNotMatch(result.stdout, /\btask\s*\(\s*background|background\s*[:=]\s*true|OPENCODE_/)

  assert.strictEqual(batch.action, "dispatch_subagents_batch")
  assert.strictEqual(batch.dispatches.length, 2)
  for (const [index, dispatch] of batch.dispatches.entries()) {
    assert.strictEqual(dispatch.action, "dispatch_subagent")
    assert.strictEqual(dispatch.name, `task-${index === 0 ? "a" : "b"}`)
    assert.strictEqual(dispatch.cwd, project)
    assert.ok(dispatch.description)
    assert.match(dispatch.prompt, new RegExp(`task-${index === 0 ? "a" : "b"}\\.json`))
    assert.match(dispatch.prompt, /Compare Alpha and Beta agent frameworks in 2026/)
    assert.match(dispatch.prompt, new RegExp(index === 0 ? "Alpha Framework" : "Beta Framework"))
    assert.match(dispatch.prompt, /Strengths/)
    assert.match(
      dispatch.prompt,
      /Evidence-backed architectural and developer-experience advantages/
    )
    assert.match(dispatch.prompt, /"required": false/)
  }
})

test("gap analysis adds a run-scoped task and resumes the same research lane", (t) => {
  const project = makeProject(t)
  const first = dispatchFrom(
    runPython(
      DEEP_RESEARCH,
      ["run-all", "--query", "Gap resume", "--workspace", "gap-resume", "--skip-pre-research"],
      project
    ).stdout
  )
  const runId = first.run_id
  const internal = path.join(project, ".omagents", "deep-research", runId)
  const planPath = path.join(internal, "plan.json")
  const plan = JSON.parse(fs.readFileSync(planPath, "utf-8"))
  plan.fields.push({
    id: "field-gap",
    name: "Missing dimension",
    category: "General",
    description: "A required field with no initial research task",
    required: true,
  })
  writeJson(planPath, plan)

  let resumed = first
  for (let batch = 0; batch < 5; batch += 1) {
    for (const task of resumed.tasks) {
      writeJson(task.output_path, {
        type: task.type,
        task_id: task.task_id,
        item_id: task.item_id,
        field_ids: task.field_ids,
        focus: task.focus,
        iteration: 0,
        findings: [
          {
            source: `https://example.com/${task.task_id}`,
            title: task.focus,
            published_date: "2026-01-01",
            field_data: Object.fromEntries(task.field_ids.map((field) => [field, "covered"])),
            summary: "Covered initial fields",
            key_quotes: [],
            relevance: "high",
            uncertain: false,
          },
        ],
        gaps: [],
      })
      runPython(
        LOOP_ENGINE,
        ["complete", `deep-research-${runId}`, task.task_id, "initial findings written"],
        project
      )
    }
    resumed = dispatchFrom(
      runPython(DEEP_RESEARCH, ["run-all", "--resume", "--workspace", "gap-resume"], project).stdout
    )
    if (resumed.action === "dispatch_subagent" && resumed.name?.startsWith("task-r1-")) break
    assert.ok(batch < 4, "gap dispatch was not reached after draining initial tasks")
  }

  assert.strictEqual(resumed.run_id, runId)
  assert.strictEqual(resumed.action, "dispatch_subagent")
  assert.match(resumed.name, /^task-r1-/)
  assert.match(resumed.prompt, /field-gap|Missing dimension/)
  const checkpoint = JSON.parse(
    fs.readFileSync(path.join(internal, "state", "orchestration_state.json"), "utf-8")
  )
  assert.strictEqual(checkpoint.phase, "dispatch")
  assert.strictEqual(checkpoint.loop, 1)
  const queue = JSON.parse(
    fs.readFileSync(
      path.join(project, ".omagents", "loops", `deep-research-${runId}`, "tasks.json"),
      "utf-8"
    )
  )
  assert.ok(queue.tasks.some((task) => task.task_id === resumed.name && task.status === "pending"))
  assert.ok(!fs.existsSync(path.join(project, "gap-resume", "plan.json")))
})

test("missing and corrupt loop queues fail resume before gap or report stages", (t) => {
  for (const mode of ["missing", "corrupt", "null-row", "empty-row"]) {
    const project = makeProject(t)
    const first = dispatchFrom(
      runPython(
        DEEP_RESEARCH,
        [
          "run-all",
          "--query",
          `Queue ${mode}`,
          "--workspace",
          "queue-failure",
          "--skip-pre-research",
        ],
        project
      ).stdout
    )
    const queuePath = path.join(
      project,
      ".omagents",
      "loops",
      `deep-research-${first.run_id}`,
      "tasks.json"
    )
    if (mode === "missing") {
      fs.rmSync(queuePath)
    } else if (mode === "corrupt") {
      fs.writeFileSync(queuePath, "{not-json", "utf-8")
    } else {
      const queue = JSON.parse(fs.readFileSync(queuePath, "utf-8"))
      writeJson(queuePath, {
        ...queue,
        tasks: [mode === "null-row" ? null : {}],
      })
    }

    const resumed = runPython(
      DEEP_RESEARCH,
      ["run-all", "--resume", "--workspace", "queue-failure"],
      project,
      1
    )
    const output = `${resumed.stdout}\n${resumed.stderr}`
    assert.match(output, /loop queue.*(missing|unreadable|invalid)/i)
    assert.doesNotMatch(output, /Phase 3|Phase 4|Phase 5|Research complete/)
    assert.ok(!fs.existsSync(path.join(project, "queue-failure", "report.md")))
    assert.ok(
      !fs.existsSync(
        path.join(
          project,
          ".omagents",
          "deep-research",
          first.run_id,
          "artifacts",
          "gap_report.json"
        )
      )
    )
    const checkpoint = JSON.parse(
      fs.readFileSync(
        path.join(
          project,
          ".omagents",
          "deep-research",
          first.run_id,
          "state",
          "orchestration_state.json"
        ),
        "utf-8"
      )
    )
    assert.strictEqual(checkpoint.phase, "dispatch")
  }

  const project = makeProject(t)
  const first = dispatchFrom(
    runPython(
      DEEP_RESEARCH,
      [
        "run-all",
        "--query",
        "Valid empty queue",
        "--workspace",
        "valid-empty",
        "--skip-pre-research",
      ],
      project
    ).stdout
  )
  const queuePath = path.join(
    project,
    ".omagents",
    "loops",
    `deep-research-${first.run_id}`,
    "tasks.json"
  )
  const queue = JSON.parse(fs.readFileSync(queuePath, "utf-8"))
  writeJson(queuePath, { ...queue, tasks: [] })
  const resumed = runPython(
    DEEP_RESEARCH,
    ["run-all", "--resume", "--workspace", "valid-empty"],
    project
  )
  assert.match(resumed.stdout, /Phase 3: Running gap analysis/)
  assert.ok(
    fs.existsSync(
      path.join(project, ".omagents", "deep-research", first.run_id, "artifacts", "gap_report.json")
    )
  )
})

test("test_agent_output_paths_shell_round_trip", (t) => {
  const project = makeProject(t)
  const preWorkspace = "研究 topic's & spaces"
  const preResult = runPython(
    DEEP_RESEARCH,
    ["run-all", "--query", "Shell paths 研究", "--workspace", preWorkspace],
    project,
    0,
    LEGACY_CONSOLE
  )
  const pre = dispatchFrom(preResult.stdout)
  assert.ok(pre.task.description.includes("Shell paths 研究"))
  assert.strictEqual(pre.shell, process.platform === "win32" ? "powershell" : "posix")
  assert.strictEqual(path.basename(pre.output_path), "pre-1.json")
  assert.ok(pre.output_path.includes(".omagents"))
  const preRoundTrip = shellRoundTrip(pre.output_path_quoted)
  assert.strictEqual(preRoundTrip.status, 0, preRoundTrip.stderr)
  assert.strictEqual(preRoundTrip.stdout, pre.output_path)
  assert.ok(path.isAbsolute(pre.resume_command.executable))
  assert.deepStrictEqual(pre.resume_command.args, [
    path.join(SCRIPTS, "deep_research.py"),
    "run-all",
    "--resume",
    "--workspace",
    path.join(project, preWorkspace),
  ])
  assert.strictEqual(pre.legacy_resume_command.executable, "deep_research.py")
  assert.deepStrictEqual(pre.legacy_resume_command.args, [
    "run-all",
    "--resume",
    "--workspace",
    path.join(project, preWorkspace),
  ])

  const mainWorkspace = "main topic's & spaces"
  const mainResult = runPython(
    DEEP_RESEARCH,
    ["run-all", "--query", "Main shell paths", "--workspace", mainWorkspace, "--skip-pre-research"],
    project,
    0,
    LEGACY_CONSOLE
  )
  const main = dispatchFrom(mainResult.stdout)
  assert.strictEqual(main.shell, process.platform === "win32" ? "powershell" : "posix")
  assert.ok(main.tasks.length > 0)
  for (const task of main.tasks) {
    assert.strictEqual(path.basename(task.output_path), `${task.task_id}.json`)
    const roundTrip = shellRoundTrip(task.output_path_quoted)
    assert.strictEqual(roundTrip.status, 0, roundTrip.stderr)
    assert.strictEqual(roundTrip.stdout, task.output_path)
  }
})

test("test_package_encodes_special_deliverable_links_and_labels", (t) => {
  const project = makeProject(t)
  const workspace = path.join(project, "special-package")
  runPython(
    DEEP_RESEARCH,
    ["plan", "--query", "Special package", "--workspace", "special-package"],
    project
  )
  fs.writeFileSync(path.join(workspace, "my report#1).md"), "# Special\n", "utf-8")
  fs.writeFileSync(path.join(workspace, "my [draft].md"), "# Draft\n", "utf-8")
  runPython(DEEP_RESEARCH, ["package", "--workspace", "special-package"], project)

  const readme = fs.readFileSync(path.join(workspace, "README.md"), "utf-8")
  assert.match(readme, /my%20report%231%29\.md/)
  assert.match(readme, /my%20%5Bdraft%5D\.md/)
  assert.match(readme, /My \\\[Draft\\\]/)
  const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1])
  for (const link of links) {
    assert.ok(fs.existsSync(path.join(workspace, decodeURIComponent(link))))
  }
})

test("test_malformed_required_json_fails_clearly", (t) => {
  const project = makeProject(t)
  const legacyWorkspace = path.join(project, "broken-package")
  fs.mkdirSync(legacyWorkspace)
  fs.writeFileSync(path.join(legacyWorkspace, "plan.json"), "{invalid", "utf-8")
  const invalidPlan = runPython(
    DEEP_RESEARCH,
    ["package", "--workspace", "broken-package"],
    project,
    1
  )
  assert.match(`${invalidPlan.stdout}\n${invalidPlan.stderr}`, /invalid plan\.json/)
  assert.ok(!fs.existsSync(path.join(legacyWorkspace, "artifacts", "package.json")))

  writeJson(path.join(legacyWorkspace, "plan.json"), [])
  const arrayPlan = runPython(
    DEEP_RESEARCH,
    ["package", "--workspace", "broken-package"],
    project,
    1
  )
  assert.match(`${arrayPlan.stdout}\n${arrayPlan.stderr}`, /plan\.json must contain an object/)

  runPython(
    DEEP_RESEARCH,
    ["plan", "--query", "Broken checkpoint", "--workspace", "broken-checkpoint"],
    project
  )
  const internal = path.join(
    project,
    ".omagents",
    "deep-research",
    fs
      .readdirSync(path.join(project, ".omagents", "deep-research"))
      .find((name) => name.startsWith("broken-checkpoint-"))
  )
  writeJson(path.join(internal, "state", "orchestration_state.json"), [])
  const checkpoint = runPython(
    DEEP_RESEARCH,
    ["run-all", "--resume", "--workspace", "broken-checkpoint"],
    project,
    1
  )
  const checkpointOutput = `${checkpoint.stdout}\n${checkpoint.stderr}`
  assert.match(checkpointOutput, /could not read orchestration checkpoint/)
  assert.ok(!checkpointOutput.includes("TypeError"))
})
