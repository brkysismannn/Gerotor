"""Multi-chamber lumped-parameter model with internal leakage (port of js/leakage.js).

All quantities SI internally (geometry inputs mm -> m). Components (1:1 with docs/lumped-model.md
and the Modelica export):

    Chamber volume k   dp_k/dt = K/V_k (sum Q_in,k - dV_k/dt)   (+ cavitation void volume)
    Port orifice       Q = sgn(dp) Cd A sqrt(2 |dp| / rho)
    Tip / flank gap    laminar flow between two cylinders (min gap h, equivalent radius rho_eq),
                       Reynolds with h(x) = h + x^2/(2 rho_eq):
                           Q = 2 b h^{5/2} dp / (9 pi mu sqrt(2 rho_eq))
    Axial face gap     radial Poiseuille across an annular sector of angle theta:
                           Q = theta h^3 dp / (12 mu ln(r2/r1))
    Port land          slot flow  Q = w h^3 dp / (12 mu L)
    Periphery node     massless, sealed (assumption A-D9 PERIPHERY_SEALED); every chamber is joined to it
                       by the same conductance G_per (sector angle 2 pi/N), so its mass balance
                       sum_k G_per (p_k - p_per) = 0 gives p_per = mean_k p_k exactly (derivation,
                       docs/lumped-model.md). The unvented bore node follows the same rule.
    Bore node          vented to the inlet (p = pIn) or massless as above: ``shaftVent`` is a user
                       input when leakOn (no default; missing -> InvalidDesignError / NOT EVALUATED).

Not modelled: Couette flow in the gaps, face leakage across tooth lands, outer-rotor micro-motion.
"""
from __future__ import annotations

import math

import numpy as np

from .errors import require_design
from .friction import single_sided
from .geometry import TAU, trochoid_curvature_radius


# ------------------------------------------------------------- gap conductances [m^3/(s Pa)]

def tip_conductance(b, h, mu, rho_eq):
    """Tip-gap conductance [m^3/(s Pa)]; b, h, rho_eq in m, mu in Pa s."""
    return 2 * b * h ** 2.5 / (9 * math.pi * mu * math.sqrt(2 * rho_eq))


def sector_conductance(theta, h, mu, r1, r2):
    """Face-gap conductance of an annular sector (one face) [m^3/(s Pa)]; 0 if r2 <= r1 or r1 <= 0."""
    return theta * h * h * h / (12 * mu * math.log(r2 / r1)) if (r2 > r1 and r1 > 0) else 0.0


def slot_conductance(w, h, mu, L):
    """Plane-slot conductance [m^3/(s Pa)]: width w, gap h, length L (m)."""
    return w * h * h * h / (12 * mu * L) if (w > 0 and L > 0) else 0.0


RHO_EQ_CAP_MM = 1e4
# Guard (derivation, docs/convergence.md "Guards"): 1/rho_eq <= RHO_EQ_INV_MIN [1/mm] means
# rho_eq >= 1e6 mm > RHO_EQ_CAP_MM, so returning the cap there is the same value min(1/inv, cap)
# would give; the guard only avoids the division by ~0 and never changes a result.
RHO_EQ_INV_MIN = 1e-6
# Root bracket of the implicit chamber-pressure equation F(x) = 0 (F strictly increasing in x):
# start at max(p_old, pD, pS) + PRESSURE_BRACKET_PA, double up to BRACKET_DOUBLINGS times until
# F(hi) >= 0. Bracket only - the converged root does not depend on it (docs/convergence.md "Guards").
PRESSURE_BRACKET_PA = 1e5
BRACKET_DOUBLINGS = 60

# Numerical settings (values = JS tool; convergence evidence: docs/convergence.md).
NET_SUB_DEFAULT = 6   # N08 network sub-steps per grid step (if design simSub absent)
NET_SWEEPS = 3        # N08 Gauss-Seidel sweeps per sub-step (3-pass leakage loop)
NET_CYCLES = 3        # N08 revolutions to periodic steady state (last recorded)
NET_BISECT = 50       # N08 implicit-Euler bisections per chamber
OUT_SUB = 8           # N09 outlet-volume sub-steps
OUT_CYCLES = 4        # N09 outlet-volume revolutions
OUT_BISECT = 60       # N09 outlet-volume bisections


def contact_rho_eq(p, phi, cap: float | None = None) -> float:
    """Equivalent radius of curvature [mm] at the lobe / inner-profile contact.

    Lobe radius rp (convex) against the inner profile of signed radius rho_t - rp
    (rho_t = trochoid radius; negative = concave): 1/rho_eq = 1/rp + 1/(rho_t - rp),
    capped at ``cap`` = 1e4 mm (flat / conformal limit).

    Named assumption A-D8 HERTZ_CONFORMAL_CAP (researcher review 2026-10-30): Hertz line contact
    is invalid for near-conformal flanks (a not << rho); the cap keeps p_max finite there and
    then *under*-predicts stress. The literature alternative is a conformal-contact model
    (Persson / Johnson ch.5 conformal cylinders) - not implemented; use ``hertz_validity`` in
    contact.py (a / rho_eq) to flag such points. Also used by the tip-gap conductance.
    """
    cap = RHO_EQ_CAP_MM if cap is None else cap
    rt = trochoid_curvature_radius(p, phi)
    ri = rt - p["rp"]
    inv = 1 / p["rp"] + 1 / ri
    return min(1 / inv, cap) if inv > RHO_EQ_INV_MIN else cap


def orifice(A, p_up, p_ch, Cd, rho):
    """Turbulent orifice flow [m^3/s] into the chamber: sgn(dp) Cd A sqrt(2|dp|/rho)."""
    d = p_up - p_ch
    if not (A > 0):
        return 0.0
    return math.copysign(1.0, d) * Cd * A * math.sqrt(2 * abs(d) / rho) if d != 0 else 0.0


def simulate_network(p, res, As, Ad, ports=None) -> dict:
    """Simulate all N chambers over three outer revolutions; the last one is recorded.

    res: geometric analysis (A [mm^2], dA [mm^2/rad] on t = j dt); As, Ad: opening areas of
    chamber 0 [mm^2]; ports: suction/delivery port dicts (for the land leakage).
    Implicit Euler per sub-step, 3 Gauss-Seidel sweeps over the chambers, pressure by bisection,
    void volume tracked below the cavitation pressure pVap.
    Returns pressure history of chamber 0 P [Pa], flows QS/QD [m^3/s], void fraction VF and
    network totals Qout/Qin/Qtip/Qbore/Qper, plus conductances.
    """
    M, dt, A, dA = res["M"], res["dt"], res["A"], res["dA"]
    N = p["N"]
    step = M // N
    w1 = p["rpm"] * TAU / 60
    w2 = w1 * (N - 1) / N
    b = p["b"] * 1e-3
    K, rho, Cd = p["bulk"] * 1e6, p["rho"], p["Cd"]
    mu = p["nu"] * 1e-6 * rho
    pS, pD, pV = p["pIn"] * 1e5, (p["pIn"] + p["dp"]) * 1e5, p["pVap"] * 1e5
    sub = p.get("simSub") or NET_SUB_DEFAULT
    h = dt / w2 / sub
    sweeps = NET_SWEEPS
    leak = bool(p.get("leakOn"))

    hTip = max(0.0, p["c"]) * 1e-3 if leak else 0.0
    single = single_sided(p)
    nFaces = 1 if single else 2
    hAx = max(0.0, p["axialClr"]) / nFaces * 1e-3 if leak else 0.0

    useBacklash = p.get("tipGapModel") != "uniform" and res.get("backlash") is not None
    Gtip0 = np.zeros(M)
    if hTip > 0:
        for j in range(M):
            phi1 = -(j * dt) / (N - 1) + TAU / N
            hj = max(0.0, res["backlash"]["gapLead"][j]) * 1e-3 if useBacklash else hTip
            Gtip0[j] = tip_conductance(b, hj, mu, contact_rho_eq(p, phi1) * 1e-3) if hj > 0 else 0.0
    theta = TAU / N
    Gbore = nFaces * sector_conductance(theta, hAx, mu, p["bore"] / 2 * 1e-3, p["innerRoot"] * 1e-3) \
        if (hAx > 0 and p["bore"] > 0) else 0.0
    Gper = nFaces * sector_conductance(theta, hAx, mu, p["Rv"] * 1e-3, p["OD"] / 2 * 1e-3) if hAx > 0 else 0.0
    if leak:  # user input, no default (owner rule no-unexplained-numbers)
        require_design(p, "simulate_network (leakOn: bore vent)", ("shaftVent",))
    boreVented = bool(p.get("shaftVent")) if leak else True  # leak off: Gbore = 0, node unused
    Gland = 0.0
    if hAx > 0 and ports and ports.get("suction"):
        ri = max(p["portRi"], 0)
        w = (p["portRo"] - ri) * 1e-3
        rm = 0.5 * (p["portRo"] + ri) * 1e-3
        landMax = ports["delivery"]["a0"] - ports["suction"]["a1"]
        landMin = ports["suction"]["a0"] + TAU - ports["delivery"]["a1"]
        nD = p.get("fillD") or (2 if p.get("doubleFill") else 1)
        Gland = nD * (slot_conductance(w, hAx, mu, landMax * rm) + slot_conductance(w, hAx, mu, landMin * rm))
    Qland = Gland * (pD - pS)

    fillS = p.get("fillS") or (2 if p.get("doubleFill") else 1)
    fillD = p.get("fillD") or (2 if p.get("doubleFill") else 1)
    A, dA, As, Ad = (np.asarray(x, dtype=float).tolist() for x in (A, dA, As, Ad))
    Gt = Gtip0.tolist()

    def lerp(arr, j, f):
        return arr[j] + (arr[(j + 1) % M] - arr[j]) * f

    P = [pS] * N
    voids = [0.0] * N
    Pold = [0.0] * N
    V_, dV_, as_, ad_, gt_ = ([0.0] * N for _ in range(5))
    rec = {k: np.zeros(M) for k in ("P", "QS", "QD", "VF", "Qout", "Qin", "Qtip", "Qbore", "Qper")}

    def orf(Ao, pu, x):
        d = pu - x
        if not (Ao > 0) or d == 0:
            return 0.0
        return Cd * Ao * math.sqrt(2 * d / rho) if d > 0 else -Cd * Ao * math.sqrt(2 * -d / rho)

    for cycle in range(NET_CYCLES):
        last = cycle == NET_CYCLES - 1
        for j in range(M):
            acc = dict(qs0=0.0, qd0=0.0, out=0.0, inn=0.0, tip=0.0, bore=0.0, per=0.0)
            for s in range(sub):
                f = (s + 0.5) / sub
                for k in range(N):
                    jk = (j + k * step) % M
                    V_[k] = lerp(A, jk, f) * 1e-6 * b
                    dV_[k] = lerp(dA, jk, f) * 1e-6 * b * w2
                    as_[k] = lerp(As, jk, f) * 1e-6 * fillS
                    ad_[k] = lerp(Ad, jk, f) * 1e-6 * fillD
                    gt_[k] = lerp(Gt, jk, f)
                    Pold[k] = P[k]
                pPer = 0.0
                for sw in range(sweeps):
                    pPer = sum(P) / N
                    pBore = pS if boreVented else pPer
                    for k in range(N):
                        kp, kn = (k + N - 1) % N, (k + 1) % N
                        gPrev, gNext = gt_[kp], gt_[k]
                        V, dV, a_s, a_d = V_[k], dV_[k], as_[k], ad_[k]
                        Pp, Pn = P[kp], P[kn]

                        def Qin(x):
                            return (orf(a_s, pS, x) + orf(a_d, pD, x) + gPrev * (Pp - x) + gNext * (Pn - x)
                                    + Gbore * (pBore - x) + Gper * (pPer - x))

                        if voids[k] > 0:
                            P[k] = pV
                            if sw == sweeps - 1:
                                voids[k] = max(0.0, voids[k] + (dV - Qin(pV)) * h)
                            continue
                        po = Pold[k]
                        VK = V / K

                        def F(x):
                            return VK * (x - po) / h - Qin(x) + dV

                        if F(pV) > 0:
                            P[k] = pV
                            if sw == sweeps - 1:
                                voids[k] = max(0.0, (dV - Qin(pV)) * h)
                            continue
                        lo, hi = pV, max(po, pD, pS) + PRESSURE_BRACKET_PA
                        for _ in range(BRACKET_DOUBLINGS):
                            if not (F(hi) < 0):
                                break
                            hi *= 2
                        for _ in range(NET_BISECT):
                            mid = 0.5 * (lo + hi)
                            if F(mid) > 0:
                                hi = mid
                            else:
                                lo = mid
                        P[k] = 0.5 * (lo + hi)
                if last:
                    pBore = pS if boreVented else pPer
                    out = inn = tip = bore = per = 0.0
                    for k in range(N):
                        qs, qd = orf(as_[k], pS, P[k]), orf(ad_[k], pD, P[k])
                        out -= qd
                        inn += qs
                        tip += abs(gt_[k] * (P[(k + 1) % N] - P[k]))
                        bore += Gbore * (P[k] - pBore)
                        per += abs(Gper * (P[k] - pPer))
                        if k == 0:
                            acc["qs0"] += qs
                            acc["qd0"] += qd
                    acc["out"] += out - Qland
                    acc["inn"] += inn - Qland
                    acc["tip"] += tip
                    acc["bore"] += bore
                    acc["per"] += 0.5 * per
            if last:
                j1 = (j + 1) % M
                rec["P"][j1] = P[0]
                rec["VF"][j1] = voids[0] / max(V_[0], 1e-18)
                rec["QS"][j] = acc["qs0"] / sub
                rec["QD"][j] = acc["qd0"] / sub
                rec["Qout"][j] = acc["out"] / sub
                rec["Qin"][j] = acc["inn"] / sub
                rec["Qtip"][j] = acc["tip"] / sub
                rec["Qbore"][j] = acc["bore"] / sub
                rec["Qper"][j] = acc["per"] / sub

    rec.update(
        pS=pS, pD=pD, pV=pV, mu=mu, Qland=Qland, Gtip=Gtip0, boreVented=boreVented,
        conductances={"Gbore": Gbore, "Gper": Gper, "Gland": Gland, "GtipMean": float(np.mean(Gtip0))},
        leakMean={"tip": float(np.mean(rec["Qtip"])), "bore": float(np.mean(rec["Qbore"])),
                  "periphery": float(np.mean(rec["Qper"])), "land": Qland},
    )
    return rec


def outlet_ripple(p, res, sim) -> dict | None:
    """Outlet pressure ripple from the delivered flow Q(t) (one-way coupling).

    V_out/K dp/dt = Q(t) - Cd A_r sqrt(2 (p - p_in)/rho), A_r = Qmean / (Cd sqrt(2 dp/rho))
    (load restriction sized for the mean flow at the target dp, as the GT-SUITE
    "OutletRestriction"). V_out = 0: resistive limit p = p_in + rho/2 (Q/(Cd A_r))^2.
    """
    M, dt, N = res["M"], res["dt"], p["N"]
    w2 = p["rpm"] * TAU / 60 * (N - 1) / N
    T = dt / w2
    K, rho, Cd = p["bulk"] * 1e6, p["rho"], p["Cd"]
    pS, dP = sim["pS"], sim["pD"] - sim["pS"]
    Q = np.asarray(sim["Qout"], dtype=float)
    qm = float(np.sum(Q)) / M
    if not (qm > 0) or not (dP > 0):
        return None
    Ar = qm / (Cd * math.sqrt(2 * dP / rho))

    def Qr(x):
        d = x - pS
        return Cd * Ar * math.copysign(1.0, d) * math.sqrt(2 * abs(d) / rho) if d != 0 else 0.0

    C = max(0.0, p.get("outletVol") or 0) * 1e-6 / K
    if C == 0:
        PD = pS + rho / 2 * (np.maximum(Q, 0) / (Cd * Ar)) ** 2
    else:
        PD = np.zeros(M)
        sub = OUT_SUB
        h = T / sub
        x = sim["pD"]
        for _ in range(OUT_CYCLES):
            for j in range(M):
                q = Q[j]
                for _s in range(sub):
                    x0 = x
                    lo, hi = min(x0, pS) - 1e7, max(x0, sim["pD"]) * 2 + 1e7
                    for _it in range(OUT_BISECT):
                        m = 0.5 * (lo + hi)
                        if C * (m - x0) / h + Qr(m) - q > 0:
                            hi = m
                        else:
                            lo = m
                    x = 0.5 * (lo + hi)
                PD[j] = x
    mn, mx = float(PD.min()), float(PD.max())
    return {"PD": PD, "Ar": Ar, "pMean": float(np.sum(PD)) / M, "ripplePa": mx - mn,
            "rippleRel": (mx - mn) / dP, "tau": C * 2 * dP / qm if C > 0 else 0.0}
