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
const SCRIPTS = path.join(ROOT, "skills", "deep-research", "scripts")
const PRE_RESEARCH = path.join(SCRIPTS, "pre_research.py")
const DEEP_RESEARCH = path.join(SCRIPTS, "deep_research.py")
const LOOP_ENGINE = path.join(ROOT, "skills", "_shared", "scripts", "loop_engine.py")

function makeProject(t) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "omagents-research-")))
  t.after(() => fs.rmSync(project, { recursive: true, force: true }))
  return project
}

function runPython(script, args, cwd, expectedStatus = 0) {
  const result = spawnSync(PYTHON, [script, ...args], {
    cwd,
    encoding: "utf-8",
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
  const start = output.lastIndexOf('{\n  "action"')
  assert.notStrictEqual(start, -1, `No dispatch JSON in output:\n${output}`)
  return JSON.parse(output.slice(start))
}

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

  runPython(PRE_RESEARCH, ["init", "--query", query, "--workspace", workspace], project)
  const next = JSON.parse(runPython(PRE_RESEARCH, ["next", "-w", workspace], project).stdout)
  assert.match(next.description, /边缘计算 2026/)

  const internal = runDir(project)
  writeJson(path.join(internal, "pre_findings", "pre-1.json"), preFinding())
  runPython(PRE_RESEARCH, ["complete", "pre-1", "-w", workspace], project)
  runPython(PRE_RESEARCH, ["finalize", "-w", workspace], project)
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

test("test_agent_output_paths_shell_round_trip", (t) => {
  const project = makeProject(t)
  const preWorkspace = "研究 topic's & spaces"
  const preResult = runPython(
    DEEP_RESEARCH,
    ["run-all", "--query", "Shell paths", "--workspace", preWorkspace],
    project
  )
  const pre = dispatchFrom(preResult.stdout)
  assert.strictEqual(pre.shell, "posix")
  assert.strictEqual(path.basename(pre.output_path), "pre-1.json")
  assert.ok(pre.output_path.includes(".omagents"))
  const preRoundTrip = spawnSync("/bin/sh", ["-c", `printf '%s' ${pre.output_path_quoted}`], {
    encoding: "utf-8",
  })
  assert.strictEqual(preRoundTrip.status, 0, preRoundTrip.stderr)
  assert.strictEqual(preRoundTrip.stdout, pre.output_path)
  assert.deepStrictEqual(pre.resume_command.args, [
    "run-all",
    "--resume",
    "--workspace",
    path.join(project, preWorkspace),
  ])

  const mainWorkspace = "main topic's & spaces"
  const mainResult = runPython(
    DEEP_RESEARCH,
    ["run-all", "--query", "Main shell paths", "--workspace", mainWorkspace, "--skip-pre-research"],
    project
  )
  const main = dispatchFrom(mainResult.stdout)
  assert.strictEqual(main.shell, "posix")
  assert.ok(main.tasks.length > 0)
  for (const task of main.tasks) {
    assert.strictEqual(path.basename(task.output_path), `${task.task_id}.json`)
    const roundTrip = spawnSync("/bin/sh", ["-c", `printf '%s' ${task.output_path_quoted}`], {
      encoding: "utf-8",
    })
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
