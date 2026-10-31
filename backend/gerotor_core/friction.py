"""Viscous / Coulomb mechanical losses, shaft torque and efficiencies (port of js/friction.js).

Totaro, Zardin & Borghi (2025), "Evaluation of a simple method to estimate the shaft torque in a
gerotor pump":
    M_shaft = M_press + tau (M_out,radial + M_out,lateral) + M_in,lateral + M_jb
    M_th = V dp / 2 pi   (ideal; eta_m = M_th / M_shaft)
    pressure load W = dp 2 R_W L  (R_W = inner tip radius)
Short journal bearing (Ocvirk), load W, radial clearance c:
    W = mu w R L^3/(4 c^2) eps/(1-eps^2)^2 sqrt(pi^2 (1-eps^2) + 16 eps^2)  -> eps
    M = 2 pi mu w R^3 L / (c sqrt(1-eps^2))
Lateral ring (two faces, gap h per face): M = mu pi w (R^4 - r^4) / h
Single-sided ports (GDS power model 2016): rotors pressed to the floor, one viscous face with
the whole clearance, plus Coulomb floor friction M_c = mu_f q 2pi/3 (ro^3 - ri^3), q = dp/2.
SI units throughout.

Named assumptions (researcher review 2026-10-30)
----------------------------------------------
A-D5 OD_CLEARANCE_DIAMETRAL: design key ``odClr`` [mm] is the *diametral* outer-rotor/housing
     clearance; the Ocvirk radial clearance is c_out = odClr / 2. Totaro (nomenclature p.16)
     defines c_out radial. If a table value is radial, convert with ``radial_to_diametral``
     (radial torque scales ~1/c, so a mix-up is a factor 2). Same convention for ``jbClr``.
A-D6 JOURNAL_SYMMETRIC: the pressure load W is split W/2 per bearing and ``jbLen`` is the *total*
     length of two equal bearings (each jbLen/2). Totaro Eq.(8)-(9) splits by lever arms
     W1 = W l2/(l1+l2), W2 = W l1/(l1+l2) with individual lengths. Literature variant: pass
     ``journal=dict(l1=..., l2=..., L1=..., L2=...)`` [mm] to ``compute_mechanical``
     (default None = symmetric, identical to the JS tool).
"""
from __future__ import annotations

import math

from .errors import require_analysis

TAU = 2 * math.pi


def ocvirk_load(mu, w, R, L, c, eps):
    return mu * w * R * L ** 3 / (4 * c * c) * eps / (1 - eps * eps) ** 2 * math.sqrt(
        math.pi ** 2 * (1 - eps * eps) + 16 * eps * eps)


def solve_eccentricity(W, mu, w, R, L, c) -> float:
    """Eccentricity ratio carrying load W (100 bisections; load increases monotonically)."""
    if not (W > 0) or not (w > 0):
        return 0.0
    lo, hi = 0.0, 1 - 1e-12
    for _ in range(100):
        m = 0.5 * (lo + hi)
        if ocvirk_load(mu, w, R, L, c, m) < W:
            lo = m
        else:
            hi = m
    return 0.5 * (lo + hi)


def journal_torque(mu, w, R, L, c, eps):
    return TAU * mu * w * R ** 3 * L / (c * math.sqrt(1 - eps * eps))


def ring_torque(mu, w, r_in, r_out, h):
    """Viscous torque of an annulus, two faces with gap h each [N m]."""
    return mu * math.pi * w * (r_out ** 4 - r_in ** 4) / h if (h > 0 and r_out > r_in) else 0.0


def coulomb_ring_torque(mu_f, q, r_in, r_out):
    """Coulomb friction torque of an annulus under uniform contact pressure q [N m]."""
    return mu_f * q * TAU / 3 * (r_out ** 3 - r_in ** 3) if (r_out > r_in and q > 0) else 0.0


def single_sided(p) -> bool:
    """Rotors pressed to the floor: single-sided ports without shadow ports / double fill."""
    return p.get("faceSupport") == "single" and not p.get("doubleFill") and not ((p.get("fillD") or 0) > 1)


def radial_to_diametral(c_radial):
    """Radial clearance -> diametral clearance (x2), e.g. for ``odClr`` / ``jbClr``."""
    return 2 * c_radial


def diametral_to_radial(c_diametral):
    """Diametral clearance -> radial clearance (/2)."""
    return c_diametral / 2


def compute_mechanical(p, res, journal: dict | None = None) -> dict:
    """Shaft torque and efficiencies. ``journal`` = None: symmetric bearings (A-D6, JS behaviour);
    dict(l1, l2, L1, L2) [mm]: Totaro lever-arm split W_1 = W l2/(l1+l2), W_2 = W l1/(l1+l2),
    bearing lengths L1, L2 (radius bore/2 and diametral clearance jbClr for both)."""
    require_analysis(res, "compute_mechanical", ("cc",))
    mm = 1e-3
    tau = (p["N"] - 1) / p["N"]
    mu = p["nu"] * 1e-6 * p["rho"]
    w1 = p["rpm"] * TAU / 60
    w2 = w1 * tau
    dp, L = p["dp"] * 1e5, p["b"] * mm
    single = single_sided(p)
    hLat = max(0.0, p["axialClr"]) / 2 * mm * (4 if single else 1)
    cOut = max(0.0, p["odClr"]) / 2 * mm

    Mth = res["cc"] * 1e-6 * dp / TAU
    W = dp * 2 * p["innerTip"] * mm * L

    MoutRad = epsOut = 0.0
    if cOut > 0 and w2 > 0:
        epsOut = solve_eccentricity(W, mu, w2, p["OD"] / 2 * mm, L, cOut)
        MoutRad = journal_torque(mu, w2, p["OD"] / 2 * mm, L, cOut, epsOut)
    MoutLat = ring_torque(mu, w2, p["Rv"] * mm, p["OD"] / 2 * mm, hLat)
    MinLat = ring_torque(mu, w1, p["bore"] / 2 * mm, p["innerRoot"] * mm, hLat)
    muF = max(0.0, p.get("faceMu") or 0)
    MoutFloor = coulomb_ring_torque(muF, dp / 2, p["Rv"] * mm, p["OD"] / 2 * mm) if single else 0.0
    MinFloor = coulomb_ring_torque(muF, dp / 2, p["bore"] / 2 * mm, p["innerRoot"] * mm) if single else 0.0

    Mjb = epsJb = 0.0
    cJb = max(0.0, p["jbClr"]) / 2 * mm
    Ljb = max(0.0, p["jbLen"]) * mm
    Rjb = p["bore"] / 2 * mm
    if journal is not None:
        l1, l2 = float(journal["l1"]), float(journal["l2"])
        L1, L2 = float(journal["L1"]) * mm, float(journal["L2"]) * mm
        if cJb > 0 and Rjb > 0 and w1 > 0 and l1 + l2 > 0:
            epsJb = 0.0
            for Wk, Lk in ((W * l2 / (l1 + l2), L1), (W * l1 / (l1 + l2), L2)):
                if Lk > 0:
                    ek = solve_eccentricity(Wk, mu, w1, Rjb, Lk, cJb)
                    Mjb += journal_torque(mu, w1, Rjb, Lk, cJb, ek)
                    epsJb = max(epsJb, ek)
    elif cJb > 0 and Ljb > 0 and Rjb > 0 and w1 > 0:
        epsJb = solve_eccentricity(W / 2, mu, w1, Rjb, Ljb / 2, cJb)
        Mjb = 2 * journal_torque(mu, w1, Rjb, Ljb / 2, cJb, epsJb)

    ct = res.get("contact")
    Mpress = ct["torqueMean"] if (ct and ct["pressureSource"] == "simulated") else Mth
    Mshaft = Mpress + tau * (MoutRad + MoutLat + MoutFloor) + MinLat + MinFloor + Mjb
    ports = res.get("ports")
    etaV = ports["portEfficiency"] if (ports and ports.get("portEfficiency") is not None) else 1.0
    etaM = Mth / Mshaft if Mshaft > 0 else 1.0
    return {
        "Mth": Mth, "Mports": Mpress - Mth, "MoutRad": MoutRad, "MoutLat": MoutLat, "MinLat": MinLat,
        "MoutFloor": MoutFloor, "MinFloor": MinFloor, "Mjb": Mjb, "Mshaft": Mshaft,
        "epsOut": epsOut, "epsJb": epsJb, "W": W, "single": single,
        "etaM": etaM, "etaV": etaV, "etaT": etaM * etaV,
        "powerIn": Mshaft * w1,
        "powerOut": etaV * res["cc"] * 1e-6 * p["rpm"] / 60 * dp,
        "lossPower": (Mshaft - Mth) * w1,
    }
