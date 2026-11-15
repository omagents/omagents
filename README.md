# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)
[![npm version](https://img.shields.io/npm/v/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![npm downloads](https://img.shields.io/npm/dm/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![GitHub stars](https://img.shields.io/github/stars/omagents/omagents?style=social)](https://github.com/omagents/omagents/stargazers)

[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

OmAgents is a multi-host agent toolkit for **OpenCode**, **Codex**, and **DeepSeek Harness (DSH)**. It bundles 18 OmAgents skills, 15 Superpowers skills, MCP servers, native background-agent integration, deep research, and Python tooling. A shared Core package keeps state and host-neutral behavior consistent.

---

## Installation

Choose the package for your host. The installer takes no host positional argument.

```bash
# OpenCode
npx @omagents/omagents

# Codex
npx @omagents/omagents-codex

# DeepSeek Harness
dsh plugin --profile web add @omagents/omagents-dsh
```

Restart the host after installation. `@omagents/core` is installed automatically as a dependency; **do not install it separately as a plugin**. The current release candidate aligns all four packages at **0.14.0**.

Python 3.11+ must be available on PATH for Python-backed skills. DSH requires Node.js 24.9 or newer and a DSH version in the package's tested compatibility range.

### Optional API Keys

```bash
export EXA_API_KEY="your-exa-key"
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

- **`EXA_API_KEY`**: authenticates the hosted Exa `websearch` MCP through `x-api-key`; without it, the same endpoint works anonymously.
- **`CONTEXT7_API_KEY`**: optional rate-limit credentials for the local `@upstash/context7-mcp` server.
- **`GITHUB_TOKEN`**: enables the GitHub Copilot MCP. Without it, OmAgents uses `mcp.grep.app` for public code search.

For Codex, GitHub authentication is stored as the `GITHUB_TOKEN` environment-variable reference (`bearer_token_env_var`), not the token value. The Codex plugin `.mcp.json` contract has no equivalent indirection for Exa's `x-api-key` or Context7's stdio `env`, so configured Exa and Context7 values are written to that file. On platforms that honor POSIX modes, the installer creates private directories with mode `0700` and writes or rewrites `.mcp.json` with mode `0600`.

## Support Matrix

| Host or role | Package | Installation | Skills | Background execution and recovery | Management surface |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenCode 1.x and OpenCode 2.x** | `@omagents/omagents` | `npx @omagents/omagents` | **33**: 18 OmAgents + 15 Superpowers | V1 uses `task(background: true)`; V2 uses native `subagent(..., background: true)`. Durable Core Job Board, completion delivery, and recovery. | `/ps`, `parallel_status`, `cancel_task`, parent-context results, and OpenCode TUI state |
| **Codex** | `@omagents/omagents-codex` | `npx @omagents/omagents-codex` | **33**: 18 OmAgents + 15 Superpowers | Codex-native subagents. The OpenCode parallel engine and DSH Web Job Board are not installed. | Codex-native interface and skills |
| **DeepSeek Harness (DSH)** | `@omagents/omagents-dsh` | `dsh plugin --profile web add @omagents/omagents-dsh` | **33**: 18 OmAgents + 15 Superpowers | Native asynchronous `subagent` lifecycle, durable `job-board.json`, cancellation, recovery, `/ps`, `parallel_status`, and `cancel_task` | Authorized Remote `watchJobs` stream plus a native React Web Job Board |
| **Shared library, not a host plugin** | `@omagents/core` | Automatic dependency; no separate user install | Shared skill definitions and Superpowers assets | Host-neutral execution state, persistence, MCP resolution, research assets, and Python environments | No standalone UI |

All host packages depend only on the aligned Core version, never on another host package.

## Highlights

| Feature | What it provides |
| :--- | :--- |
| **Loop Engineering** | Durable task queues, retries, verification, and resumable state for iterative skills |
| **Superpowers** | Brainstorming, TDD, systematic debugging, plans, code review, worktrees, and verification |
| **Deep Research** | Multi-source items × fields research, gap detection, durable evidence, and Jinja2 reports |
| **Parallel Execution** | Host-native background agents with a shared Core execution model on OpenCode and DSH |
| **DSH Web Job Board** | Native React filters, details, notification state, confirmed cancellation, reconnect, and health displays |
| **Built-in MCPs** | agentmemory, codegraph, context7, websearch, and github/grep_app |
| **Python Tooling** | Persistent agent base and on-demand project overlays without modifying an existing project `.venv` |
| **Document and Web Tools** | MarkItDown conversion, OfficeCLI documents, and Playwright scraping |
| **Code Intelligence** | LSP guidance and AST-aware search/rewrite with grep fallback |
| **Hyperplan and Refactor** | Three-critic adversarial planning and verified iterative refactoring |

## Python Environments

Only `jinja2` is automatically provisioned in the persistent agent base. Optional Python tools such as MarkItDown and Playwright are installed **on demand** when their skills need them; they are not part of automatic setup. Project dependencies use an on-demand overlay and never require modifying an existing project `.venv`.

Use the `agents-python-tools` skill for environment selection, cross-platform paths, and CLI instructions. Project commands are implemented by `packages/core/hooks/project-venv.js` in this repository. Neither the base nor a project environment is automatically deleted.

## Loop Engineering and Deep Research

Loop-based skills process one item at a time and persist state in `.omagents/loops/<skill>/tasks.json`. Failed tasks retry up to three times before becoming blocked. State survives context clearing so the workflow can resume instead of restarting.

Deep Research uses `--workspace <dir>` only for public deliverables. Plans, raw findings, checkpoints, derived artifacts, provenance, and run-scoped queues live under `.omagents/deep-research/<run-id>/`. New runs reject a workspace that would contain that internal state; legacy workspaces remain readable and resumable without automatic migration. Jinja2 templates live in `packages/core/skills/deep-research/templates/`; there is no root-level `templates/` directory.

## Skills and MCP Servers

The 18 OmAgents skills are:

`deep-research`, `parallel-execution`, `agents-python-tools`, `markitdown-converter`, `officecli`, `playwright-web-scraping`, `init-deep`, `doctor`, `remove-ai-slops`, `remove-deadcode`, `github-triage`, `tech-debt-audit`, `lsp-guide`, `ast-grep`, `work-with-pr`, `pre-publish-review`, `hyperplan`, and `refactor`.

Superpowers contributes 15 additional process skills. Core renders shared skills for `opencode-v1`, `opencode-v2`, `codex`, and `dsh`, using complete host-specific overrides where control flow differs. DSH uses native `subagent` semantics without an OpenCode `background` argument.

| MCP | Type | Behavior |
| :--- | :--- | :--- |
| `agentmemory` | Local | Session memory and audit |
| `codegraph` | Local | Codebase symbol graph and exploration |
| `context7` | Local | Documentation search through `@upstash/context7-mcp` |
| `websearch` | Remote | Hosted Exa MCP, anonymous or authenticated with `EXA_API_KEY` |
| `github` / `grep_app` | Remote | GitHub Copilot MCP with a token; otherwise public code search through `mcp.grep.app` |

User-defined MCP configuration takes precedence over built-in registrations.

## DSH Job Board Behavior

The DSH package installs a complete Host and Web Client, not a skills-only plugin. The Web Job Board consumes revisioned whole-set Remote frames, starts with a fresh baseline after reconnect, and does not poll running jobs. It provides all/running/attention/finished filters, result and error details, notification state, cancellation confirmation, stale/permission/degraded views, and DSH theme integration.

Cancellation acceptance is not confirmed termination. Local interruption stops the child's **current turn**, and its **descendants continue** unless cancelled separately. **External one-shot** runs stop permanently and **cannot resume**. Viewing details in the UI never acknowledges a model notification.

On restart, DSH reconciles persisted jobs against authoritative host state. Missing or unreadable outcomes become `interrupted` only when **no active run is authoritatively observable**, never fabricated successes. An observed **active external** run remains active on a **cold session-not-found** instead of being misclassified as interrupted. Remote access is limited by the active DSH profile and authorized parent-session scope. See the [DSH package guide](packages/dsh/README.md) and [Job Board guide](packages/dsh/docs/job-board.md) for UI, cancellation, recovery, authorization, security, and troubleshooting details.

## Architecture

```text
┌─────────────────────────────────────────────────┐
│ User choice layer (not bundled)                 │
│ OpenSpec · gstack · custom workflows · none     │
├─────────────────────────────────────────────────┤
│ Process skills layer (bundled Superpowers)      │
├─────────────────────────────────────────────────┤
│ OmAgents infrastructure and shared Core         │
│ Skills · MCP · Job Board · research · Python    │
├─────────────────────────────────────────────────┤
│ OpenCode · Codex · DeepSeek Harness             │
└─────────────────────────────────────────────────┘
```

OmAgents supplies infrastructure, not a mandatory development methodology. Superpowers supplies reusable process skills. Methodologies such as OpenSpec and gstack remain separate user choices.

## Development

The repository is a private npm-workspaces root containing `packages/core`, `packages/opencode`, `packages/codex`, and `packages/dsh`. The repository `.opencode/plugins/index.js` is only a development re-export; product code lives in the packages. Deep-research templates remain under `packages/core/skills/deep-research/templates/`.

```bash
# All root and workspace tests
npm test

# Build and test DSH
npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh

# Packed-artifact and browser verification
npm run pack:all
npm run test:packed
npm run test:browser
```

Every release must use one aligned version and **build, test, pack, and publish all four packages together**, in this deterministic order:

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

Core is published first because every host depends on it. The hosts are sequential only for deterministic logs and failure handling; there are no host-to-host dependencies. See [CONTRIBUTING.md](CONTRIBUTING.md) for verification requirements and the current platform/browser confirmation scope.

## Uninstallation

Use the selected host's plugin management to remove or disable its OmAgents package. For DSH, disabling the bare `@omagents/omagents-dsh` Loader row disables both the Host and its Web Client. Core remains only as a dependency of an installed host. Python environments are not automatically deleted.

## License

MIT — see [LICENSE](LICENSE).
