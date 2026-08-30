# SplitBed

Shared Accommodation Allocation Platform。母品牌 Split，SplitBed 是第一個產品。

## 唯一真相來源
- `docs/00-master-brief.md` — 定位、範圍、已裁掉的東西、關鍵取捨
- `docs/01-domain-model.md` — schema，Phase 0 的 dataclass 與 Phase 1 的 SQL 欄位必須一致
- `docs/02-allocation-engine.md` — CP-SAT 數學規格，**實作不得自行改建模**
- `docs/03-roadmap.md` — Phase 0/1/2
- `handoff/codex-workpackages.md` — 派工給 Codex 的 WP 與可貼 prompt

## 硬性規則
- **Phase 1 = 純靜態網頁小程式**，部署 GitHub Pages（repo sssunwl/splitbed）。無後端、無資料庫、無登入。
- **引擎只有一份，用 TypeScript 寫**，同一份在瀏覽器與 Node 跑。不要再寫 Python 引擎。
- `src/engine/`、`src/sim/` 是純邏輯層：不碰 DOM、網路、檔案 IO。執行期依賴為零。
- 不用 React / 任何 UI 框架。
- 視覺一律跟 `docs/08-brand.md`：一屏一個焦點、字細行緊、冗長解釋收埋做 `.info-dot` 浮標。
- **Cloudflare 上不要用 Python**（跑不到 OR-Tools）。TS 引擎一份跑三處：瀏覽器 / Worker / Node。
- Phase 2 多租戶：**每個客戶一個獨立 D1 資料庫** + 一個共用 registry。不做「共用表 + tenant_id」。
- 訂單匯入不追求全自動：**沒有任何 OTA feed 提供性別**，設計成「匯入骨架 + 快速補性別」。
- Optimizer 只排到 **room**，不排到 bed。Bed 在 check-in 當日用簡單規則指派。
- v1 **不做 room move**。
- Optimizer 只產生 recommendation，**永不直接改 assignment**。
- 容量永遠由 bed 數算出，room 不存 capacity 欄位。
- Google Sheet 只做 report / backup，**不是 source of truth**。

## 額外文件
- `docs/04-web-app-scope.md` — 網頁小程式範圍 + `/guide` 說明頁的六節內容
- `docs/05-sapporo-baseline.md` — 「札幌改 Mixed 一季多賺幾多」的參考答案，同時是 WP-3 驗收基準
- `docs/06-multi-tenancy-and-ingestion.md` — 多租戶（每客戶一個 D1）、Cloudflare 決定、訂單匯入策略
- `docs/07-booking-sheet.md` — 訂單記錄表設計 + 接落真正訂單系統嘅三階段路線（範例檔喺 `public/examples/`）
- `docs/08-brand.md` — **改任何介面之前先讀**：品牌個性、色票、字級、hover、浮標用法

> **只在本機、不在 public repo** 的檔案（見 `.gitignore`）：
> `docs/05-sapporo-baseline.md`、`docs/06-multi-tenancy-and-ingestion.md`、`handoff/`。
> 內含收入模型、定價與市場判斷。派 WP-3 時要把 05 的驗收數字直接貼進 prompt，
> 不要叫 Codex 去 repo 讀。
- `reference/` — 一次性審查腳本，非產品程式碼

## 現況
2026-08-28 開案。

### 2026-08-29

- Phase 1 的 WP-0～WP-6 已全部完成並推送 `main`：Vite／TypeScript 骨架、domain／capacity／policy、貪心加決定性局部搜尋排房引擎、需求模擬與 policy 比較、What-if 試算、每日排房工具及使用說明頁。
- 修正取消／no-show 訂單不參與排房；模擬結果與札幌基線偏差低於 2.5%。首頁改為產品介紹，試算獨立成頁，並加入訂單記錄表範例、匯入欄目說明及 `docs/08-brand.md` 視覺規範。
- 驗證：`npm test -- --run` 共 11 個 test files、109 tests 全數通過；`npm run build` 成功。工作樹乾淨，`main` 與 `origin/main` 同步。
- 下一步：用 GitHub Pages 做手機／桌面實機驗收，請未看過專案的住宿經營者完成「設定房型 → 看懂 Mixed 收益 → 排完一晚訂單」全流程；依回饋修正 Phase 1 後，再決定是否啟動 Phase 2 帳號版。
