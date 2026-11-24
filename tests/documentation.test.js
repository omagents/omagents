import { test } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const READMES = ["README.md", "README.zh-cn.md", "README.ja.md", "README.ko.md"]
const PACKAGE_MANIFESTS = [
  "packages/core/package.json",
  "packages/opencode/package.json",
  "packages/codex/package.json",
  "packages/dsh/package.json",
]
const HOST_MANIFESTS = PACKAGE_MANIFESTS.slice(1)
const PACKAGE_NAMES = [
  "@omagents/core",
  "@omagents/omagents",
  "@omagents/omagents-codex",
  "@omagents/omagents-dsh",
]
const INSTALL_COMMANDS = [
  "npx @omagents/omagents",
  "npx @omagents/omagents-codex",
  "dsh plugin --profile web add @omagents/omagents-dsh",
]
const RELEASE_ORDER = PACKAGE_NAMES.join(" → ")
const DSH_WORKSPACE_TEST =
  "npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh"
const AGENT_GUIDES = [
  "AGENTS.md",
  "packages/core/AGENTS.md",
  "packages/opencode/AGENTS.md",
  "packages/codex/AGENTS.md",
  "packages/dsh/AGENTS.md",
]
const YOUCOM_OFFICIAL_DOCS = "https://you.com/docs/agents/mcp-server#choose-your-setup"

function read(relativePath) {
  const filePath = path.join(ROOT, relativePath)
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath))
}

function commandLinePattern(command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escaped}$`, "m")
}

test("every README language has exactly the approved host installation surface", () => {
  for (const file of READMES) {
    const text = read(file)
    for (const command of INSTALL_COMMANDS) {
      assert.match(text, commandLinePattern(command), `${file} must contain: ${command}`)
    }
    assert.doesNotMatch(text, /npx\s+@omagents\/omagents\s+codex\b/, file)
    assert.doesNotMatch(text, /npx\s+@omagents\/omagents\s+opencode\b/, file)
    assert.ok(text.includes("@omagents/core"), `${file} must identify the shared Core package`)
    assert.ok(text.includes("0.16.0"), `${file} must identify the aligned release candidate`)
  }
})

test("installation command anchors cannot confuse OpenCode and Codex package names", () => {
  const openCodeCommand = commandLinePattern(INSTALL_COMMANDS[0])
  assert.match("npx @omagents/omagents", openCodeCommand)
  assert.doesNotMatch("npx @omagents/omagents-codex", openCodeCommand)
})

test("every README language has a complete host and shared-Core support matrix", () => {
  for (const file of READMES) {
    const text = read(file)
    for (const packageName of PACKAGE_NAMES) {
      assert.ok(text.includes(packageName), `${file} omits ${packageName}`)
    }
    for (const required of [
      "OpenCode 1.x",
      "OpenCode 2.x",
      "Codex",
      "DeepSeek Harness",
      "33",
      "18",
      "15",
      "parallel_status",
      "cancel_task",
      "/ps",
      "Remote",
      "React",
      "job-board.json",
    ]) {
      assert.ok(text.includes(required), `${file} support matrix omits ${required}`)
    }
  }
})

test("search provider guidance stays synchronized across READMEs and credential contracts", () => {
  const rateLimits = {
    "README.md": ["1,000 requests/hour", "10 requests/second"],
    "README.zh-cn.md": ["每小时 1,000 次请求", "每秒 10 次请求"],
    "README.ja.md": ["1時間あたり1,000リクエスト", "1秒あたり10リクエスト"],
    "README.ko.md": ["시간당 1,000건", "초당 10건"],
  }
  const autoGuidance = {
    "README.md": [
      "the default when unset or empty",
      "tries Exa first",
      "fallback-eligible Exa failure",
      "Successful empty results",
      "authentication or permission failures",
      "non-retryable failures",
      "caller cancellation",
      "30 seconds per backend attempt",
      "exactly one `http` or `https` URL",
      "same search query or URL to Keenable",
      "Select explicit `exa`",
      "native host web tools",
      "user-defined `websearch`",
    ],
    "README.zh-cn.md": [
      "未设置或为空时默认",
      "先调用 Exa",
      "符合回退条件的 Exa 失败",
      "成功的空结果",
      "身份验证或权限失败",
      "不可重试失败",
      "调用方取消",
      "每个后端尝试 30 秒",
      "恰好一个 `http` 或 `https` URL",
      "相同的搜索查询或 URL 发送给 Keenable",
      "显式选择 `exa`",
      "宿主原生 Web 工具",
      "用户自定义的 `websearch`",
    ],
    "README.ja.md": [
      "未設定または空の場合のデフォルト",
      "最初にExaを呼び出し",
      "フォールバック対象のExa失敗",
      "成功した空の結果",
      "認証または権限の失敗",
      "再試行不可の失敗",
      "呼び出し元のキャンセル",
      "バックエンド試行ごとに30秒",
      "厳密に1つの`http`または`https` URL",
      "同じ検索クエリまたはURLをKeenableに送信",
      "明示的に`exa`を選択",
      "ホストネイティブのWebツール",
      "ユーザー定義の`websearch`",
    ],
    "README.ko.md": [
      "설정하지 않았거나 비어 있을 때 기본값",
      "먼저 Exa를 호출",
      "fallback 대상 Exa 실패",
      "성공적인 빈 결과",
      "인증 또는 권한 실패",
      "재시도 불가 실패",
      "호출자 취소",
      "백엔드 시도당 30초",
      "정확히 하나의 `http` 또는 `https` URL",
      "동일한 검색 쿼리 또는 URL을 Keenable로 전송",
      "명시적으로 `exa`를 선택",
      "호스트 네이티브 Web 도구",
      "사용자 정의 `websearch`",
    ],
  }
  for (const file of READMES) {
    const text = read(file)
    for (const required of [
      "OMAGENTS_SEARCH_PROVIDER",
      "KEENABLE_API_KEY",
      "https://api.keenable.ai/mcp",
      "https://api.keenable.ai/mcp-public",
      "X-API-Key",
      "X-Keenable-Title",
      "prompt",
      "`auto`",
      "`websearch_search`",
      "`websearch_fetch`",
      "`mcp__websearch__search`",
      "`mcp__websearch__fetch`",
      ...autoGuidance[file],
      ...rateLimits[file],
      'OMAGENTS_SEARCH_PROVIDER="keenable" npx @omagents/omagents-codex',
      "| `keenable` |",
    ]) {
      assert.ok(text.includes(required), `${file} omits ${required}`)
    }
    assert.match(text, /user[- ]agent/i, `${file} omits User-Agent logging`)
    assert.doesNotMatch(text, /OMAGENTS_KEENABLE/, file)
  }
  for (const file of ["AGENTS.md", "packages/codex/AGENTS.md"]) {
    const text = read(file)
    assert.ok(text.includes("OMAGENTS_SEARCH_PROVIDER"), file)
    assert.ok(text.includes("KEENABLE_API_KEY"), file)
    assert.ok(text.includes("X-API-Key"), file)
  }
})

const README_YOUCOM_CONTRACT = {
  "README.md": {
    providerList: "supports `auto`, `exa`, `keenable`, and `youcom`;",
    keylessTransport:
      "without one, it uses keyless `https://api.you.com/mcp/free` with no Authorization header or OAuth flow",
    keylessPrivacy:
      "Keyless means no account credential, not anonymous network traffic or an absence of provider logging.",
    rateLimit: "100 queries/day",
    timeout30: "30 seconds per backend attempt, including lazy initialization and the tool call",
    timeout90: "approximate 90-second backend upper bound",
    maxResults: "maps `maxResults` to `count`",
    urlOnly: "passes only `url` to `you-extract`",
    degradation:
      "You.com has no direct equivalent for `objective` or `maxCharacters`; the Proxy omits them only for that attempt",
    noRewrite: "without local query rewriting or response truncation",
    existingMetadata: "Exa and Keenable success metadata remains unchanged.",
    firstFallback: "retains `fallback` for the first failure",
    orderedFallbacks: "adds ordered `fallbacks` metadata",
    privacy: "same search query, optional objective, or target URL to Exa, Keenable, and You.com",
    optOut: "explicit `keenable` and `youcom` are also single-provider opt-outs",
    codexOwner:
      '`github` uses `bearer_token_env_var = "GITHUB_TOKEN"`, while direct `youdotcom` uses `bearer_token_env_var = "YDC_API_KEY"`',
    codexProxyEnv:
      "For the automatic local Proxy, configured `YDC_API_KEY` remains a stdio `env` value in `.mcp.json`",
    reinstall: "rerun the installer",
    restart: "restart Codex",
  },
  "README.zh-cn.md": {
    providerList: "支持 `auto`、`exa`、`keenable` 和 `youcom`；",
    keylessTransport:
      "未设置时使用免密钥的 `https://api.you.com/mcp/free`，不发送 Authorization header，也不需要 OAuth 流程",
    keylessPrivacy: "免密钥表示不需要账户凭据，并不表示网络流量匿名或 provider 不记录日志。",
    rateLimit: "每天 100 次查询",
    timeout30: "每个后端尝试 30 秒的上限包括延迟初始化和工具调用",
    timeout90: "约 90 秒的后端总上限",
    maxResults: "将 `maxResults` 映射为 `count`",
    urlOnly: "只向 `you-extract` 传递 `url`",
    degradation:
      "You.com 没有与 `objective` 或 `maxCharacters` 直接对应的参数；Proxy 仅在该尝试中忽略它们",
    noRewrite: "不会在本地改写查询或截断响应",
    existingMetadata: "Exa 和 Keenable 的成功元数据保持不变。",
    firstFallback: "保留描述首次失败的 `fallback`",
    orderedFallbacks: "添加有序的 `fallbacks` 元数据",
    privacy: "相同的搜索查询、可选 `objective` 或目标 URL 披露给 Exa、Keenable 和 You.com",
    optOut: "显式 `keenable` 和 `youcom` 也是单 provider 退出选项",
    codexOwner:
      '`github` 使用 `bearer_token_env_var = "GITHUB_TOKEN"`，而直连 `youdotcom` 使用 `bearer_token_env_var = "YDC_API_KEY"`',
    codexProxyEnv:
      "对于自动本地 Proxy，已配置的 `YDC_API_KEY` 仍是 `.mcp.json` 中的 stdio `env` 值",
    reinstall: "重新运行安装器",
    restart: "重启 Codex",
  },
  "README.ja.md": {
    providerList: "`auto`、`exa`、`keenable`、`youcom`をサポートし",
    keylessTransport:
      "ない場合はAuthorizationヘッダーやOAuthフローなしでキー不要の`https://api.you.com/mcp/free`を使用します",
    keylessPrivacy:
      "キー不要とはアカウント認証情報が不要という意味であり、ネットワークトラフィックの匿名性やproviderによるログ記録の不存在を意味しません。",
    rateLimit: "1日100クエリ",
    timeout30: "バックエンド試行ごとに30秒の上限には遅延初期化とツール呼び出しが含まれます",
    timeout90: "約90秒のバックエンド上限",
    maxResults: "`maxResults`を`count`にマッピング",
    urlOnly: "`you-extract`には`url`のみを渡し",
    degradation:
      "You.comには`objective`と`maxCharacters`に直接相当するものがないため、Proxyはその試行でのみこれらを省略し",
    noRewrite: "ローカルでクエリを書き換えたり応答を切り詰めたりしません",
    existingMetadata: "ExaとKeenableの成功メタデータは変更されません。",
    firstFallback: "最初の失敗を示す`fallback`を保持したまま",
    orderedFallbacks: "順序付き`fallbacks`メタデータ",
    privacy:
      "同じ検索クエリ、オプションの`objective`、または対象URLがExa、Keenable、You.comに開示される可能性があります",
    optOut: "明示的な`keenable`と`youcom`も単一providerへのオプトアウトです",
    codexOwner:
      '`github`は`bearer_token_env_var = "GITHUB_TOKEN"`、直接の`youdotcom`は`bearer_token_env_var = "YDC_API_KEY"`を使用するため',
    codexProxyEnv:
      "自動ローカルProxyでは、設定された`YDC_API_KEY`は`.mcp.json`内のstdio `env`値のままです",
    reinstall: "インストーラーを再実行",
    restart: "Codexを再起動",
  },
  "README.ko.md": {
    providerList: "`auto`, `exa`, `keenable`, `youcom`을 지원하며",
    keylessTransport:
      "없으면 Authorization 헤더나 OAuth 흐름 없이 키가 필요 없는 `https://api.you.com/mcp/free`를 사용합니다",
    keylessPrivacy:
      "키가 필요 없다는 것은 계정 자격 증명이 필요 없다는 뜻이며 네트워크 트래픽이 익명이거나 provider 로깅이 없다는 뜻은 아닙니다.",
    rateLimit: "하루 100개 쿼리",
    timeout30: "백엔드 시도당 30초 제한에는 지연 초기화와 도구 호출이 포함됩니다",
    timeout90: "약 90초의 백엔드 상한",
    maxResults: "`maxResults`를 `count`로 매핑",
    urlOnly: "`you-extract`에는 `url`만 전달",
    degradation:
      "You.com에는 `objective` 또는 `maxCharacters`에 직접 대응하는 항목이 없으므로 Proxy는 해당 시도에서만 이를 생략하며",
    noRewrite: "로컬에서 쿼리를 다시 쓰거나 응답을 잘라내지 않습니다",
    existingMetadata: "Exa 및 Keenable 성공 메타데이터는 변경되지 않습니다.",
    firstFallback: "첫 번째 실패에 대한 `fallback`은 유지하면서",
    orderedFallbacks: "순서가 지정된 `fallbacks` 메타데이터",
    privacy:
      "동일한 검색 쿼리, 선택적 `objective` 또는 대상 URL이 Exa, Keenable, You.com에 공개될 수 있습니다",
    optOut: "명시적 `keenable` 및 `youcom`도 단일 provider 옵트아웃입니다",
    codexOwner:
      '`github`는 `bearer_token_env_var = "GITHUB_TOKEN"`, 직접 `youdotcom`은 `bearer_token_env_var = "YDC_API_KEY"`를 사용하므로',
    codexProxyEnv:
      "자동 로컬 Proxy에서 설정된 `YDC_API_KEY`는 `.mcp.json`의 stdio `env` 값으로 유지됩니다",
    reinstall: "설치 프로그램을 다시 실행",
    restart: "Codex를 다시 시작",
  },
}

const AGENT_GUIDE_YOUCOM_CONTRACT = {
  "AGENTS.md": {
    providerList:
      "`OMAGENTS_SEARCH_PROVIDER` accepts exactly `auto`, `exa`, `keenable`, and `youcom`;",
    timeout30:
      "Each backend attempt has a 30-second budget including lazy initialization and the tool call",
    timeout90: "approximate 90-second backend upper bound",
    keylessTransport:
      "keyless `https://api.you.com/mcp/free` sends no Authorization header and needs no OAuth flow",
    keylessPrivacy: "keyless does not imply anonymous traffic or no provider logging",
    degradation:
      "On You.com attempts, `you-search` forwards `query` and maps `maxResults` to `count`, while `you-extract` receives only `url`. Unsupported `objective` and `maxCharacters` are omitted only for that attempt without query rewriting or local response truncation.",
    existingMetadata: "Existing Exa and Keenable metadata is unchanged",
    firstFallback: "retains the first `fallback`",
    orderedFallbacks: "adds ordered `fallbacks`",
    codexOwner:
      '`github` uses `bearer_token_env_var = "GITHUB_TOKEN"`, while direct `youdotcom` uses `bearer_token_env_var = "YDC_API_KEY"`',
    codexProxyEnv: "automatic local Proxy `env` (including configured `YDC_API_KEY`)",
    reinstall: "rerun the installer",
    restart: "restart Codex",
  },
  "packages/core/AGENTS.md": {
    providerList:
      "`OMAGENTS_SEARCH_PROVIDER` accepts exactly `auto`, `exa`, `keenable`, and `youcom`;",
    timeout30:
      "Each backend attempt has a 30-second budget including lazy initialization and the tool call",
    timeout90: "approximate 90-second backend upper bound",
    keylessTransport:
      "keyless `https://api.you.com/mcp/free` without an Authorization header or OAuth flow",
    keylessPrivacy: "this does not imply anonymous traffic or no provider logging",
    degradation:
      "`you-search` forwards `query` and maps `maxResults` to `count`; `you-extract` receives only `url`. Unsupported `objective` and `maxCharacters` are omitted only for the You.com attempt without query rewriting or local truncation.",
    existingMetadata: "Existing Exa/Keenable metadata is unchanged",
    firstFallback: "retains the first `fallback`",
    orderedFallbacks: "adds ordered `fallbacks`",
  },
  "packages/opencode/AGENTS.md": {
    providerList: "Search configuration accepts exactly `auto`, `exa`, `keenable`, and `youcom`;",
    timeout30: "Each 30-second backend attempt includes lazy initialization and the tool call",
    timeout90: "approximate 90-second upper bound after three attempts",
    keylessTransport:
      "keyless `https://api.you.com/mcp/free` sends no Authorization header and requires no OAuth flow",
    keylessPrivacy: "which does not imply anonymous traffic or no logging",
    degradation:
      "Automatic You.com attempts map `maxResults` to `count`, forward `query` to `you-search`, pass only `url` to `you-extract`, and omit unsupported `objective` and `maxCharacters` without rewriting queries or truncating responses locally.",
    existingMetadata: "Existing Exa/Keenable metadata remains unchanged",
    firstFallback: "retaining the first `fallback`",
    orderedFallbacks: "adds ordered `fallbacks`",
  },
  "packages/codex/AGENTS.md": {
    providerList:
      "`OMAGENTS_SEARCH_PROVIDER` accepts exactly `auto`, `exa`, `keenable`, and `youcom`;",
    timeout30: "at most one 30-second attempt per provider",
    timeout90: "approximate 90-second backend upper bound after three attempts",
    keylessTransport:
      "keyless `https://api.you.com/mcp/free` without an Authorization header or OAuth flow",
    keylessPrivacy: "keyless does not imply anonymous traffic or no provider logging",
    degradation:
      "Automatic You.com attempts map `maxResults` to `count`, forward `query` to `you-search`, pass only `url` to `you-extract`, and omit unsupported `objective` and `maxCharacters` without local rewriting or truncation.",
    existingMetadata: "Existing Exa/Keenable metadata remains unchanged",
    firstFallback: "retains the first `fallback`",
    orderedFallbacks: "adds ordered `fallbacks`",
    codexOwner:
      '`github` uses `bearer_token_env_var = "GITHUB_TOKEN"`, while direct `youdotcom` uses `bearer_token_env_var = "YDC_API_KEY"`',
    codexProxyEnv: "automatic local Proxy `env` (including configured `YDC_API_KEY`)",
    reinstall: "rerun the installer",
    restart: "restart Codex",
  },
  "packages/dsh/AGENTS.md": {
    providerList: "Search configuration accepts exactly `auto`, `exa`, `keenable`, and `youcom`;",
    timeout30: "at most one 30-second attempt per provider",
    timeout90: "approximate 90-second backend upper bound after three attempts",
    keylessTransport:
      "keyless `https://api.you.com/mcp/free` sends no Authorization header and needs no OAuth flow",
    keylessPrivacy: "keyless does not imply anonymous traffic or no provider logging",
    degradation:
      "Automatic You.com attempts map `maxResults` to `count`, forward `query` to `you-search`, pass only `url` to `you-extract`, and omit unsupported `objective` and `maxCharacters` without local rewriting or truncation.",
    existingMetadata: "Existing Exa/Keenable metadata remains unchanged",
    firstFallback: "retains the first `fallback`",
    orderedFallbacks: "adds ordered `fallbacks`",
  },
}

const COMMON_STALE_SEARCH_CONTRACTS = ["there is no third attempt"]
const README_STALE_SEARCH_CONTRACTS = {
  "README.md": [
    ...COMMON_STALE_SEARCH_CONTRACTS,
    "supports `auto`, `exa`, and `keenable`;",
    "tries Exa first and makes at most one Keenable attempt after a fallback-eligible Exa failure.",
    "Explicit `exa` and `keenable` retain their direct registrations and native provider tool names.",
    "Automatic Exa-first Proxy with eligible Keenable fallback",
  ],
  "README.zh-cn.md": [
    ...COMMON_STALE_SEARCH_CONTRACTS,
    "支持 `auto`、`exa` 和 `keenable`；",
    "先调用 Exa，并且只在出现符合回退条件的 Exa 失败后最多尝试一次 Keenable。",
    "显式 `exa` 和 `keenable` 保留其直连注册和 provider 原生工具名称。",
    "自动向第二个 provider 回退",
  ],
  "README.ja.md": [
    ...COMMON_STALE_SEARCH_CONTRACTS,
    "`auto`、`exa`、`keenable`をサポートし",
    "最初にExaを呼び出し、フォールバック対象のExa失敗後にのみKeenableを最大1回試行します。",
    "明示的な`exa`と`keenable`は、直接登録とproviderネイティブのツール名を保持します。",
    "第2 providerへの自動フォールバック",
  ],
  "README.ko.md": [
    ...COMMON_STALE_SEARCH_CONTRACTS,
    "`auto`, `exa`, `keenable`을 지원하며",
    "먼저 Exa를 호출하고 fallback 대상 Exa 실패 후에만 Keenable을 최대 한 번 시도합니다.",
    "명시적 `exa` 및 `keenable`은 직접 등록과 provider 네이티브 도구 이름을 유지합니다.",
    "두 번째 provider로의 자동 fallback",
  ],
}
const AGENT_STALE_SEARCH_CONTRACTS = [
  ...COMMON_STALE_SEARCH_CONTRACTS,
  "accepts exactly `auto`, `exa`, and `keenable`;",
  "accepts `auto`, `exa`, and `keenable`;",
  "tries Exa once, and permits one Keenable attempt only for fallback-eligible failures",
  "Exa-to-Keenable policy",
  "tries Exa before eligible Keenable fallback",
  "same query or URL to the second provider",
  "explicit `exa` and `keenable` retain direct registration",
]

function assertReadmeYouComGuidance(file, text) {
  for (const required of [
    "`youcom`",
    "`youdotcom`",
    "`YDC_API_KEY`",
    "https://api.you.com/mcp",
    "https://api.you.com/mcp/free",
    YOUCOM_OFFICIAL_DOCS,
    "Exa → Keenable → You.com",
    "Authorization: Bearer",
    "`you-search`",
    "`you-extract`",
    'bearer_token_env_var = "YDC_API_KEY"',
  ]) {
    assert.ok(text.includes(required), `${file} omits common identifier ${required}`)
  }
  for (const [category, required] of Object.entries(README_YOUCOM_CONTRACT[file])) {
    assert.ok(text.includes(required), `${file} omits ${category}: ${required}`)
  }
  for (const stale of README_STALE_SEARCH_CONTRACTS[file]) {
    assert.ok(!text.includes(stale), `${file} retains obsolete search guidance: ${stale}`)
  }
}

function assertAgentGuideYouComGuidance(file, text) {
  for (const required of [
    "`youdotcom`",
    "`YDC_API_KEY`",
    "https://api.you.com/mcp",
    "https://api.you.com/mcp/free",
    YOUCOM_OFFICIAL_DOCS,
    "100 queries/day",
    "Exa → Keenable → You.com",
    "same query or URL to Exa, Keenable, and You.com",
    "explicit `exa`, `keenable`, or `youcom`",
  ]) {
    assert.ok(text.includes(required), `${file} omits common identifier ${required}`)
  }
  for (const [category, required] of Object.entries(AGENT_GUIDE_YOUCOM_CONTRACT[file])) {
    assert.ok(text.includes(required), `${file} omits ${category}: ${required}`)
  }
  for (const stale of AGENT_STALE_SEARCH_CONTRACTS) {
    assert.ok(!text.includes(stale), `${file} retains obsolete search guidance: ${stale}`)
  }
}

function mutateSearchClause(text, category, required) {
  const replacements = {
    codexOwner: '`bearer_token_env_var = "YDC_API_KEY"`',
    keylessTransport: "`https://api.you.com/mcp/free`",
  }
  return text.replace(required, replacements[category] ?? "")
}

test("You.com search guidance stays synchronized across all README languages", () => {
  for (const file of READMES) {
    assertReadmeYouComGuidance(file, read(file))
  }
})

test("all agent guides preserve the three-provider search invariants", () => {
  for (const file of AGENT_GUIDES) {
    assertAgentGuideYouComGuidance(file, read(file))
  }
})

test("README and AGENTS search guards reject every retained legacy contract", () => {
  for (const file of READMES) {
    const text = read(file)
    for (const stale of README_STALE_SEARCH_CONTRACTS[file]) {
      assert.throws(
        () => assertReadmeYouComGuidance(file, `${text}\n${stale}\n`),
        /retains obsolete search guidance/,
        `${file} accepted appended stale guidance: ${stale}`
      )
    }
  }
  for (const file of AGENT_GUIDES) {
    const text = read(file)
    for (const stale of AGENT_STALE_SEARCH_CONTRACTS) {
      assert.throws(
        () => assertAgentGuideYouComGuidance(file, `${text}\n${stale}\n`),
        /retains obsolete search guidance/,
        `${file} accepted appended stale guidance: ${stale}`
      )
    }
  }
})

test("README and AGENTS search guards reject every removed semantic clause", () => {
  for (const [file, contract] of Object.entries(README_YOUCOM_CONTRACT)) {
    const text = read(file)
    for (const [category, required] of Object.entries(contract)) {
      const mutated = mutateSearchClause(text, category, required)
      assert.ok(!mutated.includes(required), `${file} ${category} mutation fixture is not unique`)
      assert.throws(
        () => assertReadmeYouComGuidance(file, mutated),
        new RegExp(`omits ${category}\\b`),
        `${file} accepted removal of ${category}`
      )
    }
  }
  for (const [file, contract] of Object.entries(AGENT_GUIDE_YOUCOM_CONTRACT)) {
    const text = read(file)
    for (const [category, required] of Object.entries(contract)) {
      const mutated = mutateSearchClause(text, category, required)
      assert.ok(!mutated.includes(required), `${file} ${category} mutation fixture is not unique`)
      assert.throws(
        () => assertAgentGuideYouComGuidance(file, mutated),
        new RegExp(`omits ${category}\\b`),
        `${file} accepted removal of ${category}`
      )
    }
  }
})

test("release guidance keeps four versions aligned and publishes Core before sequential hosts", () => {
  assert.deepEqual(
    PACKAGE_MANIFESTS.map((file) => readJson(file).version),
    ["0.16.0", "0.16.0", "0.16.0", "0.16.0"]
  )
  for (const file of HOST_MANIFESTS) {
    const pkg = readJson(file)
    assert.equal(pkg.dependencies["@omagents/core"], "0.16.0", file)
    for (const otherHost of PACKAGE_NAMES.slice(1)) {
      assert.equal(
        pkg.dependencies[otherHost],
        undefined,
        `${file} must not depend on ${otherHost}`
      )
    }
  }
  for (const file of ["AGENTS.md", "CONTRIBUTING.md", ...READMES]) {
    assert.ok(read(file).includes(RELEASE_ORDER), `${file} omits the deterministic release order`)
  }
  for (const file of ["AGENTS.md", "CONTRIBUTING.md"]) {
    assert.match(
      read(file),
      /build, test, pack, and publish all four/i,
      `${file} must require build, test, pack, and publish for every aligned release`
    )
  }
})

test("workspace guidance uses package paths and current verification commands", () => {
  for (const file of ["AGENTS.md", "CONTRIBUTING.md"]) {
    const text = read(file)
    assert.ok(text.includes("packages/opencode/src/parallel.js"), file)
    assert.doesNotMatch(text, /\.opencode\/plugins\/parallel\.js/, file)
    assert.ok(text.includes("npm test --workspaces --if-present"), file)
    assert.ok(text.includes(DSH_WORKSPACE_TEST), file)
    assert.ok(text.includes("npm run typecheck --workspace @omagents/omagents-dsh"), file)
    assert.ok(text.includes("npm run pack:all"), file)
    assert.ok(text.includes("npm run test:packed"), file)
    assert.ok(text.includes("npm run test:browser"), file)
    assert.ok(text.includes("packages/core/hooks/project-venv.js"), file)
  }
})

test("documentation keeps templates scoped and optional Python tools on demand", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "templates")), false)
  for (const file of ["AGENTS.md", "CONTRIBUTING.md", "packages/core/AGENTS.md", ...READMES]) {
    const text = read(file)
    assert.doesNotMatch(text, /^[├└]── templates\//m, file)
    assert.ok(text.includes("packages/core/skills/deep-research/templates/"), file)
    assert.ok(text.includes("jinja2"), file)
    assert.doesNotMatch(
      text,
      /(?:markitdown|playwright|officecli)[^\n.]*\b(?:are|is)\s+pre-?installed\b/i,
      file
    )
    assert.doesNotMatch(text, /optional Python (?:tools|packages)[^\n.]*\bpre-?installed\b/i, file)
  }
  for (const file of [
    "packages/core/AGENTS.md",
    "packages/dsh/AGENTS.md",
    "packages/dsh/README.md",
  ]) {
    assert.ok(read(file).includes("agents-python-tools"), `${file} must reference the Python skill`)
  }
})

test("DSH documentation covers installation, native UI, cancellation, recovery, security, and troubleshooting", () => {
  const readme = read("packages/dsh/README.md")
  const jobBoard = read("packages/dsh/docs/job-board.md")
  for (const heading of [
    "## Installation",
    "## Native Web Job Board",
    "## Cancellation",
    "## Recovery",
    "## Authorization and Security",
    "## Troubleshooting",
  ]) {
    assert.ok(readme.includes(heading), `DSH README omits ${heading}`)
  }
  for (const heading of [
    "## UI",
    "## Cancellation",
    "## Recovery",
    "## Authorization and Security",
    "## Troubleshooting",
  ]) {
    assert.ok(jobBoard.includes(heading), `Job Board guide omits ${heading}`)
  }
  const combined = `${readme}\n${jobBoard}`
  const recoveryTriggers =
    "Recovery triggers are startup after live-Agent and Session-query capabilities activate, manual refresh through `listJobs`, every new `watchJobs` stream (including reconnection), and authoritative lifecycle events. Startup reconciliation waits for those query capabilities; Remote refreshes and initial/reconnect baselines reconcile only authorized active jobs, while lifecycle events apply their native outcomes directly. Cold Remote queries also defer until the query capabilities are available. There is no periodic running-job poll:"
  for (const [file, text] of [
    ["packages/dsh/README.md", readme],
    ["packages/dsh/docs/job-board.md", jobBoard],
  ]) {
    assert.ok(text.includes(recoveryTriggers), `${file} has stale or incomplete recovery triggers`)
    assert.match(
      text,
      /observed active external run/i,
      `${file} omits the observed-active exception`
    )
    assert.match(
      text,
      /cold[^\n]*(?:session-not-found|missing Session read)/i,
      `${file} omits the cold-miss exception`
    )
  }
  assert.ok(
    readme.includes("no active run is authoritatively observable"),
    "DSH README must qualify missing/unreadable interrupted recovery"
  )
  for (const required of [
    "dsh plugin --profile web add @omagents/omagents-dsh",
    "33 skills",
    "current turn",
    "descendants continue",
    "External one-shot",
    "cannot resume",
    "Viewing details never acknowledges",
    "whole-set",
    "baseline",
    "remote-access/denied",
    "active DSH profile",
    "job-board.json",
    "interrupted",
    "parallel_status",
    "cancel_task",
    "/ps",
  ]) {
    assert.ok(combined.includes(required), `DSH documentation omits ${required}`)
  }
})

test("root READMEs qualify interrupted recovery with the observed-active cold-miss exception", () => {
  const qualifiers = new Map([
    ["README.md", "no active run is authoritatively observable"],
    ["README.zh-cn.md", "没有可权威观测到的活动运行"],
    ["README.ja.md", "権威的に観測可能なアクティブな実行がない場合にのみ"],
    ["README.ko.md", "권위 있게 관찰 가능한 활성 실행이 없을 때만"],
  ])
  for (const file of READMES) {
    const text = read(file)
    assert.ok(
      text.includes(qualifiers.get(file)),
      `${file} omits the no-authoritative-active-run qualifier`
    )
    assert.ok(text.includes("active external"), `${file} omits the observed active external run`)
    assert.ok(text.includes("cold session-not-found"), `${file} omits the cold-miss exception`)
    assert.ok(text.includes("interrupted"), `${file} omits interrupted recovery`)
  }
})

test("changelog has a versioned automatic Search Proxy and You.com release entry", () => {
  const changelog = read("CHANGELOG.md")
  const release = changelog.split("## [0.15.0]")[0]
  assert.match(release, /^## \[0.16.0\] - 2026-11-25$/m)
  for (const required of [
    "Automatic search MCP Proxy",
    "You.com search provider",
    "Exa → Keenable → You.com",
    "YDC_API_KEY",
    "fallbacks",
  ]) {
    assert.ok(release.includes(required), `0.16.0 changelog omits ${required}`)
  }
})

test("changelog has a versioned Superpowers documentation-path release entry", () => {
  const changelog = read("CHANGELOG.md")
  const release = changelog.split("## [0.14.2]")[0]
  assert.match(release, /^## \[0.15.0\] - 2026-11-20$/m)
  for (const required of [
    "Superpowers documentation paths",
    "OpenCode V2",
    "V1 injects the equivalent path preference",
    "not migrated automatically",
  ]) {
    assert.ok(release.includes(required), `0.15.0 changelog omits ${required}`)
  }
})

test("changelog has a versioned OpenCode compatibility release entry", () => {
  const changelog = read("CHANGELOG.md")
  const release = changelog.split("## [0.14.1]")[0]
  assert.match(release, /^## \[0.14.2\] - 2026-11-17$/m)
  for (const required of [
    "OpenCode 2.3 native subagent compatibility",
    "DSH plugin discovery metadata",
    "Release registry confirmation",
  ]) {
    assert.ok(release.includes(required), `0.14.2 changelog omits ${required}`)
  }
})

test("changelog has a versioned multi-host and full-DSH release entry", () => {
  const changelog = read("CHANGELOG.md")
  const release = changelog.split("## [0.13.1]")[0]
  assert.match(release, /^## \[0.14.0\] - 2026-11-15$/m)
  for (const required of [
    "@omagents/core",
    "@omagents/omagents-codex",
    "@omagents/omagents-dsh",
    "Job Board",
    "33",
    "npm workspaces",
  ]) {
    assert.ok(release.includes(required), `0.14.0 changelog omits ${required}`)
  }
})

test("changelog has a versioned DSH compatibility release entry", () => {
  const changelog = read("CHANGELOG.md")
  const release = changelog.split("## [0.14.0]")[0]
  assert.match(release, /^## \[0.14.1\] - 2026-11-16$/m)
  for (const required of [
    "0.2.2-rc.3",
    "cordis.patch.yml",
    "insert",
    "mcpManager",
    "resolveName",
    "parentSessionId",
  ]) {
    assert.ok(release.includes(required), `0.14.1 changelog omits ${required}`)
  }
})

test("scoped package guides and approved multi-host design artifacts are present", () => {
  for (const file of [
    "packages/core/AGENTS.md",
    "packages/opencode/AGENTS.md",
    "packages/codex/AGENTS.md",
    "packages/dsh/AGENTS.md",
    "docs/specs/2026-11-13-multi-host-packages-dsh-design.md",
    "docs/plans/2026-11-13-multi-host-packages-dsh.md",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} must be included`)
    assert.ok(read(file).length > 0, `${file} must not be empty`)
  }
  assert.ok(read("packages/opencode/AGENTS.md").includes("npx @omagents/omagents"))
  assert.ok(read("packages/codex/AGENTS.md").includes("npx @omagents/omagents-codex"))
  assert.ok(read("packages/dsh/AGENTS.md").includes(DSH_WORKSPACE_TEST))
})

test("verification notes include the confirmed cross-platform CI run", () => {
  for (const file of [
    "AGENTS.md",
    "CONTRIBUTING.md",
    "packages/dsh/README.md",
    "packages/dsh/AGENTS.md",
  ]) {
    const text = read(file)
    assert.ok(text.includes("Linux x64"), file)
    assert.ok(text.includes("chromium_headless_shell-1254"), file)
    assert.ok(text.includes("44712737977"), file)
    assert.ok(text.includes("Linux"), file)
    assert.ok(text.includes("Windows"), file)
    assert.doesNotMatch(
      text,
      /require first CI confirmation|still require first CI confirmation/,
      file
    )
  }
})
