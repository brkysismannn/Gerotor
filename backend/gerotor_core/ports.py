"""Port plate (kidney ports), opening areas and single-chamber pressure model (port of js/ports.js).

Housing frame: O2 = (0,0), O1 = (e,0), CCW rotation; a chamber at housing angle 0 is at minimum
volume, at pi at maximum volume. Suction spans (0, pi), delivery (pi, 2 pi).
Port outline: radial edges from O2, outer arc about O2 (portRo), inner arc about O1 (portRi).
Theoretical edges = angular extent of the chamber at its min / max position (Kim et al. 2006;
Gamez-Montero et al.), shifted by timing offsets [deg] (positive = direction of rotation).
Pressure model (Rundo 2017; Kim et al. 2006): dp/dt = K/V (Qs + Qd - dV/dt),
Q = sgn(dp) Cd A sqrt(2|dp|/rho), implicit Euler, void volume below p_cav.
Geometry mm / rad; pressure model SI.
"""
from __future__ import annotations

import math

import numpy as np

from .geometry import TAU, chamber, polygon_area
from .leakage import orifice, simulate_network, outlet_ripple

from .errors import require_analysis

DEG = math.pi / 180


def _wrap_pi(a):
    return math.atan2(math.sin(a), math.cos(a))


# ----------------------------------------------------------------- polygon tools

def clip_convex(subject, clip):
    """Sutherland-Hodgman: clip a simple polygon by a convex CCW polygon."""
    out = list(subject)
    n = len(clip)
    for i in range(n):
        if not out:
            break
        a, b = clip[i], clip[(i + 1) % n]
        ex, ey = b[0] - a[0], b[1] - a[1]
        inp, out = out, []
        m = len(inp)
        sides = [ex * (q[1] - a[1]) - ey * (q[0] - a[0]) for q in inp]
        for j in range(m):
            P, Q = inp[j], inp[(j + 1) % m]
            sp, sq = sides[j], sides[(j + 1) % m]
            if sp >= 0:
                out.append(P)
            if (sp >= 0) != (sq >= 0):
                t = sp / (sp - sq)
                out.append((P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])))
    return out


def _area(poly):
    return 0.0 if len(poly) < 3 else abs(polygon_area(poly))


def circle_poly(c, r, n):
    return [(c[0] + r * math.cos(TAU * i / n), c[1] + r * math.sin(TAU * i / n)) for i in range(n)]


# ----------------------------------------------------------------- port geometry

def chamber_extent(p, L, thC):
    """Polar extent about O2 of the chamber polygon centred at housing angle thC."""
    poly = chamber(p, thC - math.pi / p["N"], L, 96, 32)["polygon"]
    lo, hi = math.inf, -math.inf
    for q in poly:
        a = _wrap_pi(math.atan2(q[1], q[0]) - thC)
        lo, hi = min(lo, a), max(hi, a)
    return thC + lo, thC + hi


def port_angles(p, L) -> dict:
    minLo, minHi = chamber_extent(p, L, 0.0)
    maxLo, maxHi = chamber_extent(p, L, math.pi)

    def o(k):
        return (p.get(k) or 0) * DEG

    return {"theory": {"minLo": minLo, "minHi": minHi, "maxLo": maxLo, "maxHi": maxHi},
            "suction": [minHi + o("sucStart"), maxLo + o("sucEnd")],
            "delivery": [maxHi + o("delStart"), TAU + minLo + o("delEnd")]}


def ray_to_inner(p, a) -> float:
    """Distance along the ray from O2 at angle a to the inner port circle (O1, portRi)."""
    if not (p["portRi"] > 0):
        return 0.0
    ux, uy = math.cos(a), math.sin(a)
    b = ux * p["e"]
    disc = b * b - p["e"] * p["e"] + p["portRi"] * p["portRi"]
    return 0.0 if disc < 0 else b + math.sqrt(disc)


def port_outline(p, a0, a1, n=96):
    """Closed CCW outline of a kidney port spanning [a0, a1]."""
    Ro = p["portRo"]
    pts = [(Ro * math.cos(a0 + (a1 - a0) * i / n), Ro * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    if p["portRi"] > 0:
        s1, s0 = ray_to_inner(p, a1), ray_to_inner(p, a0)
        P1 = (s1 * math.cos(a1), s1 * math.sin(a1))
        P0 = (s0 * math.cos(a0), s0 * math.sin(a0))
        f1 = math.atan2(P1[1], P1[0] - p["e"])
        f0 = math.atan2(P0[1], P0[0] - p["e"])
        d = f0 - f1
        while d > 0:
            d -= TAU
        while d <= -TAU:
            d += TAU
        pts += [(p["e"] + p["portRi"] * math.cos(f1 + d * i / n), p["portRi"] * math.sin(f1 + d * i / n))
                for i in range(n + 1)]
    else:
        pts.append((0.0, 0.0))
    return pts


def sector_pieces(p, a0, a1):
    """Convex pieces (O2 sectors of at most 90 deg, 24-segment arcs) used for area clipping."""
    nP = max(1, math.ceil((a1 - a0) / (math.pi / 2)))
    pieces = []
    for k in range(nP):
        b0 = a0 + (a1 - a0) * k / nP
        b1 = a0 + (a1 - a0) * (k + 1) / nP
        poly = [(0.0, 0.0)]
        for i in range(25):
            a = b0 + (b1 - b0) * i / 24
            poly.append((p["portRo"] * math.cos(a), p["portRo"] * math.sin(a)))
        pieces.append(poly)
    return pieces


def filleted_port(p, a0, a1, rf, n_arc=12):
    """Port corner radii (GDS "Port Fillet Radii").

    Each corner between a radial edge (angle a, inward normal n) and a boundary circle gets a
    tangent fillet rf: outer circle |C| = Ro - rf; inner circle |C - O1| = Ri + rf. The corner
    material is removed from the opening area as a fan of signed triangles from the corner K.
    """
    Ro, Ri, O1 = p["portRo"], p["portRi"], (p["e"], 0.0)

    def corner(a, side, which):
        u = (math.cos(a), math.sin(a))
        n = (-u[1], u[0]) if side > 0 else (u[1], -u[0])
        if which == "outer":
            if not (Ro - rf > rf):
                return None
            s = math.sqrt((Ro - rf) ** 2 - rf * rf)
            C = (s * u[0] + rf * n[0], s * u[1] + rf * n[1])
            Tc = (C[0] * Ro / (Ro - rf), C[1] * Ro / (Ro - rf))
            return dict(C=C, s=s, Tl=(s * u[0], s * u[1]), Tc=Tc, K=(Ro * u[0], Ro * u[1]), ctr=(0.0, 0.0), rad=Ro)
        w = (rf * n[0] - O1[0], rf * n[1] - O1[1])
        uw = u[0] * w[0] + u[1] * w[1]
        disc = uw * uw - (w[0] * w[0] + w[1] * w[1]) + (Ri + rf) ** 2
        if disc < 0:
            return None
        s = -uw + math.sqrt(disc)
        C = (s * u[0] + rf * n[0], s * u[1] + rf * n[1])
        d = math.hypot(C[0] - O1[0], C[1] - O1[1])
        Tc = (O1[0] + (C[0] - O1[0]) * Ri / d, O1[1] + (C[1] - O1[1]) * Ri / d)
        k = ray_to_inner(p, a)
        return dict(C=C, s=s, Tl=(s * u[0], s * u[1]), Tc=Tc, K=(k * u[0], k * u[1]), ctr=O1, rad=Ri)

    def arc(c, r, P, Q, n):
        t0 = math.atan2(P[1] - c[1], P[0] - c[0])
        t1 = math.atan2(Q[1] - c[1], Q[0] - c[0])
        d = _wrap_pi(t1 - t0)
        return [(c[0] + r * math.cos(t0 + d * i / n), c[1] + r * math.sin(t0 + d * i / n)) for i in range(1, n + 1)]

    hasInner = Ri > 0
    c0o, c1o = corner(a0, +1, "outer"), corner(a1, -1, "outer")
    c0i = corner(a0, +1, "inner") if hasInner else None
    c1i = corner(a1, -1, "inner") if hasInner else None
    if not c0o or not c1o or (hasInner and (not c0i or not c1i)):
        return {"error": "Port fillet radius too large for the port."}
    sIn0 = c0i["s"] if hasInner else 0.0
    sIn1 = c1i["s"] if hasInner else 0.0
    if not (c0o["s"] > sIn0 + 1e-9 and c1o["s"] > sIn1 + 1e-9):
        return {"error": "Port fillet radius too large for the radial port width."}
    angTc0 = math.atan2(c0o["Tc"][1], c0o["Tc"][0])
    angTc1 = math.atan2(c1o["Tc"][1], c1o["Tc"][0])
    dA = _wrap_pi(angTc1 - angTc0)
    if dA <= 0:
        dA += TAU
    if not (dA < a1 - a0 + 1e-9):
        return {"error": "Port fillet radius too large for the port angle."}

    out = [(Ro * math.cos(angTc0 + dA * i / 96), Ro * math.sin(angTc0 + dA * i / 96)) for i in range(97)]
    out += arc(c1o["C"], rf, c1o["Tc"], c1o["Tl"], n_arc)
    if hasInner:
        out += arc(c1i["C"], rf, c1i["Tl"], c1i["Tc"], n_arc)
        f1 = math.atan2(c1i["Tc"][1], c1i["Tc"][0] - p["e"])
        f0 = math.atan2(c0i["Tc"][1], c0i["Tc"][0] - p["e"])
        d = f0 - f1
        while d > 0:
            d -= TAU
        while d <= -TAU:
            d += TAU
        out += [(p["e"] + Ri * math.cos(f1 + d * i / 96), Ri * math.sin(f1 + d * i / 96)) for i in range(1, 96)]
        out.append(c0i["Tc"])
        out += arc(c0i["C"], rf, c0i["Tc"], c0i["Tl"], n_arc)
    else:
        out.append((0.0, 0.0))
    out += arc(c0o["C"], rf, c0o["Tl"], c0o["Tc"], n_arc)[:-1]

    waste = []
    for c in ([c0o, c1o, c0i, c1i] if hasInner else [c0o, c1o]):
        poly = [c["Tl"]] + arc(c["C"], rf, c["Tl"], c["Tc"], n_arc) + arc(c["ctr"], c["rad"], c["Tc"], c["K"], 6)
        oa = polygon_area([c["K"]] + poly)
        orient = (oa > 0) - (oa < 0)                     # Math.sign (0 for a degenerate corner)
        for i in range(len(poly) - 1):
            tri = [c["K"], poly[i], poly[i + 1]]
            sgn = polygon_area(tri)
            if abs(sgn) < 1e-14:
                continue
            waste.append({"tri": tri, "sign": orient} if sgn > 0 else {"tri": [tri[0], tri[2], tri[1]], "sign": -orient})
    return {"outline": out, "waste": waste}


def make_port(p, a0, a1) -> dict:
    rf = max(0.0, p.get("portFillet") or 0)
    pieces = sector_pieces(p, a0, a1)
    if rf > 0:
        fp = filleted_port(p, a0, a1, rf)
        if "error" in fp:
            ol = port_outline(p, a0, a1)
            return {"a0": a0, "a1": a1, "outline": ol, "area": _area(ol), "pieces": pieces, "filletError": fp["error"]}
        return {"a0": a0, "a1": a1, "outline": fp["outline"], "area": _area(fp["outline"]), "pieces": pieces,
                "waste": fp["waste"]}
    ol = port_outline(p, a0, a1)
    return {"a0": a0, "a1": a1, "outline": ol, "area": _area(ol), "pieces": pieces}


def make_groove(p, edge, direction, len_deg, w, depth):
    """Relief / metering groove of radial width w on the port mid radius, length len_deg into the land.

    Split into <= 2 deg convex quadrilaterals; exact face area = w r_mid dtheta. Depth d > 0 adds
    the groove cross-section w d in series: A_eff = (A_o^-2 + (w d)^-2)^-1/2.
    """
    if not ((len_deg or 0) > 0) or not ((w or 0) > 0):
        return None
    rIn0 = max(ray_to_inner(p, edge), 0.0)
    rm = 0.5 * (p["portRo"] + rIn0)
    r1, r2 = rm - w / 2, rm + w / 2
    b0 = min(edge, edge + direction * len_deg * DEG)
    b1 = max(edge, edge + direction * len_deg * DEG)
    n = max(1, math.ceil(len_deg / 2))

    def pt(r, a):
        return (r * math.cos(a), r * math.sin(a))

    pieces = []
    for i in range(n):
        a = b0 + (b1 - b0) * i / n
        b = b0 + (b1 - b0) * (i + 1) / n
        pieces.append([pt(r1, a), pt(r2, a), pt(r2, b), pt(r1, b)])
    return {"pieces": pieces, "area": w * rm * (b1 - b0), "rm": rm, "w": w, "a0": b0, "a1": b1,
            "cross": w * depth if (depth or 0) > 0 else math.inf}


def groove_effective(a_open, cross):
    return 1 / math.sqrt(1 / (a_open * a_open) + 1 / (cross * cross)) if (a_open > 0 and math.isfinite(cross)) else a_open


def open_area(poly, port, disk) -> float:
    """Chamber area open to a port: (chamber cap sector) - (cap inner disk) - fillet waste + grooves."""
    s = 0.0
    for piece in port["pieces"]:
        c = clip_convex(poly, piece)
        if len(c) < 3:
            continue
        s += _area(c)
        if disk:
            s -= _area(clip_convex(c, disk))
    for w in port.get("waste") or []:
        s -= w["sign"] * _area(clip_convex(poly, w["tri"]))
    for g in port.get("grooves") or []:
        a = sum(_area(clip_convex(poly, piece)) for piece in g["pieces"])
        s += groove_effective(a, g["cross"])
    return max(0.0, s)


# ----------------------------------------------------------------- single-chamber pressure model

def simulate_chamber(p, res, As, Ad) -> dict:
    """Chamber 0 over three outer revolutions (last recorded); reference for the network model."""
    M, dt, A, dA = res["M"], res["dt"], res["A"], res["dA"]
    w2 = p["rpm"] * TAU / 60 * (p["N"] - 1) / p["N"]
    b = p["b"] * 1e-3
    K, rho, Cd = p["bulk"] * 1e6, p["rho"], p["Cd"]
    pS, pD, pV = p["pIn"] * 1e5, (p["pIn"] + p["dp"]) * 1e5, p["pVap"] * 1e5
    sub = p.get("simSub") or 12
    h = dt / w2 / sub
    P, QS, QD, VF = (np.zeros(M) for _ in range(4))
    pc, void = pS, 0.0

    def lerp(arr, j, f):
        return arr[j] + (arr[(j + 1) % M] - arr[j]) * f

    for cycle in range(3):
        for j in range(M):
            qsAcc = qdAcc = 0.0
            for s in range(sub):
                f = (s + 0.5) / sub
                V = lerp(A, j, f) * 1e-6 * b
                dVdt = lerp(dA, j, f) * 1e-6 * b * w2
                a_s, a_d = lerp(As, j, f) * 1e-6, lerp(Ad, j, f) * 1e-6

                def Qin(pp):
                    return orifice(a_s, pS, pp, Cd, rho) + orifice(a_d, pD, pp, Cd, rho)

                if void > 0:
                    pc = pV
                    void = max(0.0, void + (dVdt - Qin(pV)) * h)
                else:
                    pco = pc

                    def F(pp):
                        return (V / K) * (pp - pco) / h - Qin(pp) + dVdt

                    if F(pV) > 0:
                        pc = pV
                        void = max(0.0, void + (dVdt - Qin(pV)) * h)
                    else:
                        lo, hi = pV, max(pc, pD, pS) + 1e5
                        for _ in range(60):
                            if not (F(hi) < 0):
                                break
                            hi *= 2
                        for _ in range(60):
                            mid = 0.5 * (lo + hi)
                            if F(mid) > 0:
                                hi = mid
                            else:
                                lo = mid
                        pc = 0.5 * (lo + hi)
                qsAcc += orifice(a_s, pS, pc, Cd, rho)
                qdAcc += orifice(a_d, pD, pc, Cd, rho)
                if s == sub - 1 and cycle == 2:
                    P[(j + 1) % M] = pc
                    VF[(j + 1) % M] = void / max(V, 1e-18)
            if cycle == 2:
                QS[j], QD[j] = qsAcc / sub, qdAcc / sub
    return {"P": P, "QS": QS, "QD": QD, "VF": VF, "pS": pS, "pD": pD, "pV": pV}


# ----------------------------------------------------------------- analysis

def analyse_ports(p, res, L) -> dict:
    """Port geometry, opening areas of chamber 0, cross-porting / trapped volume, inlet velocity
    and (rpm > 0) the multi-chamber network simulation with outlet ripple."""
    require_analysis(res, "analyse_ports", ("M", "dt", "cc"))
    checks = []

    def push(level, title, detail=""):
        checks.append({"level": level, "title": title, "detail": detail})

    out = {"checks": checks}
    ang = port_angles(p, L)
    out["angles"] = ang
    s0, s1 = ang["suction"]
    d0, d1 = ang["delivery"]
    if not (s1 > s0) or not (d1 > d0):
        push("err", "Invalid port angles")
        return out
    if s0 < d1 - TAU or d0 < s1:
        push("err", "Ports overlap")
        return out
    minInner = min(ray_to_inner(p, s0), ray_to_inner(p, s1), ray_to_inner(p, d0), ray_to_inner(p, d1))
    if p["portRi"] > 0 and not (p["portRo"] > minInner):
        push("err", "Port has no radial width")
        return out

    out["suction"] = make_port(p, s0, s1)
    out["delivery"] = make_port(p, d0, d1)
    fe = out["suction"].get("filletError") or out["delivery"].get("filletError")
    if fe:
        push("err", "Port fillet", fe)
    w, gd = p.get("grooveW") or 0, p.get("grooveD") or 0
    out["suction"]["grooves"] = [g for g in (make_groove(p, s0, -1, p.get("gSucStart"), w, gd),
                                             make_groove(p, s1, +1, p.get("gSucEnd"), w, gd)) if g]
    out["delivery"]["grooves"] = [g for g in (make_groove(p, d0, -1, p.get("gDelStart"), w, gd),
                                              make_groove(p, d1, +1, p.get("gDelEnd"), w, gd)) if g]
    if p["portRo"] > p["Rv"] + 1e-9:
        push("warn", "Port beyond outer valley")
    if p["portRi"] > 0 and p["portRi"] < p["bore"] / 2:
        push("warn", "Port reaches shaft bore")

    M, dt, polys = res["M"], res["dt"], res["polys"]
    disk = circle_poly((p["e"], 0.0), p["portRi"], 128) if p["portRi"] > 0 else None
    As = np.array([open_area(polys[j], out["suction"], disk) for j in range(M)])
    Ad = np.array([open_area(polys[j], out["delivery"], disk) for j in range(M)])
    out["As"], out["Ad"] = As, Ad

    tol = 1e-4 * res["Amax"]
    cross = 0
    trappedSwing, inTrap, trapStart = 0.0, False, 0.0
    for j in range(M):
        if As[j] > tol and Ad[j] > tol:
            cross += 1
        trapped = As[j] <= tol and Ad[j] <= tol
        if trapped and not inTrap:
            inTrap, trapStart = True, res["A"][j]
        if trapped:
            trappedSwing = max(trappedSwing, abs(res["A"][j] - trapStart))
        if not trapped:
            inTrap = False
    out["crossDeg"] = cross * dt * 180 / math.pi
    push("err" if cross > 0 else "ok", "Cross-porting" if cross > 0 else "No cross-porting")
    if 100 * trappedSwing / (res["Amax"] - res["Amin"]) > 2:
        push("warn", "Trapped volume change")

    fill = p.get("fillS") or (2 if p.get("doubleFill") else 1)
    out["inletVelocity"] = res["flowLpm"] * 1000 / (60 * out["suction"]["area"] * fill)
    push("warn" if out["inletVelocity"] > 2 else "ok",
         "High inlet port velocity" if out["inletVelocity"] > 2 else "Inlet port velocity")

    if p["rpm"] > 0:
        sim = simulate_network(p, res, As, Ad, out)
        out["sim"] = sim
        Qout = sim["Qout"]
        qMean = float(np.sum(Qout)) / M
        qTheo = res["cc"] * 1e-6 * p["rpm"] / 60
        pMax, pMin, vfMax = float(sim["P"].max()), float(sim["P"].min()), max(0.0, float(sim["VF"].max()))
        out.update(Qout=Qout, qMean=qMean, qTheo=qTheo, flowLpm=qMean * 6e4, portEfficiency=qMean / qTheo,
                   ripple=(float(Qout.max()) - float(Qout.min())) / qMean,
                   pMaxBar=pMax / 1e5, pMinBar=pMin / 1e5, voidMax=vfMax, leak=sim["leakMean"],
                   outlet=outlet_ripple(p, res, sim) if p["dp"] > 0 else None)
        if p.get("leakOn"):
            push("warn" if 100 * (1 - qMean / qTheo) > 10 else "ok", "Volumetric efficiency")
        over = (pMax - sim["pD"]) / max(sim["pD"] - sim["pS"], 1e4)
        push("warn" if over > 0.2 else "ok", "Pressure overshoot" if over > 0.2 else "Pressure peaks")
        if vfMax > 0.005:
            push("warn", "Cavitation / incomplete filling")
        elif pMin <= sim["pV"] * 1.0001:
            push("info", "Brief cavitation at port edges")
        else:
            push("ok", "No cavitation")
    return out
