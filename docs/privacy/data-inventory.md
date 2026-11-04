# 個人資料清單

列出本專案在資料庫、瀏覽器、日誌與第三方保存的個人資料：存在哪裡、做什麼用、保留多久、誰讀得到，以及使用者目前能行使哪些權利。衍生專案新增欄位、資料表或外部處理者時，在同一個變更裡更新本文件與[威脅建模](../security/threat-model.md)。「推論」表示依據的是函式庫或工具的預設行為，不是本 repo 的程式碼。

## 誰能讀資料庫

角色由 `deploy/postgres/initdb/10-roles.sh` 建立，權限由 `scripts/migrate.mts` 授予：

| 角色 | 用途 | 權限 |
|---|---|---|
| `POSTGRES_USER`（superuser） | 初始化 volume 與在容器內維護 | 全部 |
| `DB_OWNER_USER`（`<name>_owner`） | migrate 服務套用 migration | 擁有資料庫與 `public` schema；不是 superuser，不能建角色 |
| `DB_APP_USER`（`<name>_app`） | Next.js app 連線 | `public` 的表 SELECT、INSERT、UPDATE、DELETE；不能改 schema，讀不到 migration 紀錄（`test/integration/database.test.ts`「refuses schema changes from the app role」、「hides the migration ledger from the app role」） |

三個角色的密碼都是 `.secrets/` 下的檔案，以 compose secret 掛載（`docker-compose.yml`）。PostgreSQL 只在 compose 網路內，不發佈 port。

## 資料庫裡的資料

| 資料 | 位置 | 用途 | 保留與刪除 | 誰能讀 |
|---|---|---|---|---|
| 使用者名稱 | `users.username`（小寫） | 登入、顯示 | 直到帳號刪除 | app 角色；本人在頁面上 |
| 密碼雜湊 | `users.password_hash`（argon2id） | 驗證密碼 | 直到帳號刪除；不能還原成密碼 | app 角色；不顯示給任何人 |
| 帳號時間 | `users.created_at`、`updated_at` | 紀錄 | 直到帳號刪除 | app 角色 |
| Session | `sessions`：`token_hash`（SHA-256）、`id`、`user_id`、`created_at`、`last_used_at`、`expires_at` | 認證、裝置清單 | 閒置 1 天或 7 天後失效，每小時清理刪除（`src/features/auth/server/service.ts` `cleanup`；計時器在程序第一次用到認證時才啟動，見[認證 ADR](../adr/2026-11-03-auth-and-sign-in-throttling.md)）；登出、撤銷、刪帳號時刪除 | app 角色；本人在設定頁看到自己的 session 時間 |
| Items | `items`：`title`、`description`、`owner_id`、時間 | 使用者的內容 | 直到本人刪除，或隨帳號刪除（`ON DELETE CASCADE`） | app 角色；只有擁有者在頁面上（`src/features/items/server/queries.ts`） |

Session 不記 IP 位址或 User-Agent。資料庫備份：本 repo 沒有備份設定，`postgres-data` volume 以 `make down-v` 刪除。

## 程序記憶體

| 資料 | 位置 | 保留 |
|---|---|---|
| 來源（IPv4 位址或 IPv6 /64）的限流桶 | `IPLimiter`（`src/features/auth/server/throttle.ts`） | 閒置一分鐘後丟棄 |
| 「來源＋使用者名稱」的失敗計數 | `SignInThrottle`（同檔） | 一天未動後由每小時清理移除；登入成功清除該來源；程序重啟全部遺失。提交的名稱即使不存在也會被計數 |

## 瀏覽器端

| Cookie | 內容 | 屬性 | 保留 |
|---|---|---|---|
| `__Host-session` | 32 byte 隨機 token（base64url） | `Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/`（`src/features/auth/server/runtime.ts`） | 7 天，或登出、撤銷、刪帳號時清除；失效時由 `/api/session/expired` 清除 |
| next-intl 的語系 cookie | 使用者選的語系 | 推論：next-intl middleware 預設會設定 | 推論：依 next-intl 預設 |

本 repo 的程式碼不使用 `localStorage` 或 `sessionStorage`，沒有分析或追蹤腳本；CSP 只允許同源連線（`src/proxy.ts`）。

## 日誌

| 來源 | 內容 | 保留 |
|---|---|---|
| Caddy 存取日誌 | `deploy/Caddyfile` 的 `log`：推論依 Caddy 預設記錄 client IP、方法、路徑、User-Agent、狀態碼、回應標頭（含 `X-Request-ID`）；推論 Caddy 預設會遮蔽 `Cookie`、`Authorization` 標頭 | 輸出到容器 stdout，Docker json-file 每個容器最多 5 個 10 MB 檔，舊的丟棄（`docker-compose.yml`） |
| App 安全日誌 | `src/server/log.ts`：時間、事件名稱、`request_id`、`user_id`，撤銷時加 `session_id`；不記密碼、token 與對不上帳號的使用者名稱（`test/integration/auth.test.ts`「logs sign-up, sign-in, failures and sign-out with user ids, never the password, token or unknown username」） | 同上的輪替 |
| App 未捕捉錯誤 | `src/instrumentation.ts`：`request_id`、方法、路徑、route、digest，不含錯誤訊息；Next.js 另把 stack 印到 stderr（推論：Next.js 預設），stack 可能含資料 | 同上的輪替 |
| PostgreSQL | 推論：官方 image 預設只記錯誤與連線問題，失敗的 SQL 可能帶參數值 | 同上的輪替 |

刪除帳號後，日誌裡的 `user_id` 會留到輪替丟棄為止。

## 第三方

目前沒有：程式碼不呼叫任何外部服務。Caddy 在 `SITE_ADDRESS` 是網域時向憑證機構申請 TLS 憑證（推論：Caddy 預設 Let's Encrypt 或 ZeroSSL），只送網域名稱，不送使用者資料。

## 資料主體請求

| 請求 | 目前支援 |
|---|---|
| 查閱 | 本人可在頁面看到使用者名稱、自己的 items 與 session 清單；沒有匯出功能 |
| 更正 | items 可修改；使用者名稱與密碼不能修改（沒有對應的 action） |
| 刪除 | `deleteAccount`（`src/features/auth/actions.ts`）：需 10 分鐘內登入的 session，刪除 `users` 列，`sessions` 與 `items` 隨外鍵 cascade 刪除（`test/integration/auth.test.ts`「deletes the user and its sessions within ten minutes of signing in, and asks to sign in again after」；`test/integration/items.test.ts`「goes with the account that owns it」）。日誌與資料庫備份不在此範圍 |
| 撤銷裝置 | 設定頁列出 session，可撤銷單一或全部（`revokeSession`、`signOutEverywhere`） |
| 可攜 | 不支援 |
