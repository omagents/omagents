# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)
[![npm version](https://img.shields.io/npm/v/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![npm downloads](https://img.shields.io/npm/dm/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![GitHub stars](https://img.shields.io/github/stars/omagents/omagents?style=social)](https://github.com/omagents/omagents/stargazers)

[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

OmAgents는 **OpenCode**, **Codex**, **DeepSeek Harness (DSH)**를 위한 멀티 호스트 에이전트 툴킷입니다. 18개 OmAgents skills, 15개 Superpowers skills, MCP servers, 네이티브 백그라운드 에이전트 통합, Deep Research, Python 도구를 제공하며, 공유 Core 패키지가 상태와 호스트 독립 동작을 일관되게 유지합니다.

---

## 설치

사용하는 호스트에 맞는 패키지를 선택하세요. 설치 프로그램에는 호스트 위치 인자가 없습니다.

```bash
# OpenCode
npx @omagents/omagents

# Codex
npx @omagents/omagents-codex

# DeepSeek Harness
dsh plugin --profile web add @omagents/omagents-dsh
```

설치 후 호스트를 다시 시작하세요. `@omagents/core`는 의존성으로 자동 설치되므로 **plugin으로 별도 설치하지 마세요**. 현재 릴리스 후보는 네 패키지 모두 **0.15.0**로 정렬되어 있습니다.

Python 기반 skills를 사용하려면 PATH에서 Python 3.11+를 사용할 수 있어야 합니다. DSH에는 Node.js 24.9 이상과 패키지에 명시된 테스트 완료 호환 범위의 DSH 버전이 필요합니다.

### 선택적 API Keys

```bash
export EXA_API_KEY="your-exa-key"
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

- **`EXA_API_KEY`**: 호스팅된 Exa `websearch` MCP를 `x-api-key`로 인증합니다. 설정하지 않아도 같은 엔드포인트를 익명으로 사용할 수 있습니다.
- **`CONTEXT7_API_KEY`**: 로컬 `@upstash/context7-mcp` server의 rate limit을 완화하는 선택적 자격 증명입니다.
- **`GITHUB_TOKEN`**: GitHub Copilot MCP를 활성화합니다. 설정하지 않으면 OmAgents가 `mcp.grep.app`으로 공개 코드를 검색합니다.

Codex에서 GitHub 인증은 토큰 값 대신 `GITHUB_TOKEN` 환경 변수 참조(`bearer_token_env_var`)로 저장됩니다. Codex plugin `.mcp.json` 계약은 Exa의 `x-api-key` 또는 Context7의 stdio `env`에 해당하는 간접 참조를 제공하지 않으므로, 설정된 Exa 및 Context7 값은 이 파일에 기록됩니다. POSIX 모드를 지원하는 플랫폼에서 설치 프로그램은 비공개 디렉터리를 `0700`으로 만들고 `.mcp.json`을 `0600`으로 쓰거나 다시 씁니다.

## 지원 매트릭스

| 호스트 또는 역할 | 패키지 | 설치 | Skills | 백그라운드 실행 및 복구 | 관리 화면 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenCode 1.x 및 OpenCode 2.x** | `@omagents/omagents` | `npx @omagents/omagents` | **33**: OmAgents 18 + Superpowers 15 | V1은 `task(background: true)`, V2는 항상 백그라운드에서 실행되는 네이티브 `subagent(...)` 사용. 영구 Core Job Board, 완료 전달 및 복구. | `/ps`, `parallel_status`, `cancel_task`, 부모 컨텍스트 결과 및 OpenCode TUI 상태 |
| **Codex** | `@omagents/omagents-codex` | `npx @omagents/omagents-codex` | **33**: OmAgents 18 + Superpowers 15 | Codex 네이티브 subagents. OpenCode 병렬 엔진과 DSH Web Job Board는 설치되지 않습니다. | Codex 네이티브 인터페이스와 skills |
| **DeepSeek Harness (DSH)** | `@omagents/omagents-dsh` | `dsh plugin --profile web add @omagents/omagents-dsh` | **33**: OmAgents 18 + Superpowers 15 | 네이티브 비동기 `subagent` 생명주기, 영구 `job-board.json`, 취소, 복구, `/ps`, `parallel_status`, `cancel_task` | 권한이 부여된 Remote `watchJobs` 스트림과 네이티브 React Web Job Board |
| **공유 라이브러리(호스트 plugin 아님)** | `@omagents/core` | 자동 의존성이며 사용자가 별도 설치하지 않음 | 공유 skill 정의와 Superpowers 자산 | 호스트 독립 실행 상태, 영속성, MCP 해석, research 자산 및 Python 환경 | 독립 UI 없음 |

모든 호스트 패키지는 동일 버전의 Core에만 의존하며 다른 호스트 패키지에는 의존하지 않습니다.

## 주요 기능

| 기능 | 제공 내용 |
| :--- | :--- |
| **Loop Engineering** | 반복 skills를 위한 영구 작업 큐, 재시도, 검증 및 재개 가능한 상태 |
| **Superpowers** | Brainstorming, TDD, 체계적 debugging, plan, code review, worktree 및 검증 |
| **Deep Research** | 다중 소스 items × fields research, gap detection, 영구 evidence 및 Jinja2 보고서 |
| **Parallel Execution** | OpenCode와 DSH에서 공유 Core 실행 모델을 사용하는 호스트 네이티브 백그라운드 에이전트 |
| **DSH Web Job Board** | 네이티브 React 필터, 세부 정보, 알림 상태, 확인 기반 취소, 재연결 및 health 표시 |
| **내장 MCPs** | agentmemory, codegraph, context7, websearch, github/grep_app |
| **Python Tooling** | 영구 agent base와 온디맨드 project overlay를 제공하며 기존 project `.venv`를 수정하지 않음 |
| **문서 및 Web 도구** | MarkItDown 변환, OfficeCLI 문서, Playwright scraping |
| **Code Intelligence** | LSP 안내와 grep fallback이 있는 AST 인식 검색/재작성 |
| **Hyperplan 및 Refactor** | 세 critic의 adversarial plan review와 검증된 반복 refactoring |

## Python 환경

영구 agent base에서는 `jinja2`만 자동으로 provision됩니다. MarkItDown과 Playwright 같은 선택적 Python 도구는 해당 skill이 필요로 할 때 **온디맨드로 설치**되며 자동 설정에 포함되지 않습니다. 프로젝트 의존성은 온디맨드 overlay를 사용하며 기존 프로젝트 `.venv`를 수정할 필요가 없습니다.

환경 선택, 크로스 플랫폼 경로 및 CLI 지침은 `agents-python-tools` skill을 참조하세요. 이 저장소의 프로젝트 명령은 `packages/core/hooks/project-venv.js`에 구현되어 있습니다. base와 프로젝트 환경 모두 자동 삭제되지 않습니다.

## Loop Engineering 및 Deep Research

Loop 기반 skills는 한 번에 한 항목을 처리하고 상태를 `.omagents/loops/<skill>/tasks.json`에 저장합니다. 실패한 작업은 blocked가 되기 전에 최대 세 번 재시도합니다. 컨텍스트가 지워진 후에도 상태가 유지되므로 워크플로를 처음부터 다시 시작하지 않고 재개할 수 있습니다.

Deep Research에서 `--workspace <dir>`는 공개 결과물에만 사용합니다. plan, raw findings, checkpoint, 파생 artifact, provenance 및 run별 queue는 `.omagents/deep-research/<run-id>/`에 저장됩니다. 이러한 상태를 포함하는 workspace에서는 새 run이 거부됩니다. legacy workspace는 자동 마이그레이션 없이 계속 읽고 재개할 수 있습니다. Jinja2 템플릿은 `packages/core/skills/deep-research/templates/`에 있으며 루트 수준 `templates/` 디렉터리는 없습니다.

## Skills 및 MCP Servers

18개 OmAgents skills는 다음과 같습니다.

`deep-research`, `parallel-execution`, `agents-python-tools`, `markitdown-converter`, `officecli`, `playwright-web-scraping`, `init-deep`, `doctor`, `remove-ai-slops`, `remove-deadcode`, `github-triage`, `tech-debt-audit`, `lsp-guide`, `ast-grep`, `work-with-pr`, `pre-publish-review`, `hyperplan`, `refactor`.

Superpowers는 15개 프로세스 skills를 추가로 제공합니다. Core는 `opencode-v1`, `opencode-v2`, `codex`, `dsh`용으로 공유 skills를 렌더링하며, 제어 흐름이 다른 경우 완전한 호스트별 override를 사용합니다. Superpowers skills에서는 `docs/superpowers`를 루트로 하는 모든 문서 경로를 `docs`를 루트로 하는 경로로 렌더링하며, 이후 디렉터리(예: `docs/specs/`, `docs/plans/`)를 유지합니다. 기존 문서는 자동으로 마이그레이션되지 않습니다. OpenCode V2와 DSH는 모두 `background` 인자 없이 네이티브 `subagent` 의미를 사용합니다.

| MCP | 유형 | 동작 |
| :--- | :--- | :--- |
| `agentmemory` | 로컬 | Session memory 및 audit |
| `codegraph` | 로컬 | 코드베이스 symbol graph 및 탐색 |
| `context7` | 로컬 | `@upstash/context7-mcp`를 통한 문서 검색 |
| `websearch` | 원격 | 호스팅된 Exa MCP, 익명 또는 `EXA_API_KEY` 인증 |
| `github` / `grep_app` | 원격 | token이 있으면 GitHub Copilot MCP, 없으면 `mcp.grep.app` 공개 코드 검색 |

사용자 정의 MCP 설정은 내장 등록보다 우선합니다.

## DSH Job Board 동작

DSH 패키지는 skills만 제공하는 plugin이 아니라 완전한 Host와 Web Client를 설치합니다. Web Job Board는 revision이 있는 Remote whole-set frames를 사용하고 재연결 후 새 baseline에서 시작하며 실행 중인 job을 polling하지 않습니다. all/running/attention/finished 필터, 결과 및 오류 세부 정보, 알림 상태, 취소 확인, stale/permission/degraded 보기와 DSH 테마 통합을 제공합니다.

취소 요청이 수락되었다는 것은 종료가 확인되었다는 뜻이 아닙니다. 로컬 중단은 자식 에이전트의 **현재 turn**만 중지하며 **descendants는 별도로 취소하지 않는 한 계속 실행**됩니다. **External one-shot** 실행은 영구적으로 중지되며 **재개할 수 없습니다**. UI에서 세부 정보를 보아도 모델 알림이 acknowledge되지 않습니다.

재시작 후 DSH는 저장된 jobs를 호스트의 권위 있는 상태와 대조합니다. **권위 있게 관찰 가능한 활성 실행이 없을 때만** 결과가 없거나 읽을 수 없는 job이 `interrupted`가 되며 성공이 꾸며지지 않습니다. 관찰된 **active external** 실행은 **cold session-not-found**(콜드 시작 시 Session 누락)에서도 활성 상태로 유지되며 중단으로 잘못 분류되지 않습니다. Remote 접근은 활성 DSH profile과 권한이 부여된 parent-session scope로 제한됩니다. UI, 취소, 복구, 권한 부여, 보안 및 문제 해결은 [DSH 패키지 가이드](packages/dsh/README.md)와 [Job Board 가이드](packages/dsh/docs/job-board.md)를 참조하세요.

## 아키텍처

```text
┌─────────────────────────────────────────────────┐
│ 사용자 선택 계층(미포함)                          │
│ OpenSpec · gstack · custom workflows · none     │
├─────────────────────────────────────────────────┤
│ 프로세스 skills 계층(포함된 Superpowers)          │
├─────────────────────────────────────────────────┤
│ OmAgents 인프라 및 공유 Core                     │
│ Skills · MCP · Job Board · research · Python    │
├─────────────────────────────────────────────────┤
│ OpenCode · Codex · DeepSeek Harness             │
└─────────────────────────────────────────────────┘
```

OmAgents는 인프라를 제공하며 개발 방법론을 강제하지 않습니다. Superpowers는 재사용 가능한 프로세스 skills를 제공합니다. OpenSpec과 gstack 같은 방법론은 계속해서 사용자가 별도로 선택할 수 있습니다.

## 개발

이 저장소는 `packages/core`, `packages/opencode`, `packages/codex`, `packages/dsh`를 포함하는 비공개 npm-workspaces 루트입니다. 저장소의 `.opencode/plugins/index.js`는 개발 전용 re-export이며 제품 코드는 각 패키지에 있습니다. Deep Research 템플릿은 `packages/core/skills/deep-research/templates/`에 있습니다.

```bash
# 모든 루트 및 workspace 테스트
npm test

# DSH 빌드 및 테스트
npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh

# 패킹된 artifact 및 브라우저 검증
npm run pack:all
npm run test:packed
npm run test:browser
```

모든 릴리스는 하나의 정렬된 버전을 사용하고 **네 패키지를 모두 함께 빌드, 테스트, 패킹 및 게시**해야 합니다. 순서는 다음으로 고정됩니다.

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

모든 호스트가 Core에 의존하므로 Core를 먼저 게시합니다. 호스트를 순차적으로 게시하는 것은 로그와 실패 처리를 결정적으로 하기 위해서만이며 호스트 간 의존성은 없습니다. 검증 요구 사항과 현재 플랫폼/브라우저 확인 범위는 [CONTRIBUTING.md](CONTRIBUTING.md)를 참조하세요.

## 제거

선택한 호스트의 plugin 관리 기능으로 해당 OmAgents 패키지를 제거하거나 비활성화하세요. DSH에서는 패키지 루트를 가리키는 `@omagents/omagents-dsh` Loader 행을 비활성화하면 Host와 Web Client가 모두 비활성화됩니다. Core는 설치된 호스트의 의존성으로만 남습니다. Python 환경은 자동 삭제되지 않습니다.

## 라이선스

MIT — [LICENSE](LICENSE)를 참조하세요.
