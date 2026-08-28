# SplitBed — Domain Model / Schema

給 developer 直接照做。Phase 0（純 Python）先用 dataclass 實作同樣結構，
Phase 1 才落 PostgreSQL。**兩者欄位必須一致**，否則之後要重寫。

## 1. 核心層級

```
Property → Room → Bed
Booking  → Guest
Assignment: Guest × Room × DateRange
```

## 2. Tables

### property
| 欄位 | 型 | 備註 |
|---|---|---|
| id | uuid pk | |
| name | text | Sapporo / Yuzawa / Furano |
| timezone | text | 影響「今日」的定義 |
| default_policy | enum | same_gender / mixed / hybrid |
| policy_effective_from | date | null = 一直生效 |
| pending_policy | enum | null 表示無排程變更 |
| pending_policy_from | date | |

### room
| 欄位 | 型 | 備註 |
|---|---|---|
| id | uuid pk | |
| property_id | fk | |
| code | text | A / B / C / D |
| room_type | enum | `mixed / same_gender / female_only / male_only / private / staff / maintenance / manual_only` |
| sort_order | int | Calendar 顯示次序 |

`room_type` 是 room-level override。若為 null → 跟 property policy。

### bed
| 欄位 | 型 | 備註 |
|---|---|---|
| id | uuid pk | |
| room_id | fk | |
| code | text | B01 / B02 |
| position | enum | lower / upper / single |
| status | enum | available / out_of_service |
| out_of_service_from | date | nullable |
| out_of_service_to | date | nullable |

> **容量永遠由 bed 數算出來，room 不存 capacity 欄位。**
> `capacity(room, date) = count(bed where status=available or 該日不在停用區間)`
> 加床 = 新增一筆 bed；減床 = 設 out_of_service。歷史資料自然正確，
> 不需要另做 capacity 版本表。這是 v1 用來取代「effective date 容量版本化」的做法。

### booking
| 欄位 | 型 | 備註 |
|---|---|---|
| id | uuid pk | |
| property_id | fk | |
| reference | text | 對外單號 |
| source | enum | direct / booking_com / agoda / airbnb / expedia / agent / walk_in / phone / staff |
| booked_at | timestamptz | 用來算 lead time |
| check_in | date | |
| check_out | date | exclusive |
| status | enum | 見 00-master-brief §5 |
| total_value | numeric | 幣值 |
| currency | text | |
| payment_status | enum | unpaid / partial / paid |
| must_stay_together | bool | default true |
| allow_room_move | bool | **v1 一律 false** |
| requires_private_room | bool | |
| priority | int | 0 = 一般，越大越優先（VIP） |
| notes | text | |

### guest
| 欄位 | 型 | 備註 |
|---|---|---|
| id | uuid pk | |
| booking_id | fk | |
| name | text | |
| gender | enum | male / female / unspecified |
| birth_year | int | nullable |
| nationality | text | |
| accessibility_need | bool | 影響 bed 指派（下鋪） |
| check_in / check_out | date | 可與 booking 不同（同一 booking 內個別客人早退／晚到） |

> `gender = unspecified` 的處理是 hard rule：
> 在 same_gender 房，unspecified 只能安排到**尚未鎖定性別的房**，
> 且該客人本身不會令房間鎖定性別。在 mixed 房無限制。

### assignment
| 欄位 | 型 | 備註 |
|---|---|---|
| id | uuid pk | |
| guest_id | fk | |
| room_id | fk | |
| bed_id | fk nullable | 只有 check-in 後才填 |
| date_from / date_to | date | |
| lock_level | enum | `none / soft / hard` |
| is_current | bool | 現行安排 |
| created_by | enum | optimizer / staff |

### recommendation
Optimizer 每次跑產生一批建議，不直接改 assignment。

| 欄位 | 型 |
|---|---|
| id / run_id | uuid |
| guest_id | fk |
| from_room_id / to_room_id | fk |
| reason_code | text |
| impact_json | jsonb（見下）|
| status | pending / applied / dismissed |

`impact_json` 至少含：
```json
{ "stranded_bed_nights_delta": -6, "free_rooms_delta": 1,
  "rejected_value_delta": 0, "moves": 2 }
```

### audit_log
`entity, entity_id, field, old_value, new_value, actor, reason, created_at`
所有 assignment / policy / bed 變更都要寫。

## 3. Lock 規則（由排程每日跑，寫入 assignment.lock_level）

| 距離入住 | lock_level | 意義 |
|---|---|---|
| > 7 日 | none | 可自由重排 |
| 3–7 日 | soft | 可重排，但 stability penalty 加倍 |
| < 3 日 | soft→hard 由 manager 決定 | |
| 入住當日 | hard | optimizer 視為固定 |
| 已 check-in | hard | 禁止自動改，只有 manager override |

## 4. Policy 解析順序（唯一真相）

```
resolve_policy(room, date):
    if room.room_type is not null:      return room.room_type
    if property.pending_policy and date >= property.pending_policy_from:
                                        return property.pending_policy
    return property.default_policy
```

這個函式必須是**純函數**、獨立可測，Phase 0 就要寫好並有完整測試。
