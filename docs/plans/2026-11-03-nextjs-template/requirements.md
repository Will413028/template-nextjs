# 附件：需求清單

## 需求來源

- S1（Will，2026-11-03 對話）：「我還想要有……next.js 全端的 template」。
- S2（同日對話結論）：三個 template 各自獨立成 repo；工具鏈、CI、安全設定與 `docs/rules/` 沿用 Go 版；clone 後跑 rename 腳本產生衍生專案。
- S3（規格參考，不是需求來源）：`template-go-nextjs@560106d` 的功能，見 `.projects/personal/template-fastapi-nextjs/docs/plans/2026-11-03-fastapi-template/inventory.md`。S1 沒說要和 Go 版功能相同，所以每項從 S3 帶來的需求都標「推論」，範圍由 D4 決定。

## 畫面（來源 S3，推論；Go 版 `frontend/src/app/[locale]/`）

| # | 項目 | 來源 | 步驟 | 狀態 |
|---|---|---|---|---|---|
| U1 | 行銷首頁 `(marketing)` | S3 推論 | 1 | 完成 |
| U2 | 註冊、登入 `(auth)/register`、`(auth)/login` | S3 推論 | 2 | 完成 |
| U3 | dashboard overview、settings（含登入中裝置列表與撤銷） | S3 推論 | 2 | 完成 |
| U4 | items 列表與編輯（Go 版前端沒有 items 畫面，只有 API） | 推論 | 3（依 D4） | 完成 |
| U5 | admin 使用者管理畫面（Go 版沒有這個畫面） | 推論 | — | 不做 |
| U6 | i18n（en、zh-TW，next-intl）、CSP nonce、錯誤頁 | S3 推論 | 1 | 完成 |

## 資料實體（來源 S3，推論；Go 版 `backend/migrations/`）

| # | 實體 | 來源 | 步驟 | 狀態 |
|---|---|---|---|
| E1 | users | S3 推論 | 2 | 完成 |
| E2 | sessions | S3 推論 | 2（D2：自建） | 完成 |
| E3 | items | S3 推論 | 3 | 完成 |
| E4 | sign_in_throttles、trusted_devices、audit_events | S3 推論 | 4（依 D4） | 延後 |

## 流程（來源 S3，推論）

| # | 流程 | 步驟 | 狀態 |
|---|---|---|---|
| F1 | 註冊 → 登入 → 讀自己 → 登出 | 2 | 完成 |
| F2 | 撤銷其他 session、刪除帳號 | 2 | 完成 |
| F3 | items 建立、列表（keyset 分頁）、修改、刪除，只能存取自己的 | 3 | 完成 |
| F4 | 依帳號節流、登入鎖定、trusted device、HIBP 密碼檢查、稽核紀錄 | 4（依 D4） | 延後 |
| F5 | admin：列出、停用、刪除使用者，解除鎖定；`recover-admin` 命令 | 4（依 D4） | 延後 |
| F6 | `make new NAME=x DEST=<目錄>` 產生衍生專案（D10；原為 `make rename`，步驟 5 完成後被取代） | 5b | 完成 |
| F7 | `seed-admin`：建第一個管理員（`tsx` 腳本加 make target，compose 內執行）；只有 admin 功能（F5）用得到，跟著 F5 走 | 4（依 D4） | 延後 |

## API（依 D3）

- 依 D3 決定要不要對外提供 REST 加 OpenAPI。Go 版的 21 個操作見 S3。

## 非功能需求

| 項目 | 門檻 |
|---|---|---|
| 安全 | 沿用 Go 版 ADR `api-and-auth-baseline`、`account-abuse-and-lifecycle`：HttpOnly `__Host-` session cookie、CSRF 防護、argon2id、NIST 800-63B-4；認證自建（D2），偏離列在 D2 偏離清單；登入節流範圍依 D7 |
| 部署 | 依 D5 |
| 效能、成本、可觀測性、資料保存 | 未決（範本不設門檻，和 Go 版相同） |

## 外部介面

- Next.js 16（Go 版 `frontend/package.json` 的 `next ^16.4.2`）。資料存取依 D1、argon2id 套件依步驟 0 (a)；Server Actions 的安全模型（Origin 檢查、`serverActions.allowedOrigins`）、`cookies()`、proxy 是否適合做認證，都在 spike 補官方文件來源與查詢日期。

## 既有先例

- create-t3-app（Next.js 加 Drizzle 或 Prisma 加 NextAuth）：證明 Next.js 全端加 ORM 加認證庫是常見組合；不證明它符合 Go 版 ADR 的安全基線。

## 待驗證的產品風險

- 使用者就是 Will 自己（接案範本），有 Go 版的使用證據；省略產品風險驗證步驟。
