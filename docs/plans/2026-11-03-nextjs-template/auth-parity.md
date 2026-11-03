# auth-parity：Go 版 ADR 與測試 → template-nextjs

來源：template-go-nextjs `docs/adr/2026-10-18-api-and-auth-baseline.md`（下稱 API）、`docs/adr/2026-10-22-account-abuse-and-lifecycle.md`（下稱 ABUSE）；測試 8 個檔逐一讀過（2026-11-03）。步驟：1 skeleton（CSP、DB、compose、Caddy）、2 認證、3 items、4 延後的帳號濫用與管理、5 rename。依據的事實見同目錄 `spike-a.md`（下稱 spike）。

## ADR 決定歸屬表

| ADR | 決定 | 歸屬 | 步驟 | 理由（一行） |
|---|---|---|---|---|
| API | D1 同源拓樸、只有 Caddy 發佈 port、`TRUSTED_PROXIES` 只列 Caddy 固定 IP | 沿用（信任判斷方式待選，見 D2 偏離清單候選 #3） | 1 | 同源與 Caddy 照搬；Next 看不到 TCP peer（spike §6），「只信 Caddy IP」要靠 preload 或改成網路隔離 |
| API | D2 API 形狀（資源導向 REST、201+Location、cursor、merge-patch、openapi.yaml） | 不適用 | 1 | 計畫 D3=A 只用 Server Actions，沒有 REST 契約；集合的分頁形狀在步驟 3 重新決定 |
| API | D3 RFC 9457 problem + `type`/`code` | 不適用 | 2 | 沒有 HTTP API；action 回傳型別帶穩定 `code`，next-intl 翻譯（計畫不變量「錯誤走 next-intl」） |
| API | D4 opaque session（SHA-256、`__Host-session` 屬性、7 日/1 日、登入發新 token、撤銷、不收 Bearer） | 沿用 | 2 | spike §2 實測 `cookies().set` 產出完全相同的屬性；只讀 cookie 自然不收 Bearer |
| API | D5 CSRF：`http.CrossOriginProtection` | 偏離（選項 A）或沿用（選項 B），待 Will | 1 | Next 內建只比 Origin 且信任 `X-Forwarded-Host`（spike §3）；選項 B 在 proxy.ts 實作同語意，已原型並全案例通過 |
| API | D6a 密碼 15–128、無組合規則、外洩清單、NFKC、username 小寫唯一 | 沿用 | 2 | 純邏輯，可直接移植 |
| API | D6b argon2id m=19 MiB t=2 p=1、限制同時雜湊數 | 沿用 | 2 | spike §1：`@node-rs/argon2` 在 Node 與兩種 image 都可用，編碼字串與 Go 相同前綴 |
| API | D6c 依帳號節流（2026-10-22 起為帳號＋來源）+ per-IP 限流 | 偏離（存放處：程序記憶體而非 DB；D7=A 已決） | 2 | spike §5 單程序實測行為與 Go 相同；多實例時失效（D7 重開條件） |
| API | D6d 長度與格式只寫在契約（openapi） | 偏離 | 2 | 沒有 openapi；改由單一 zod schema 當唯一來源，前後端共用 |
| API | D7a 查詢一律帶 owner 條件，非 owner 回「不存在」 | 沿用 | 2 | sessions 在步驟 2、items 在步驟 3 |
| API | D7b role admin/user、admin 列出/讀取/停用使用者 | 沿用 | 4 | 計畫 D4=A 把 F5（admin）延後 |
| API | D8 SIGTERM graceful shutdown、Caddy `lb_try_duration` | 沿用 | 1 | Caddy 設定照搬；Next standalone 的 SIGTERM 行為由 0 (c) 實測（本 spike 未測） |
| API | D9 每個資源有讀取端 | 不適用（sessions 的列出/讀取/撤銷以 action 與頁面沿用，步驟 2；users 讀取端隨 admin 延後，步驟 4） | 2 | 規則是為 REST `Location` 而設；沒有 REST，功能面在步驟 2/4 保留 |
| ABUSE | D1 最後一個 admin、`recover-admin` | 沿用 | 4 | admin 延後（D4=A） |
| ABUSE | D2a 稽核表 `audit_events`（append-only） | 沿用 | 4 | 稽核的對象是 admin 操作，隨 F5 延後 |
| ABUSE | D2b 登入、登出等安全事件日誌 | 沿用 | 2 | 與認證同一步；Next 沒有 access log，request id 見 D2 偏離清單候選 #6 |
| ABUSE | D3 刪除帳號（10 分鐘內登入、FK 一律 CASCADE/SET NULL） | 沿用 | 2 | 步驟 2 含刪帳號；FK 規則的測試在步驟 2 建立，步驟 3 的 items 表也要守住 |
| ABUSE | D4a 每個「帳號＋來源」指數退避（IPv6 取 /64） | 沿用（存記憶體，D7=A） | 2 | spike §5 實測 |
| ABUSE | D4b 帳號層級 100 次上限、裝置 cookie `__Host-device`、admin 解鎖、`sign_in_throttles` 表 | 沿用 | 4 | D7=A 明定延後 |
| ABUSE | D5 DB 連線 `verify-full`，只有 `DATABASE_PLAINTEXT=same-host` 例外 | 沿用 | 1 | DB 連線設定屬 skeleton，與語言無關 |

## Go 測試對照表

一列一個 Go 測試函式；`TestCrossOriginPostRejected` 依 table 子案例展開。「歸屬」欄為沿用／偏離（附原因）／不適用；延後的列寫「沿用」並把步驟標 4。

| Go 測試名 | 檔案 | 歸屬 | 所屬步驟 | TS 測試名 |
|---|---|---|---|---|
| TestMain | httpapi/auth_test.go | 不適用：Go `dbtest.Main` 的測試基礎設施；TS 用 vitest globalSetup 加 testcontainers | 2 | |
| TestOperationsRejectsUnknownName | httpapi/auth_test.go | 不適用：檢查 oapi-codegen 產生的 operation 名稱，沒有 openapi 就沒有這個風險 | 2 | |
| TestCreateUserSetsSessionCookie | httpapi/auth_test.go | 沿用（cookie 屬性、43 字元 token、小寫 account；`Location` 與 RFC 3339 斷言不適用，因為沒有 REST） | 2 | `test/integration/auth.test.ts` "creates a lowercase user, signs it in and stores only the token's SHA-256"（cookie 屬性由 2b 補） |
| TestCreateUserDuplicate | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "refuses a username that differs only in case" |
| TestCreateUserConcurrentSameAccount | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "lets exactly one of ten concurrent sign-ups of the same username through" |
| TestCreateUserPasswordTooShort | httpapi/auth_test.go | 沿用 | 2 | `src/features/auth/__tests__/credentials.test.ts` "rejects a 14-character password"；`test/integration/auth.test.ts` "rejects a password on the common-password list and a too-short one" |
| TestCreateUserNoCompositionRule | httpapi/auth_test.go | 沿用 | 2 | `src/features/auth/__tests__/credentials.test.ts` "has no composition rule: a long all-lowercase password is fine" |
| TestCreateUserCommonPassword | httpapi/auth_test.go | 沿用 | 2 | `src/features/auth/__tests__/password.test.ts` "finds a 15-character password on the common-password list"；`test/integration/auth.test.ts` "rejects a password on the common-password list and a too-short one" |
| TestCreateUserBreachedPassword | httpapi/auth_test.go | 沿用（HIBP 外洩檢查屬 requirements F4，D4 延後；2026-11-03 由步驟 2 改標，原表與 F4 不一致） | 4 | |
| TestCreateSession | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "signs in with the right password, case-insensitively, and refuses a wrong one" |
| TestCreateSessionWrongPassword | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "signs in with the right password, case-insensitively, and refuses a wrong one" |
| TestCreateSessionUnknownAccountRunsHash | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "checks one hash for an unknown username and answers the same as for a wrong password" |
| TestCreateSessionIssuesNewToken | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "issues a new token on every sign-in and ends the session the request carried" |
| TestCreateSessionMixedCaseAccount | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "signs in with the right password, case-insensitively, and refuses a wrong one" |
| TestPasswordNormalized | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "treats full-width and half-width passwords as the same (NFKC)"；`src/features/auth/__tests__/password.test.ts` "folds full-width characters with NFKC" |
| TestCreateSessionDisabledAccount | httpapi/auth_test.go | 沿用（停用是 admin 功能，隨 F5 延後） | 4 | |
| TestMe | httpapi/auth_test.go | 沿用（UUIDv7 id、username，改由頁面或 action 讀取；`role` 欄只有 admin 用得到，隨 F5 延後） | 2 | `test/integration/auth.test.ts` "authenticates a live token and nothing else"（頁面讀取由 2c 補） |
| TestMeWithoutCookie | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "authenticates a live token and nothing else" |
| TestMeWithUnknownToken | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "authenticates a live token and nothing else" |
| TestInvalidSessionCookieCleared | httpapi/auth_test.go | 偏離：Next 不允許 render 期間（server component）設定 cookie（官方 data-security 指南「Avoiding side-effects during rendering」），所以用 GET 開頁時清不掉失效的 cookie；只能在 proxy.ts 或 action 回應裡清。見 D2 偏離清單候選 #5 | 2 | |
| TestMeIgnoresBearer | httpapi/auth_test.go | 沿用 | 2 | |
| TestMeDisabledAccount | httpapi/auth_test.go | 沿用（停用隨 F5 延後） | 4 | |
| TestMeAfterUserDeleted | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "deletes the user and its sessions within ten minutes of signing in, and asks to sign in again after" |
| TestSessionIdleExpiry | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "ends a session idle for a day and one older than seven days" |
| TestSessionAbsoluteExpiry | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "ends a session idle for a day and one older than seven days" |
| TestDeleteCurrentSessionClearsCookie | httpapi/auth_test.go | 沿用 | 2 | |
| TestDeleteCurrentSessionRevokes | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "signs out the current session and, everywhere, all of them" |
| TestDeleteAllSessions | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "signs out the current session and, everywhere, all of them" |
| TestAdminDisablesUserRevokesSessions | httpapi/auth_test.go | 沿用 | 4 | |
| TestLastAdminCannotBeDisabled | httpapi/auth_test.go | 沿用 | 4 | |
| TestConcurrentAdminDisableLeavesOne | httpapi/auth_test.go | 沿用 | 4 | |
| TestNonAdminCannotPatchUser | httpapi/auth_test.go | 沿用 | 4 | |
| TestUnauthenticatedBeforeValidation | httpapi/auth_test.go | 沿用（每個 action 先 `requireSession()` 再做 zod 驗證） | 2 | |
| TestLoginThrottlePerAccount | httpapi/auth_test.go | 沿用（記憶體實作，spike §5 已跑出同樣行為；Retry-After 改成 action 回傳的 `retryAfter`） | 2 | `test/integration/auth.test.ts` "throttles a username from one source after five failures, not the owner elsewhere"（action 回傳 `retryAfter` 由 2b 補） |
| TestLoginThrottleConcurrent | httpapi/auth_test.go | 沿用（spike §5：20 個同時送 → 5 個檢查密碼、15 個被節流、只做 5 次雜湊） | 2 | `test/integration/auth.test.ts` "checks five passwords out of twenty concurrent attempts and throttles the rest" |
| TestRateLimitAuthOperations | httpapi/auth_test.go | 沿用 | 2 | |
| TestCredentialsNeverLogged | httpapi/auth_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "logs sign-up, sign-in, failures and sign-out with user ids, never the password, token or unknown username"（action 層與 cookie 值由 2b 補） |
| TestSecurityEventsLogged | httpapi/auth_test.go | 沿用（`authz.denied` 那一筆來自 admin 操作，步驟 4 補上） | 2 | `test/integration/auth.test.ts` "logs sign-up, sign-in, failures and sign-out with user ids, never the password, token or unknown username"（`request_id` 由 2b 補） |
| TestGetUser | httpapi/auth_resources_test.go | 沿用（讀取他人帳號只有 admin 需要；本人的部分由 TestMe 涵蓋） | 4 | |
| TestGetOtherUserNotFound | httpapi/auth_resources_test.go | 沿用 | 4 | |
| TestListUsers | httpapi/auth_resources_test.go | 沿用 | 4 | |
| TestNonAdminCannotListUsers | httpapi/auth_resources_test.go | 沿用 | 4 | |
| TestCreateSessionReturnsSession | httpapi/auth_resources_test.go | 不適用：測的是 201、`Location` 與 Session 回應主體（REST，計畫 D3=A 不做）；session 的時間欄位由 TestListSessions 涵蓋 | 2 | |
| TestGetCurrentSession | httpapi/auth_resources_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "lists the viewer's live sessions newest first and marks the current one" |
| TestListSessions | httpapi/auth_resources_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "lists the viewer's live sessions newest first and marks the current one" |
| TestListSessionsExcludesExpired | httpapi/auth_resources_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "lists the viewer's live sessions newest first and marks the current one" |
| TestDeleteSession | httpapi/auth_resources_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "revokes the viewer's own session but not another user's" |
| TestDeleteOtherUsersSession | httpapi/auth_resources_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "revokes the viewer's own session but not another user's" |
| TestDeleteCurrentUser | httpapi/auth_resources_test.go | 沿用（items 的斷言在步驟 3 加上，稽核列在步驟 4 加上） | 2 | `test/integration/auth.test.ts` "deletes the user and its sessions within ten minutes of signing in, and asks to sign in again after" |
| TestDeleteCurrentUserLastAdmin | httpapi/auth_resources_test.go | 沿用 | 4 | |
| TestAdminDeletesUser | httpapi/auth_resources_test.go | 沿用 | 4 | |
| TestRateLimitPerIPBehindTrustedProxy | httpapi/ratelimit_test.go | 沿用 | 2 | |
| TestRateLimitIgnoresXFFFromUntrustedPeer | httpapi/ratelimit_test.go | 沿用（選項 P：preload 補上 peer）／偏離（選項 N：只靠網路隔離，app 層無從判斷 peer），待 Will；見 D2 偏離清單候選 #3 | 2 | |
| TestRateLimitOnlyNamedOperations | httpapi/ratelimit_test.go | 沿用（只有註冊與登入的 action 受限） | 2 | |
| TestIPLimiterRefillsAndSweeps | httpapi/ratelimit_test.go | 沿用（spike `test/unit.test.ts` 已移植並通過） | 2 | `src/features/auth/__tests__/throttle.test.ts` "refills a bucket over time and drops buckets idle for a minute" |
| TestIPLimiterKeysIPv6By64 | httpapi/ratelimit_test.go | 沿用（spike 已移植並通過） | 2 | `src/features/auth/__tests__/throttle.test.ts` "limits an IPv6 /64 as one client" |
| TestSignInThrottlePerClient | httpapi/throttle_test.go | 沿用（spike §5 實測） | 2 | `src/features/auth/__tests__/throttle.test.ts` "counts each source on its own and clears the username on success"；`test/integration/auth.test.ts` "throttles a username from one source after five failures, not the owner elsewhere" |
| TestUntrustedClientsLockedTrustedDeviceNot | httpapi/throttle_test.go | 沿用 | 4 | |
| TestDeviceCookieIsPerAccount | httpapi/throttle_test.go | 沿用 | 4 | |
| TestSignOutEverywhereForgetsDevices | httpapi/throttle_test.go | 沿用 | 4 | |
| TestAdminUnlocksSignIn | httpapi/throttle_test.go | 沿用 | 4 | |
| TestHealth | httpapi/server_test.go | 沿用（Route Handler `/health`） | 1 | |
| TestReady | httpapi/server_test.go | 沿用 | 1 | |
| TestReadyDBDown | httpapi/server_test.go | 沿用（回 503；problem 主體不適用） | 1 | |
| TestShutdownFinishesInFlightRequest | httpapi/server_test.go | 沿用（Next standalone 的 SIGTERM 行為待 0 (c) 實測） | 1 | |
| TestBodyTooLarge | httpapi/server_test.go | 偏離：大小上限改用 Next 內建的 `serverActions.bodySizeLimit`（預設 1 MB），錯誤回應的形狀由 Next 決定，不是 413 problem | 1 | |
| TestCrossOriginPostRejected/cross-site | httpapi/server_test.go | 選項 A 偏離：Next 內建檢查放行（spike 實測已執行）；瀏覽器跨站 POST 一定帶 Origin，標不適用。選項 B 沿用：proxy Fetch Metadata 擋下（實測） | 1 | |
| TestCrossOriginPostRejected/same-site sibling | httpapi/server_test.go | 選項 A 偏離：Next 放行（實測）；理由同上。選項 B 沿用：擋下（實測） | 1 | |
| TestCrossOriginPostRejected/foreign Origin without Sec-Fetch-Site | httpapi/server_test.go | 沿用：Next 內建檢查擋下（實測未執行，狀態 500，不是 403）；選項 B 擋下並回 403 | 1 | |
| TestCrossOriginPostRejected/same-origin | httpapi/server_test.go | 沿用（兩個選項都放行，實測） | 1 | |
| TestCrossOriginPostRejected/non-browser client | httpapi/server_test.go | 沿用（兩個選項都放行，實測；fetch action 不帶 Origin 時沒有記任何警告） | 1 | |
| TestSlowHeaderClosed | httpapi/server_test.go | 偏離：Node http server 的 `headersTimeout`／`requestTimeout` 用預設值，standalone `server.js` 沒有設定入口；慢速攻擊（slowloris）由前面的 Caddy 處理 | 1 | |
| TestUnknownPathNotFound | httpapi/server_test.go | 沿用（Next 的 not-found；problem 主體不適用） | 1 | |
| TestRequestIDFromTrustedProxy | httpapi/middleware_test.go | 沿用（Caddy 送 `X-Request-ID`，proxy.ts 驗證格式後傳給 render；信任判斷與候選 #3 相同） | 1 | |
| TestRequestIDFromUntrustedPeerReplaced | httpapi/middleware_test.go | 沿用／偏離，視候選 #3 的選擇（沒有 peer 時無法區分來源） | 1 | |
| TestRequestIDMalformedReplaced | httpapi/middleware_test.go | 沿用 | 1 | |
| TestProblemCarriesRequestID | httpapi/middleware_test.go | 不適用：沒有 problem 主體；錯誤頁可顯示 Next 的 `digest` | 1 | |
| TestPanicLogAndAccessLogCarryRequestID | httpapi/middleware_test.go | 偏離：Next 不寫 access log（改由 Caddy 的 `log`）；未捕捉的錯誤改走 `instrumentation.ts` 的 `onRequestError` | 1 | |
| TestSecurityHeaders | httpapi/middleware_test.go | 沿用（`next.config` headers 或 proxy.ts；CSP 在步驟 1） | 1 | |
| TestClientIP | httpapi/middleware_test.go | 沿用（spike 已移植全部 7 個子案例並通過；peer 的來源見候選 #3） | 2 | `src/features/auth/__tests__/throttle.test.ts` describe "clientIP"（7 個子案例，"untrusted peer ignores XFF" 起） |
| TestAccessLogAbortBeforeWriting | httpapi/middleware_test.go | 不適用：專測 Go 的 `http.ErrAbortHandler` | 1 | |
| TestResponseControllerReachesConnection | httpapi/middleware_test.go | 不適用：專測 Go middleware 包裝器的 `Unwrap` | 1 | |
| TestArgon2Hash | modules/auth/service_test.go | 沿用（spike：參數相同；遇到格式錯誤的雜湊 `@node-rs/argon2` 會丟例外，不是回傳 false，包裝函式要把它轉成「不符合」） | 2 | `src/features/auth/__tests__/password.test.ts` "hashes with OWASP's argon2id parameters and verifies hashes made with others"、"treats the unparsable hash %j as a mismatch" |
| TestArgonConcurrencyBounded | modules/auth/service_test.go | 沿用（spike 做了 semaphore 原型；計畫的 mutation「拿掉同時雜湊數上限」要讓這個測試失敗） | 2 | `src/features/auth/__tests__/password.test.ts` "runs at most maxConcurrent hashes at once"（Go 的「等待中的雜湊隨 context 取消」不適用：action 拿不到請求的取消訊號，2a review 後拿掉未使用的 AbortSignal） |
| TestLoginThrottleSchedule | modules/auth/service_test.go | 沿用（spike 已移植並通過） | 2 | `src/features/auth/__tests__/throttle.test.ts` "waits 2^(n-5) minutes after the n-th failure, at most an hour, and does not count a refused attempt" |
| TestCleanup | modules/auth/service_test.go | 沿用（sessions 部分；節流狀態改成記憶體的 sweep；devices 在步驟 4） | 2 | `test/integration/auth.test.ts` "cleans up expired sessions and day-old sign-in counts"；`src/features/auth/__tests__/throttle.test.ts` "forgets counts untouched for a day" |
| TestShortIdleLimitKeepsUsedSession | modules/auth/service_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "keeps a session used every 20 seconds alive under a 30-second idle limit" |
| TestMain | modules/auth/schema_test.go | 不適用：Go 測試基礎設施 | 2 | |
| TestBaselineAppliesWithCommunity | modules/auth/schema_test.go | 偏離：Atlas 版本表的部分改用 D1 選定的 migration 工具；「app 角色只有 DML、碰不到 migration 自己的表」的斷言沿用 | 1 | |
| TestSchemaChecks | modules/auth/schema_test.go | 沿用（users、sessions 的 check 約束在步驟 2；`sign_in_throttles` 在步驟 4） | 2 | `test/integration/auth.test.ts` "rejects an uppercase or too-short username and a token hash that is not 32 bytes" |
| TestForeignKeysToUsersAllowDeletion | modules/auth/schema_test.go | 沿用 | 2 | `test/integration/auth.test.ts` "lets every foreign key to users follow a deleted account (cascade or set null)" |
| TestAuditEventsAppendOnly | modules/auth/schema_test.go | 沿用 | 4 | |
