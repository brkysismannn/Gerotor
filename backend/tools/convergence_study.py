"""Convergence / sensitivity study of the gerotor_core numerical settings (docs/convergence.md).

Runs the 4 JS reference designs (tests/reference/*.json, material = example 210 GPa / 0.3) with each
numerical setting varied around its current value and prints the maximum relative change of the
monitored outputs versus the finest (reference) value. Usage (from backend/):

    python tools/convergence_study.py [--quick] > study.json

Monitored outputs: cc, ripple, rhoMin, AmaxActual, tool diameter, filletClearance, backlash deltaMax,
contact pmaxMax / Fmax / torqueMean, ports As/Ad max, qMean, pMaxBar, pMinBar, portEfficiency,
voidMax, leak total, outlet rippleRel, friction Mshaft / etaT.
"""
from __future__ import annotations

import contextlib
import json
import math
import pathlib
import sys
import time

BACKEND = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
import numpy as np  # noqa: E402

from gerotor_core import backlash, contact, friction, geometry, leakage, ports  # noqa: E402

REF = BACKEND / "tests" / "reference"
MAT = dict(Ein=210, nuIn=0.3, Eout=210, nuOut=0.3)  # example input (JS fallback values)


def designs():
    out = {}
    for f in sorted(REF.glob("*.json")):
        ref = json.loads(f.read_text(encoding="utf-8"))
        out[f.stem] = (geometry.derive(dict(MAT, **ref["params"])), ref["opts"].get("samples", 96))
    return out


def _f(x):
    try:
        x = float(x)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def metrics(p, samples):
    r = geometry.analyse(p, samples=samples)
    m = {"cc": r.get("cc"), "ripple": r.get("ripple"), "rhoMin": r.get("rhoMin"),
         "AmaxActual": r.get("AmaxActual"), "AminActual": r.get("AminActual"),
         "tool": geometry.inner_tool_diameter(p)["diameter"], "filletClearance": r.get("filletClearance")}
    bl = r.get("backlash") or {}
    m.update(deltaMax=bl.get("deltaMax"), speedPulsation=bl.get("speedPulsation"))
    ct = r.get("contact") or {}
    m.update(pmaxMax=ct.get("pmaxMax"), Fmax=ct.get("Fmax"), torqueMean=ct.get("torqueMean"))
    P = r.get("ports") or {}
    if P:
        m.update(AsMax=float(np.max(P["As"])), AdMax=float(np.max(P["Ad"])), qMean=P.get("qMean"),
                 pMaxBar=P.get("pMaxBar"), pMinBar=P.get("pMinBar"), portEfficiency=P.get("portEfficiency"),
                 voidMax=P.get("voidMax"), crossDeg=P.get("crossDeg"))
        lk = P.get("leak") or {}
        m["leakTotal"] = sum(v for v in lk.values() if isinstance(v, (int, float))) if isinstance(lk, dict) else None
        out = P.get("outlet") or {}
        m["outletRippleRel"] = out.get("rippleRel") if isinstance(out, dict) else None
        sim = ports.simulate_chamber(p, r, P["As"], P["Ad"])
        m["singlePmax"] = float(np.max(sim["P"])) if "P" in sim else None
    mech = r.get("mech") or {}
    m.update(Mshaft=mech.get("Mshaft"), etaT=mech.get("etaT"))
    return {k: _f(v) for k, v in m.items() if _f(v) is not None}


@contextlib.contextmanager
def setting(mod, name, value):
    old = getattr(mod, name)
    setattr(mod, name, value)
    try:
        yield
    finally:
        setattr(mod, name, old)


def rel(a, b):
    """Relative change of a against reference b; absolute for quantities that are ~0."""
    sc = max(abs(b), 1e-12)
    return abs(a - b) / sc


def study(name, mod, attr, values, D, keys=None, design_key=None):
    """values sorted coarse -> fine; reference = last (finest). design_key: vary p[design_key] instead."""
    import os
    only = os.environ.get("STUDY_ONLY")
    if only and not any(o in name for o in only.split("|")):
        return None
    rows = {}
    for dn, (p, samples) in D.items():
        res = []
        for v in values:
            t0 = time.time()
            if design_key:
                m = metrics(dict(p, **{design_key: v}), samples)
            elif attr == "samples":
                m = metrics(p, v)
            else:
                with setting(mod, attr, v):
                    m = metrics(p, samples)
            res.append((v, m, time.time() - t0))
        ref = res[-1][1]
        ks = [k for k in (keys or ref) if k in ref]
        rows[dn] = [{"value": v, "seconds": round(dt, 2),
                     "maxRel": max((rel(m[k], ref[k]) for k in ks if k in m), default=0.0),
                     "worst": max(ks, key=lambda k: rel(m.get(k, ref[k]), ref[k])) if ks else None,
                     "relByKey": {k: rel(m[k], ref[k]) for k in ks if k in m}} for v, m, dt in res]
    return {"setting": name, "values": values, "designs": rows}


class _Out(list):
    """Appends each finished study as one JSON line to stdout (long runs survive interruption)."""
    def append(self, x):
        if x is None:
            return
        super().append(x)
        print(json.dumps(x), flush=True)


def main(quick=False, only=None):
    D = designs()
    G, Pm, L, Bk, F, C = geometry, ports, leakage, backlash, friction, contact
    S = _Out()
    geo_keys = ["cc", "ripple", "AmaxActual", "AminActual"]
    S.append(study("samples per pitch (N01)", None, "samples", [24, 48, 96, 192] if quick else [24, 48, 96, 192, 384], D,
                   keys=geo_keys))
    S.append(study("CURV_N undercut scan (N02)", G, "CURV_N", [1000, 2000, 4000, 16000], D, keys=["rhoMin"]))
    S.append(study("TOOL_COARSE_N (N03)", G, "TOOL_COARSE_N", [180, 360, 720, 2880], D, keys=["tool"]))
    S.append(study("TOOL_GOLDEN_STEPS (N03)", G, "TOOL_GOLDEN_STEPS", [20, 40, 60, 100], D, keys=["tool"]))
    for a, vals in (("FILLET_PROFILE_N", [750, 1500, 3000, 12000]), ("FILLET_PTS", [4, 7, 14, 56]),
                    ("FILLET_POS_PER_LOBE", [16, 32, 64, 256])):
        S.append(study(a + " (N04)", G, a, vals, D, keys=["filletClearance"]))
    S.append(study("INNER_SECTOR_PANELS Gauss 8-pt (N05)", G, "INNER_SECTOR_PANELS", [6, 12, 24, 96], D,
                   keys=["cc", "ripple", "AmaxActual"]))
    port_keys = ["AsMax", "AdMax", "qMean", "pMaxBar", "pMinBar", "portEfficiency", "crossDeg"]
    S.append(study("CHAMBER_N_IN (N06)", G, "CHAMBER_N_IN", [12, 24, 48, 192], D, keys=port_keys))
    S.append(study("CHAMBER_N_OUT (N06)", G, "CHAMBER_N_OUT", [4, 8, 16, 64], D, keys=port_keys))
    S.append(study("ACTUAL_AREA_STRIDE (N06)", G, "ACTUAL_AREA_STRIDE", [4, 2, 1], D, keys=["AmaxActual", "AminActual"]))
    for a, vals in (("PORT_ARC_N", [24, 48, 96, 384]), ("PIECE_SEGMENTS", [6, 12, 24, 96]), ("DISK_N", [32, 64, 128, 512]),
                    ("FILLET_ARC_N", [3, 6, 12, 48]), ("PORT_EXTENT_N_IN", [24, 48, 96, 384])):
        S.append(study(a + " (N07)", Pm, a, vals, D, keys=port_keys))
    net_keys = ["qMean", "pMaxBar", "pMinBar", "portEfficiency", "voidMax", "torqueMean", "pmaxMax", "Mshaft", "etaT"]
    S.append(study("simSub network sub-steps (N08)", None, None, [1, 2, 4, 6, 12, 24], D, keys=net_keys, design_key="simSub"))
    S.append(study("CH_SUB_DEFAULT single chamber (N08)", Pm, "CH_SUB_DEFAULT", [3, 6, 12, 48], D, keys=["singlePmax"]))
    S.append(study("CH_CYCLES (N08)", Pm, "CH_CYCLES", [2, 3, 6], D, keys=["singlePmax"]))
    S.append(study("CH_BISECT (N08)", Pm, "CH_BISECT", [30, 45, 60, 80], D, keys=["singlePmax"]))
    S.append(study("NET_SWEEPS 3-pass leakage loop (N08)", L, "NET_SWEEPS", [1, 2, 3, 6], D, keys=net_keys))
    S.append(study("NET_CYCLES (N08)", L, "NET_CYCLES", [2, 3, 6], D, keys=net_keys))
    S.append(study("NET_BISECT (N08)", L, "NET_BISECT", [30, 40, 50, 70], D, keys=net_keys))
    S.append(study("OUT_SUB (N09)", L, "OUT_SUB", [2, 4, 8, 32], D, keys=["outletRippleRel"]))
    S.append(study("OUT_CYCLES (N09)", L, "OUT_CYCLES", [2, 4, 8], D, keys=["outletRippleRel"]))
    S.append(study("OUT_BISECT (N09)", L, "OUT_BISECT", [30, 45, 60, 80], D, keys=["outletRippleRel"]))
    bl_keys = ["deltaMax", "speedPulsation", "pmaxMax"]
    S.append(study("NEWTON_ITERS (N10)", Bk, "NEWTON_ITERS", [3, 5, 8, 20], D, keys=bl_keys))
    S.append(study("DELTA_BISECT (N10)", Bk, "DELTA_BISECT", [30, 45, 60, 80], D, keys=bl_keys))
    S.append(study("ECC_BISECT (N11)", F, "ECC_BISECT", [40, 60, 100, 150], D, keys=["Mshaft", "etaT"]))
    S.append(study("RHO_EQ_CAP_MM Hertz cap (C04/A-D8b)", L, "RHO_EQ_CAP_MM", [1e3, 1e4, 1e5, 1e7], D,
                   keys=["pmaxMax", "qMean", "portEfficiency", "Mshaft"]))
    S.append(study("LOBE_PROBE_LAG (C10)", C, "LOBE_PROBE_LAG", [1e-5, 1e-6, 1e-7, 1e-9], D, keys=["pmaxMax", "Fmax"]))
    S.append(study("OPEN_TOL_REL (C18)", Pm, "OPEN_TOL_REL", [1e-3, 1e-4, 1e-5, 1e-6], D, keys=["crossDeg"]))
    return S


if __name__ == "__main__":
    main("--quick" in sys.argv)  # JSON lines, one per setting
