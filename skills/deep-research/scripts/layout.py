"""Canonical filesystem layout for deep-research runs."""
from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path


class LayoutError(ValueError):
    """Raised when public and internal storage would overlap."""


@dataclass(frozen=True)
class ResearchLayout:
    """Resolved public and internal paths for one research workspace."""

    project_root: Path
    workspace: Path
    run_id: str
    run_dir: Path
    storage_dir: Path
    legacy: bool

    @classmethod
    def resolve(
        cls,
        workspace: str | Path,
        project_root: str | Path | None = None,
    ) -> "ResearchLayout":
        root = Path(project_root) if project_root is not None else Path.cwd()
        root = root.resolve()
        workspace_path = Path(workspace)
        if not workspace_path.is_absolute():
            workspace_path = root / workspace_path
        workspace_path = workspace_path.resolve()

        run_id = _run_id(workspace_path, root)
        run_dir = root / ".omagents" / "deep-research" / run_id
        new_markers = (
            run_dir / "plan.json",
            run_dir / "state" / "orchestration_state.json",
            run_dir / "state" / "pre_research_state.json",
        )
        legacy_markers = (
            workspace_path / "plan.json",
            workspace_path / "orchestration_state.json",
            workspace_path / "pre_research_state.json",
        )
        if any(path.exists() for path in new_markers):
            legacy = False
        else:
            legacy = any(path.exists() for path in legacy_markers)

        if not legacy:
            loop_dir = root / ".omagents" / "loops"
            if run_dir.is_relative_to(workspace_path) or loop_dir.is_relative_to(workspace_path):
                raise LayoutError(
                    f"Public workspace {workspace_path} would contain internal "
                    "run or loop storage; select a separate child workspace "
                    "(for example, --workspace research/topic)."
                )

        return cls(
            project_root=root,
            workspace=workspace_path,
            run_id=run_id,
            run_dir=run_dir,
            storage_dir=workspace_path if legacy else run_dir,
            legacy=legacy,
        )

    @property
    def plan_path(self) -> Path:
        return self.storage_dir / "plan.json"

    @property
    def pre_research_path(self) -> Path:
        return self.storage_dir / "pre_research.json"

    @property
    def curated_pre_research_path(self) -> Path:
        return self.storage_dir / "pre_research_curated.json"

    @property
    def pre_research_state_path(self) -> Path:
        if self.legacy:
            return self.storage_dir / "pre_research_state.json"
        return self.storage_dir / "state" / "pre_research_state.json"

    @property
    def orchestration_state_path(self) -> Path:
        if self.legacy:
            return self.storage_dir / "orchestration_state.json"
        return self.storage_dir / "state" / "orchestration_state.json"

    @property
    def pre_findings_dir(self) -> Path:
        return self.storage_dir / "pre_findings"

    @property
    def findings_dir(self) -> Path:
        return self.storage_dir / "findings"

    @property
    def artifacts_dir(self) -> Path:
        return self.storage_dir / "artifacts"

    @property
    def merged_path(self) -> Path:
        return self.artifacts_dir / "findings_merged.json"

    @property
    def gap_path(self) -> Path:
        return self.artifacts_dir / "gap_report.json"

    @property
    def audit_path(self) -> Path:
        return self.artifacts_dir / "audit_report.json"

    @property
    def raw_report_path(self) -> Path:
        return self.artifacts_dir / "report_raw.md"

    @property
    def package_path(self) -> Path:
        return self.artifacts_dir / "package.json"

    @property
    def provenance_path(self) -> Path:
        if self.legacy:
            return self.artifacts_dir / "provenance.jsonl"
        return self.storage_dir / "logs" / "provenance.jsonl"

    @property
    def report_path(self) -> Path:
        return self.workspace / "report.md"

    @property
    def summary_path(self) -> Path:
        return self.workspace / "summary.md"

    @property
    def readme_path(self) -> Path:
        if self.legacy:
            return self.artifacts_dir / "README.md"
        return self.workspace / "README.md"

    def loop_skill(self, pre: bool = False) -> str:
        base = "deep-research-pre" if pre else "deep-research"
        if self.legacy:
            return base
        return f"{base}-{self.run_id}"

    def display_path(self, path: Path) -> str:
        resolved = path.resolve()
        try:
            return resolved.relative_to(self.project_root).as_posix()
        except ValueError:
            return str(resolved)


def internal_run_root(anchor: str | Path) -> Path | None:
    """Return the internal run root containing anchor, if it has one."""
    resolved = Path(anchor).resolve()
    for candidate in (resolved, *resolved.parents):
        if (
            candidate.parent.name == "deep-research"
            and candidate.parent.parent.name == ".omagents"
        ):
            return candidate
    return None


def _run_id(workspace: Path, project_root: Path) -> str:
    try:
        identity = workspace.relative_to(project_root).as_posix()
    except ValueError:
        identity = str(workspace)

    slug = _slug(workspace.name)
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:8]
    return f"{slug}-{digest}"


def _slug(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    )
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")
    return slug or "research"
