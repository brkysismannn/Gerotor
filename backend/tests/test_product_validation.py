"""Validation against real products (docs/validation-products/products.csv, 300 rows).

Derivation and per-row results: docs/validation.md (section "Product validation") and
company/reports/2026-10-31-design-sim-engineer-product-validation.md.

Tolerances (owner rule no-unexplained-numbers)
----------------------------------------------
* Printed-digit rounding: a value printed with d decimals is known to +-0.5 10^-d. For a
  product/quotient the relative errors add: tol = sum(h_i / x_i). Values converted from in3
  use the rounding of the original in3 digits. Speeds are exact integers (h = 0).
* Geometry band (Adamjee): the catalogue gives N, e, inner tip diameter Dt and outer form
  (minor) diameter Dl, but not the lobe radius rp. With c = 0, R - rp = Dl/2 is fixed and rp
  is free inside its valid interval (rp > e: lobes reach the tangent valley Rv = R + 2e - rp;
  R > N e: no trochoid loops; rp < rho_min: no undercut). The theoretical displacement is
  evaluated at RP_POINTS interior points of that interval; the band (max - min)/2 / mean is
  added to the tolerance. It is a model-input uncertainty, not a fitted factor.
* Expected deviations are listed explicitly (sets below) and asserted as sets, so a new
  deviation or a disappearing one both fail the test.
"""
from __future__ import annotations

import csv
import math
import pathlib
import re

import pytest

import examples
from gerotor_core import geometry as g

CSV = pathlib.Path(__file__).resolve().parents[2] / "docs" / "validation-products" / "products.csv"

VENDOR_FRACTION = 0.95       # Adamjee footnote: printed displacement = 95 % of theoretical
ADAMJEE_RPM = 1500           # Adamjee: flow calculated at 1500 rpm (source header)
RP_POINTS = 5                # numerical setting: rp samples; 5 -> 11 moves the mean < 0.02 %, band < 0.05 %-pt (report)
BISECT_STEPS = 50            # numerical setting: undercut limit to 2^-50 of the rp interval


def load_rows():
    with open(CSV, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


ROWS = load_rows()


def half_ulp(s: str) -> float:
    s = s.strip()
    d = len(s.split(".")[1]) if "." in s else 0
    return 0.5 * 10.0 ** (-d)


def rel(s: str) -> float:
    return half_ulp(s) / float(s)


def disp_rel(r) -> float:
    """Relative rounding of the displacement, from the digits it was printed with."""
    m = re.match(r"\s*([\d.]+)\s*in3", r["displacement_as_given"])
    if m:  # converted from in3: rounding of the original digits
        return half_ulp(m[1]) / float(m[1])
    return rel(r["displacement_cm3_rev"])


def tags(r):
    return set(r["supports"].split("|"))


# ------------------------------------------------------------------ Adamjee geometry (DISP)

ADAMJEE = [r for r in ROWS if "DISP" in tags(r)]
LIST2 = [r for r in ADAMJEE if "list 2" in r["series"]]


def part_key(model: str) -> frozenset:
    return frozenset(re.findall(r"\d{3}", model.split("PMP", 1)[1].split()[0]))


def list2_diameters():
    out = {}
    for r in LIST2:
        m = re.search(r"tip dia inner ([\d.]+).*form dia outer ([\d.]+)", r["notes"])
        out[part_key(r["model"])] = (float(m[1]), float(m[2]))
    return out


DIAM = list2_diameters()


def _design(N, e, a, rp, OD):
    return examples.design(N=N, e=e, R=a + rp, rp=rp, b=10.0, OD=OD, c=0, RvClear=0, bore=0)


def rp_interval(N, e, a, OD):
    lo = max(e, N * e - a)
    def ok(rp):
        return rp < g.min_convex_curvature(_design(N, e, a, rp, OD))
    hi = lo + a  # rho_min shrinks as rp grows at fixed R - rp; find the undercut limit
    while ok(hi):
        hi += a
    x, y = lo, hi
    for _ in range(BISECT_STEPS):
        m = 0.5 * (x + y)
        x, y = (m, y) if ok(m) else (x, m)
    return lo, x


_GEO_CACHE: dict = {}


def theoretical_per_cm(N, e, Dl, OD):
    """Theoretical displacement per 10 mm width [cm3/rev] and its rp band (relative half width)."""
    key = (N, e, Dl, OD)
    if key not in _GEO_CACHE:
        a = Dl / 2
        lo, hi = rp_interval(N, e, a, OD)
        vals = []
        for k in range(RP_POINTS):
            rp = lo + (k + 0.5) / RP_POINTS * (hi - lo)
            res = g.analyse(_design(N, e, a, rp, OD), sub_models=False)
            if res["valid"]:
                vals.append(res["cc"])
        assert vals, f"no valid rp for N={N} e={e} Dl={Dl}"
        mean = sum(vals) / len(vals)
        _GEO_CACHE[key] = (mean, (max(vals) - min(vals)) / 2 / mean, lo, hi, len(vals))
    return _GEO_CACHE[key]


def adamjee_row(r):
    N, e = int(r["teeth_outer"]), float(r["eccentricity_mm"])
    Dt, Dl = DIAM[part_key(r["model"])]
    v10, band, lo, hi, n = theoretical_per_cm(N, e, Dl, float(r["rotor_OD_mm"]))
    b = float(r["rotor_width_mm"])
    D = float(r["displacement_cm3_rev"])
    V = v10 * b / 10
    tol = rel(r["displacement_cm3_rev"]) + band + rel(r["rotor_width_mm"])
    return dict(model=r["model"], N=N, e=e, Dt=Dt, Dl=Dl, b=b, D=D, V=V, band=band, rp=(lo, hi),
                ratio=D / V, err95=D / (VENDOR_FRACTION * V) - 1, tol=tol,
                ok95=abs(D / (VENDOR_FRACTION * V) - 1) <= tol, ok100=abs(D / V - 1) <= tol)


# Rows whose printed displacement IS consistent with "95 % of theoretical" within tolerance.
CONSISTENT_95 = {
    "C10 086 PMP-663/664 3/4-A (min height)",
    "C10 086 PMP-663/664 3/4-A (max height)",
}
# Catalogue typos (vendor-internal, see INCONSISTENT_PER_HEIGHT): excluded from the statistics.
TYPO_ROWS = {
    "PMP/784-785 4/5 Lobe (industrial)",            # 14.58 = half of 1.148 x 25.4 = 29.16
    "PMP/814-815 10/11 Lobe (Suzuki 16100-82605)",  # 7.87 vs 0.876 x 8 = 7.01 (flow 10.51 = 1.5 x 7.01)
}
# Printed / theoretical per row (tool result at the time of validation, 4 decimals). Regression
# pin: tolerance = row tolerance (rounding + rp band), so a change of the displacement model shows.
PINNED_RATIO = {
    'C10 086 PMP-663/664 3/4-A (min height)': 0.9535,
    'C10 086 PMP-663/664 3/4-A (max height)': 0.9535,
    'C10 087 PMP-149/362 4/5-A (min height)': 0.9692,
    'C10 087 PMP-149/362 4/5-A (max height)': 0.9692,
    'C10 088 PMP-611/612 4/5-B (min height)': 0.9655,
    'C10 088 PMP-611/612 4/5-B (max height)': 0.9652,
    'C10 089 PMP-141/142/143 4/5-C (min height)': 1.0033,
    'C10 089 PMP-141/142/143 4/5-C (max height)': 1.0042,
    'C10 090 PMP-559/560 4/5-D (min height)': 1.0425,
    'C10 090 PMP-559/560 4/5-D (max height)': 1.0429,
    'C10 139 PMP-784/785 4/5-E (min height)': 1.0235,
    'C10 139 PMP-784/785 4/5-E (max height)': 1.0246,
    'C10 091 PMP-582/583 6/7-A (min height)': 1.0191,
    'C10 091 PMP-582/583 6/7-A (max height)': 1.0194,
    'C10 092 PMP-674/675 6/7-B (min height)': 1.0187,
    'C10 092 PMP-674/675 6/7-B (max height)': 1.0190,
    'C10 093 PMP-651/652 7/8-A (min height)': 1.0632,
    'C10 093 PMP-651/652 7/8-A (max height)': 1.0531,
    'C10 094 PMP-458/459 8/9-A (min height)': 0.9808,
    'C10 094 PMP-458/459 8/9-A (max height)': 0.9838,
    'C10 095 PMP-685/686 8/9-B (min height)': 1.0397,
    'C10 095 PMP-685/686 8/9-B (max height)': 1.0380,
    'C10 160 PMP-814/815 10/11-A (min height)': 1.0131,
    'C10 160 PMP-814/815 10/11-A (max height)': 1.0140,
    'PMP/663-664 3/4 Lobe (Perkins/Massey Ferguson)': 0.9934,
    'PMP/362-149 4/5 Lobe (Perkins/Massey Ferguson 135)': 1.0215,
    'PMP/611-612 4/5 Lobe (sports cars)': 0.9654,
    'PMP/141-143/142 4/5 Lobe (industrial)': 1.0164,
    'PMP/559-560 4/5 Lobe (Ford Transit)': 1.0167,
    'PMP/784-785 4/5 Lobe (industrial)': 0.5129,
    'PMP/582-583 6/7 Lobe (Perkins/Massey Ferguson 375/385)': 1.0177,
    'PMP/674-675 6/7 Lobe (Ford tractor 6610-7000)': 1.0170,
    'PMP/651-652 7/8 Lobe (Honda 125cc)': 1.0463,
    'PMP/458-459 8/9 Lobe (automotive)': 0.9764,
    'PMP/685-686 8/9 Lobe (automotive)': 1.0388,
    'PMP/814-815 10/11 Lobe (Suzuki 16100-82605)': 1.1390,
}


def test_adamjee_inner_tip_matches_form_diameter():
    """Dt = Dl + 2e - 2c (geometry.derive): the clearance c implied by the catalogue must be
    >= 0 and below e (a real running clearance), except the 3/4 part whose tip is 'flat to tip'
    (truncated, so Dt is not the trochoid tip)."""
    bad = set()
    for r in LIST2:
        Dt, Dl = DIAM[part_key(r["model"])]
        c = (Dl - Dt) / 2 + float(r["eccentricity_mm"])
        if not (0 <= c < float(r["eccentricity_mm"])):
            bad.add(r["model"])
    assert bad == {"PMP/663-664 3/4 Lobe (Perkins/Massey Ferguson)"}


@pytest.mark.parametrize("r", ADAMJEE, ids=[r["model"] for r in ADAMJEE])
def test_adamjee_95_percent_claim(r):
    x = adamjee_row(r)
    assert x["ok95"] == (r["model"] in CONSISTENT_95), x


@pytest.mark.parametrize("r", ADAMJEE, ids=[r["model"] for r in ADAMJEE])
def test_adamjee_ratio_pinned(r):
    x = adamjee_row(r)
    assert x["ratio"] == pytest.approx(PINNED_RATIO[r["model"]], abs=x["tol"] + 0.5e-4), x


# ------------------------------------------------------------------ Adamjee vendor-internal

def per_height(r):
    m = re.search(r"([\d.]+) cm3/rev per cm height", r["displacement_as_given"])
    if m:
        return m[1], 10.0
    m = re.search(r"\(([\d.]+) cc/rev/mm\)", r["displacement_as_given"])
    return m[1], 1.0


INCONSISTENT_PER_HEIGHT = {
    "PMP/663-664 3/4 Lobe (Perkins/Massey Ferguson)",  # 0.406 x 35.4 = 14.37 vs 14.20 (-1.2 %)
    "PMP/559-560 4/5 Lobe (Ford Transit)",             # 0.867 x 34 = 29.48 vs 29.40 (-0.26 %)
    "PMP/784-785 4/5 Lobe (industrial)",               # 14.58 = half of 1.148 x 25.4
    "PMP/814-815 10/11 Lobe (Suzuki 16100-82605)",     # 0.876 x 8 = 7.01 vs 7.87 (+12.3 %)
}


def per_height_ok(r):
    s, unit = per_height(r)
    D = float(r["displacement_cm3_rev"])
    pred = float(s) * float(r["rotor_width_mm"]) / unit
    tol = rel(s) + rel(r["rotor_width_mm"]) + rel(r["displacement_cm3_rev"])
    return abs(D / pred - 1) <= tol, D / pred - 1, tol


@pytest.mark.parametrize("r", ADAMJEE, ids=[r["model"] for r in ADAMJEE])
def test_adamjee_per_height_consistency(r):
    ok, err, tol = per_height_ok(r)
    assert ok == (r["model"] not in INCONSISTENT_PER_HEIGHT), (err, tol)


# ------------------------------------------------------------------ flow vs speed (FLOW)

def is_ocr(r):
    return "OCR-sourced" in r["notes"]


# Rated-point pumps whose flow is a delivered (measured) flow at a stated pressure (Rexroth PGZ,
# OCR-sourced): Q = eta_v D n, so only the physical bound eta_v <= 1 is checkable (see below).
MEASURED_ROWS = [r for r in ROWS if is_ocr(r) and "FLOW" in tags(r) and r["flow_at_rpm"]]
PUMP_ROWS = [r for r in ROWS if tags(r) & {"FLOW", "FLOW_calc"} and r["flow_at_rpm"] and r not in MEASURED_ROWS]
MOTOR_ROWS = [r for r in ROWS if "FLOW" in tags(r) and not r["flow_at_rpm"]]


def pump_check(r):
    D, Q, n = float(r["displacement_cm3_rev"]), float(r["flow_l_min"]), float(r["flow_at_rpm"])
    k = Q * 1000 / (D * n)
    tol = disp_rel(r) + rel(r["flow_l_min"])
    return k, tol, abs(k - 1) <= tol


PUMP_DEVIATIONS = {
    # Adamjee list 2 (vendor: "l/min approximate"); list 1 and Parker/SKF/Vogel all pass.
    "PMP/663-664 3/4 Lobe (Perkins/Massey Ferguson)",      # 21.55 = 1.5 x 14.37 (per-mm value), not 14.20
    "PMP/362-149 4/5 Lobe (Perkins/Massey Ferguson 135)",  # 11.90 vs 11.865 (+0.29 %)
    "PMP/141-143/142 4/5 Lobe (industrial)",               # 11.40 vs 11.475 (-0.65 %)
    "PMP/559-560 4/5 Lobe (Ford Transit)",                 # 44.00 vs 44.10 (-0.23 %)
    "PMP/784-785 4/5 Lobe (industrial)",                   # 43.74 = 1.5 x 29.16; printed 14.58 is half
    "PMP/674-675 6/7 Lobe (Ford tractor 6610-7000)",       # 71.00 vs 71.07 (-0.10 %)
    "PMP/814-815 10/11 Lobe (Suzuki 16100-82605)",         # 10.51 = 1.5 x 7.01, not 7.87
}


@pytest.mark.parametrize("r", PUMP_ROWS, ids=[r["model"] for r in PUMP_ROWS])
def test_pump_flow_equals_displacement_times_speed(r):
    k, tol, ok = pump_check(r)
    assert ok == (r["model"] not in PUMP_DEVIATIONS), (k, tol)


def motor_check(r):
    """Motor: continuous max flow Q and max speed n. Physics: n D <= Q (eta_v <= 1)."""
    D, Q, n = float(r["displacement_cm3_rev"]), float(r["flow_l_min"]), float(r["speed_max_rpm"])
    eta = D * n / (1000 * Q)  # lower bound of the volumetric efficiency implied by the row
    tol = disp_rel(r) + rel(r["flow_l_min"])
    return eta, tol, eta <= 1 + tol


# Rows where the continuous max speed needs more flow than the continuous max flow (eta_v > 1):
# vendor-internal (the speed limit is evidently stated for a different flow, e.g. intermittent).
MOTOR_VIOLATIONS = {
    'EBMER 540',
    'EBMH 500',
    'EBMR 100',
    'EBMR 250',
    'EBMR 80',
    'EBMT 160',
    'EBMT 200',
    'EBMT 250',
    'EBMT 500',
    'EBMV 315',
    'EBMV 400',
    'EBMV 500',
    'EBMV 630',
    'TMT 250',
    'TMT 470',
    'TMT 630',
    'TMTHW 315',
    'WD200',
    'WP060',
    'WP080',
    'WP100',
    'WP125',
    'WP160',
    'WP200',
    'WP250',
    'WP315',
    'WR250',
}


@pytest.mark.parametrize("r", MOTOR_ROWS, ids=[r["model"] for r in MOTOR_ROWS])
def test_motor_speed_flow_bound(r):
    eta, tol, ok = motor_check(r)
    assert ok == (r["model"] not in MOTOR_VIOLATIONS), (eta, tol)


# ------------------------------------------------------------------ partial geometry (GEO_width)

WIDTH_ROWS = [r for r in ROWS if "GEO_width" in tags(r)]


def width_series():
    out: dict = {}
    for r in WIDTH_ROWS:
        out.setdefault(r["series"], []).append(r)
    return out


def width_check(rows):
    """Displacement is proportional to gerotor width b for a fixed profile (analyse: cc ~ b).
    Each row's D/b must agree with the series median within the summed rounding of both."""
    res = []
    for r in rows:
        q = float(r["displacement_cm3_rev"]) / float(r["rotor_width_mm"])
        t = rel(r["displacement_cm3_rev"]) + rel(r["rotor_width_mm"])
        res.append((r["model"], q, t))
    return res


WIDTH_OUTLIERS = {"H-040"}  # 40 cm3 at X = 7.0 mm, same width as H-050 (51 cm3): source as printed


def test_width_proportionality():
    out = set()
    for series, rows in width_series().items():
        res = width_check(rows)
        _, med, tmed = sorted(res, key=lambda x: x[1])[len(res) // 2]
        for m, q, t in res:
            if abs(q / med - 1) > t + tmed:
                out.add(m)
    assert out == WIDTH_OUTLIERS


def test_tool_flow_is_displacement_times_speed():
    """Tool identity used above: analyse flowLpm = cc rpm / 1000."""
    p = _design(5, 4.0, 35.4 / 2, 8.0, 61.03)
    res = g.analyse(p, sub_models=False)
    assert res["flowLpm"] == pytest.approx(res["cc"] * p["rpm"] / 1000, rel=1e-12)


# ------------------------------------------------------------------ OCR-sourced rated points (PGZ)
# Tolerance: printed-digit rounding as for text rows. OCR misreads (dropped/shifted digits) cannot
# be bounded by a number, so OCR rows are checked only against physics (0 < eta_v <= 1 + tol) and
# against each other: PGZ4 and PGZ5 with the same displacement must print the same flow.

def measured_eta(r):
    D, Q, n = float(r["displacement_cm3_rev"]), float(r["flow_l_min"]), float(r["flow_at_rpm"])
    return Q * 1000 / (D * n), disp_rel(r) + rel(r["flow_l_min"])


@pytest.mark.parametrize("r", MEASURED_ROWS, ids=[r["model"] for r in MEASURED_ROWS])
def test_ocr_pump_volumetric_efficiency_bound(r):
    eta, tol = measured_eta(r)
    assert 0 < eta <= 1 + tol, (eta, tol)


def test_ocr_pgz_frame_sizes_agree():
    by_d: dict = {}
    for r in MEASURED_ROWS:
        by_d.setdefault(r["displacement_cm3_rev"], set()).add(r["flow_l_min"])
    assert all(len(v) == 1 for v in by_d.values()), by_d
    assert len(MEASURED_ROWS) == 10


# ------------------------------------------------------------------ Eagle performance points
# Motor: eta_v = Vg n / Q, eta_hm = 2 pi T / (Vg dp) = 20 pi T[Nm] / (Vg[cm3] dp[bar]),
# eta = eta_v eta_hm. Tolerance = printed-digit rounding of each factor. Points above 1 + tol are
# source issues. gerotor_core leakage/friction cannot be applied: no Eagle profile (N, e, R, rp)
# or clearance is published; no clearance is fitted. Trend check is model-free (see report).

PP_CSV = CSV.parent / "performance_points.csv"
with open(PP_CSV, encoding="utf-8", newline="") as _f:
    POINTS = list(csv.DictReader(_f))


def point_eff(x):
    D, Q, p, n, T = (float(x[k]) for k in ("displacement_cm3_rev", "flow_l_min", "pressure_drop_bar",
                                           "speed_rpm", "torque_Nm"))
    ev = D * n / (1000 * Q)
    eh = 20 * math.pi * T / (D * p)
    tv = rel(x["displacement_cm3_rev"]) + rel(x["flow_l_min"]) + rel(x["speed_rpm"])
    th = rel(x["displacement_cm3_rev"]) + rel(x["torque_Nm"]) + rel(x["pressure_drop_bar"])
    return ev, eh, tv, th


def point_key(x):
    return (x["model"], x["page"], x["flow_l_min"], x["pressure_drop_bar"])


# Expected impossible points (eta_v or eta_hm > 1 + rounding): 23 + 6 rows, see report table E.
EXPECTED_IMPOSSIBLE_V = 23
EXPECTED_IMPOSSIBLE_HM = 6


def test_performance_points_impossible_set():
    v = [x for x in POINTS if point_eff(x)[0] > 1 + point_eff(x)[2]]
    h = [x for x in POINTS if point_eff(x)[1] > 1 + point_eff(x)[3]]
    assert len(POINTS) == 6256
    assert (len(v), len(h)) == (EXPECTED_IMPOSSIBLE_V, EXPECTED_IMPOSSIBLE_HM)
    assert all(float(x["torque_Nm"]) > 0 and float(x["speed_rpm"]) > 0 for x in POINTS)


def _series(key_fixed, key_var):
    out: dict = {}
    for x in POINTS:
        out.setdefault((x["model"], x["page"], x[key_fixed]), []).append(x)
    return [sorted(v, key=lambda y: float(y[key_var])) for v in out.values() if len(v) >= 2]


def trend_fractions():
    """Leakage grows with dp (tool leakage model: Poiseuille gaps, Q_L ~ dp h^3 / mu).
    (a) at fixed flow, eta_v must not rise with dp; (b) at fixed dp, eta_v must not fall with
    flow (Q_L roughly independent of speed). A step counts as a violation only beyond rounding."""
    res = {}
    for name, fixed, var, sign in (("a", "flow_l_min", "pressure_drop_bar", 1),
                                   ("b", "pressure_drop_bar", "flow_l_min", -1)):
        ok = tot = 0
        for s in _series(fixed, var):
            for u, w in zip(s, s[1:]):
                eu, _, tu, _ = point_eff(u)
                ew, _, tw, _ = point_eff(w)
                tot += 1
                ok += sign * (ew - eu) <= (tu + tw) * max(eu, ew)
        res[name] = (ok, tot)
    return res


def test_performance_points_leakage_trend():
    r = trend_fractions()
    for name, (ok, tot) in r.items():
        assert (ok, tot) == PINNED_TREND[name], (name, ok, tot)


# Measured (ok, total) step counts. (a) is partly enforced by the grid parser's plausibility
# filter ("speed not rising with pressure"), so it is not independent evidence; (b) is not filtered.
PINNED_TREND = {"a": (5321, 5323), "b": (5365, 5476)}
