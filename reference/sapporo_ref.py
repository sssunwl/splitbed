"""SplitBed 參考基線模擬 (throwaway audit baseline, NOT production code).
用途：給 Codex 的 WP 一個必須逼近的目標數字。貪心指派，非最佳化 —— 所以是下界。
三個 policy 用完全相同的 seed 與訂單序列，比較才有效。"""
import numpy as np

ROOMS = [("A", 2), ("B", 4), ("C", 3), ("D", 3)]
CAP = {c: n for c, n in ROOMS}
NAMES = [c for c, _ in ROOMS]
H = 90                    # 一季 = 90 晚
RATE = 5000               # JPY / bed-night (假設，見文件)
TOTAL_CAP = sum(CAP.values()) * H

STAY = {1: .05, 2: .15, 3: .20, 4: .15, 5: .10, 6: .10, 7: .15, 14: .07, 30: .03}
GROUP = {1: .30, 2: .40, 3: .20, 4: .10}
MALE = .60
SAME_G_GROUP = .70        # 同一 group 全部同性別的機率

POLICIES = {
    "same_gender": {c: "same_gender" for c in NAMES},
    "mixed":       {c: "mixed" for c in NAMES},
    "hybrid":      {"A": "same_gender", "B": "mixed", "C": "same_gender", "D": "same_gender"},
}

def pick(rng, dist):
    k = list(dist); p = np.array(list(dist.values()), float); p /= p.sum()
    return int(rng.choice(k, p=p))

def gen(rng, target_bn):
    out, tot = [], 0
    while tot < target_bn:
        n = pick(rng, GROUP); nights = pick(rng, STAY)
        ci = int(rng.integers(0, H)); co = min(ci + nights, H)
        if co <= ci: continue
        if n == 1 or rng.random() < SAME_G_GROUP:
            g = "M" if rng.random() < MALE else "F"; gs = [g] * n
        else:
            gs = ["M" if rng.random() < MALE else "F" for _ in range(n)]
        out.append(dict(ci=ci, co=co, gs=gs, t=ci - int(rng.geometric(1/14)),
                        bn=n * (co - ci)))
        tot += n * (co - ci)
    out.sort(key=lambda b: b["t"])
    return out

class State:
    def __init__(self):
        self.occ = {c: [0]*H for c in NAMES}
        self.m   = {c: [0]*H for c in NAMES}
        self.f   = {c: [0]*H for c in NAMES}

def can(st, r, ci, co, gs, pol):
    if any(st.occ[r][d] + len(gs) > CAP[r] for d in range(ci, co)): return False
    if pol == "same_gender":
        u = set(gs)
        if len(u) > 1: return False
        other = st.f if u == {"M"} else st.m
        if any(other[r][d] > 0 for d in range(ci, co)): return False
    return True

def score(st, r, ci, co, n):
    fresh = all(st.occ[r][d] == 0 for d in range(ci, co))
    leftover = sum(CAP[r] - st.occ[r][d] - n for d in range(ci, co))
    return (10 * (co - ci) if fresh else 0) + leftover

def place(st, r, ci, co, gs):
    for d in range(ci, co):
        st.occ[r][d] += len(gs)
        st.m[r][d] += gs.count("M"); st.f[r][d] += gs.count("F")

def try_book(st, b, pol):
    ci, co, gs = b["ci"], b["co"], b["gs"]
    cands = [r for r in NAMES if can(st, r, ci, co, gs, pol[r])]
    if cands:
        r = min(cands, key=lambda r: score(st, r, ci, co, len(gs)))
        place(st, r, ci, co, gs); return b["bn"], 0
    sold, split = 0, 1
    for g in gs:                                     # fallback: 拆房
        c2 = [r for r in NAMES if can(st, r, ci, co, [g], pol[r])]
        if c2:
            r = min(c2, key=lambda r: score(st, r, ci, co, 1))
            place(st, r, ci, co, [g]); sold += co - ci
    return sold, split if sold else 0

def run(seed, demand_ratio):
    rng0 = np.random.default_rng(seed)
    bookings = gen(rng0, TOTAL_CAP * demand_ratio)
    res = {}
    for name, pol in POLICIES.items():
        st, sold, splits, req = State(), 0, 0, 0
        for b in bookings:
            req += b["bn"]
            s, sp = try_book(st, b, pol); sold += s; splits += sp
        strand = sum(
            (CAP[r] - st.occ[r][d]) for r in NAMES for d in range(H)
            if pol[r] != "mixed" and st.occ[r][d] > 0
        )
        res[name] = dict(sold=sold, rev=sold * RATE, lost=req - sold,
                         occ=sold / TOTAL_CAP, strand=strand, splits=splits)
    return res

def ci95(a):
    a = np.array(a, float); return a.mean(), 1.96 * a.std(ddof=1) / np.sqrt(len(a))

SEEDS = range(200)
print(f"Sapporo 12 床 × {H} 晚 = {TOTAL_CAP} bed-nights；rate ¥{RATE:,}/晚；200 seeds\n")
print(f"{'需求':>6} {'policy':<12} {'入住率':>7} {'季收入(¥)':>13} {'±':>9} "
      f"{'vs same-gender':>15} {'流失bn':>8} {'stranded':>9} {'拆房單':>7}")
for dr in (0.70, 0.85, 1.00, 1.15, 1.30):
    base = None
    for name in POLICIES:
        rows = [run(s, dr)[name] for s in SEEDS]
        rev, e = ci95([r["rev"] for r in rows])
        occ = np.mean([r["occ"] for r in rows])
        lost = np.mean([r["lost"] for r in rows])
        strand = np.mean([r["strand"] for r in rows])
        sp = np.mean([r["splits"] for r in rows])
        if base is None: base = rev
        d = "" if name == "same_gender" else f"+¥{rev-base:>11,.0f}"
        print(f"{dr:>6.0%} {name:<12} {occ:>6.1%} {rev:>13,.0f} {e:>9,.0f} "
              f"{d:>15} {lost:>8.0f} {strand:>9.0f} {sp:>7.1f}")
    print()
