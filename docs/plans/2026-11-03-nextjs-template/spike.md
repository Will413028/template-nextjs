# 步驟 0 spike 結果（2026-11-03）

原始碼在 [`spike-src/`](spike-src/)（a 認證、b 資料存取、c 部署）。下文的指令原本在暫存目錄 `scratchpad/spike-{a,b,c}/` 執行，重跑時改到對應的 `spike-src/{a,b,c}/`，先 `pnpm install`。

orchestrator 複核（2026-11-03）：`spike-src/a` 的 vitest 20 過、4 個 Docker 測試跳過（未重跑，機器 load 高）；`spike-src/b` 的 drizzle、prisma integration 各 2 過；`auth-parity.md` 對 8 個 Go 測試檔的 87 個測試名稱逐一比對無缺。(c) 未重跑。

## spike 0 (a)：在 Next.js 16 上自建 opaque session 的機制事實

日期 2026-11-03。版本：next 16.4.4（npm latest）、react 19.3.1、@node-rs/argon2 2.2.2、vitest 5.0.5、TypeScript 5；本機 Node 26.10.0（darwin-arm64）；image 用 Node 24.22.2（linux-arm64）。目錄裡是拋棄式程式，不是產品程式碼。

標記：**實測**＝這次跑過、下面附了原始輸出；**推論**＝從原始碼或文件推得，沒有實際跑。

### 怎麼重跑

```sh
cd <spike-a>
pnpm install
pnpm build                                   # next build（standalone 輸出）
./node_modules/.bin/vitest run --silent=false   # 單元測試 + 每個情境起一個 next start（不開瀏覽器）
# image 與 Caddy：
docker build -t spike-a-next:alpine --build-arg BASE=node:24-alpine .
docker build -t spike-a-next:slim   --build-arg BASE=node:24-bookworm-slim .
docker/stack-up.sh alpine && SPIKE_STACK=alpine ./node_modules/.bin/vitest run test/stack.test.ts --silent=false; docker/stack-down.sh
FM=1 docker/stack-up.sh slim && SPIKE_STACK=slim ./node_modules/.bin/vitest run test/stack.test.ts --silent=false; docker/stack-down.sh
```

最後一次本機執行：`Test Files 2 passed | 1 skipped (3)`、`Tests 20 passed | 4 skipped (24)`；跳過的是 stack 測試，它只在 `SPIKE_STACK` 有設時才跑。stack 測試：alpine `Tests 4 passed (4)`，slim（開啟 FM=1）`Tests 4 passed (4)`。

目錄配置：`lib/`（session、throttle、client-ip、auth-state、store）、`app/actions.ts`、`app/protected/*`、`app/shared-actions.ts`、`app/spike/*`（測試用的副作用與標頭端點）、`proxy.ts`（Fetch Metadata 原型與 path 型 session 檢查，都由環境變數開關）、`peer.cjs`（preload，見 §6）、`test/`、`Dockerfile`、`docker/`。

官方文件（查詢日期皆為 2026-11-03，括號內是頁面標示的 lastUpdated）：
- Data Security：https://nextjs.org/docs/app/guides/data-security （2026-10-06）
- Authentication：https://nextjs.org/docs/app/guides/authentication （2026-09-16）
- serverActions 設定：https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions （2026-08-26）
- cookies：https://nextjs.org/docs/app/api-reference/functions/cookies （2026-06-09）
- output（standalone）：https://nextjs.org/docs/app/api-reference/config/next-config-js/output （2026-09-18）

### 1. argon2id

**結論（實測）**：`@node-rs/argon2` 2.2.2 在三個環境都能載入，並用 ADR 的參數雜湊與驗證：本機 Node，以及 Next standalone image 跑在 **node:24-alpine（musl）** 和 **node:24-bookworm-slim（glibc 2.36）** 兩種 base 上，都是 linux-arm64。ADR 參數已核對：API ADR D6 寫「argon2id（m=19 MiB、t=2、p=1）」，Go 版 `DefaultArgon2Params = {MemoryKiB: 19*1024, Time: 2, Threads: 1}`。編碼後字串的前綴和 Go `TestArgon2Hash` 期望的 `$argon2id$v=19$m=19456,t=2,p=1$` 完全相同，所以 Go 產生的雜湊在 TS 端也能驗證（**推論**：格式是 PHC 標準字串；不過「其他參數產生的雜湊也能驗證」這點已經實測）。`argon2`、`hash-wasm` 不需要試。`@node-rs/argon2` 在 Next 預設的 `serverExternalPackages` 清單裡（`node_modules/next/dist/lib/server-external-packages.json` 第 14 行），所以不用另外設定。

```
[argon2] encoded: $argon2id$v=19$m=19456,t=2,p=1$9SVvD65mQpMY++PNOiAWeA$heuKKW...
[argon2] verify("") -> throws: Decoding failed
[argon2] verify("$2b$12$abc") -> throws: Decoding failed
[argon2] verify("$argon2id$v=19$m=0,t=1,p=1$c2FsdA$a2V5") -> throws: Output is too short
[stack alpine] argonInfo: {"encoded":"$argon2id$v=19$m=19456,t=2,p=1$ud2G...","verifyOk":true,"verifyBad":false,"node":"24.22.2","platform":"linux-arm64","libc":"musl/none"}
[stack slim]   argonInfo: {"encoded":"$argon2id$v=19$m=19456,t=2,p=1$wwfP...","verifyOk":true,"verifyBad":false,"node":"24.22.2","platform":"linux-arm64","libc":"2.36"}
```

- **和 Go 不同（實測）**：遇到格式錯誤的雜湊，`verify` 會丟例外，不是回傳 false；Go 的 `Verify` 回傳 `(false, nil)`。步驟 2 的包裝函式要把例外轉成「不符合」，才能對上 `TestArgon2Hash`。
- 同時雜湊數上限：spike 在 `lib/auth-state.ts` 有 semaphore 原型（`withHashSlot`）。§5 的併發測試在 `SPIKE_MAX_HASHES=4` 下通過，但沒有單獨測 peak，所以 peak 值未驗證。步驟 2 的 `TestArgonConcurrencyBounded` 對應測試要量 peak。
- 雜湊耗時：本機約 23–76 ms，容器內 57–2228 ms 且起伏很大。這**不是有效量測**：當時 `uptime` 的 load average 約 101，是多個 session 共用的機器。要量請到 0 (c) 或 CI，依 measurement playbook 做。

### 2. Server Action 裡用 `cookies()` 設 `__Host-session`

**結論（實測）**：`(await cookies()).set("__Host-session", token, {httpOnly:true, secure:true, sameSite:"lax", path:"/", maxAge:604800})` 產生的屬性和 Go 版一樣，而且沒有 Domain。經 Caddy 也相同。

```
[cookie] status 200 Set-Cookie: [
  '__Host-session=4i6y6rBf2_Tz4hd2c-B0gBRA5HBHU2fAefr-PtoQxSM; Path=/; Expires=Tue, 10 Nov 2026 02:41:26 GMT; Max-Age=604800; Secure; HttpOnly; SameSite=lax'
]
[stack alpine] Set-Cookie: ['__Host-session=...; Path=/; Expires=...; Max-Age=604800; Secure; HttpOnly; SameSite=lax']
```

- Next 會在 `Max-Age` 之外再補一個 `Expires`（**實測**），沒有害處。
- **限制（文件）**：cookies 頁寫「Setting cookies is not supported during Server Component rendering」，`.delete` 也只能在 Server Function 或 Route Handler 裡呼叫。這直接影響 `TestInvalidSessionCookieCleared`，見 D2 偏離清單候選 #5。

### 3. CSRF：Next 內建檢查 vs Go `TestCrossOriginPostRejected`

斷言方式：action 有沒有執行，看副作用紀錄有沒有新增、有沒有 `Set-Cookie`。兩者每一案都一致，也有斷言（`expect(executed).toBe(cookie)`）。Go 欄的前 5 列來自 Go 測試的 table；標 `x` 的是追加案例，Go 欄的期望值是讀 go1.27.3 `net/http/csrf.go` `CrossOriginProtection.Check` 推得的（**推論**，沒有用 Go 跑）。

**實測（next start，本機直連）：**

```
[csrf builtin] cross-site                                       go=blocked next=allowed status=200 executed=true  setCookie=true
[csrf builtin] same-site sibling                                go=blocked next=allowed status=200 executed=true  setCookie=true
[csrf builtin] foreign Origin without Sec-Fetch-Site            go=blocked next=blocked status=500 executed=false setCookie=false
[csrf builtin] same-origin                                      go=allowed next=allowed status=200 executed=true  setCookie=true
[csrf builtin] non-browser client                               go=allowed next=allowed status=200 executed=true  setCookie=true
[csrf builtin] x browser cross-site (Origin+SFS)                go=blocked next=blocked status=500 executed=false setCookie=false
[csrf builtin] x browser same-site sibling (Origin+SFS)         go=blocked next=blocked status=500 executed=false setCookie=false
[csrf builtin] x Origin null                                    go=blocked next=blocked status=500 executed=false setCookie=false
[csrf builtin] x browser same-origin (Origin+SFS)               go=allowed next=allowed status=200 executed=true  setCookie=true
[csrf builtin] x forged X-Forwarded-Host = evil Origin (direct) go=blocked next=allowed status=200 executed=true  setCookie=true
```

伺服器日誌（被擋的案例）：``x-forwarded-host` header with value `127.0.0.1:61374` does not match `origin` header with value `evil.test` from a forwarded Server Actions request. Aborting the action.``

**經 Caddy 偽造 `X-Forwarded-Host`（實測，alpine stack，FM=0）：**

```
[stack alpine] forged XFH via Caddy: status=500 executed=false setCookie=false
[stack alpine] forged XFH direct to Next: 200 ["__Host-session=...; Secure; HttpOnly; SameSite=lax"] executed=true
```

結論：
- 計畫依原始碼的推論**大致成立（實測）**。Next 只把 Origin 的 host 拿來和 `X-Forwarded-Host` 的第一個值比，沒有那個標頭時才比 Host（`action-handler.js` `parseHostHeader`），完全不看 `Sec-Fetch-Site`；不帶 Origin 時放行；不符時狀態碼是 500，而且 action 確實沒有執行。
- **修正計畫的一點（實測加原始碼）**：fetch 形式的 action 不帶 Origin 時，Next **不記任何警告**。`warnBadServerActionRequest()` 只在 MPA 表單提交（沒有 JS 的 `<form>` POST）時呼叫（`action-handler.js:585`、`:731`）；測試日誌裡也找不到「Missing `origin`」。
- **新發現（實測）**：Next 相信用戶端送來的 `X-Forwarded-Host`。Next 自己的 `base-server.js:601` 只在沒有這個標頭時才補上（`??=`）。所以攻擊者只要能直接連到 Next，就能用 `Origin: evil` 搭配 `X-Forwarded-Host: evil` 繞過檢查。經 Caddy 時擋得下來，因為 Caddy 會把 XFH 改寫成真正的 Host（`127.0.0.1:8088`，見 §6 的原始輸出）。內建檢查的安全前提因此是「Next 只能從 Caddy 連到」，這和 API ADR D1「只有 Caddy 發佈 port」一致；不過同一個 compose 網路裡的其他容器仍然能繞過。
- STOP 條件**沒有觸發**：所有帶跨站 Origin 的案例都被擋下，唯一的例外是直連 Next 並偽造 XFH，而這有替代方案（下面的選項 B）。

**`Sec-Fetch-Site`-only 案例的兩個選項（交 Will 決定）：**
- **選項 A：只用 Next 內建檢查。** `cross-site` 與 `same-site sibling` 兩案標「不適用」並列進偏離清單。理由（**推論**）：瀏覽器在跨站 POST 一定會帶 Origin，只帶 Sec-Fetch-Site、不帶 Origin 的請求只能是手工構造的，而手工請求本來就拿不到受害者的 cookie。代價：被擋時回 500 而不是 403；安全性依賴網路隔離（XFH 那一點）；Go ADR D5 的「Fetch Metadata 為主」降級成只看 Origin。
- **選項 B：在 `proxy.ts` 補上 Fetch Metadata 檢查。** 原型約 15 行（`proxy.ts` 的 `crossOrigin()`），照搬 Go `Check` 的判斷順序：有 Sec-Fetch-Site 時只接受 same-origin 與 none；沒有時看 Origin，並且和 **Host** 比、不和 XFH 比。**實測**全部 10 案都和 Go 欄一致，偽造 XFH 不論直連或經 Caddy 都回 403：

```
[csrf proxy-fm] cross-site                        go=blocked next=blocked status=403 executed=false setCookie=false
[csrf proxy-fm] same-site sibling                 go=blocked next=blocked status=403 executed=false setCookie=false
[csrf proxy-fm] foreign Origin without SFS        go=blocked next=blocked status=403 executed=false setCookie=false
[csrf proxy-fm] same-origin / non-browser client  go=allowed next=allowed status=200 executed=true  setCookie=true
[csrf proxy-fm] x forged X-Forwarded-Host (direct) go=blocked next=blocked status=403 executed=false setCookie=false
[stack slim] forged XFH via Caddy: status=403 executed=false setCookie=false
[stack slim] forged XFH direct to Next: 403 [] executed=false
```

  代價與前提（**推論**）：proxy 的 matcher 必須涵蓋所有路徑，只排除 `_next/static` 這類靜態資源，因為 action 可以 POST 到任何路徑，包括不存在的路徑（§4）；Next 內建的 Origin 檢查照樣保留，等於兩層防護。官方 Authentication 指南也說「for auth, it's recommended Proxy runs on all routes」。我的建議是 B：程式量小，行為和 Go 版及兩份 ADR 一致，也不必再依賴 XFH。

### 4. session 檢查要放哪一層

**結論（實測）**：必須放在**每個 action 裡**，由 `requireSession()` 或 DAL 執行；頁面（server component）和 proxy 都只能是附加的一層。

```
[layer page-only] POST /protected unguarded, no cookie: status=200 executed=true      ← 頁面 redirect 擋不住 action
[layer page-only] POST / unguarded, no cookie: status=200 executed=true               ← 用別的頁面路徑也能呼叫
[layer page-only] POST /does-not-exist unguarded, no cookie: status=404 executed=true ← 回 404 但 action 已執行
[layer in-action] POST / guarded, no cookie: status=200 executed=false result={"$error":"{\"digest\":\"1864875016\"}"}
[layer in-action] POST / guarded, with cookie: status=200 executed=true
[layer proxy] page-specific POST /protected, no cookie: status=307 executed=false
[layer proxy] page-specific POST /, no cookie: status=200 executed=false   ← 轉送後重新經過 proxy，被擋下
[layer proxy] shared POST /protected, no cookie: status=307 executed=false
[layer proxy] shared POST /, no cookie: status=200 executed=true           ← 共用 action 繞過 path 型 proxy
```

- 用 action ID 可以從任何路徑 POST，包括不存在的路徑。Next 的「action forwarding」機制會在 action 不屬於當前頁面時，把請求內部 fetch 到擁有它的頁面（`action-handler.js` `createForwardedActionResponse`，第 133 行起，加上 `x-action-forwarded: 1`）。因為那次 fetch 會再經過 proxy，**只屬於受保護頁面**的 action 會被 path 型 proxy 擋住；但公開頁與受保護頁**都 import** 的 action 不會被轉送，直接在公開路徑上執行（**實測**）。所以 proxy 擋不擋得住，取決於 import 圖，不能當成認證的邊界。
- 被拒的 action 回 200，錯誤藏在 RSC 的錯誤列裡（**實測**）。斷言一定要看副作用，或看 action 回傳的型別。
- 官方文件也這麼寫：data-security「A page-level authentication check does not extend to the Server Actions defined within it. Always re-verify inside the action」；authentication「While Proxy can be useful for initial checks, it should not be your only line of defense」。
- 計畫不變量「從 manifest 列出所有 action ID，逐一不帶 cookie 呼叫，除註冊與登入外全部被拒」**可行（實測）**：manifest 的每一筆都有 `filename` 和 `exportedName`。inline action 的 `exportedName` 是 `$$RSC_SERVER_ACTION_0`，要用 `filename` 判斷屬於哪裡。

### 5. 登入節流在單一程序內的做法（D7=A）

**結論（實測）**：`lib/throttle.ts` 有兩部分，行為和 Go 一致。
- `IPLimiter`：token bucket，每分鐘 perMin 個、burst 也是 perMin，閒置的 bucket 會被 sweep，對應 Go `ratelimit.go` 的 `ipLimiter`。
- `SignInThrottle`：每組「帳號＋來源」各自計數，在比對密碼**之前**先記一次嘗試；從第 5 次失敗起等待 2^(n-5) 分鐘，上限 60 分鐘；登入成功就清掉。這對應 Go 的 `ReserveLoginAttempt` UPSERT（`queries/sign_in_throttles.sql`）。來源用 `limitKey`：IPv4 照原樣，IPv6 取 /64，和 Go `limitKey` 相同。
- 併發安全的理由（**推論加實測**）：`reserve()` 是完全同步的，而 Node 單一 event loop 內，同步程式碼不會被其他請求插隊，等於 Go 用單一 SQL UPSERT 得到的原子性。實測結果如下：

```
[throttle concurrent] invalid=5 throttled=15 verifies=5   ← Go TestLoginThrottleConcurrent 的期望：5 / 15 / 5
[ip limit] [{"error":"invalid_credentials"},{"error":"invalid_credentials"},{"error":"rate_limited","retryAfter":30}]
```

- 通過的移植測試：`TestLoginThrottleSchedule`（單元測試，假時鐘）、`TestSignInThrottlePerClient` 與 `TestLoginThrottlePerAccount` 的形狀（經真的 action）、IPv6 同一個 /64 共用節流（經 action）、`TestIPLimiterRefillsAndSweeps`、`TestIPLimiterKeysIPv6By64`、`TestRateLimitAuthOperations`（2/min）。
- 和 Go 的差異：Go 的測試凍結時鐘，所以能斷言 `Retry-After` 恰好是 60 或 30；spike 的伺服器跑在真實時鐘上，所以斷言 59–60 與 29–30。步驟 2 要把時鐘做成可注入（spike 用 PATCH `/spike/effects` 推進偏移量，示範可行）。
- 前提是單一實例（D7 已寫明；這是**推論**）。多副本會讓限額乘上副本數；程序重啟會清掉所有節流狀態，這是 D7=A 已接受的代價。

### 6. Caddy 後面的 client IP

**事實（實測加原始碼）：**
- Next **不提供 TCP peer 位址**：Next 15 起沒有 `request.ip`。`base-server.js:604` 只在沒有 `x-forwarded-for` 時，才用 `req.socket.remoteAddress` 補上（`??=`）。所以只要用戶端自己帶了 XFF，app 層就再也看不到真正的 peer：

```
plainNoXff:     {"xff":"127.0.0.1", ...}          ← Next 用 socket 補上
plainForgedXff: {"xff":"6.6.6.6", ...}            ← 用戶端的值原樣傳進來
```

- **Caddy 2（`caddy:2` image）的行為（實測）**：用戶端偽造的 XFF 會被換成真正的 peer，XFH 會被換成真正的 Host，Host 原樣轉送：

```
[stack] via Caddy: {"host":"127.0.0.1:8088","xfh":"127.0.0.1:8088","xff":"172.31.250.1","peer":"172.31.250.2","resolved":{"ip":"172.31.250.1",...}}
                   ← 送出的 X-Forwarded-For: 6.6.6.6 不見了；172.31.250.1 是 Docker Desktop 的 gateway（從 host 經發佈的 port 進來）
[stack] direct:    {"host":"spike-a-next:3000","xff":"6.6.6.6","peer":"172.31.250.3","resolved":{"ip":"172.31.250.3",...}}
                   ← compose 網路裡的另一個容器直連 Next：XFF 原樣保留，preload 讓 app 認出 peer 不受信任
```

**兩個選項（交 Will 決定）：**
- **選項 P：preload 補上 peer。** `NODE_OPTIONS="-r ./peer.cjs"` 在 Next 之前把 `req.socket.remoteAddress` 寫進 `x-spike-peer`，並覆蓋用戶端送來的同名標頭。app 就能照 Go `trust.clientIP` 的演算法判斷：peer 是可信的 proxy 才採用 XFF，並從右往左找第一個不可信的位址。Go `TestClientIP` 的 7 個子案例全部移植並通過（`test/unit.test.ts`）；對照 `ratelimit_test` 的「不可信的 peer 忽略 XFF」案例，**實測**得到 `preloadUntrustedPeerForgedXff.resolved.ip = 127.0.0.1`，以及 stack 直連時的 `172.31.250.3`。代價（**推論**）：要 monkeypatch `http.Server.prototype.emit`，依賴 Node 內部行為，每次升級 Next 或 Node 都要靠測試確認還有效。
- **選項 N：只靠網路隔離。** Next 不發佈 port，app 直接採用 XFF 最右邊的值（Caddy 寫的）。程式最少；代價是 compose 網路裡任何容器都能偽造 IP，例如被入侵的 sidecar 可以替自己選限流的 key。這是 Go ADR D1「只信 Caddy 的固定 IP，不信整個 subnet」想避免的情況，所以算偏離。
- 我的建議是 P：Go 的 trusted-proxy 與 IPv6 /64 案例可以全部沿用，`TestRateLimitIgnoresXFFFromUntrustedPeer` 和 `TestRequestIDFromUntrustedPeerReplaced` 也不必偏離。
- Docker Desktop 從 host 經發佈的 port 進來時，client IP 一律是 gateway（`172.31.250.1`）。這是 Docker Desktop 的特性（**推論**；Go ADR D1 的 rationale 有提到同類問題），VPS 上的 Linux Docker 要在 0 (c) 或步驟 1 另外確認。

### 7. 測試 harness

**結論（實測）**：
- `test/next-server.ts`：`next build` 之後，從 vitest 用 spawn 起 `next start -p <空閒 port>`，用輪詢等它就緒，測完送 SIGTERM。
- `test/action-client.ts`：從 `.next/server/server-reference-manifest.json` 以 `filename#exportedName` 查出 action ID，`POST` 時帶 `Next-Action: <id>`、`Content-Type: text/plain;charset=UTF-8`，body 是 `JSON.stringify(args)`，cookie 用手動的 `Cookie` 標頭帶；讀回 `getSetCookie()`，並解析 RSC 的第 0 列 `"a":"$@N"` 指到的那一列，取得 action 回傳值。
- 同一個 client 也能透過 `test/stack.test.ts` 經 Caddy 打 standalone image；ID 用 `docker run --rm <image> cat .next/server/server-reference-manifest.json` 從 image 內取出。

原始碼與 manifest 的事實（**實測**）：
- standalone 輸出包含 `.next/server/server-reference-manifest.json`。
- **每次 build 的 action ID 都不同**：本機、alpine、slim 三次 build 的 9 個 ID 全部不同（`diff` 輸出 `1,9c1,9`），所以 ID 一定要從受測的那個 image 取。官方 data-security 寫「These IDs are periodically recalculated between builds」。
- React Flight 會把以 `$` 開頭的字串跳脫成 `$$`（例如 argon2 雜湊）；解碼時要還原，`unescape$` 已處理。
- 在 `output: "standalone"` 下，`next start` 仍能跑完全部測試（**實測**）；正式環境用 `node server.js`（官方 output 文件）。

### 其他觀察

- pnpm 依全域的 `minimumReleaseAge` 設定，在 `pnpm-workspace.yaml` 自動寫入 `minimumReleaseAgeExclude: next@16.4.4 …`（**實測**），表示 16.4.4 發布還不到等待期。步驟 1 選版本時要知道這件事。
- image 大小（**實測**，arm64）：alpine 205 MB、slim 288 MB。兩者 argon2 都正常，選哪個留給 0 (c)。
- TS 7.0.2 是 `pnpm add -D typescript` 的預設版本；spike 為了穩妥改用 TS 5，沒有驗證 Next 16.4.4 是否支援 TS 7。
- wiki 教訓（cache components）：spike 沒有開 `cacheComponents`，root layout 沒有任何 dynamic read，`pnpm build` 每次都跑過；步驟 1 若開啟，要照教訓檢查。

### 完整性檢查（auth-parity.md 對照表）

```sh
cd template-go-nextjs/backend
rg -o --no-filename '^func (Test\w+)' -r '$1' internal/httpapi/{auth_test.go,auth_resources_test.go,ratelimit_test.go,throttle_test.go,server_test.go,middleware_test.go} internal/modules/auth/{service_test.go,schema_test.go} | sort > go-tests.txt   # 88 行（TestMain 出現 2 次）
rg -o '^\| (Test\w+)' -r '$1' spike-a/auth-parity.md | sort > parity-names.txt
diff <(sort -u go-tests.txt) <(sort -u parity-names.txt) && echo "DIFF EMPTY (unique): $(sort -u go-tests.txt | wc -l | tr -d ' ') names"
```

輸出：`DIFF EMPTY (unique): 87 names`。另外，`TestCrossOriginPostRejected` 展開成 5 列子案例（`rg -c '^\| TestCrossOriginPostRejected/'` → 5）；`TestMain` 每個檔各一列，共 2 列。不加 `-u` 時的差異只有那 4 個多出的子案例列（原始輸出：`28a29,32 > TestCrossOriginPostRejected ×4`）。

### 剩餘的不確定

- Next standalone 對 SIGTERM 的處理、在途請求能不能完成（`TestShutdownFinishesInFlightRequest`）：沒有測，屬 0 (c)。
- argon2 在正式機器上的耗時與 peak 記憶體：沒有有效量測（機器負載高）。
- preload（選項 P）在 Next 或 Node 升級後是否還有效：只能靠步驟 2 的測試守住。
- VPS 上的 Linux Docker 經 Caddy 能否拿到真實 client IP（不會變成 gateway IP）：沒有測。
- Next 內建 Origin 檢查在 `next dev` 下的行為：沒有測（沒有必要）。

### D2 偏離清單候選

每條都附來源（ADR 決定或 `auth-parity.md` 的偏離列）和選項。標「已決」的是 Will 已在計畫裡決定，列出來只是為了完整。

1. **CSRF 機制（API D5；`TestCrossOriginPostRejected/cross-site`、`/same-site sibling` 在選項 A 下）**：A＝只用 Next 內建檢查，兩個只帶 Sec-Fetch-Site 的案例標不適用，被擋時回 500，安全性依賴 Next 只能從 Caddy 連到（因為 Next 相信 XFH）；B＝proxy.ts 實作 Fetch Metadata 檢查，已實測和 Go 全部一致，**建議**。
2. **跨來源被擋時的狀態碼（只在 1 選 A 時成立）**：500 而不是 403；`foreign Origin without Sec-Fetch-Site` 那一案仍算沿用（action 沒有執行），只差狀態碼。
3. **信任 proxy 的判斷（API D1 `TRUSTED_PROXIES`；`TestRateLimitIgnoresXFFFromUntrustedPeer`、`TestRequestIDFromUntrustedPeerReplaced`）**：P＝preload 補上 peer，沿用 Go 演算法，**建議**；N＝只靠網路隔離，算偏離。
4. **節流狀態存在程序記憶體，不存 DB（API D6c、ABUSE D4a）**：已決（D7=A）；多實例或 D5=B 時要重開 D7。
5. **失效的 cookie 只在 action 或 proxy 裡清掉（`TestInvalidSessionCookieCleared`）**：server component render 時不能寫 cookie（官方 cookies 文件）。選項：proxy.ts 每次請求查一次 session 並清 cookie（文件提醒 proxy 跑在每個路由上，查 DB 有效能代價），或只在 action 與登出 Route Handler 裡清，頁面上看到失效 session 時 redirect 到會清 cookie 的 Route Handler。兩者都沒有實測。
6. **access log 與 request id（`TestPanicLogAndAccessLogCarryRequestID`）**：Next 沒有 access log，改由 Caddy 記；未捕捉的錯誤走 `instrumentation.ts` `onRequestError`（**推論**，沒有測）。
7. **請求主體大小上限（`TestBodyTooLarge`）**：改用 `serverActions.bodySizeLimit`（預設 1 MB，官方文件），回應形狀不是 413 problem。
8. **慢速標頭攻擊（`TestSlowHeaderClosed`）**：standalone `server.js` 沒有設定 `headersTimeout` 的入口，交給前面的 Caddy（**推論**）。
9. **契約的唯一來源（API D6d）**：從 openapi 改成 zod schema。
10. **migration 工具（`TestBaselineAppliesWithCommunity`）**：從 Atlas 改成 D1 選定的工具；角色權限的斷言沿用。

## Spike 0(b)：Drizzle vs Prisma（D1 事實）

日期 2026-11-03。拋棄式試驗，供 D1 決策；不做決定。標記：**實測**＝本 spike 跑過並附輸出；**推論**＝讀原始碼／文件推得，未跑。

### 環境與版本（實測）

- PostgreSQL `postgres:18` → `postgres (PostgreSQL) 18.6`；Node v26.10.0；pnpm 12.15.0；Next.js 16.4.2、React 19.3.1。
- Drizzle：`drizzle-orm@0.45.4`、`drizzle-kit@0.31.11`（npm `latest`；另有 `1.0.0-rc.5` 在 `rc` tag，未測）。
- Prisma：`prisma`/`@prisma/client`/`@prisma/adapter-pg@7.10.1`。注意：npm `prisma` 的 `latest` dist-tag 目前指向 `8.0.0-rc.29`（`npm view prisma dist-tags`），`pnpm add prisma` 不釘版本會裝到 RC；本 spike 用 `prev`=7.10.1 穩定版。
- `pg@8.23.1`；vitest 5.0.5（5.1.0 發布未滿一天，pnpm minimumReleaseAge 會擋，故退一版）；`@testcontainers/postgresql@12.2.1`。
- 角色：複製 Go 版 `deploy/postgres/initdb/10-roles.sh` 原檔掛到 `/docker-entrypoint-initdb.d`（owner：NOSUPERUSER NOCREATEDB NOCREATEROLE，擁有 DB 與 public；app：只有 CONNECT）。DML 授權照 Go 版 `internal/platform/migrate/migrate.go` `grant()` 的五條敘述寫成 `pg/grant.sql`，migrate 後以 owner 執行（10-roles.sh 本身沒有 default privileges，Go 版是 `app migrate` 每次補 grant）。

### 檔案

```
spike-b/
  pg/initdb/10-roles.sh   Go 版原檔複本
  pg/secrets/*            拋棄式密碼（spike 專用假值）
  pg/newdb.sh             用 10-roles.sh 同樣規則建額外 DB（drizzle_db / prisma_db / prisma_shadow）
  pg/grant.sql            Go 版 grant() 的 SQL
  drizzle/  src/schema.ts src/queries.ts src/runtime.ts src/migrate.ts drizzle.config.ts migrations/ test/db.int.test.ts
  prisma/   prisma/schema.prisma prisma.config.ts prisma/migrations/ src/queries.ts src/runtime.ts test/db.int.test.ts
  next/{base,drizzle,prisma}/  output: "standalone" 最小 app，/api/items 以 app 角色查詢
  logs/                   build log、standalone 大小清單
```

重跑前置（PG 容器已移除，重跑時再建）：

```sh
S=<this dir>
docker run -d --name spike-b-pg -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=super_spike_pw -e POSTGRES_DB=spike \
  -e DB_OWNER_USER=spike_owner -e DB_APP_USER=spike_app \
  -v $S/pg/initdb:/docker-entrypoint-initdb.d:ro -v $S/pg/secrets:/run/secrets:ro postgres:18
$S/pg/newdb.sh drizzle_db; $S/pg/newdb.sh prisma_db; $S/pg/newdb.sh prisma_shadow
OWNER=postgres://spike_owner:owner_spike_pw@127.0.0.1:55432 ; APP=postgres://spike_app:app_spike_pw@127.0.0.1:55432
```

---

### 1. SQL migration、owner 套用、app 只有 DML

#### Drizzle（實測）

```sh
cd $S/drizzle
npx drizzle-kit generate --name baseline                       # → migrations/0000_baseline.sql（純 SQL）+ meta/_journal.json + snapshot
MIGRATE_DATABASE_URL=$OWNER/drizzle_db npx drizzle-kit migrate  # 或程式化：npx tsx src/migrate.ts
docker exec -i spike-b-pg psql -U spike_owner -d drizzle_db -h 127.0.0.1 < ../pg/grant.sql
APP_DATABASE_URL=$APP/drizzle_db npx tsx src/runtime.ts
```

產生的 SQL 片段（`migrations/0000_baseline.sql`）：

```sql
CREATE TABLE "sessions" (
	"token_hash" "bytea" PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL, ...
	CONSTRAINT "sessions_token_hash_check" CHECK (octet_length("sessions"."token_hash") = 32)
);
ALTER TABLE "items" ADD CONSTRAINT "items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "items_owner_id_id_idx" ON "items" USING btree ("owner_id","id" DESC NULLS LAST);
```

app 角色執行（`src/runtime.ts` 輸出節錄）：

```
connected as spike_app
page1 [ 't4', 't3' ] page2 [ 't2', 't1' ] createdAt is Date: true
token_hash Buffer: true 32
CHECK short token -> 23514 new row for relation "sessions" violates check constraint "sessions_token_hash_check"
CHECK upper account -> 23514 new row for relation "users" violates check constraint "users_account_check"
items after user delete (cascade): 0
refused: CREATE TABLE evil (id int) -> 42501 permission denied for schema public
refused: ALTER TABLE items ADD COLUMN evil int -> 42501 must be owner of table items
refused: DROP TABLE items -> 42501 must be owner of table items
refused: TRUNCATE items -> 42501 permission denied for table items
refused: CREATE SCHEMA evil -> 42501 permission denied for database drizzle_db
refused: SELECT * FROM drizzle.__drizzle_migrations -> 42501 permission denied for schema drizzle
```

#### Prisma（實測）

`prisma migrate dev` 在 owner（NOCREATEDB）下直接失敗（見第 2 點），所以第一份 migration 用不需要 DB 的 `migrate diff` 產生，再手加 CHECK：

```sh
cd $S/prisma
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script -o prisma/migrations/20261103000000_baseline/migration.sql
# 手動在檔尾加四條 ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)；寫 migration_lock.toml
MIGRATE_DATABASE_URL=$OWNER/prisma_db npx prisma migrate deploy
docker exec -i spike-b-pg psql -U spike_owner -d prisma_db -h 127.0.0.1 < ../pg/grant.sql
APP_DATABASE_URL=$APP/prisma_db npx tsx src/runtime.ts
```

產生的 SQL 片段：

```sql
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";
CREATE TABLE "sessions" ( "token_hash" BYTEA NOT NULL, "id" UUID NOT NULL DEFAULT uuidv7(), ... CONSTRAINT "sessions_pkey" PRIMARY KEY ("token_hash") );
CREATE INDEX "items_owner_id_id_idx" ON "items"("owner_id", "id" DESC);
ALTER TABLE "items" ADD CONSTRAINT "items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
```

app 角色執行輸出節錄：

```
connected as spike_app
page1 [ 't4', 't3' ] page2 [ 't2', 't1' ] createdAt is Date: true
token_hash type: Uint8Array 32
CHECK short token -> P2039 Database error. Code: `23514`. Message: `new row for relation "sessions" violates check constraint "sessions_token_hash_check"`
items after user delete (cascade): 0
refused: CREATE TABLE evil (id int) -> P2010 42501 Raw query failed. Code: `42501`. Message: `permission denied for schema public`
refused: ALTER TABLE items ADD COLUMN evil int -> P2010 42501 ... `must be owner of table items`
refused: DROP TABLE items -> P2010 42501 ... `must be owner of table items`
refused: TRUNCATE items -> P2010 42501 ... `permission denied for table items`
refused: CREATE SCHEMA evil -> P2010 42501 ... `permission denied for database prisma_db`
UNEXPECTED OK: SELECT count(*) FROM public._prisma_migrations rows: 1
UNEXPECTED OK: UPDATE public._prisma_migrations SET logs = 'app wrote here' rows: 1
```

**結論 1**：兩者都能產出純 SQL 檔、由 owner 套用、app 只有 DML 且 DDL 被拒（實測）。Prisma 的帳本表在 public，照 Go 版 grant 會被 app 角色讀寫（見第 2 點）。

### 2. migration 工具需要的額外權限、帳本表

| | Drizzle（drizzle-kit migrate / migrator） | Prisma（migrate dev / deploy） |
|---|---|---|
| CREATE DATABASE | 不需要（實測：owner NOCREATEDB 可 migrate） | `migrate dev` 需要建 shadow DB；owner NOCREATEDB 時失敗（實測，下方輸出）。`migrate deploy` 不需要（實測＋文件） |
| 預先建好的 shadow DB | 無此概念 | 設 `datasource.shadowDatabaseUrl` 指向 owner 擁有的空 DB 後，`migrate dev` 與 `migrate diff --from-migrations` 可用（實測）。文件：shadow DB 會被 reset，不可與主 DB 相同 |
| 帳本表 | `drizzle.__drizzle_migrations`（自己建 schema `drizzle`，需 DB 上 CREATE，owner 有） | `public._prisma_migrations` |
| 帳本擁有者 | spike_owner（實測 `\dt+ drizzle.*`） | spike_owner（實測 `\dt+`） |
| app 能否讀 | 不能：`permission denied for schema drizzle`（實測；Go 版 grant 只授權 public） | **能讀也能寫**：Go 版 `GRANT ... ON ALL TABLES IN SCHEMA public` 把它一起授權（實測 `spike_app=arwd/spike_owner`）。補 `REVOKE ALL ON public._prisma_migrations FROM spike_app` 後 app 被拒（實測 `ERROR: permission denied for table _prisma_migrations`） |
| 每檔交易 | **所有待套用 migration 包在同一個交易**（讀 0.45.4 `pg-core/dialect.js` `migrate()` 原始碼；實測 `CREATE INDEX CONCURRENTLY` → `25001 cannot run inside a transaction block`） | **不包交易**（實測：`CREATE TABLE partial_a; SELECT 1/0;` 失敗後 `partial_a` 仍存在，`_prisma_migrations.finished_at` 為空，之後 deploy 被 P3018 擋，要 `migrate resolve --rolled-back`）。所以 CONCURRENTLY 可直接寫（實測一檔一條、一檔兩條都成功），但一般 DDL 失敗會留半套 |
| 已套用 migration 被改 | **偵測不到**：改 `0000_baseline.sql`（加 `CREATE TABLE tampered`）後再 migrate → `migrated`，表沒建、也沒警告（實測）；只比 journal 時間戳 `created_at`，hash 有存但不驗證（原始碼） | `migrate dev` 偵測到並要求 reset（實測）；`migrate deploy`/`migrate status` 在 7.10.1 **沒有警告**、exit 0（實測），與文件所述「deploy 會警告」不符 |
| CLI 錯誤輸出 | `drizzle-kit migrate` 失敗時 exit 1 但**不印錯誤訊息**（實測，去 ANSI 後 log 只剩設定行）；程式化 `migrate()` 會拋出含 PG 錯誤碼的例外（實測） | 印出 P3018 與 PG 錯誤碼（實測） |

Prisma shadow 失敗輸出（實測）：

```
Error: P3014
Prisma Migrate could not create the shadow database. Please make sure the database user has permission to create databases.
Original error:
ERROR: permission denied to create database
```

對照 Go 版：Atlas 每檔一個交易、`-- atlas:txmode none` 單檔退出，`atlas.sum` 擋改動（Go 版 `migrate.go` 註解）。兩個 TS 工具都沒有完全等價：Drizzle 要另寫「migration 檔不可變」檢查（推論：Go 版已有 `make migrations-immutable` 的 git 比對可沿用）且沒有單檔退出交易的開關；Prisma 要自己在檔內寫 `BEGIN; ... COMMIT;`（推論，未測）並在 grant 步驟 REVOKE 帳本表。

### 3. Go 版 schema 表達力

| 項目 | Drizzle | Prisma |
|---|---|---|
| CHECK | `check(name, sql\`...\`)` 寫在 schema，進 generate（實測） | schema 語言**不支援**，手寫進 migration.sql（實測）；diff 會忽略它們，不會產生 DROP（實測：`migrate diff --from-migrations --to-schema` → `No difference detected.`） |
| FK ON DELETE CASCADE | `.references(..., { onDelete: "cascade" })`（實測 cascade 生效）；預設 FK 名 `items_owner_id_users_id_fk` 與 Go 不同，可用 `foreignKey({ name })` 改（推論） | `onDelete: Cascade, map: "items_owner_id_fkey"`，名稱可與 Go 相同（實測） |
| 小寫唯一 | Go 版不是 citext，是 `UNIQUE(account)` ＋ `CHECK(account = lower(account))`；兩者都照抄（實測 `Alice` → 23514）。citext 本身未測 | 同左（CHECK 走手寫 SQL） |
| bytea | 0.45.4 沒有內建 `bytea`，用 `customType`（實測，執行時是 `Buffer`）；1.0 RC 是否內建未查 | `Bytes` → `BYTEA`，執行時是 `Uint8Array`（實測） |
| timestamptz | `timestamp(..., { withTimezone: true })` → `timestamp with time zone`（實測） | `@db.Timestamptz(6)`（實測） |
| uuidv7() 預設 | `.default(sql\`uuidv7()\`)`，INSERT 時送 `default`（實測） | `@default(dbgenerated("uuidv7()"))`，INSERT 不送該欄（實測） |
| `@default(now())` | 送 `default`，由 DB 的 `now()` 產生（實測 SQL） | **由 client 產生時間並帶參數送出**（實測 SQL：`INSERT ... ("title","owner_id","created_at","updated_at") VALUES ($1,$2,$3,$4)` 帶 JS 時間）。DB 有 `DEFAULT CURRENT_TIMESTAMP`，但 Prisma Client 不用它 |
| `(owner_id, id DESC)` 索引 | `t.id.desc()` 產生 **`DESC NULLS LAST`**，與 `ORDER BY id DESC`（= NULLS FIRST）不符，**planner 多一個 Sort**（實測 EXPLAIN，下方）；改 `.desc().nullsFirst()` 後產生 `DESC NULLS FIRST`（實測 0001 migration，但它是 DROP INDEX + CREATE INDEX，非 CONCURRENTLY） | `id(sort: Desc)` → `"id" DESC`，與 Go 一致（實測） |
| 需要 raw SQL 的地方 | uuidv7 預設、CHECK 內容用 `sql` 模板；bytea 用 customType | 所有 CHECK；任何 schema 語言沒有的 DDL |

EXPLAIN（實測，drizzle_db，500 個 owner × 100 items）：

```
=== drizzle-generated index (owner_id, id DESC NULLS LAST), ORDER BY id DESC (drizzle desc())
 Limit
   ->  Sort
         Sort Key: id DESC
         ->  Index Scan using items_owner_id_id_idx on items
=== Go-style index (owner_id, id DESC), ORDER BY id DESC
 Limit
   ->  Index Scan using items_go_style on items
```

### 4. 型別化 keyset 分頁查詢與實際 SQL

手寫基準：

```sql
SELECT id, title, created_at FROM items WHERE owner_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3;
```

Drizzle（`src/queries.ts`，`where(and(eq(ownerId), lt(id, after)))...orderBy(desc(id)).limit(n)`）logger 輸出（實測）：

```
select "id", "title", "created_at" from "items" where ("items"."owner_id" = $1 and "items"."id" < $2) order by "items"."id" desc limit $3
```

與手寫一致。

Prisma `findMany({ where: { ownerId, id: { lt: after } }, orderBy: { id: "desc" }, take })`（實測）：

```
SELECT "public"."items"."id", "public"."items"."title", "public"."items"."created_at" FROM "public"."items" WHERE ("public"."items"."owner_id" = $1 AND "public"."items"."id" < $2) ORDER BY "public"."items"."id" DESC LIMIT $3 OFFSET $4   ["…","…","2","0"]
```

語意一致，多 schema 限定與 `OFFSET 0`。Prisma 內建 `cursor: { id }, skip: 1`（實測）：

```
... WHERE ("public"."items"."owner_id" = $1 AND "public"."items"."id" <= (SELECT "public"."items"."id" FROM "public"."items" WHERE ("public"."items"."id") = ($2))) ORDER BY "public"."items"."id" DESC LIMIT $3 OFFSET $4   [...,"2","1"]
```

多一個子查詢加 `OFFSET 1`；cursor 那筆被刪掉時，子查詢回 NULL，結果為空（推論，未測）。其他觀察（實測）：Prisma 的 update/delete/findUnique 帶 `AND 1=1`；`include` 關聯是兩條獨立 SELECT。兩者回傳型別都由 select 推得（`createdAt` 是 `Date`）。

### 5. Next.js standalone 執行期

`next build`（`output: "standalone"`、Next 16.4.2，不需 `serverExternalPackages` 也能 build）後量 `du -sk`（實測，`logs/sa-*.txt`）：

| 變體 | `.next/standalone` | 其中 `node_modules` | 相對 base 增加 |
|---|---|---|---|
| base（無 DB） | 41,436 KB | 40,340 KB | — |
| drizzle + pg | 41,844 KB | 40,664 KB | +408 KB（pg 系列 ~330 KB；drizzle-orm 被打包進 `.next/server`，server 目錄 +84 KB） |
| prisma + adapter-pg + pg | 47,388 KB | 46,260 KB | +5,952 KB（`@prisma/client` 5,460 KB，其中 `runtime/query_compiler_fast_bg.postgresql.wasm-base64.mjs` 4,583,037 bytes；pg 系列同左） |

- 原生引擎二進位：兩者 standalone 內除 Next 自帶 sharp 外沒有 `.node` 檔（實測 `find -name "*.node"`）。Prisma 7 改用 WASM 查詢編譯器＋driver adapter（實測檔案；文件：v7 需 driver adapter、Rust-free client）。
- 兩個 standalone server 都以 `node server.js` 啟動並以 app 角色查 PG（實測 `/api/items` 回 `{"who":{"current_user":"spike_app"},...}`；Prisma 回 `[{"current_user":"spike_app"}]`）。
- migrate 工具的容器（Go 版是獨立 migrate service）：Drizzle 可只用 `drizzle-orm/node-postgres/migrator`（runtime 已有的套件，0 額外）跑 migration（實測 `src/migrate.ts`）；Prisma 沒有程式化 migrate API，要裝 `prisma` CLI（41 MB）＋ `@prisma/engines` 的 schema-engine 原生檔（darwin-arm64 25.6 MB；Linux image 要對應平台，安裝時下載，pnpm 需 `allowBuilds` 放行 postinstall）（實測大小；Linux 部分推論）。
- build 時間未比較：三次 build 與其他工作同時跑，數字被機器負載汙染（不採用）。

### 6. testcontainers + vitest

兩邊都實測通過：PG 18 容器以 `withCopyFilesToContainer` 放入 10-roles.sh 與 secrets，initdb 階段建角色；owner migrate、跑 grant.sql、app 查詢與 DDL 被拒。

```sh
cd $S/drizzle && TESTCONTAINERS_RYUK_DISABLED=true npx vitest run test/
#  Test Files  1 passed (1)   Tests  2 passed (2)   Duration  88.74s（與 Prisma next build 同時跑，時間不可比）
cd $S/prisma && TESTCONTAINERS_RYUK_DISABLED=true npx vitest run test/
#  Test Files  1 passed (1)   Tests  2 passed (2)   Duration  35.96s
```

差異：Drizzle 在測試內呼叫 `migrate()`（同一個程序）；Prisma 要 `execFileSync("npx", ["prisma","migrate","deploy"])` 啟子程序跑 CLI（實測）。Prisma 測試第二案例斷言 app 能 `UPDATE _prisma_migrations`（記錄現況，非期望行為）。Ryuk 關閉是為了只留 `spike-b-` 前綴的容器。

---

### 對照表

| 面向 | Drizzle 0.45.4 / kit 0.31.11 | Prisma 7.10.1 |
|---|---|---|
| migration 是純 SQL、owner 套用 | 是（實測） | 是（實測） |
| app 只有 DML、DDL 被拒 | 是（實測） | 是（實測） |
| 帳本表對 app 隔離 | 預設隔離（`drizzle` schema）（實測） | 預設**不隔離**，需在 grant 加 REVOKE（實測） |
| owner 無 CREATEDB 時產生 migration | 不需要 DB（實測） | `migrate dev` 失敗；需預建 shadow DB 或改用 `migrate diff`（實測） |
| 交易語意 | 全部待套用檔一個交易；CONCURRENTLY 不可用（實測） | 不包交易；失敗留半套，要 `migrate resolve`（實測） |
| 已套用檔被改 | 不偵測（實測） | dev 偵測；deploy/status 不偵測（實測） |
| CHECK／FK／bytea／timestamptz | 都在 TS schema；bytea 要 customType；DESC 索引預設 NULLS LAST 需改（實測） | CHECK 只能手寫 SQL；其餘原生；FK 名可對齊 Go（實測） |
| 時間預設 | DB `now()`（實測） | client 時間（實測） |
| keyset 查詢 SQL | 與手寫一致（實測） | 等價，多 `OFFSET 0`；內建 cursor 多子查詢（實測） |
| standalone 增量 | +408 KB（實測） | +5.95 MB（WASM 4.6 MB）（實測） |
| 原生二進位 | 執行期無；migrate 無（實測） | 執行期無（實測）；migrate 需 schema-engine 25.6 MB（實測 darwin） |
| testcontainers + vitest | 程式化 migrate，可行（實測） | CLI 子程序 migrate，可行（實測） |

### 事實對 D1 敘述的取捨

- D1-A 宣稱「寫法接近 SQL、沒有額外引擎、migration 是 SQL 檔、可照 Go 版檢查」：前三點實測成立；「照 Go 版檢查」只部分成立——SQL 檔可以跑 squawk（推論），但沒有 atlas.sum 等價物（改動不偵測）、也沒有每檔交易／`txmode none`，CONCURRENTLY 索引要另想辦法（例如那一步在 migrator 外跑）。另有 `DESC NULLS LAST` 這個實測到的效能陷阱。
- D1-B 宣稱「查詢較不透明，複雜查詢要退回 raw SQL」：本 spike 的 keyset 查詢不需 raw SQL，SQL 可讀；但 schema 端 CHECK 一律要 raw SQL，`now()` 由 client 產生、帳本表在 public、`migrate dev` 需 CREATEDB 或預建 shadow DB、migration 不包交易，這些是 D1-B 敘述沒寫到、要另外處理的偏離（實測）。
- 以「app 只有 DML、owner migrate」這條不變式和「照 Go 版的 migration 檢查」來看，事實較偏向 A（Drizzle）：要補的是 immutability 檢查與 NULLS FIRST 慣例；B 要補的是 REVOKE 帳本、shadow DB 流程、CHECK 手寫、每檔交易。最終由 Will 決定。

### 剩餘不確定

- Drizzle 1.0 RC（migrator 改版、內建 bytea、可能的每檔交易）未測；若 D1 選 A，要決定釘 0.45 或等 1.0。
- Prisma 在 migration 檔內手寫 `BEGIN/COMMIT` 是否被正確處理：未測。
- Go 版 Atlas 的 `atlas_schema_revisions` 是否被 app 讀到：未查（只比較了 TS 兩案）。
- Prisma schema-engine 在 Linux musl/glibc image 的下載與大小：未測。
- 兩者 unique 違反錯誤（P2002 vs PG 23505）在 Server Action 的對應：未測。

### 文件來源（查詢日期 2026-11-03）

- Prisma shadow database：https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/shadow-database （PostgreSQL 需 superuser 或 CREATEDB；`shadowDatabaseUrl` 放在 `prisma.config.ts` 的 `datasource`；`migrate deploy`/`resolve` 不用 shadow）
- Prisma migration histories：https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/migration-histories （文件稱 deploy 會警告已修改的 migration；7.10.1 實測未出現）
- Prisma v7 升級：https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7 （所有 DB 需 driver adapter、Rust-free client、generator `output` 必填）
- Drizzle config：https://orm.drizzle.team/docs/drizzle-config-file （`migrations.table`／`migrations.schema` 可改，預設 `__drizzle_migrations` 於 `drizzle` schema）
- 原始碼：`drizzle/node_modules/drizzle-orm/pg-core/dialect.js` `migrate()`（0.45.4）。

## Spike 0 (c)：Next.js 16 standalone 放進 Docker，接 Go 版 compose 與 Caddy

日期 2026-11-03。環境：macOS arm64、Docker 29.1.3、Compose v5.0.0、next 16.4.3（16.4.4 發佈未滿 1 天，被 `minimumReleaseAge: 1440` 擋下）、react 19.3.1、pnpm 12.15.0、node:26.11.1-slim／alpine、postgres:18.6、caddy:2.11.7（後兩者與 Go 版同一個 digest）。
標記：**實測** = 本 spike 跑出來；**推論** = 讀文件或原始碼得出，沒有實際跑過。

結論（給 D5）：選項 A 可行，沒有阻擋因素。Go 版的拓撲可以直接沿用，只要把 backend 和 frontend 兩個服務合併成一個 `app`。有一項發現會影響步驟 1 的設計：**開啟 `cacheComponents`（PPR）時，nonce CSP 會失效**（實測 18 個 script 只有 9 個帶 nonce）。

### 檔案（都在本目錄）

- `app/`：最小 Next 應用。`src/proxy.ts`（CSP nonce，政策與 Go 版 `frontend/src/proxy.ts` 相同）、`src/app/page.tsx`（`connection()` 放在 `<Suspense>` 內，加一個 client component）、`src/app/api/health/route.ts`（以 app role 查 `spike_items`）、`src/app/api/slow/route.ts`（睡 8 秒，用來測 shutdown）、`next.config.ts`（`output: "standalone"`；`SPIKE_CACHE_COMPONENTS=1` 時開 `cacheComponents`）、`Dockerfile`。
- `docker-compose.yml`：postgres、migrate（用 psql 暫代 D1 的工具，以 owner role 執行）、app、caddy；project 名稱 `spike-c`；port 18080/18443。
- `Caddyfile`、`migrate.sql`、`compose.keepalive.yml`、`deploy/postgres/initdb/10-roles.sh`（從 Go 版原樣複製）、`.secrets/`（一次性的 `openssl rand` 密碼）。
- 原始輸出：`build-slim.log`、`build-cc.log`、`page.headers`／`page.html`、`cc.headers`／`cc.html`。

重跑方式：`cd <本目錄> && docker compose up -d --build --wait`，然後執行下面各段的 curl。收尾：`docker compose down -v && docker image rm spike-c-app`。

### 1. Image：standalone、multi-stage、pnpm、non-root

Dockerfile 的 stage 結構和 Go 版 `frontend/Dockerfile` 相同：base → pnpm（用 npm 依 `packageManager` 安裝 pnpm）→ deps（`pnpm install --frozen-lockfile`）→ builder（`pnpm build`）→ runner（只複製 `public`、`.next/standalone`、`.next/static`，以 `USER 1001:1001` 執行，`CMD ["node","server.js"]`）。

- **實測** build 成功，route 表如下：
  ```
  Route (app)
  ┌ ƒ /
  ├ ○ /_not-found
  ├ ƒ /api/health
  └ ƒ /api/slow
  ƒ Proxy (Middleware)
  ```
  `/api/health` 沒有加 `connection()` 也是 ƒ（dynamic），所以 build 時不會去連 DB。
- **實測** image 大小：slim **310MB**、alpine **219MB**。runner 層裡 standalone 只有 37.2MB，`.next/static` 571kB；node 執行檔本身 144MB（slim）／141MB（alpine）。差距約 90MB，來自 Debian 與 Alpine 的基礎系統。
- **實測** standalone 的 `node_modules` 只追蹤到 `next`、`pg`、`react`、`react-dom`，`pg` 會自動被追蹤進來。
- **實測** `id` → `uid=1001(nextjs) gid=1001(nodejs)`，alpine 版一樣；alpine 版頁面也回 200，libc 是 `musl libc (aarch64)`。
- **建議用 slim（推論）**：
  - Go 版已經用 `node:26.11.1-slim`，Next 官方的 with-docker 範例也用 `-slim`（"uses Node.js 24.13.0-slim"）。
  - 步驟 2 要用的 `@node-rs/argon2`、選用的 `sharp` 都是原生模組，glibc 是主要支援的目標；Node 官方對 alpine 版的說明是「musl，可能有相容問題」（https://github.com/nodejs/docker-node#nodealpine ）。
  - 省下的 90MB 對單台 VPS 影響不大。
  - 步驟 0 (a) 會實測 argon2 在 standalone 裡能不能載入，那時才是 alpine 的最終判定點。
- **實測** hadolint（Go 版的 `bin/hadolint`）只對本 spike 為了切換 slim/alpine 寫的 `adduser` 判斷行報 DL4006；正式版只有一種 base，照 Go 版寫法就不會出現。

### 2. Compose + Caddy，經 Caddy curl

Caddyfile 和 Go 版的差異：只剩一個 upstream，所以不需要拆 `handle /api/*`，整站 `reverse_proxy app:3000`，保留 `lb_try_duration 10s`、HSTS 和 `header_up X-Request-ID {http.request.uuid}`。

注意（推論）：Go 版會覆寫 X-Request-ID，是因為 backend 信任 `TRUSTED_PROXIES` 送來的值。Next 沒有對應機制；步驟 0 (a) 處理 client IP 時要一起決定 Next 這邊怎麼讀 `X-Forwarded-For`。Go 版 compose 裡固定 Caddy IP（172.30.0.2）、`TRUSTED_PROXIES` 的設計，屆時會從 backend 移到 app。

**實測** `docker compose up -d --wait`：postgres healthy → migrate `Exited (0)` → app healthy → caddy。

```
$ curl -sS -D - http://localhost:18080/api/health
HTTP/1.1 200 OK
Content-Type: application/json
Permissions-Policy: camera=(), microphone=(), geolocation=()
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
Via: 1.1 Caddy
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Transfer-Encoding: chunked

{"status":"ok","db":"ok","items":1}

$ curl -sS -D - -o page.html http://localhost:18080/
HTTP/1.1 200 OK
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-NzBlMGZkYjYtYjJlZC00YWNiLTliYzYtZTUwYTQzYzlhNDBm' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Content-Type: text/html; charset=utf-8
Permissions-Policy: camera=(), microphone=(), geolocation=()
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
Via: 1.1 Caddy
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Powered-By: Next.js
```

- **實測** 第二次請求的 nonce 不同（`NTJmMWU4…`）。
- **實測** 頁面 `<script>` 共 14 個，**14 個都帶本次請求的 nonce**（`grep -o "<script[^>]*nonce=\"$nonce\""`）。
- **實測** HTTPS：用 `SITE_ADDRESS=localhost` 讓 Caddy 以內部 CA 簽憑證，`curl -k https://localhost:18443/` 回 `HTTP/2 200`，帶 `alt-svc: h3`、`strict-transport-security`、CSP（nonce）；http 回 `308 → https`。
- 步驟 1 要處理的兩點：
  - `X-Powered-By: Next.js` 預設會送出，要設 `poweredByHeader: false`（推論，Next 設定項）。
  - `/api/health` 沒有 `Cache-Control`。
- **實測（關鍵）cacheComponents + nonce 互斥**：同一份程式開 `cacheComponents: true` 後，`/` 變成 `◐ (Partial Prerender)`。response 有 CSP nonce，但頁面 **18 個 script 只有 9 個帶 nonce**；沒帶的是靜態 shell 的 `/_next/static/chunks/*.js`。在 `'strict-dynamic'` 下，這些沒帶 nonce 的 script 會被擋，頁面不會 hydrate（後果見 wiki `nextjs-csp-nonce-hydration`）。官方文件也寫 "Partial Prerendering (PPR) is incompatible with nonce-based CSP"。步驟 1 只能三選一：不開 cacheComponents（Go 版現況）、改用 `'unsafe-inline'`、或改用實驗性的 SRI。

### 3. 環境變數：build-time 與 runtime；同一個 image 能否跨環境

- **實測**：build arg `NEXT_PUBLIC_APP_URL=https://build-time.example`，runtime env `NEXT_PUBLIC_APP_URL=https://runtime.example`、`SPIKE_RUNTIME=runtime-value`。頁面輸出 `public url: https://build-time.example | server env: runtime-value`。
  - 即使是在 dynamic server component 裡讀，`NEXT_PUBLIC_*` 拿到的也是 build 時寫死的值，runtime env 對它無效。
  - 非 `NEXT_PUBLIC_` 的變數在 dynamic render 時讀 runtime 值。
- 結論（實測加文件）：同一個 image 能跨環境推廣（promote），條件有兩個：
  - 不使用會隨環境改變的 `NEXT_PUBLIC_*`；
  - 會隨環境改變的值只在 server 端、dynamic render 時讀（文件原文："This allows you to use a singular Docker image that can be promoted through multiple environments"）。
  - Go 版 frontend 的 `NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:-}` 只放在 compose runtime env，依本實測對 client bundle 不生效（推論：Go 版若真的有用到它，這是一個既有缺陷，值得另外查）。
- 推論：DB 密碼照 Go 版寫法用 `*_FILE` + compose secrets，**實測**能讀到（health 回 db ok）。

### 4. 靜態資源

- **實測** standalone 不會自動帶 `public/` 和 `.next/static`。把兩者刪掉後執行：chunk **404**、`/logo.svg` **404**，頁面本身 200（HTML 能出來，JS 和圖全壞）。所以兩個 `COPY` 一定要有，和 Go 版相同。
- **實測** 經 Caddy 的快取標頭：
  - `/_next/static/chunks/*.js` → `Cache-Control: public, max-age=31536000, immutable`，`Content-Encoding: gzip`（Next 自己壓縮，Caddy 沒設 `encode`）；
  - `/logo.svg`（public）→ `Cache-Control: public, max-age=0` 加 ETag；
  - dynamic 頁 → `private, no-cache, no-store, max-age=0, must-revalidate`。
  - Caddy 不需要額外設定快取。
- 推論：dynamic 頁沒有 Content-Length（實測為 `Transfer-Encoding: chunked`），依 Caddy 文件這種回應會立即 flush，所以 streaming 和 Suspense 經 Caddy 不會被緩衝；不需要 nginx 那種 `X-Accel-Buffering`。沒有用延遲 Suspense 實測逐塊到達。

### 5. Graceful shutdown 與 healthcheck

- **實測**：PID 1 是 `next-server`。node image 的 `docker-entrypoint.sh` 用 `exec "$@"` 把 PID 1 交給 node，所以不需要 tini。`SigCgt` 顯示 PID 1 有接 SIGTERM 和 SIGINT。
- **推論（讀 `next/dist/server/lib/start-server.js`）**：
  - 收到 SIGTERM 後依序執行 `server.close()`（停止接受新連線、等進行中的請求）、`nextServer.close()`，最後 `process.exit(143)`；
  - 設 `NEXT_MANUAL_SIG_HANDLE` 可以關掉這個行為；
  - **沒有上限時間**，和 Go D8 的「Shutdown 上限 30s」不同，Next 的上限只能靠 compose `stop_grace_period` 之後的 SIGKILL。
- **實測**（經 Caddy 發 8 秒的請求，1 秒後 `docker compose stop app`，`stop_grace_period: 35s`）：

  | 次 | SIGTERM→退出 | 請求完成 | 結果 |
  |---|---|---|---|
  | 1 | 13s | +7s | 200、exit 143 |
  | 2 | 16s | +8s | 200、exit 143 |
  | 3（`KEEP_ALIVE_TIMEOUT=20000`） | 29s | +7s | 200 |
  | 閒置、沒有流量 | 0s | — | — |
  | 剛經 Caddy 打過一頁 | 2s | — | — |

- 解讀（實測）：進行中的請求會做完。請求做完後，Caddy 對 upstream 保持的 keep-alive 連線讓 `server.close()` 一直等到 keep-alive 逾時才結束（預設約 5 秒，調成 20 秒就多等約 20 秒）。
- 對照 D8（推論）：
  - 「不做 readiness drain、靠 `lb_try_duration`」的理由對 Next 單一實例同樣成立；
  - `stop_grace_period: 35s` 仍然合適，前提是 `KEEP_ALIVE_TIMEOUT` 不調大，而且沒有超過約 28 秒的請求；
  - 若要和 Go 一樣有程式內的 30 秒上限，需要 `NEXT_MANUAL_SIG_HANDLE` 加自寫 handler，不建議為此自寫。
- **實測** compose healthcheck：`["CMD","node","-e","fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]`。不需要 curl 或 wget（slim 沒有），caddy 用 `depends_on: app: service_healthy` 正常啟動。
  - Go 版 frontend Dockerfile 的 `HEALTHCHECK` 打 `/`；改打 `/api/health` 才能反映 DB 狀態。
  - 推論：health 要不要查 DB（readiness），或只回 200（liveness），步驟 1 要決定；Go 版用的是 `/health/ready`。

### 6. Go CI stack job 目前做什麼，這個拓撲要改什麼（只列不做）

Go 版 `.github/workflows/ci.yml` 的 `stack` job 目前做的事：
1. `make lint-docker`：hadolint 檢查 backend 和 frontend 的 Dockerfile；
2. `make init-env`：產生 `.env` 和 `.secrets/`；
3. `docker compose config` 加 jq 斷言：backend 只拿到 `db_app_password`，migrate 只拿到 `db_owner_password`，frontend 沒有 secrets 也沒有 `DATABASE|MIGRATE|POSTGRES|DB_` 開頭的 env；
4. 每個服務都設了 log rotation；
5. 只有 caddy 發佈 port；
6. `docker compose up -d --build --wait`；
7. migrate exit 0，`backend app healthcheck` 成功；
8. 經 Caddy：`/api/users/me` 回 401、`/en/login` 回 200、client 自帶的 X-Request-ID 不會被傳下去；
9. app role 執行 `CREATE TABLE intruder` 會得到 `permission denied for schema public`；
10. 失敗時印 `docker compose logs`。

要改的：
- (1) hadolint 只檢查一個 Dockerfile。
- (2) `init_env.py` 拿掉 backend 專屬的變數。
- (3) 斷言改成「`app` 只拿到 `db_app_password`、migrate 只拿到 owner」。「frontend 不得有 DB env」這條要刪：現在 app 本身就要連 DB。
- (7) migrate 改用 D1 的工具；`backend app healthcheck` 換成 `docker compose exec -T app node -e "fetch(...)"`，或直接依賴 `--wait` 的 healthcheck。
- (8) `/api/users/me` 回 401 改成 `/api/health` 回 200（步驟 1 驗收），之後再加步驟 0 (a) 的 harness；X-Request-ID 檢查要看 Next 是否用到它，不用就刪，用的話保留。
- (9) 角色名換成 `template_nextjs_app`／`template_nextjs`（plan 步驟 1 已寫）。
- 新增：`docker compose config` 斷言 app 沒有 owner 密碼；確認 image 以非 root 執行（`docker compose exec app id -u` 不是 0）。
- 可選：用 `grep -o nonce` 斷言頁面上每個 script 都帶 nonce（這次實測的方法，不需要瀏覽器）。
- gate 的 `needs` 照 plan 改成 app、policy、rename、stack。

### 7. D5 選項 B（Vercel + 託管 PG）：只列和 A 不同的事實

- **多實例（文件加推論）**：Fluid compute 是 "Dynamic scaling" 加單一實例內並行；程序記憶體不會跨實例共享。所以 D7 的「限流存記憶體」失效（plan 已寫 D5=B 時重開 D7）。Next 自架文件列出的多實例要件（`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`、`deploymentId`、共用 cache handler）在 Vercel 上由平台處理（推論，未查 Vercel 端文件逐條確認）。
- **沒有 compose 和 Caddy**：CSP 和 HSTS 都改在 Next（proxy 或 `headers()`）設定；client IP 來自 Vercel 的標頭，步驟 0 (a) 的 trusted-proxy 設計要另做（推論）。
- **環境變數（文件）**："Any change you make to environment variables are not applied to previous deployments, they only apply to new deployments"。每個環境各自 build，`NEXT_PUBLIC_*` 可以依環境不同；沒有「同一個 image 推廣」的概念，CI stack job 這類 compose 驗證也不適用。
- **DB 角色分離（推論）**：migration 需要 owner 憑證。如果在 Vercel build step 跑，owner 密碼就要放進 Vercel 的環境變數；比較好的做法是在 GitHub Actions 用 owner 跑 migration，Vercel 只放 app role 的連線字串。託管 PG（Neon、Supabase 等）能不能建立 NOSUPERUSER 的 owner／app 兩個角色，並照 `10-roles.sh` 收權限，要看各家規格，未查證。連線數：多實例要用 pooler（推論）。
- **Graceful shutdown**：平台管理，§5 不適用。

### 官方文件（查詢日 2026-11-03）

- Next.js Self-Hosting（lastUpdated 2026-10-15）：https://nextjs.org/docs/app/guides/self-hosting
- Next.js `output`（2026-09-18）：https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Next.js `proxy.js`（2026-09-04；"v16.0.0 Middleware is deprecated and renamed to Proxy. Proxy defaults to the Node.js runtime"）：https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- Next.js CSP（2026-03-20）：https://nextjs.org/docs/app/guides/content-security-policy
- Next.js Deploying（2026-08-06）：https://nextjs.org/docs/app/getting-started/deploying ；with-docker 範例：https://github.com/vercel/next.js/tree/canary/examples/with-docker
- Caddy `reverse_proxy`（`flush_interval`、`lb_try_duration`）：https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Vercel Fluid compute（2026-08-24）：https://vercel.com/docs/fluid-compute ；Vercel Environment variables（2026-09-17）：https://vercel.com/docs/environment-variables

### 尚未確定的事

- Streaming 經 Caddy 逐塊到達：只有推論，沒有用延遲的 Suspense 實測。
- 只在 arm64 上跑過；CI 是 amd64，沒有跑。
- alpine 與原生模組（argon2）的相容性，留給 0 (a)。
- 經 Caddy 的 Server Action POST 和偽造 `X-Forwarded-Host`，屬於 0 (a) 的範圍，本 spike 沒有測。
- Docker buildkit cache 中 node base image 的層沒有清（`docker builder prune` 會影響其他專案）；postgres 和 caddy 的 image 可能本來就在機器上，沒有刪。

