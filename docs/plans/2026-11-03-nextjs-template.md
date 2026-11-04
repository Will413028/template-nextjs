# template-nextjs：只用 Next.js 的全端範本

**Goal：** 一個沒有獨立後端的 Next.js 全端 monorepo 範本：`make dev` 起整個 stack，`make new NAME=x DEST=<目錄>` 產生衍生專案（D10），CI 綠燈，D4 決定範圍內的需求清單每一項都有測試。驗收見步驟 6。

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
| 佔位名稱 `template-nextjs`／`template_nextjs`／`Will413028/template-nextjs` 在產出的衍生專案裡一個都不剩；範本專用的檔不進產出（D10，2026-11-04 改寫；原為「只出現在 rename 腳本認得的檔案」） | `template/new_project.py` 的 `TOKENS` 替換表、`EXCLUDED`、`FORBIDDEN` 與 template-only 標記區塊；`template/test_new_project.py`；`ci.yml` 的 `generate` job（標記區塊內，`gate (ci)` 的 needs 含它） |

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
- [x] **3. items 垂直切片**（被擋於：D4、步驟 2）
  - 範圍：需求清單 U4、E3、F3。2026-11-03 開工時拆成 3a、3b（照步驟 2 的切法，一個 session 可能做不完），依序做，各自 commit 並以 CI 驗收；下面的「驗收」是兩個子步驟合起來的驗收，3b 完成時逐項核對。
  - 規格：template-go-nextjs `560106d` 的 items 模組與 `items_test.go`、`authz_test.go`、`httpx/cursor_test.go`，逐案對照在 [`2026-11-03-nextjs-template/items-parity.md`](2026-11-03-nextjs-template/items-parity.md)（`check-parity.py items-parity.md --steps …` 核對）。讀取在 server component 經 `features/items/server.ts`，寫入是 `actions.ts` 的 `authedAction`（D3）。分頁（auth-parity ADR 歸屬表 API D2 留給本步的「集合的分頁形狀」）照 Go：依 UUIDv7 id 由新到舊的 keyset，cursor 是一頁最後一筆 id 的 16 bytes 以 base64url 編碼、對使用者不透明，頁面用 `?cursor=`，一頁 20 筆。
  - 不能動：步驟 2 的 session 與 action 邊界（不變量第 2、3 列）；公開的 action 仍只有註冊與登入。
  - [x] **3a. 資料層**（被擋於：步驟 2）
    - 範圍：E3 的 `src/features/items/schema.ts` 與 migration `0002_items`；`input.ts`（zod：標題 1–200 code points、description 可為 null、partial update 照 Go 的 merge patch、limit 1–100 預設 20、表單的空白 description 視為 null）；`server/cursor.ts`；`server/queries.ts` 的 `itemQueries(db)`（create、get、list、update、delete，第一個參數都是 `Viewer`，每個查詢帶 `owner_id` 條件）；service 層 integration 測試。不含 action、`server.ts` 與畫面。
    - 消費端：無（新模組）；3b 的 `server.ts`、`actions.ts`、頁面。`rg -n 'features/items' src test`。
    - 驗收：`check-parity.py items-parity.md --steps 3a` 通過；unit 本機綠、integration CI 綠；`pnpm check` 本機綠；mutation（CI draft PR）：get、update、delete 各自拿掉 `owner_id` 條件、list 拿掉擁有者篩選、update 不設 `updated_at`、cursor 比較改成 `<=`，各讓目標 integration 測試失敗；本機：標題改算 UTF-16 長度、cursor 拿掉正規形式檢查，各讓一個 unit 測試失敗。
  - [x] **3b. Server Action 與畫面**（被擋於：3a）
    - 範圍：`server.ts`（頁面用的 `listItems`、`getItem`）、`actions.ts`（`createItem`、`updateItem`、`deleteItem`，都是 `authedAction`）；U4 的 `/[locale]/items`（列表、新增、下一頁）與 `/[locale]/items/[id]`（編輯、刪除；別人的、不存在的、格式錯誤的 id 都 404），導覽列加 Items；`messages/*.json` 的 `items` namespace（錯誤碼與欄位碼的翻譯，缺翻譯 `tsc` 失敗）；integration：跨站 POST 不執行、跨使用者的頁面 404、流程（建立 → 列表 → 編輯 → 刪除）；requirements 的 U4、E3、F3 改「完成」。
    - 驗收：`check-parity.py items-parity.md --steps 3a 3b` 通過；mutation：`updateItem` 改成 `publicAction` 讓 unit 測試失敗；編輯頁找不到時不回 404、表單空白 description 不轉 null，各讓目標 integration 測試失敗（CI draft PR）。
  - 驗收：對照 Go 版 `items_test.go`、`authz_test.go` 的案例（`items-parity.md` 標 3a、3b 的列全部通過）；mutation：拿掉擁有者檢查，跨使用者讀取的測試要失敗（3a）。
- [ ] **4. 帳號濫用與管理**（D4 選精簡版，2026-11-03：本步不做，E4、F4、F5、F7 寫進範圍的「延後」；以下保留給觸發時使用）
  - 範圍：需求清單 E4、F4、F5、F7（D4 選全功能時才做；選精簡版時整步寫進延後）。
  - 驗收：`auth-parity.md` 中屬於步驟 4 的列都有測試或偏離條目，加上 Go 版 `backend/internal/modules/auth/service_test.go` 的鎖定與 devices 案例；mutation：把鎖定門檻加大，鎖定測試要失敗。
- [x] **5. rename 腳本與 smoke test**（被擋於：步驟 1）
  - 2026-11-04 被 D10 取代：原地改名的做法改成「產生到新目錄」，由步驟 5b 接手；本步保留為紀錄，第 2 輪審查 8 條隨 D10 作廢（都是原地改名的缺陷，5b 從結構上消除）。
  - 範圍：F6；改名後 `rg` 確認每一條守門 grep 的目標字串仍指向真實存在的值（template-go-nextjs lessons 2026-11-03）。
  - 範圍補充：沿用 Go 版 `scripts/rename.py` 改寫，不另寫 TS 版。
  - 驗收：CI 跑 `make rename NAME=ci-probe` 後 `rg -n -i 'template[-_]nextjs' --hidden -g '!.git' -g '!docs/plans/**'` 沒有結果、`pnpm check` 通過；mutation：刪掉一個替換規則，smoke job 要失敗。
- [x] **5b. 從範本產生衍生專案到新目錄**（被擋於：D10；步驟 5）
  - 實作時定（2026-11-04）：範本專用的 CI 不另開 `template.yml`，改成 `ci.yml` 裡 `>>> template-only`／`<<< template-only` 標記區塊內的 `generate` job，`gate (ci)` 的 `needs` 也用標記列出它——範本 repo 的 required check 只有 `gate (ci)`，這樣不必改 branch protection 就涵蓋產生測試。同一套標記用在其他共用檔裡只屬於範本的幾行（Makefile 的 `new`、lefthook 的產生器測試、AGENTS.md 的範本說明、`.gitignore` 與兩處 docs/plans 註解），產出時整段移除（基線：`dotnet new` 的條件區塊）；整檔不同的 README 才用 `template/derived/`。產出的 repo 有 `main` 與 `dev`、checkout 在 `dev`（審查第 1 輪）。
  - 範圍：F6 改成 `make new NAME=x DEST=<目錄> [REPO=owner/name]`，取代 `make rename` 與原地改名的 `scripts/rename.py`（同一波刪除舊的，不留 shim：範本沒有外部消費端）。產生器（Python，`scripts/` 之外的範本專用位置，例如 `template/`）：
    1. 輸入檢查：`NAME`、`REPO` 格式；`DEST` 不存在或是空目錄；範本必須是乾淨的 git checkout（檔案集合取自 `git ls-files`，不帶工作區未追蹤或修改中的檔；`git` 出錯就失敗，不當成空集合）。
    2. 檔案集合 = 追蹤中的全部檔案 − 排除清單（資料，一處定義）：產生器本身與其測試、範本專用 workflow `template.yml`、`docs/plans/`、範本版 README／AGENTS.md（由衍生版整檔取代，例如 `template/derived/README.md`）。沒有 `FILES` 白名單。
    3. 替換表（資料）：repo（`Will413028/template-nextjs`）、db（`template_nextjs`）、name（`template-nextjs`）三個 token，以 longest-first 的 alternation 單趟 `re.sub`；替換結果不再被掃描，所以 REPO 可以含任何名稱，不設拒收。檔名也套用同一張表。
    4. 先算後寫：全部輸出在記憶體（或暫存目錄）算完並檢查（輸出裡沒有任何舊 token、沒有排除清單內的路徑），通過才寫入 `DEST`；任何一步失敗都不留下半成品。
    5. `DEST` 裡 `git init`（預設分支 `main`），建立第一個 commit，訊息帶 `Large-Change: initial commit generated from template-nextjs@<sha>`；不設 remote（第一次 push 不會推到範本）。
  - 範本專用的 CI 搬到 `.github/workflows/template.yml`（整檔排除）：產生到暫存目錄 → 斷言排除清單的路徑都不在、輸出不含舊 token、`SECURITY.md` 連結到給定的 REPO、輸出沒有任何 `template.yml`／產生器的參照 → 在產出目錄跑 `pnpm install --frozen-lockfile`、`pnpm check`、Python 測試（`python3 -m unittest discover -s scripts`）與 `pnpm test:integration`（改名後的 DB 與角色名稱在執行期驗證）。`ci.yml` 的 rename job 與 `gate.needs` 的 `rename` 移除；template.yml 自己的 gate 或 `ci.yml` gate 的處理在實作時定，但範本 repo 的 required check 仍要涵蓋產生測試。
  - 範本專用引用的盤點（審查者 2026-11-04 列出，開工時重跑並逐項給去向）：`rg -n -i 'make rename|rename\.py|docs/plans' --hidden -g '!.git' -g '!docs/plans/**'`，已知有 README 第 7–22 行、AGENTS.md（第 5、13、29、43、81 行等）、`lefthook.yml`、`knip.config.ts`、`.gitignore`、`security.yml`、`scripts/check_locks.py`、`test/integration/items.test.ts`、`test/integration/pages.test.ts`。每一處：改成不依賴 `docs/plans/`、移到衍生版檔案，或列入排除清單；衍生專案的 `pnpm check`、lefthook、CI 都不能指向不存在的路徑。
  - 消費端：`rg -n -i 'make rename|make new|rename\.py|template\.yml' --hidden -g '!.git' -g '!docs/plans/**'`；Makefile、README、AGENTS.md、`ci.yml`、`template.yml`。
  - 不能動：`ci.yml` 的 app、policy、stack job 在範本 repo 的行為；不變量第 1–5 列。
  - 驗收：template.yml 在 CI 綠（含產出目錄的 `pnpm check`、Python 測試、integration）；本機在 scratchpad 產生一份，`pnpm check` exit 0（integration 只在 CI）；產出 `git log` 只有一個 commit、`git remote` 為空、`check_commit_policy.py --range HEAD` 通過；mutation（red-proof 或 CI draft PR）：替換表刪一個 token、排除清單刪一項、替換改回依序 `str.replace` 且 REPO 含專案名、先寫後檢查（檢查失敗時 `DEST` 留下檔案）、`git ls-files` 出錯被當成空集合，各讓一個測試或 template.yml 的步驟失敗。
  - 完成後的狀態：`make rename` 不存在；README 說明改成 `make new`。
- [x] **5c. 產生器根治重做**（被擋於：D10 修訂；步驟 5b）
  - 範圍：`template/new_project.py` 改成 `git -c tar.umask=user archive HEAD -- . ':!template' ':!docs/plans'` → `tarfile` `filter="data"` 解壓到暫存目錄的子目錄 → 原地剝標記、替換內容 token → 檢查（禁字由 `TOKENS`、`EXCLUDED`、兩個標記推出；路徑含 token 拒絕）→ `git init -b main`、commit → 搬到 DEST（不存在或空目錄，直接 rename 蓋過，不先 rmdir）；`OSError` 轉成錯誤訊息；`MAX_NAME = 63 - len("_owner")`；產出只有 `main`，衍生 README 改成 push `main` 後照 AGENTS.md 設定分支模型。解決 5b 第 2 輪 10 條。
  - 不能動：`ci.yml` 的 app、policy、stack；`generate` job 的斷言（`dev` 分支兩行改回只有 `main`）；不變量第 1–6 列。
  - 驗收：產生器測試本機綠；本機產生一份 `pnpm check` exit 0；CI 綠（generate job 含 integration）；red-proof：拿掉檢查、拿掉暫存清理、git 出錯被吞、不剝標記、不用 derived README、允許髒工作區、遺失執行位元、拿掉路徑 token 檢查、拿掉 `filter="data"`、拿掉 OSError 轉換、名稱上限，各讓一個測試失敗。
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

- **D10 衍生專案怎麼產生**（狀態：已決 2026-11-04，Will 照建議；擋住步驟：5b；來源：步驟 5 審查與 2026-11-04 的設計 brief，基線經獨立審查者查證）
  - 背景：步驟 5 的原地改名（clone 後 `rename.py` 依序 `str.replace` 11 個白名單檔）審查出四個根因：依序替換互相干擾（REPO 被名稱替換再改一次）、範本專用機制（腳本、rename job、README／AGENTS.md 說明、git 歷史與 `origin`）留在衍生專案且守門 regex 在那裡空轉、先改檔後檢查（失敗時樹改一半，`git grep` 出錯被當成無殘留）、手動維護的 `FILES` 白名單。
  - 基線：`dotnet new`（範本原始專案可直接 build／run，`sourceName` 統一替換內容與檔名，設定目錄不進輸出）、create-next-app（複製到新目錄並重新 `git init`）、JetBrains plugin template（範本專用檔整檔刪除或替換）、Copier／Cookiecutter（佔位符範本，範本不能直接跑；Copier 可 `copier update`）。
  - A′：範本保持可直接跑，產生器輸出到新目錄、重新 `git init`；替換表單趟替換；範本專用檔整檔排除；先算後寫；範本 CI 產生專案並對產出跑完整檢查（建議）。
  - B：Copier——衍生專案之後可收範本修正；代價是範本的 `package.json`、compose、`ci.yml` 變成 `.jinja`，範本 repo 不能直接跑，app／stack／integration 都要先渲染。
  - C：GitHub template repo 加首次 push 的清理 workflow——依賴「Use this template」與 bot commit，條件判斷靠 repo 名稱又會被改名改寫。
  - 修訂（2026-11-04，Will 照根治版 brief）：檔名不再套用替換表，路徑含舊 token 就拒絕產生（實測 0 個追蹤中的路徑含 token；檔名替換只帶來碰撞與大小寫不分檔案系統的問題）；檔案以 `git archive` 加 Python `tarfile` 的 `filter="data"` 解壓到 DEST 旁的暫存目錄（基線：create-next-app／degit 的 tarball 加篩選），不再自己逐檔寫入；產出只有 `main` 一個分支，分支模型由 hosting 端設定（本機用 `devflow.py --apply`），產生器不重做。由步驟 5c 接手。
  - 結論：A′（改名後與範本斷開）。推翻條件：要讓衍生專案之後收範本修正時改走 B。Go、FastAPI 兩個 template 有同樣根因，各自的專案頁 Pending 記一條，不在本計畫改。ADR：步驟 6 寫成 repo ADR

拍板順序：D1–D10 與 D2 偏離清單 1–13 皆已決（D10 為 2026-11-04）。

## 進度

狀態值：未開始／進行中／程式完成待驗收／完成。

| 步驟 | 狀態 | 已跑的驗收 | 未跑的驗收與原因 | commit |
|---|---|---|---|---|
| 0 spike | 完成 | 2026-11-03：`spike.md`、`auth-parity.md` 產出；orchestrator 重跑 a 的 vitest（20 過）、b 的 integration（各 2 過）、parity 完整性（87 名稱無缺） | a 的 4 個 Docker stack 測試與 c 未由 orchestrator 重跑（機器 load 高；子代理已實測，原始輸出在 `spike.md`）；amd64 未測 | 未 commit（repo 無首個 commit，併入步驟 1） |
| 1 walking skeleton | 完成 | 2026-11-03：本機 `pnpm check` exit 0（unit 13）；CI run 41581092195 全綠（app 含 integration 8、policy、rename、stack：health 200、en／zh-TW 各 20 個 script 全帶 nonce、uid 1001、app 角色 DDL 被拒；Security 全綠）；mutation：PR #4 health 回 500 → stack job `app is unhealthy` 失敗、integration 測試 `expected 500 to be 200`；PR #5 刪一個 integration 測試 → `tests.integration: 7, locked at 8`；本機 mutation：depcruise 違規、server-only 標頭、noProcessEnv、zizmor unpinned-uses、hadolint、unit 測試數鎖；消費端 `rg` 無結果；獨立 code review 1 blocking＋5 should 已修 | `_global-error` 是靜態頁卻帶 nonce CSP（錯誤頁不 hydrate），記為步驟 2 處理；drizzle-kit 接著 0000 snapshot 產生下一支 migration 由步驟 2 第一個 schema 驗證 | dev `308cf6b` 之後（見 git log） |
| 2a 資料層與服務層 | 完成 | 2026-11-03：本機 `pnpm check` exit 0（unit 52）；CI run 41591430229 全綠（integration 31、Security 綠）；mutation：本機 argon2 記憶體調到 8 MiB、拿掉同時雜湊上限各讓一個 unit 測試失敗；CI draft PR #6（run 41591010631）四個 mutation（明文 token、登入不刪舊 session、FK 不 cascade、撤銷不檢查擁有者）讓 5 個目標 integration 測試失敗、其餘 25 過；auth-parity 2a 列的 35 個 TS 測試名 `rg` 全找得到；`/code-review high` 10 條（6 修、1 記入 2b、1 接受、2 交 Will），diff 視角審查 1 blocking＋2 should 已修、2 nit 不修；drizzle-kit 接著 0000 產生 0001（步驟 1 留下的未驗收項） | 已決：NFKC 後的長度下限（D2 偏離第 12 條）、登入成功只清該來源的計數（D2 偏離第 11 條）；遠端分支 `ci-mutation/2a-service` 已刪 | dev `8ecd95f`…`8602365` |
| 2b Server Action 邊界 | 完成 | 2026-11-03：本機 `pnpm check` exit 0（unit 70）；CI run 41612550969 全綠（integration 53、rename、stack、Security 綠）；本機 smoke（`next start`＋`peer.cjs`，不起資料庫）：manifest 正好是 `actions.ts` 的 6 個 action、4 個 authed action 無 cookie 回 `unauthenticated`、不受信任的 peer 偽造 XFF 第 3 次 `rate_limited` 30 秒、跨站 403、`Sec-Fetch-Site: same-origin`＋外站 Origin 被 Next 擋（500）、未登入 GET `/en/dashboard` 307 到 `/en/sign-in`；action 要 POST 到 bundle 了 `actions.ts` 的頁面（harness 用 `/en/sign-in`），轉送路徑的 peer 變成 127.0.0.1、共用一個限流 key（fail-closed，`runtime.ts` 註明 loopback 不可列入 `TRUSTED_PROXIES`）；mutation：本機 proxy 改比 `X-Forwarded-Host`、`signOut` 改 `publicAction`、`export async function`／`export let` 各讓一個 unit 測試失敗，bad `TRUSTED_PROXIES` 的舊寫法讓 runtime 測試失敗；CI draft PR #7（run 41613397037）cookie 拿掉 `httpOnly`＋`allowedOrigins: ["evil.test"]` → 3 個目標 integration 測試失敗、其餘 50 過；auth-parity 2b 列 TS 測試名 `rg` 全找得到；`/code-review high` 10 條：4 修（設定先解析、撤銷大寫 id 清 cookie、`export let/var`、server 依序啟動）、1 記入程式註解（轉送路徑的 peer）、5 不修（已推送 commit 的鎖順序要 force push；settings 時區交 2c；proxy 熱路徑與兩處重複屬 nit）；D9（2026-11-03 Will 照建議選 D）：`throttle.ts` 上限 10 萬筆，先寫的兩個測試在實作前 `2 failed`；三輪 `/code-review high`／`high`／`medium`：第 1 輪抓到舊掃描寫法 O(n)（review 實測 1,000 個新組合 119 秒）與淘汰等待已過的組合會重置退避，改成兩類分存；第 2 輪抓到 `Map` 取最舊一筆在 V8 不是 O(1)（本機重現 2 萬次淘汰 4.2 秒），改雙向鏈結串列，另補表滿 log、`maxEntries` 檢查、sweep 退避組合的測試；第 3 輪補 log 帶 `uncounted`、時鐘倒退仍報；不修：logger 丟例外（service 所有 log 皆同步，非本次引入）、時鐘倒退時 sweep 提早停（只是晚一次清理，總數仍受上限）；本機 mutation 10 項（淘汰退避組合、淘汰最新而非最舊、重新計數不移到尾端、拿掉上限、sweep 漏退避表、`onFull` 不限頻、`uncounted` 不歸零、時鐘倒退不報、拿掉 `maxEntries` 檢查、舊寫法的淘汰）各讓一個 unit 測試失敗；實測見 D9；本機 `pnpm check` exit 0（unit 77）；CI run 41636680220（`711887f`）、41639454316（`537118f`）、41641261639（`294a8fb`）全綠 | request id（auth-parity `TestRequestID*`、`TestSecurityEventsLogged` 的 `request_id`）未做，移到 2c；`auth.sign_in_throttle_full` 由 service 接上，拿掉這條接線時沒有測試會失敗（`throttle.test.ts` 只測到 `onFull` 本身；在 service 層觸發要先灌滿 10 萬組，未做） | dev `dc20c63`…`294a8fb` |
| 2c 畫面與收尾 | 完成 | 2026-11-03：本機 `pnpm check` exit 0（unit 82）；CI run 41651166758（`39ccd7d`）與 41656113695（`9df8ced`）全綠（integration 68；stack 經 Caddy：`/en`、`/zh-TW`、`/en/sign-in`、`/zh-TW/sign-up`、`/en/no-such-page` 的 script 全帶 nonce，`X-Request-ID` 是 Caddy 的 UUIDv4，`test/stack/flow.test.ts` 註冊→登入→dashboard 含 username→登出→導回登入通過，flow 的 3 個安全事件都帶 Caddy 的 request id）；本機 `next start`：未知路徑原為內建 `_not-found`（13 個 script 0 個帶 nonce），catch-all 後 18/18；可信 peer 的 `X-Request-ID` 回送、不可信或格式錯換成 UUIDv7；錯誤碼缺翻譯時 `tsc` 失敗（next-intl `AppConfig`）；mutation：本機 trust 檢查拿掉→proxy unit 測試 3 個失敗、少一個翻譯→`tsc`＋messages 測試失敗、`TRUSTED_PROXIES` 只在帶 id 時才讀→設錯時健康檢查照常；CI draft PR #8（run 41652306231）dashboard 不顯示 username、request id 格式不檢查、action 不設 request id、拿掉 catch-all、throttle 滿了不記 log 各讓目標 integration 測試失敗（9 failed／56 passed），stack 在 404 nonce 步驟失敗；時區 mutation 沒被抓到（CI 機器是 UTC，use-intl production 不警告），測試改在 `TZ=Pacific/Auckland` 的 server 上跑；PR #9（run 41656271624）時區與 `TRUSTED_PROXIES` 設錯兩個目標測試失敗（2 failed／66 passed），stack 在 request id 步驟得到 `client-sent`；auth-parity 步驟 2 的 61 列 `check-parity.py` 通過（沿用 53、偏離 4、不適用 4；腳本本身的 mutation：測試名改錯、沿用列無測試名、偏離條號 14 各讓它失敗），`TestRequestID*` 三列步驟 1 未做、2c 完成；步驟 2 驗收列的 8 個 mutation 已在 2a、2b 做過；審查：`/code-review high` 10 條＋diff 視角 4 條（1 blocking：`_global-error` 沒有處置紀錄，已記入上方 2c 段）→修 9、記錄 2、駁回 2（兩條合併）；第 2 輪 `/code-review medium` 8 條，其中 3 條回到同一處，依兩輪上限停修、交 Will | 第 2 輪 8 條未修，待 Will 決定：session 列的按鈕「Sign out this device」也出現在別的裝置列、欄位錯誤沒有 `role="alert"`、`session_invalid` 時 action 不清 cookie、`TRUSTED_PROXIES` 改在啟動時（`instrumentation.ts`）驗證、設錯測試只靠 log 文字辨認原因、`startNext` 等不到 ready 時 60 秒後才以逾時失敗、`create()` 裡丟棄結果的 `trustedProxies()` 呼叫沒註明、`inAny` 命名；記錄不修：被 Next 轉送的 action 拿到新的 request id（只有不是 app 表單的請求會被轉送，`server.ts` 註解）；request id 放在 auth feature，proxy 因此載入 pg 與 argon2 模組（搬到 `src/server` 會牴觸 D8；觸發：第二個 feature 要在日誌帶 request id，或 proxy 的載入成本量得到）；遠端分支 `ci-mutation/2c-screens`、`ci-mutation/2c-round2` 未刪（刪遠端分支要 Will 同意）；requirements 的 U1、U6 仍是「未開始」，但步驟 1 已完成 | dev `f1ab0e8`…`9df8ced` |
| 3a 資料層 | 完成 | 2026-11-03：本機 `pnpm check` exit 0（unit 113）；CI run 41667494625（`2c0f27b`）全綠（`items.test.ts` 15 過，integration 83）；先寫的 unit 測試在模組不存在時 2 個檔失敗，實作後 29 過；本機 mutation：標題改算 UTF-16 長度 → 1 failed、cursor 拿掉正規形式檢查 → 3 failed（改工作區再還原；全域規則當天稍後改成只用 `red-proof.py` 在複本裡做）；CI draft PR #10（run 41670658730 第 2 次執行；第 1 次 `pnpm/setup` 下載 ECONNRESET、測試沒跑）：get／update／delete 共用的 `owned()` 拿掉擁有者條件、list 拿掉擁有者篩選、update 不動 `updated_at` → 6 failed／77 passed，5 個目標測試全失敗，另 1 個是分頁測試（list 沒有擁有者篩選時混進別人的項目）；`check-parity.py items-parity.md --steps 3a` 通過（17 列），腳本本身 mutation：測試名打錯、引用不存在的偏離條號各讓它失敗；Go 22 個測試名在表裡各一列（`comm` 無差異） | cursor 比較改成 `<=` 的 mutation 移到 3b 的 CI draft PR（和 list 的 mutation 同跑時會讓同一個分頁測試失敗，分不出是誰）；遠端分支 `ci-mutation/3a-items` 未刪（刪遠端分支要 Will 同意）；items 偏離清單第 1 條待 Will 確認 | dev `e3c319a`…`2c0f27b` |
| 3b Server Action 與畫面 | 完成 | 2026-11-03：本機 `pnpm check` exit 0（unit 117）；本機 `next start` 冒煙（不起資料庫，`DATABASE_URL` 指向連不到的位址）：manifest 有 3 個 items action，都在兩個 items 頁面的 bundle 裡；以 FormData 編碼呼叫、不帶 session 都回 `unauthenticated`；跨站 POST 403；未登入 GET `/en/items` 307 到登入頁；items action POST 到 `/en/sign-in` 會被轉送、回應拿不到結果（`undefined`），這是 CI run 41673946563 失敗的原因，`4373c06` 改成 POST 到 manifest 裡打包它的頁面；`server-only.test.ts` 的正規式從來配不到 `server.ts`（拿掉 items `server.ts` 的 marker 仍 11 過，修正後 1 failed，`37c481c`）；本機 mutation：`updateItem` 改 `publicAction` → server-actions 測試 1 failed（改工作區再還原，在規則改成 `red-proof.py` 之前）；NUL 規則的兩個 mutant 經 `red-proof.py` killed；CI run 41676456578（`d79ab1e`）全綠（unit 117、integration 92：items 16、pages 15、actions 29）；CI draft PR #11（run 41677199874；mutation commit 用 git plumbing 從 `d79ab1e` 建立，工作區沒動，三個 mutant 先經 `red-proof.py` 確認各自過 lint 與 unit；devflow pre-push 不認得 plumbing 建的 commit，確認是本 session 建立後以 `DEVFLOW_ALLOW_FOREIGN=1` 推送，lefthook 對這個 ref 沒有跑本機檢查）：項目頁不回 404、表單的空白 description 不轉 null、cursor 改 `<=`（3a 移來）→ 5 failed／87 passed，目標測試全部失敗；`check-parity.py items-parity.md --steps 3a 3b` 通過（21 列）；審查第 1 輪：`/code-review high` 9 條＋diff 視角 3 條（0 blocking）→ 修 6（被拒的表單保留輸入、拒收 U+0000、新增表單只在第一頁、`too_long` 帶上限、dashboard 介紹、分頁測試的空斷言）、記錄 2、駁回 2、合併 2；第 2 輪：`/code-review medium` 8 條（0 blocking），其中 2 條回到第 1 輪修過的表單保留輸入，依兩輪上限停修、交 Will | 第 2 輪 8 條未修，待 Will 決定（建議在專案 Pending）：`actionPages` 在 action 只出現在動態頁時會在載入時丟錯；`TITLE_MAX` 改成值 import 後 zod 進了 client bundle（實測 `d79ab1e` 的 build：含 zod 的 chunk 108,835 bytes、gzip 31,382，只有兩個 items 頁載入；改之前是否已在 bundle 未量）；`not_found` 時表單仍被重設；被拒時整段 description 回傳一次；孤立的 UTF-16 surrogate 存成 U+FFFD；`{max}` 傳給每個欄位碼；後續頁沒有新增表單、`noOlder` 狀態沒有測試；測試用訊息文字組 RegExp 沒有跳脫。記錄不修：action 不呼叫 `revalidatePath`（畫面由 client 端 refresh／push；觸發：其他地方也呼叫這些 action）；items 與 auth 的 `Field`、`useFailureMessage` 重複（觸發：第三個同樣的表單）。駁回：只有空白的標題可存（Go `560106d` 的 `ItemTitle` minLength 1、不 trim）；刪除不先確認（nit）。遠端分支 `ci-mutation/3a-items`、`ci-mutation/3b-items-pages` 未刪（刪遠端分支要 Will 同意）；items 偏離清單第 1 條待 Will 確認；瀏覽器上「被拒後保留輸入」未實測（本機沒有資料庫、CI 沒有瀏覽器測試），依 HTML 的 dirty flag 規則推論；integration 只證明 action 回傳了送出的值 | dev `37c481c`…`d79ab1e` |
| 4 帳號濫用與管理 | 延後（D4） | | | |
| 5 rename | 完成 | 2026-11-04：改名後的 clone（`make rename NAME=ci-probe`）本機 `pnpm check` exit 0、計畫的 `rg --hidden` 與 CI 的 `git grep` 都無結果；守門字串核對：`template[-_]nextjs` 是 regex、rename 不改寫；stack job 的 `intruder` 改名後是 `ci_probe_app`／`ci_probe`，與 `.env-example`、compose 預設一致，且斷言 `permission denied for schema public`，角色名錯時失敗不空轉；新加的「不得連到預設 repo」grep 首版比對到自己那一行（red-proof baseline 抓到），改寫成 `ci[-]probe`；red-proof（`scripts/red-proof.py`，job 步驟寫成 scratch 腳本）：舊 job 步驟下刪 `OLD_REPO` 規則的 mutant SURVIVED（預設 repo 時結果相同），新步驟（`REPO=ci-owner/ci-probe-repo`＋SECURITY.md 連結＋不得殘留預設 repo）6 個 mutant 全 killed（刪 `OLD_REPO`、`old_db`、`OLD_NAME` 規則、刪 FILES 一項、漏檔且關掉 `leftovers()`、只在 SECURITY.md 換 repo）；`test_rename.py` 先寫、修正前 3 subtest 失敗，拿掉拒收檢查的 mutant killed；CI run 41704016490（`32fe5d5`）全綠（rename job 跑 `pnpm check`）、Security 綠；CI draft PR #12（run 41704398629）刪 `OLD_REPO` 規則 → rename job 在連結檢查失敗、其餘 job 綠，PR 已關；審查：第 1 輪 `/code-review medium` 6 條（修 3：REPO 含專案名被二次改寫、預設 repo 殘留檢查、`leftovers()` 加 `--untracked`；駁回 3：README 措辭 nit、`pnpm check` 重複〔本步驗收明訂〕、DB 名未測〔`10-roles.sh` 識別字有引號〕）；diff 視角 3 條（修 1：不變量表符號名；1 交 Will；CI 證據已補）；第 2 輪 `/code-review medium` 8 條，3 條回到第 1 輪修正的同一處（`rename.py` 拒收含專案名的 REPO），依兩輪上限停修、交 Will | 2026-11-04 D10 後：第 2 輪 8 條與「衍生專案仍跑 rename job」作廢，由 5b 從結構上消除。原紀錄——第 2 輪 8 條未修：`test_rename.py` 寫死 `acme/my-project`，衍生專案改名成 `my-project` 時 pre-push 失敗（第 1 輪修正造成）；建議改成單趟 `re.sub` 取代拒收（也解決：拒收合法 repo、沒給 REPO 時錯誤指向 repo）；rename job 不跑 Python 測試；`leftovers()` 掃未追蹤檔後，使用者自己的筆記會讓改名在改完檔案後 exit 1 並給錯建議；zip 下載（無 `.git`）時 `git grep` 出錯被當成無殘留；衍生專案名不含連字號時重跑 rename 會把所有名稱改成底線形式；README 不再有正向連結檢查。交 Will：衍生專案仍會跑 rename job（守門 regex 在那裡永遠通過，且多一次 `pnpm check`）；遠端分支 `ci-mutation/5-rename-repo-link` 未刪 | dev `c5b5a53`…`32fe5d5` |
| 5b 產生到新目錄 | 完成 | 2026-11-04：產生器測試先寫、模組不存在時 import 失敗；`test_the_real_template_generates_cleanly` 在共用檔未清理前列出 16 處殘留（docs/plans、rename.py 等）失敗；本機 `make new NAME=ci-probe DEST=<scratchpad> REPO=ci-owner/ci-probe-fork`（`e5fb317` 前的 `ac49546`）：1 個 commit、無 remote、`check_commit_policy.py --range HEAD` 過、`git grep` 無舊 token／產生器參照、SECURITY.md 連到給定 REPO；產出目錄 `pnpm install --frozen-lockfile --prefer-offline` 後 `pnpm check` exit 0（unit 117）、Python 測試過；red-proof 17 個 mutant 全 killed（刪 db／repo token、刪 docs/plans 排除、改回依序 `str.replace`、先寫後檢查〔拿掉檢查〕、失敗不清暫存、git 出錯當空集合、不剝標記、不用 derived README、允許髒工作區、遺失執行位元；第 1 輪修正後：路徑碰撞、目錄權限、dev 分支、還原空目錄、`template/` 過寬、名稱長度）；CI run 41713590471（`e5fb317`）與 41714330013（`7a51c7f`）全綠，generate job 在產出專案跑 `pnpm check`、Python 測試、integration 92 與鎖檢查；消費端 `rg -n -i 'make rename\|rename\.py\|template\.yml' --hidden -g '!.git' -g '!docs/plans/**'` 無結果；審查：第 1 輪 `/code-review medium` 10 條 → 修 9、記錄 1（check_locks 不再排除 docs/plans：spike 原始碼凍結且 0 個 suppression，觸發：docs/plans 出現 suppression）；第 2 輪（第一個審查者回傳空結果，換人重跑）10 條，其中 3 條回到第 1 輪修過的同一處，依兩輪上限停修、交 Will | 第 2 輪 10 條未修，待 Will 決定：測試的 `self.umask` 存的是舊 umask（umask 非 022 的機器上測試誤報）；`FORBIDDEN` 縮窄後漏掉對 `template/` 其他檔的引用（同一處回來）；產出沒設 `devflow.protectMain`；先 rmdir 再 rename 的空窗與還原丟失原權限（同一處回來，建議直接 rename 蓋過空目錄）；中間目錄 chmod 迴圈多餘；碰撞檢查不分大小寫檔案系統與檔案／目錄衝突（OSError 未轉成錯誤訊息）；排除路徑下的 symlink 仍會讓產生失敗；README 叫使用者直接 push main（同一處回來）；`branch`＋`switch` 可合一；`MAX_NAME` 50 與註解的 57 不一致。本機只對 `ac49546` 的產出跑過 `pnpm check`，`7a51c7f` 的產出只在 CI 驗證 | dev `e39c848`…`7a51c7f` |
| 5c 產生器根治重做 | 完成 | 2026-11-04：先改測試（只有 `main`、路徑含 token 拒絕、umask、57 字上限）再重寫；產生器測試 25 過；本機 `make new`（`a47b3a4`）：只有 `main`、1 個 commit、無 remote、目錄 750／檔案 640 依 umask、`100755` 的兩個檔保留執行位元、`check_commit_policy.py` 過、無殘留；產出目錄 `pnpm check` exit 0（unit 117）、Python 測試過；red-proof 23 個 mutant：21 killed（含拿掉檢查、暫存清理、git 錯誤被吞、標記、derived、髒工作區、`tar.umask=user`〔測試改用 umask 027 才分得出，因 data filter 本身就拿掉 group/other 寫入位元〕、路徑 token、OSError、名稱上限、db token、排除、依序替換、排除路徑引用、`./`／`../` 引用、內部 symlink、derived 權限、make target、export 屬性、Python 版本），`no-data-filter` 存活記錄接受（git tree 沒有絕對或 `../` 路徑、symlink 之後另擋，filter 是 Python 建議的縱深防禦）；CI run 41719565580（`6d8be76`）與 41722454580（`affa7ff`）全綠（generate job 含 integration 92）；審查：第 1 輪 `/code-review medium` 10 條 → 修 9、記錄 1（散文裡的 `template/` 會誤擋：誤擋大聲失敗，比無聲漏掉好）；第 2 輪 9 條，4 條回到第 1 輪修過的同一處，依兩輪上限停修、交 Will | 第 2 輪 9 條依 Will 指示（2026-11-04）全修（`2643145`）：export 屬性改用 `git check-attr --source` 核對（涵蓋 `.git/info/attributes` 與 `core.attributesFile`、略過註解與 unset）；`./`／`../` 引用從所在檔目錄解析、只比對從路徑起點開始的 `template/`／`docs/plans`；只擋 `make new NAME=` 與 `new_project.py`；`from __future__ import annotations` 讓版本檢查在舊 Python 跑得到、訊息列出所有有 filter 的版本；一次 export 後搬移 derived；輸出樹走一次；拒絕測試比對錯誤訊息；subTest 各用子目錄。第 3 輪（只審這次修正，Will 指定）2 條：路徑中段的 `template/` 仍被當成根目錄路徑（實測）、`template/` 非 derived 檔的屬性仍被檢查 → 都修（`d443f7b`）。產生器測試 29 過；red-proof 15 個 mutant 14 killed（含先前存活的 `no-data-filter`：指向外部的 symlink 由 data filter 擋），`--source` 拿掉存活：產生器要求工作區乾淨，工作區與 tree 的屬性相同，屬等價 mutant；CI 41762599569（`2643145`）全綠。無未決 | dev `a47b3a4`…`affa7ff` |
| 6 收尾 | 未開始 | | | |
