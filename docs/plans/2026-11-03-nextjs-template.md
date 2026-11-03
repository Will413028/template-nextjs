# template-nextjs：只用 Next.js 的全端範本

**Goal：** 一個沒有獨立後端的 Next.js 全端 monorepo 範本：`make dev` 起整個 stack，`make rename NAME=x` 產生衍生專案，CI 綠燈，D4 決定範圍內的需求清單每一項都有測試。驗收見步驟 6。

**上層：** 見本機個人脈絡檔（主清單在 repo 外）。沒有主計畫，下一段暫代。

**附件：** [`2026-11-03-nextjs-template/requirements.md`](2026-11-03-nextjs-template/requirements.md)：需求清單（畫面、資料實體、流程、非功能需求）。工具鏈與安全基線參考 `template-go-nextjs@560106d`。

## 全域約束與完成定義（暫代主計畫）

- 安全基線沿用 Go 版 ADR `docs/adr/2026-10-18-api-and-auth-baseline.md`、`docs/adr/2026-10-22-account-abuse-and-lifecycle.md`；認證自建（D2），因 Next.js 機制不同而偏離它的地方，要列進 D2 的偏離清單並經 Will 確認。兩份 ADR 的每條決定在本計畫的歸屬（沿用／偏離／延後／不適用，加所屬步驟 1–5）由步驟 0 (a) 列在 `auth-parity.md` 開頭的「ADR 決定歸屬表」。
- E2E 與瀏覽器測試不在本機跑，只在 CI 跑。
- 完成定義（每一步）：需求清單該步的每一項有 vitest 或 integration 測試（integration 測試也用 vitest 跑，併入同一份報告與測試數鎖）；`pnpm check`（步驟 1 建立）綠燈；`check_locks.py` 的測試數鎖調到新數字；需求清單該列的「狀態」欄改成「完成」。

## 前提（開工時核對過，2026-11-03）

- 會改到或取代的既有部署是否在線：無既有部署，全新 repo，不受回滾與相容性窗口約束。目錄已有 kickoff 建的 `AGENTS.md`、`AGENTS.local.md`（不進版控）和 `docs/plans/`，在步驟 1 一起進第一個 commit。
- 目錄已有自己的 `.git`（無任何 commit，分支 `main`）：`git -C <本目錄> rev-parse --show-toplevel` 指向本目錄（2026-11-03 實測）。步驟 1 不再 `git init`，直接建第一個 commit；之前仍先跑同一個指令確認不會落到 second-brain 父 repo。
- 範本使用者是 Will 自己，有 Go 版的使用證據，省略產品風險驗證（來源：2026-11-03 對話；已確認）。
- 工具鏈預設（可推翻）：Next.js 16、React 19、TypeScript、pnpm、Biome、vitest、next-intl、zod，和 Go 版前端相同（來源：Go 版 `frontend/package.json`）；PostgreSQL 18，DB 分 owner 與 app 兩個角色（Go 版 `deploy/postgres/initdb/10-roles.sh`）。
- integration 測試用 testcontainers 起 PostgreSQL，和 Go 版的 `dbtest` 一樣在本機可跑（不是瀏覽器測試）（預設，可推翻）。
- GitHub repo 建立在 `Will413028/template-nextjs`，用 dev branch 模型；public（D6）。

**驗收基線：** repo 未建，無。

## 本階段依賴的不變量

| 不變量 | 依賴它的機制（預計的模組） |
|---|---|
| 資料庫只在伺服器端存取；client component 不 import DB 或認證的伺服器模組 | `src/server/`（預計）、`import "server-only"`、dependency-cruiser 規則（Go 版前端已用） |
| 每個讀寫使用者資料的 Server Action、server component 與 Route Handler 都先驗證 session 與擁有者 | `src/server/auth/` 的 `requireSession()`（預計）；dependency-cruiser 規則：DB 模組只能由 `src/server/**` import；integration 測試：從 build manifest 列出所有 action ID，逐一不帶 cookie 呼叫，除註冊與登入外全部被拒；步驟 2 的跨使用者撤銷 session 測試、步驟 3 的跨使用者讀寫測試 |
| session token 只存 SHA-256；cookie 是 `__Host-session; HttpOnly; Secure; SameSite=Lax`；absolute 7 日、idle 1 日；不接受 Bearer；無效 cookie 清掉；登入一律發新 token；未知帳號也跑一次雜湊；刪帳號要 10 分鐘內登入過、並撤銷所有 session；argon2id 參數與同時雜湊數上限照 Go 版 ADR；登入名稱是 username | `src/server/auth/session.ts`、`src/server/auth/password.ts`（預計）與步驟 2 的對應測試 |
| DB 分 owner 與 app 兩個角色，app 角色只有 DML（users、sessions 等認證資料表和其他表一樣由 owner migrate） | `deploy/postgres/initdb/10-roles.sh`、migrate 命令用 owner、app 執行時用 app 角色、CI stack job 的 `intruder` 檢查 |
| 錯誤對使用者顯示走 next-intl 訊息，不顯示伺服器內部細節 | `messages/*.json`、`error.tsx`、action 的錯誤回傳型別 |
| 佔位名稱 `template-nextjs`／`template_nextjs` 只出現在 rename 腳本認得的檔案 | `scripts/rename.py`（從 Go 版改寫）的 `STACK_FILES`、`BRAND_FILES`、CI rename smoke job |

## 範圍

- 做：需求清單裡 D4 決定的範圍。
- 不做：admin 使用者管理畫面（Go 版也延後）；和其他兩個 template 共用程式碼。
- 延後：帳號濫用與管理（requirements E4、F4、F5、F7，原步驟 4），觸發：第一個需要登入鎖定、trusted device、admin 或稽核紀錄的衍生專案（D4）。
- 延後：Go 版專案頁 `wiki/projects/template-go-nextjs/index.md` Pending「延後」段的 12 項（email 驗證與找回密碼、MFA、OTel、背景工作、多實例、managed Postgres、`pg_hba`、OpenAPI 3.1、ogen spike、compose 固定 subnet、admin UI、`FieldError` 帶參數），觸發條件照該頁；其中只跟 Go 後端有關的（ogen spike、OpenAPI 3.1）收尾時標不適用。

## 步驟

- [x] **0. spike：認證、資料存取與部署**（被擋於：無）
  - 範圍：在暫存目錄各做一個拋棄式試驗，產出事實。(a) 自建 opaque session（D2）在 Next.js 16 上的機制事實：argon2id 套件（候選 `@node-rs/argon2`）在 Node runtime 與 standalone Docker image 裡能不能載入、雜湊參數能不能設成 Go 版 ADR 的值；Server Action 裡用 `cookies()` 設 `__Host-` 前綴、`HttpOnly`、`Secure`、`SameSite` 的 cookie；Server Actions 內建的 Origin／Host 檢查能不能取代 Go 版的 CSRF 防護：實測比照 Go 版 `server_test.go` `TestCrossOriginPostRejected` 的每個案例並逐案寫預期（擋下／放行）。已知（2026-11-03 讀 next 16.4.2 `action-handler.js` 原始碼，推論待實測）：Next 只比對 `Origin`，不看 `Sec-Fetch-Site`，不帶 Origin 時放行並記警告，Origin 不符回 500；所以只帶 `Sec-Fetch-Site` 的案例要決定標「不適用」（瀏覽器跨站 POST 一定帶 Origin）並列進 D2 偏離清單，或在 proxy 補 Fetch Metadata 檢查，兩案都寫進 spike 結論交 Will。另加偽造 `X-Forwarded-Host`（經 Caddy）一例；斷言用「action 沒有執行（DB 沒寫入、沒有 `Set-Cookie`）」，不比狀態碼；session 查詢放在哪一層（proxy 或 server component）才不會被繞過；登入節流在單一程序內的做法（範圍依 D7）；Caddy 後方怎麼取得 client IP、怎麼忽略非 Caddy 來源的 `X-Forwarded-For`（對照 Go 版 `ratelimit_test.go` 的 trusted proxy、IPv6 /64 案例）；Server Action 的測試 harness：`next build` 後在 vitest integration 裡起 `next start`（非瀏覽器），從 build manifest（`.next/server/server-reference-manifest.json`）取 action ID 送 POST，手動帶 cookie 標頭，能讀回 `Set-Cookie` 並觀察 Origin 檢查，留一個可重跑的範例；同一個 client 也要能對 compose 裡的 image 經 Caddy 跑（ID 從 image 內的 manifest 取）。以上 Next.js 機制附官方文件來源與查詢日期。產出一張對照表：Go 版 `backend/internal/httpapi/auth_test.go`、`auth_resources_test.go`、`ratelimit_test.go`、`throttle_test.go`、`server_test.go`、`middleware_test.go`、`backend/internal/modules/auth/service_test.go`、`schema_test.go` 的每個案例對到「沿用／偏離（附原因）／不適用」，欄位：Go 測試名、歸屬、所屬步驟（1–5，延後的寫 4）、TS 測試名（步驟 2 起填）；開頭加「ADR 決定歸屬表」（見全域約束第 1 條）。存成 `2026-11-03-nextjs-template/auth-parity.md`。(b) D1 的候選（Drizzle、Prisma）：migration 能不能用 owner 角色跑、app 角色執行；型別與 SQL 的對應。(c) Next.js standalone 輸出放進 Docker，接 Go 版的 compose 與 Caddy。
  - 消費端：無（repo 未建）。
  - 驗收：每項一段結論加上可重跑的指令與原始輸出，存成 `2026-11-03-nextjs-template/spike.md`；結論標明實測或推論；`rg -o --no-filename '^func (Test\w+)' -r '$1'` 掃上列 Go 測試檔得到的每個名稱，在 `auth-parity.md` 都有一列；ADR 歸屬表涵蓋兩份 ADR 的每條 D。
  - 停止條件：(a) 帶跨站 Origin 的案例沒被擋下，且沒有替代 CSRF 做法時，回報 Will；沒有任何 argon2id 套件（依序試 `@node-rs/argon2`、`argon2`、`hash-wasm`）能在目標 image 載入並設成 ADR 參數時，回報 Will，不自行換演算法；session 檢查層的結論會改變不變量第 2 列的機制時，先改計畫再進步驟 1。
- [ ] **1. walking skeleton**（被擋於：D1、D3、D5、步驟 0）
  - 範圍：先跑 quality-baseline skill 決定第一版 CI；建第一個 commit（`.gitignore` 含 `AGENTS.local.md`；`.git` 已存在）、建 GitHub repo、dev branch；從 Go 版照搬工具鏈（lefthook、Biome、dependency-cruiser、knip、security.yml、tool-versions.yml、`check_commit_policy.py`、`check_locks.py`、`docs/rules/` 中與語言無關的部分）；Next.js 專案放在 repo 根目錄或 `app/`（實作時定，寫進 AGENTS.md）；U1 首頁、U6 i18n 與 CSP；`GET /api/health` Route Handler；DB 連線與一個空的 migration；compose（postgres、migrate、app、Caddy）；`pnpm check` 入口；改寫 `check_locks.py`（拿掉 Go 報告與 Go 抑制註解規則，只留 vitest 報告與 TypeScript、SQL），`quality-locks.json` 重設為新 repo 的實際數字；CI job 改成 app、policy、rename、stack、gate，gate 的 `needs` 列出其他四個；stack job 的 `intruder` 檢查換成 `template_nextjs_app` 與 `template_nextjs`。
  - 消費端：無（repo 未建）。完成後跑 `rg -n 'template[-_]go[-_]nextjs|backend/|frontend/|go test|golangci' .github lefthook.yml Makefile docker-compose*.yml scripts`，結果要為空或每筆附理由。
  - 驗收：`pnpm check` 本機綠；CI 的 app、policy、stack job 綠，stack job 打 `/api/health` 拿到 200；mutation：讓 health 回 500，stack job 要失敗；刪掉一個 integration 測試，`check_locks.py` 要失敗。
- [ ] **2. 認證垂直切片**（被擋於：D2 偏離清單經 Will 確認、D4、D7、步驟 1）
  - 範圍：需求清單 U2、U3、E1、E2、F1、F2；登入節流依 D7。
  - 不能動：步驟 1 的 CSP；session cookie 屬性由本步建立，之後照不變量第 3 列。
  - 驗收：`auth-parity.md` 標步驟 2 的列，「沿用」的 TS 測試名欄都有值且 `rg -n '<TS 測試名>' src` 找得到，「偏離」的在 D2 偏離清單裡且已確認；用步驟 0 (a) 的 harness 跑「註冊 → 登入 → GET `/dashboard` 頁面含自己的 username → 登出 → 再 GET 被導回登入頁」，CI stack job 用同一個 client 經 Caddy 跑一次；mutation（每項都要讓測試失敗）：cookie 選項移除 `httpOnly`；`serverActions.allowedOrigins` 加入攻擊來源 `evil.test`；argon2 參數調低；DB 改存明文 token；登入沿用舊 token；刪帳號不刪 session；拿掉同時雜湊數上限；撤銷 session 不檢查擁有者。
- [ ] **3. items 垂直切片**（被擋於：D4、步驟 2）
  - 範圍：需求清單 U4、E3、F3。
  - 驗收：對照 Go 版 `items_test.go`、`authz_test.go` 的案例；mutation：拿掉擁有者檢查，跨使用者讀取的測試要失敗。
- [ ] **4. 帳號濫用與管理**（D4 選精簡版，2026-11-03：本步不做，E4、F4、F5、F7 寫進範圍的「延後」；以下保留給觸發時使用）
  - 範圍：需求清單 E4、F4、F5、F7（D4 選全功能時才做；選精簡版時整步寫進延後）。
  - 驗收：`auth-parity.md` 中屬於步驟 4 的列都有測試或偏離條目，加上 Go 版 `backend/internal/modules/auth/service_test.go` 的鎖定與 devices 案例；mutation：把鎖定門檻加大，鎖定測試要失敗。
- [ ] **5. rename 腳本與 smoke test**（被擋於：步驟 1）
  - 範圍：F6；改名後 `rg` 確認每一條守門 grep 的目標字串仍指向真實存在的值（template-go-nextjs lessons 2026-11-03）。
  - 範圍補充：沿用 Go 版 `scripts/rename.py` 改寫，不另寫 TS 版。
  - 驗收：CI 跑 `make rename NAME=ci-probe` 後 `rg -n -i 'template[-_]nextjs' --hidden -g '!.git' -g '!docs/plans/**'` 沒有結果、`pnpm check` 通過；mutation：刪掉一個替換規則，smoke job 要失敗。
- [ ] **6. 收尾**（被擋於：template-fastapi-nextjs 計畫步驟 7 建好比對腳本；比對清單的改動在那個 repo commit）：完成定義逐項核對（需求清單每一列的步驟欄是「完成」或「不做」「延後」）；design-review skill 獨立審查；quality-baseline skill 重跑；共用檔加進 template-fastapi-nextjs 計畫 D4 的週回顧比對清單；D1–D7 寫成 repo ADR；延後項搬回專案頁 Pending。驗收：`rg -n '^\| [UEF][0-9]' requirements.md | awk -F'|' '{print $(NF-1)}' | rg -v '^\s*(完成|不做|延後)\s*$'` 沒有結果；CI 全綠的 run 連結。

## 決定

- **D1 資料存取與 migration**（狀態：已決 2026-11-03，Will；擋住步驟：1；事實：`spike.md` 0(b)）
  - A：Drizzle 加 drizzle-kit——寫法接近 SQL、TypeScript 原生、沒有額外的引擎程序；migration 是 SQL 檔，可以照 Go 版的做法檢查（建議）。
  - B：Prisma——生態最大、文件最完整；schema 用自己的 DSL，查詢較不透明，複雜查詢要退回 raw SQL。
  - C：Kysely 加手寫 migration——純 query builder，最接近手寫 SQL；migration 工具要自己挑。
  - 結論：A（Drizzle 加 drizzle-kit）。步驟 1 要補的（spike 0(b) 實測）：已套用 migration 檔的改動偵測（Drizzle 沒有，仿 Go 版 `atlas.sum` 自建檢查）；所有待套用 migration 在同一交易，不能用 `CREATE INDEX CONCURRENTLY`；降冪索引要寫 `.desc().nullsFirst()`；版本鎖 0.45.x 或 1.0 於步驟 1 定。ADR：步驟 6 寫成 repo ADR
- **D2 認證**（狀態：已決 2026-11-03，Will；擋住步驟：2；實作細節的事實來自步驟 0 (a)）
  - A：Better Auth——Next.js 生態目前主流的自架認證庫，內建 DB session、帳號節流與 admin 外掛；代價是 cookie 名稱、節流規則和 Go 版 ADR 不一定一樣，偏離處要逐條接受（原建議）。
  - B：照 Go 版 ADR 自己寫 opaque session——以 Go 版 ADR 與測試為準，Next.js 機制不同處列偏離；代價是要自己寫並維護安全關鍵的程式碼，業界一般不建議。
  - C：Auth.js（NextAuth）——歷史最久；帳號密碼登入不是它的主要情境，DB session 加帳密的組合官方支援較弱。
  - 結論：B（照 Go 版 ADR 自建 opaque session，不用 Better Auth；Will 2026-11-03）。理由：Go 版已自建並有測試，沿用規格與案例讓三個範本行為一致，不必逐條接受認證庫的差異。ADR：步驟 6 寫成 repo ADR
  - 偏離清單（狀態：已決 2026-11-03，Will 全部照建議；來源 `spike.md` 0(a)「D2 偏離清單候選」）：
    1. CSRF：`proxy.ts` 實作 Fetch Metadata 檢查（照 Go `CrossOriginProtection` 判斷順序），跨來源回 403；Next 內建 Origin 檢查保留為第二層。
    2. 狀態碼：因 1 採 proxy 檢查，與 Go 相同為 403，不偏離。
    3. client IP：preload（`node -r peer.cjs`）記下真實 peer，沿用 Go 的 `TRUSTED_PROXIES` 演算法；代價是改寫 Node 內部方法，升級 Node／Next 時由 `TestClientIP` 移植測試守住。
    4. 節流狀態存程序記憶體（D7=A）。
    5. 失效 cookie：頁面讀到失效 session 時 redirect 到會清 cookie 的 Route Handler；action 與登出時直接清（步驟 2 實測）。
    6. access log 由 Caddy 記；未捕捉錯誤走 `instrumentation.ts` `onRequestError`。
    7. 請求主體上限用 `serverActions.bodySizeLimit`，回應不是 413 problem。
    8. 慢速標頭攻擊交給 Caddy。
    9. 契約唯一來源從 OpenAPI 改成 zod schema。
    10. migration 工具從 Atlas 改成 Drizzle（D1），角色權限斷言沿用。
- **D3 對外 API**（狀態：已決 2026-11-03，Will；擋住步驟：1）
  - A：只用 Server Actions 給自己的畫面用，Route Handler 只有 health——Next.js 全端的標準做法，最少程式碼；代價是沒有給行動 App 或第三方用的 API，需要時再加（建議）。
  - B：Route Handlers 提供 REST 加手寫 OpenAPI，畫面也走這組 API——和另外兩個 template 的契約一致；代價是多一層，也失去 Server Actions 的簡潔。
  - 結論：A（只用 Server Actions；Route Handler 只有 health）；ADR：步驟 6 寫成 repo ADR
- **D4 功能範圍**（狀態：已決 2026-11-03，Will；擋住步驟：2、3、4）
  - A：精簡：認證（F1、F2）加 items（F3）；帳號濫用與管理（F4、F5）寫進延後——Next.js 全端範本通常用在較小的專案，維持輕量（建議）。
  - B：全功能：和 Go 版相同，含 F4、F5——三個範本功能對等；代價是步驟 4 的工作量大約和步驟 2、3 加起來一樣。
  - 結論：A（精簡：認證加 items；E4、F4、F5、F7 延後，步驟 4 不做）；ADR：步驟 6 寫成 repo ADR
- **D5 部署**（狀態：已決 2026-11-03，Will；擋住步驟：1；事實：`spike.md` 0(c)）
  - A：和 Go 版相同：Docker Compose 加 Caddy，部署到自己的 VPS——沿用 `docs/deploy-vps.md` 與 CI stack job（建議）。
  - B：Vercel 加託管 PostgreSQL（例如 Neon）——Next.js 的主流部署方式，不用管機器；代價是有月費、DB 角色分離要另外設定，CI stack job 要重做。
  - 結論：A（Docker Compose 加 Caddy，自己的 VPS；image 用 `node:*-slim`）。步驟 1 要補的（spike 0(c) 實測）：`poweredByHeader: false`；`/api/health` 加 `Cache-Control: no-store`；`stop_grace_period: 35s`；預設不開 `cacheComponents`（與 nonce CSP 不相容，要開時另交 Will）。ADR：步驟 6 寫成 repo ADR

- **D6 GitHub repo 公開與否**（狀態：已決 2026-11-03，Will；擋住步驟：1）
  - A：public，和 Go 版相同——可以展示給接案客戶看，`security.yml` 的寫法沿用；代價是程式碼公開（建議）。
  - B：private——不公開；代價是部分 GitHub 免費安全功能（例如 private vulnerability reporting 以外的 code scanning）需要付費方案。
  - 結論：A（public）；ADR：步驟 6 寫成 repo ADR

- **D7 步驟 2 的登入節流範圍**（狀態：已決 2026-11-03，Will；擋住步驟：2；實作做法由步驟 0 (a) 確認）
  - 背景：Go 版 api-and-auth ADR 的基線是 per-IP 限流加節流；2026-10-22 修訂把「只依帳號」改成依「帳號＋來源」，因為只依帳號會讓任何人把本人鎖在門外（`2026-10-18-api-and-auth-baseline.md` D6 rationale）。D4 把 F4（依帳號節流、鎖定、trusted device 等）延後，兩者重疊。
  - A：步驟 2 做 per-IP 限流與依「帳號＋來源」的退避（來源是 IP，IPv6 取 /64），存在程序記憶體，前提是單一實例，D5=A 時成立；D5 選 B（Vercel 是多實例）或之後改多實例時失效，要改存 DB 並重開 D7；`sign_in_throttles` 表、帳號層級上限、裝置 cookie、鎖定仍延後——範本出貨就有暴力破解防護，又不會讓別人把本人鎖在外面，程式量小（建議）。
  - B：步驟 2 只做 per-IP 限流，依帳號節流跟 F4 一起延後——更少程式；代價是偏離 Go 版基線，列進 D2 偏離清單。
  - C：步驟 2 照 Go 版完整做，含 DB 的 `sign_in_throttles`、帳號層級上限與裝置 cookie——和 Go 版一致；代價是把 D4 延後的一部分拉回來。
  - 結論：A（per-IP 限流加「帳號＋來源」退避，存記憶體；D5 選 B 時重開）；ADR：步驟 6 寫成 repo ADR

拍板順序：D1–D7 與 D2 偏離清單皆已決（2026-11-03）。

## 進度

狀態值：未開始／進行中／程式完成待驗收／完成。

| 步驟 | 狀態 | 已跑的驗收 | 未跑的驗收與原因 | commit |
|---|---|---|---|---|
| 0 spike | 完成 | 2026-11-03：`spike.md`、`auth-parity.md` 產出；orchestrator 重跑 a 的 vitest（20 過）、b 的 integration（各 2 過）、parity 完整性（87 名稱無缺） | a 的 4 個 Docker stack 測試與 c 未由 orchestrator 重跑（機器 load 高；子代理已實測，原始輸出在 `spike.md`）；amd64 未測 | 未 commit（repo 無首個 commit，併入步驟 1） |
| 1 walking skeleton | 未開始 | | | |
| 2 認證 | 未開始 | | | |
| 3 items | 未開始 | | | |
| 4 帳號濫用與管理 | 延後（D4） | | | |
| 5 rename | 未開始 | | | |
| 6 收尾 | 未開始 | | | |
