# SplitBed — Allocation Engine 規格

> **⚠ 2026-08-28 修訂**：Phase 1 改為瀏覽器優先，引擎用 **TypeScript 貪心 + 局部搜尋**，
> 不用 CP-SAT（GitHub Pages 是靜態託管，跑不到 Python/OR-Tools）。
> 本文的 **§1 集合與參數、§3 Hard Constraints H1–H9、§4 Objective 與權重、§7 Bed 指派、
> §8 Triggers、§9 Simulator 全部仍然有效**，是 TS 引擎必須實作的規則。
> 只有「用 CP-SAT 求解」這件事被取代：§2 的變數改為搜尋狀態、§5 warm start 改為
> 「以現有安排為初始解」、§6 solver 設定改為「固定隨機種子 + 迭代上限」。
> 目標函數仍然照 §4 逐項計算，用來為候選解評分。


這份是給實作者的**數學規格**。照這份寫，不要自行改建模。

## 0. 介面

```python
def solve(problem: AllocationProblem, options: SolveOptions) -> AllocationResult
```

純函數。輸入輸出都是 dataclass，**不碰 DB、不碰網路、不讀環境變數**。

- `AllocationProblem`: rooms, beds, bookings, guests, policy resolver, current_assignments, horizon
- `SolveOptions`: time_limit_s, weights, allow_reject
- `AllocationResult`: assignments, rejected_booking_ids, kpis, status, solve_time_ms

## 1. 集合與參數

- `D` = horizon 日期集合（預設 today .. today+90）
- `R` = 房間集合
- `G` = 需要安排的 guest 集合
- `S_g ⊆ D` = guest g 的住宿夜（`[check_in, check_out)`）
- `cap(r, d)` = 房 r 在日 d 的可用床數（由 bed status 算）
- `pol(r, d)` = policy 解析結果（見 01-domain-model §4）
- `B` = booking 集合，`G_b` = booking b 的 guests

## 2. 決策變數

```
a[g, r] ∈ {0,1}    guest g 整段住宿安排在房 r
```

輔助變數：
```
m[r, d] ∈ {0,1}    房 r 在日 d 有男客
f[r, d] ∈ {0,1}    房 r 在日 d 有女客
occ[r, d] ∈ Z≥0    房 r 在日 d 的入住人數
used[r, d] ∈ {0,1} 房 r 在日 d 有人（= occ ≥ 1）
ub[b, r] ∈ {0,1}   booking b 有人在房 r
rej[b] ∈ {0,1}     booking b 被拒（僅當 allow_reject）
chg[g] ∈ {0,1}     guest g 的安排與 current_assignment 不同
```

**變數規模**：`|G|×|R| + 2|R||D| + ...`
以 100 guest × 20 room × 90 日 = 2000 + 3600 + ~2000 ≈ 8k 布林。CP-SAT 毫秒級。

## 3. Hard Constraints

**H1 每人一房**
```
∀g: Σ_r a[g,r] + rej[booking(g)] = 1
```
（不允許 reject 時 `rej = 0`）

**H2 容量**
```
∀r,d: occ[r,d] = Σ_{g: d ∈ S_g} a[g,r]
∀r,d: occ[r,d] ≤ cap(r,d)
```

**H3 Same-gender lock**（只對 `pol(r,d) == same_gender` 的 (r,d)）
```
∀g male, d ∈ S_g:   a[g,r] ⟹ m[r,d]
∀g female, d ∈ S_g: a[g,r] ⟹ f[r,d]
                    m[r,d] + f[r,d] ≤ 1
```
CP-SAT 寫法：`model.AddImplication(a[g,r], m[r,d])`，
gender=unspecified 的 guest **不觸發** m 或 f。

> **實作者必讀：`same_gender` 是動態鎖，房間沒有永久性別欄位。**
> `m` 與 `f` 帶 **date 維度**，意思是「這間房**在這一晚**有男/女客」。
> 房間一旦在某晚完全無人，該晚就沒有任何鎖，可以自由收男或收女。
>
> 例：Room A 在 12/20–12/23 住了 2 位女客 → 這 4 晚鎖 Female；
> 12/24 全部退房 → 12/24 起立即回復自由，可以收男客。
>
> **不要在 Room 上加一個 `currentGender` 之類的欄位去記錄狀態。**
> 鎖是「誰住在裡面」推導出來的結果，不是要儲存的資料。
> 真正永久鎖性別的只有 `female_only` / `male_only`（H4），那是管理員設定的。
>
> 因為用 `[from, to)` 左閉右開，女客 12/24 退房 = 最後一晚是 12/23，
> 男客 12/24 入住不會撞。這個 off-by-one 是同類系統最常見的 bug。
>
> **陷阱**：鎖雖然會自動解，但只要有一個人未走就解不了。
> 一位住 14 晚的女客佔住 4 床房 → 3 張空床被鎖 Female 共 42 個 stranded bed-nights。
> 這正是 §4.2 `W_FRAGMENT` 要把長住客集中的原因。

**H4 固定性別房**
```
pol(r,·) == female_only → ∀g male:   a[g,r] = 0
pol(r,·) == male_only   → ∀g female: a[g,r] = 0
```
直接在建模前剪掉變數，不要建立再加約束。

**H5 Private room**
```
∀g ∈ G_b, r: a[g,r] ⟹ ub[b,r]
pol(r,·) == private → Σ_b ub[b,r] ≤ 1
booking.requires_private_room → ∀r: ub[b,r] ⟹ (Σ_{b'≠b} ub[b',r] = 0)
```

**H6 Must stay together**
```
booking.must_stay_together → ∀ g,g' ∈ G_b, ∀r: a[g,r] == a[g',r]
```
實作優化：這種 booking 直接視為一個「複合 guest」，變數共用，不要建 |G_b| 份。

**H7 Locked assignment**
```
lock_level == hard → a[g, r_current] = 1（其餘 a[g,·] 剪掉）
```

**H8 Staff / maintenance / manual_only 房**
```
pol == maintenance → cap = 0
pol == staff       → 只有 booking.source == 'staff' 可入
pol == manual_only → 不參與 optimizer（把該房與其現有客人整批移出模型）
```

**H9 v1 無 room move**：由 `a[g,r]` 的建模本身保證（一個 guest 一個房變數，無日期維度）。

## 4. Objective（最小化）

```
minimize
    W_REJECT     × Σ_b rej[b] × booking_value_norm[b]
  + W_STRAND     × Σ_{r,d} strand[r,d]
  + W_FRAGMENT   × Σ_{r,d} used[r,d]
  + W_STABILITY  × Σ_g chg[g] × lock_multiplier[g]
  + W_PRIORITY   × Σ_b rej[b] × priority[b]
```

### 4.1 strand[r,d] 的線性化

```
locked[r,d] ∈ {0,1}   房 r 在日 d 已被規則鎖住
  same_gender 房: locked[r,d] = m[r,d] OR f[r,d]
  private 房 / staff 房: locked[r,d] = used[r,d]
  mixed 房: locked[r,d] = 0

strand[r,d] ≥ cap(r,d) − occ[r,d] − M×(1 − locked[r,d])
strand[r,d] ≥ 0
```
（M = max cap。目標函數在最小化方向，所以只需下界。）

### 4.2 W_FRAGMENT 的作用

`Σ used[r,d]` = 「有人住的房×日」總數。最小化它 = 盡量把人塞入已開的房、
盡量保留**整間全空**的 flexible room。這一項就同時實現了原 brief 的：
- Fill room before opening new room
- 保留完整 Flexible Room
- 不要一個人鎖一間房

不需要為每條寫獨立規則。

### 4.3 預設權重（可由後台調，存 property 設定）

| 常數 | 預設 | 說明 |
|---|---|---|
| W_REJECT | 1000 | 拒單永遠最貴 |
| W_STABILITY | 120 | 高，避免大搬風 |
| W_STRAND | 10 | 每個 stranded bed night |
| W_FRAGMENT | 3 | 每個 used room-night |
| W_PRIORITY | 50 | VIP 拒單額外罰 |

`lock_multiplier`：`none=1, soft=4, hard=∞(改用 H7 硬約束)`

## 5. Warm start（必做）

```python
for g, r in current_assignments:
    model.AddHint(a[g, r], 1)
```
沒有 warm start，re-optimize 會慢且結果跳動。

## 6. Solver 設定

```python
solver.parameters.max_time_in_seconds = options.time_limit_s   # 預設 8
solver.parameters.num_search_workers = 8
solver.parameters.random_seed = 42        # 結果可重現，測試會依賴
```

狀態處理：
- `OPTIMAL` / `FEASIBLE` → 回傳解
- `INFEASIBLE` → **必須做診斷**：逐條放寬 hard constraint，找出是哪一條令問題無解，
  回傳 `reason_code`（例：`no_valid_room_for_gender`, `capacity_exceeded`）。
  員工看到「無法安排」時一定要知道原因，否則不會信任系統。

## 7. Bed 指派（獨立於 optimizer）

Check-in 當日跑，簡單規則，不需最佳化：
1. `accessibility_need` 或 `birth_year` 早於 1966 → 優先 lower
2. 同一 booking 的人優先相鄰 bed code
3. 其餘 first-fit by bed code

## 8. Re-optimization Triggers

`new_booking / cancellation / date_change / guest_count_change / gender_change /
extension / early_checkout / bed_status_change / room_type_change / policy_change /
manual_release`

一律 **debounce**：不要每次觸發都跑。收集 60 秒內的變更後跑一次。
排程另外每晚跑一次 full horizon。

## 9. Simulator（Phase 0 的第二個產物）

### 9.1 需求生成器

參數化，全部可由 config 傳入：
```
arrival_rate(date)        每日新訂單數 ~ Poisson(λ × seasonality(date))
lead_time                 ~ Geometric，中位數約 14 日
stay_nights               離散分佈，例：{1:.05, 2:.15, 3:.2, 4:.15, 5:.1, 6:.1, 7:.15, 14:.07, 30:.03}
group_size                {1:.30, 2:.40, 3:.20, 4:.10}
gender_ratio              male .60 / female .40（group 內同性別機率 .7）
booking_value             nights × group_size × nightly_rate
```

### 9.2 模擬迴圈

```
for each simulated day t in horizon:
    新訂單到達 → 加入 pending
    對每張 pending 訂單:
        跑 solve()，若無可行解 → reject，記錄 rejected_value
    套用 lock 規則
    記錄當日 KPI
```
**重點：必須逐日 replay，不可一次過把所有訂單餵給 solver。**
一次過餵 = 有未卜先知能力 = 高估系統表現，得出的 policy 比較會是假的。

### 9.3 輸出 KPI

`occupancy_rate, revenue, bed_nights_sold, rejected_bookings, rejected_value,
stranded_bed_nights, free_room_nights, infeasible_count`

### 9.4 Policy 比較

同一組 seed（預設 200 個 seed）分別跑 `same_gender / mixed / hybrid`，
輸出平均值 + 95% 區間的 markdown 表 + CSV。

**這份報告就是 Phase 0 的交付物。**
