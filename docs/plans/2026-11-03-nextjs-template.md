# template-nextjs：只用 Next.js 的全端範本

**Goal：** 一個沒有獨立後端的 Next.js 全端 monorepo 範本：`make dev` 起整個 stack，`make rename NAME=x` 產生衍生專案，CI 綠燈，D4 決定範圍內的需求清單每一項都有測試。驗收見步驟 6。

**上層：** 見本機個人脈絡檔（主清單在 repo 外）。沒有主計畫，下一段暫代。

**附件：** [`2026-11-03-nextjs-template/requirements.md`](2026-11-03-nextjs-template/requirements.md)：需求清單（畫面、資料實體、流程、非功能需求）。工具鏈與安全基線參考 `template-go-nextjs@560106d`。

## 全域約束與完成定義（暫代主計畫）

- 安全基線沿用 Go 版 ADR `docs/adr/2026-10-18-api-and-auth-baseline.md`、`docs/adr/2026-10-22-account-abuse-and-lifecycle.md`；認證自建（D2），因 Next.js 機制不同而偏離它的地方，要列進 D2 的偏離清單並經 Will 確認。兩份 ADR 的每條決定在本計畫的歸屬（沿用／偏離／延後／不適用，加所屬步驟 1–5）由步驟 0 (a) 列在 `auth-parity.md` 開頭的「ADR 決定歸屬表」。
- E2E 與瀏覽器測試不在本機跑，只在 CI 跑。
- 完成定義（每一步）：需求清單該步的每一項有 vitest 單元或 integration 測試（integration 測試用 vitest 的 `integration` project，只在 CI 跑，測試數另有一個鎖）；`pnpm check`（步驟 1 建立）本機綠燈且 CI 綠燈；`check_locks.py` 的測試數鎖調到新數字；需求清單該列的「狀態」欄改成「完成」。

## 前提（開工時核對過，2026-11-03）

- 會改到或取代的既有部署是否在線：無既有部署，全新 repo，不受回滾與相容性窗口約束。目錄已有 kickoff 建的 `AGENTS.md`、`AGENTS.local.md`（不進版控）和 `docs/plans/`，在步驟 1 一起進第一個 commit。
- 目錄已有自己的 `.git`（無任何 commit，分支 `main`）：`git -C <本目錄> rev-parse --show-toplevel` 指向本目錄（2026-11-03 實測）。步驟 1 不再 `git init`，直接建第一個 commit；之前仍先跑同一個指令確認不會落到 second-brain 父 repo。
- 範本使用者是 Will 自己，有 Go 版的使用證據，省略產品風險驗證（來源：2026-11-03 對話；已確認）。
- 工具鏈預設（可推翻）：Next.js 16、React 19、TypeScript、pnpm、Biome、vitest、next-intl、zod，和 Go 版前端相同（來源：Go 版 `frontend/package.json`）；PostgreSQL 18，DB 分 owner 與 app 兩個角色（Go 版 `deploy/postgres/initdb/10-roles.sh`）。
- integration 測試用 testcontainers 起 PostgreSQL，用 vitest 的 `integration` project 跑（`pnpm test:integration`），只在 CI 跑；`pnpm check` 與 pre-push 只跑單元測試。測試數分 `tests.unit`、`tests.integration` 兩個鎖（Will 2026-11-03 推翻原預設「本機可跑」：開發機共用、高負載，PostgreSQL 測試容器與 compose stack 都不在本機跑）。
- GitHub repo 建立在 `Will413028/template-nextjs`，用 dev branch 模型；public（D6）。

**驗收基線：** repo 未建，無。

## 本階段依賴的不變量

| 不變量 | 依賴它的機制（預計的模組） |
|---|---|
| 資料庫只在伺服器端存取；client component 不 import DB 或認證的伺服器模組 | `src/server/db.ts`、`src/server/env.ts`、`src/features/*/server/**`（D8）；`import "server-only"` 與檢查它的單元測試；`.dependency-cruiser.cjs` 的 D8 規則與守住它的 `src/__tests__/architecture.test.ts`（`pg`、`drizzle-orm/node-postgres`、`src/server/db.ts` 只准 `features/*/server/**`、`src/server/**`、`app/api/health/route.ts` import） |
| 每個讀寫使用者資料的 Server Action、server component 與 Route Handler 都先驗證 session 與擁有者 | `src/features/auth/server.ts` 的 `requireSession()`、`authedAction()`、`publicAction()` 與 branded `Viewer` 型別，DAL 函式（`features/*/server/queries.ts`）第一個參數是 `viewer: Viewer`（D8）；單元測試：`"use server"` 檔只能叫 `actions.ts`、每個 export 是 `authedAction(` 或 `publicAction(`，`publicAction` 只在 auth 的註冊與登入；dependency-cruiser 規則：DB 模組只能由 D8 列的路徑 import；integration 測試：從 build manifest 列出所有 action ID，逐一不帶 cookie 呼叫，除註冊與登入外全部被拒；步驟 2 的跨使用者撤銷 session 測試、步驟 3 的跨使用者讀寫測試 |
| session token 只存 SHA-256；cookie 是 `__Host-session; HttpOnly; Secure; SameSite=Lax`；absolute 7 日、idle 1 日；不接受 Bearer；無效 cookie 清掉；登入一律發新 token；未知帳號也跑一次雜湊；刪帳號要 10 分鐘內登入過、並撤銷所有 session；argon2id 參數與同時雜湊數上限照 Go 版 ADR；登入名稱是 username | `src/features/auth/server/session.ts`、`src/features/auth/server/password.ts`（D8，預計）與步驟 2 的對應測試 |
| DB 分 owner 與 app 兩個角色，app 角色只有 DML（users、sessions 等認證資料表和其他表一樣由 owner migrate） | `deploy/postgres/initdb/10-roles.sh`、migrate 命令用 owner、app 執行時用 app 角色、CI stack job 的 `intruder` 檢查 |
| 錯誤對使用者顯示走 next-intl 訊息，不顯示伺服器內部細節 | `messages/*.json`、`error.tsx`、action 的錯誤回傳型別 |
| 佔位名稱 `template-nextjs`／`template_nextjs` 只出現在 rename 腳本認得的檔案 | `scripts/rename.py`（從 Go 版改寫）的 `STACK_FILES`、`BRAND_FILES`、CI rename smoke job |

## 範圍

- 做：需求清單裡 D4 決定的範圍。
- 不做：admin 使用者管理畫面（Go 版也延後）；和其他兩個 template 共用程式碼；Vercel、Cloudflare 等託管平台（D5=A 自架；Will 2026-11-03 再確認範本不實際使用它們）。
- 延後：帳號濫用與管理（requirements E4、F4、F5、F7，原步驟 4），觸發：第一個需要登入鎖定、trusted device、admin 或稽核紀錄的衍生專案（D4）。
- 延後：Go 版專案頁 `wiki/projects/template-go-nextjs/index.md` Pending「延後」段的 12 項（email 驗證與找回密碼、MFA、OTel、背景工作、多實例、managed Postgres、`pg_hba`、OpenAPI 3.1、ogen spike、compose 固定 subnet、admin UI、`FieldError` 帶參數），觸發條件照該頁；其中只跟 Go 後端有關的（ogen spike、OpenAPI 3.1）收尾時標不適用。

## 步驟

- [x] **0. spike：認證、資料存取與部署**（被擋於：無）
  - 範圍：在暫存目錄各做一個拋棄式試驗，產出事實。(a) 自建 opaque session（D2）在 Next.js 16 上的機制事實：argon2id 套件（候選 `@node-rs/argon2`）在 Node runtime 與 standalone Docker image 裡能不能載入、雜湊參數能不能設成 Go 版 ADR 的值；Server Action 裡用 `cookies()` 設 `__Host-` 前綴、`HttpOnly`、`Secure`、`SameSite` 的 cookie；Server Actions 內建的 Origin／Host 檢查能不能取代 Go 版的 CSRF 防護：實測比照 Go 版 `server_test.go` `TestCrossOriginPostRejected` 的每個案例並逐案寫預期（擋下／放行）。已知（2026-11-03 讀 next 16.4.2 `action-handler.js` 原始碼，推論待實測）：Next 只比對 `Origin`，不看 `Sec-Fetch-Site`，不帶 Origin 時放行並記警告，Origin 不符回 500；所以只帶 `Sec-Fetch-Site` 的案例要決定標「不適用」（瀏覽器跨站 POST 一定帶 Origin）並列進 D2 偏離清單，或在 proxy 補 Fetch Metadata 檢查，兩案都寫進 spike 結論交 Will。另加偽造 `X-Forwarded-Host`（經 Caddy）一例；斷言用「action 沒有執行（DB 沒寫入、沒有 `Set-Cookie`）」，不比狀態碼；session 查詢放在哪一層（proxy 或 server component）才不會被繞過；登入節流在單一程序內的做法（範圍依 D7）；Caddy 後方怎麼取得 client IP、怎麼忽略非 Caddy 來源的 `X-Forwarded-For`（對照 Go 版 `ratelimit_test.go` 的 trusted proxy、IPv6 /64 案例）；Server Action 的測試 harness：`next build` 後在 vitest integration 裡起 `next start`（非瀏覽器），從 build manifest（`.next/server/server-reference-manifest.json`）取 action ID 送 POST，手動帶 cookie 標頭，能讀回 `Set-Cookie` 並觀察 Origin 檢查，留一個可重跑的範例；同一個 client 也要能對 compose 裡的 image 經 Caddy 跑（ID 從 image 內的 manifest 取）。以上 Next.js 機制附官方文件來源與查詢日期。產出一張對照表：Go 版 `backend/internal/httpapi/auth_test.go`、`auth_resources_test.go`、`ratelimit_test.go`、`throttle_test.go`、`server_test.go`、`middleware_test.go`、`backend/internal/modules/auth/service_test.go`、`schema_test.go` 的每個案例對到「沿用／偏離（附原因）／不適用」，欄位：Go 測試名、歸屬、所屬步驟（1–5，延後的寫 4）、TS 測試名（步驟 2 起填）；開頭加「ADR 決定歸屬表」（見全域約束第 1 條）。存成 `2026-11-03-nextjs-template/auth-parity.md`。(b) D1 的候選（Drizzle、Prisma）：migration 能不能用 owner 角色跑、app 角色執行；型別與 SQL 的對應。(c) Next.js standalone 輸出放進 Docker，接 Go 版的 compose 與 Caddy。
  - 消費端：無（repo 未建）。
  - 驗收：每項一段結論加上可重跑的指令與原始輸出，存成 `2026-11-03-nextjs-template/spike.md`；結論標明實測或推論；`rg -o --no-filename '^func (Test\w+)' -r '$1'` 掃上列 Go 測試檔得到的每個名稱，在 `auth-parity.md` 都有一列；ADR 歸屬表涵蓋兩份 ADR 的每條 D。
  - 停止條件：(a) 帶跨站 Origin 的案例沒被擋下，且沒有替代 CSRF 做法時，回報 Will；沒有任何 argon2id 套件（依序試 `@node-rs/argon2`、`argon2`、`hash-wasm`）能在目標 image 載入並設成 ADR 參數時，回報 Will，不自行換演算法；session 檢查層的結論會改變不變量第 2 列的機制時，先改計畫再進步驟 1。
- [x] **1. walking skeleton**（被擋於：D1、D3、D5、步驟 0）
  - 範圍：先跑 quality-baseline skill 決定第一版 CI；建第一個 commit（`.gitignore` 含 `AGENTS.local.md`；`.git` 已存在）、建 GitHub repo、dev branch；從 Go 版照搬工具鏈（lefthook、Biome、dependency-cruiser、knip、security.yml、tool-versions.yml、`check_commit_policy.py`、`check_locks.py`、`docs/rules/` 中與語言無關的部分）；Next.js 專案放在 repo 根目錄或 `app/`（實作時定，寫進 AGENTS.md）；U1 首頁、U6 i18n 與 CSP；`GET /api/health` Route Handler；DB 連線與一個空的 migration；compose（postgres、migrate、app、Caddy）；`pnpm check` 入口；改寫 `check_locks.py`（拿掉 Go 報告與 Go 抑制註解規則，只留 vitest 報告與 TypeScript、SQL），`quality-locks.json` 重設為新 repo 的實際數字；CI job 改成 app、policy、rename、stack、gate，gate 的 `needs` 列出其他四個；stack job 的 `intruder` 檢查換成 `template_nextjs_app` 與 `template_nextjs`。
  - 消費端：無（repo 未建）。完成後跑 `rg -n 'template[-_]go[-_]nextjs|backend/|frontend/|go test|golangci' .github lefthook.yml Makefile docker-compose*.yml scripts`，結果要為空或每筆附理由。
  - 驗收：`pnpm check` 本機綠；CI 的 app、policy、stack job 綠，stack job 打 `/api/health` 拿到 200；mutation：讓 health 回 500，stack job 要失敗；刪掉一個 integration 測試，`check_locks.py` 要失敗。
- [x] **2. 認證垂直切片**（被擋於：D2 偏離清單經 Will 確認、D4、D7、步驟 1）
  - 範圍：需求清單 U2、U3、E1、E2、F1、F2；登入節流依 D7。2026-11-03 拆成 2a、2b、2c（一個 session 做不完；Will 同意），依序做，各自 commit 並以 CI 驗收；下面的「驗收」是三個子步驟合起來的驗收，2c 完成時逐項核對。
  - 不能動：步驟 1 的 CSP；session cookie 屬性由本步建立，之後照不變量第 3 列。
  - [x] **2a. 資料層與服務層**（被擋於：步驟 1；新依賴 `@node-rs/argon2` ~2.2.2 Will 2026-11-03 核准）
    - 範圍：E1、E2 的 `src/features/auth/schema.ts` 與 migration；`src/features/auth/server/`：密碼（NFKC、長度、常見密碼清單、argon2id 與同時雜湊數上限、未知帳號跑 dummy hash）、session token（32 bytes base64url、只存 SHA-256、absolute／idle 期限、touch 頻率）、服務函式（註冊、登入、讀 session、登出、全部登出、列出／撤銷自己的 session、刪帳號要 10 分鐘內登入、cleanup）、記憶體節流（`IPLimiter`、`SignInThrottle`）、client IP 演算法（`clientIP`、`limitKey`，純函式）、安全事件日誌；branded `Viewer` 型別在這一步定義，2b 由 `server.ts` 匯出。不含 cookie、action、proxy、preload 與畫面。
    - 消費端：無（新模組）；2b 的 `server.ts`、`actions.ts`。`rg -n 'features/auth' src test`。
    - 驗收：auth-parity 標步驟 2 且屬服務層或 DB 的列填上 TS 測試名（`rg` 找得到）；unit 測試本機綠、integration 測試 CI 綠；`pnpm check` 本機綠；mutation：argon2 參數調低、DB 存明文 token、登入沿用舊 token、刪帳號不刪 session、拿掉同時雜湊數上限、撤銷 session 不檢查擁有者，各讓一個測試失敗（本機能跑的跑 unit；integration 的 mutation 用 CI 的 draft PR）。
  - [x] **2b. Server Action 邊界**（被擋於：2a）
    - 範圍：`server.ts`（`requireSession`、`authedAction`、`publicAction`、`Viewer`）、`actions.ts`（註冊、登入、登出、全部登出、撤銷 session、刪帳號）與 `__Host-session` cookie；登入與註冊的 per-IP 限流和節流接上 action；`proxy.ts` 的 Fetch Metadata CSRF（D2 偏離清單第 1 條）與 matcher 涵蓋所有路徑；清失效 cookie 的 GET Route Handler（D3 修訂）；peer preload（D2 偏離清單第 3 條）與 Dockerfile 的 `NODE_OPTIONS`；`next start` harness 與 action client（spike 0(a) §7）；「`"use server"` 檔只叫 `actions.ts`、每個 export 是 `authedAction(`／`publicAction(`」單元測試；「manifest 每個 action 不帶 cookie 被拒」integration 測試。
    - 範圍補充（2a code review 留下的）：`SignInThrottle` 為每組「帳號＋來源」各存一筆、保留 24 小時，未知帳號也算；接上 per-IP 限流後，量出一個來源每分鐘最多能新增幾筆，決定要不要設總筆數上限（上限滿時不能淘汰別人的計數，否則攻擊者能借此重置退避）。接受、不修：DB 出錯的登入嘗試仍算一次失敗（和 Go 的 `ReserveLoginAttempt` 相同）。
    - 範圍補充（2026-11-03 開工時）：build manifest 只收「有頁面 import 的 action」（實測：見進度表），integration 測試要呼叫得到每個 action，所以 2b 先放最小可用的頁面——`/[locale]/sign-in`、`sign-up`、`dashboard`（顯示 username、登出）、`settings`（裝置列表與撤銷、全部登出、刪帳號），文字走 next-intl 的 `auth` namespace，錯誤只顯示原始 code；2c 負責樣式、錯誤碼翻譯、overview 內容與端到端流程。session 與節流的每小時 cleanup 在 auth runtime 第一次建立時啟動（`setInterval(...).unref()`），不另開 `instrumentation.ts`。
    - 驗收：auth-parity 屬 cookie、action、CSRF、client IP、限流的列填上 TS 測試名；mutation：cookie 移除 `httpOnly`、`serverActions.allowedOrigins` 加 `evil.test`（proxy 先擋 Origin 不符的請求，所以這個 mutation 由「`Sec-Fetch-Site: same-origin` 但 Origin 是外站」那一案驗：proxy 放行、Next 內建檢查擋下）。
  - [x] **2c. 畫面與收尾**（被擋於：2b）
    - 範圍：U2 註冊與登入頁、U3 dashboard overview 與 settings（登入中裝置列表與撤銷、全部登出、刪帳號；2b 已放最小可用版，2c 補樣式與內容）、`messages/*.json` 的錯誤碼翻譯、next-intl 的 `timeZone`（2b code review：settings 的時間目前用伺服器時區並記錄警告）；2b 留下的 request id（auth-parity `TestRequestID*` 與 `TestSecurityEventsLogged` 的 `request_id`）；步驟 1 留下的 `_global-error` nonce 問題；端到端流程與 stack job 經 Caddy；requirements 的 U2、U3、E1、E2、F1、F2 改「完成」。
    - 驗收：本步下列「驗收」的端到端流程與剩餘 mutation；auth-parity 標步驟 2 的列全部核對（一次性腳本 `2026-11-03-nextjs-template/check-parity.py`，從 repo 根目錄跑）。
    - `_global-error` 的處置（2026-11-03 實測，next 16.4.3）：預先產生的 `_global-error.html` 在找得到的路徑上都不會送出——layout 丟錯時 500 頁按請求動態產生、14 個 script 全帶 nonce；proxy 丟錯時回純文字 500、沒有 CSP。步驟 1 看到的「靜態頁配 nonce CSP」實際發生在未知路徑：Next 內建的 `_not-found`（英文、13 個 script 都沒有 nonce），2c 以 `[locale]/[...rest]` catch-all 改成翻譯過、帶 nonce 的 `[locale]/not-found.tsx`；它的 HTML 是 Next 的空錯誤外殼，內容在 RSC payload、hydrate 後顯示。
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
    11. 登入成功只清掉該次登入來源的節流計數，不清該帳號所有來源（Go `ClearLoginThrottles` 全清，搭配步驟 4 才做的帳號層級上限）；否則本人每登入一次，攻擊者的退避就重置（2a code review 提出，Will 2026-11-03 確認）。
    12. 註冊密碼的最少 15 字元以 NFKC 正規化後的長度計算（最多 128 仍算原始輸入）；Go 兩者都算原始輸入，正規化後可能縮短到 15 以下（2a code review 提出，Will 2026-11-03 確認）。
    13. 沒有 session 時登出：Go `DELETE /sessions/current` 回 204；這裡 `signOut` 是 `authedAction`，回 `unauthenticated`（不變量第 2 列：只有註冊與登入是 `publicAction`），帶著失效 cookie 時一樣清掉，使用者看到的結果相同（2b 提出，Will 2026-11-03 照建議接受）。
- **D3 對外 API**（狀態：已決 2026-11-03，Will；擋住步驟：1）
  - A：只用 Server Actions 給自己的畫面用，Route Handler 只有 health——Next.js 全端的標準做法，最少程式碼；代價是沒有給行動 App 或第三方用的 API，需要時再加（建議）。
  - B：Route Handlers 提供 REST 加手寫 OpenAPI，畫面也走這組 API——和另外兩個 template 的契約一致；代價是多一層，也失去 Server Actions 的簡潔。
  - 結論：A（只用 Server Actions；Route Handler 只有 health）；ADR：步驟 6 寫成 repo ADR
  - 修訂（2026-11-03，Will）：Route Handler 是 `/api/health` 加一個清掉失效 session cookie 後導回登入頁的 GET（D2 偏離清單第 5 條需要它：server component 不能寫 cookie）；其餘仍只用 Server Actions。
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

- **D8 原始碼結構與依賴方向**（狀態：已決 2026-11-03，Will；擋住步驟：1；來源：步驟 1 開工時的設計 brief，查 Next.js data-security／authentication 指南、bulletproof-react、Feature-Sliced Design、create-t3-app、next-safe-action，2026-11-03）
  - A：沿用 Go 版前端分層，加一層橫向 `src/server/`（DB、env、auth、各功能的查詢）——伺服器端程式碼集中；代價是每個功能拆成 UI 與 data 兩棵樹，Go 版的分層來自「後端是另一個程序」，在只有 Next 的 repo 不存在。
  - B：每個 feature 是垂直切片，自己擁有 Drizzle `schema.ts`、DAL（`server/queries.ts`）、`actions.ts`、元件；`src/server/` 只放 DB client 與 env；對應 Go 版後端 modular monolith 的模組（建議）。
  - C：照 Next 文件用單一 `data/` 加集中的 schema——兩個功能時最簡單；功能變多後 data、actions、元件分散三處。
  - 結論：B。規則（`.dependency-cruiser.cjs`，全部 error、零例外）：無環；`lib`、`components`、`hooks`、`i18n` 不 import `features`、`app`、`server`；`src/server/**` 只 import `lib`；`features` 不 import `app`；feature 外只經 `index.ts`、`server.ts`、`schema.ts` 進入；`schema.ts` 只 import `drizzle-orm`（建構函式與 `sql`，不含 driver）與其他 feature 的 `schema.ts`；`features/auth` 不 import 其他 feature；`pg`、`drizzle-orm/node-postgres`、`src/server/db.ts` 只准 `features/*/server/**`、`src/server/**`、`app/api/health/route.ts`；client 側（`index.ts`、`components/**`）不 import 伺服器模組。action 一律用 `authedAction`／`publicAction` 定義，DAL 第一個參數是 `Viewer`。失效條件：兩個 feature 要互相 join 資料表時，改經對方 `server.ts` 取資料。ADR：步驟 6 寫成 repo ADR

- **D9 記憶體節流計數的總筆數上限**（狀態：已決 2026-11-03，Will 照建議；擋住步驟：2b 收尾；事實：2b 實測，見下）
  - 背景：`SignInThrottle` 每組「帳號＋來源」一筆、保留 24 小時，未知帳號也記。實測（假時鐘跑真的 `IPLimiter`＋`SignInThrottle`，scratch 腳本 `measure.mjs`）：預設 `AUTH_RATE_LIMIT_PER_MIN=5` 時，一個來源第一分鐘最多新增 9 筆、一天 7,204 筆；每筆約 333 bytes（V8 heap，10 萬筆取平均），即每個來源每天約 2.4 MB。來源是 IPv4 位址或 IPv6 /64：手上有一個 IPv6 /48 的攻擊者有 65,536 個來源，一天最多約 157 GB，程序會 OOM。Go 版存在 DB，沒有這個問題。
  - A：不設上限——程式最少；代價是上面的記憶體耗盡風險。
  - B：設上限（例如 10 萬筆，約 33 MB），滿了就不記新的組合但放行嘗試——不會擋到正常使用者；代價是表被灌滿後，新組合只剩 per-IP 限流，沒有退避。
  - C：設上限，滿了就拒絕新組合的登入——退避不失效；代價是攻擊者灌滿後，從來沒失敗過的正常使用者全部登不進去（登入 DoS）。
  - D：設上限，滿了先淘汰最舊的「沒有在等待中」的計數（失敗少於 5 次或等待已過），全部都在等待中才放行而不記——已在退避中的計數不會被淘汰，所以 2a review 擔心的「淘汰別人的計數來重置退避」只剩 4 次以內的部分計數會被清；能灌滿 10 萬筆的攻擊者本來就有上萬個來源、每個來源各有 4 次免費嘗試，淘汰沒有給他更多（建議）。
  - 結論：D，上限 10 萬筆（`throttle.ts` 的 `MAX_ENTRIES`），實作時收緊一點：可淘汰的只有失敗少於 5 次的組合；失敗達 5 次的就算等待已過也不淘汰，只由每日清理移除。原因是 2b code review 指出，淘汰等待已過的組合會把整條指數退避歸零，不只是 4 次。失敗少於 5 次的組合用雙向鏈結串列依計數先後排列，淘汰最舊的一筆，是 O(1)。不用 `Map` 的插入順序：V8 刪掉的 entry 會留下空位，取第一筆要跨過它們，實測 2 萬次淘汰 4.2 秒。表滿且全部都是退避中的組合時，新組合放行但不計數，並記 `auth.sign_in_throttle_full`（一分鐘最多一筆，帶這段期間沒計數的次數 `uncounted`）。這是 D 原本就接受的代價，第二輪 review 補上它的實際成本：攻擊者用一個 IPv6 /48 約 50 萬次失敗嘗試就能讓 10 萬組進入退避；之後每日清理騰出空間前（最長 24 小時，攻擊者重試會延長），還沒被記錄的來源對同一帳號每分鐘各有 5 次（per-IP 上限），沒有指數退避；表接近滿時，同一個來源也能反覆讓自己的組合被淘汰。要再收緊得加帳號層級的上限（Go 版 D4 的一部分，D7 延後），觸發條件與 D7 相同。實測（tsx，10 萬筆）：每筆 165 bytes（IPv4＋10 字 username）到 277 bytes（IPv6 /64＋50 字中文 username；username 上限 50），上限時約 17–28 MB；淘汰每次 2–18 µs，連跑 40 萬次不隨次數變慢；99,999 組在退避中、10 萬個新組合共 1.9 秒；清理 10 萬筆 0.4 秒。ADR：步驟 6 併入 D7 的 repo ADR

拍板順序：D1–D9 與 D2 偏離清單 1–13 皆已決（2026-11-03）。

## 進度

狀態值：未開始／進行中／程式完成待驗收／完成。

| 步驟 | 狀態 | 已跑的驗收 | 未跑的驗收與原因 | commit |
|---|---|---|---|---|
| 0 spike | 完成 | 2026-11-03：`spike.md`、`auth-parity.md` 產出；orchestrator 重跑 a 的 vitest（20 過）、b 的 integration（各 2 過）、parity 完整性（87 名稱無缺） | a 的 4 個 Docker stack 測試與 c 未由 orchestrator 重跑（機器 load 高；子代理已實測，原始輸出在 `spike.md`）；amd64 未測 | 未 commit（repo 無首個 commit，併入步驟 1） |
| 1 walking skeleton | 完成 | 2026-11-03：本機 `pnpm check` exit 0（unit 13）；CI run 41581092195 全綠（app 含 integration 8、policy、rename、stack：health 200、en／zh-TW 各 20 個 script 全帶 nonce、uid 1001、app 角色 DDL 被拒；Security 全綠）；mutation：PR #4 health 回 500 → stack job `app is unhealthy` 失敗、integration 測試 `expected 500 to be 200`；PR #5 刪一個 integration 測試 → `tests.integration: 7, locked at 8`；本機 mutation：depcruise 違規、server-only 標頭、noProcessEnv、zizmor unpinned-uses、hadolint、unit 測試數鎖；消費端 `rg` 無結果；獨立 code review 1 blocking＋5 should 已修 | `_global-error` 是靜態頁卻帶 nonce CSP（錯誤頁不 hydrate），記為步驟 2 處理；drizzle-kit 接著 0000 snapshot 產生下一支 migration 由步驟 2 第一個 schema 驗證 | dev `308cf6b` 之後（見 git log） |
| 2a 資料層與服務層 | 完成 | 2026-11-03：本機 `pnpm check` exit 0（unit 52）；CI run 41591430229 全綠（integration 31、Security 綠）；mutation：本機 argon2 記憶體調到 8 MiB、拿掉同時雜湊上限各讓一個 unit 測試失敗；CI draft PR #6（run 41591010631）四個 mutation（明文 token、登入不刪舊 session、FK 不 cascade、撤銷不檢查擁有者）讓 5 個目標 integration 測試失敗、其餘 25 過；auth-parity 2a 列的 35 個 TS 測試名 `rg` 全找得到；`/code-review high` 10 條（6 修、1 記入 2b、1 接受、2 交 Will），diff 視角審查 1 blocking＋2 should 已修、2 nit 不修；drizzle-kit 接著 0000 產生 0001（步驟 1 留下的未驗收項） | 已決：NFKC 後的長度下限（D2 偏離第 12 條）、登入成功只清該來源的計數（D2 偏離第 11 條）；遠端分支 `ci-mutation/2a-service` 已刪 | dev `8ecd95f`…`8602365` |
| 2b Server Action 邊界 | 完成 | 2026-11-03：本機 `pnpm check` exit 0（unit 70）；CI run 41612550969 全綠（integration 53、rename、stack、Security 綠）；本機 smoke（`next start`＋`peer.cjs`，不起資料庫）：manifest 正好是 `actions.ts` 的 6 個 action、4 個 authed action 無 cookie 回 `unauthenticated`、不受信任的 peer 偽造 XFF 第 3 次 `rate_limited` 30 秒、跨站 403、`Sec-Fetch-Site: same-origin`＋外站 Origin 被 Next 擋（500）、未登入 GET `/en/dashboard` 307 到 `/en/sign-in`；action 要 POST 到 bundle 了 `actions.ts` 的頁面（harness 用 `/en/sign-in`），轉送路徑的 peer 變成 127.0.0.1、共用一個限流 key（fail-closed，`runtime.ts` 註明 loopback 不可列入 `TRUSTED_PROXIES`）；mutation：本機 proxy 改比 `X-Forwarded-Host`、`signOut` 改 `publicAction`、`export async function`／`export let` 各讓一個 unit 測試失敗，bad `TRUSTED_PROXIES` 的舊寫法讓 runtime 測試失敗；CI draft PR #7（run 41613397037）cookie 拿掉 `httpOnly`＋`allowedOrigins: ["evil.test"]` → 3 個目標 integration 測試失敗、其餘 50 過；auth-parity 2b 列 TS 測試名 `rg` 全找得到；`/code-review high` 10 條：4 修（設定先解析、撤銷大寫 id 清 cookie、`export let/var`、server 依序啟動）、1 記入程式註解（轉送路徑的 peer）、5 不修（已推送 commit 的鎖順序要 force push；settings 時區交 2c；proxy 熱路徑與兩處重複屬 nit）；D9（2026-11-03 Will 照建議選 D）：`throttle.ts` 上限 10 萬筆，先寫的兩個測試在實作前 `2 failed`；三輪 `/code-review high`／`high`／`medium`：第 1 輪抓到舊掃描寫法 O(n)（review 實測 1,000 個新組合 119 秒）與淘汰等待已過的組合會重置退避，改成兩類分存；第 2 輪抓到 `Map` 取最舊一筆在 V8 不是 O(1)（本機重現 2 萬次淘汰 4.2 秒），改雙向鏈結串列，另補表滿 log、`maxEntries` 檢查、sweep 退避組合的測試；第 3 輪補 log 帶 `uncounted`、時鐘倒退仍報；不修：logger 丟例外（service 所有 log 皆同步，非本次引入）、時鐘倒退時 sweep 提早停（只是晚一次清理，總數仍受上限）；本機 mutation 10 項（淘汰退避組合、淘汰最新而非最舊、重新計數不移到尾端、拿掉上限、sweep 漏退避表、`onFull` 不限頻、`uncounted` 不歸零、時鐘倒退不報、拿掉 `maxEntries` 檢查、舊寫法的淘汰）各讓一個 unit 測試失敗；實測見 D9；本機 `pnpm check` exit 0（unit 77）；CI run 41636680220（`711887f`）、41639454316（`537118f`）、41641261639（`294a8fb`）全綠 | request id（auth-parity `TestRequestID*`、`TestSecurityEventsLogged` 的 `request_id`）未做，移到 2c；`auth.sign_in_throttle_full` 由 service 接上，拿掉這條接線時沒有測試會失敗（`throttle.test.ts` 只測到 `onFull` 本身；在 service 層觸發要先灌滿 10 萬組，未做） | dev `dc20c63`…`294a8fb` |
| 2c 畫面與收尾 | 完成 | 2026-11-03：本機 `pnpm check` exit 0（unit 82）；CI run 41651166758（`39ccd7d`）與 41656113695（`9df8ced`）全綠（integration 68；stack 經 Caddy：`/en`、`/zh-TW`、`/en/sign-in`、`/zh-TW/sign-up`、`/en/no-such-page` 的 script 全帶 nonce，`X-Request-ID` 是 Caddy 的 UUIDv4，`test/stack/flow.test.ts` 註冊→登入→dashboard 含 username→登出→導回登入通過，flow 的 3 個安全事件都帶 Caddy 的 request id）；本機 `next start`：未知路徑原為內建 `_not-found`（13 個 script 0 個帶 nonce），catch-all 後 18/18；可信 peer 的 `X-Request-ID` 回送、不可信或格式錯換成 UUIDv7；錯誤碼缺翻譯時 `tsc` 失敗（next-intl `AppConfig`）；mutation：本機 trust 檢查拿掉→proxy unit 測試 3 個失敗、少一個翻譯→`tsc`＋messages 測試失敗、`TRUSTED_PROXIES` 只在帶 id 時才讀→設錯時健康檢查照常；CI draft PR #8（run 41652306231）dashboard 不顯示 username、request id 格式不檢查、action 不設 request id、拿掉 catch-all、throttle 滿了不記 log 各讓目標 integration 測試失敗（9 failed／56 passed），stack 在 404 nonce 步驟失敗；時區 mutation 沒被抓到（CI 機器是 UTC，use-intl production 不警告），測試改在 `TZ=Pacific/Auckland` 的 server 上跑；PR #9（run 41656271624）時區與 `TRUSTED_PROXIES` 設錯兩個目標測試失敗（2 failed／66 passed），stack 在 request id 步驟得到 `client-sent`；auth-parity 步驟 2 的 61 列 `check-parity.py` 通過（沿用 53、偏離 4、不適用 4；腳本本身的 mutation：測試名改錯、沿用列無測試名、偏離條號 14 各讓它失敗），`TestRequestID*` 三列步驟 1 未做、2c 完成；步驟 2 驗收列的 8 個 mutation 已在 2a、2b 做過；審查：`/code-review high` 10 條＋diff 視角 4 條（1 blocking：`_global-error` 沒有處置紀錄，已記入上方 2c 段）→修 9、記錄 2、駁回 2（兩條合併）；第 2 輪 `/code-review medium` 8 條，其中 3 條回到同一處，依兩輪上限停修、交 Will | 第 2 輪 8 條未修，待 Will 決定：session 列的按鈕「Sign out this device」也出現在別的裝置列、欄位錯誤沒有 `role="alert"`、`session_invalid` 時 action 不清 cookie、`TRUSTED_PROXIES` 改在啟動時（`instrumentation.ts`）驗證、設錯測試只靠 log 文字辨認原因、`startNext` 等不到 ready 時 60 秒後才以逾時失敗、`create()` 裡丟棄結果的 `trustedProxies()` 呼叫沒註明、`inAny` 命名；記錄不修：被 Next 轉送的 action 拿到新的 request id（只有不是 app 表單的請求會被轉送，`server.ts` 註解）；request id 放在 auth feature，proxy 因此載入 pg 與 argon2 模組（搬到 `src/server` 會牴觸 D8；觸發：第二個 feature 要在日誌帶 request id，或 proxy 的載入成本量得到）；遠端分支 `ci-mutation/2c-screens`、`ci-mutation/2c-round2` 未刪（刪遠端分支要 Will 同意）；requirements 的 U1、U6 仍是「未開始」，但步驟 1 已完成 | dev `f1ab0e8`…`9df8ced` |
| 3 items | 未開始 | | | |
| 4 帳號濫用與管理 | 延後（D4） | | | |
| 5 rename | 未開始 | | | |
| 6 收尾 | 未開始 | | | |
