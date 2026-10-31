"""Tooth contact with clearance / backlash (port of js/backlash.js).

The inner profile is the trochoid offset by rp + c, so with c > 0 the rotors are not exactly
conjugate. The inner rotor drives; the outer rotor lags its conjugate position by delta(t)
until the first lobe touches (Ivanovic et al. 2012; Rundo 2017 sec. 4.1.3).

Gap at lobe k:  h_k = c + d_k, d_k = signed normal distance (outward +) from the lobe centre
to the trochoid, both in the inner-rotor frame. delta(t) solves min_k h_k(delta) = 0
(bisection). By symmetry h_k(t) = h_0(t + 2 pi k / N) and delta is 2 pi / N periodic.
Units: mm, rad.
"""
from __future__ import annotations

import math

import numpy as np

from .geometry import TAU, js_round, trochoid, trochoid_d1, trochoid_d2

from .errors import require_analysis


def signed_distance(p, Y, phi0: float) -> float:
    """Signed distance (outward +) from point Y (inner frame) to the trochoid.

    Foot point by Newton on g(phi) = (Q - Y) . Q' = 0 starting at phi0 (max 8 iterations).
    """
    phi = phi0
    for _ in range(8):
        q, d1, d2 = trochoid(p, phi), trochoid_d1(p, phi), trochoid_d2(p, phi)
        rx, ry = q[0] - Y[0], q[1] - Y[1]
        g = rx * d1[0] + ry * d1[1]
        gp = d1[0] * d1[0] + d1[1] * d1[1] + rx * d2[0] + ry * d2[1]
        step = g / gp
        phi -= step
        if abs(step) < 1e-13:
            break
    q, d1 = trochoid(p, phi), trochoid_d1(p, phi)
    L = math.hypot(d1[0], d1[1])
    return ((Y[0] - q[0]) * d1[1] - (Y[1] - q[1]) * d1[0]) / L


def gaps_at(p, t: float, delta: float, out=None) -> np.ndarray:
    """Gaps h_k [mm] of all N lobes at outer angle t with the outer rotor lagging by delta."""
    N = p["N"]
    out = np.zeros(N) if out is None else out
    a1 = N * t / (N - 1)
    ca, sa = math.cos(-a1), math.sin(-a1)
    for k in range(N):
        th = t - delta + TAU * k / N
        X = (p["R"] * math.cos(th) - p["e"], p["R"] * math.sin(th))
        Y = (ca * X[0] - sa * X[1], sa * X[0] + ca * X[1])
        out[k] = p["c"] + signed_distance(p, Y, -t / (N - 1) + TAU * k / N)
    return out


def solve_delta(p, t: float, buf=None) -> float:
    """Backlash angle delta(t) [rad]: smallest delta >= 0 with min gap = 0 (bracket + 60 bisections)."""
    if not (p["c"] > 0):
        return 0.0
    buf = np.zeros(p["N"]) if buf is None else buf

    def min_gap(d):
        gaps_at(p, t, d, buf)
        return float(buf.min())

    lo, hi = 0.0, p["c"] / p["R"]
    for _ in range(40):
        if not (min_gap(hi) > 0):
            break
        hi *= 2
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if min_gap(mid) > 0:
            lo = mid
        else:
            hi = mid
    return hi


def compute_backlash(p, res) -> dict:
    """Backlash over the analysis grid t_j = j dt.

    delta[j] backlash angle [rad]; gap0[j] gap at lobe 0; gapLead[j] gap at the leading
    contact of chamber 0 (lobe 1) = gap0[j + M/N]; nContact[j] lobes with gap < 1 % of c.
    speedPulsation = max |d delta / dt| (outer speed omega2_actual/omega2 = 1 - d delta/dt).
    """
    require_analysis(res, "compute_backlash", ("M", "dt"))
    M, dt, N = res["M"], res["dt"], p["N"]
    step = M // N
    buf = np.zeros(N)
    delta_pitch = np.array([solve_delta(p, j * dt, buf) for j in range(step)])
    delta = np.tile(delta_pitch, N)
    gap0 = np.zeros(M)
    nContact = np.zeros(M, dtype=int)
    for j in range(M):
        gaps_at(p, j * dt, delta[j], buf)
        gap0[j] = buf[0]
        nContact[j] = int(np.sum(buf < 0.01 * p["c"]))
    gapLead = np.roll(gap0, -step)
    rate = np.abs(np.roll(delta, -1) - np.roll(delta, 1)) / (2 * dt)
    jTip = js_round(math.pi / dt) % M
    return {
        "delta": delta, "gap0": gap0, "gapLead": gapLead, "nContact": nContact,
        "deltaMax": max(0.0, float(delta.max())), "deltaMin": float(delta.min()),
        "speedPulsation": max(0.0, float(rate.max())),
        "doubleContactFraction": float(np.sum(nContact >= 2)) / M,
        "tipToTipGap": float(gap0[jTip]),
    }
