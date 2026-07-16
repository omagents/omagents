# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)
[![npm version](https://img.shields.io/npm/v/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![npm downloads](https://img.shields.io/npm/dm/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![GitHub stars](https://img.shields.io/github/stars/omagents/omagents?style=social)](https://github.com/omagents/omagents/stargazers)

[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

OpenCodeとCodex CLIのプラグインで、agent skills、MCP servers、並列実行、superpowersを1つのインストールにまとめて提供します。

---

## このREADMEをスキップ

以下をagentに貼り付けてください:

```
Read this and install omagents: https://raw.githubusercontent.com/omagents/omagents/main/README.md
```

---

## インストール

### TL;DR

| 目的 | 実行すること | 結果 |
| :--- | :--- | :--- |
| **安定版** (npm) | `opencode.json`のplugin配列に`"@omagents/omagents"`を追加 | npmからpluginが自動インストール、superpowersも同梱 |
| **バージョン固定** | `"@omagents/omagents@^0.1.0"`を追加 | 同上、ただしバージョン範囲に固定 |
| **最新版** (git) | `"@omagents/omagents@git+https://github.com/omagents/omagents.git"`を追加 | mainブランチの最新ソース |

### 人間向け

**前提条件:**
- [OpenCode](https://opencode.ai)がインストール済みで実行中
- [Python 3.11+](https://www.python.org/downloads/)がインストール済みでPATHに設定済み（deep-research、markitdown-converter、playwright-web-scraping、loop engineに必要）

1. OpenCodeの設定ファイルを開く:

```bash
open -e ~/.config/opencode/opencode.json
```

2. `plugin`配列に`@omagents/omagents`を追加:

```json
{
  "plugin": [
    "@omagents/omagents"
  ]
}
```

3. OpenCodeを再起動。

以上です。セッション開始時にOmAgentsは自動的に以下を実行します:
- **superpowers**をインストール（同梱済み、別途インストール不要）
- すべての**skills**を登録（OmAgents + Superpowers）
- すべての**MCP servers**を登録（agentmemory、codegraph、context7、websearch、github/grep_app）
- **並列実行**を有効化（background agents、`/ps`コマンド、`cancel_task`）
- `~/.venvs/omagents`に**Python venv**をセットアップ（report templates用に`jinja2`をインストール）
- **Pythonの前提条件**をチェック（Pythonが未インストールの場合はインストール手順を警告表示）

### LLM Agent向け

AI agentとしてユーザーのOmAgentsインストールを支援する場合、以下の手順に従ってください:

```bash
# 1. ユーザーの現在のOpenCode設定を読み取る
cat ~/.config/opencode/opencode.json

# 2. plugin配列に"@omagents/omagents"を追加
#    jqが利用可能なら使用、そうでなければ手動で編集

# 3. 編集後に設定が有効なJSONか確認

# 4. ユーザーにOpenCodeの再起動を伝える
```

pluginが他のすべてを自動的に処理します — MCP設定、skillインストール、venvセットアップはすべて不要です。

### オプション: API Keys

一部のリモートMCP serversは、レート制限の緩和にオプションのAPI keyを受け付けます:

```bash
# ~/.zshrc または ~/.bashrc
export EXA_API_KEY="your-exa-key"
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

`GITHUB_TOKEN`を設定すると、完全なGitHub Copilot MCP（issues、PRs、repos、code search）が有効になります。未設定の場合、OmAgentsは公開コード検索のみのVercelの`mcp.grep.app`にフォールバックします。

### 他のPluginとの併用

OmAgentsのhookマージ機構により、追加のpluginとの競合は発生しません:

```json
{
  "plugin": [
    "@omagents/omagents",
    "@devcxl/opencode-spec"
  ]
}
```

### Codex CLI

**前提条件：** [Python 3.11+](https://www.python.org/downloads/) がインストールされ、PATH に含まれていること。

```bash
npx @omagents/omagents
```

これにより、OmAgents プラグインが `~/.codex/plugins/cache/omagents/omagents/local/` にインストールされ、`~/.codex/config.toml` で有効になります。セッション開始時に、プラグインはバンドルされた skills、MCP servers を自動検出し、`SessionStart` hooks で Python venv をセットアップします。

OpenCode 独自の並列実行エンジンは利用できません。Codex のネイティブ subagent ツールを使用してください。

---

## ハイライト

| | 機能 | 説明 |
| :---: | :--- | :--- |
| 🔁 | **Loop Engineering（ループエンジニアリング）** | 反復型skill用の永続的タスクキュー。context clear後も保持、retry logic、統一サマリー。8つのskillで使用 |
| 🧠 | **Superpowers**（14 skills） | 実装前のbrainstorming、TDD、体系的debugging、plan作成、code review、git worktrees |
| 🔍 | **Deep Research** | items × fieldsマトリクスによるマルチソース反復research、gap detectionループ、Jinja2レポート |
| ⚡ | **並列実行** | `task(background: true)`によるbackground taskディスパッチ、永続化とsession isolation付きJob Board、`/ps`コマンド |
| 📚 | **組み込みMCP** | agentmemory、codegraph、context7、websearch、github/grep_app — すべて自動登録 |
| 🐍 | **Python Tooling** | `~/.venvs/omagents`に専用venv、jinja2およびskill依存関係を自動インストール |
| 📄 | **MarkItDown** | PDF、DOCX、XLSX、PPTX、HTMLをMarkdownに変換 |
| 📊 | **OfficeCLI** | officecli を使って .docx/.xlsx/.pptx を作成・分析・校正・編集 |
| 🌐 | **Web Scraping** | Playwrightベースのページ取得・スクレイピング |
| 🔗 | **GitHub** | `GITHUB_TOKEN`設定時に完全なGitHub API; 未設定時は`mcp.grep.app`にフォールバック |
| 🏗️ | **Refactor** | loop engine検証付きの体系的コードリファクタリング |
| 🛡️ | **Hyperplan** | 3つの並列criticによる対抗的planレビュー（security、architecture、edge cases） |
| 🔧 | **Code Intelligence** | LSP guide + AST-grepによる構造的コード検索・書き換え |

---

## Loop Engineering

OmAgentsはAI agent skill向けの**Loop Engineering**を開拓しています。「すべてをスキャンして修正する」というワンショットプロンプトの代わりに、loopベースのskillは検証を伴いながらアイテムを1つずつ処理する永続的タスクキューを使用します。

### 仕組み

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

**状態は永続化**されます — `.omagents/loops/<skill>/tasks.json`に保存され、agentのcontextがタスク途中でクリアされても、正確に中断箇所から再開できます。

**Retry logic:** 失敗したタスクはblockedとマークされる前に最大3回retryします。

**Compaction対応:** `experimental.session.compacting` hookがloop engineの状態をcompactionプロンプトに注入するため、agentはcontext clear後に再開すべきことを認識します。

### Loop Engineeringを使用するSkills

| Skill | ループ対象 | 検証 |
|-------|-------------------|--------------|
| `deep-research` | Research tasks -> gap detection -> 新規tasks | Findings検証 + coverageマトリクス |
| `remove-ai-slops` | ソースファイル（1タスク1ファイル） | Lint / test合格 |
| `remove-deadcode` | Dead code候補（1タスク1件） | 削除後にtest合格 |
| `github-triage` | 未解決issues（1タスク1件） | ラベル付与成功 |
| `tech-debt-audit` | 監査カテゴリ（1タスク1カテゴリ） | Findings収集完了 |
| `pre-publish-review` | リリースチェックリスト項目（1タスク1項目） | 各チェック合格 |
| `hyperplan` | 3つの並列critic（順次ではなく追跡） | Criticがfindingsを生成 |
| `refactor` | リファクタリング対象（1タスク1ファイル） | リファクタリング後にtest合格 |

### Loop Engine API

```bash
loop_engine.py init <skill> '<tasks_json>'   # タスクキューを初期化
loop_engine.py next <skill>                   # 次のpending taskを取得
loop_engine.py complete <skill> <id> [result] # タスクを完了としてマーク
loop_engine.py fail <skill> <id> [error]      # タスクを失敗としてマーク（3回retry）
loop_engine.py status <skill>                 # 統計を表示
loop_engine.py summary <skill>                # アイコン付き全タスクリスト
loop_engine.py reset <skill>                  # キューをクリア
loop_engine.py add <skill> '<task_json>'      # 既存キューにタスクを追加
```

---

## 含まれるもの

### Skills

| Skill | ソース | Loop? | 説明 |
|-------|--------|-------|------|
| `deep-research` | OmAgents | Yes | マルチソース反復research、items × fields、gap detection、Jinja2レポート |
| `parallel-execution` | OmAgents | - | Job Board追跡付きbackground並列taskディスパッチ |
| `agents-python-tools` | OmAgents | - | Python toolingを専用`~/.venvs/omagents` venvにルーティング |
| `markitdown-converter` | OmAgents | - | ドキュメント（PDF、DOCX、XLSX等）をMarkdownに変換 |
| `officecli` | OmAgents | - | officecli CLI で Office 文書（.docx/.xlsx/.pptx）の作成・分析・校正・編集 |
| `playwright-web-scraping` | OmAgents | - | PlaywrightによるWeb scraping・ページ取得 |
| `init-deep` | OmAgents | - | 階層的AGENTS.mdファイルの自動生成 |
| `doctor` | OmAgents | - | OmAgentsのインストール・設定の診断 |
| `remove-ai-slops` | OmAgents | Yes | AI生成コードアーティファクトのクリーンアップ（loop: ファイルごと） |
| `remove-deadcode` | OmAgents | Yes | 未参照コードの検出・削除（loop: 候補ごと） |
| `github-triage` | OmAgents | Yes | GitHub issuesのトリアージ・カテゴリ分け（loop: issueごと） |
| `tech-debt-audit` | OmAgents | Yes | コードベースのtechnical debt監査（loop: カテゴリごと） |
| `lsp-guide` | OmAgents | - | 適切なcode intelligence toolの使用をガイド（LSP、codegraph、grep、ast-grep） |
| `ast-grep` | OmAgents | Optional | AST対応コード検索・書き換え（grepフォールバック付き） |
| `work-with-pr` | OmAgents | - | github MCPによるPRライフサイクル管理 |
| `pre-publish-review` | OmAgents | Yes | 公開前リリースゲートチェックリスト（loop: チェックごと） |
| `hyperplan` | OmAgents | Yes | 3つの並列criticによる対抗的planレビュー（loop: critic追跡） |
| `refactor` | OmAgents | Yes | 検証付き体系的コードリファクタリング（loop: ファイルごと） |
| `superpowers` (14 skills) | Superpowers | - | Brainstorming、TDD、debugging、planning、git worktrees等 |

### MCP Servers

| MCP | タイプ | 備考 |
|-----|------|-------|
| `agentmemory` | Local | Session memoryとaudit |
| `codegraph` | Local | コードベースのsymbol graph・探索 |
| `context7` | Remote | ドキュメント検索（無料枠あり） |
| `websearch` | Remote | Exa経由のWeb検索（無料枠あり） |
| `github` / `grep_app` | Remote | `GITHUB_TOKEN`設定時にGitHub Copilot MCP; 未設定時は公開コード検索用`mcp.grep.app` |

### 並列実行

- OpenCodeネイティブの`task(background: true)`によるbackground taskディスパッチ
- 自動結果注入付きJob Board追跡
- **永続化**: Job Boardは再起動後も保持（`job-board.json`に保存）
- **Session isolation**: 各sessionは自身のjobのみ参照（cross-session leakなし）
- **Compaction対応**: loop engineとJob Boardの状態はcontext compaction後も保持
- `/ps`コマンドで実行中タスクを確認
- `cancel_task` toolでbackground taskをキャンセル
- `parallel_status` toolでプログラマティックなステータス確認

---

## アーキテクチャ

OmAgentsは階層型システムとして設計されています:

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

**OmAgentsはinfrastructure layerです。** agentが必要とするtoolsと機能を提供します: 外部データ用のMCP servers、background task用の並列実行、researchワークフロー、Python環境管理。

**Superpowersはprocess skills layerです。** 再利用可能な開発ワークフローを提供します: 実装前のbrainstorming、test-driven development、体系的debugging、planの作成と実行、code review、git worktree管理。

**User choice layerは同梱されていません。** 開発方法論は選択肢です — spec-driven development（OpenSpec）、チームベースのengineering workflow（gstack）、あるいは方法論なし。OmAgentsは中立的であり、ユーザーがプロジェクトに合ったものを選択できます。

---

## アンインストール

1. OpenCodeの設定からpluginを削除:

```bash
# jqを使用
jq '.plugin = [.plugin[] | select(. != "@omagents/omagents")]' \
    ~/.config/opencode/opencode.json > /tmp/oc.json && \
    mv /tmp/oc.json ~/.config/opencode/opencode.json
```

2. Python venvを削除（オプション）:

```bash
rm -rf ~/.venvs/omagents
```

3. OpenCodeを再起動。

---

## 開発

プロジェクト構造:

```
omagents/
├── index.js                  # 統合エントリ（OpenCode プラグインエクスポート + Codex CLI インストーラー）
├── .opencode/plugins/
│   ├── index.js              # OpenCode プラグイン（superpowers + omagents hooks をマージ）
│   └── parallel.js           # 並列実行エンジン
├── .codex/plugins/
│   └── install.js            # Codex インストーラー（npx @omagents/omagents で実行）
├── hooks/
│   └── setup-venv.sh         # 共有 venv セットアップ hook（OpenCode + Codex）
├── skills/                   # バンドルされた skills（18 OmAgents + 14 Superpowers）
│   ├── _shared/scripts/      # 共有スクリプト（loop_engine.py）
│   ├── deep-research/        # gap detection 付きリサーチワークフロー
│   └── ...                   # その他の skills
├── mcp-servers/
│   └── base.json             # MCP server 定義（単一ソース）
├── tests/                    # Node.js 組み込みテストランナー
├── AGENTS.md                 # AI agent コンテキストファイル
├── package.json              # superpowers 依存関係を含む
└── README.md
```

### テスト

```bash
# すべてのテストを実行
npm test

# フォーマットをチェック
npm run format:check

# コードをフォーマット
npm run format
```

### 公開

OmAgentsはOIDC Trusted Publishingを使用します — npm tokenは不要です。

```bash
# バージョンを上げる
npm version patch   # 0.1.0 -> 0.1.1

# タグをpush（GitHub Actionsで自動公開がトリガー）
git push && git push --tags
```

[npmjs.com](https://www.npmjs.com/package/@omagents/omagents) -> Settings -> Trusted PublisherでTrusted Publisherを設定してください。

---

## ライセンス

MIT — [LICENSE](LICENSE)を参照。
