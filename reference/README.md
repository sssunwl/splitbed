# reference/

一次性審查腳本，**不是產品程式碼，不要 import，不要維護成正式模組**。

- `sapporo_ref.py` — policy 比較的參考基線。Python 3 + numpy。
  跑法：`python3 reference/sapporo_ref.py`（直接印出比較表）

用途：作為 WP-3（TypeScript 模擬器）的驗收基準。
TS 模擬器在相同假設下必須重現同樣的結論與相近的數量級（誤差 <5%）。
若對不上，先懷疑 TS 那邊，因為這份腳本的邏輯經過人工核對。

腳本內的房價、需求分佈全部是**假設值**，不是任何真實營運數字。
