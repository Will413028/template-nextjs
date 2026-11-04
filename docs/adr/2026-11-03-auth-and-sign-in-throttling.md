---
title: 認證自建 opaque session，登入節流依「帳號＋來源」存記憶體並設上限
date: 2026-11-03
review-date: 2027-05-03
status: active
tags: [decision, auth, session, throttle, security]
related-commits: [9eee0b0, b15744e, a0d6baa, 26acab2, dc20c63, 5ef66dc, 711887f, 537118f]
---

# 認證自建 opaque session，登入節流依「帳號＋來源」存記憶體並設上限

## Context

帳號密碼登入、伺服器端 session。Go 版範本已自建 opaque session 並有完整測試，它的 API 與認證 ADR 是本 repo 認證行為的規格。

**約束**：

- `inherited`：三個範本的認證行為一致（cookie、密碼規則、節流、錯誤）。仍成立：Will 要求三者可以互相替換使用。
- `inherited`：單一 Next 程序（[全端基準](2026-11-03-nextjs-fullstack-baseline.md) D4）。
- `external`：只依帳號節流會讓任何人把本人鎖在門外（Go 版 2026-10-22 的修訂理由）。
- `external`：一個 IPv6 /48 有 65,536 個 /64 來源。實測每組「帳號＋來源」計數約 165–333 bytes，一個來源一天最多約 7,200 組；不設上限時，一個 /48 一天可耗掉上百 GB，程序會 OOM。

## Options Considered

- **D1 認證實作**：A Better Auth（基準：Next.js 生態目前主流的自架認證庫，內建 DB session、節流與 admin 外掛）；B 照 Go 版 ADR 自建 opaque session（選用）；C Auth.js（帳號密碼不是它的主要情境）。
- **D2 登入節流範圍**：A per-IP 限流加「帳號＋來源」退避（來源是 IP，IPv6 取 /64），存程序記憶體（選用）；B 只做 per-IP 限流；C 照 Go 版完整做，含資料庫的節流表、帳號層級上限與裝置 cookie。
- **D3 記憶體計數的上限**：A 不設；B 滿了不記新組合但放行；C 滿了拒絕新組合的登入；D 滿了淘汰最舊、失敗少於 5 次的組合，全在退避中才放行不記（選用）。

## Decision

- **D1**：自建 opaque session，以 Go 版 ADR 與測試為準。Next.js 機制不同的地方逐條接受為偏離：
  1. CSRF：`src/proxy.ts` 照 Go `CrossOriginProtection` 的順序做 Fetch Metadata 檢查，跨來源回 403；Next 內建的 Origin 檢查留作第二層。
  2. client IP：preload（`node -r peer.cjs`）記下真實的連線來源，沿用 Go 的 `TRUSTED_PROXIES` 演算法。
  3. 失效 cookie：頁面讀到失效 session 時導到清 cookie 的 Route Handler；action 與登出直接清。
  4. access log 由 Caddy 記；未捕捉錯誤由 `src/instrumentation.ts` 的 `onRequestError` 記成一行 JSON，帶 request id，不帶錯誤訊息。
  5. 請求主體上限用 `serverActions.bodySizeLimit`，回應不是 413 problem；慢速標頭攻擊交給 Caddy。
  6. 契約的唯一來源是 zod schema，不是 OpenAPI。
  7. 登入成功只清這次來源的計數（Go 全清，搭配它的帳號層級上限；這裡沒有上限，全清會讓本人每登入一次就重置攻擊者的退避）。
  8. 密碼最少 15 字元以 NFKC 正規化後的長度計（最多 128 仍算原始輸入）。
  9. 沒有 session 時登出回 `unauthenticated`（Go 回 204），帶著失效 cookie 時一樣清掉。
- **D2**：A。
- **D3**：D，上限 10 萬組（`src/features/auth/server/throttle.ts` 的 `MAX_ENTRIES`）。失敗達 5 次的組合不淘汰，只由每日清理移除。可淘汰的組合用雙向鏈結串列排序，淘汰是 O(1)。全在退避中時新組合放行不計，記 `auth.sign_in_throttle_full`（一分鐘最多一筆，帶 `uncounted`）。

## Rationale

- **D1**：Better Auth 的 cookie 名稱、節流規則與 Go 版 ADR 不同，每一處都要逐條接受，三個範本就不再一致。自建的代價是自己維護安全關鍵的程式碼，業界一般不建議；這裡由移植 Go 版的測試案例（client IP、密碼、節流、跨來源）守住，升級 Node 或 Next 時 preload 改寫 Node 內部方法的風險也由它們抓。
- **D2**：B 偏離 Go 版的基線，範本出貨時就沒有針對帳號的暴力破解防護。C 把延後的帳號濫用防護（全端基準 D3）拉回來。A 的程式量小、不會讓別人把本人鎖在外面；代價是只在單一程序成立。
- **D3**：A 會 OOM。C 讓攻擊者灌滿後，從沒失敗過的使用者全登不進去。B 灌滿後所有新組合都沒有退避。D 不淘汰退避中的計數，所以淘汰最多清掉 4 次以內的部分計數；能灌滿 10 萬組的攻擊者本來就有上萬個來源，每個各有 4 次免費嘗試，淘汰沒有給他更多。用 `Map` 的插入順序淘汰時，V8 刪掉的 entry 會留空位，實測 2 萬次淘汰 4.2 秒，所以改用鏈結串列。代價：攻擊者用約 50 萬次失敗嘗試讓 10 萬組進入退避後，到每日清理前，新來源對同一帳號只剩 per-IP 上限（每分鐘 5 次），沒有指數退避。

## Expected Outcome

- 上限時記憶體約 17–28 MB；淘汰每次 2–18 µs，不隨次數變慢；清理 10 萬筆 0.4 秒（tsx 實測）。
- 跨來源的 POST 在 proxy 回 403；失效 cookie 讀頁面後被清掉並導回登入頁。

## Revocation Triggers

- 多實例或改上 Vercel → 節流移到資料庫（Go 版的節流表），D2、D3 一起重開。
- 要帳號層級上限、鎖定或 trusted device → 照 Go 版帳號濫用 ADR 補做；那時登入成功的清除範圍（偏離 7）也要重看。
- 清理過期 session 與節流計數的每小時計時器，在程序第一次用到認證時才啟動（`src/features/auth/server/runtime.ts`）：重啟後沒有任何認證請求時，過期 session 留在表裡，但它們已經不能用（讀取時檢查期限）。要讓沒有流量的程序也清理時，改在 `instrumentation.ts` 的 `register` 啟動。
- 日誌出現 `auth.sign_in_throttle_full` → 評估帳號層級上限是否要提前。
- 出現符合本 repo 規格、維護活躍的認證庫，且 Go 版也改用相同行為 → 重評 D1。

## Related

- [全端基準](2026-11-03-nextjs-fullstack-baseline.md)
- 規格：template-go-nextjs `docs/adr/2026-10-18-api-and-auth-baseline.md`、`docs/adr/2026-10-22-account-abuse-and-lifecycle.md`（[GitHub](https://github.com/Will413028/template-go-nextjs/tree/dev/docs/adr)）。
