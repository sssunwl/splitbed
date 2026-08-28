# SplitBed — Master Brief

最後更新：2026-08-28

## 1. 一句話定位

SplitBed 是 **Shared Accommodation Allocation Platform**：
住宿方自行設定房間規則，系統根據訂單、日期、房間、床位、Guest 與規則，
持續計算「用最少 inventory waste 完成最多訂單」的房間安排建議。

不是「男女分房工具」，也不是 PMS。

## 2. 品牌結構（已定案）

- 母品牌：**Split**（底層 Resource Allocation Engine）
- 第一個產品：**SplitBed** — Room / Bed / Occupant
- 將來可能：SplitStay（Villa/Apartment/Unit）、SplitPark、SplitGear
- 第一版**只做床位住宿**：Hostel / Guesthouse / Dormitory / Staff accommodation / Ski lodge

> 待辦（人做）：檢查 splitbed.com / .app domain 與商標可用性，再對外用這個名。

## 3. 適用場景（v1 一併涵蓋，因為模型相同）

| 場景 | 共同模型 | 差異只在 Policy |
|---|---|---|
| 青年旅舍 | Building → Room → Bed → Occupant | Mixed / Same-gender、2–7 晚、Group |
| 滑雪宿舍 | 同上 | 長住 7–30 晚、教練與客人分開、大量 Group |
| 員工宿舍 | 同上 | 月租、Department、固定床位 |
| Guesthouse | 同上 | Private Room + Shared Room 混合 |

## 4. 三個核心設計原則（不可違反）

1. **Policy 不可 hard-code。** 男女分房只是其中一個 policy。
2. **Capacity 不可 hard-code。** Room / Bed 由後台改，Bed 可單獨 Out of Service。
3. **Optimizer 只建議，不直接改房。** Calculate → Recommend → Show Impact → Manager Apply。

## 5. 已裁掉的範圍（v1 明確不做）

刻意縮小，避免變成 PMS：

- OTA API 串接（Booking.com / Agoda / Airbnb）→ 先手動入單 / CSV import
- Payment / 收款
- 完整 Housekeeping 模組
- Waitlist
- 視覺化 Rule Builder（IF/THEN UI）
- Room-level policy 的 effective date 版本化
- Capacity 變更的 effective date 版本化（v1 只做即時生效 + 影響預覽）
- Staff permissions 細分（v1 只有 staff / manager 兩級）
- Mobile UI
- AI 解釋（v2 才加；v1 的解釋用固定模板文字）

Booking Status v1 只用 6 種：
`pending / confirmed_unassigned / recommended / assigned / checked_in / checked_out`
（`cancelled` / `no_show` 作為終態旗標，不另開狀態機分支）

## 6. 關鍵取捨（跟原始 brief 的差異，須知道為何）

### 6.1 Optimizer 只排到 Room，不排到 Bed

原 brief 隱含要排到 bed。實際上：

- Gender / Private / Capacity 全部是 **room 層** 的約束
- 排到 bed 會令決策變數乘上 bed 數，換來零商業價值
- 具體哪張床，在 **check-in 當日** 用簡單規則指派（下鋪優先給長者／無障礙／先到先得）

→ 決策變數是 `a[guest, room]`，不是 `x[guest, bed, date]`。規模小一個數量級。

### 6.2 v1 禁止 Room Move

「同一張 booking 中途換房」會令模型要把 stay 切 segment，變數與約束都翻倍，
而實務上員工也極少接受。v1 設 hard rule：**一位 guest 整段住宿同一房**。
v2 才開放 room move，並加 move penalty。

### 6.3 Stranded Bed Nights 是結構指標，不是損失金額

可計算定義（不需要 demand forecast）：

```
strand[room, date] = free_capacity(room, date)   當且僅當 room 在該日已被 gender-lock
                                                  或 private-lock 或 staff-lock
Stranded Bed Nights = Σ over (room, date) strand[room, date]
```

它是 **leading indicator**（結構上有幾多床被規則封住），
**不等於** lost revenue。真正的 lost revenue 只有 Simulator 用模擬需求才算得出。
Dashboard 要分開顯示這兩個數，不要混為一談。

### 6.4 Re-optimization 必須有 Stability Penalty

原 brief 沒寫，但這是會讓系統「不能用」的關鍵：
每次重跑若不懲罰「與現行安排不同」，員工每日都會收到一份大搬風建議，然後就不再看它。

→ Objective 必須含 `w_stability × (與 current assignment 不同的 guest 數)`，權重要高。

### 6.5 Policy 三層繼承，v1 只做兩層半

- Company level：**做**（一個預設值）
- Property level：**做**（可 override company）
- Room level：**只做固定 tag**，不做完整 policy 物件：
  `mixed / same_gender / female_only / male_only / private / staff / maintenance / manual_only`

完整的 room-level policy 物件 + effective date 留到 v2。

## 7. 技術選型（2026-08-28 修訂：改為瀏覽器優先）

**修訂原因**：repo https://github.com/sssunwl/splitbed/ 已開 GitHub Pages，
且決定「先做網頁小程式，之後才接資料庫、才考慮賣給不同公司」。
GitHub Pages 是純靜態託管，跑不到 Python / OR-Tools。

| 層 | 選擇 | 理由 |
|---|---|---|
| Allocation Engine | **TypeScript，零執行期依賴** | 同一份程式碼在瀏覽器跑互動、在 Node 跑批次模擬。**只有一份引擎，一個真相來源。** |
| 演算法 | 貪心指派 + 局部搜尋（不用 CP-SAT） | 12–30 床規模下已極接近最佳解；CP-SAT 上不了瀏覽器 |
| 前端 | Vite + TypeScript + 原生 DOM（不用 React） | 小程式規模，React 只會拖慢載入與增加 Codex 出錯面 |
| 測試 | vitest | |
| 部署 | GitHub Actions → GitHub Pages | |
| 資料 | 全部 localStorage + JSON import/export | **Phase 1 完全無後端、無資料庫、無帳號** |

被推遲（不是取消）：OR-Tools CP-SAT 服務、Supabase、Next.js 後台、多租戶。
將來若需證明最佳性，加 Python CP-SAT 服務去**驗證** TS 引擎的解，而不是取代它。

### 為何不用 React

這個小程式只有三頁、狀態不複雜。用原生 DOM + 一個薄 render 函數，
bundle 細、GitHub Pages 秒開、Codex 出錯的面積小很多。
真正的後台（Phase 2）才用 Next.js。

## 8. Phase 1 = 網頁小程式（本階段唯一目標）

三頁，全部靜態：

1. **`/` What-if 模擬器** — 設房型床數 → 選 policy → 設需求 → 出比較表與圖。
   這頁直接回答「札幌改 Mixed，一季多賺幾多」。
2. **`/allocator` 排房小工具** — 手動輸入/貼上訂單 → 出建議安排 + Room×Date calendar
   + 每個建議的理由與 impact。可 export JSON / CSV。
3. **`/guide` 使用說明** — 系統做什麼、網頁小程式算整套系統的哪一部分、
   已考慮到哪些情況、未考慮哪些。詳見 `04-web-app-scope.md`。

範圍界線：**無登入、無資料庫、無 OTA、無收款、無多租戶。**
所有資料留在使用者瀏覽器，重新整理靠 localStorage，跨機靠 JSON export/import。

## 9. 開發順序

見 `03-roadmap.md`。Phase 1 完成且模擬器算得出札幌那條數之後，
才決定要不要接資料庫、要不要賣。
