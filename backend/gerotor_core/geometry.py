"""Gerotor geometry and kinematic analysis (port of js/geometry.js).

Classic gerotor: the outer rotor has N circular lobes of radius ``rp`` whose centres lie on a
circle of radius ``R``; the inner rotor has N-1 teeth, the conjugate envelope of the lobes.
Outer rotor centre O2 = (0, 0), inner rotor centre O1 = (e, 0). Outer rotor angle t, inner
rotor angle a1 = N t / (N - 1). Seen from the inner rotor a lobe centre traces the trochoid

    Q(phi) = R e^{i phi} - e e^{i N phi}

and the inner profile is Q offset inward by rp (+ clearance c).

Conventions (researcher review 2026-10-30, D3 / D7)
---------------------------------------------------
c       *profile equidistance clearance* eps of Ivanovic 2012 Eq.(9): constant normal reduction
        of the inner profile. It is NOT the tip-to-tip gap quoted in catalogues (Gamez Table 1,
        Nichols "0.08-0.20 mm"): with the outer rotor lagging, the peak gap (tip-to-tip at the
        largest chamber) is about 2 c (Ivanovic Fig. 6-8; regression test in tests/). Use
        ``peak_gap_to_c`` / ``c_to_peak_gap`` when the input is a peak gap.
lambda  = R / (N e) (Ivanovic trochoid coefficient, > 1). Gamez-Montero Eq.(3) uses the inverse
        lambda_G = N e / R (recommended 0.6-0.8). Convert with ``lambda_gamez`` /
        ``lambda_from_gamez``; never mix them (assist.js port).

Units
-----
Geometry is in **mm and rad** (manufacturing convention; identical to the JS tool so that
results can be compared 1:1). Design dictionaries use the JS keys (N, e, R, rp, c, b, Rv, ...).
Derived engineering outputs: cc [cm^3/rev], flowLpm [L/min], torque [N m], power [kW].

Sources: Rundo 2017 (vector-ray dV/dphi Eq. 18, Green area Eq. 22, Eq. 20 displacement);
Gamez-Montero et al. (tip speed limit 15 m/s); Gerotor Design Studio (GDS) for fillet and
tool-diameter definitions.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np

TAU = 2.0 * math.pi

Params = dict[str, Any]

from .errors import InvalidDesignError, require_design  # noqa: E402,F401


# ----------------------------------------------------------------- convention converters

PEAK_GAP_FACTOR = 2.0  # peak tip-to-tip gap / profile clearance c (Ivanovic 2012 Fig. 6-8, ~2)

# Numerical settings (values = JS tool; convergence evidence: docs/convergence.md).
TOOL_COARSE_N = 720        # N03 coarse scan of the concave trochoid branch
TOOL_GOLDEN_STEPS = 60     # N03 golden-section steps (0.618^60 of one coarse cell)
INNER_SECTOR_PANELS = 24   # N05 composite 8-point Gauss-Legendre panels
FILLET_PROFILE_N = 3000    # N04 polar table of the clearance inner profile
FILLET_PTS = 14            # N04 points per fillet arc
FILLET_ENDS = True         # N04 include the arc end points (JS: False -> O(1/n) error, docs/convergence.md)
FILLET_POS_PER_LOBE = 64   # N04 rotor positions per lobe
CURV_N = 4000              # N02 undercut scan points
CURV_N_FAST = 800          # N02 fast mode (Design Assist only)
CHAMBER_N_IN = 48          # N06 chamber polygon, inner-profile points
CHAMBER_N_OUT = 16         # N06 chamber polygon, outer-path points
ACTUAL_AREA_STRIDE = 2     # N06 actual (clearance) area evaluated every 2nd sample


def peak_gap_to_c(peak_gap: float) -> float:
    """Catalogue tip-to-tip (peak) gap [mm] -> profile equidistance clearance c [mm] (~ gap / 2).

    Approximate: the exact ratio depends weakly on N, lambda and rp (2.0 within ~5 % for the
    Ivanovic examples). For an exact value, run ``backlash.compute_backlash`` and scale c.
    """
    return peak_gap / PEAK_GAP_FACTOR


def c_to_peak_gap(c: float) -> float:
    """Profile clearance c [mm] -> approximate peak tip-to-tip gap [mm] (~ 2 c)."""
    return c * PEAK_GAP_FACTOR


def lambda_gamez(R: float, N: int, e: float) -> float:
    """Gamez-Montero lambda_G = N e / R (inverse of this code's lambda = R / (N e))."""
    return N * e / R


def lambda_from_gamez(lam_g: float) -> float:
    """Gamez-Montero lambda_G -> Ivanovic / code lambda = 1 / lambda_G."""
    return 1.0 / lam_g


# ----------------------------------------------------------------- small vector helpers

def rot(p, a):
    c, s = math.cos(a), math.sin(a)
    return (c * p[0] - s * p[1], s * p[0] + c * p[1])


def add(p, q):
    return (p[0] + q[0], p[1] + q[1])


def js_round(x: float) -> int:
    """JavaScript Math.round (halves round up, unlike Python's banker's rounding)."""
    return math.floor(x + 0.5)


def linspace(a, b, n):
    """Same node formula as the JS ``linspace`` (a + (b-a) i/(n-1))."""
    return [a + (b - a) * i / (n - 1) for i in range(n)]


def polygon_area(pts) -> float:
    """Signed shoelace area of a closed polygon (CCW positive)."""
    s = 0.0
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        s += a[0] * b[1] - b[0] * a[1]
    return s / 2


# ----------------------------------------------------------------- trochoid (inner rotor)

def trochoid(p: Params, phi):
    """Lobe-centre path in the inner-rotor frame, Q(phi) [mm]. Works on scalars or arrays."""
    R, e, N = p["R"], p["e"], p["N"]
    return (R * np.cos(phi) - e * np.cos(N * phi), R * np.sin(phi) - e * np.sin(N * phi)) \
        if isinstance(phi, np.ndarray) else \
        (R * math.cos(phi) - e * math.cos(N * phi), R * math.sin(phi) - e * math.sin(N * phi))


def trochoid_d1(p: Params, phi):
    R, N = p["R"], p["N"]
    Ne = N * p["e"]
    if isinstance(phi, np.ndarray):
        return (-R * np.sin(phi) + Ne * np.sin(N * phi), R * np.cos(phi) - Ne * np.cos(N * phi))
    return (-R * math.sin(phi) + Ne * math.sin(N * phi), R * math.cos(phi) - Ne * math.cos(N * phi))


def trochoid_d2(p: Params, phi):
    R, N = p["R"], p["N"]
    N2e = N * N * p["e"]
    if isinstance(phi, np.ndarray):
        return (-R * np.cos(phi) + N2e * np.cos(N * phi), -R * np.sin(phi) + N2e * np.sin(N * phi))
    return (-R * math.cos(phi) + N2e * math.cos(N * phi), -R * math.sin(phi) + N2e * math.sin(N * phi))


def trochoid_curvature_radius(p: Params, phi):
    """Signed radius of curvature of the trochoid [mm]; positive where convex.

    rho = |Q'|^3 / (Q' x Q'').
    """
    d1, d2 = trochoid_d1(p, phi), trochoid_d2(p, phi)
    L = np.hypot(d1[0], d1[1]) if isinstance(phi, np.ndarray) else math.hypot(d1[0], d1[1])
    return (L * L * L) / (d1[0] * d2[1] - d1[1] * d2[0])


def min_convex_curvature(p: Params, n: int = 4000) -> float:
    """Smallest positive trochoid radius of curvature over one tooth pitch (undercut limit)."""
    span = TAU / (p["N"] - 1)
    r = trochoid_curvature_radius(p, span * np.arange(n + 1) / n)
    r = r[r > 0]
    return float(r.min()) if r.size else math.inf


def inner_tool_diameter(p: Params) -> dict:
    """Largest cutter that can machine the inner rotor (GDS "Max tool diameter").

    Where the trochoid is concave (rho_Q < 0) the inner profile, offset inward by rp + c, is
    concave with radius |rho_Q| + rp + c. Coarse scan (720 points) + 60 golden-section steps.
    """
    per, n = TAU / (p["N"] - 1), TOOL_COARSE_N
    best, phiB = math.inf, 0.0
    for i in range(n):
        phi = per * i / n
        r = trochoid_curvature_radius(p, phi)
        if r < 0 and -r < best:
            best, phiB = -r, phi
    if not math.isfinite(best):
        return {"diameter": math.inf, "phi": math.nan}

    def f(x):
        r = trochoid_curvature_radius(p, x)
        return -r if r < 0 else math.inf

    a, b = phiB - per / n, phiB + per / n
    g = (math.sqrt(5) - 1) / 2
    for _ in range(TOOL_GOLDEN_STEPS):
        x1, x2 = b - g * (b - a), a + g * (b - a)
        if f(x1) < f(x2):
            b = x2
        else:
            a = x1
    phi = 0.5 * (a + b)
    rho = min(best, f(phi))
    return {"diameter": 2 * (rho + p["rp"] + p["c"]), "rhoTrochoid": rho, "phi": phi}


def inner_point(p: Params, phi: float, offset: float):
    """Inner-profile point (inner-rotor frame): trochoid offset inward by ``offset`` [mm]."""
    q, d = trochoid(p, phi), trochoid_d1(p, phi)
    L = math.hypot(d[0], d[1])
    return (q[0] - offset * d[1] / L, q[1] + offset * d[0] / L)


def inner_profile(p: Params, n: int, offset: float) -> np.ndarray:
    """n points of the closed inner profile, shape (n, 2)."""
    phi = TAU * np.arange(n) / n
    qx, qy = trochoid(p, phi)
    dx, dy = trochoid_d1(p, phi)
    L = np.hypot(dx, dy)
    return np.column_stack([qx - offset * dy / L, qy + offset * dx / L])


def trochoid_curve(p: Params, n: int) -> np.ndarray:
    phi = TAU * np.arange(n) / n
    return np.column_stack(trochoid(p, phi))


# ----------------------------------------------------------------- outer rotor

def lobe_point(p: Params, k: int, psi: float):
    """Point on lobe k at lobe angle psi (0 = lobe tip, + towards lobe k+1), outer frame."""
    th = TAU * k / p["N"]
    cu, su = math.cos(th), math.sin(th)
    a, b = p["R"] - p["rp"] * math.cos(psi), p["rp"] * math.sin(psi)
    return (a * cu - b * su, a * su + b * cu)


def lobe_psi(p: Params, k: int, pt) -> float:
    """Lobe angle psi of a point lying on lobe k (outer-rotor frame)."""
    th = TAU * k / p["N"]
    cu, su = math.cos(th), math.sin(th)
    wx, wy = pt[0] - p["R"] * cu, pt[1] - p["R"] * su
    return math.atan2(-wx * su + wy * cu, -(wx * cu + wy * su))


def lobe_limits(p: Params) -> dict:
    """Usable lobe arc +-psiMax: ends at the valley circle Rv or at the neighbouring lobe.

    Returns dict(psiMax, beta, hasValley, lobesOverlap, psiMaxRaw[, fillets, filletCentre,
    filletError]). beta = polar angle (about O2) where the lobe arc meets the valley arc.
    """
    N, R, rp, Rv = p["N"], p["R"], p["rp"], p["Rv"]
    c = (R * R + rp * rp - Rv * Rv) / (2 * R * rp)
    psiValley = math.pi if c <= -1 else (0.0 if c >= 1 else math.acos(c))
    half = math.pi / N
    disc = rp * rp - (R * math.sin(half)) ** 2
    psiNeighbour = math.inf
    if disc >= 0:
        t1 = R * math.cos(half) - math.sqrt(disc)
        psiNeighbour = math.acos(min(1.0, max(-1.0, (R * R + rp * rp - t1 * t1) / (2 * R * rp))))
    hasValley = psiValley < psiNeighbour
    psiMax = min(psiValley, psiNeighbour)
    beta = math.atan2(rp * math.sin(psiMax), R - rp * math.cos(psiMax))
    L = {"psiMax": psiMax, "beta": beta, "hasValley": hasValley, "lobesOverlap": disc > 0,
         "psiMaxRaw": psiMax}
    if (p.get("fillet") or 0) > 0:
        _add_fillet(p, L)
    return L


def _wrap_pi(a):
    return math.atan2(math.sin(a), math.cos(a))


def _add_fillet(p: Params, L: dict) -> None:
    """Fillet of radius rf between lobe arc and valley circle (outer rotor).

    Centre F: |F| = Rv - rf (internally tangent to the valley), |F - C| = rp + rf (externally
    tangent to the lobe). The lobe arc then ends at psiF and the valley starts at the polar
    angle gamma of F; the two fillet arcs of the k = 0 pitch are stored.
    """
    N, R, rp, Rv, rf = p["N"], p["R"], p["rp"], p["Rv"], p["fillet"]
    if not L["hasValley"]:
        L["filletError"] = "no valley arc (lobes intersect)"
        return
    rF = Rv - rf
    cg = (R * R + rF * rF - (rp + rf) * (rp + rf)) / (2 * R * rF) if rF != 0 else math.inf
    if not (rF > 0) or abs(cg) > 1:
        L["filletError"] = "fillet does not fit between lobe and valley"
        return
    gamma = math.acos(cg)
    F = (rF * math.cos(gamma), rF * math.sin(gamma))
    T1 = (R + rp * (F[0] - R) / (rp + rf), rp * F[1] / (rp + rf))
    psiF = lobe_psi(p, 0, T1)
    if not (gamma < math.pi / N) or not (psiF > 0) or not (psiF < L["psiMax"]):
        L["filletError"] = "fillet too large for the lobe pitch"
        return
    J = lobe_point(p, 0, L["psiMax"])  # original sharp corner
    th1 = TAU / N
    J1pt = rot((J[0], -J[1]), th1)

    def nearest_corner(Fc):
        dJ = math.hypot(Fc[0] - J[0], Fc[1] - J[1])
        dJ1 = math.hypot(Fc[0] - J1pt[0], Fc[1] - J1pt[1])
        return J if dJ < dJ1 else J1pt

    def arc(Fc, A, B):
        aa = math.atan2(A[1] - Fc[1], A[0] - Fc[0])
        ab = math.atan2(B[1] - Fc[1], B[0] - Fc[0])
        d = math.atan2(math.sin(ab - aa), math.cos(ab - aa))
        m = (Fc[0] + rf * math.cos(aa + d / 2), Fc[1] + rf * math.sin(aa + d / 2))
        Jc = nearest_corner(Fc)
        # The arc must bulge towards the removed sharp corner; otherwise take the long way.
        if math.hypot(m[0] - Jc[0], m[1] - Jc[1]) > math.hypot(Fc[0] - Jc[0], Fc[1] - Jc[1]):
            d -= math.copysign(1.0, d) * TAU if d != 0 else 0.0
        return {"c": Fc, "a0": aa, "d": d}

    T2 = (Rv * math.cos(gamma), Rv * math.sin(gamma))
    F1 = rot((F[0], -F[1]), th1)
    T2b = rot((T2[0], -T2[1]), th1)
    T1b = rot((T1[0], -T1[1]), th1)
    L["fillets"] = [arc(F, T1, T2), arc(F1, T2b, T1b)]
    L["psiMax"] = psiF
    L["beta"] = gamma
    L["filletCentre"] = F


def fillet_points(p: Params, L: dict, k: int, which: int, n: int, ends: bool = False):
    """n points on the fillet arc; the two tangency end points are omitted (profile building) unless
    ``ends`` (fillet clearance: the minimum clearance lies at an end point, docs/convergence.md)."""
    if not L.get("fillets"):
        return []
    f, th = L["fillets"][which], TAU * k / p["N"]
    pts = []
    for i in (range(n) if ends else range(1, n - 1)):
        a = f["a0"] + f["d"] * i / (n - 1)
        pts.append(rot((f["c"][0] + p["fillet"] * math.cos(a), f["c"][1] + p["fillet"] * math.sin(a)), th))
    return pts


def valley_points(p: Params, L: dict, k: int, n: int):
    if not L["hasValley"]:
        return []
    a0 = TAU * k / p["N"] + L["beta"]
    a1 = TAU * (k + 1) / p["N"] - L["beta"]
    return [(p["Rv"] * math.cos(a), p["Rv"] * math.sin(a)) for a in linspace(a0, a1, n)[1:-1]]


def outer_profile(p: Params, n_lobe: int, n_valley: int, L: dict | None = None) -> np.ndarray:
    """Closed outer-rotor profile (lobe arcs, fillets, valley arcs), shape (m, 2)."""
    L = L or lobe_limits(p)
    pts = []
    for k in range(p["N"]):
        pts += [lobe_point(p, k, psi) for psi in linspace(-L["psiMax"], L["psiMax"], n_lobe)]
        pts += fillet_points(p, L, k, 0, n_valley)
        pts += valley_points(p, L, k, n_valley)
        pts += fillet_points(p, L, k, 1, n_valley)
    return np.array(pts)


def outer_path(p: Params, L: dict, k: int, psiA: float, psiB: float, n: int):
    """Outer profile from psiA on lobe k to psiB on lobe k+1 (outer frame)."""
    pts = [lobe_point(p, k, psi) for psi in linspace(psiA, L["psiMax"], n)]
    pts += fillet_points(p, L, k, 0, n)
    pts += valley_points(p, L, k, n)
    pts += fillet_points(p, L, k, 1, n)
    pts += [lobe_point(p, k + 1, psi) for psi in linspace(-L["psiMax"], psiB, n)]
    return pts


# ----------------------------------------------------------------- kinematics & sectors

def inner_angle(p: Params, t: float) -> float:
    """Inner rotor angle a1 = N t / (N - 1) for outer angle t."""
    return p["N"] * t / (p["N"] - 1)


def arc_sector(c, r, a0, a1) -> float:
    """S = 1/2 int (x dy - y dx) about O2 along a circular arc (centre c, radius r, a0 -> a1)."""
    return 0.5 * (r * r * (a1 - a0) + r * (c[0] * (math.sin(a1) - math.sin(a0))
                                           - c[1] * (math.cos(a1) - math.cos(a0))))


def lobe_sector(p: Params, k: int, psiA: float, psiB: float) -> float:
    th = TAU * k / p["N"]
    return arc_sector((p["R"] * math.cos(th), p["R"] * math.sin(th)), p["rp"],
                      th - psiA + math.pi, th - psiB + math.pi)


def outer_sector(p: Params, L: dict, psiA: float, psiB: float) -> float:
    """Exact Green sector of the outer path between the two contacts (Rundo 2017 Eq. 22)."""
    s = lobe_sector(p, 0, psiA, L["psiMax"]) + lobe_sector(p, 1, -L["psiMax"], psiB)
    if L["hasValley"]:
        s += 0.5 * p["Rv"] * p["Rv"] * (TAU / p["N"] - 2 * L["beta"])
    for f in L.get("fillets") or []:
        s += arc_sector(f["c"], p["fillet"], f["a0"], f["a0"] + f["d"])
    return s


_GLX = np.array([-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498,
                 0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363])
_GLW = np.array([0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620,
                 0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763])


def inner_sector(p: Params, phi0, phi1, a1, C1, n_sub: int | None = None, offset: float | None = None) -> float:
    """Green sector of the inner profile between phi0 and phi1, mapped to the housing frame.

    P = Q - r n (offset curve), P' = Q' (1 - r kappa), X = Rot(a1) P + C1:
        1/2 int X x X' dphi = 1/2 int P x P' dphi + 1/2 C1 x Rot(a1)(P(phi1) - P(phi0)).
    Composite 8-point Gauss-Legendre (n_sub panels, ~1e-10 rel. on sharp-tipped designs).
    """
    r = p["rp"] if offset is None else offset
    n_sub = n_sub or INNER_SECTOR_PANELS
    h = (phi1 - phi0) / n_sub
    mids = phi0 + (np.arange(n_sub) + 0.5) * h
    ph = (mids[:, None] + 0.5 * h * _GLX[None, :]).ravel()
    qx, qy = trochoid(p, ph)
    d1x, d1y = trochoid_d1(p, ph)
    d2x, d2y = trochoid_d2(p, ph)
    sp = d1x * d1x + d1y * d1y
    L = np.sqrt(sp)
    kap = (d1x * d2y - d1y * d2x) / (sp * L)
    Px, Py = qx - r * d1y / L, qy + r * d1x / L
    f = 1 - r * kap
    integrand = (Px * d1y * f - Py * d1x * f).reshape(n_sub, 8)
    s = float(np.sum(0.5 * h * integrand @ _GLW))
    P1, P0 = inner_point(p, phi1, r), inner_point(p, phi0, r)
    dP = rot((P1[0] - P0[0], P1[1] - P0[1]), a1)
    return 0.5 * s + 0.5 * (C1[0] * dP[1] - C1[1] * dP[0])


def _contacts(p: Params, t: float):
    N = p["N"]
    a1, C1 = inner_angle(p, t), (p["e"], 0.0)
    phi0 = -t / (N - 1)
    phi1 = phi0 + TAU / N
    c0 = add(rot(inner_point(p, phi0, p["rp"]), a1), C1)
    c1 = add(rot(inner_point(p, phi1, p["rp"]), a1), C1)
    return a1, C1, phi0, phi1, c0, c1


def chamber(p: Params, t: float, L: dict, n_in: int = 64, n_out: int = 24) -> dict:
    """Chamber between lobe 0 and lobe 1 at outer angle t (theoretical, zero clearance).

    Chamber k at t equals chamber 0 at t + 2 pi k / N. Returns area [mm^2] (exact: closed
    arcs + Gauss-Legendre), lobe angles psi0/psi1 of the two contacts, the contact points
    (housing frame) and dA/dt [mm^2/rad of outer rotation] by the vector-ray method
    (Rundo 2017 Eq. 18):  dA/dt = -1/2 N/(N-1) [(rD0^2 - rD1^2) + tau (rd1^2 - rd0^2)],
    tau = (N-1)/N, rD about O1, rd about O2.
    ``n_in < 0``: contacts and dA/dt only; ``n_in > 1``: also the fixed-frame polygon.
    """
    N = p["N"]
    n_out = n_out or 24
    a1, C1, phi0, phi1, c0, c1 = _contacts(p, t)
    psi0 = lobe_psi(p, 0, rot(c0, -t))
    psi1 = lobe_psi(p, 1, rot(c1, -t))
    tau = (N - 1) / N

    def rD(c):
        return (c[0] - C1[0]) * (c[0] - C1[0]) + c[1] * c[1]

    def rd(c):
        return c[0] * c[0] + c[1] * c[1]

    dAdt = -0.5 / tau * ((rD(c0) - rD(c1)) + tau * (rd(c1) - rd(c0)))
    if n_in < 0:
        return {"psi0": psi0, "psi1": psi1, "contacts": [c0, c1], "dAdt": dAdt}
    area = outer_sector(p, L, psi0, psi1) - inner_sector(p, phi0, phi1, a1, C1)
    out = {"area": area, "psi0": psi0, "psi1": psi1, "contacts": [c0, c1], "dAdt": dAdt}
    if n_in > 1:
        inner = [add(rot(inner_point(p, ph, p["rp"]), a1), C1) for ph in linspace(phi0, phi1, n_in)]
        outer = [rot(q, t) for q in outer_path(p, L, 0, psi0, psi1, n_out)]
        out["polygon"] = inner + outer[::-1]
    return out


def chamber_actual_area(p: Params, t: float, L: dict) -> float:
    """Chamber area including the profile clearance c (dead volume; compare with CAD) [mm^2].

    Outer path between the lobe contacts, closed by the normal segments to the clearance-offset
    inner profile (offset rp + c).
    """
    N = p["N"]
    a1, C1 = inner_angle(p, t), (p["e"], 0.0)
    phi0 = -t / (N - 1)
    phi1 = phi0 + TAU / N
    off = p["rp"] + max(0.0, p["c"])

    def fx(q):
        return add(rot(q, a1), C1)

    c0, c1 = fx(inner_point(p, phi0, p["rp"])), fx(inner_point(p, phi1, p["rp"]))
    i0, i1 = fx(inner_point(p, phi0, off)), fx(inner_point(p, phi1, off))
    psi0 = lobe_psi(p, 0, rot(c0, -t))
    psi1 = lobe_psi(p, 1, rot(c1, -t))

    def cross(A, B):
        return 0.5 * (A[0] * B[1] - A[1] * B[0])

    return outer_sector(p, L, psi0, psi1) + cross(c1, i1) - inner_sector(p, phi0, phi1, a1, C1, INNER_SECTOR_PANELS, off) + cross(i0, c0)


def fillet_clearance(p: Params, L: dict) -> float:
    """Minimum radial clearance fillet arcs <-> clearance inner profile over one rev [mm].

    Negative = the inner teeth cut into the fillets. Inner profile tabulated in polar form
    (3000 points, linear interpolation), fillets sampled with 12 points each, N*64 positions.
    """
    if not L.get("fillets"):
        return math.inf
    n = FILLET_PROFILE_N
    prof = inner_profile(p, n, p["rp"] + max(0.0, p["c"]))
    ang = np.arctan2(prof[:, 1], prof[:, 0])
    rad = np.hypot(prof[:, 0], prof[:, 1])
    order = np.argsort(ang, kind="stable")
    ang, rad = ang[order], rad[order]
    # periodic extension so that np.interp handles the wrap-around segment like the JS code
    angE = np.concatenate([[ang[-1] - TAU], ang, [ang[0] + TAU]])
    radE = np.concatenate([[rad[-1]], rad, [rad[0]]])
    pts = np.array(fillet_points(p, L, 0, 0, FILLET_PTS, FILLET_ENDS) + fillet_points(p, L, 0, 1, FILLET_PTS, FILLET_ENDS))
    M = p["N"] * FILLET_POS_PER_LOBE
    worst = math.inf
    for j in range(M):
        t = TAU * j / M
        a1 = inner_angle(p, t)
        ct, st = math.cos(t), math.sin(t)
        X = ct * pts[:, 0] - st * pts[:, 1] - p["e"]
        Y = st * pts[:, 0] + ct * pts[:, 1]
        ca, sa = math.cos(-a1), math.sin(-a1)
        qx, qy = ca * X - sa * Y, sa * X + ca * Y
        a = np.arctan2(qy, qx)
        worst = min(worst, float(np.min(np.hypot(qx, qy) - np.interp(a, angE, radE))))
    return worst


# ----------------------------------------------------------------- derived data

def derive(p: Params) -> Params:
    """Fill derived design quantities (Rv, port radii, tip/root radii, face-support flags).

    Rv (auto) = R + 2e - rp + RvClear; inner tip = R + e - rp - c; inner root = R - e - rp - c;
    outer tip = R - rp; lambda = R / (N e) (Ivanovic convention, see module docstring).
    c is the profile equidistance clearance (peak tip gap ~ 2 c). Raises InvalidDesignError if
    a basic key (N, e, R, rp, c) is missing.
    """
    require_design(p, "derive")
    Rv = p["R"] + 2 * p["e"] - p["rp"] + p["RvClear"] if p.get("RvAuto") else p["Rv"]
    q = dict(p, Rv=Rv)
    if p.get("portLayout"):
        q["doubleFill"] = p["portLayout"] == "double"
        q["faceSupport"] = "single" if p["portLayout"] == "single" else "balanced"
    if any(p.get(k) is not None for k in ("dblIn", "dblOut", "shadow")):
        q["fillS"] = 2 if p.get("dblIn") else 1
        q["fillD"] = 2 if p.get("dblOut") else 1
        q["doubleFill"] = bool(p.get("dblIn") and p.get("dblOut"))
        q["faceSupport"] = "balanced" if (p.get("dblOut") or p.get("shadow")) else "single"
    else:
        q["fillS"] = q["fillD"] = 2 if q.get("doubleFill") else 1
    innerRoot = p["R"] - p["e"] - p["rp"] - p["c"]
    q.update(
        innerTip=p["R"] + p["e"] - p["rp"] - p["c"],
        innerRoot=innerRoot,
        portRo=p["portRo"] if p.get("portRoAuto") is False else Rv,
        portRi=p["portRi"] if p.get("portRiAuto") is False else innerRoot,
        outerTip=p["R"] - p["rp"],
        RvMin=p["R"] + 2 * p["e"] - p["rp"],
        pitchInner=(p["N"] - 1) * p["e"],
        pitchOuter=p["N"] * p["e"],
        **{"lambda": p["R"] / (p["N"] * p["e"])},
    )
    return q


def analyse(p: Params, samples: int = 96, fast: bool = False, sub_models: bool = True, skip=()) -> dict:
    """Full kinematic analysis over one outer-rotor revolution.

    Grid: M = N * samples, t_j = j * dt. Returns chamber area A [mm^2], dA/dt, delivery per unit
    width q, displacement cc [cm^3 per shaft rev] = (N-1) (Amax - Amin) b / 1000 (or in fast
    mode the mean of the summed negative dV/dphi, Rundo 2017 Eq. 20), kinematic ripple, ideal
    torque and power, and design checks. With ``sub_models`` the backlash, port/pressure,
    contact and friction models are run as in the JS ``analyse``. ``skip`` names sub-models
    ("backlash", "ports", "contact", "mech") that are not run (API: their inputs are missing, the
    results are reported NOT EVALUATED); default () = JS behaviour.
    """
    require_design(p, "analyse", ("N", "e", "R", "rp", "c", "Rv", "RvMin", "innerTip", "innerRoot", "OD", "b", "bore"))
    res: dict = {"valid": False, "checks": []}

    def push(level, title, detail=""):
        res["checks"].append({"level": level, "title": title, "detail": detail})

    N = p["N"]
    if not (isinstance(N, int) and N >= 3):
        push("err", "Invalid lobe count", "N must be an integer >= 3.")
        return res
    if not (p["e"] > 0 and p["R"] > 0 and p["rp"] > 0):
        push("err", "Non-positive dimension")
        return res
    if p["R"] <= N * p["e"]:
        push("err", "Trochoid forms loops", "R must exceed N e.")
        return res

    L = lobe_limits(p)
    res["lobe"] = L
    if (p.get("fillet") or 0) > 0:
        if L.get("filletError"):
            push("err", "Invalid fillet", L["filletError"])
            return res
        if not fast:
            res["filletClearance"] = fillet_clearance(p, L)
            if res["filletClearance"] < 0:
                push("err", "Fillet hits inner rotor")
            else:
                push("ok", "Fillet clearance")
    res["rhoMin"] = min_convex_curvature(p, CURV_N_FAST if fast else CURV_N)
    off = p["rp"] + p["c"]
    if off >= res["rhoMin"]:
        push("err", "Inner rotor undercut")
    elif off > 0.85 * res["rhoMin"]:
        push("warn", "Sharp inner rotor tips")
    else:
        push("ok", "No undercut")

    if p["Rv"] >= p["R"] + p["rp"]:
        push("err", "Lobes do not reach valley")
    elif not L["hasValley"]:
        push("info", "No valley arc")
    if p["Rv"] < p["RvMin"] - max(0.0, p["c"]) - 1e-9:
        push("err", "Tooth tip hits valley")
    else:
        push("ok", "Tip-to-valley clearance")

    outerWall = p["OD"] / 2 - p["Rv"]
    if outerWall <= 0:
        push("err", "No outer rotor wall")
    elif outerWall < 0.1 * p["R"]:
        push("warn", "Thin outer rotor wall")
    else:
        push("ok", "Outer rotor wall")
    innerWall = p["innerRoot"] - p["bore"] / 2
    if innerWall <= 0:
        push("err", "Bore cuts tooth roots")
    elif innerWall < 0.15 * p["innerRoot"]:
        push("warn", "Thin inner rotor wall")
    else:
        push("ok", "Inner rotor wall")
    if p["c"] < 0:
        push("err", "Negative clearance")

    res["tipSpeed"] = p["rpm"] * TAU / 60 * p["innerTip"] / 1000
    push("warn" if res["tipSpeed"] > 15 else "ok", "High tip speed" if res["tipSpeed"] > 15 else "Tip speed")

    M = N * samples
    dt = TAU / M
    A = None if fast else np.zeros(M)
    dA = np.zeros(M)
    polys = None if fast else [None] * M
    psiAbs = 0.0
    for j in range(M):
        ch = chamber(p, j * dt, L, -1 if fast else CHAMBER_N_IN, CHAMBER_N_OUT)
        dA[j] = ch["dAdt"]
        if not fast:
            A[j] = ch["area"]
            polys[j] = ch["polygon"]
        psiAbs = max(psiAbs, abs(ch["psi0"]), abs(ch["psi1"]))
    res["psiContactMax"] = psiAbs
    push("err" if psiAbs > L["psiMax"] + 1e-6 else "ok",
         "Contact leaves lobe arc" if psiAbs > L["psiMax"] + 1e-6 else "Contact within lobe arc")

    Amin = Amax = math.nan
    if A is not None:
        Amin, Amax = float(A.min()), float(A.max())
        act = [chamber_actual_area(p, j * dt, L) for j in range(0, M, ACTUAL_AREA_STRIDE)]
        res["AminActual"], res["AmaxActual"] = min(act), max(act)

    step = M // N
    idx = (np.arange(M)[:, None] + step * np.arange(N)[None, :]) % M
    q = np.maximum(0.0, -dA[idx]).sum(axis=1)
    qMean = float(np.sum(q)) / M

    ccCheck = qMean * TAU * p["b"] * (N - 1) / N / 1000
    cc = (N - 1) * (Amax - Amin) * p["b"] / 1000 if A is not None else ccCheck
    flowLpm = cc * p["rpm"] / 1000
    res.update(M=M, dt=dt, A=A, dA=dA, q=q, polys=polys, Amin=Amin, Amax=Amax,
               dispInner=cc * 1000, cc=cc, ccCheck=ccCheck, flowLpm=flowLpm,
               ripple=(float(q.max()) - float(q.min())) / qMean,
               torque=cc * p["dp"] / (20 * math.pi),  # N m (ideal), cc in cm^3, dp in bar
               power=flowLpm * p["dp"] / 600,          # kW (ideal hydraulic)
               chamberOffset=math.pi / N)               # chamber-0 housing angle = t + pi/N

    if sub_models and not fast:
        from . import backlash, contact, friction, ports  # local import: avoid cycles
        if p["c"] > 0 and "backlash" not in skip:
            res["backlash"] = backlash.compute_backlash(p, res)
        if p.get("portsOn") and "ports" not in skip:
            res["ports"] = ports.analyse_ports(p, res, L)
            res["checks"] += res["ports"]["checks"]
        if p["dp"] > 0 and "contact" not in skip:
            ct = res["contact"] = contact.compute_contact(p, res)
            push("warn" if ct["reversal"] else "ok", "Contact force reversal" if ct["reversal"] else "Contact force")
        if "mech" not in skip and p["rpm"] > 0 and p["nu"] > 0:
            res["mech"] = friction.compute_mechanical(p, res)
    res["valid"] = not any(c["level"] == "err" for c in res["checks"])
    return res
