# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)
[![npm version](https://img.shields.io/npm/v/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![npm downloads](https://img.shields.io/npm/dm/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![GitHub stars](https://img.shields.io/github/stars/omagents/omagents?style=social)](https://github.com/omagents/omagents/stargazers)

[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

OmAgentsは、**OpenCode**、**Codex**、**DeepSeek Harness (DSH)**向けのマルチホストagentツールキットです。18個のOmAgents skills、15個のSuperpowers skills、MCP servers、ネイティブbackground agent統合、Deep Research、Pythonツールを同梱し、共有Coreパッケージが状態とホスト非依存の動作を統一します。

---

## インストール

使用するホストのパッケージを選択してください。インストーラーにホストの位置引数はありません。

```bash
# OpenCode
npx @omagents/omagents

# Codex
npx @omagents/omagents-codex

# DeepSeek Harness
dsh plugin --profile web add @omagents/omagents-dsh
```

インストール後にホストを再起動してください。`@omagents/core`は依存関係として自動的にインストールされるため、**pluginとして別途インストールしないでください**。現在のリリース候補では、4つのパッケージすべてが**0.16.1**に揃っています。

Pythonを使用するskillsには、PATH上のPython 3.11+が必要です。DSHにはNode.js 24.9以降と、パッケージが検証済みの互換範囲として宣言するDSHバージョンが必要です。

### 検索ProviderとオプションのAPI Keys

```bash
export OMAGENTS_SEARCH_PROVIDER="auto"  # デフォルト。単一providerへの直接接続には "exa"、"keenable"、または "youcom"
export EXA_API_KEY="your-exa-key"
export KEENABLE_API_KEY="your-keenable-key"  # オプション
export YDC_API_KEY="your-youcom-key"  # オプション
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

- **`OMAGENTS_SEARCH_PROVIDER`**：`auto`、`exa`、`keenable`、`youcom`をサポートし、`auto`は未設定または空の場合のデフォルトです。認証情報がproviderを切り替えることはなく、未対応の値は明示的なエラーになります。
- **`EXA_API_KEY`**：ホスト型Exaを`x-api-key`で認証します。未設定でも同じエンドポイントを匿名で利用できます。これは自動Proxyと明示的な直接Exa登録の両方に適用されます。
- **`KEENABLE_API_KEY`**：自動フォールバックと明示的な`keenable`の両方でオプションです。キーがある場合は`X-API-Key`で`https://api.keenable.ai/mcp`を使用し、ない場合はキー不要の`https://api.keenable.ai/mcp-public`を使用します。公開層はIPごとに1時間あたり1,000リクエスト、1秒あたり10リクエストに制限され、検索クエリまたは取得URLとprompt、IP、User-Agent、`X-Keenable-Title`が記録されます。Codexでは、設定したキーはExaと同様に`.mcp.json`に書き込まれます。
- **`YDC_API_KEY`**：自動フォールバックと明示的な`youcom`の両方でオプションで、直接登録名は`youdotcom`です。キーがある場合は`Authorization: Bearer <YDC_API_KEY>`で`https://api.you.com/mcp`を使用し、ない場合はAuthorizationヘッダーやOAuthフローなしでキー不要の`https://api.you.com/mcp/free`を使用します。公式の[You.com MCPドキュメント](https://you.com/docs/agents/mcp-server#choose-your-setup)では、キー不要エンドポイントの上限は1日100クエリとされています。キー不要とはアカウント認証情報が不要という意味であり、ネットワークトラフィックの匿名性やproviderによるログ記録の不存在を意味しません。
- **`CONTEXT7_API_KEY`**：ローカル`@upstash/context7-mcp` serverのレート制限を緩和するオプションの認証情報です。
- **`GITHUB_TOKEN`**：GitHub Copilot MCPを有効にします。未設定の場合、OmAgentsは`mcp.grep.app`で公開コードを検索します。

`auto`では、1つのローカル`websearch` Search MCP Proxyが初期には**Exa → Keenable → You.com**の順で動作します。最初にExaを呼び出し、フォールバック対象のExa失敗後にのみKeenableを最大1回試行し、その後フォールバック対象のKeenable失敗時にのみYou.comを最大1回試行します。フォールバック対象のExa失敗が発生すると、同じProxyプロセスでは、その後のすべての呼び出し（そのプロセスを共有する他のsessionからの呼び出しを含む）で**Keenable → You.com → Exa**の順を使用します。Proxyを再作成すると（通常はホストserviceの再起動）、初期順序に戻ります。この状態はメモリ内だけに保持され、クールダウンはありません。成功した空の結果、認証または権限の失敗、無効なパラメータ、明示的な再試行不可の失敗、呼び出し元のキャンセルでは、フォールバックも順序変更も行いません。各providerの試行は呼び出しごとに最大1回で、バックエンド試行ごとに30秒の上限には遅延初期化とツール呼び出しが含まれます。3回すべてを試行する呼び出しでは約90秒のバックエンド上限となり、わずかなローカル処理時間は含みません。

Proxyは汎用の`search`と`fetch`を公開し、`fetch`は厳密に1つの`http`または`https` URLを受け付けます。OpenCodeでは`websearch_search`と`websearch_fetch`、CodexとDSHでは`mcp__websearch__search`と`mcp__websearch__fetch`という名前になります。明示的な`exa`、`keenable`、`youcom`は、直接登録とproviderネイティブのツール名を保持します。You.comの直接登録では`youdotcom`と`you-search`/`you-extract`を使用します。

You.comの試行では、汎用searchが`you-search`にマッピングされ、`query`を変更せずに転送し、`maxResults`を`count`にマッピングします（デフォルト10、範囲1～50）。汎用fetchは、キー付きとキー不要に共通するサブセットを使い、`you-extract`には`url`のみを渡します。You.comには`objective`と`maxCharacters`に直接相当するものがないため、Proxyはその試行でのみこれらを省略し、ローカルでクエリを書き換えたり応答を切り詰めたりしません。ExaとKeenableの成功メタデータは変更されません。2回のフォールバック対象の失敗後にYou.comが成功した場合、`provider: "youcom"`を報告し、最初の失敗を示す`fallback`を保持したまま、順序付き`fallbacks`メタデータと、以前のフォールバック対象の失敗ごとの可読な`Fallback`行を追加します。

**プライバシーとオプトアウト：**自動フォールバックでは、同じ検索クエリ、オプションの`objective`、または対象URLがExa、Keenable、You.comに開示される可能性があります。特にフォールバック対象のExa失敗では、同じ検索クエリまたはURLをKeenableに送信する場合があり、Keenableキーが未設定の場合は公開層のログ記録も適用されます。その後のフォールバック対象のKeenable失敗では、クエリまたはURLがYou.comに送信される場合があります。You.comは`objective`をネイティブ引数として受け取りませんが、前のproviderが受け取っている場合があります。直接のExa動作を維持して自動フォールバックを防ぐには、明示的に`exa`を選択してください。明示的な`keenable`と`youcom`も単一providerへのオプトアウトです。このフォールバック保証は内蔵Proxy経由の呼び出しだけに適用されます。OmAgentsが無効化できないホストネイティブのWebツールは対象外であり、ユーザー定義の`websearch`または`youdotcom` MCPはユーザー所有のまま優先され、ラップされません。

**Codexの設定タイミング：** Codexはインストーラーの実行時にproviderと認証情報の設定を取り込みます。インストール前に環境変数を設定してください。providerまたはキー（`YDC_API_KEY`を含む）を変更した後は、`OMAGENTS_SEARCH_PROVIDER="keenable" npx @omagents/omagents-codex`のようにインストーラーを再実行し、同じ環境でCodexを再起動してください。再インストールではコピーされたProxyが更新され、古いproviderエントリと認証情報が置き換えられます。

Codexでは、Bearer環境変数の間接参照はMCP serverの所有者ごとに決まり、`github`は`bearer_token_env_var = "GITHUB_TOKEN"`、直接の`youdotcom`は`bearer_token_env_var = "YDC_API_KEY"`を使用するため、Bearerシークレットはシリアライズされません。自動ローカルProxyでは、設定された`YDC_API_KEY`は`.mcp.json`内のstdio `env`値のままです。Codex pluginの`.mcp.json`契約には、Exaの`x-api-key`、Keenableの`X-API-Key`、Context7のstdio `env`に相当する間接参照がないため、設定されたExa、Keenable、Context7の値はこのファイルに書き込まれます。POSIXモードを尊重するプラットフォームでは、インストーラーは非公開ディレクトリを`0700`で作成し、`.mcp.json`を`0600`で書き込み・再書き込みします。

## サポートマトリクス

| ホストまたは役割 | パッケージ | インストール | Skills | バックグラウンド実行と復旧 | 管理サーフェス |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenCode 1.xおよびOpenCode 2.x** | `@omagents/omagents` | `npx @omagents/omagents` | **33**：OmAgents 18 + Superpowers 15 | V1は`task(background: true)`、V2は常にバックグラウンドで実行されるネイティブ`subagent(...)`を使用。永続Core Job Board、完了配信、復旧。 | `/ps`、`parallel_status`、`cancel_task`、親コンテキストへの結果、OpenCode TUI状態 |
| **Codex** | `@omagents/omagents-codex` | `npx @omagents/omagents-codex` | **33**：OmAgents 18 + Superpowers 15 | Codexネイティブsubagents。OpenCode並列エンジンとDSH Web Job Boardはインストールされません。 | Codexネイティブインターフェースとskills |
| **DeepSeek Harness (DSH)** | `@omagents/omagents-dsh` | `dsh plugin --profile web add @omagents/omagents-dsh` | **33**：OmAgents 18 + Superpowers 15 | ネイティブ非同期`subagent`ライフサイクル、永続`job-board.json`、キャンセル、復旧、`/ps`、`parallel_status`、`cancel_task` | 認可されたRemote `watchJobs`ストリームとネイティブReact Web Job Board |
| **共有ライブラリ（ホストpluginではない）** | `@omagents/core` | 自動依存関係。ユーザーによる個別インストール不要 | 共有skill定義とSuperpowersアセット | ホスト非依存の実行状態、永続化、MCP解決、researchアセット、Python環境 | スタンドアロンUIなし |

各ホストパッケージは、揃ったバージョンのCoreだけに依存し、他のホストパッケージには依存しません。

## 主な機能

| 機能 | 内容 |
| :--- | :--- |
| **Loop Engineering** | 反復skills向けの永続タスクキュー、retry、検証、再開可能な状態 |
| **Superpowers** | Brainstorming、TDD、体系的debugging、plan、code review、worktree、検証 |
| **Deep Research** | マルチソースitems × fields research、gap detection、永続evidence、Jinja2レポート |
| **Parallel Execution** | OpenCodeとDSHで共有Core実行モデルを使うホストネイティブbackground agents |
| **DSH Web Job Board** | ネイティブReactのフィルター、詳細、通知状態、確認付きキャンセル、再接続、health表示 |
| **組み込みMCPs** | agentmemory、codegraph、context7、websearch/keenable/youdotcom、github/grep_app |
| **Python Tooling** | 永続agent baseとオンデマンドproject overlay。既存project `.venv`は変更しません |
| **文書・Webツール** | MarkItDown変換、OfficeCLI文書、Playwright scraping |
| **Code Intelligence** | LSPガイダンスとgrepフォールバック付きAST検索・書き換え |
| **HyperplanとRefactor** | 3 criticによる adversarial plan reviewと検証付き反復refactoring |

## Python環境

永続agent baseで自動provisionされるのは`jinja2`だけです。MarkItDownやPlaywrightなどのオプションPythonツールは、対応するskillが必要とするときに**オンデマンドでインストール**され、自動セットアップには含まれません。project依存関係はオンデマンドoverlayを使用し、既存project `.venv`を変更する必要はありません。

環境の選択、クロスプラットフォームパス、CLI手順は`agents-python-tools` skillを参照してください。このリポジトリのprojectコマンドは`packages/core/hooks/project-venv.js`に実装されています。baseとproject環境のどちらも自動削除されません。

## Loop EngineeringとDeep Research

Loopベースのskillsは一度に1項目を処理し、状態を`.omagents/loops/<skill>/tasks.json`に永続化します。失敗したタスクはblockedになる前に最大3回retryします。context clear後も状態が残るため、ワークフローを最初からやり直さず再開できます。

Deep Researchでは、`--workspace <dir>`を公開成果物だけに使用します。plan、raw findings、checkpoint、派生artifact、provenance、run別queueは`.omagents/deep-research/<run-id>/`に保存されます。これらの内部状態を含むworkspaceでは新規runが拒否されます。legacy workspaceは自動移行せず、そのまま読み取り・再開できます。Jinja2テンプレートは`packages/core/skills/deep-research/templates/`にあり、ルートレベルの`templates/`ディレクトリはありません。

## SkillsとMCP Servers

18個のOmAgents skillsは次のとおりです。

`deep-research`、`parallel-execution`、`agents-python-tools`、`markitdown-converter`、`officecli`、`playwright-web-scraping`、`init-deep`、`doctor`、`remove-ai-slops`、`remove-deadcode`、`github-triage`、`tech-debt-audit`、`lsp-guide`、`ast-grep`、`work-with-pr`、`pre-publish-review`、`hyperplan`、`refactor`。

Superpowersはさらに15個のプロセスskillsを提供します。Coreは`opencode-v1`、`opencode-v2`、`codex`、`dsh`向けに共有skillsをレンダリングし、制御フローが異なる場合は完全なホスト別overrideを使用します。Superpowers skillsでは、`docs/superpowers`をルートとするドキュメントパスをすべて`docs`をルートとするパスにレンダリングし、後続のディレクトリ（例：`docs/specs/`や`docs/plans/`）を保持します。既存のドキュメントは自動移行されません。OpenCode V2とDSHは、いずれも`background`引数を付けないネイティブ`subagent`セマンティクスを使用します。

| MCP | 種類 | 動作 |
| :--- | :--- | :--- |
| `agentmemory` | ローカル | Session memoryとaudit |
| `codegraph` | ローカル | コードベースsymbol graphと探索 |
| `context7` | ローカル | `@upstash/context7-mcp`によるドキュメント検索 |
| `websearch` | `auto`ではローカル、明示的な`exa`ではリモート | 自動`Exa → Keenable → You.com` Proxy、または匿名/`EXA_API_KEY`認証の直接ホスト型Exa MCP |
| `keenable` | リモート | `keenable` provider選択時はキー付きプライベートMCPまたはキー不要の公開エンドポイントを利用 |
| `youdotcom` | リモート | `youcom` provider選択時はキー付き`https://api.you.com/mcp`またはキー不要の`https://api.you.com/mcp/free`を利用 |
| `github` / `grep_app` | リモート | tokenがある場合はGitHub Copilot MCP、ない場合は`mcp.grep.app`で公開コード検索 |

ユーザー定義のMCP設定は組み込み登録より優先されます。

## DSH Job Boardの動作

DSHパッケージは、skillsだけのpluginではなく、完全なHostとWeb Clientをインストールします。Web Job Boardはrevision付きのRemote whole-set framesを消費し、再接続後は新しいbaselineから開始します。実行中jobのpollingは行いません。all/running/attention/finishedフィルター、結果・エラー詳細、通知状態、キャンセル確認、stale/permission/degraded表示、DSHテーマ統合を提供します。

キャンセル要求の受理は、終了の確認ではありません。ローカル中断は子agentの**現在のturn**だけを停止し、その**descendantsは個別にキャンセルしない限り実行を継続**します。**External one-shot**の実行は完全に停止し、**再開できません**。UIで詳細を表示しても、モデル通知がacknowledgeされることはありません。

再起動後、DSHは永続化されたjobsをホストの権威ある状態と照合します。**権威的に観測可能なアクティブな実行がない場合にのみ**、結果が見つからない、または読み取れないjobは`interrupted`になり、成功が偽装されることはありません。観測済みの**active external**実行は、**cold session-not-found**（コールド開始時のSession欠落）でもアクティブなまま維持され、中断と誤分類されません。Remoteアクセスは、アクティブなDSH profileと認可されたparent-session scopeによって制限されます。UI、キャンセル、復旧、認可、セキュリティ、トラブルシューティングについては、[DSHパッケージガイド](packages/dsh/README.md)と[Job Boardガイド](packages/dsh/docs/job-board.md)を参照してください。

## アーキテクチャ

```text
┌─────────────────────────────────────────────────┐
│ ユーザー選択レイヤー（非同梱）                   │
│ OpenSpec · gstack · custom workflows · none     │
├─────────────────────────────────────────────────┤
│ プロセスskillsレイヤー（同梱Superpowers）         │
├─────────────────────────────────────────────────┤
│ OmAgentsインフラと共有Core                       │
│ Skills · MCP · Job Board · research · Python    │
├─────────────────────────────────────────────────┤
│ OpenCode · Codex · DeepSeek Harness             │
└─────────────────────────────────────────────────┘
```

OmAgentsはインフラを提供し、開発方法論を強制しません。Superpowersは再利用可能なプロセスskillsを提供します。OpenSpecやgstackなどの方法論は、引き続きユーザーが個別に選択できます。

## 開発

このリポジトリは、`packages/core`、`packages/opencode`、`packages/codex`、`packages/dsh`を含む非公開npm-workspacesルートです。リポジトリの`.opencode/plugins/index.js`は開発専用のre-exportだけで、製品コードは各パッケージにあります。Deep Researchテンプレートは`packages/core/skills/deep-research/templates/`にあります。

```bash
# すべてのルート・workspaceテスト
npm test

# DSHをビルドしてテスト
npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh

# パック済みartifactとブラウザー検証
npm run pack:all
npm run test:packed
npm run test:browser
```

すべてのリリースで1つの揃ったバージョンを使用し、**4つのパッケージすべてをまとめてビルド、テスト、パック、公開**する必要があります。順序は次で固定です。

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

すべてのホストがCoreに依存するため、Coreを最初に公開します。ホストを順次公開するのは、ログと失敗処理を決定的にするためだけで、ホスト間の依存関係はありません。検証要件と現在のプラットフォーム/ブラウザー確認範囲は[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。

## アンインストール

選択したホストのplugin管理機能を使って、対応するOmAgentsパッケージを削除または無効にしてください。DSHでは、パッケージルートを指す`@omagents/omagents-dsh` Loader行を無効にすると、HostとWeb Clientの両方が無効になります。Coreはインストール済みホストの依存関係としてのみ残ります。Python環境は自動削除されません。

## ライセンス

MIT — [LICENSE](LICENSE)を参照してください。
