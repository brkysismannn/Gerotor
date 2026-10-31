"""Performance map, filling-limited speed and GDS cavitation limits (port of js/perfmap.js).

Geometry, port opening areas and backlash gaps do not depend on the operating point; for each
point only the chamber network, the pressure torque and the friction model are re-evaluated.
"""
from __future__ import annotations

import math

import numpy as np

from .contact import compute_contact
from .friction import compute_mechanical
from .leakage import NET_SUB_DEFAULT, outlet_ripple, simulate_network

from .errors import require_analysis


def _linspace(a, b, n):
    return [a] if n <= 1 else [a + (b - a) * i / (n - 1) for i in range(n)]


def operating_point(p0, res, rpm, dp) -> dict:
    require_analysis(res, "operating_point", ("cc", "ripple"))
    p = dict(p0, rpm=rpm, dp=dp, simSub=p0.get("simSub") or NET_SUB_DEFAULT)
    qTheo = res["cc"] * 1e-6 * rpm / 60
    r = dict(res, ports=None, contact=None)
    etaV, ripple, pMax, voidMax, pRipple = 1.0, res["ripple"], p["pIn"] + dp, 0.0, math.nan
    ports = res.get("ports")
    if p.get("portsOn") and ports and ports.get("As") is not None and rpm > 0:
        sim = simulate_network(p, res, ports["As"], ports["Ad"], ports)
        Q = sim["Qout"]
        qMean = float(np.sum(Q)) / res["M"]
        pMax = max(pMax, float(sim["P"].max()) / 1e5)
        voidMax = max(0.0, float(sim["VF"].max()))
        etaV = qMean / qTheo
        ripple = (float(Q.max()) - float(Q.min())) / qMean
        r["ports"] = {"sim": sim, "portEfficiency": etaV}
        out = outlet_ripple(p, res, sim) if dp > 0 else None
        if out:
            pRipple = out["rippleRel"]
    if dp > 0:
        r["contact"] = compute_contact(p, r, quasi_static=not r["ports"])
    mech = compute_mechanical(p, r)
    ct = r["contact"]
    return {
        "rpm": rpm, "dp": dp, "flowLpm": etaV * qTheo * 6e4,
        "etaV": etaV, "etaM": mech["etaM"], "etaT": mech["etaT"],
        "torque": mech["Mshaft"], "powerIn": mech["powerIn"], "powerOut": mech["powerOut"],
        "ripple": ripple, "pMaxBar": pMax, "voidMax": voidMax, "pRipple": pRipple,
        "hertz": ct["pmaxMax"] if ct else math.nan,
        "sideLoad": ct["shaftLoadMax"] if ct else math.nan,
    }


def performance_map(p, res, rpm_min, rpm_max, n_rpm, dp_min, dp_max, n_dp) -> dict:
    speeds, pressures = _linspace(rpm_min, rpm_max, n_rpm), _linspace(dp_min, dp_max, n_dp)
    points = [operating_point(p, res, rpm, dp) for dp in pressures for rpm in speeds]
    return {"speeds": speeds, "pressures": pressures, "points": points}


def void_at(p0, res, rpm, dp) -> float:
    p = dict(p0, rpm=rpm, dp=dp, simSub=p0.get("simSub") or NET_SUB_DEFAULT)
    sim = simulate_network(p, res, res["ports"]["As"], res["ports"]["Ad"], res["ports"])
    return max(0.0, float(sim["VF"].max()))


P_ATM_BAR = 1.01325


def gds_cavitation_limits(p, res, head: str = "inlet", double_fill_area: bool = True) -> dict:
    """GDS "Calculation of Cavitation Limits" (2017).

    1. rotor tip: 1/2 rho V^2 = dP_avail, V = r_tip omega1  ->  n = 60 V / (2 pi r_tip)
    2. inlet gallery: round pipe of the suction-port area at Re = U D / nu = 2000  ->  n = U A / V_disp

    Named assumptions (researcher review 2026-10-30):
    A-D2 CAV_HEAD_INLET: dP_avail = p_in - p_vap (generalisation for boosted / throttled inlet).
         GDS p.3 uses dP = p_atm (101.3 kPa) - p_vap. ``head="atm"`` selects the GDS variant;
         identical when pIn = 1.01325 bar abs. Default "inlet" = JS behaviour.
    A-D4 CAV_AREA_DOUBLE_FILL: gallery area = suction-port area x fillS (both sides fed with
         double fill). GDS p.4 uses the "equivalent area of the inlet port" (single port).
         ``double_fill_area=False`` selects the GDS variant. Default True = JS behaviour.
    """
    require_analysis(res, "gds_cavitation_limits", ("cc",))
    if head not in ("inlet", "atm"):
        raise ValueError("head must be 'inlet' or 'atm'")
    pHead = p["pIn"] if head == "inlet" else P_ATM_BAR
    rho, dpAvail = p["rho"], (pHead - p["pVap"]) * 1e5
    V = math.sqrt(2 * dpAvail / rho) if dpAvail > 0 else 0.0
    rpmTip = 60 * V / (2 * math.pi * p["innerTip"] * 1e-3)
    rpmGallery = U = D = math.nan
    ports = res.get("ports")
    if ports and ports.get("suction"):
        fill = (p.get("fillS") or (2 if p.get("doubleFill") else 1)) if double_fill_area else 1
        A = ports["suction"]["area"] * 1e-6 * fill
        D = math.sqrt(4 * A / math.pi)
        U = 2000 * p["nu"] * 1e-6 / D
        rpmGallery = U * A / (res["cc"] * 1e-6) * 60
    rpm = min(rpmTip, math.inf if math.isnan(rpmGallery) else rpmGallery)
    return {"rpmTip": rpmTip, "rpmGallery": rpmGallery, "rpm": rpm,
            "basis": "rotor tip speed" if rpm == rpmTip else "inlet gallery velocity",
            "tipSpeed": V, "galleryU": U, "galleryD": D}


def max_speed(p, res, void_limit=0.005, dp=None, rpm_min=100, rpm_max=20000, tol=10) -> dict | None:
    """Highest speed with peak void fraction <= void_limit (bisection on rpm)."""
    require_analysis(res, "max_speed", ("cc",))
    ports = res.get("ports")
    if not (p.get("portsOn") and ports and ports.get("As") is not None):
        return None
    dp = p["dp"] if dp is None else dp
    lo, hi, evals = rpm_min, rpm_max, 0

    def ok(rpm):
        nonlocal evals
        evals += 1
        return void_at(p, res, rpm, dp) <= void_limit

    fill = p.get("fillS") or (2 if p.get("doubleFill") else 1)
    qPerRpm = res["cc"] * 1e-6 / 60
    rpmInlet = 2 * ports["suction"]["area"] * 1e-6 * fill / qPerRpm if ports.get("suction") else math.nan
    gds = gds_cavitation_limits(p, res)
    base = {"rpmInlet": rpmInlet, "limit": void_limit, "gds": gds}
    if not ok(lo):
        return dict(base, rpm=math.nan, below=lo, evals=evals)
    if ok(hi):
        return dict(base, rpm=hi, above=hi, evals=evals)
    while hi - lo > tol:
        mid = 0.5 * (lo + hi)
        if ok(mid):
            lo = mid
        else:
            hi = mid
    return dict(base, rpm=lo, evals=evals)
