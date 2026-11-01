"""Clearance tolerance -> intervals of eta_v, eta_hm and eta (port of js/tolerance.js).

Method (docs/tolerance.md):
* Axes = the toleranced clearances (c, axialClr, odClr, jbClr), each a user band [min, max].
* An axis on which eta_v and eta_hm are monotone (shown by the monotonicity tests,
  tests/test_tolerance.py) is sampled at its two ends ("corners"): for a function that is monotone in
  each variable the extreme values lie on the vertices of the box, so the vertex values are the exact
  interval (no sampling error).
* An axis on which monotonicity FAILS is sampled on a uniform grid of ``GRID_LEVELS`` points
  ("grid") and each interior local extremum is refined by the vertex of the parabola through the
  three neighbouring points. Monotonicity test result 2026-10-31: eta_hm is NOT monotone in the tip
  clearance c (shallow minimum, pressure torque vs leakage), so c is a grid axis; eta_v is monotone in
  c, axialClr; eta_hm is monotone in axialClr, odClr, jbClr (tests/test_tolerance.py).
* eta = eta_v eta_hm: eta_v falls and eta_hm rises with clearance, so the product is not monotone and
  the corner values do not bound it. Reported: the guaranteed enclosure
  [min eta_v min eta_hm, max eta_v max eta_hm] (both factors positive) and, separately, the range of
  eta_v eta_hm over the evaluated points ("evaluated", not a bound).
The design callback receives the clearance overrides in INPUT units / conventions (A-D3, A-D5).
"""
from __future__ import annotations

import itertools

KEYS = ("c", "axialClr", "odClr", "jbClr")
# axis -> sampling method; set by the monotonicity tests (see module docstring).
AXIS_METHOD = {"c": "grid", "axialClr": "corners", "odClr": "corners", "jbClr": "corners"}
# Grid points on a non-monotone axis: numerical setting, convergence in docs/tolerance.md
# (5 vs 9 vs 17 levels; interval change below the parabolic refinement estimate).
GRID_LEVELS = 5
# clearances that enter only the friction model: a change needs no new network / geometry run
MECH_ONLY = ("odClr", "jbClr")


def check_bands(tol: dict, nominal: dict) -> dict:
    """Validated bands {key: (min, max)}; ValueError on unknown key, min > max or nominal outside the band."""
    out = {}
    for k, b in (tol or {}).items():
        if k not in KEYS:
            raise ValueError(f"clearanceTolerance: unknown clearance '{k}' (allowed: {', '.join(KEYS)})")
        if not isinstance(b, dict) or b.get("min") is None or b.get("max") is None:
            raise ValueError(f"clearanceTolerance.{k}: needs min and max")
        lo, hi = float(b["min"]), float(b["max"])
        nom = nominal.get(k)
        if not (0 <= lo <= hi):
            raise ValueError(f"clearanceTolerance.{k}: need 0 <= min <= max")
        if nom is None or not (lo <= nom <= hi):
            raise ValueError(f"clearanceTolerance.{k}: nominal {nom} is outside [{lo}, {hi}]")
        out[k] = (lo, hi)
    return out


def levels(band, method):
    lo, hi = band
    if hi == lo:
        return [lo]
    if method == "corners":
        return [lo, hi]
    n = GRID_LEVELS
    return [lo + (hi - lo) * i / (n - 1) for i in range(n)]


def series_extrema(vals):
    """(min, max, refinement) of a series on a uniform grid; interior local extrema refined by the
    vertex of the parabola through the three neighbouring points; refinement = largest vertex shift."""
    lo, hi, ref = min(vals), max(vals), 0.0
    for i in range(1, len(vals) - 1):
        f0, f1, f2 = vals[i - 1], vals[i], vals[i + 1]
        curv = f0 - 2 * f1 + f2
        if curv == 0:
            continue
        fv = f1 - (f2 - f0) ** 2 / (8 * curv)
        if curv > 0 and f1 <= f0 and f1 <= f2:
            lo = min(lo, fv)
            ref = max(ref, abs(f1 - fv))
        elif curv < 0 and f1 >= f0 and f1 >= f2:
            hi = max(hi, fv)
            ref = max(ref, abs(f1 - fv))
    return lo, hi, ref


def interval(make_design, analyse, op_point, bands: dict) -> dict:
    """Intervals of eta_v, eta_hm (etaM) and eta over the clearance box.

    make_design(overrides) -> core design dict;  analyse(p) -> res;
    op_point(p, res, mech_designs) -> {"etaV", "etaM", "mechEtaM": [...]} with one etaM per mech design.
    """
    axes = {k: {"min": b[0], "max": b[1], "method": AXIS_METHOD[k], "levels": levels(b, AXIS_METHOD[k])}
            for k, b in bands.items()}
    order = [k for k in KEYS if k in axes]
    grid_keys = [k for k in order if axes[k]["method"] == "grid"]
    corner_keys = [k for k in order if axes[k]["method"] == "corners"]
    net_corner = [k for k in corner_keys if k not in MECH_ONLY]
    mech_corner = [k for k in corner_keys if k in MECH_ONLY]
    lv = lambda ks: [dict(zip(ks, v)) for v in itertools.product(*(axes[k]["levels"] for k in ks))]  # noqa: E731
    mech_sets = lv(mech_corner)
    # samples[(net_corner combo index, mech combo index)] = list over the grid combos of (etaV, etaM)
    grid_sets = lv(grid_keys)
    net_sets = lv(net_corner)
    eta_v = {}
    eta_m = {}
    runs = 0
    analyses = {}
    for gi, g in enumerate(grid_sets):
        for ni, nc in enumerate(net_sets):
            p = make_design(dict(g, **nc))
            key = tuple(sorted(g.items()))  # geometry depends on c only; axialClr does not change it
            if key not in analyses:
                analyses[key] = analyse(p)
            res = analyses[key]
            mds = [make_design(dict(g, **nc, **m)) for m in mech_sets]
            r = op_point(p, res, mds)
            runs += 1
            for mi in range(len(mech_sets)):
                eta_v[(ni, gi)] = r["etaV"]
                eta_m[(ni, mi, gi)] = r["mechEtaM"][mi]
    ng = len(grid_sets)

    # grid axes: refinement only along a single grid axis (c); with several grid axes plain min/max
    def ext(vals):
        return series_extrema(vals) if len(grid_keys) == 1 else (min(vals), max(vals), 0.0)

    v_lo = v_hi = None
    m_lo = m_hi = None
    t_lo = t_hi = None
    ref = 0.0
    for ni in range(len(net_sets)):
        sv = [eta_v[(ni, gi)] for gi in range(ng)]
        a, b, rf = ext(sv)
        v_lo, v_hi, ref = (a if v_lo is None else min(v_lo, a)), (b if v_hi is None else max(v_hi, b)), max(ref, rf)
        for mi in range(len(mech_sets)):
            sm = [eta_m[(ni, mi, gi)] for gi in range(ng)]
            a, b, rf = ext(sm)
            m_lo, m_hi, ref = (a if m_lo is None else min(m_lo, a)), (b if m_hi is None else max(m_hi, b)), max(ref, rf)
            st = [x * y for x, y in zip(sv, sm)]
            a, b, rf = ext(st)
            t_lo, t_hi = (a if t_lo is None else min(t_lo, a)), (b if t_hi is None else max(t_hi, b))
    return {
        "method": "vertex enumeration on monotone axes, grid + parabolic refinement on non-monotone axes",
        "axes": axes, "networkRuns": runs, "analyses": len(analyses),
        "etaV": [v_lo, v_hi], "etaM": [m_lo, m_hi],
        "etaT": [v_lo * m_lo, v_hi * m_hi], "etaTBasis": "enclosure [min eta_v min eta_hm, max eta_v max eta_hm]",
        "etaTEvaluated": [t_lo, t_hi], "refinement": ref,
    }
