---
title: 範本 repo 公開；衍生專案由產生器輸出到新目錄，之後與範本斷開
date: 2026-11-04
review-date: 2027-05-04
status: active
tags: [decision, template, generator, github]
related-commits: [a47b3a4, 6d8be76, 2643145, d443f7b]
---

# 範本 repo 公開；衍生專案由產生器輸出到新目錄，之後與範本斷開

這份 ADR 只關於範本本身，放在 `template/`，產生器不會把它帶進衍生專案。

## Context

這個 repo 同時是一個能直接跑的專案（CI 跑 app、integration、compose stack），也是產生新專案的範本。原本的做法是 clone 後原地改名（`rename.py` 依序 `str.replace` 11 個白名單檔），審查找到四個根因：依序替換互相干擾；範本專用的機制（腳本、CI job、說明、git 歷史與 `origin`）留在衍生專案；先改檔後檢查，失敗時樹只改一半；白名單要手動維護。

**約束**：

- `inherited`：範本本身要能直接跑，CI 才能對真的程式碼跑 app、integration 與 stack。仍成立：佔位符範本要先渲染才能跑這些檢查。
- `external`：GitHub branch protection 只要求 `gate (ci)` 一個 check。
- `external`：本機不跑資料庫容器與 compose；產出能不能跑只能在 CI 證明。

## Options Considered

- **D1 repo 可見度**：A public，與 Go 版相同，可展示給接案客戶（選用）；B private（部分免費的 GitHub 安全功能要付費方案）。
- **D2 怎麼產生衍生專案**（基準：`dotnet new` 的範本專案可直接 build、以 `sourceName` 替換、條件區塊；create-next-app／degit 下載 tarball、篩選後解到新目錄再 `git init`）：
  - A′ 範本可直接跑，產生器輸出到新目錄並重新 `git init`，之後與範本斷開（選用）。
  - B Copier：衍生專案之後可用 `copier update` 收範本修正；範本的 `package.json`、compose、`ci.yml` 變成 `.jinja`，範本不能直接跑。
  - C GitHub template repo 加首次 push 的清理 workflow：依賴「Use this template」與 bot commit，條件判斷靠 repo 名稱，又會被改名改寫。

## Decision

- **D1**：public。
- **D2**：A′。`template/new_project.py`（`make new NAME=<name> DEST=<dir> [REPO=owner/name]`）：
  - 匯出 HEAD（工作區必須乾淨）：`git archive`，以 `tarfile` 的 `filter="data"` 解壓到 DEST 旁的暫存目錄。`docs/plans/` 不匯出，`template/derived/` 的檔案取代同路徑的檔，`template/` 之後整個刪掉。
  - 共用檔裡只屬於範本的行放在 `>>> template-only`／`<<< template-only` 標記之間，產生時刪掉（對應 `dotnet new` 的條件區塊）。
  - 名稱、資料庫名、repo 三個 token 一次替換；檔名不替換，路徑含 token 就拒絕。
  - 產出還提到範本名、被排除的路徑、產生器或標記時拒絕；symlink 拒絕；任何屬性來源（`git check-attr --source`）在匯出的檔上設了 `export-ignore`／`export-subst` 時拒絕。
  - 只有檢查通過的樹才 `git init -b main`、commit 一次、沒有 remote，再整個搬到 DEST。分支模型在第一次 push 後於 hosting 端設定。
  - CI 的 generate job 產生一個專案，對產出跑 `pnpm check`、Python 測試與 integration；它在 `gate (ci)` 的 `needs` 裡（也放在標記內）。

## Rationale

- **D1**：公開能直接拿給客戶看，安全掃描的寫法與 Go 版相同。代價：程式碼公開，所以 repo 裡不放客戶或個人資訊。
- **D2**：A′ 讓範本仍是一個 CI 完整驗證的專案，又不把範本專用的東西留給衍生專案；四個根因各有對應：一次替換、整檔排除加標記、檢查通過才搬到 DEST、排除清單取代白名單。B 是唯一能讓衍生專案收到之後修正的做法，代價是範本不能直接跑、每個檢查都要先渲染。C 的條件判斷依賴會被改名改寫的 repo 名稱。A′ 的代價：衍生專案與範本斷開，之後的範本修正要手動帶過去。
- 解壓用 `git archive` 加 `tarfile`，不自己逐檔寫：權限、symlink 與路徑安全交給 tar 與 Python 建議的 data filter，產生器只做替換與檢查。

## Expected Outcome

- CI 的 generate job：產出只有 `main`、1 個 commit、沒有 remote，`pnpm check`、Python 測試與 integration 全過（run 41762928008）。
- 產生失敗時 DEST 不變，旁邊不留暫存目錄（`template/test_new_project.py`）。

## Revocation Triggers

- 衍生專案要收到之後的範本修正 → 改走 B（Copier）。
- 要讓不能跑 Python 3.12（或有 tar filter 的修補版）的人產生專案 → 重看解壓方式。

## Related

- 實作：`template/new_project.py`、`template/test_new_project.py`、`.github/workflows/ci.yml` 的 generate job。
- 同樣的根因也在 Go 與 FastAPI 版的 rename 腳本，記在各自的專案頁 Pending。
