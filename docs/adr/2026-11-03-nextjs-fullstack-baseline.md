---
title: Next.js 全端基準：Drizzle、只用 Server Actions、精簡功能、Compose 加 Caddy、垂直切片
date: 2026-11-03
review-date: 2027-05-03
status: active
tags: [decision, nextjs, drizzle, server-actions, deploy, architecture]
related-commits: [ffc08b5, 962a293, 4dee799, 97cb3a6, d0ef4fc]
---

# Next.js 全端基準：Drizzle、只用 Server Actions、精簡功能、Compose 加 Caddy、垂直切片

## Context

只用 Next.js 做全端（沒有另一個後端程序）的專案起點。同系列另有 Go 與 FastAPI 後端的版本，三者不共用程式碼，但工具鏈、CI、安全設定與 `docs/rules/` 沿用 Go 版。

**約束**：

- `inherited`：與 Go 版的 migration 檢查（已套用的 migration 不能改、squawk、角色權限斷言）一致。仍成立：這些檢查守的是正式資料，與語言無關。
- `inherited`：單一實例。認證的節流狀態存在程序記憶體（[認證 ADR](2026-11-03-auth-and-sign-in-throttling.md) D2），只有一個 Next 程序時才正確。
- `external`：Next.js 的 Server Component 不能寫 cookie；`cacheComponents` 預先渲染的外殼不帶請求的 CSP nonce（實測頁面不會 hydrate）。

## Options Considered

- **D1 資料存取**：A Drizzle 加 drizzle-kit（選用，基準之一：寫法接近 SQL、migration 是 SQL 檔）；B Prisma（[Next.js 文件](https://nextjs.org/docs/app/getting-started/fetching-data) 常見的組合，生態最大，schema 用自己的 DSL，查詢較不透明）；C Kysely 加另選的 migration 工具。
- **D2 對外 API**：A 只用 Server Actions，Route Handler 只留必要的（選用，Next.js 全端的基準做法）；B Route Handlers 提供 REST 加 OpenAPI，畫面也走它（與另兩個版本的契約一致，多一層）。
- **D3 功能範圍**：A 精簡：認證加 items（選用）；B 與 Go 版相同，含帳號濫用防護與 admin。
- **D4 部署**：A Docker Compose 加 Caddy，自己的 VPS（選用）；B Vercel 加託管 PostgreSQL（Next.js 的主流部署）。
- **D5 原始碼結構**：A 沿用 Go 版前端分層再加橫向 `src/server/`；B 每個 feature 是垂直切片，自己擁有 `schema.ts`、`server/`、`actions.ts`、元件（選用；對應 bulletproof-react、Feature-Sliced Design 的 feature 切片）；C 照 Next 文件用單一 `data/` 加集中 schema。

## Decision

- **D1**：Drizzle 加 drizzle-kit。補上 Drizzle 沒有的：已套用 migration 的改動偵測（`scripts/check_migrations.py`，仿 Go 版 `atlas.sum`）；所有待套用 migration 在同一交易，所以不能用 `CREATE INDEX CONCURRENTLY`。
- **D2**：只用 Server Actions。Route Handler 只有 `/api/health`，以及清掉失效 session cookie 再導回登入頁的 GET（Server Component 不能寫 cookie）。
- **D3**：認證（註冊、登入、登出、裝置清單）加 items。帳號層級的節流與鎖定、trusted device、admin 延後。
- **D4**：Compose 加 Caddy，只有 caddy 發佈 port；image 用 `node:*-slim`、standalone、非 root；`poweredByHeader: false`；`stop_grace_period: 35s`；`cacheComponents` 不開。
- **D5**：垂直切片。依賴方向由 `.dependency-cruiser.cjs` 檢查，零例外（規則表在 `AGENTS.md`）：無環；共用層不 import feature；`src/server/` 只 import `lib/`；feature 之間只經 `index.ts`、`server.ts`、`schema.ts`；資料庫只在 `features/*/server/**`、`src/server/**` 與 health route 使用；會到瀏覽器的程式碼不 import 伺服器模組。action 一律用 `authedAction`／`publicAction` 定義，DAL 第一個參數是 `Viewer`。

## Rationale

- **D1**：Drizzle 的 migration 是普通 SQL 檔，Go 版的檢查（squawk、改動偵測、角色斷言）可以原樣套上；Prisma 的 DSL 與引擎讓這些檢查要重做，複雜查詢還是要退回 raw SQL。Kysely 要另選 migration 工具，等於多一個決定。代價：Drizzle 缺的改動偵測要自己維護。
- **D2**：畫面是唯一的呼叫端時，REST 層只是多一層要維護的契約。代價：沒有給行動 App 或第三方的 API，需要時再加 Route Handler。
- **D3**：Next.js 全端範本多半用在較小的專案。完整的帳號濫用防護約等於認證加 items 的工作量。代價：與 Go 版功能不對等，延後項有觸發條件（見 Revocation Triggers）。
- **D4**：沿用 Go 版的部署文件與 CI 的 compose stack job，資料庫角色分離（owner、app）照舊。Vercel 是多實例，記憶體節流會失效（約束 2），DB 角色分離也要另外設定。代價：要自己管機器。
- **D5**：Go 版前端的分層來自「後端是另一個程序」，只有 Next 時不存在；橫向 `src/server/` 會讓每個功能拆成兩棵樹。單一 `data/` 在功能變多後，data、actions、元件分散三處。切片讓一個功能的改動留在一個目錄。代價：跨 feature 的 join 要經對方的 `server.ts`。

## Expected Outcome

- `pnpm check:migrations` 擋下對已套用 migration 的修改；`pnpm check:arch` 擋下違反依賴方向的 import（`src/__tests__/architecture.test.ts` 故意違規並確認被報出）。
- CI 的 compose stack job：只有 caddy 發佈 port，health 200，每個 script 都帶 nonce，app 角色做 DDL 被拒。

## Revocation Triggers

- 需要第二個 Next 實例或改上 Vercel → 先把節流狀態移到資料庫（認證 ADR D2），再重評 D4。
- 行動 App 或第三方要用 API → 為那些操作加 Route Handler，重評 D2。
- 衍生專案要帳號鎖定、trusted device 或 admin → 照 Go 版的帳號濫用 ADR 補做 D3 延後的部分。
- 兩個 feature 需要互相 join 資料表 → 經對方 `server.ts` 取資料；做不到時重評 D5 的邊界。
- 要開 `cacheComponents` → 先決定 CSP 怎麼處理 nonce。

## Related

- [認證與登入節流](2026-11-03-auth-and-sign-in-throttling.md)
- 規則：`docs/rules/database-design.md`、`AGENTS.md`（依賴方向表）。
