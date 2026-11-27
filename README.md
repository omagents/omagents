# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)
[![npm version](https://img.shields.io/npm/v/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![npm downloads](https://img.shields.io/npm/dm/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![GitHub stars](https://img.shields.io/github/stars/omagents/omagents?style=social)](https://github.com/omagents/omagents/stargazers)

[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Türkçe](README.tr.md)

OmAgents is a multi-host agent toolkit for **OpenCode**, **Codex**, and **DeepSeek Harness (DSH)**. It bundles 19 OmAgents skills, 15 Superpowers skills, MCP servers, native background-agent integration, deep research, and Python tooling. A shared Core package keeps state and host-neutral behavior consistent.

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

Restart the host after installation. `@omagents/core` is installed automatically as a dependency; **do not install it separately as a plugin**. The current release candidate aligns all four packages at **0.17.1**.

Python 3.11+ must be available on PATH for Python-backed skills. DSH requires Node.js 24.9 or newer and a DSH version in the package's tested compatibility range.

### Search Providers and Optional API Keys

```bash
export OMAGENTS_SEARCH_PROVIDER="auto"  # default; use "exa", "keenable", or "youcom" for a direct-only provider
export EXA_API_KEY="your-exa-key"
export KEENABLE_API_KEY="your-keenable-key"  # optional
export YDC_API_KEY="your-youcom-key"  # optional
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

- **`OMAGENTS_SEARCH_PROVIDER`**: supports `auto`, `exa`, `keenable`, and `youcom`; `auto` is the default when unset or empty. Credentials never switch the provider, and unsupported values fail explicitly.
- **`EXA_API_KEY`**: authenticates hosted Exa through `x-api-key`; without it, the same endpoint works anonymously. This applies to the automatic Proxy and to explicit direct Exa registration.
- **`KEENABLE_API_KEY`**: optional for automatic fallback and explicit `keenable`. With a key, Keenable uses `https://api.keenable.ai/mcp` through `X-API-Key`; without one, it uses the keyless `https://api.keenable.ai/mcp-public`. The public tier allows 1,000 requests/hour and 10 requests/second per IP and logs search queries or fetched URLs and prompts, plus IP, user agent, and `X-Keenable-Title`. For Codex, a configured key is written to `.mcp.json` like Exa's.
- **`YDC_API_KEY`**: optional for automatic fallback and explicit `youcom`, whose direct registration is named `youdotcom`. With a key, You.com uses `https://api.you.com/mcp` through `Authorization: Bearer <YDC_API_KEY>`; without one, it uses keyless `https://api.you.com/mcp/free` with no Authorization header or OAuth flow. The [official You.com MCP documentation](https://you.com/docs/agents/mcp-server#choose-your-setup) advertises **100 queries/day** for the keyless endpoint. Keyless means no account credential, not anonymous network traffic or an absence of provider logging.
- **`CONTEXT7_API_KEY`**: optional rate-limit credentials for the local `@upstash/context7-mcp` server.
- **`GITHUB_TOKEN`**: enables the GitHub Copilot MCP. Without it, OmAgents uses `mcp.grep.app` for public code search.

In `auto`, one local `websearch` Search MCP Proxy initially follows **Exa → Keenable → You.com**: it tries Exa first and makes at most one Keenable attempt after a fallback-eligible Exa failure, then at most one You.com attempt after a fallback-eligible Keenable failure. After a fallback-eligible Exa failure, the same Proxy process uses **Keenable → You.com → Exa** for every later call, including calls from other sessions sharing that process. Recreating the Proxy (normally by restarting the host service) restores the initial order; this state is memory-only and has no cooldown. Successful empty results, authentication or permission failures, invalid parameters, explicit non-retryable failures, and caller cancellation never fall back or change the order. Each provider receives at most one attempt per call, bounded at 30 seconds per backend attempt, including lazy initialization and the tool call. A full three-attempt call therefore has an approximate 90-second backend upper bound, excluding small local processing time.

The Proxy exposes generic `search` and `fetch` tools; `fetch` accepts exactly one `http` or `https` URL. OpenCode names them `websearch_search` and `websearch_fetch`; Codex and DSH name them `mcp__websearch__search` and `mcp__websearch__fetch`. Explicit `exa`, `keenable`, and `youcom` retain their direct registrations and native provider tool names; direct You.com uses `youdotcom` with `you-search` and `you-extract`.

On a You.com attempt, generic search maps to `you-search`: it forwards `query` unchanged and maps `maxResults` to `count` (default 10, range 1–50). Generic fetch passes only `url` to `you-extract`, using the common keyed/keyless subset. You.com has no direct equivalent for `objective` or `maxCharacters`; the Proxy omits them only for that attempt, without local query rewriting or response truncation. Exa and Keenable success metadata remains unchanged. A You.com success after two eligible failures reports `provider: "youcom"`, retains `fallback` for the first failure, and adds ordered `fallbacks` metadata plus one readable `Fallback` line per prior eligible failure.

**Built-in OpenCode websearch:** OpenCode 2.x also ships its own `websearch` tool, whose name is close to the Proxy's `websearch_search` and `websearch_fetch`; agents can pick the wrong one, and the built-in tool has no OmAgents failover. The installer therefore writes `"websearch": false` into the resolved `opencode.json` whenever that key is absent, removing the built-in tool so the Proxy's routed tools are the only websearch. An explicit `websearch` value is never overwritten, `--keep-websearch` skips this default, and deleting the key (or setting it back yourself) restores the built-in tool after a restart. OpenCode 1.x has no built-in websearch tool, so the setting is inert there. OpenCode's `webfetch` is unaffected.

**Privacy and opt-out:** automatic fallback can disclose the same search query, optional objective, or target URL to Exa, Keenable, and You.com. In particular, a fallback-eligible Exa failure can send the same search query or URL to Keenable, including its public-tier logging when no Keenable key is configured; an eligible Keenable failure can then send the query or URL to You.com. You.com does not receive `objective` as a native argument, but earlier providers may have received it. Select explicit `exa` to retain direct Exa behavior and prevent automatic fallback; explicit `keenable` and `youcom` are also single-provider opt-outs that bypass the Proxy. Only calls through the built-in Proxy have this failover guarantee: native host web tools are outside it (the plugin cannot disable them at runtime; for OpenCode, the installer instead removes the built-in `websearch` tool from the toolset as described above), and a user-defined `websearch` or `youdotcom` MCP remains user-owned, takes precedence, and is not wrapped.

**Codex install timing:** Codex snapshots provider and credential configuration when the installer runs. Set the environment before installation. After changing the provider or keys, including `YDC_API_KEY`, rerun the installer—for example, `OMAGENTS_SEARCH_PROVIDER="keenable" npx @omagents/omagents-codex`—then restart Codex with that environment. Reinstallation refreshes the copied Proxy and replaces stale provider entries and credentials.

For Codex, Bearer environment indirection is scoped by MCP server owner: `github` uses `bearer_token_env_var = "GITHUB_TOKEN"`, while direct `youdotcom` uses `bearer_token_env_var = "YDC_API_KEY"` instead of serializing the Bearer secret. For the automatic local Proxy, configured `YDC_API_KEY` remains a stdio `env` value in `.mcp.json`. The Codex plugin `.mcp.json` contract has no equivalent indirection for Exa's `x-api-key`, Keenable's `X-API-Key`, or Context7's stdio `env`, so configured Exa, Keenable, and Context7 values are written to that file. On platforms that honor POSIX modes, the installer creates private directories with mode `0700` and writes or rewrites `.mcp.json` with mode `0600`.

## Support Matrix

| Host or role | Package | Installation | Skills | Background execution and recovery | Management surface |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenCode 1.x and OpenCode 2.x** | `@omagents/omagents` | `npx @omagents/omagents` | **34**: 19 OmAgents + 15 Superpowers | V1 uses `task(background: true)`; V2 uses native `subagent(...)`, which is always background. Durable Core Job Board, completion delivery, and recovery. | `/ps`, `parallel_status`, `cancel_task`, parent-context results, and OpenCode TUI state |
| **Codex** | `@omagents/omagents-codex` | `npx @omagents/omagents-codex` | **34**: 19 OmAgents + 15 Superpowers | Codex-native subagents. The OpenCode parallel engine and DSH Web Job Board are not installed. | Codex-native interface and skills |
| **DeepSeek Harness (DSH)** | `@omagents/omagents-dsh` | `dsh plugin --profile web add @omagents/omagents-dsh` | **34**: 19 OmAgents + 15 Superpowers | Native asynchronous `subagent` lifecycle, durable `job-board.json`, cancellation, recovery, `/ps`, `parallel_status`, and `cancel_task` | Authorized Remote `watchJobs` stream plus a native React Web Job Board |
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
| **Built-in MCPs** | agentmemory, codegraph, context7, websearch/keenable/youdotcom, and github/grep_app |
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

The 19 OmAgents skills are:

`deep-research`, `parallel-execution`, `privilege-escalation`, `agents-python-tools`, `markitdown-converter`, `officecli`, `playwright-web-scraping`, `init-deep`, `doctor`, `remove-ai-slops`, `remove-deadcode`, `github-triage`, `tech-debt-audit`, `lsp-guide`, `ast-grep`, `work-with-pr`, `pre-publish-review`, `hyperplan`, and `refactor`.

Superpowers contributes 15 additional process skills. Core renders shared skills for `opencode-v1`, `opencode-v2`, `codex`, and `dsh`, using complete host-specific overrides where control flow differs. For Superpowers skills, every `docs/superpowers` documentation root is rendered as `docs`, preserving all following directories (for example, `docs/specs/` and `docs/plans/`). Existing documents are not migrated automatically. OpenCode V2 and DSH use native `subagent` semantics without a `background` argument.

| MCP | Type | Behavior |
| :--- | :--- | :--- |
| `agentmemory` | Local | Session memory and audit |
| `codegraph` | Local | Codebase symbol graph and exploration |
| `context7` | Local | Documentation search through `@upstash/context7-mcp` |
| `websearch` | Local in `auto`; remote in explicit `exa` | Automatic `Exa → Keenable → You.com` Proxy, or direct hosted Exa anonymously/authenticated with `EXA_API_KEY` |
| `keenable` | Remote | With the `keenable` provider, keyed private MCP or the keyless public endpoint |
| `youdotcom` | Remote | With the `youcom` provider, keyed `https://api.you.com/mcp` or keyless `https://api.you.com/mcp/free` |
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
