"""Literature validation vectors (researcher report 2026-10-31-researcher-new-papers-check.md, sec. 3).

1. Colbourne 1975 (Trans. CSME 3(4)) Table 2 p. 220 and Fig. 1 pump p. 221: rho_min, flow, flow variation.
2. Colbourne 1975 Eq. 11 p. 217 closed-form minimum trochoid radius vs the 4000-point undercut scan.
3. Colbourne 1975 Eq. 28 p. 219 closed-form dA/dpsi vs geometry.chamber dAdt.
4. Ivanovic 2012 Figs. 9a/10a (fixed axes, u = z/(z-1) = 1.2): lag angle 0.22-0.29 deg.

Notation map (Colbourne): m = N, b = R, d = rp, e = e; psi = relative rotation, (m-1) psi = t (outer angle).
Table 2 lists lambda = b/(e m) and d/e only to 2-3 digits (researcher derivation from p. 220), so e, d, b are
recovered to that precision; tolerances are set by the last printed digit of the paper (+- 1 to 3 units).
"""
import math

import numpy as np
import pytest

from examples import design
from gerotor_core import geometry as g

# m: (lambda, d/e, rhoE_min/R, Q/(R^2 L omega), flow variation %)  - Colbourne 1975 Table 2, p. 220
TABLE2 = {3: (2.53, 4.59, .363, .205, 31.9), 4: (1.68, 2.74, .271, .205, 27.1), 5: (1.41, 2.07, .209, .194, 9.0),
          6: (1.28, 1.70, .166, .181, 11.3), 7: (1.21, 1.47, .135, .169, 4.1), 8: (1.16, 1.30, .111, .157, 6.3),
          9: (1.13, 1.19, .094, .146, 2.3)}


def colbourne(m, e, d, b, samples=96):
    p = design(N=m, e=e, R=b, rp=d, b=1, OD=10, RvClear=0)   # R = 1 scale, L = 1, c = 0
    return p, g.analyse(p, samples=samples, sub_models=False)


@pytest.mark.parametrize("m", list(TABLE2))
def test_colbourne_table2(m):
    lam, de, rho, q, var = TABLE2[m]
    e = 1 / (lam * m - de + 2)          # from b = lam e m and b = 1 + d - 2e (R = 1)
    d, b = de * e, 1 + de * e - 2 * e
    p, r = colbourne(m, e, d, b)
    assert r["rhoMin"] - d == pytest.approx(rho, abs=3e-3)                 # rho^E_min = rho_Q,min - d
    assert r["dispInner"] / (2 * math.pi) == pytest.approx(q, abs=2e-3)   # per rad of inner gear
    assert 100 * r["ripple"] == pytest.approx(var, abs=0.3)


def test_colbourne_fig1_pump():
    """p. 221: b = 1.179 R, d = 0.423 R, e = 0.122 R (m = 7 inferred by the researcher): rho 0.034 R, Q 0.181."""
    p, r = colbourne(7, .122, .423, 1.179)
    assert r["rhoMin"] - .423 == pytest.approx(.034, abs=1e-3)
    assert r["dispInner"] / (2 * math.pi) == pytest.approx(.181, abs=1e-3)


def rho_closed_form(m, e, b):
    """Colbourne 1975 Eq. 10-11: stationary point valid if |cos((m-1) psi)| <= 1."""
    cs = (e * e * m * m * (2 * m - 1) - b * b * (m - 2)) / (e * b * m * (m + 1))
    assert abs(cs) <= 1
    return 3 ** 1.5 * math.sqrt((b * b - e * e * m * m) * (m - 1)) / (m + 1) ** 1.5


@pytest.mark.parametrize("m,e,b", [(7, .122, 1.179), (5, .1433, 1.01), (9, .0911, .9262), (7, 3, 30), (11, 2.2, 34.4)])
def test_rho_min_scan_vs_closed_form(m, e, b):
    """4000-point scan (CURV_N) vs exact Eq. 11: relative error < 1e-5 (observed <= 7e-7)."""
    p = design(N=m, e=e, R=b, rp=0.01 * b, b=1, OD=10 * b, RvClear=0)
    assert g.min_convex_curvature(p, g.CURV_N) == pytest.approx(rho_closed_form(m, e, b), rel=1e-5)


@pytest.mark.parametrize("m,e,b,d", [(7, .122, 1.179, .423), (5, .1433, 1.01, .2966), (9, .0911, .9262, .1084)])
def test_colbourne_eq28_dA(m, e, b, d):
    """Eq. 28: dA/dpsi = 2ebm sin(pi/m) sin[(m-1)psi - pi/m] + d (W((m-1)psi - 2pi/m) - W((m-1)psi)),
    W(x) = sqrt(b^2 + e^2 m^2 - 2ebm cos x); with (m-1) psi = t: dA/dt = (dA/dpsi)/(m-1). Agreement to
    round-off at every grid point. Conventions: the code trochoid is the mirror image of Colbourne's
(psi -> -psi) and dA < 0 on contraction, hence dA_code(t) = -F(-t)."""
    p, r = colbourne(m, e, d, b, samples=48)
    t = -np.arange(r["M"]) * r["dt"]   # mirror convention
    W = lambda x: np.sqrt(b * b + e * e * m * m - 2 * e * b * m * np.cos(x))  # noqa: E731
    F = (2 * e * b * m * math.sin(math.pi / m) * np.sin(t - math.pi / m) + d * (W(t - 2 * math.pi / m) - W(t))) / (m - 1)
    dA = np.asarray(r["dA"])
    assert np.max(np.abs(dA + F)) < 1e-12 * np.max(np.abs(F))


@pytest.mark.parametrize("lam,cr", [(1.375, 2.75), (1.575, 3.95)])
def test_ivanovic2012_lag_angle(lam, cr):
    """z = 6, e = 3.56 mm, eps = 0.07 mm; R = lam z e, rp = c e. Fixed axes, u = z/(z-1) = 1.2.
    Code delta = OUTER-rotor lag; Ivanovic's lag is the inner-gear angle: delta_inner = delta N/(N-1)
    (from a1 = N t/(N-1), researcher derivation). Figs. 9a/10a: 0.22-0.29 deg (graph reading +-0.01)."""
    N, e = 6, 3.56
    p = design(N=N, e=e, R=lam * N * e, rp=cr * e, c=0.07, b=10, OD=120, RvClear=0.5)
    bl = g.analyse(p, samples=48)["backlash"]
    lo, hi = (math.degrees(bl[k]) * N / (N - 1) for k in ("deltaMin", "deltaMax"))
    assert 0.21 <= lo <= hi <= 0.30
    # speed-ratio deviation about u = 1.2: Fig. 10b range 1.192-1.202, i.e. |u/1.2 - 1| <= 0.7 %
    assert bl["speedPulsation"] < 0.007


# ---- Kim, Nam, Park 2006, JMST 20(10) 1626-1637 (researcher report sec. 6.4) -------------------------
# Table 1 p. 1628: N = 11, e = 2.2, S = 7.5 (lobe radius rp), K = 34.4 (lobe-centre radius R),
# G = 32.0 (valley radius Rv), H = 10 (b) mm. Kim's pressure results are incompressible artefacts: not tested.
def kim():
    p = design(N=11, e=2.2, R=34.4, rp=7.5, b=10, c=0, RvAuto=False, Rv=32.0, OD=90, bore=0, portsOn=True)
    return p, g.analyse(p, samples=96, sub_models=False)


def test_kim2006_sigma1_and_chamber_max():
    p, r = kim()
    L = g.lobe_limits(p)
    # Eq. 5: sigma1 = 12.29 deg = angle where the lobe meets the valley circle G (code: lobe_limits beta)
    assert math.degrees(L["beta"]) == pytest.approx(12.29, abs=0.005)
    # p. 1629: maximum chamber volume at alpha = 343.64 deg = 360 (1 - 1/22). Code: max at outer angle
    # t = 180 - 360/22 deg (chamber centre on the eccentricity axis); Kim's alpha origin is 180 deg away.
    tmax = math.degrees(int(np.argmax(r["A"])) * r["dt"])
    assert (tmax + 180) % 360 == pytest.approx(360 * (1 - 1 / 22), abs=math.degrees(r["dt"]) / 2)
    assert r["Amax"] == pytest.approx(75, rel=0.06)  # Fig. 4 graph reading "about 75 mm^2" (code 78.5)


def test_kim2006_port_edges_fig6():
    """Fig. 6 p. 1630: edges 8.680 and 18.202 deg about X_e. Mapped onto the theoretical chamber-extent
    half-angles of ports.port_angles (min-volume 8.424 deg, max-volume 18.236 deg). The mapping is NOT
    exact (-0.26 deg / +0.03 deg). About the inner centre O1 the values are 9.131 / 16.879 deg; Kim's 8.680
    lies between, and X_e and the edge construction are not defined in the paper: a definition difference,
    not a model deviation (sigma1 and the chamber maximum agree; docs/convergence.md)."""
    p, r = kim()
    th = __import__("gerotor_core.ports", fromlist=["port_angles"]).port_angles(p, g.lobe_limits(p))["theory"]
    assert math.degrees(th["minHi"]) == pytest.approx(8.680, abs=0.3)
    assert math.degrees(th["maxHi"]) - 180 == pytest.approx(18.202, abs=0.05)
