# OmAgents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-blue)](https://opencode.ai)
[![npm version](https://img.shields.io/npm/v/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![npm downloads](https://img.shields.io/npm/dm/@omagents/omagents.svg)](https://www.npmjs.com/package/@omagents/omagents)
[![GitHub stars](https://img.shields.io/github/stars/omagents/omagents?style=social)](https://github.com/omagents/omagents/stargazers)

[English](README.md) | [简体中文](README.zh-cn.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Türkçe](README.tr.md)

OmAgents; **OpenCode**, **Codex** ve **DeepSeek Harness (DSH)** için geliştirilmiş çoklu ortam (multi-host) ajan araç setidir. 19 OmAgents becerisi (skill), 15 Superpowers becerisi, MCP sunucuları, yerel arka plan ajanı entegrasyonu, derin araştırma (deep research) ve Python araçlarını bir araya getirir. Paylaşılan Core paketi, durum yönetimini ve ortamdan bağımsız davranışı tutarlı tutar.

---

## Kurulum

Kullandığınız ortam (host) için uygun paketi seçin. Kurulum aracı konumsal bir ortam argümanı almaz.

```bash
# OpenCode
npx @omagents/omagents

# Codex
npx @omagents/omagents-codex

# DeepSeek Harness
dsh plugin --profile web add @omagents/omagents-dsh
```

Kurulumdan sonra ortamı yeniden başlatın. `@omagents/core` bağımlılık olarak otomatik kurulur; **ayrı bir eklenti olarak kurmayın**. Mevcut sürüm adayı dört paketin tamamını **0.17.1** sürümünde hizalar.

Python tabanlı beceriler için PATH üzerinde Python 3.11+ bulunmalıdır. DSH ise Node.js 24.9 veya daha yeni bir sürüm ile paketin test edilmiş uyumluluk aralığında bir DSH sürümü gerektirir.

### Arama Sağlayıcıları ve İsteğe Bağlı API Anahtarları

```bash
export OMAGENTS_SEARCH_PROVIDER="auto"  # varsayılan; yalnızca doğrudan sağlayıcı için "exa", "keenable" veya "youcom" kullanın
export EXA_API_KEY="your-exa-key"
export KEENABLE_API_KEY="your-keenable-key"  # isteğe bağlı
export YDC_API_KEY="your-youcom-key"  # isteğe bağlı
export CONTEXT7_API_KEY="your-context7-key"
export GITHUB_TOKEN="your-github-token"
```

- **`OMAGENTS_SEARCH_PROVIDER`**: `auto`, `exa`, `keenable` ve `youcom` değerlerini destekler; ayarlanmadığında veya boş bırakıldığında varsayılan `auto` olur. Kimlik bilgileri sağlayıcıyı değiştirmez ve desteklenmeyen değerler açıkça hata verir.
- **`EXA_API_KEY`**: Barındırılan Exa hizmetinde `x-api-key` üzerinden kimlik doğrulaması yapar; anahtar olmadan da aynı uç nokta anonim olarak çalışır. Bu durum hem otomatik Proxy hem de açık doğrudan Exa kaydı için geçerlidir.
- **`KEENABLE_API_KEY`**: Otomatik yedekleme (fallback) ve açık `keenable` kullanımı için isteğe bağlıdır. Anahtar varken Keenable `X-API-Key` ile `https://api.keenable.ai/mcp` adresini kullanır; anahtar olmadığında anahtarsız `https://api.keenable.ai/mcp-public` uç noktasını kullanır. Genel katman IP başına saatte 1.000 istek ve saniyede 10 istek izni verir; arama sorgularını veya getirilen URL'leri ve istemleri, ayrıca IP, kullanıcı aracısı (user agent) ve `X-Keenable-Title` bilgisini günlüğe kaydeder. Codex için yapılandırılmış bir anahtar, Exa'da olduğu gibi `.mcp.json` dosyasına yazılır.
- **`YDC_API_KEY`**: Otomatik yedekleme ve doğrudan kaydı `youdotcom` olarak adlandırılan açık `youcom` kullanımı için isteğe bağlıdır. Anahtar varken You.com `Authorization: Bearer <YDC_API_KEY>` ile `https://api.you.com/mcp` adresini kullanır; anahtar olmadığında Authorization başlığı veya OAuth akışı olmadan anahtarsız `https://api.you.com/mcp/free` uç noktasını kullanır. [Resmî You.com MCP dokümantasyonu](https://you.com/docs/agents/mcp-server#choose-your-setup), anahtarsız uç nokta için **günlük 100 sorgu** belirtir. Anahtarsız kullanım, hesap kimlik bilgisi gerektirmemesi anlamına gelir; anonim ağ trafiği veya sağlayıcı günlüğünün olmaması anlamına gelmez.
- **`CONTEXT7_API_KEY`**: Yerel `@upstash/context7-mcp` sunucusu için isteğe bağlı hız sınırı kimlik bilgileri.
- **`GITHUB_TOKEN`**: GitHub Copilot MCP'yi etkinleştirir. Olmadığında OmAgents, genel kod araması için `mcp.grep.app` kullanır.

`auto` modunda yerel bir `websearch` Arama MCP Proxy'si başlangıçta **Exa → Keenable → You.com** sırasını izler: önce Exa'yı dener; yedeklemeye uygun bir Exa hatasından sonra en fazla bir Keenable denemesi, ardından yedeklemeye uygun bir Keenable hatasından sonra en fazla bir You.com denemesi yapar. Yedeklemeye uygun bir Exa hatasından sonra aynı Proxy süreci, o süreci paylaşan diğer oturumlardan gelen çağrılar da dâhil olmak üzere sonraki her çağrı için **Keenable → You.com → Exa** sırasını kullanır. Proxy'yi yeniden oluşturmak (genellikle ortam hizmetini yeniden başlatarak) başlangıç sırasını geri yükler; bu durum yalnızca bellekte tutulur ve bekleme süresi (cooldown) yoktur. Başarılı boş sonuçlar, kimlik doğrulama veya izin hataları, geçersiz parametreler, yeniden denenemez açık hatalar ve çağıran iptalleri hiçbir zaman yedeklemeye geçmez veya sırayı değiştirmez. Her sağlayıcı, tembel başlatma (lazy initialization) ve araç çağrısı dâhil olmak üzere arka uç denemesi başına 30 saniyelik sınırla çağrı başına en fazla bir deneme alır. Dolayısıyla tam üç denemelik bir çağrının, küçük yerel işlem süresi hariç yaklaşık 90 saniyelik bir arka uç üst sınırı vardır.

Proxy, genel `search` ve `fetch` araçlarını sunar; `fetch` tam olarak bir adet `http` veya `https` URL'si kabul eder. OpenCode bunları `websearch_search` ve `websearch_fetch` olarak adlandırır; Codex ve DSH ise `mcp__websearch__search` ve `mcp__websearch__fetch` olarak adlandırır. Açık `exa`, `keenable` ve `youcom` seçenekleri doğrudan kayıtlarını ve yerel sağlayıcı araç adlarını korur; doğrudan You.com, `you-search` ve `you-extract` ile `youdotcom` kullanır.

Bir You.com denemesinde genel `search`, `you-search` ile eşlenir: `query` değerini değiştirmeden iletir ve `maxResults` değerini `count` ile eşler (varsayılan 10, aralık 1–50). Genel `fetch` ise anahtarlı/anahtarsız ortak alt kümeyi kullanarak `you-extract` aracına yalnızca `url` parametresini geçirir. You.com'un `objective` veya `maxCharacters` için doğrudan bir karşılığı yoktur; Proxy, yerel sorgu yeniden yazma veya yanıt kırpma yapmadan yalnızca o deneme için bunları çıkarır. Exa ve Keenable başarı meta verileri değişmeden kalır. İki uygun hatadan sonra gerçekleşen bir You.com başarısı `provider: "youcom"` bildirir, ilk hata için `fallback` bilgisini korur ve sıralı `fallbacks` meta verisinin yanı sıra önceki her uygun hata için okunabilir bir `Fallback` satırı ekler.

**Yerleşik OpenCode websearch aracı:** OpenCode 2.x ayrıca adı Proxy'nin `websearch_search` ve `websearch_fetch` araçlarına yakın olan kendi `websearch` aracını içerir; ajanlar yanlış olanı seçebilir ve yerleşik araçta OmAgents yük devretme (failover) desteği yoktur. Bu nedenle kurulum aracı, çözümlenen `opencode.json` dosyasında bu anahtar yoksa `"websearch": false` yazar ve yerleşik aracı kaldırarak yalnızca Proxy'nin yönlendirdiği araçların web araması olarak kalmasını sağlar. Açıkça tanımlanmış bir `websearch` değeri hiçbir zaman üzerine yazılmaz, `--keep-websearch` bu varsayılanı atlar ve anahtarı silmek (veya kendiniz tekrar ayarlamak) yeniden başlatma sonrasında yerleşik aracı geri yükler. OpenCode 1.x sürümünde yerleşik websearch aracı yoktur, bu yüzden ayar orada etkisizdir. OpenCode'un `webfetch` aracı bundan etkilenmez.

**Gizlilik ve kapsam dışı bırakma (opt-out):** Otomatik yedekleme aynı arama sorgusunu, isteğe bağlı `objective` bilgisini veya hedef URL'yi Exa, Keenable ve You.com'a iletebilir. Özellikle yedeklemeye uygun bir Exa hatası, aynı arama sorgusunu veya URL'yi Keenable'a gönderebilir (Keenable anahtarı yapılandırılmamışsa genel katman günlüğü de dâhil); uygun bir Keenable hatası ise sorguyu veya URL'yi You.com'a gönderebilir. You.com `objective` değerini yerel bir argüman olarak almaz ancak önceki sağlayıcılar almış olabilir. Doğrudan Exa davranışını korumak ve otomatik yedeklemeyi önlemek için açıkça `exa` seçin; açık `keenable` ve `youcom` da Proxy'yi atlayan tek sağlayıcılı kapsam dışı bırakma seçenekleridir. Yalnızca yerleşik Proxy üzerinden yapılan çağrılar bu yük devretme garantisine sahiptir: yerel ortam web araçları bunun dışındadır (eklenti bunları çalışma zamanında devre dışı bırakamaz; OpenCode için kurulum aracı bunun yerine yukarıda açıklandığı gibi yerleşik `websearch` aracını araç setinden kaldırır) ve kullanıcı tanımlı bir `websearch` veya `youdotcom` MCP sunucusu kullanıcıya ait kalır, öncelik alır ve sarmalanmaz.

**Codex kurulum zamanlaması:** Codex, kurulum aracı çalıştırıldığında sağlayıcı ve kimlik bilgisi yapılandırmasının anlık görüntüsünü alır. Kurulumdan önce ortam değişkenlerini ayarlayın. `YDC_API_KEY` dâhil olmak üzere sağlayıcıyı veya anahtarları değiştirdikten sonra kurulum aracını yeniden çalıştırın—örneğin `OMAGENTS_SEARCH_PROVIDER="keenable" npx @omagents/omagents-codex`—ardından Codex'i o ortamla yeniden başlatın. Yeniden kurulum, kopyalanan Proxy'yi yeniler ve eski sağlayıcı girişleri ile kimlik bilgilerini değiştirir.

Codex için Bearer ortam yönlendirmesi MCP sunucu sahibine göre kapsamlandırılır: `github`, `bearer_token_env_var = "GITHUB_TOKEN"` kullanırken doğrudan `youdotcom`, Bearer gizli anahtarını serileştirmek yerine `bearer_token_env_var = "YDC_API_KEY"` kullanır. Otomatik yerel Proxy için yapılandırılmış `YDC_API_KEY`, `.mcp.json` içinde bir stdio `env` değeri olarak kalır. Codex eklentisinin `.mcp.json` sözleşmesinde Exa'nın `x-api-key`, Keenable'ın `X-API-Key` veya Context7'nin stdio `env` değerleri için eşdeğer bir yönlendirme yoktur; bu nedenle yapılandırılmış Exa, Keenable ve Context7 değerleri o dosyaya yazılır. POSIX izin modlarını destekleyen platformlarda kurulum aracı `0700` moduyla özel dizinler oluşturur ve `.mcp.json` dosyasını `0600` moduyla yazar veya yeniden yazar.

## Destek Matrisi

| Ortam veya rol | Paket | Kurulum | Beceriler | Arka plan yürütme ve kurtarma | Yönetim yüzeyi |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenCode 1.x ve OpenCode 2.x** | `@omagents/omagents` | `npx @omagents/omagents` | **34**: 19 OmAgents + 15 Superpowers | V1 `task(background: true)` kullanır; V2 ise her zaman arka planda çalışan yerel `subagent(...)` kullanır. Kalıcı Core Job Board, tamamlanma teslimi ve kurtarma. | `/ps`, `parallel_status`, `cancel_task`, üst bağlam sonuçları ve OpenCode TUI durumu |
| **Codex** | `@omagents/omagents-codex` | `npx @omagents/omagents-codex` | **34**: 19 OmAgents + 15 Superpowers | Codex yerel alt ajanları. OpenCode paralel motoru ve DSH Web Job Board kurulmaz. | Codex yerel arayüzü ve becerileri |
| **DeepSeek Harness (DSH)** | `@omagents/omagents-dsh` | `dsh plugin --profile web add @omagents/omagents-dsh` | **34**: 19 OmAgents + 15 Superpowers | Yerel eşzamansız `subagent` yaşam döngüsü, kalıcı `job-board.json`, iptal, kurtarma, `/ps`, `parallel_status` ve `cancel_task` | Yetkili Remote `watchJobs` akışı ve yerel React Web Job Board |
| **Paylaşılan kütüphane, ortam eklentisi değil** | `@omagents/core` | Otomatik bağımlılık; ayrı kullanıcı kurulumu yok | Paylaşılan beceri tanımları ve Superpowers varlıkları | Ortamdan bağımsız yürütme durumu, kalıcılık, MCP çözümlemesi, araştırma varlıkları ve Python ortamları | Bağımsız arayüz yok |

Tüm ortam paketleri yalnızca hizalanmış Core sürümüne bağımlıdır; hiçbir zaman başka bir ortam paketine bağımlı değildir.

## Öne Çıkanlar

| Özellik | Sundukları |
| :--- | :--- |
| **Döngü Mühendisliği (Loop Engineering)** | Yinelemeli beceriler için kalıcı görev kuyrukları, yeniden denemeler, doğrulama ve devam ettirilebilir durum |
| **Superpowers** | Beyin fırtınası, TDD, sistematik hata ayıklama, planlar, kod inceleme, worktree'ler ve doğrulama |
| **Derin Araştırma (Deep Research)** | Çok kaynaklı öğe × alan araştırması, boşluk tespiti, kalıcı kanıtlar ve Jinja2 raporları |
| **Paralel Yürütme** | OpenCode ve DSH üzerinde paylaşılan Core yürütme modeliyle ortamın kendi arka plan ajanları |
| **DSH Web Job Board** | Yerel React filtreleri, ayrıntılar, bildirim durumu, onaylı iptal, yeniden bağlanma ve sağlık görünümleri |
| **Yerleşik MCP'ler** | agentmemory, codegraph, context7, websearch/keenable/youdotcom ve github/grep_app |
| **Python Araçları** | Mevcut bir projenin `.venv` ortamını değiştirmeden kalıcı ajan tabanı ve isteğe bağlı proje katmanları |
| **Belge ve Web Araçları** | MarkItDown dönüştürme, OfficeCLI belgeleri ve Playwright veri kazıma (scraping) |
| **Kod Zekâsı** | LSP rehberliği ve grep yedekli AST tabanlı arama/yeniden yazma |
| **Hyperplan ve Refactor** | Üç eleştirmenli çekişmeli (adversarial) planlama ve doğrulanmış yinelemeli yeniden düzenleme |

## Python Ortamları

Kalıcı ajan tabanında yalnızca `jinja2` otomatik olarak hazırlanır. MarkItDown ve Playwright gibi isteğe bağlı Python araçları, ilgili beceriler ihtiyaç duyduğunda **isteğe bağlı olarak** kurulur; otomatik kurulumun parçası değildir. Proje bağımlılıkları isteğe bağlı bir katman (overlay) kullanır ve hiçbir zaman mevcut bir projenin `.venv` ortamını değiştirmeyi gerektirmez.

Ortam seçimi, platformlar arası yollar ve CLI talimatları için `agents-python-tools` becerisini kullanın. Proje komutları bu depoda `packages/core/hooks/project-venv.js` tarafından uygulanır. Ne taban ne de proje ortamı otomatik olarak silinir.

## Döngü Mühendisliği ve Derin Araştırma

Döngü tabanlı beceriler her seferinde bir öğe işler ve durumu `.omagents/loops/<skill>/tasks.json` içinde kalıcı olarak saklar. Başarısız görevler engellenmiş (blocked) duruma geçmeden önce en fazla üç kez yeniden denenir. Durum, bağlam temizlense bile korunur; böylece iş akışı baştan başlamak yerine kaldığı yerden devam edebilir.

Derin Araştırma (Deep Research), `--workspace <dir>` parametresini yalnızca genel çıktılar için kullanır. Planlar, ham bulgular, kontrol noktaları, türetilmiş yapıtlar, kaynakça bilgileri ve çalıştırmaya özel kuyruklar `.omagents/deep-research/<run-id>/` altında tutulur. Yeni çalıştırmalar bu dahili durumu içerecek bir çalışma alanını reddeder; eski çalışma alanları otomatik taşıma olmadan okunabilir ve devam ettirilebilir kalır. Jinja2 şablonları `packages/core/skills/deep-research/templates/` içinde yer alır; kök dizinde bir `templates/` klasörü yoktur.

## Beceriler ve MCP Sunucuları

19 OmAgents becerisi şunlardır:

`deep-research`, `parallel-execution`, `privilege-escalation`, `agents-python-tools`, `markitdown-converter`, `officecli`, `playwright-web-scraping`, `init-deep`, `doctor`, `remove-ai-slops`, `remove-deadcode`, `github-triage`, `tech-debt-audit`, `lsp-guide`, `ast-grep`, `work-with-pr`, `pre-publish-review`, `hyperplan` ve `refactor`.

Superpowers, 15 ek süreç becerisi sunar. Core; kontrol akışının farklılaştığı yerlerde ortama özel tam geçersiz kılmalar kullanarak paylaşılan becerileri `opencode-v1`, `opencode-v2`, `codex` ve `dsh` için işler. Superpowers becerileri için her `docs/superpowers` dokümantasyon kökü, sonraki tüm dizinler korunarak `docs` olarak işlenir (örneğin `docs/specs/` ve `docs/plans/`). Mevcut belgeler otomatik olarak taşınmaz. OpenCode V2 ve DSH, `background` argümanı olmadan yerel `subagent` semantiğini kullanır.

| MCP | Tür | Davranış |
| :--- | :--- | :--- |
| `agentmemory` | Yerel | Oturum belleği ve denetim |
| `codegraph` | Yerel | Kod tabanı sembol grafiği ve keşif |
| `context7` | Yerel | `@upstash/context7-mcp` üzerinden dokümantasyon araması |
| `websearch` | `auto` modunda yerel; açık `exa` modunda uzak | Otomatik `Exa → Keenable → You.com` Proxy veya `EXA_API_KEY` ile anonim/kimlik doğrulamalı doğrudan barındırılan Exa |
| `keenable` | Uzak | `keenable` sağlayıcısı ile anahtarlı özel MCP veya anahtarsız genel uç nokta |
| `youdotcom` | Uzak | `youcom` sağlayıcısı ile anahtarlı `https://api.you.com/mcp` veya anahtarsız `https://api.you.com/mcp/free` |
| `github` / `grep_app` | Uzak | Token ile GitHub Copilot MCP; aksi hâlde `mcp.grep.app` üzerinden genel kod araması |

Kullanıcı tanımlı MCP yapılandırması, yerleşik kayıtlara göre öncelik alır.

## DSH Job Board Davranışı

DSH paketi yalnızca becerilerden oluşan bir eklenti değil, eksiksiz bir Host ve Web Client kurar. Web Job Board, sürümlenmiş tam set Remote çerçevelerini tüketir, yeniden bağlanma sonrasında temiz bir başlangıç çizgisiyle başlar ve çalışan işleri periyodik olarak yoklamaz (polling yapmaz). Tümü/çalışan/dikkat gerektiren/biten filtreleri, sonuç ve hata ayrıntıları, bildirim durumu, iptal onayı, bayat/izin/düşürülmüş (stale/permission/degraded) görünümler ve DSH tema entegrasyonu sunar.

İptal kabulü, onaylanmış sonlandırma anlamına gelmez. Yerel kesme işlemi alt ajanın **mevcut turunu** durdurur; ayrıca iptal edilmedikçe **alt görevleri (descendants) devam eder**. **Harici tek seferlik (external one-shot)** çalıştırmalar kalıcı olarak durur ve **devam ettirilemez**. Arayüzde ayrıntıları görüntülemek hiçbir zaman bir model bildirimini onaylamaz (acknowledge etmez).

Yeniden başlatmada DSH, kalıcı işleri yetkili ortam durumuyla uzlaştırır. Eksik veya okunamayan çıktılar, yalnızca **yetkili olarak gözlemlenebilir etkin bir çalıştırma olmadığında** `interrupted` durumuna geçer; asla sahte başarı üretilmez. Gözlemlenen **etkin bir harici** çalıştırma, **soğuk oturum bulunamadı (cold session-not-found)** durumunda `interrupted` olarak yanlış sınıflandırılmak yerine etkin kalır. Uzaktan erişim, etkin DSH profili ve yetkili üst oturum kapsamıyla sınırlıdır. Arayüz, iptal, kurtarma, yetkilendirme, güvenlik ve sorun giderme ayrıntıları için [DSH paket kılavuzuna](packages/dsh/README.md) ve [Job Board kılavuzuna](packages/dsh/docs/job-board.md) bakın.

## Mimari

```text
┌─────────────────────────────────────────────────┐
│ Kullanıcı seçimi katmanı (paketli değil)        │
│ OpenSpec · gstack · özel iş akışları · hiçbiri  │
├─────────────────────────────────────────────────┤
│ Süreç becerileri katmanı (paketli Superpowers)  │
├─────────────────────────────────────────────────┤
│ OmAgents altyapısı ve paylaşılan Core           │
│ Beceriler · MCP · Job Board · araştırma · Python│
├─────────────────────────────────────────────────┤
│ OpenCode · Codex · DeepSeek Harness             │
└─────────────────────────────────────────────────┘
```

OmAgents zorunlu bir geliştirme metodolojisi değil, altyapı sunar. Superpowers yeniden kullanılabilir süreç becerileri sağlar. OpenSpec ve gstack gibi metodolojiler ayrı kullanıcı seçimleri olarak kalır.

## Geliştirme

Depo; `packages/core`, `packages/opencode`, `packages/codex` ve `packages/dsh` paketlerini içeren özel bir npm-workspaces köküdür. Depodaki `.opencode/plugins/index.js` yalnızca bir geliştirme yeniden dışa aktarımıdır; ürün kodu paketlerin içinde yer alır. Derin araştırma şablonları `packages/core/skills/deep-research/templates/` altında kalır.

```bash
# Tüm kök ve çalışma alanı testleri
npm test

# DSH derleme ve test
npm run build --workspace @omagents/omagents-dsh && npm test --workspace @omagents/omagents-dsh

# Paketlenmiş yapıt ve tarayıcı doğrulaması
npm run pack:all
npm run test:packed
npm run test:browser
```

Her sürüm tek bir hizalanmış sürüm numarası kullanmalı ve dört paketin tamamını şu deterministik sırayla **birlikte derlemeli, test etmeli, paketlemeli ve yayımlamalıdır**:

`@omagents/core → @omagents/omagents → @omagents/omagents-codex → @omagents/omagents-dsh`

Her ortam Core'a bağımlı olduğu için önce Core yayımlanır. Ortamların sıralı olması yalnızca deterministik günlükler ve hata yönetimi içindir; ortamlar arasında birbirine bağımlılık yoktur. Doğrulama gereksinimleri ve mevcut platform/tarayıcı onay kapsamı için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın.

## Kaldırma

OmAgents paketini kaldırmak veya devre dışı bırakmak için seçtiğiniz ortamın eklenti yönetimini kullanın. DSH için yalın `@omagents/omagents-dsh` Loader satırını devre dışı bırakmak hem Host'u hem de Web Client'ı devre dışı bırakır. Core yalnızca kurulu bir ortamın bağımlılığı olarak kalır. Python ortamları otomatik olarak silinmez.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
