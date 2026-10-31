"""Reverse engineering from measured diameters (port of js/reverse.js).

    inner tip   Dt = 2(R + e - rp - c)       inner root Dr = 2(R - e - rp - c)
    outer minor Dl = 2(R - rp)               outer major Dv = 2 Rv
=>  e = (Dt - Dr)/4,  c = Dl/2 - (Dt + Dr)/4,  R = Dl/2 + rp,  Rv = Dv/2.   Units: mm.
"""
from __future__ import annotations


def reverse_engineer(m) -> dict:
    issues = []
    rp, N = m["rp"], m["N"]
    e = (m["Dt"] - m["Dr"]) / 4
    c = m["Dl"] / 2 - (m["Dt"] + m["Dr"]) / 4
    R = m["Dl"] / 2 + rp
    Dv = m.get("Dv") or 0
    Rv = Dv / 2
    RvMin = R + 2 * e - rp
    if not (e > 0):
        issues.append("Inner tip diameter must exceed inner root diameter.")
    if c < -1e-9:
        issues.append(f"Negative clearance ({c * 1000:.1f} um): outer minor diameter too small.")
    if not (R > N * e):
        issues.append(f"R ({R:.3f}) must exceed N e ({N * e:.3f}).")
    if Dv > 0 and Rv < RvMin - max(c, 0) - 1e-9:
        issues.append("Outer major diameter is smaller than the tooth-tip path.")
    params = {"N": N, "e": round(e, 5), "R": round(R, 5), "rp": rp, "c": round(max(0.0, c), 5),
              "RvAuto": not (Dv > 0), "Rv": round(Rv, 5) if Dv > 0 else None}
    for k in ("b", "OD"):
        if (m.get(k) or 0) > 0:
            params[k] = m[k]
    if m.get("bore") is not None and m["bore"] >= 0:
        params["bore"] = m["bore"]
    return {"ok": not issues, "issues": issues, "params": params,
            "derived": {"e": e, "c": c, "R": R, "Rv": Rv, "lambda": R / (N * e), "k": rp / e,
                        "valleyMargin": Rv - RvMin + max(c, 0)}}


def measured_diameters(p) -> dict:
    """Forward model: the diameters one would measure on design p."""
    return {"N": p["N"], "Dt": 2 * (p["R"] + p["e"] - p["rp"] - p["c"]), "Dr": 2 * (p["R"] - p["e"] - p["rp"] - p["c"]),
            "Dl": 2 * (p["R"] - p["rp"]), "Dv": 2 * p["Rv"], "rp": p["rp"]}
