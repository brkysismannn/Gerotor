"""Unit and literature tests of the Python core (mirrors the pass criteria of tests/tests.js)."""
import math

import numpy as np
import pytest

from gerotor_core import backlash, contact, fluid, friction, geometry as g, leakage, reverse, spectrum
from examples import design

TAU = 2 * math.pi


def rel(ref, val):
    return abs(val - ref) / abs(ref) * 100


def from_stryczek(z1, m, lam, v, b, **kw):
    return design(N=z1 + 1, R=m * (z1 + 1) / 2, e=m * lam / 2, rp=v * m / 2, b=b, **kw)


def from_ivanovic(z, lam, c, e, b, **kw):
    return design(N=z, R=lam * z * e, rp=c * e, e=e, b=b, **kw)


N7 = dict(N=7, e=3, R=30, rp=8, b=20)


# ------------------------------------------------------------------ geometry consistency

@pytest.mark.parametrize("p", [design(**N7), design(N=5, e=2, R=15, rp=4, b=10),
                               from_stryczek(10, 1.659, 0.833, 1.11, 7)])
def test_chamber_areas_sum_to_cavity(p):
    L = g.lobe_limits(p)
    cav = abs(g.polygon_area(g.outer_profile(p, 4000, 400, L))) - abs(g.polygon_area(g.inner_profile(p, 40000, p["rp"])))
    s = sum(g.chamber(p, 0.37 + TAU * k / p["N"], L, 0)["area"] for k in range(p["N"]))
    assert rel(cav, s) < 0.05


def test_displacement_area_vs_flow_integral():
    r = g.analyse(design(**N7), sub_models=False)
    assert rel(r["cc"], r["ccCheck"]) < 0.1


def test_vector_ray_matches_numerical_derivative():
    p = design(**N7)
    L, k = g.lobe_limits(p), (p["N"] - 1) / p["N"]
    worst = mx = 0.0
    for deg in (10, 37, 80, 123, 170, 200, 260, 311):
        phi, h = math.radians(deg), 1e-4
        num = (g.chamber(p, (phi + h) * k, L, 0)["area"] - g.chamber(p, (phi - h) * k, L, 0)["area"]) / (2 * h)
        dAdt = g.chamber(p, phi * k, L, -1)["dAdt"] * k        # per rad of inner rotation
        worst, mx = max(worst, abs(num - dAdt)), max(mx, abs(num))
    assert 100 * worst / mx < 0.05


def test_displacement_independent_of_valley_radius():
    ccs = [g.analyse(design(**N7, RvClear=cl), sub_models=False)["cc"] for cl in (0.01, 1.0)]
    assert rel(ccs[0], ccs[1]) < 0.2


# ------------------------------------------------------------------ literature displacement

@pytest.mark.parametrize("m,lam,v,q", [(1.659, 0.833, 1.11, 0.493), (1.658, 0.828, 1.10, 0.490),
                                       (1.656, 0.814, 1.07, 0.482), (1.658, 0.823, 1.09, 0.487),
                                       (1.655, 0.809, 1.06, 0.479)])
def test_antoniak_2026_table1(m, lam, v, q):
    assert rel(q, g.analyse(from_stryczek(10, m, lam, v, 7), samples=48, sub_models=False)["cc"]) < 1.0


@pytest.mark.parametrize("z,lam,c", [(6, 1.575, 3.95), (6, 1.375, 2.75), (5, 1.85, 3.75)])
def test_ivanovic_2020_displacement(z, lam, c):
    assert rel(14, g.analyse(from_ivanovic(z, lam, c, 3.56, 16.46), samples=48, sub_models=False)["cc"]) < 3.0


@pytest.mark.parametrize("z,lam,c,ref", [(6, 1.575, 3.95, 10), (6, 1.375, 2.75, 10), (5, 1.85, 3.75, 9.7)])
def test_ivanovic_2020_ripple(z, lam, c, ref):
    assert rel(ref, 100 * g.analyse(from_ivanovic(z, lam, c, 3.56, 16.46), sub_models=False)["ripple"]) < 10


def test_gds_screenshot():
    p = design(N=9, e=3.861, R=42.861, rp=10, b=10, RvClear=0)
    r = g.analyse(p, sub_models=False)
    assert rel(40.583, p["RvMin"]) < 0.01
    assert rel(2015, r["Amax"] * 10) < 1.0
    pf = design(N=9, e=3.861, R=42.861, rp=10, b=10, RvClear=0, c=0.02, fillet=2)
    rf = g.analyse(pf, sub_models=False)
    assert rel(41.42, rf["AminActual"] * 10) < 5
    assert rel(2015, rf["AmaxActual"] * 10) < 0.5
    assert rel(r["cc"], rf["cc"]) < 1e-6
    assert rf["valid"]


def test_kim_2006_max_area():
    p = design(N=11, e=2.2, R=34.4, rp=7.5, b=10, RvAuto=False, Rv=32)
    assert rel(75, g.analyse(p, sub_models=False)["Amax"]) < 6


def test_fillet_tangency():
    p = design(N=9, e=3.861, R=42.861, rp=10, b=10, RvClear=0, fillet=2)
    F = g.lobe_limits(p)["filletCentre"]
    assert math.hypot(*F) + p["fillet"] == pytest.approx(p["Rv"], rel=1e-11)
    assert math.hypot(F[0] - p["R"], F[1]) == pytest.approx(p["rp"] + p["fillet"], rel=1e-11)
    assert g.analyse(design(N=9, e=3.861, R=42.861, rp=10, b=10, RvClear=0, fillet=30), sub_models=False)["checks"][-1]["title"] == "Invalid fillet"


# ------------------------------------------------------------------ backlash and contact

def test_backlash_scales_with_clearance():
    P = dict(N7, c=0.03, OD=80, bore=18, RvClear=0.5)
    d1 = backlash.solve_delta(design(**P), 0.3)
    d2 = backlash.solve_delta(design(**dict(P, c=0.003)), 0.3)
    assert rel(10, d1 / d2) < 0.5
    gaps = backlash.gaps_at(design(**P), 0.3, d1)
    assert abs(gaps.min()) < 1e-9 and gaps.max() < 2.2 * 0.03


def test_contact_torque_and_kinematics():
    p = design(**dict(N7, c=0.03, OD=80, bore=18, RvClear=0.5, rpm=1500, dp=100))
    r = g.analyse(p)                      # default 96 samples per pitch, as tests/tests.js
    ct = r["contact"]
    assert rel(r["cc"] * 1e-6 * p["dp"] * 1e5 / TAU, ct["torqueMean"]) < 0.01
    assert np.max(np.abs(ct["Tshaft"] - ct["Tenergy"])) < 1e-9
    assert np.max(ct["pitchDist"]) < 1e-9
    assert rel(6 / 7, np.mean(ct["armRatio"])) < 1e-6


def test_hertz_identities():
    F, b, rho, E, nu = 1000.0, 0.02, 0.006, 210e9, 0.3
    Es = contact.e_star(E, nu, E, nu)
    assert contact.hertz_pmax(F, b, rho, Es) == pytest.approx(math.sqrt(F * E / (2 * math.pi * (1 - nu * nu) * b * rho)), rel=1e-12)
    a = contact.hertz_half_width(F, b, rho, Es)
    assert math.pi / 4 * contact.hertz_pmax(F, b, rho, Es) * 2 * a * b == pytest.approx(F, rel=1e-12)


# ------------------------------------------------------------------ leakage and friction formulas

def test_tip_conductance_vs_reynolds_integration():
    mu, h, b, rho, dp = 0.0258, 30e-6, 0.02, 0.006, 1e7
    Lx = 400 * math.sqrt(2 * rho * h)
    x = np.linspace(-Lx, Lx, 400001)
    I = np.trapezoid(1 / (h + x * x / (2 * rho)) ** 3, x)
    assert rel(dp * b / (12 * mu * I), leakage.tip_conductance(b, h, mu, rho) * dp) < 0.1


def test_sector_conductance_vs_integration():
    th, r1, r2, h, mu, dp = 0.9, 0.01, 0.03, 30e-6, 0.0258, 1e7
    r = np.linspace(r1, r2, 200001)
    I = np.trapezoid(1 / r, r)
    assert rel(th * h ** 3 * dp / (12 * mu * I), leakage.sector_conductance(th, h, mu, r1, r2) * dp) < 0.01


def test_friction_formulas():
    mu, w, R, Lb, c = 0.026, 150, 0.04, 0.02, 75e-6
    eps = friction.solve_eccentricity(2000, mu, w, R, Lb, c)
    assert friction.ocvirk_load(mu, w, R, Lb, c, eps) == pytest.approx(2000, rel=1e-8)
    assert friction.journal_torque(mu, w, R, Lb, c, 0) == pytest.approx(TAU * mu * w * R ** 3 * Lb / c, rel=1e-12)
    r1, r2, h = 0.01, 0.04, 25e-6
    rr = np.linspace(r1, r2, 100001)
    I = np.trapezoid(rr ** 3, rr)
    assert friction.ring_torque(mu, w, r1, r2, h) == pytest.approx(2 * mu * w / h * TAU * I, rel=1e-8)


def test_mechanical_balance_without_ports():
    p = design(**dict(N7, c=0.03, OD=80, bore=18, RvClear=0.5, rpm=1500, dp=100))
    m = g.analyse(p, samples=24)["mech"]
    tau = 6 / 7
    assert m["Mshaft"] == pytest.approx(m["Mth"] + tau * (m["MoutRad"] + m["MoutLat"]) + m["MinLat"], rel=1e-11)


# ------------------------------------------------------------------ reverse, fluid, spectrum

def test_reverse_round_trip():
    p = design(N=9, e=3.861, R=42.861, rp=10, b=10, RvClear=0.3, c=0.02)
    out = reverse.reverse_engineer(reverse.measured_diameters(p))
    assert out["ok"]
    for k in ("e", "R", "c"):
        assert out["derived"][k] == pytest.approx(p[k], abs=1e-12)


def test_walther_through_datasheet_points():
    o = fluid.OILS["vg46"]
    assert fluid.viscosity_at(o["nu40"], o["nu100"], 40) == pytest.approx(46, rel=1e-11)
    assert fluid.viscosity_at(o["nu40"], o["nu100"], 100) == pytest.approx(6.8, rel=1e-11)
    temps = [-20, 0, 20, 40, 60, 80, 100, 120]
    nus = [fluid.oil_properties("vg46", t)["nu"] for t in temps]
    assert all(a > b for a, b in zip(nus, nus[1:]))


def test_spectrum_only_multiples_of_N():
    p = design(N=7, e=2, R=1.4 * 7 * 2, rp=5, b=10, rpm=1500)
    s = spectrum.flow_spectrum(g.analyse(p, sub_models=False)["q"], 1500, 7, 28)
    assert max(h["amp"] for h in s["harmonics"] if h["h"] % 7) < 1e-6
    assert max(s["harmonics"], key=lambda h: h["amp"])["h"] == 7
