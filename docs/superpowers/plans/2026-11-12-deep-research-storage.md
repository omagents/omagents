# Deep Research Storage Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `--workspace` a deliverables-only directory while storing each new deep-research run's internal files in a run-specific project `.omagents` layout without breaking legacy workspaces.

**Architecture:** A single `ResearchLayout` resolver owns run identity, canonical paths, and legacy detection. All CLI, orchestration, pre-research, reporting, provenance, and packaging code consumes that resolver; the existing loop engine remains unchanged and receives run-specific skill keys for new runs.

**Tech Stack:** Python 3.11+ standard library, existing Jinja2 report generation, Node.js `node:test`, `pathlib`.

**Spec:** `docs/superpowers/specs/2026-11-12-deep-research-storage-design.md`

## Global Constraints

- Do not automatically migrate, clean, or delete existing research files.
- New runs use `.omagents/deep-research/<run-id>/`; legacy runs retain their existing storage and loop keys.
- Raw evidence, curated inputs, checkpoints, and provenance are durable. Derived artifacts are rebuildable but retained by default.
- The shared `loop_engine.py` interface and default storage remain unchanged.
- Use `pathlib` and argument arrays for subprocesses; support spaces and non-ASCII paths on Linux, macOS, and Windows.
- Update English, Simplified Chinese, Japanese, and Korean README files together.
- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or other git mutations without explicit user confirmation.

## Review Focus

- **Same directory name in different parent directories:** each workspace must resolve to a different run ID; pinned by Task 1 `test_same_slug_in_different_directories_gets_distinct_run_ids`.
- **Whole project relocation:** the same project-relative workspace must retain its run ID; pinned by Task 1 `test_project_relative_run_id_survives_project_relocation`.
- **Legacy split provenance:** events in both workspace root and `artifacts/` must load in timestamp order; pinned by Task 4 `test_legacy_provenance_loads_root_and_artifacts`.
- **Paths containing spaces and non-ASCII characters:** every subprocess argument and agent instruction must preserve the exact path; pinned by Task 2 `test_pre_research_supports_unicode_workspace_with_spaces`.
- **Resume without a checkpoint:** return a clear error instead of silently creating a replacement run; pinned by Task 3 `test_resume_without_state_fails_without_creating_run`.

---

### Task 1: Central Research Layout Resolver

**Files:**
- Create: `skills/deep-research/scripts/layout.py`
- Create: `tests/deep_research_layout_test.py`
- Create: `tests/deep-research.test.js`

**Interfaces:**
- Produces: `ResearchLayout.resolve(workspace: str | Path, project_root: str | Path | None = None) -> ResearchLayout`.
- Produces read-only properties: `project_root`, `workspace`, `run_id`, `run_dir`, `storage_dir`, `legacy`, `plan_path`, `pre_research_path`, `curated_pre_research_path`, `pre_research_state_path`, `orchestration_state_path`, `pre_findings_dir`, `findings_dir`, `artifacts_dir`, `merged_path`, `gap_path`, `audit_path`, `raw_report_path`, `package_path`, `provenance_path`, `report_path`, `summary_path`, `readme_path`.
- Produces: `loop_skill(pre: bool = False) -> str`, returning `deep-research[-pre]-<run-id>` for new runs and the original unnamespaced keys for legacy runs.
- Produces: `display_path(path: Path) -> str`, returning a project-relative POSIX-style path when possible and an absolute path otherwise.

- [ ] **Step 1: Write failing resolver tests**

Create Python `unittest` cases named `test_new_workspace_paths`, `test_same_slug_in_different_directories_gets_distinct_run_ids`, `test_project_relative_run_id_survives_project_relocation`, `test_legacy_workspace_paths_and_loop_keys`, and `test_new_layout_wins_when_both_layouts_exist`.

Assert at minimum:
- New `plan_path == run_dir / "plan.json"`; new state files are under `run_dir / "state"`; new provenance is under `run_dir / "logs"`.
- New `report_path`, `summary_path`, and `readme_path` remain in the public workspace.
- The run ID contains a sanitized workspace slug and an eight-character lowercase hash suffix.
- Two different project-relative paths ending in the same slug have different IDs; resolving the same path twice yields the same ID.
- Two temporary project roots with the same relative workspace path yield the same ID.
- Creating legacy `workspace / "plan.json"` selects legacy mode, root storage, and unnamespaced loop keys.
- Creating new `run_dir / "plan.json"` alongside legacy files selects new mode.

- [ ] **Step 2: Run the resolver tests and verify RED**

Run: `python3 -m unittest discover -s tests -p 'deep_research_*_test.py' -v`

Expected: FAIL during import because `skills/deep-research/scripts/layout.py` does not exist.

- [ ] **Step 3: Add a Node test entry point for the Python tests**

In `tests/deep-research.test.js`, add a `node:test` case that runs the same unittest discovery with `process.env.OMAGENTS_TEST_PYTHON || "python3"` and asserts exit status 0. Use `spawnSync` with an argument array and inherit stdio.

- [ ] **Step 4: Implement `ResearchLayout`**

Use a frozen dataclass. Resolve paths without requiring them to exist. Derive the hash from the normalized project-relative workspace path when the workspace is inside the project; otherwise use its resolved absolute path. Sanitize the slug to lowercase ASCII letters, digits, and hyphens, falling back to `research`.

Select new mode when the internal run has `plan.json`, `state/orchestration_state.json`, or `state/pre_research_state.json`. Otherwise select legacy mode when the public workspace has `plan.json`, `orchestration_state.json`, or `pre_research_state.json`. Otherwise select new mode. New mode wins when both exist.

For legacy mode, map storage to the public workspace, state files to its root, and `readme_path` to `artifacts/README.md`; preserve root versus `artifacts/` read fallbacks for later tasks rather than encoding ambiguous reads into the resolver.

- [ ] **Step 5: Run resolver and Node tests and verify GREEN**

Run:
```bash
python3 -m unittest discover -s tests -p 'deep_research_*_test.py' -v
node --test tests/deep-research.test.js
```

Expected: all resolver tests PASS.

---

### Task 2: Pre-Research Storage and Run-Specific Loop Queues

**Files:**
- Modify: `skills/deep-research/scripts/pre_research.py`
- Modify: `skills/deep-research/scripts/orchestrate.py`
- Test: `tests/deep-research.test.js`

**Interfaces:**
- Consumes: `ResearchLayout.resolve()`, all pre-research properties, and `loop_skill(pre=True)` from Task 1.
- Produces: pre-research CLI commands that accept the existing `--workspace` and resolve identical new or legacy storage.
- Produces for orchestration: `pre_research_next(workspace, layout)`, `pre_research_complete(workspace, task_id, layout)`, and loop helper signatures accepting `layout`.

- [ ] **Step 1: Write failing pre-research integration tests**

Add Node tests `test_pre_research_uses_internal_state_and_namespaced_loop`, `test_two_pre_research_runs_have_independent_queues`, `test_pre_research_supports_unicode_workspace_with_spaces`, and `test_legacy_pre_research_uses_original_loop_key`.

Use `spawnSync` argument arrays to invoke `pre_research.py init`, `next`, `evaluate`, and `finalize`. Assert:
- New `pre_research_state.json` and finalized `pre_research.json` are under the resolved run directory.
- New queue state is `.omagents/loops/deep-research-pre-<run-id>/tasks.json`.
- The public workspace contains neither pre-research state nor `pre_findings/`.
- Two runs return tasks for their own queries and have separate queue files.
- A workspace named `研究 topic with spaces` round-trips exactly.
- A legacy state file selects `.omagents/loops/deep-research-pre/tasks.json`.

- [ ] **Step 2: Run the integration tests and verify RED**

Run: `node --test tests/deep-research.test.js`

Expected: new pre-research files still appear in the public workspace and new queues use the shared `deep-research-pre` key.

- [ ] **Step 3: Route pre-research through `ResearchLayout`**

Replace `_workspace_pre_findings_dir()` and direct state/output path construction with resolver properties. Pass the resolved pre-research loop key to every `loop_engine.py init/next/complete/add/reset/status` invocation. Add the existing `--workspace` option to the direct `status` subcommand so it can resolve the same run.

Do not change `loop_engine.py` or its working-directory behavior.

- [ ] **Step 4: Thread layout through orchestration loop helpers**

Update main and pre-research `next/init/add/complete` helpers to use `layout.loop_skill()` while retaining the legacy keys selected by the resolver. Ensure pre-research dispatch instructions print `layout.pre_findings_dir / "<task_id>.json"` rather than `<workspace>/pre_findings/...`.

- [ ] **Step 5: Run pre-research tests and verify GREEN**

Run: `node --test tests/deep-research.test.js`

Expected: resolver and all pre-research storage/isolation tests PASS.

---

### Task 3: Unified CLI and Orchestrator Path Routing

**Files:**
- Modify: `skills/deep-research/scripts/deep_research.py`
- Modify: `skills/deep-research/scripts/orchestrate.py`
- Modify: `skills/deep-research/scripts/plan.py`
- Test: `tests/deep-research.test.js`

**Interfaces:**
- Consumes: every `ResearchLayout` property and loop helper from Tasks 1–2.
- Produces: all standalone commands and `run-all` using the same internal plan/findings/derived/state paths and public report/README paths.
- Produces dispatch JSON fields `workspace`, `run_id`, `findings_dir`, and `pre_findings_dir` as absolute strings for agent instructions.

- [ ] **Step 1: Write failing CLI and checkpoint tests**

Add Node tests `test_plan_and_run_all_keep_internal_files_out_of_workspace`, `test_two_main_research_runs_have_independent_queues`, and `test_resume_without_state_fails_without_creating_run`.

Assert:
- `deep_research.py plan` writes only internal `plan.json`; it creates no public plan or root provenance.
- Initial `run-all --skip-pre-research` writes internal orchestration state, uses a run-specific main queue, and pauses at dispatch with absolute `findings_dir` in its JSON instructions.
- Two workspaces have distinct main queue files.
- `run-all --resume` for a workspace with no new or legacy checkpoint exits nonzero, prints a clear missing-checkpoint error, and creates no new run directory.

- [ ] **Step 2: Run the CLI tests and verify RED**

Run: `node --test tests/deep-research.test.js`

Expected: current commands write public `plan.json` and `orchestration_state.json` and share main loop state.

- [ ] **Step 3: Route every unified CLI command through the resolver**

In `deep_research.py`, replace `_artifacts_dir()` and direct `workspace / ...` construction with layout properties for plan, add-items/add-fields, merge, gaps, validate, report, polish, audit, package, provenance, status, scan, and run-all. Keep the public `--workspace` interface unchanged.

`run_polish` instructions must name the internal raw report and public final report explicitly. All printed resume commands must quote paths with `shlex.quote()` on POSIX and use argument-safe JSON path fields independent of shell quoting.

- [ ] **Step 4: Route the orchestrator through one layout per invocation**

Resolve once in `run_all()` and `get_status()`, then pass the layout to state and loop helpers. Replace root gap output with `layout.gap_path`, raw report with `layout.raw_report_path`, and all status existence checks with resolver properties. Add `run_id`, `workspace`, and the applicable findings directory to dispatch JSON.

When `resume=True` and neither a new nor legacy orchestration checkpoint exists, print `Error: no orchestration checkpoint found for --resume in <workspace>` and return 1 before creating directories or loop state.

- [ ] **Step 5: Keep plan provenance anchored to the resolved run**

Adjust `plan.py`'s provenance call only as needed to pass enough anchor information for Task 4 to distinguish an internal run root from a public workspace. Do not write a second provenance file from the CLI.

- [ ] **Step 6: Run CLI/orchestrator tests and verify GREEN**

Run: `node --test tests/deep-research.test.js`

Expected: all resolver, pre-research, CLI, isolation, and missing-checkpoint tests PASS.

---

### Task 4: Canonical Provenance, Derived Readers, and Packaging

**Files:**
- Modify: `skills/deep-research/scripts/provenance.py`
- Modify: `skills/deep-research/scripts/gap_analysis.py`
- Modify: `skills/deep-research/scripts/synthesize.py`
- Modify: `skills/deep-research/scripts/package.py`
- Test: `tests/deep-research.test.js`
- Test: `tests/deep_research_layout_test.py`

**Interfaces:**
- Consumes: resolved new/legacy paths and public deliverable locations.
- Produces: one new-run provenance destination, ordered legacy provenance loading, canonical new-run gap/audit reads with legacy fallback, and separate machine manifest versus human deliverable index.

- [ ] **Step 1: Write failing provenance and reader tests**

Add Python tests `test_new_provenance_path_does_not_depend_on_artifacts_existence` and `test_legacy_provenance_loads_root_and_artifacts`.

For the legacy test, write differently timestamped events to both root `provenance.jsonl` and `artifacts/provenance.jsonl`; assert one combined timeline ordered by timestamp. For the new test, log the first event before creating `artifacts/` and assert `run_dir/logs/provenance.jsonl` is the only new event file.

Add Node test `test_report_reads_new_derived_paths_and_legacy_root_fallback` covering new `artifacts/gap_report.json` and legacy root `gap_report.json` without producing duplicate provenance destinations.

- [ ] **Step 2: Run provenance/reader tests and verify RED**

Run:
```bash
python3 -m unittest discover -s tests -p 'deep_research_*_test.py' -v
node --test tests/deep-research.test.js
```

Expected: early new events use the old root/artifacts heuristic and legacy split events are not combined.

- [ ] **Step 3: Implement canonical provenance behavior**

Centralize internal-run anchor recognition in `layout.py` so calls originating at a run root or its `artifacts/` child resolve to the same run log. New writes always use `run_dir/logs/provenance.jsonl`. Legacy writes use `workspace/artifacts/provenance.jsonl`; legacy reads combine that file with root `provenance.jsonl`, ignore malformed lines as before, and sort valid events by timestamp.

Update gap and synthesis readers to use new canonical paths and retain the legacy preference for `artifacts/` over root fallback.

- [ ] **Step 4: Write failing full-pipeline and package tests**

Add Node test `test_completed_run_separates_deliverables_and_internal_artifacts`.

Use a plan with `tasks: []` and `max_research_loops: 0`, initialize its resolved empty main queue, and seed a dispatch checkpoint so the real orchestrator can run without subagents. Resume through polishing and completion. Add custom `summary.md`, `execution_roadmap.md`, and `tco_model.md` to the public workspace before packaging.

Assert:
- Public workspace contains `report.md`, `README.md`, and the custom deliverables, but no `plan.json`, `findings/`, `pre_findings/`, `artifacts/`, state files, or provenance.
- Internal storage contains merged findings, gap report, audit report, raw report, package manifest, state, and provenance.
- README links resolve relative to its own location and include only public deliverables.
- Packaging leaves custom Markdown content byte-for-byte unchanged.
- Legacy packaging retains `artifacts/README.md` and generates links relative to that directory.

- [ ] **Step 5: Run full-pipeline/package tests and verify RED**

Run: `node --test tests/deep-research.test.js`

Expected: package generation still expects public inputs, writes its README under the wrong new-run location, and exposes internal files in the new human index.

- [ ] **Step 6: Update package generation**

Resolve every expected path through `ResearchLayout`. Store machine-readable `files` using `display_path()`, add a separate `deliverables` mapping for public Markdown files, and generate README links relative to `layout.readme_path.parent`. Include `report.md`, optional `summary.md`, and additional public Markdown deliverables without modifying their contents.

For new runs write `workspace/README.md`; for legacy runs keep `artifacts/README.md`. Preserve dynamically discovered internal artifacts in the machine manifest but exclude them from the new human deliverable index.

- [ ] **Step 7: Run all storage tests and verify GREEN**

Run:
```bash
python3 -m unittest discover -s tests -p 'deep_research_*_test.py' -v
node --test tests/deep-research.test.js
```

Expected: all storage, legacy compatibility, pipeline, provenance, and packaging tests PASS.

---

### Task 5: Documentation, CI Test Environment, and Full Verification

**Files:**
- Modify: `skills/deep-research/SKILL.md`
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README.zh-cn.md`
- Modify: `README.ja.md`
- Modify: `README.ko.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/superpowers/specs/2026-11-12-deep-research-storage-design.md`

**Interfaces:**
- Consumes: final behavior and tests from Tasks 1–4.
- Produces: user/agent documentation and CI commands matching the implemented layout.

- [ ] **Step 1: Update deep-research agent instructions**

Replace every new-run `<workspace>/plan.json`, `<workspace>/findings`, and `<workspace>/pre_findings` assumption with the resolved internal paths supplied in dispatch JSON. Document the approved directory tree, durable versus rebuildable retention, explicit cross-run reuse, custom deliverable promotion, legacy behavior, and the canonical `logs/provenance.jsonl` and `artifacts/gap_report.json` paths.

Keep direct helper-script examples internally consistent and do not introduce a root-level `templates/` reference.

- [ ] **Step 2: Update project and user documentation**

Add `layout.py` and the run-specific storage behavior to `AGENTS.md`, including the unchanged shared loop engine with namespaced deep-research keys. Add an Unreleased changelog entry describing deliverable separation, legacy compatibility, and the provenance/gap path fixes.

Add the same concise user-facing workspace behavior to all four README languages in the same change. Mark the written spec status as implemented only after verification passes.

- [ ] **Step 3: Provide an isolated CI Python test dependency**

Update CI to create `.omagents/ci-venv`, install only the existing `jinja2` dependency there, and run storage tests with `OMAGENTS_TEST_PYTHON=.omagents/ci-venv/bin/python`. Include `layout.py`, `pre_research.py`, `orchestrate.py`, `provenance.py`, and `package.py` in Python compilation checks. Do not install anything globally and do not alter the published dependency metadata.

- [ ] **Step 4: Run formatting, syntax, and complete tests**

Run:
```bash
node --check .opencode/plugins/index.js
python3 -m py_compile skills/deep-research/scripts/*.py skills/_shared/scripts/loop_engine.py
npx prettier --check ".opencode/plugins/*.js" "tests/*.js" "index.js" ".codex/plugins/*.js" "hooks/*.js"
python3 -m unittest discover -s tests -p 'deep_research_*_test.py' -v
node --test tests/*.test.js
git diff --check
```

Also run the deep-research integration tests once with the project's isolated Jinja2-enabled Python through `OMAGENTS_TEST_PYTHON`.

Expected: all commands exit 0; all existing and new tests PASS.

- [ ] **Step 5: Inspect the final diff and filesystem evidence**

Review `git diff --stat` and the complete diff for unintended files or unrelated changes. Inspect one temporary new run and one legacy fixture to confirm the actual trees match the spec. Do not commit unless the user explicitly requests it.
