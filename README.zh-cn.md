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

安装后重启宿主。`@omagents/core` 会作为依赖自动安装；**不要将它作为 plugin 单独安装**。当前发布候选版本将四个软件包统一为 **0.13.1**。

Python 驱动的 skills 要求 PATH 中可使用 Python 3.11+。DSH 要求 Node.js 24.9 或更高版本，并要求 DSH 版本位于软件包声明的已测试兼容范围内。

### 可选 API Keys

```bash
export EXA_API_KEY="your-exa-key"
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

- **`EXA_API_KEY`**：通过 `x-api-key` 为托管的 Exa `websearch` MCP 鉴权；未设置时，同一端点可匿名使用。
- **`CONTEXT7_API_KEY`**：本地 `@upstash/context7-mcp` server 的可选速率限制凭据。
- **`GITHUB_TOKEN`**：启用 GitHub Copilot MCP。未设置时，OmAgents 使用 `mcp.grep.app` 搜索公开代码。

## 支持矩阵

| 宿主或角色 | 软件包 | 安装 | Skills | 后台执行与恢复 | 管理界面 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenCode 1.x 和 OpenCode 2.x** | `@omagents/omagents` | `npx @omagents/omagents` | **33**：18 个 OmAgents + 15 个 Superpowers | V1 使用 `task(background: true)`；V2 使用原生 `subagent(..., background: true)`。持久化 Core Job Board、结果投递和恢复。 | `/ps`、`parallel_status`、`cancel_task`、父上下文结果和 OpenCode TUI 状态 |
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
| **内置 MCPs** | agentmemory、codegraph、context7、websearch 和 github/grep_app |
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

Superpowers 另外提供 15 个流程 skills。Core 为 `opencode-v1`、`opencode-v2`、`codex` 和 `dsh` 渲染共享 skills；控制流程不同时使用完整的宿主专用覆盖版本。DSH 使用原生 `subagent` 语义，不带 OpenCode 的 `background` 参数。

| MCP | 类型 | 行为 |
| :--- | :--- | :--- |
| `agentmemory` | 本地 | Session 记忆和审计 |
| `codegraph` | 本地 | 代码库符号图和探索 |
| `context7` | 本地 | 通过 `@upstash/context7-mcp` 搜索文档 |
| `websearch` | 远程 | 托管 Exa MCP，匿名或通过 `EXA_API_KEY` 鉴权 |
| `github` / `grep_app` | 远程 | 有 token 时使用 GitHub Copilot MCP；否则通过 `mcp.grep.app` 搜索公开代码 |

用户定义的 MCP 配置优先于内置注册。

## DSH Job Board 行为

DSH 软件包安装完整的 Host 和 Web Client，而不是仅有 skills 的 plugin。Web Job Board 使用带 revision 的 Remote 全量集合帧，在重连后以新的 baseline 开始，并且不会轮询运行中的任务。它提供全部/运行中/需注意/已完成筛选、结果和错误详情、通知状态、取消确认、stale/permission/degraded 视图以及 DSH 主题集成。

取消请求被接受并不代表已确认终止。本地中断会停止子 agent 的**当前轮次**，其**后代会继续运行**，除非分别取消。**External one-shot** 运行会永久停止，且**无法恢复**。在 UI 中查看详情绝不会确认模型通知。

重启后，DSH 会根据宿主权威状态核对持久化任务。缺失或不可读的结果会变为 `interrupted`，绝不会伪造成功。Remote 访问受活动 DSH profile 和已授权 parent-session scope 限制。有关 UI、取消、恢复、授权、安全和故障排除的详情，请参阅 [DSH 软件包指南](packages/dsh/README.md)和 [Job Board 指南](packages/dsh/docs/job-board.md)。

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
