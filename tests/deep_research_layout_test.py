from __future__ import annotations

import json
import sys
import tempfile
import unittest
from contextlib import chdir
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "deep-research" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import deep_research  # noqa: E402
import orchestrate  # noqa: E402
from layout import ResearchLayout  # noqa: E402
from provenance import load_events, log_event  # noqa: E402


class ResearchLayoutTest(unittest.TestCase):
    def test_new_workspace_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp).resolve()
            layout = ResearchLayout.resolve("AI Research 2026", project)

            self.assertFalse(layout.legacy)
            self.assertRegex(layout.run_id, r"^ai-research-2026-[0-9a-f]{8}$")
            expected_run = (
                project / ".omagents" / "deep-research" / layout.run_id
            )
            self.assertEqual(layout.run_dir, expected_run)
            self.assertEqual(layout.storage_dir, expected_run)
            self.assertEqual(layout.plan_path, expected_run / "plan.json")
            self.assertEqual(
                layout.pre_research_path, expected_run / "pre_research.json"
            )
            self.assertEqual(
                layout.curated_pre_research_path,
                expected_run / "pre_research_curated.json",
            )
            self.assertEqual(
                layout.pre_research_state_path,
                expected_run / "state" / "pre_research_state.json",
            )
            self.assertEqual(
                layout.orchestration_state_path,
                expected_run / "state" / "orchestration_state.json",
            )
            self.assertEqual(
                layout.pre_findings_dir, expected_run / "pre_findings"
            )
            self.assertEqual(layout.findings_dir, expected_run / "findings")
            self.assertEqual(layout.artifacts_dir, expected_run / "artifacts")
            self.assertEqual(
                layout.merged_path,
                expected_run / "artifacts" / "findings_merged.json",
            )
            self.assertEqual(
                layout.gap_path, expected_run / "artifacts" / "gap_report.json"
            )
            self.assertEqual(
                layout.audit_path,
                expected_run / "artifacts" / "audit_report.json",
            )
            self.assertEqual(
                layout.raw_report_path,
                expected_run / "artifacts" / "report_raw.md",
            )
            self.assertEqual(
                layout.package_path,
                expected_run / "artifacts" / "package.json",
            )
            self.assertEqual(
                layout.provenance_path,
                expected_run / "logs" / "provenance.jsonl",
            )

            workspace = project / "AI Research 2026"
            self.assertEqual(layout.workspace, workspace)
            self.assertEqual(layout.report_path, workspace / "report.md")
            self.assertEqual(layout.summary_path, workspace / "summary.md")
            self.assertEqual(layout.readme_path, workspace / "README.md")
            self.assertEqual(
                layout.loop_skill(), f"deep-research-{layout.run_id}"
            )
            self.assertEqual(
                layout.loop_skill(pre=True),
                f"deep-research-pre-{layout.run_id}",
            )
            self.assertEqual(
                layout.display_path(layout.plan_path),
                (Path(".omagents") / "deep-research" / layout.run_id / "plan.json").as_posix(),
            )

    def test_same_slug_in_different_directories_gets_distinct_run_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp).resolve()
            first = ResearchLayout.resolve("one/topic", project)
            repeated = ResearchLayout.resolve("one/topic", project)
            second = ResearchLayout.resolve("two/topic", project)

            self.assertEqual(first.run_id, repeated.run_id)
            self.assertNotEqual(first.run_id, second.run_id)
            self.assertTrue(first.run_id.startswith("topic-"))
            self.assertTrue(second.run_id.startswith("topic-"))

    def test_project_relative_run_id_survives_project_relocation(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp).resolve()
            original = base / "original" / "project"
            relocated = base / "relocated" / "project"

            before = ResearchLayout.resolve("research/topic", original)
            after = ResearchLayout.resolve("research/topic", relocated)

            self.assertEqual(before.run_id, after.run_id)

    def test_legacy_workspace_paths_and_loop_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp).resolve()
            workspace = project / "legacy"
            workspace.mkdir()
            (workspace / "plan.json").write_text("{}", encoding="utf-8")

            layout = ResearchLayout.resolve(workspace, project)

            self.assertTrue(layout.legacy)
            self.assertEqual(layout.storage_dir, workspace)
            self.assertEqual(layout.plan_path, workspace / "plan.json")
            self.assertEqual(
                layout.orchestration_state_path,
                workspace / "orchestration_state.json",
            )
            self.assertEqual(
                layout.pre_research_state_path,
                workspace / "pre_research_state.json",
            )
            self.assertEqual(layout.gap_path, workspace / "artifacts" / "gap_report.json")
            self.assertEqual(
                layout.readme_path, workspace / "artifacts" / "README.md"
            )
            self.assertEqual(layout.loop_skill(), "deep-research")
            self.assertEqual(layout.loop_skill(pre=True), "deep-research-pre")

    def test_new_layout_wins_when_both_layouts_exist(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp).resolve()
            workspace = project / "mixed"
            workspace.mkdir()
            (workspace / "plan.json").write_text("{}", encoding="utf-8")
            legacy = ResearchLayout.resolve(workspace, project)
            self.assertTrue(legacy.legacy)

            legacy.run_dir.mkdir(parents=True)
            (legacy.run_dir / "plan.json").write_text("{}", encoding="utf-8")
            resolved = ResearchLayout.resolve(workspace, project)

            self.assertFalse(resolved.legacy)
            self.assertEqual(resolved.plan_path, legacy.run_dir / "plan.json")

    def test_new_provenance_path_does_not_depend_on_artifacts_existence(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp).resolve()
            layout = ResearchLayout.resolve("new-run", project)
            self.assertFalse(layout.artifacts_dir.exists())

            log_event(layout.run_dir, "plan_created", query="demo")

            self.assertTrue(layout.provenance_path.exists())
            self.assertFalse((layout.run_dir / "provenance.jsonl").exists())
            self.assertFalse(
                (layout.artifacts_dir / "provenance.jsonl").exists()
            )
            events = load_events(layout.run_dir)
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["event_type"], "plan_created")

    def test_legacy_provenance_loads_root_and_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp).resolve()
            workspace = project / "legacy"
            workspace.mkdir()
            (workspace / "plan.json").write_text("{}", encoding="utf-8")
            artifacts = workspace / "artifacts"
            artifacts.mkdir()
            root_event = {
                "timestamp": "2026-01-01T00:00:00+00:00",
                "event_type": "plan_created",
            }
            artifact_event = {
                "timestamp": "2026-01-02T00:00:00+00:00",
                "event_type": "report_generated",
            }
            (workspace / "provenance.jsonl").write_text(
                json.dumps(root_event) + "\n", encoding="utf-8"
            )
            (artifacts / "provenance.jsonl").write_text(
                json.dumps(artifact_event) + "\n", encoding="utf-8"
            )

            events = load_events(workspace)

            self.assertEqual(
                [event["event_type"] for event in events],
                ["plan_created", "report_generated"],
            )

    def test_new_workspace_containing_project_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp).resolve()
            with self.assertRaisesRegex(ValueError, "separate child workspace"):
                ResearchLayout.resolve(project, project)

            (project / "plan.json").write_text("{}", encoding="utf-8")
            legacy = ResearchLayout.resolve(project, project)
            self.assertTrue(legacy.legacy)

    def test_new_workspace_named_artifacts_keeps_provenance_anchor(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp).resolve()
            with chdir(project):
                layout = ResearchLayout.resolve("artifacts", project)
                log_event(layout.workspace, "report_generated")

                self.assertTrue(layout.provenance_path.exists())
                self.assertEqual(len(load_events(layout.workspace)), 1)
            run_parent = project / ".omagents" / "deep-research"
            self.assertEqual(len(list(run_parent.iterdir())), 1)

    def test_legacy_workspace_named_artifacts_keeps_provenance_anchor(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp).resolve()
            workspace = project / "artifacts"
            workspace.mkdir()
            (workspace / "plan.json").write_text("{}", encoding="utf-8")
            layout = ResearchLayout.resolve(workspace, project)
            self.assertTrue(layout.legacy)

            log_event(workspace, "report_generated")

            self.assertTrue((workspace / "artifacts" / "provenance.jsonl").exists())
            self.assertFalse((project / ".omagents" / "deep-research").exists())

    def test_windows_command_arg_uses_powershell_quoting(self):
        value = "R&D 100% O'Brien"
        expected = "'R&D 100% O''Brien'"
        with patch.object(deep_research.os, "name", "nt"):
            self.assertEqual(deep_research.command_arg(value), expected)
        with patch.object(orchestrate.os, "name", "nt"):
            self.assertEqual(orchestrate.command_arg(value), expected)


if __name__ == "__main__":
    unittest.main()
