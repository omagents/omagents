---
name: agents-python-tools
description: "Route agent Python tooling to a dedicated venv at ~/.venvs/omagents, separate from any project's Python environment. Use whenever the agent needs to install or run a Python tool/library to complete a task — e.g. openpyxl to generate Excel, pdf2md/pdfplumber to convert PDFs to Markdown, Pillow to generate images, qrcode, reportlab, or any pip-installable utility. Also use when deciding where a Python dependency belongs or when installing the current project's own dependencies into its OmAgents project overlay."
---

# Agent Python Tools

Use a persistent base for agent tools and an isolated project overlay for project dependencies:

| Purpose | Venv location | Used by |
|---|---|---|
| Agent tools (openpyxl, Pillow, pdfplumber, reportlab, qrcode, ...) | `~/.venvs/omagents` | Agent, for any task |
| Current project's declared dependencies | `<project-root>/.omagents/venv` | Project / developer |

## Rule: Agent tools go in ~/.venvs/omagents

Install every Python tool the agent itself needs into the persistent base. Never install these into a project venv or system Python. Existing base environments are reused, never automatically deleted.

Create base only if its interpreter is missing:

```bash
python3 -m venv ~/.venvs/omagents
```

Check before installing, then use base Python explicitly:

```bash
~/.venvs/omagents/bin/python -c "import openpyxl; ..."
~/.venvs/omagents/bin/python -m pip install <package>
```

Use the absolute base interpreter or base console script so an active project venv cannot redirect the command. Do not install agent tools into a project venv, system Python, or `pipx`.

## Rule: Project dependencies go in .omagents/venv

Create the project environment only when a project dependency is needed. An existing project `.venv` is left untouched.

The CLI is at `<omagents-root>/hooks/project-venv.js` (`${PLUGIN_ROOT}` is the root for Codex):

```bash
# Create or reuse the project environment and base overlay
node <omagents-root>/hooks/project-venv.js ensure --root <project-root>

# Install project-declared dependencies locally
node <omagents-root>/hooks/project-venv.js pip --root <project-root> -- install -r requirements.txt
node <omagents-root>/hooks/project-venv.js pip --root <project-root> -- install -e .

# Run with project packages first, then base tool packages
node <omagents-root>/hooks/project-venv.js run --root <project-root> -- script.py
```

Project dependencies declared in `pyproject.toml`, `requirements.txt`, or equivalent files must be installed locally **even when base already contains the same package**. Base is only a tool overlay, not a source of undeclared project dependencies.

**Do not run pip directly in a project overlay.** `project-venv.js pip` sets `OMAGENTS_PROJECT_ONLY=1`, which disables the base overlay so pip cannot mistake base packages for project-local installations. Normal `run` removes that variable and enables base imports.

The overlay shares Python imports, not console scripts. Invoke base tools from base `bin/Scripts`; project packages always override same-named base packages.

## How to decide which environment to use

1. Needed for the project to build/run/test or declared by the project → project `.omagents/venv` via `project-venv.js pip`.
2. Used by the agent to scrape, convert, or generate an artifact → base.
3. Both roles apply → manage both environments independently; the project dependency remains local.
4. Project build, test, release, and CI configuration must still declare its complete dependencies.

## Cross-Platform Paths

| OS | Base Python | Project Python | Console scripts |
|---|---|---|---|
| macOS / Linux | `~/.venvs/omagents/bin/python` | `.omagents/venv/bin/python` | `bin/<script>` |
| Windows | `~/.venvs/omagents/Scripts/python.exe` | `.omagents/venv/Scripts/python.exe` | `Scripts/<script>.exe` |

Use `<python> -m pip` rather than a pip launcher. Node CLI commands work unchanged on all platforms; only direct interpreter paths differ.

## Keeping environments healthy

- Check base packages: `~/.venvs/omagents/bin/python -m pip list`.
- If a tool is missing, install only that tool; base persists across sessions.
- If base or project Python is broken, do not auto-delete it. Report the problem and repair explicitly.
- Project and base Python `majorMinor` must match, especially for native extensions.
- If a system dependency is missing, use the platform package manager; do not fall back to system Python.

## Package provisioning

The plugin auto-installs `jinja2` on first session (used by deep-research report templates). Other tools (markitdown, playwright, Office libraries, etc.) are installed on-demand by their respective skills when first needed. They are not eagerly pre-installed.
