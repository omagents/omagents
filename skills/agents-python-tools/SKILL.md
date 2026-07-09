---
name: agents-python-tools
description: "Route agent Python tooling to a dedicated venv at ~/.venvs/omagents, separate from any project's Python environment. Use whenever the agent needs to install or run a Python tool/library to complete a task — e.g. openpyxl to generate Excel, pdf2md/pdfplumber to convert PDFs to Markdown, Pillow to generate images, qrcode, reportlab, or any pip-installable utility. Also use when deciding where a Python dependency belongs: agent's own tools vs. the current project's dependencies. Do NOT use for installing the project's own dependencies (those go in the project venv)."
---

# Agent Python Tools

Two Python environments, never mixed:

| Purpose | Venv location | Activated by |
|---|---|---|
| Agent's own tools (openpyxl, Pillow, pdfplumber, reportlab, qrcode, pandoc, ...) | `~/.venvs/omagents` | Agent, for any task |
| The current project's dependencies | `<project-root>/.venv` | The project / developer |

## Rule: Agent tools go in ~/.venvs/omagents

Install every Python tool the agent itself needs into `~/.venvs/omagents`. Never install these into the project venv or the system Python.

If `~/.venvs/omagents` does not exist yet, create it automatically — do not ask the user for permission, this is an expected one-time setup:

```bash
python3 -m venv ~/.venvs/omagents
```

Install a tool:

```bash
~/.venvs/omagents/bin/pip install <package>
```

Run a tool — always invoke the interpreter or entry point from the venv so the import resolves there:

```bash
~/.venvs/omagents/bin/python -c "import openpyxl; ..."
# or, for console scripts:
~/.venvs/omagents/bin/<script> ...
```

Prefer the absolute venv path (`~/.venvs/omagents/bin/...`) over `source activate`, so the project's own `.venv` (if active) is not shadowed or polluted.

Do not install agent tools into:
- the project's `.venv`
- the system / apt Python
- `pipx` (it creates per-tool venvs; keep agent tools together in one venv for reuse)

## Rule: Project dependencies go in <project-root>/.venv

When the task is to install or run the current project's own dependencies (from `requirements.txt`, `pyproject.toml`, etc.), use the project venv at `<project-root>/.venv`, not `~/.venvs/omagents`.

- If `<project-root>/.venv` does not exist, create it automatically without asking: `python3 -m venv .venv`
- Install into it: `.venv/bin/pip install -e .` or `.venv/bin/pip install -r requirements.txt`
- Run the project with `.venv/bin/python ...`

## How to decide which environment to use

1. Is the package needed for the project to build/run/test (declared in `pyproject.toml` / `requirements.txt`)? → project `.venv`.
2. Is the package a utility the agent uses to produce an artifact for the user (generate an Excel, convert a PDF, render an image, scrape a page)? → `~/.venvs/omagents`.
3. If both apply, install it in BOTH environments independently. Never share or symlink between them.

## Cross-Platform Paths

Venv executable paths differ by OS. All commands in this skill use the Unix path (`bin/`). On Windows, substitute as follows:

| OS | Python | pip | Console scripts |
|----|--------|-----|-----------------|
| macOS / Linux | `~/.venvs/omagents/bin/python` | `~/.venvs/omagents/bin/pip` | `~/.venvs/omagents/bin/<script>` |
| Windows | `~/.venvs/omagents/Scripts/python.exe` | `~/.venvs/omagents/Scripts/pip.exe` | `~/.venvs/omagents/Scripts/<script>.exe` |

The same applies to project venvs: `.venv/bin/` on Unix, `.venv/Scripts/` on Windows.

## Keeping ~/.venvs/omagents healthy

- Check what's installed: `~/.venvs/omagents/bin/pip list`
- If a tool is missing, just install it; the venv persists across sessions.
- If an install fails on a system dependency, install the OS-level dev package separately — do not fall back to the system Python. Use the platform's package manager (`apt-get` on Debian/Ubuntu, `brew` on macOS, `choco` or `scoop` on Windows).

## Included tools

The following tools are pre-installed in `~/.venvs/omagents`:

| Tool | Purpose |
|------|---------|
| markitdown | Convert documents (PDF/DOCX/XLSX/...) to Markdown |
| python-docx | Create/edit Word documents |
| playwright | Web scraping with headless browser |
| pandoc | Universal document format converter (md↔docx, md↔pdf, ...) |
