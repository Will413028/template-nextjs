# items-parity：Go 版 items 與 authz 測試 → template-nextjs

來源：template-go-nextjs `560106d`（計畫的規格基準）的 `backend/internal/httpapi/items_test.go`、`authz_test.go`，加上 items 的 cursor 所在的 `backend/internal/platform/httpx/cursor_test.go`、`main_test.go`；逐一讀過（2026-11-03）。Go 之後改成 Connect 的版本（`36dadf0`）只換傳輸層，不是本表的規格。步驟：3a 資料層、3b action 與畫面、4 延後的 admin（D4）。

名稱清單的產生指令（每個名稱在下表都有一列，`check-parity.py` 會核對）：

```bash
cd .projects/personal/template-go-nextjs
for f in backend/internal/httpapi/items_test.go backend/internal/httpapi/authz_test.go \
         backend/internal/platform/httpx/cursor_test.go backend/internal/platform/httpx/main_test.go; do
  git show 560106d:$f | rg -o --no-filename '^func (Test\w+)' -r '$1'
done
```

Go 的 HTTP 形狀（狀態碼、`Location`、Content-Type、merge-patch 媒體類型、query string 解析）在這裡沒有對應物：計畫 D3 只用 Server Actions，讀取在 server component。斷言改成 action 與查詢的回傳值；「不存在」在頁面上是 404。

## items 偏離清單

1. 格式錯誤的 id（不是 UUID）：Go 回 422 `/id format`；這裡和不存在的 id 一樣是「找不到」（頁面 404、action `not_found`）。理由：頁面路徑上格式錯誤的 id 就是不存在的頁；和步驟 2 `revokeSession` 的處理一致；PostgreSQL 不會收到它。狀態：待 Will 確認（實作照這個建議先做）。

## Go 測試對照表

一列一個 Go 測試函式。「歸屬」欄為沿用／偏離（附條號）／不適用（附理由）；延後的列寫「沿用」並把步驟標 4。

| Go 測試名 | 檔案 | 歸屬 | 所屬步驟 | TS 測試名 |
|---|---|---|---|---|
| TestCreateItem | httpapi/items_test.go | 沿用（`Location` 標頭與 Content-Type 不適用：沒有 REST） | 3a | `test/integration/items.test.ts` "creating an item > makes it the viewer's, readable by its id, with a missing description as null" |
| TestCreateItemUnauthenticated | httpapi/items_test.go | 沿用（不帶 session 的 action 回 `unauthenticated`） | 3b | |
| TestCreateItemTitleTooLong | httpapi/items_test.go | 沿用 | 3a | `test/integration/items.test.ts` "creating an item > takes titles of 1 to 200 code points, and the database refuses any other"；`src/features/items/__tests__/input.test.ts` "a new item > takes a title of 1 to 200 characters counted in code points" |
| TestListMyItems | httpapi/items_test.go | 沿用（未登入的 401 改成頁面導向登入頁，3b） | 3a | `test/integration/items.test.ts` "listing items > shows only the viewer's, newest first, with no next cursor on the only page" |
| TestPaginationKeyset | httpapi/items_test.go | 沿用 | 3a | `test/integration/items.test.ts` "listing items > pages through with a keyset cursor: an item created meanwhile neither repeats nor skips one" |
| TestListItemsInvalidPage | httpapi/items_test.go | 沿用（頁面上的 cursor 不是本站產生的 → 404，3b） | 3a | `test/integration/items.test.ts` "listing items > refuses a limit outside 1 to 100 and a cursor it did not make"；`src/features/items/__tests__/input.test.ts` "a page request > refuses %s" |
| TestDefaultPageSizeMatchesContract | httpapi/items_test.go | 沿用（沒有 openapi 可比對：預設值就在唯一的 zod 規則裡，改成直接驗行為） | 3a | `test/integration/items.test.ts` "listing items > items a page when the caller names no limit"；`src/features/items/__tests__/input.test.ts` "a page request > items by default, and no cursor on the first page" |
| TestListItemsLimitNotDecimal | httpapi/items_test.go | 不適用：專測 kin-openapi 以 base 0 解析 query string 整數（`0x10`）；這裡的 limit 不經 query string，zod 只收 number（`input.test.ts` 的 "a limit that is not a number"） | 3a | |
| TestGetItem | httpapi/items_test.go | 沿用；格式錯誤的 id 偏離（items 偏離清單第 1 條） | 3a | `test/integration/items.test.ts` "reading an item > finds the viewer's item, and not one that does not exist or whose id is no UUID" |
| TestGetOtherUsersItem | httpapi/items_test.go | 沿用（頁面上是 404，3b） | 3a | `test/integration/items.test.ts` "reading an item > does not find another user's item" |
| TestUpdateItem | httpapi/items_test.go | 沿用 | 3a | `test/integration/items.test.ts` "changing an item > sets the title and description and keeps its id and created_at" |
| TestUpdateItemMergePatch | httpapi/items_test.go | 沿用（非 merge-patch 媒體類型回 415 不適用：Server Action 沒有媒體類型協商；表單送不出 null，空白 description 視為 null） | 3a | `test/integration/items.test.ts` "changing an item > changes only the fields it is given: description null clears it, title null is refused"；`src/features/items/__tests__/input.test.ts` "an item patch > sets only the fields it names"、"a form's fields > become an object, an empty description becoming null" |
| TestUpdatedAtChanges | httpapi/items_test.go | 沿用 | 3a | `test/integration/items.test.ts` "changing an item > moves updated_at on a change and leaves created_at" |
| TestDeleteItem | httpapi/items_test.go | 沿用（204 無主體 → `{ ok: true }`） | 3a | `test/integration/items.test.ts` "deleting an item > removes the viewer's item, which is then not found" |
| TestUpdateOtherUsersItem | httpapi/items_test.go | 沿用（拆成改與刪兩個測試，各自能被 mutation 抓到） | 3a | `test/integration/items.test.ts` "changing an item > does not change another user's item"；"deleting an item > does not delete another user's item" |
| TestCreateItemCrossSite | httpapi/items_test.go | 沿用 | 3b | |
| TestAdminOperationsChecksTable | httpapi/authz_test.go | 沿用（非 admin 部分：每個 action 都由 `authedAction`／`publicAction` 建立，公開的只有註冊與登入；admin 操作清單隨 F5 延後到步驟 4） | 3b | |
| TestOperationAccessEnforced | httpapi/authz_test.go | 沿用（不帶 session 的部分；一般使用者呼叫 admin 操作回 403 隨 F5 延後到步驟 4） | 3b | |
| TestAdminChangesAreAudited | httpapi/authz_test.go | 沿用 | 4 | |
| TestCursorRoundTrip | platform/httpx/cursor_test.go | 沿用 | 3a | `src/features/items/__tests__/cursor.test.ts` "the page cursor > round-trips an id" |
| TestCursorTamperedIsInvalid | platform/httpx/cursor_test.go | 沿用（另加標準 base64 字母與非正規形式兩案） | 3a | `src/features/items/__tests__/cursor.test.ts` "the page cursor > refuses a cursor it did not make: %s" |
| TestMain | platform/httpx/main_test.go | 不適用：Go 的 goleak 測試基礎設施 | 3a | |

Go 沒有、這裡另加的：`test/integration/items.test.ts` "deleting an item > goes with the account that owns it"（Go ABUSE ADR D3：使用者擁有的資料隨帳號刪除；FK 的 `ON DELETE` 規則另由 `auth.test.ts` "lets every foreign key to users follow a deleted account (cascade or set null)" 守住）。
