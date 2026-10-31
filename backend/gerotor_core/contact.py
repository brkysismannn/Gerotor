"""Contact force, Hertz stress, sliding velocity, wear indicator, shaft side load (port of js/contact.js).

Fluid torques (Rundo 2017 Eqs. 18-19; vector rays to the two contacts of each chamber,
c0 = trailing contact on lobe k, c1 = leading contact on lobe k+1), gauge pressure g = p - p_in:
    inner rotor (about O1):  T_i = g b/2 (|c0 - O1|^2 - |c1 - O1|^2)
    outer rotor (about O2):  T_o = g b/2 (|c1|^2 - |c0|^2)
    shaft torque (ideal):    T_shaft = sum (T_i + tau T_o),  tau = (N-1)/N
The free-running outer rotor is balanced by the contact force: F_n arm_o = sum T_o.

Hertz line contact (length b), 1/E* = (1-nu1^2)/E1 + (1-nu2^2)/E2:
    p_max = sqrt(F E* / (pi b rho_eq)),  a = sqrt(4 F rho_eq / (pi b E*))   (Johnson, Contact Mechanics)
Sliding velocity v_s = (omega1/N) |P - I|, I = pitch point (N e, 0).
Wear-rate proportional factor WRPF = p_max v_s: provenance UNVERIFIED (attributed to Ivanovic 2020,
not on the desk; Colbourne 1974/1975 and the Ivanovic 2021 chapter do not contain it).
Named assumptions (researcher review 2026-10-30):
A-D8a HERTZ_SINGLE_LOBE: the whole outer-rotor balancing force F_n acts on one lobe (Totaro 2025
      p.4 single-contact hypothesis). During the short double-contact intervals (Ivanovic 2012
      p.8; backlash doubleContactFraction) p_max is overstated (conservative). Not changed.
A-D8b HERTZ_CONFORMAL_CAP: rho_eq capped at 1e4 mm (see leakage.contact_rho_eq); Hertz validity
      not enforced. ``hertz_validity(a, rho_eq)`` returns a / rho_eq; > ~0.1 means Hertz is
      outside its small-contact assumption.
Shaft side load (GDS): F_shaft = sum_k g_k b J(c1 - c0) - F_n n.
SI outputs (N, Pa, m/s, N m).
"""
from __future__ import annotations

import math

import numpy as np

from . import backlash as _bl
from .geometry import TAU, chamber, lobe_limits
from .leakage import contact_rho_eq

LOBE_PROBE_LAG = 1e-7  # C10 probe lag [rad] that picks the first lobe to close (docs/convergence.md)

from .errors import require_analysis, require_design


def e_star(E1, nu1, E2, nu2):
    """Effective modulus E* [Pa]."""
    return 1 / ((1 - nu1 * nu1) / E1 + (1 - nu2 * nu2) / E2)


def hertz_pmax(F, b, rho_eq, Es):
    """Peak Hertz line-contact pressure [Pa] (F [N], b and rho_eq [m], E* [Pa])."""
    return math.sqrt(F * Es / (math.pi * b * rho_eq))


def hertz_half_width(F, b, rho_eq, Es):
    """Hertz contact half-width a [m]."""
    return math.sqrt(4 * F * rho_eq / (math.pi * b * Es))


def hertz_validity(a, rho_eq):
    """Hertz small-contact ratio a / rho_eq (same length units). Hertz assumes a << rho_eq (< ~0.1)."""
    return a / rho_eq if rho_eq > 0 else math.inf


def contact_lobe(p, t, buf, delta=None) -> int:
    """Lobe carrying the load at outer angle t (inner rotor drives).

    With a solved backlash angle: the lobe with the smallest gap. Otherwise all gaps equal c at
    delta = 0, and the first lobe to close is the one whose gap shrinks fastest: evaluated with
    c = 0 at a tiny lag 1e-7 rad.
    """
    if delta is not None and p["c"] > 0:
        _bl.gaps_at(p, t, delta, buf)
    else:
        _bl.gaps_at(dict(p, c=0), t, LOBE_PROBE_LAG, buf)
    return int(np.argmin(buf))


def compute_contact(p, res, quasi_static: bool = False, gauge=None) -> dict:
    """Contact model over the analysis grid (one lobe pitch computed, then replicated).

    Pressures: simulated chamber pressures (res['ports']['sim']) when present and not
    ``quasi_static``; otherwise delivery pressure on chambers at housing angle in (pi, 2 pi).
    """
    require_analysis(res, "compute_contact", ("M", "dt"))
    M, dt, dA = res["M"], res["dt"], res["dA"]
    N = p["N"]
    step = M // N
    tau = (N - 1) / N
    L = lobe_limits(p)
    b, dpPa = p["b"] * 1e-3, p["dp"] * 1e5
    w1 = p["rpm"] * TAU / 60
    # Rotor materials are user inputs (no fallback: the former 210 GPa / 0.3 had no source, audit C03).
    require_design(p, "compute_contact (rotor material)", ("Ein", "nuIn", "Eout", "nuOut"))
    Es = e_star(p["Ein"] * 1e9, p["nuIn"], p["Eout"] * 1e9, p["nuOut"])
    ports = res.get("ports")
    sim = ports.get("sim") if (not quasi_static and ports) else None
    if gauge is None:
        def gauge(j, k):
            jk = (j + k * step) % M
            if sim is not None:
                return sim["P"][jk] - sim["pS"]
            th = (jk * dt + math.pi / N) % TAU
            return dpPa if th > math.pi else 0.0

    F, Pmax, Vs, W = (np.zeros(M) for _ in range(4))
    Tshaft, Tenergy, armRatio, pitchDist, Sx, Sy = (np.zeros(M) for _ in range(6))
    lobe = np.zeros(M, dtype=int)
    buf = np.zeros(N)
    I = (N * p["e"], 0.0)
    e = p["e"]

    for j in range(step):
        t = j * dt
        To = Ti = Te = fx = fy = 0.0
        for k in range(N):
            c0, c1 = chamber(p, t + TAU * k / N, L, -1)["contacts"]
            g = gauge(j, k)
            ux, uy = -(c1[1] - c0[1]), c1[0] - c0[0]
            if ux * (0.5 * (c0[0] + c1[0]) - e) + uy * 0.5 * (c0[1] + c1[1]) > 0:
                ux, uy = -ux, -uy
            fx += g * b * (ux * 1e-3)
            fy += g * b * (uy * 1e-3)
            m = 1e-3
            To += g * b / 2 * ((c1[0] * m) ** 2 + (c1[1] * m) ** 2 - (c0[0] * m) ** 2 - (c0[1] * m) ** 2)
            Ti += g * b / 2 * (((c0[0] - e) * m) ** 2 + (c0[1] * m) ** 2 - ((c1[0] - e) * m) ** 2 - (c1[1] * m) ** 2)
            Te += g * (-dA[(j + k * step) % M]) * 1e-6 * b * tau
        Tshaft[j] = Ti + tau * To
        Tenergy[j] = Te

        bl = res.get("backlash")
        kc = contact_lobe(p, t, buf, bl["delta"][j] if bl is not None else None)
        lobe[j] = kc
        tk = t + TAU * kc / N
        P = chamber(p, tk, L, -1)["contacts"][0]
        C = (p["R"] * math.cos(tk), p["R"] * math.sin(tk))
        nx, ny = C[0] - P[0], C[1] - P[1]
        nl = math.hypot(nx, ny)
        n = (nx / nl, ny / nl)                                  # force on the outer lobe
        armO = (P[0] * n[1] - P[1] * n[0]) * 1e-3               # about O2
        armI = ((P[0] - e) * n[1] - P[1] * n[0]) * 1e-3         # about O1
        armRatio[j] = armI / armO
        pitchDist[j] = abs((I[0] - P[0]) * n[1] - (I[1] - P[1]) * n[0])
        F[j] = To / armO
        Sx[j] = fx - F[j] * n[0]
        Sy[j] = fy - F[j] * n[1]
        rhoEq = contact_rho_eq(p, -tk / (N - 1)) * 1e-3
        Pmax[j] = hertz_pmax(F[j], b, rhoEq, Es) if F[j] > 0 else 0.0
        Vs[j] = (w1 / N) * math.hypot(P[0] - I[0], P[1] - I[1]) * 1e-3
        W[j] = Pmax[j] * Vs[j]

    for arr in (F, Pmax, Vs, W, Tshaft, Tenergy, armRatio, pitchDist, Sx, Sy):
        arr[step:] = np.tile(arr[:step], N - 1)
    sh = np.arange(M) // step
    lobe = ((np.tile(lobe[:step], N) - sh) % N + N) % N        # one pitch later the next-lower lobe

    tm = float(np.mean(Tshaft))
    S = np.hypot(Sx, Sy)
    sxm, sym = float(np.mean(Sx)), float(np.mean(Sy))
    return {
        "F": F, "Pmax": Pmax, "Vs": Vs, "W": W, "Tshaft": Tshaft, "Tenergy": Tenergy,
        "armRatio": armRatio, "pitchDist": pitchDist, "lobe": lobe, "Es": Es,
        "shaftX": Sx, "shaftY": Sy, "shaftLoadMax": float(S.max()), "shaftLoadMean": math.hypot(sxm, sym),
        "shaftLoadAngle": math.atan2(sym, sxm) * 180 / math.pi,
        "pressureSource": "simulated" if sim is not None else "quasi-static",
        "Fmax": float(F.max()), "Fmin": float(F.min()),
        "pmaxMax": float(Pmax.max()), "vsMax": float(Vs.max()), "wrpfMax": float(W.max()),
        "torqueMean": tm, "torqueRipple": (float(Tshaft.max()) - float(Tshaft.min())) / abs(tm),
        "reversal": float(F.min()) < 0,
    }
