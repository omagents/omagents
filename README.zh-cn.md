# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)
[![npm version](https://img.shields.io/npm/v/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![npm downloads](https://img.shields.io/npm/dm/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![GitHub stars](https://img.shields.io/github/stars/omagents/omagents?style=social)](https://github.com/omagents/omagents/stargazers)

[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

一个 OpenCode plugin，将 agent skills、MCP servers、parallel execution 和 superpowers 整合为一次安装。

---

## 跳过此 README

将以下内容粘贴给你的 agent：

```
Read this and install omagents: https://raw.githubusercontent.com/omagents/omagents/main/README.md
```

---

## 安装

### TL;DR

| 需求 | 操作 | 结果 |
| :--- | :--- | :--- |
| **稳定版**（npm） | 将 `"@omagents/omagents"` 添加到 `opencode.json` 的 plugin 数组 | 从 npm 自动安装 plugin，superpowers 已打包 |
| **锁定版本** | 添加 `"@omagents/omagents@^0.1.0"` | 同上，但锁定到特定版本范围 |
| **最新开发版**（git） | 添加 `"@omagents/omagents@git+https://github.com/omagents/omagents.git"` | 从 main 分支获取最新源码 |

### 面向人类用户

**前提条件：**
- 已安装并运行 [OpenCode](https://opencode.ai)
- 已安装 [Python 3.11+](https://www.python.org/downloads/) 并在 PATH 中可用（deep-research、markitdown-converter、playwright-web-scraping 和 loop engine 需要）

1. 打开你的 OpenCode 配置文件：

```bash
open -e ~/.config/opencode/opencode.json
```

2. 将 `@omagents/omagents` 添加到 `plugin` 数组中：

```json
{
  "plugin": [
    "@omagents/omagents"
  ]
}
```

3. 重启 OpenCode。

就是这样。首次启动时，OmAgents 会自动：
- 安装 **superpowers**（已打包，无需单独安装）
- 注册所有 **skills**（OmAgents + Superpowers）
- 注册所有 **MCP servers**（agentmemory、codegraph、context7、websearch、github/grep_app）
- 启用 **parallel execution**（后台 agent，支持 `/ps` 和 `cancel_task`）
- 设置 **Python venv** 于 `~/.venvs/omagents`（安装 `jinja2` 用于报告模板）
- 检查 **Python 前置条件**（如果缺少 Python，会给出安装提示）

### 面向 LLM Agent

如果你是帮助用户安装 OmAgents 的 AI agent，请按以下步骤操作：

```bash
# 1. 读取用户当前的 OpenCode 配置
cat ~/.config/opencode/opencode.json

# 2. 将 "@omagents/omagents" 添加到 plugin 数组中
#    如有 jq 可使用 jq，否则手动编辑

# 3. 编辑后验证配置是否为有效 JSON

# 4. 告知用户重启 OpenCode
```

plugin 会自动处理其余所有事项——无需手动配置 MCP、无需安装 skill、无需设置 venv。

### 可选：API Keys

部分远程 MCP servers 支持可选的 API keys 以获得更高的速率限制：

```bash
# ~/.zshrc 或 ~/.bashrc
export EXA_API_KEY="your-exa-key"
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

设置 `GITHUB_TOKEN` 可启用完整的 GitHub Copilot MCP（issues、PRs、repos、code search）。未设置时，OmAgents 会回退到 Vercel 的 `mcp.grep.app`，仅支持公开代码搜索。

### 与其他 Plugin 组合使用

OmAgents 的 hook 合并机制确保不会与其他 plugin 产生冲突：

```json
{
  "plugin": [
    "@omagents/omagents",
    "@devcxl/opencode-spec"
  ]
}

### Claude Code

你可以将 OmAgents 作为本地 [Claude Code](https://claude.ai/code) 插件从仓库直接安装：

```bash
claude plugin install /path/to/omagents
```

首次启动时，插件会注册所有打包的 skills 和 MCP servers。Claude Code 使用 `SessionStart` hooks 和 `bin/` wrappers，而不是 OpenCode 独有的 `shell.env` PATH 注入和并行执行引擎，因此后台任务分发（`task(background: true)`）和 `/ps` 命令不可用。

如果你在 `skills/` 目录中编辑了源 skill，请运行以下命令重新生成生成的插件产物：

```bash
npm run sync
```

### Codex

你可以将 OmAgents 作为本地 [Codex](https://github.com/openai/codex) 插件从仓库直接安装：

```bash
codex plugin add /path/to/omagents
```

与 Claude Code 相同的平台说明适用：`SessionStart` hooks 和 `bin/` wrappers 替代了 OpenCode 独有的 `shell.env` PATH 注入和并行执行引擎，因此后台任务分发和 `/ps` 不可用。编辑源 skill 后请运行 `npm run sync` 以重新生成 `.claude-plugin/` 和 `.codex-plugin/` 产物。

---


## 核心特性

| | 功能 | 作用 |
| :---: | :--- | :--- |
| 🔁 | **Loop Engineering（循环工程）** | 为迭代式 skills 提供持久化任务队列。支持上下文清除后恢复、重试逻辑、统一摘要。被 8 个 skills 使用 |
| 🧠 | **Superpowers**（14 个 skills） | 实现前先进行 brainstorming、TDD、systematic debugging、plan 编写、code review、git worktrees |
| 🔍 | **Deep Research** | 多来源迭代研究，支持 items × fields 矩阵、gap detection loop、Jinja2 报告 |
| ⚡ | **Parallel Execution** | 通过 `task(background: true)` 进行后台任务分发，Job Board 支持持久化和 session 隔离，`/ps` 命令 |
| 📚 | **内置 MCPs** | agentmemory、codegraph、context7、websearch、github/grep_app —— 全部自动注册 |
| 🐍 | **Python 工具链** | 专用 venv 于 `~/.venvs/omagents`，自动安装 jinja2 和 skill 依赖 |
| 📄 | **MarkItDown** | 将 PDF、DOCX、XLSX、PPTX、HTML 转换为 Markdown |
| 🌐 | **Web Scraping** | 基于 Playwright 的页面抓取和数据采集 |
| 🔗 | **GitHub** | 设置 `GITHUB_TOKEN` 后可使用完整 GitHub API；未设置时回退到 `mcp.grep.app` |
| 🏗️ | **Refactor** | 通过 loop engine 验证进行系统性代码重构 |
| 🛡️ | **Hyperplan** | 对抗式 plan 审查，3 个并行 critics（安全、架构、边界情况） |
| 🔧 | **Code Intelligence** | LSP guide + AST-grep，用于结构化代码搜索和重写 |

---

## Loop Engineering（循环工程）

OmAgents 率先将 **loop engineering（循环工程）** 应用于 AI agent skills。与一次性提示（如"扫描所有内容并修复"）不同，基于 loop 的 skills 使用持久化任务队列，逐项处理并附带验证。

### 工作原理

```
Phase 1: Build Task Queue          Phase 2: Execute Loop           Phase 3: Report
┌─────────────────────┐    ┌──────────────────────────┐    ┌─────────────────┐
│ Scan codebase       │    │ loop_engine.py next      │    │ loop_engine.py  │
│ Build task list     │───>│   -> get next task       │───>│   summary       │
│ loop_engine.py init │    │   -> execute + verify    │    │ Show results    │
└─────────────────────┘    │   -> complete or fail    │    └─────────────────┘
                           │   -> repeat until null   │
                           └──────────────────────────┘
```

**状态持久化**于 `.omagents/loops/<skill>/tasks.json` —— 如果 agent 的上下文在任务执行中途被清除，它可以从中断处精确恢复。

**重试逻辑：** 失败的任务最多重试 3 次，之后标记为 blocked。

**压缩安全：** `experimental.session.compacting` hook 会将 loop engine 状态注入压缩提示中，确保 agent 在上下文清除后知道如何恢复。

### 使用 Loop Engineering 的 Skills

| Skill | 循环处理对象 | 验证方式 |
|-------|-------------------|--------------|
| `deep-research` | 研究任务 -> gap detection -> 新任务 | 发现验证 + 覆盖矩阵 |
| `remove-ai-slops` | 源文件（每次一个） | Lint / 测试通过 |
| `remove-deadcode` | 死代码候选项（每次一个） | 移除后测试通过 |
| `github-triage` | 待处理 issues（每次一个） | 标签成功应用 |
| `tech-debt-audit` | 审计类别（每次一个） | 收集到发现结果 |
| `pre-publish-review` | 发布检查清单项（每次一个） | 每项检查通过 |
| `hyperplan` | 3 个并行 critics（跟踪式，非顺序式） | Critic 产出发现结果 |
| `refactor` | 重构目标（每次一个文件） | 重构后测试通过 |

### Loop Engine API

```bash
loop_engine.py init <skill> '<tasks_json>'   # Initialize task queue
loop_engine.py next <skill>                   # Get next pending task
loop_engine.py complete <skill> <id> [result] # Mark task complete
loop_engine.py fail <skill> <id> [error]      # Mark task failed (retries 3x)
loop_engine.py status <skill>                 # Print stats
loop_engine.py summary <skill>                # Full task list with icons
loop_engine.py reset <skill>                  # Clear queue
loop_engine.py add <skill> '<task_json>'      # Add task to existing queue
```

---

## 包含内容

### Skills

| Skill | 来源 | Loop？ | 描述 |
|-------|--------|-------|-------------|
| `deep-research` | OmAgents | 是 | 多来源、迭代式研究，支持 items × fields、gap detection、Jinja2 报告 |
| `parallel-execution` | OmAgents | - | 通过 Job Board 跟踪的后台并行任务分发 |
| `agents-python-tools` | OmAgents | - | 将 Python 工具链路由到专用 `~/.venvs/omagents` venv |
| `markitdown-converter` | OmAgents | - | 将文档（PDF、DOCX、XLSX 等）转换为 Markdown |
| `playwright-web-scraping` | OmAgents | - | 使用 Playwright 进行 web scraping 和页面抓取 |
| `init-deep` | OmAgents | - | 自动生成层级化 AGENTS.md 文件 |
| `doctor` | OmAgents | - | 诊断 OmAgents 安装和配置 |
| `remove-ai-slops` | OmAgents | 是 | 清理 AI 生成的代码产物（loop：逐文件） |
| `remove-deadcode` | OmAgents | 是 | 查找并移除未引用的代码（loop：逐个候选项） |
| `github-triage` | OmAgents | 是 | 分拣和分类 GitHub issues（loop：逐个 issue） |
| `tech-debt-audit` | OmAgents | 是 | 审计代码库的技术债务（loop：逐个类别） |
| `lsp-guide` | OmAgents | - | 指导 agent 使用正确的代码智能工具（LSP、codegraph、grep、ast-grep） |
| `ast-grep` | OmAgents | 可选 | AST 感知的代码搜索和重写，支持 grep 回退 |
| `work-with-pr` | OmAgents | - | 使用 github MCP 管理 PR 生命周期 |
| `pre-publish-review` | OmAgents | 是 | 发布前检查清单（loop：逐项检查） |
| `hyperplan` | OmAgents | 是 | 对抗式 plan 审查，3 个并行 critics（loop：critic 跟踪） |
| `refactor` | OmAgents | 是 | 带验证的系统性代码重构（loop：逐文件） |
| `superpowers`（14 个 skills） | Superpowers | - | Brainstorming、TDD、debugging、planning、git worktrees 等 |

### MCP Servers

| MCP | 类型 | 说明 |
|-----|------|-------|
| `agentmemory` | Local | Session 记忆和审计 |
| `codegraph` | Local | 代码库符号图和探索 |
| `context7` | Remote | 文档搜索（提供免费额度） |
| `websearch` | Remote | 通过 Exa 进行 web 搜索（提供免费额度） |
| `github` / `grep_app` | Remote | 设置 `GITHUB_TOKEN` 时使用 GitHub Copilot MCP；否则使用 `mcp.grep.app` 进行公开代码搜索 |

### Parallel Execution

- 通过 OpenCode 原生 `task(background: true)` 进行后台任务分发
- Job Board 跟踪，自动注入结果
- **持久化**：Job Board 在重启后保留（保存到 `job-board.json`）
- **Session 隔离**：每个 session 只看到自己的任务（无跨 session 泄露）
- **压缩安全**：loop engine 和 Job Board 状态在上下文压缩后保留
- `/ps` 命令查看运行中的任务
- `cancel_task` 工具取消后台任务
- `parallel_status` 工具进行程序化状态检查

---

## 架构

OmAgents 采用分层设计：

```
┌─────────────────────────────────────────────────┐
│  User Choice Layer (not bundled, install separately)  │
│  OpenSpec · gstack · custom workflows · none     │
├─────────────────────────────────────────────────┤
│  Process Skills Layer (bundled: superpowers)      │
│  Brainstorming · TDD · Debugging · Plans ·       │
│  Code Review · Git Worktrees · Verification      │
├─────────────────────────────────────────────────┤
│  Infrastructure Layer (bundled: OmAgents)         │
│  MCP servers · Parallel execution ·              │
│  Deep research · Python tooling · venv            │
├─────────────────────────────────────────────────┤
│  OpenCode runtime                                │
└─────────────────────────────────────────────────┘
```

**OmAgents 是基础设施层。** 它提供 agent 所需的工具和能力：用于外部数据的 MCP servers、用于后台任务的 parallel execution、研究工作流和 Python 环境管理。

**Superpowers 是流程技能层。** 它提供可复用的开发工作流：实现前的 brainstorming、test-driven development、systematic debugging、plan 编写和执行、code review 以及 git worktree 管理。

**用户选择层不打包。** 开发方法论是一种选择——spec 驱动开发（OpenSpec）、团队工程工作流（gstack），或者完全不使用方法论。OmAgents 保持中立，让用户选择适合自己项目的方式。

---

## 卸载

1. 从 OpenCode 配置中移除 plugin：

```bash
# Using jq
jq '.plugin = [.plugin[] | select(. != "@omagents/omagents")]' \
    ~/.config/opencode/opencode.json > /tmp/oc.json && \
    mv /tmp/oc.json ~/.config/opencode/opencode.json
```

2. 移除 Python venv（可选）：

```bash
rm -rf ~/.venvs/omagents
```

3. 重启 OpenCode。

---

## 开发

项目结构：

```
omagents/
├── .opencode/plugins/
│   ├── index.js              # Plugin entry point (merges superpowers + omagents hooks)
│   └── parallel.js           # Parallel execution engine
├── skills/                   # Bundled OpenCode skills (17 skills)
│   ├── _shared/scripts/      # Shared scripts (loop_engine.py)
│   ├── deep-research/        # Research workflow with gap detection
│   └── ...                   # 16 more skills
├── tests/                    # Node.js built-in test runner (26 tests)
├── AGENTS.md                 # AI agent context file
├── ROADMAP.md                # Development roadmap
├── package.json              # Includes superpowers as dependency
└── README.md
```

### 测试

```bash
# Run all tests
npm test

# Check formatting
npm run format:check

# Format code
npm run format
```

### 发布

OmAgents 使用 OIDC Trusted Publishing —— 无需 npm token。

```bash
# Bump version
npm version patch   # 0.1.0 -> 0.1.1

# Push tag (triggers GitHub Actions auto-publish)
git push && git push --tags
```

在 [npmjs.com](https://www.npmjs.com/package/@omagents/omagents) -> Settings -> Trusted Publisher 配置 Trusted Publisher。

---

## 许可证

MIT —— 详见 [LICENSE](LICENSE)。
