# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)
[![npm version](https://img.shields.io/npm/v/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![npm downloads](https://img.shields.io/npm/dm/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![GitHub stars](https://img.shields.io/github/stars/omagents/omagents?style=social)](https://github.com/omagents/omagents/stargazers)

[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

에이전트 skill, MCP server, 병렬 실행, 그리고 superpowers를 하나의 설치로 묶어주는 OpenCode plugin입니다.

---

## 이 README 건너뛰기

에이전트에게 다음을 붙여넣으세요:

```
Read this and install omagents: https://raw.githubusercontent.com/omagents/omagents/main/README.md
```

---

## 설치

### TL;DR

| 원하는 것 | 실행할 작업 | 결과 |
| :--- | :--- | :--- |
| **안정 버전** (npm) | `opencode.json` plugin 배열에 `"@omagents/omagents"` 추가 | npm에서 plugin 자동 설치, superpowers 포함 |
| **버전 고정** | `"@omagents/omagents@^0.1.0"` 추가 | 동일하지만 버전 범위로 고정 |
| **최신 개발 버전** (git) | `"@omagents/omagents@git+https://github.com/omagents/omagents.git"` 추가 | main branch의 최신 소스 |

### 사용자용 가이드

**사전 요구 사항:**
- [OpenCode](https://opencode.ai)가 설치되어 실행 중이어야 함
- [Python 3.11+](https://www.python.org/downloads/)이 설치되어 PATH에 등록되어 있어야 함 (deep-research, markitdown-converter, playwright-web-scraping 및 loop engine에 필요)

1. OpenCode 설정 파일을 엽니다:

```bash
open -e ~/.config/opencode/opencode.json
```

2. `plugin` 배열에 `@omagents/omagents`를 추가합니다:

```json
{
  "plugin": [
    "@omagents/omagents"
  ]
}
```

3. OpenCode를 재시작합니다.

완료되었습니다. 세션 시작 시 OmAgents가 자동으로 다음을 수행합니다:
- **superpowers** 설치 (번들 포함, 별도 설치 불필요)
- 모든 **skill** 등록 (OmAgents + Superpowers)
- 모든 **MCP server** 등록 (agentmemory, codegraph, context7, websearch, github/grep_app)
- **병렬 실행** 활성화 (`/ps` 및 `cancel_task`를 통한 background agent)
- `~/.venvs/omagents`에 **Python venv** 설정 (보고서 템플릿용 `jinja2` 설치)
- **Python 사전 요구 사항** 확인 (Python이 없는 경우 설치 안내와 함께 경고)

### LLM Agent용 가이드

AI agent로서 사용자의 OmAgents 설치를 돕고 있다면, 다음 단계를 따르세요:

```bash
# 1. 사용자의 현재 OpenCode 설정 읽기
cat ~/.config/opencode/opencode.json

# 2. plugin 배열에 "@omagents/omagents" 추가
#    jq가 있으면 사용, 없으면 수동으로 편집

# 3. 편집 후 설정이 유효한 JSON인지 확인

# 4. 사용자에게 OpenCode 재시작 안내
```

plugin이 나머지는 모두 자동으로 처리합니다 - 수동 MCP 설정, skill 설치, venv 설정이 필요 없습니다.

### 선택 사항: API Key

일부 원격 MCP server는 더 높은 rate limit을 위해 선택적 API key를 지원합니다:

```bash
# ~/.zshrc 또는 ~/.bashrc
export EXA_API_KEY="your-exa-key"
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

`GITHUB_TOKEN`을 설정하면 전체 GitHub Copilot MCP(issues, PRs, repos, code search)가 활성화됩니다. 설정하지 않으면 OmAgents는 공개 code search만 지원하는 Vercel의 `mcp.grep.app`으로 대체됩니다.

### 다른 Plugin과 결합

OmAgents의 hook 병합 메커니즘은 추가 plugin과의 충돌을 방지합니다:

```json
{
  "plugin": [
    "@omagents/omagents",
    "@devcxl/opencode-spec"
  ]
}
```

### Codex

**사전 요구 사항:** [Python 3.11+](https://www.python.org/downloads/)이 설치되어 PATH에 포함되어 있어야 합니다.

1. OmAgents marketplace를 추가하고 플러그인을 설치:

```bash
codex plugin marketplace add omagents/omagents
codex plugin add omagents@omagents
```

세션 시작 시 플러그인이 번들된 skills, MCP servers를 자동으로 검색하고 `SessionStart` hooks로 Python venv를 설정합니다. OpenCode 전용 병렬 실행 엔진은 사용할 수 없습니다. Codex의 네이티브 subagent 도구를 사용하세요.

> **개발자용:** `skills/`의 소스 skill을 편집한 경우, `npm run sync`를 실행하여 `.codex-plugin/` 산출물을 재생성하세요. `prepublishOnly` 스크립트가 `npm publish` 전에 자동으로 sync를 실행합니다.

---

## 주요 기능

| | 기능 | 설명 |
| :---: | :--- | :--- |
| 🔁 | **Loop Engineering**(루프 엔지니어링) | 반복적 skill을 위한 durable task queue. context clear 후에도 유지, retry logic, 통합 요약. 8개 skill에서 사용 |
| 🧠 | **Superpowers** (14 skill) | 구현 전 brainstorming, TDD, 체계적 debugging, plan 작성, code review, git worktree |
| 🔍 | **Deep Research** | 다중 소스 반복 연구, items × fields 매트릭스, gap detection loop, Jinja2 보고서 |
| ⚡ | **Parallel Execution**(병렬 실행) | `task(background: true)`를 통한 background task 분배, 지속성 + session 격리를 갖춘 Job Board, `/ps` 명령어 |
| 📚 | **내장 MCP** | agentmemory, codegraph, context7, websearch, github/grep_app - 모두 자동 등록 |
| 🐍 | **Python Tooling** | `~/.venvs/omagents` 전용 venv, jinja2 및 skill 의존성 자동 설치 |
| 📄 | **MarkItDown** | PDF, DOCX, XLSX, PPTX, HTML을 Markdown으로 변환 |
| 📊 | **OfficeCLI** | officecli로 .docx/.xlsx/.pptx 생성/분석/교정/편집 |
| 🌐 | **Web Scraping** | Playwright 기반 페이지 가져오기 및 스크래핑 |
| 🔗 | **GitHub** | `GITHUB_TOKEN` 설정 시 전체 GitHub API; 토큰 없으면 `mcp.grep.app`으로 대체 |
| 🏗️ | **Refactor** | loop engine 검증을 통한 체계적 코드 리팩토링 |
| 🛡️ | **Hyperplan** | 3개 병렬 critic을 활용한 대립적 plan 검토 (보안, 아키텍처, edge case) |
| 🔧 | **Code Intelligence** | LSP guide + AST-grep을 통한 구조적 code search 및 rewrite |

---

## Loop Engineering

OmAgents는 AI agent skill을 위한 **loop engineering**(루프 엔지니어링)을 개척했습니다. "모든 것을 스캔하고 수정하라"는 일회성 prompt 대신, loop 기반 skill은 검증과 함께 한 번에 하나씩 항목을 처리하는 durable task queue를 사용합니다.

### 작동 방식

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

**상태가 유지됩니다** — `.omagents/loops/<skill>/tasks.json`에 저장됩니다. 작업 중간에 agent의 context가 clear되어도, 정확히 중단한 지점에서 재개할 수 있습니다.

**Retry logic:** 실패한 task는 blocked 상태로 표시되기 전에 최대 3번 재시도됩니다.

**Compaction safe:** `experimental.session.compacting` hook이 loop engine 상태를 compaction prompt에 주입하므로, agent는 context clear 후 재개 방법을 알고 있습니다.

### Loop Engineering을 사용하는 Skill

| Skill | 반복 대상 | 검증 |
|-------|----------|------|
| `deep-research` | 연구 task -> gap detection -> 새로운 task | 결과 검증 + coverage matrix |
| `remove-ai-slops` | 소스 파일 (task당 1개) | Lint / test 통과 |
| `remove-deadcode` | Dead code 후보 (task당 1개) | 제거 후 test 통과 |
| `github-triage` | 열린 issues (task당 1개) | label 성공적으로 적용됨 |
| `tech-debt-audit` | 감사 카테고리 (task당 1개) | 결과 수집 완료 |
| `pre-publish-review` | Release checklist 항목 (task당 1개) | 각 check 통과 |
| `hyperplan` | 3개 병렬 critic (순차가 아닌 추적 방식) | Critic이 결과 생성 |
| `refactor` | 리팩토링 대상 (task당 1개 파일) | 리팩토링 후 test 통과 |

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

## 포함된 내용

### Skill

| Skill | 출처 | Loop? | 설명 |
|-------|------|-------|------|
| `deep-research` | OmAgents | Yes | 다중 소스, items × fields, gap detection, Jinja2 보고서를 활용한 반복 연구 |
| `parallel-execution` | OmAgents | - | Job Board 추적을 통한 background 병렬 task 분배 |
| `agents-python-tools` | OmAgents | - | Python tooling을 전용 `~/.venvs/omagents` venv로 라우팅 |
| `markitdown-converter` | OmAgents | - | 문서(PDF, DOCX, XLSX 등)를 Markdown으로 변환 |
| `officecli` | OmAgents | - | officecli CLI로 Office 문서(.docx, .xlsx, .pptx) 생성/분석/교정/편집 |
| `playwright-web-scraping` | OmAgents | - | Playwright를 활용한 web scraping 및 페이지 가져오기 |
| `init-deep` | OmAgents | - | 계층적 AGENTS.md 파일 자동 생성 |
| `doctor` | OmAgents | - | OmAgents 설치 및 설정 진단 |
| `remove-ai-slops` | OmAgents | Yes | AI 생성 코드 산물 정리 (loop: 파일별) |
| `remove-deadcode` | OmAgents | Yes | 참조되지 않은 코드 탐지 및 제거 (loop: 후보별) |
| `github-triage` | OmAgents | Yes | GitHub issues 분류 및 카테고리화 (loop: issue별) |
| `tech-debt-audit` | OmAgents | Yes | 코드베이스 기술 부채 감사 (loop: 카테고리별) |
| `lsp-guide` | OmAgents | - | 에이전트가 올바른 code intelligence 도구(LSP, codegraph, grep, ast-grep)를 사용하도록 안내 |
| `ast-grep` | OmAgents | Optional | grep 대체 기능을 갖춘 AST 기반 code search 및 rewrite |
| `work-with-pr` | OmAgents | - | github MCP를 활용한 PR 수명 주기 관리 |
| `pre-publish-review` | OmAgents | Yes | 게시 전 release gate checklist (loop: check별) |
| `hyperplan` | OmAgents | Yes | 3개 병렬 critic을 활용한 대립적 plan 검토 (loop: critic 추적) |
| `refactor` | OmAgents | Yes | 검증을 통한 체계적 코드 리팩토링 (loop: 파일별) |
| `superpowers` (14 skill) | Superpowers | - | Brainstorming, TDD, debugging, planning, git worktree 등 |

### MCP Server

| MCP | 유형 | 비고 |
|-----|------|------|
| `agentmemory` | Local | Session memory 및 감사 |
| `codegraph` | Local | 코드베이스 symbol graph 및 탐색 |
| `context7` | Remote | 문서 검색 (무료 tier 사용 가능) |
| `websearch` | Remote | Exa를 통한 web search (무료 tier 사용 가능) |
| `github` / `grep_app` | Remote | `GITHUB_TOKEN` 설정 시 GitHub Copilot MCP; 미설정 시 공개 code search용 `mcp.grep.app` |

### 병렬 실행

- OpenCode의 기본 `task(background: true)`를 통한 background task 분배
- 자동 결과 주입을 포함한 Job Board 추적
- **지속성**: Job Board가 재시작 후에도 유지됨 (`job-board.json`에 저장)
- **Session 격리**: 각 session은 자신의 job만 표시 (session 간 누출 없음)
- **Compaction safe**: context compaction 후에도 loop engine 및 Job Board 상태 보존
- 실행 중인 task를 확인하는 `/ps` 명령어
- background task를 취소하는 `cancel_task` 도구
- 프로그래밍 방식의 상태 확인을 위한 `parallel_status` 도구

---

## 아키텍처

OmAgents는 계층화된 시스템으로 설계되었습니다:

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

**OmAgents는 인프라 계층입니다.** 에이전트에 필요한 도구와 기능을 제공합니다: 외부 데이터를 위한 MCP server, background task를 위한 병렬 실행, 연구 workflow, 그리고 Python 환경 관리.

**Superpowers는 프로세스 skill 계층입니다.** 재사용 가능한 개발 workflow를 제공합니다: 구현 전 brainstorming, test-driven development, 체계적 debugging, plan 작성 및 실행, code review, 그리고 git worktree 관리.

**사용자 선택 계층은 번들에 포함되지 않습니다.** 개발 방법론은 선택 사항입니다 - spec-driven development(OpenSpec), 팀 기반 engineering workflow(gstack), 또는 아무 방법론도 사용하지 않을 수 있습니다. OmAgents는 중립을 유지하여 사용자가 프로젝트에 맞는 것을 선택할 수 있도록 합니다.

---

## 제거

1. OpenCode 설정에서 plugin을 제거합니다:

```bash
# jq 사용
jq '.plugin = [.plugin[] | select(. != "@omagents/omagents")]' \
    ~/.config/opencode/opencode.json > /tmp/oc.json && \
    mv /tmp/oc.json ~/.config/opencode/opencode.json
```

2. Python venv를 제거합니다 (선택 사항):

```bash
rm -rf ~/.venvs/omagents
```

3. OpenCode를 재시작합니다.

---

## 개발

프로젝트 구조:

```
omagents/
├── .opencode/plugins/
│   ├── index.js              # Plugin entry point (merges superpowers + omagents hooks)
│   └── parallel.js           # Parallel execution engine
├── skills/                   # Bundled OpenCode skills (18 skills)
│   ├── _shared/scripts/      # Shared scripts (loop_engine.py)
│   ├── deep-research/        # Research workflow with gap detection
│   └── ...                   # 16 more skills
├── tests/                    # Node.js built-in test runner (26 tests)
├── AGENTS.md                 # AI agent context file
├── ROADMAP.md                # Development roadmap
├── package.json              # Includes superpowers as dependency
└── README.md
```

### 테스트

```bash
# 모든 테스트 실행
npm test

# 포맷 확인
npm run format:check

# 코드 포맷
npm run format
```

### 게시

OmAgents는 OIDC Trusted Publishing을 사용합니다 - npm token이 필요하지 않습니다.

```bash
# 버전 올리기
npm version patch   # 0.1.0 -> 0.1.1

# tag push (GitHub Actions 자동 게시 트리거)
git push && git push --tags
```

[npmjs.com](https://www.npmjs.com/package/@omagents/omagents) -> Settings -> Trusted Publisher에서 Trusted Publisher를 설정하세요.

---

## 라이선스

MIT - [LICENSE](LICENSE) 참조.
