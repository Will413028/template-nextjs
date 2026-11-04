# 威脅建模：認證、session 與 items

用 STRIDE 逐項檢查註冊、登入、session、登出與裝置撤銷、items 在目前程式碼裡的做法：每個緩解寫出程式碼位置，有測試時寫出測試檔與測試標題；找不到緩解的列為缺口，並寫出何時必須處理（只引用 ADR 已列的觸發條件）。衍生專案新增欄位、資料表或外部處理者時，在同一個變更裡更新本文件與[個人資料清單](../privacy/data-inventory.md)。設計決定見 [認證與登入節流 ADR](../adr/2026-11-03-auth-and-sign-in-throttling.md) 與 [全端基準 ADR](../adr/2026-11-03-nextjs-fullstack-baseline.md)。

路徑相對於 repo 根目錄；`auth/` 指 `src/features/auth/`，`items/` 指 `src/features/items/`。「推論」表示依據的是函式庫或工具的預設行為，不是本 repo 的程式碼。

## 範圍

**資產**

| 資產 | 存放位置 |
|---|---|
| 帳號 | `users.username`（小寫、唯一、3–50 字元，`auth/schema.ts`、`migrations/0001_auth.sql`） |
| 密碼雜湊 | `users.password_hash`，argon2id（19 MiB、2 次、1 執行緒，`auth/server/password.ts`） |
| Session token | cookie `__Host-session` 裡 32 個隨機 byte；資料庫只存 SHA-256（`sessions.token_hash`，`auth/server/service.ts`） |
| 節流狀態 | 程序記憶體：`IPLimiter`、`SignInThrottle`（`auth/server/throttle.ts`） |
| Items | `items` 表，`owner_id` 指向 `users`（`items/schema.ts`） |

**信任邊界**

1. 瀏覽器 → Caddy：唯一發佈 port 的服務（`docker-compose.yml`）。`SITE_ADDRESS` 是網域時 Caddy 自動 HTTPS（推論：Caddy 預設），並加 HSTS（`deploy/Caddyfile`）。Caddy 一律以自己產生的 UUID 覆寫 `X-Request-ID`。
2. Caddy → Next.js：compose 網路。Caddy 固定在 `172.29.0.2`，`TRUSTED_PROXIES` 預設只信任它；只有來自信任 proxy 的 `X-Forwarded-For` 與 `X-Request-ID` 會被採信（`src/server/request.ts`、`src/server/client-ip.ts`）。真實 TCP 來源由 preload `peer.cjs` 寫入 `x-peer-address`，覆寫 client 送的值。
3. Next.js → PostgreSQL：以 `DB_APP_USER`（`<name>_app`）連線，只有 DML；密碼從 compose secret 檔讀（`src/server/env.ts`、`src/server/db.ts`）。DDL 只由 migrate 服務以 `DB_OWNER_USER`（`<name>_owner`）執行（`scripts/migrate.mts`、`deploy/postgres/initdb/10-roles.sh`）。

**入口**：Server Actions（`auth/actions.ts`：`signUp`、`signIn` 匿名；`signOut`、`signOutEverywhere`、`revokeSession`、`deleteAccount` 需登入；`items/actions.ts` 全需登入）、Route Handler `/api/health` 與 `/api/session/expired`、頁面。每個 action 必須由 `authedAction` 或 `publicAction`（`auth/server.ts`）包住，只有註冊與登入是 public：`src/__tests__/server-actions.test.ts`「are each made by authedAction or publicAction, and only sign-up and sign-in are public」；`test/integration/actions.test.ts`「refuses a request without a session, except sign-up and sign-in」。

不在範圍內：主機與 Docker 強化、Caddy 的 TLS 細節。

## Spoofing（冒充）

| 威脅 | 緩解 | 狀態 |
|---|---|---|
| 對單一帳號線上猜密碼 | 每個「帳號＋來源」（IPv4 位址；IPv6 取 /64）在比對密碼前計數，第 5 次失敗起等待 2^(n-5) 分鐘、上限 1 小時；成功只清該來源（`auth/server/throttle.ts` `SignInThrottle`）。測試：`throttle.test.ts`「waits 2^(n-5) minutes after the n-th failure, at most an hour, and does not count a refused attempt」、「counts each source on its own and clears only the source that signed in」；`test/integration/auth.test.ts`「throttles a username from one source after five failures, not the owner elsewhere」、「checks five passwords out of twenty concurrent attempts and throttles the rest」；`actions.test.ts`「answers the sixth failure from one client with the minutes to wait」 | 已緩解（單一程序） |
| 大量來源分散猜同一帳號 | 每個來源每分鐘 `AUTH_RATE_LIMIT_PER_MIN`（預設 5）次註冊／登入（`IPLimiter`、`auth/server.ts` `publicAction`）。測試：`actions.test.ts`「allows two sign-ups and two sign-ins a minute per client, then asks to retry in 30 seconds」、「limits only sign-up and sign-in」 | 缺口：沒有帳號層級上限或鎖定。觸發：要帳號層級上限、鎖定或 trusted device，或日誌出現 `auth.sign_in_throttle_full`（認證 ADR Revocation Triggers） |
| 節流表灌滿後繞過退避 | 上限 10 萬組，淘汰失敗少於 5 次的最舊組合；全在退避中時新組合放行不計並記 `auth.sign_in_throttle_full`（`throttle.ts` `MAX_ENTRIES`）。測試：`throttle.test.ts`「keeps at most maxEntries counts, …」、「never evicts a pair with 5 or more failures, …」；`auth.test.ts`「logs a sign-in it could not count because every count is in its backoff」 | 已接受（認證 ADR D3） |
| 偽造 `X-Forwarded-For` 或 `x-peer-address` 換來源 | 只信任 `TRUSTED_PROXIES` 的 peer；preload 覆寫 `x-peer-address`；格式錯誤的 `TRUSTED_PROXIES` 讓每個回應失敗。測試：`actions.test.ts`「ignores X-Forwarded-For from a peer it does not trust」、「ignores an x-peer-address the client sends: the preload writes the real one」、「gives each client behind the trusted proxy its own bucket」；`pages.test.ts`「fails every response, the health check's included, so the deployment never turns healthy」；`src/server/__tests__/client-ip.test.ts` | 已緩解 |
| 帳號列舉 | 不存在的帳號也驗一次假雜湊，回應同為 `invalid_credentials`（`service.ts` `dummy`）。測試：`auth.test.ts`「checks one hash for an unknown username and answers the same as for a wrong password」 | 部分：註冊回 `username_taken` 會透露帳號存在（與 Go 版規格一致的設計） |
| 弱密碼 | 至少 15 字元（NFKC 後）、最多 128、拒絕常見密碼清單（`auth/credentials.ts`、`password.ts`）。測試：`credentials.test.ts`「rejects a 14-character password」；`auth.test.ts`「rejects a password on the common-password list and a too-short one」 | 已緩解 |
| Session 固定（fixation） | 登入時刪除請求帶來的舊 session 並發新 token（`service.ts` `signIn`）。測試：`auth.test.ts`「issues a new token on every sign-in and ends the session the request carried」 | 已緩解 |
| 竊取 cookie | `__Host-`、`Secure`、`HttpOnly`、`SameSite=Lax`、7 天（`auth/server/runtime.ts`）；cookie 是唯一憑證。測試：`actions.test.ts`「is __Host-, Secure, HttpOnly, SameSite=Lax, for seven days, and holds a 43-character token」、「is the only credential: a Bearer token is ignored」 | 已緩解 |
| 被盜 session 長期有效 | 閒置 1 天、絕對 7 天過期；讀取時檢查期限。測試：`auth.test.ts`「ends a session idle for a day and one older than seven days」 | 已緩解 |

## Tampering（竄改）

| 威脅 | 緩解 | 狀態 |
|---|---|---|
| CSRF：跨站觸發 action | `src/proxy.ts` `crossOrigin` 依 `Sec-Fetch-Site`，否則比對 `Origin` 與 `Host`，跨來源 POST 回 403，涵蓋所有路徑；Next 內建 Origin 檢查為第二層（推論：Next.js 預設）。測試：`src/__tests__/csrf.test.ts`「checks every path an action can be posted to, not only pages」、「lets safe methods through from anywhere」；`actions.test.ts` 的「cross-origin protection」案例；`pages.test.ts`「does not create an item from a cross-site request」 | 已緩解 |
| 改別人的 item | 每個查詢以 `owner_id = viewer.userId` 限定，`Viewer` 只能由 `authenticate()` 產生（`items/server/queries.ts`、`auth/server/service.ts`）。測試：`items.test.ts`「does not change another user's item」、「does not delete another user's item」；`pages.test.ts`「show a user none of another user's items: not listed, its page not found, and the forms change nothing」 | 已緩解 |
| 撤銷別人的 session | `revokeSession` 以 `user_id` 限定，別人的 id 回 `not_found`。測試：`auth.test.ts`「revokes the viewer's own session but not another user's」 | 已緩解 |
| 竄改分頁 cursor | cursor 解碼失敗回 `invalid_input`（`items/server/cursor.ts`）。測試：`properties.test.ts`「refuses a cursor with any one character changed」 | 已緩解 |
| 不合法輸入進資料庫 | zod 驗證加資料庫 CHECK（`items_title_check`、`users_username_check`）。測試：`items.test.ts`「takes titles of 1 to 200 code points, and the database refuses any other」、「is refused as invalid in a title or a description, not passed to the database」；`auth.test.ts`「rejects an uppercase or too-short username and a token hash that is not 32 bytes」 | 已緩解 |
| XSS 注入腳本 | 每個請求新 nonce 的 CSP（`script-src 'nonce-…' 'strict-dynamic'`、`frame-ancestors 'none'`，`src/proxy.ts`）；`next.config.ts` 加 `nosniff`、`X-Frame-Options: DENY`。測試：`proxy.test.ts`「allows only scripts with a fresh nonce, which it passes on to rendering」、「allows connecting, framing and form posts only to its own origin」 | 已緩解；`style-src` 允許 `'unsafe-inline'` |

## Repudiation（否認）

| 威脅 | 緩解 | 狀態 |
|---|---|---|
| 無法追查誰做了什麼 | 安全事件一行 JSON（`auth.sign_up`、`auth.sign_in`、`auth.sign_in_failed`、`auth.sign_out`、`auth.sign_out_all`、`auth.session_revoked`、`auth.account_deleted` 等）帶 `request_id` 與 `user_id`（`src/server/log.ts`、`service.ts`）；同一 id 在 Caddy 存取日誌。測試：`actions.test.ts`「tags each event with its request's id and never holds a password, a token or an unknown username」；`actions.test.ts`「is the one a trusted proxy sent」 | 已緩解 |
| Items 的變更沒有紀錄 | 無 | 缺口：items 的新增、修改、刪除不寫安全日誌；觸發條件見[全端基準 ADR](../adr/2026-11-03-nextjs-fullstack-baseline.md) Revocation Triggers |

## Information disclosure（資訊洩漏）

| 威脅 | 緩解 | 狀態 |
|---|---|---|
| 資料庫外洩後還原 token 或密碼 | 只存 token 的 SHA-256 與 argon2id 雜湊。測試：`auth.test.ts`「creates a lowercase user, signs it in and stores only the token's SHA-256」；`password.test.ts`「hashes with OWASP's argon2id parameters …」 | 已緩解 |
| 讀到別人的 item | 同上的擁有者範圍，非 UUID 的 id 當不存在。測試：`items.test.ts`「does not find another user's item」、「shows only the viewer's, newest first, …」 | 已緩解 |
| 日誌洩漏密碼或錯誤內容 | 安全日誌不記密碼、token、對不上的帳號；`onRequestError` 不記錯誤訊息（`src/instrumentation.ts`）。測試：`instrumentation.test.ts`「logs one JSON line with the request id and no error message」；`auth.test.ts`「logs sign-up, sign-in, failures and sign-out with user ids, never the password, token or unknown username」 | 已緩解 |
| 健康檢查洩漏細節 | 資料庫掛掉時回 503 不帶細節。測試：`health.test.ts`「answers 503 without details once the database is gone」 | 已緩解 |
| 明文傳輸 | `SITE_ADDRESS` 是網域時 HTTPS 加 HSTS；預設 `:80` 只適合本機 | 部署設定 |

## Denial of service（阻斷服務）

| 威脅 | 緩解 | 狀態 |
|---|---|---|
| 大量登入耗盡 CPU 或記憶體 | argon2 同時最多 3 個（`password.ts` `createHasher`）；per-IP 限流。測試：`password.test.ts`「runs at most maxConcurrent hashes at once」 | 已緩解 |
| 節流表撐爆記憶體 | 10 萬組上限、每小時清理一天未動的計數（`runtime.ts`）。測試：`auth.test.ts`「cleans up expired sessions and day-old sign-in counts」；`throttle.test.ts`「forgets counts untouched for a day」 | 已緩解；清理計時器在第一次用到認證時才啟動（認證 ADR 觸發：要讓沒有流量的程序也清理時改在 `register` 啟動） |
| 把本人鎖在門外 | 退避以「帳號＋來源」計，不鎖帳號 | 已緩解（同上 `auth.test.ts` 測試） |
| 大型請求主體或大量 items | 查詢有 `statement_timeout`（`DB_STATEMENT_TIMEOUT_MS`，預設 5 秒）；`next.config.ts` 未設 `serverActions.bodySizeLimit`，靠 Next 預設 1 MB（推論）；description 無長度上限、每人 item 數量無上限、items action 不限流 | 缺口；觸發條件見[全端基準 ADR](../adr/2026-11-03-nextjs-fullstack-baseline.md) Revocation Triggers |
| 多實例讓記憶體節流失效 | 只支援單一 Next 程序 | 觸發：需要第二個實例或改上 Vercel → 節流移到資料庫（認證 ADR、全端基準 ADR） |

## Elevation of privilege（權限提升）

| 威脅 | 緩解 | 狀態 |
|---|---|---|
| 未登入呼叫需登入的 action | `authedAction` 先驗 session 再解析參數。測試：`actions.test.ts`「is checked before the arguments are」、「refuses a request without a session, except sign-up and sign-in」 | 已緩解 |
| 用別人的 id 造 `Viewer` | `Viewer` 是 branded type，只由 `authenticate()` 產生（`service.ts`） | 已緩解（型別層） |
| 伺服器模組被打包進瀏覽器 | 每個伺服器模組 `import "server-only"`；依賴方向由 dependency-cruiser 檢查。測試：`server-only.test.ts`「include the kernel, a feature's server.ts and its server/ modules」；`architecture.test.ts` | 已緩解 |
| app 被入侵後改 schema 或讀 migration 紀錄 | app 角色只有 DML，看不到 `drizzle` schema。測試：`database.test.ts`「refuses schema changes from the app role」、「hides the migration ledger from the app role」 | 已緩解 |
| 刪帳號被盜用的舊 session 執行 | 刪帳號需 10 分鐘內發出的 session（`service.ts` `REAUTHENTICATE_WITHIN`）。測試：`auth.test.ts`「deletes the user and its sessions within ten minutes of signing in, and asks to sign in again after」 | 已緩解 |
| 管理者角色 | 沒有 admin 與角色 | 觸發：衍生專案要 admin → 照帳號濫用 ADR 補做（全端基準 ADR D3） |
