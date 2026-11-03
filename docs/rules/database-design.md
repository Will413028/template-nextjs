# Database Design Rules

本專案使用 PostgreSQL 18、`pg`（node-postgres）、Drizzle ORM 與 drizzle-kit 產生的 SQL migration。表定義寫在 TypeScript，migration 是可以審閱的 SQL 檔。

## Schema 與查詢的位置

- 每個 feature 的表定義在 `src/features/<name>/schema.ts`，只用 `drizzle-orm/pg-core` 的建構函式；`drizzle.config.ts` 用 `./src/features/*/schema.ts` 收集。schema 檔會在 Next.js 之外被 drizzle-kit 載入，所以不 import `server-only` 或任何其他模組（dependency-cruiser `schema-is-table-definitions-only`）。
- 查詢只寫在 `src/features/<name>/server/` 下，用 Drizzle 的 query builder；第一個參數是呼叫者的身分（擁有者條件寫在查詢裡）。**NEVER** 在 `src/server/` 以外的地方建連線，或從 client 側的模組 import 資料庫（`.dependency-cruiser.cjs`）。
- `src/server/db.ts` 只提供連線池，不認得任何表：Drizzle 的 relational query API（需要把所有 schema 傳給 `drizzle()`）不用，避免核心反過來依賴每個 feature。

## 命名規範

### Table 與 Column

- 表名用**複數 snake_case**：`users`、`sessions`、`order_items`。
- 欄位名用 **snake_case**：`created_at`、`owner_id`、`is_disabled`；TypeScript 屬性用 camelCase，在建構函式裡明寫欄位名（`ownerId: uuid("owner_id")`）。
- Boolean 欄位用 `is_` / `has_` 前綴：`is_disabled`、`has_paid`。
- 時間欄位用 `_at` 後綴：`created_at`、`last_used_at`、`expires_at`。

### Foreign Key

- 欄位名是 `<被參照的表單數>_id`（`user_id → users.id`），或表達角色的 `<角色>_id`（`owner_id → users.id`）。
- 必須明確寫 `.notNull()` 或允許 NULL。
- 指向 `users` 的 FK 必須寫明刪除行為：使用者擁有的資料 `onDelete: "cascade"`，帳號刪除時一起刪掉；比帳號活得久的參照用 `onDelete: "set null"`。沒寫（`NO ACTION`）或 `restrict` 會讓刪除帳號失敗。
- 其他 FK 預設不 cascade：刪除仍被參照的 parent 會失敗，而不是靜默刪掉 child；只有純附屬資料才 cascade。
- 跨 feature 的 FK 只指向 `users`（auth 是其他 feature 的基礎）；需要別的 feature 的資料時，經它的 `server.ts` 取得，查詢 **NEVER** `JOIN` 別的 feature 的表。

### Index

- 名稱照 PostgreSQL 自動命名的格式明寫：一般索引 `<table>_<columns>_idx`，unique 索引 `<table>_<column>_key`。
- 為 keyset 分頁建複合索引，欄位與查詢的 `WHERE` 和 `ORDER BY` 一致。
- 降冪索引寫 `.desc().nullsFirst()`：Drizzle 的 `.desc()` 產生 `DESC NULLS LAST`，和 PostgreSQL 的 `ORDER BY x DESC`（預設 `NULLS FIRST`）及其反向都不一致，planner 用不上（`scripts/check_migrations.py` 擋下）。

## 型別選擇

照 [PostgreSQL wiki「Don't Do This」](https://wiki.postgresql.org/wiki/Don%27t_Do_This)：

| 場景 | 使用 | 避免 |
|------|------|------|
| 主鍵 | `uuid PRIMARY KEY DEFAULT uuidv7()` | `serial`、`int` 自增 |
| 文字（有長度限制） | `text` + `CHECK (char_length(x) BETWEEN m AND n)` | `varchar(n)`、`char(n)` |
| 文字（無限制） | `text` | `varchar` |
| 狀態、role、列舉 | `text` + `CHECK (x IN (...))` | PG `ENUM` 型別、沒有 CHECK 的 `text` |
| 時間 | `timestamptz`（`timestamp(..., { withTimezone: true })`） | `timestamp`（不帶時區） |
| 整數計數 | `bigint` | `int`（squawk `prefer-bigint-over-int`） |
| 金額 | `numeric(precision, scale)` | `float`、`real`、`money` |
| 布林 | `boolean` | `smallint`、`'Y'/'N'` |
| 二進位（雜湊等） | `bytea` + `CHECK (octet_length(x) = n)` | hex 字串存 `text` |

- 主鍵由 DB 的 `uuidv7()`（PostgreSQL 18 內建）產生：`uuid("id").primaryKey().default(sql\`uuidv7()\`)`。UUIDv7 依時間排序，可以直接當 keyset 分頁的排序鍵。
- 時間的 default 用 DB 的 `now()`（`.defaultNow()`），不由應用程式傳值。
- 長度與 enum 的 CHECK 寫在表定義的 `check()`，數值和 Server Action 的 zod schema 一致：zod 是第一道防線，CHECK 是第二道，任何不合長度或 enum 的資料在 DB 層就寫不進去。新增狀態值時，在同一個 PR 改 zod schema 與 CHECK。

### JSONB 與 Array

- JSONB 只用於彈性結構的資料（偏好設定、外部系統的原始 payload）；使用前必須能說明為何不用 table + FK。**NEVER** 在 JSONB 塞可以正規化的關聯資料。
- 需要查詢 JSONB 或 array 的內容時，建 GIN 索引。
- 簡單的多值屬性（標籤）可以用 `text[]`，不用 JSON 存字串列表。

## 時間戳記

- 對使用者顯示 `updated_at` 的資源表都有 `created_at`、`updated_at timestamptz NOT NULL DEFAULT now()`。
- **這些表的每個 UPDATE 都明寫 `updatedAt: sql\`now()\``**，不靠 trigger，也不由應用程式傳時間值。
- 例外：內部的狀態表可以由程式傳入時間，讓測試控制時鐘（例如 session 的 `last_used_at`）。

## Migration

### 產生

- 改 `schema.ts` 後用 `make generate-migration MSG=<name>`（`drizzle-kit generate`，不需要資料庫）產生 `migrations/<n>_<name>.sql` 與 `migrations/meta/`，一起 commit。
- 純資料的 backfill 用 `pnpm exec drizzle-kit generate --custom --name <name>` 建空檔後手寫。
- 套用：compose 的 `migrate` 服務（`scripts/migrate.mts`）以 owner 角色執行，再授權 app 角色；本機 stack 用 `make migration`。

### 交易與鎖

- Drizzle 的 migrator 把**所有待套用的 migration 包在同一個 transaction**：一支失敗就全部不套用，但也不能用 `CREATE INDEX CONCURRENTLY`（squawk 以 `assume_in_transaction` 擋下）。在已有大量資料的表上建索引會擋寫入；有這種表時另訂流程（在 migrator 之外跑 `CONCURRENTLY`），不要在 migration 裡繞過。
- `scripts/migrate.mts` 在連線上設 `lock_timeout` 10s；**NEVER** 在 migration 裡寫 `SET lock_timeout`。
- `pnpm check:migrations` 用 squawk 檢查會長時間鎖表的語句（設定在 `.squawk.toml`）。對已有資料的表補 `NOT NULL` 或加 FK、CHECK，手寫不鎖表的步驟：`ADD CONSTRAINT … NOT VALID` → 下一支 `VALIDATE CONSTRAINT`；`NOT NULL` 是 `CHECK (x IS NOT NULL) NOT VALID` → `VALIDATE` → `SET NOT NULL` 並刪掉那個 CHECK。

### 不可修改

- 已合併進 `main` 的 migration 只能新增，**NEVER** 修改、刪除或改名；要改就新增一支。Drizzle 存了每支檔案的雜湊但從不比對，改過的檔案在已套用的資料庫上會靜默地不再執行，所以 `scripts/check_migrations.py --base <ref>` 比對 base 上已有的檔案與 journal（CI 與 pre-push）。
- journal 的時間戳必須遞增：migrator 只套用比最後一支已套用的更新的項目，較舊的時間戳（在分支上產生、較晚合併）會被跳過而不報錯。合併前在最新的 `dev` 上重新產生。

### 與上一版相容（expand／contract）

- 每支 migration 都要讓**上一版的 app** 照常運作：部署是先跑 migrate 再換 app，這段時間跑的是舊程式；回退也是舊 image 配新 schema。
- 舊程式還在用的結構不能在同一版刪除或改形：刪或改名欄位與表、換主鍵或 `ON CONFLICT` 依賴的唯一約束、把欄位改成舊程式寫不進去的型別或約束。做法是拆成兩版（Martin Fowler「Parallel Change」）：
  - **expand**：新增新結構，新程式只用它，舊結構原封不動。
  - **contract**：新程式上線之後的下一版，才刪掉舊結構。範本的「一版」就是合併進 `main` 的一個 PR。
- squawk 擋下這類變更（`ban-drop-constraint`、`ban-drop-column`、`ban-drop-table`、`renaming-*`）。只有兩種情況可以在那一行上方寫 `-- squawk-ignore <rule>`，並在上一行寫理由：contract 步驟（寫出舊程式在哪一版停止使用它），或同一個 statement 立刻補回等價的約束。ignore 的數量鎖在 `scripts/quality-locks.json`。

## DB 角色與權限

照 OWASP 最小權限：

- `POSTGRES_USER`（superuser）只用於初始化與容器內維運，app **NEVER** 用它連線。
- migrate 用 owner 角色（`DB_OWNER_USER`）：擁有 database 與 `public` schema，不是 superuser，經 `MIGRATE_DATABASE_URL` 連線。migrator 的帳本在 `drizzle` schema，app 角色讀不到。
- app 用 app 角色（`DB_APP_USER`），只有 DML，經 `DATABASE_URL` 連線。
- 角色由 `deploy/postgres/initdb/10-roles.sh` 建立；授權（含 `ALTER DEFAULT PRIVILEGES`）由 `scripts/migrate.mts` 每次套用後冪等執行，所以新表自動給 app 角色 DML。
- 密碼不放在 URL 或環境變數：用 `*_FILE`（compose secrets 掛檔）傳入，URL 只寫使用者名稱。
- 整合測試（testcontainers，PostgreSQL 18，與 compose 同一個 image digest）使用同一套角色（`test/integration/postgres.ts`）。

## 連線設定

`src/server/db.ts` 的連線池設定只有：`DB_MAX_CONNS`（預設 10）、`DB_STATEMENT_TIMEOUT_MS`（預設 5000）、連線逾時 5 秒；閒置連線斷掉（資料庫重啟）時記錄並丟棄，不讓程序結束。
