# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)
[![npm version](https://img.shields.io/npm/v/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![npm downloads](https://img.shields.io/npm/dm/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![GitHub stars](https://img.shields.io/github/stars/omagents/omagents?style=social)](https://github.com/omagents/omagents/stargazers)

[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

OmAgents 是面向 **OpenCode**、**Codex** 和 **DeepSeek Harness (DSH)** 的多宿主 agent 工具包。它打包了 18 个 OmAgents skills、15 个 Superpowers skills、MCP servers、原生后台 agent 集成、深度研究和 Python 工具链；共享的 Core 包负责统一状态及宿主无关行为。

---

## 安装

请选择与你的宿主对应的软件包。安装器不接受宿主位置参数。

```bash
# OpenCode
npx @omagents/omagents

# Codex
npx @omagents/omagents-codex

# DeepSeek Harness
dsh plugin --profile web add @omagents/omagents-dsh
```

安装后重启宿主。`@omagents/core` 会作为依赖自动安装；**不要将它作为 plugin 单独安装**。当前发布候选版本将四个软件包统一为 **0.16.0**。

Python 驱动的 skills 要求 PATH 中可使用 Python 3.11+。DSH 要求 Node.js 24.9 或更高版本，并要求 DSH 版本位于软件包声明的已测试兼容范围内。

### 搜索 Provider 与可选 API Keys

```bash
export OMAGENTS_SEARCH_PROVIDER="auto"  # 默认；使用 "exa"、"keenable" 或 "youcom" 可仅直连一个 provider
export EXA_API_KEY="your-exa-key"
export KEENABLE_API_KEY="your-keenable-key"  # 可选
export YDC_API_KEY="your-youcom-key"  # 可选
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

- **`OMAGENTS_SEARCH_PROVIDER`**：支持 `auto`、`exa`、`keenable` 和 `youcom`；`auto` 是未设置或为空时默认值。凭据不会切换 provider，不支持的值会明确报错。
- **`EXA_API_KEY`**：通过 `x-api-key` 为托管 Exa 鉴权；未设置时，同一端点可匿名使用。此行为同时适用于自动 Proxy 和显式直连 Exa 注册。
- **`KEENABLE_API_KEY`**：自动回退和显式 `keenable` 均可选。设置后通过 `X-API-Key` 使用 `https://api.keenable.ai/mcp`；未设置时使用免密钥的 `https://api.keenable.ai/mcp-public`。公共层按 IP 限制为每小时 1,000 次请求和每秒 10 次请求，并记录搜索查询或抓取的 URL 和 prompt，以及 IP、User-Agent 和 `X-Keenable-Title`。对于 Codex，已配置的密钥会像 Exa 的一样写入 `.mcp.json`。
- **`YDC_API_KEY`**：自动回退和显式 `youcom` 均可选，显式直连注册名为 `youdotcom`。设置后通过 `Authorization: Bearer <YDC_API_KEY>` 使用 `https://api.you.com/mcp`；未设置时使用免密钥的 `https://api.you.com/mcp/free`，不发送 Authorization header，也不需要 OAuth 流程。官方 [You.com MCP 文档](https://you.com/docs/agents/mcp-server#choose-your-setup)说明免密钥端点限额为每天 100 次查询。免密钥表示不需要账户凭据，并不表示网络流量匿名或 provider 不记录日志。
- **`CONTEXT7_API_KEY`**：本地 `@upstash/context7-mcp` server 的可选速率限制凭据。
- **`GITHUB_TOKEN`**：启用 GitHub Copilot MCP。未设置时，OmAgents 使用 `mcp.grep.app` 搜索公开代码。

在 `auto` 下，一个本地 `websearch` Search MCP Proxy 初始按 **Exa → Keenable → You.com** 顺序调用：先调用 Exa，并且只在出现符合回退条件的 Exa 失败后最多尝试一次 Keenable，随后只在出现符合回退条件的 Keenable 失败后最多尝试一次 You.com。一旦出现符合回退条件的 Exa 失败，同一 Proxy 进程此后的所有调用（包括共享该进程的其他 session）都改为 **Keenable → You.com → Exa**。重建 Proxy（通常通过重启宿主 service）后恢复初始顺序；该状态仅保存在内存中，没有冷却时间。成功的空结果、身份验证或权限失败、无效参数、明确标记的不可重试失败以及调用方取消都不会触发回退或改变顺序。每次调用中每个 provider 最多尝试一次，每个后端尝试 30 秒的上限包括延迟初始化和工具调用。完整三次尝试的调用因此具有约 90 秒的后端总上限，不含少量本地处理时间。

Proxy 提供通用的 `search` 和 `fetch` 工具；`fetch` 只接受恰好一个 `http` 或 `https` URL。OpenCode 中的名称是 `websearch_search` 和 `websearch_fetch`；Codex 和 DSH 中的名称是 `mcp__websearch__search` 和 `mcp__websearch__fetch`。显式 `exa`、`keenable` 和 `youcom` 保留其直连注册和 provider 原生工具名称；You.com 直连使用 `youdotcom` 以及 `you-search` 和 `you-extract`。

在 You.com 尝试中，通用 search 映射到 `you-search`：将 `query` 原样转发，并将 `maxResults` 映射为 `count`（默认 10，范围 1–50）。通用 fetch 只向 `you-extract` 传递 `url`，使用 keyed/keyless 的共同参数子集。You.com 没有与 `objective` 或 `maxCharacters` 直接对应的参数；Proxy 仅在该尝试中忽略它们，不会在本地改写查询或截断响应。Exa 和 Keenable 的成功元数据保持不变。You.com 在两次符合回退条件的失败后成功时，会报告 `provider: "youcom"`，保留描述首次失败的 `fallback`，并添加有序的 `fallbacks` 元数据，同时为每次此前符合回退条件的失败添加一行可读的 `Fallback`。

**隐私与退出自动回退：**自动回退可能将相同的搜索查询、可选 `objective` 或目标 URL 披露给 Exa、Keenable 和 You.com。具体而言，符合回退条件的 Exa 失败可能将相同的搜索查询或 URL 发送给 Keenable；未配置 Keenable 密钥时，还适用其公共层日志记录。随后符合回退条件的 Keenable 失败可能再将查询或 URL 发送给 You.com。You.com 不会将 `objective` 作为原生参数接收，但此前的 provider 可能已经接收。要保留直连 Exa 行为并防止自动回退，请显式选择 `exa`；显式 `keenable` 和 `youcom` 也是单 provider 退出选项，均绕过 Proxy。只有通过内置 Proxy 的调用才具有此回退保证：OmAgents 无法禁用的宿主原生 Web 工具不在保证范围内；用户自定义的 `websearch` 或 `youdotcom` MCP 仍归用户所有、优先于内置注册，并且不会被包装。

**Codex 配置时机：** Codex 会在安装器运行时固化 provider 和凭据配置。请在安装前设置环境变量；更改 provider 或密钥（包括 `YDC_API_KEY`）后，请重新运行安装器，例如 `OMAGENTS_SEARCH_PROVIDER="keenable" npx @omagents/omagents-codex`，然后使用相同环境重启 Codex。重新安装会刷新复制的 Proxy，并替换过期的 provider 条目和凭据。

对于 Codex，Bearer 环境变量间接引用按 MCP server 所有者确定：`github` 使用 `bearer_token_env_var = "GITHUB_TOKEN"`，而直连 `youdotcom` 使用 `bearer_token_env_var = "YDC_API_KEY"`，不会序列化 Bearer 密钥。对于自动本地 Proxy，已配置的 `YDC_API_KEY` 仍是 `.mcp.json` 中的 stdio `env` 值。Codex plugin 的 `.mcp.json` 合约不为 Exa 的 `x-api-key`、Keenable 的 `X-API-Key` 或 Context7 的 stdio `env` 提供等效间接引用，因此已配置的 Exa、Keenable 和 Context7 值会写入该文件。在支持 POSIX 权限模式的平台上，安装器以 `0700` 创建私有目录，并以 `0600` 写入或重写 `.mcp.json`。

## 支持矩阵

| 宿主或角色 | 软件包 | 安装 | Skills | 后台执行与恢复 | 管理界面 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenCode 1.x 和 OpenCode 2.x** | `@omagents/omagents` | `npx @omagents/omagents` | **33**：18 个 OmAgents + 15 个 Superpowers | V1 使用 `task(background: true)`；V2 使用原生 `subagent(...)`，始终在后台运行。持久化 Core Job Board、结果投递和恢复。 | `/ps`、`parallel_status`、`cancel_task`、父上下文结果和 OpenCode TUI 状态 |
| **Codex** | `@omagents/omagents-codex` | `npx @omagents/omagents-codex` | **33**：18 个 OmAgents + 15 个 Superpowers | Codex 原生 subagents。不安装 OpenCode 并行引擎或 DSH Web Job Board。 | Codex 原生界面和 skills |
| **DeepSeek Harness (DSH)** | `@omagents/omagents-dsh` | `dsh plugin --profile web add @omagents/omagents-dsh` | **33**：18 个 OmAgents + 15 个 Superpowers | 原生异步 `subagent` 生命周期、持久化 `job-board.json`、取消、恢复、`/ps`、`parallel_status` 和 `cancel_task` | 经授权的 Remote `watchJobs` 流和原生 React Web Job Board |
| **共享库，不是宿主 plugin** | `@omagents/core` | 作为依赖自动安装，无需用户单独安装 | 共享 skill 定义和 Superpowers 资源 | 宿主无关的执行状态、持久化、MCP 解析、研究资源和 Python 环境 | 无独立 UI |

所有宿主软件包只依赖相同版本的 Core，互不依赖。

## 核心特性

| 功能 | 提供的能力 |
| :--- | :--- |
| **Loop Engineering** | 为迭代 skills 提供持久任务队列、重试、验证和可恢复状态 |
| **Superpowers** | Brainstorming、TDD、系统化调试、计划、代码审查、worktrees 和验证 |
| **Deep Research** | 多来源 items × fields 研究、缺口检测、持久证据和 Jinja2 报告 |
| **Parallel Execution** | 在 OpenCode 和 DSH 上通过共享 Core 执行模型使用宿主原生后台 agents |
| **DSH Web Job Board** | 原生 React 筛选、详情、通知状态、确认取消、重连和健康状态显示 |
| **内置 MCPs** | agentmemory、codegraph、context7、websearch/keenable/youdotcom 和 github/grep_app |
| **Python 工具链** | 持久 agent base 和按需项目 overlay，不修改已有项目 `.venv` |
| **文档与 Web 工具** | MarkItDown 转换、OfficeCLI 文档和 Playwright 抓取 |
| **Code Intelligence** | LSP 指引和带 grep 回退的 AST 感知搜索/重写 |
| **Hyperplan 与 Refactor** | 三 critic 对抗式计划审查和经过验证的迭代重构 |

## Python 环境

持久 agent base 只会自动配置 `jinja2`。MarkItDown、Playwright 等可选 Python 工具仅在对应 skill 需要时**按需安装**，不属于自动设置内容。项目依赖使用按需 overlay，绝不会要求修改已有项目 `.venv`。

环境选择、跨平台路径和 CLI 用法请参阅 `agents-python-tools` skill。本仓库的项目命令由 `packages/core/hooks/project-venv.js` 实现。base 和项目环境都不会被自动删除。

## Loop Engineering 与 Deep Research

基于 loop 的 skills 每次处理一个条目，并将状态持久化到 `.omagents/loops/<skill>/tasks.json`。失败任务最多重试三次，随后标记为 blocked。状态在上下文清除后仍然保留，因此工作流可以恢复而不是重新开始。

Deep Research 的 `--workspace <dir>` 只用于公开交付物。计划、原始发现、检查点、派生产物、provenance 和 run 级队列保存在 `.omagents/deep-research/<run-id>/`。如果 workspace 会包含这些内部状态，新运行会被拒绝；旧布局 workspace 仍可读取和恢复，不会自动迁移。Jinja2 模板位于 `packages/core/skills/deep-research/templates/`，不存在根级 `templates/` 目录。

## Skills 与 MCP Servers

18 个 OmAgents skills 为：

`deep-research`、`parallel-execution`、`agents-python-tools`、`markitdown-converter`、`officecli`、`playwright-web-scraping`、`init-deep`、`doctor`、`remove-ai-slops`、`remove-deadcode`、`github-triage`、`tech-debt-audit`、`lsp-guide`、`ast-grep`、`work-with-pr`、`pre-publish-review`、`hyperplan` 和 `refactor`。

Superpowers 另外提供 15 个流程 skills。Core 为 `opencode-v1`、`opencode-v2`、`codex` 和 `dsh` 渲染共享 skills；控制流程不同时使用完整的宿主专用覆盖版本。对于 Superpowers skills，所有以 `docs/superpowers` 为根目录的文档路径都会渲染为以 `docs` 为根目录，并保留后续目录（例如 `docs/specs/` 和 `docs/plans/`）。现有文档不会自动迁移。OpenCode V2 和 DSH 使用原生 `subagent` 语义，均不带 `background` 参数。

| MCP | 类型 | 行为 |
| :--- | :--- | :--- |
| `agentmemory` | 本地 | Session 记忆和审计 |
| `codegraph` | 本地 | 代码库符号图和探索 |
| `context7` | 本地 | 通过 `@upstash/context7-mcp` 搜索文档 |
| `websearch` | `auto` 时为本地；显式 `exa` 时为远程 | 自动使用 `Exa → Keenable → You.com` Proxy，或匿名/通过 `EXA_API_KEY` 鉴权直连托管 Exa MCP |
| `keenable` | 远程 | 选择 `keenable` provider 时使用带密钥的私有 MCP 或免密钥公共端点 |
| `youdotcom` | 远程 | 选择 `youcom` provider 时使用带密钥的 `https://api.you.com/mcp` 或免密钥的 `https://api.you.com/mcp/free` |
| `github` / `grep_app` | 远程 | 有 token 时使用 GitHub Copilot MCP；否则通过 `mcp.grep.app` 搜索公开代码 |

用户定义的 MCP 配置优先于内置注册。

## DSH Job Board 行为

DSH 软件包安装完整的 Host 和 Web Client，而不是仅有 skills 的 plugin。Web Job Board 使用带 revision 的 Remote 全量集合帧，在重连后以新的 baseline 开始，并且不会轮询运行中的任务。它提供全部/运行中/需注意/已完成筛选、结果和错误详情、通知状态、取消确认、stale/permission/degraded 视图以及 DSH 主题集成。

取消请求被接受并不代表已确认终止。本地中断会停止子 agent 的**当前轮次**，其**后代会继续运行**，除非分别取消。**External one-shot** 运行会永久停止，且**无法恢复**。在 UI 中查看详情绝不会确认模型通知。

重启后，DSH 会根据宿主权威状态核对持久化任务。只有在**没有可权威观测到的活动运行**时，缺失或不可读的结果才会变为 `interrupted`，绝不会伪造成功。已观测到的 **active external** 运行遇到 **cold session-not-found**（冷启动会话缺失）时仍保持活动状态，不会被误判为中断。Remote 访问受活动 DSH profile 和已授权 parent-session scope 限制。有关 UI、取消、恢复、授权、安全和故障排除的详情，请参阅 [DSH 软件包指南](packages/dsh/README.md)和 [Job Board 指南](packages/dsh/docs/job-board.md)。

## 架构

```text
┌─────────────────────────────────────────────────┐
│ 用户选择层（不打包）                             │
│ OpenSpec · gstack · custom workflows · none     │
├─────────────────────────────────────────────────┤
│ 流程 skills 层（打包的 Superpowers）              │
├─────────────────────────────────────────────────┤
│ OmAgents 基础设施与共享 Core                     │
│ Skills · MCP · Job Board · research · Python    │
├─────────────────────────────────────────────────┤
│ OpenCode · Codex · DeepSeek Harness             │
└─────────────────────────────────────────────────┘
```

OmAgents 提供基础设施，不强制指定开发方法论。Superpowers 提供可复用流程 skills。OpenSpec、gstack 等方法论仍是用户的独立选择。

## 开发

本仓库是私有 npm-workspaces 根，包含 `packages/core`、`packages/opencode`、`packages/codex` 和 `packages/dsh`。仓库中的 `.opencode/plugins/index.js` 仅是开发用 re-export；产品代码位于各软件包中。Deep Research 模板保留在 `packages/core/skills/deep-research/templates/`。

```bash
# 所有根测试和 workspace 测试
npm test

# 构建并测试 DSH
npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh

# 打包产物与浏览器验证
npm run pack:all
npm run test:packed
npm run test:browser
```

每个版本都必须使用统一版本号，并**一起构建、测试、打包和发布全部四个软件包**，顺序固定为：

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

Core 首先发布，因为所有宿主都依赖它。三个宿主顺序发布只是为了确定日志和失败处理顺序；它们之间不存在依赖关系。验证要求和当前平台/浏览器确认范围请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 卸载

使用所选宿主的 plugin 管理功能移除或禁用对应的 OmAgents 软件包。对于 DSH，禁用指向软件包根目录的 `@omagents/omagents-dsh` Loader 行会同时禁用 Host 和 Web Client。Core 仅作为已安装宿主的依赖保留。Python 环境不会自动删除。

## 许可证

MIT —— 详见 [LICENSE](LICENSE)。
