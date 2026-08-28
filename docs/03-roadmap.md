# SplitBed — Roadmap

> **⚠ 2026-08-28 修訂**：原本的 Phase 0（純 Python 引擎 + 模擬器）已被下方的
> 「Phase 1 網頁小程式」取代。原因：repo 已開 GitHub Pages，且決定先做網頁小程式、
> 之後才接資料庫與考慮賣給不同公司。目標不變 —— 先驗證引擎、先算出札幌那條數 ——
> 只是載體由 Python CLI 改成瀏覽器。

## Phase 1：純靜態網頁小程式（現行階段）

部署：https://sssunwl.github.io/splitbed/ ｜ repo：sssunwl/splitbed

| WP | 內容 |
|---|---|
| WP-0 | Vite + TS 骨架、三頁殼、GitHub Actions 部署 |
| WP-1 | Domain types + policy 解析 + capacity（純函數 + 測試） |
| WP-2 | Allocation engine（貪心 + 局部搜尋），照 `02-allocation-engine.md` 的 H1–H9 與 §4 目標函數 |
| WP-3 | 模擬器 + policy 比較，須重現 `05-sapporo-baseline.md` 的結論（誤差 <5%） |
| WP-4 | `/` What-if 模擬器 UI |
| WP-5 | `/allocator` 排房工具 UI |
| WP-6 | `/guide` 說明頁（照 `04-web-app-scope.md` §3 六節） |

範圍見 `04-web-app-scope.md`。**無登入、無資料庫、無 OTA、無收款、無多租戶。**

驗收：一個沒看過這個專案的住宿經營者，能自己在網站上設定自己的房型，
看懂「改 Mixed 值幾多錢」，並用排房工具排完一晚的訂單。

## Phase 2：splitbed.sssuni.com 帳號版

見 `06-multi-tenancy-and-ingestion.md`。

- Cloudflare Pages/Workers + Cloudflare Access 登入
- **每個客戶一個獨立 D1 資料庫** + 一個共用 registry（tenants / users）
- 從第一日就寫 migration runner，不准手動改 schema
- 同一份 TS 引擎搬進 Worker，不重寫
- CSV / Excel 匯入（欄位由客戶自己對應，不寫死格式）
- 「今日新訂單快速補性別」介面 —— 這是客戶每日打開它的理由
- audit log、多人使用
- 用真實歷史訂單重跑模擬器，`05-sapporo-baseline.md` 的數字才可以拿去開會

**免費瀏覽器版不會下架**，付費版是在它之上加帳號與資料保存，不是取代它。

## Phase 3：只在有客戶開口要時才做

Google Sheet 連結、iCal 訂閱、PMS API（Beds24 / Cloudbeds）、
Room move、Waitlist、Housekeeping、
Oracle VM 上的 Python CP-SAT 服務（**驗證** TS 引擎，不是取代它）。

## 為何是這個順序

1. 網頁小程式零後端零帳號，做完即刻可以拿給人試，不需要對方投入任何嘢
2. 唯一有技術風險的仍然是引擎，而它在 Phase 1 就寫完並被模擬器驗證
3. What-if 模擬器本身就是銷售工具：對方輸入自己的房型，五分鐘看到自己的錢
4. 有人真的想用，才值得付出接資料庫與做多租戶的代價
