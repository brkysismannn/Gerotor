"""Tests for the researcher formula review fixes (2026-10-30, D1-D8) and InvalidDesignError."""
import math

import pytest

from gerotor_core import (InvalidDesignError, c_to_peak_gap, design, diametral_to_radial, friction,
                          geometry as g, lambda_from_gamez, lambda_gamez, peak_gap_to_c, perfmap,
                          radial_to_diametral, spectrum)
from gerotor_core import backlash


def ivanovic(z, lam, c_eq, e, eps):
    """Ivanovic 2012 nomenclature: lambda = d/(e z) -> R = lambda z e; equidistant coeff c = rc/e -> rp = c e."""
    return design(N=z, e=e, R=lam * z * e, rp=c_eq * e, c=eps, b=10)


# Ivanovic et al. 2012, values read from Fig. 6 (p.6) and Fig. 7-9 (pp.7-8) (graph reading, +-0.02 mm).
# Fig. 6: z=11, e=2.2, c=3.341, eps=0.15, lambda=1.43 -> peak minimum clearance ~0.30 mm
# Fig. 8 (fixed axes): z=6, e=3.56, eps=0.07, (a) lambda=1.375 c=2.75, (b) lambda=1.575 c=3.95 -> peak 0.14-0.16 mm
# Fig. 9: lag angle 0.22-0.29 deg (drive = inner shaft angle).
CASES = [("fig6", (11, 1.43, 3.341, 2.2, 0.15), 0.30),
         ("fig8a", (6, 1.375, 2.75, 3.56, 0.07), 0.15),
         ("fig8b", (6, 1.575, 3.95, 3.56, 0.07), 0.15)]


@pytest.mark.parametrize("name,args,peak", CASES)
def test_ivanovic_peak_gap(name, args, peak):
    p = ivanovic(*args)
    r = g.analyse(p, samples=24)
    assert r["valid"]
    bl = r["backlash"]
    assert abs(float(bl["gap0"].max()) - peak) < 0.02, (name, float(bl["gap0"].max()))
    # D3: peak tip-to-tip gap ~ 2 eps
    assert abs(float(bl["gap0"].max()) / p["c"] - 2) < 0.15


@pytest.mark.parametrize("name,args,peak", CASES[1:])
def test_ivanovic_lag_angle(name, args, peak):
    p = ivanovic(*args)
    r = g.analyse(p, samples=24)
    N = p["N"]
    # code delta is the outer-rotor lag; referred to the drive (inner) shaft: x N/(N-1)
    lo, hi = (math.degrees(r["backlash"][k]) * N / (N - 1) for k in ("deltaMin", "deltaMax"))
    assert 0.20 <= lo <= hi <= 0.30, (lo, hi)


def test_converters():
    assert peak_gap_to_c(0.2) == pytest.approx(0.1)
    assert c_to_peak_gap(peak_gap_to_c(0.17)) == pytest.approx(0.17)
    assert radial_to_diametral(0.05) == pytest.approx(0.1)
    assert diametral_to_radial(radial_to_diametral(0.07)) == pytest.approx(0.07)
    p = design(N=7, e=2, R=20, rp=5, b=10)
    assert lambda_gamez(p["R"], p["N"], p["e"]) == pytest.approx(1 / p["lambda"])
    assert lambda_from_gamez(lambda_gamez(20, 7, 2)) == pytest.approx(p["lambda"])


def test_odd_n_dominant_harmonic_is_tooth_pass():
    """D1: for odd N the dominant kinematic harmonic is N (tooth pass), not 2N."""
    p = design(N=7, e=2, R=20, rp=5, b=10, rpm=1500)
    r = g.analyse(p, samples=48, sub_models=False)
    sp = spectrum.ripple_spectrum(p, r)
    assert sp["kinTop"][0]["h"] == 7


def _invalid():
    p = design(N=7, e=4, R=20, rp=5, b=10)  # R <= N e: trochoid loops
    r = g.analyse(p)
    assert not r["valid"]
    return p, r


def test_invalid_design_spectrum_raises_clean():
    p, r = _invalid()
    with pytest.raises(InvalidDesignError) as ex:
        spectrum.ripple_spectrum(p, r)
    assert "q" in str(ex.value) and "Trochoid forms loops" in str(ex.value)
    assert isinstance(ex.value, ValueError)


@pytest.mark.parametrize("fn", [lambda p, r: backlash.compute_backlash(p, r),
                                lambda p, r: friction.compute_mechanical(p, r),
                                lambda p, r: perfmap.gds_cavitation_limits(p, r),
                                lambda p, r: perfmap.operating_point(p, r, 1000, 10)])
def test_invalid_design_downstream_raise(fn):
    p, r = _invalid()
    with pytest.raises(InvalidDesignError):
        fn(p, r)


def test_missing_keys_raise():
    with pytest.raises(InvalidDesignError):
        g.derive({"N": 7, "e": 2})
    with pytest.raises(InvalidDesignError):
        g.analyse({"N": 7, "e": 2, "R": 20, "rp": 5, "c": 0})


def test_literature_variants_and_defaults():
    p = design(N=7, e=2, R=20, rp=5, b=10, c=0.02, rpm=1500, dp=50, portsOn=True, doubleFill=True,
               jbLen=20, bore=12, pIn=1.0)
    r = g.analyse(p, samples=24)
    base = perfmap.gds_cavitation_limits(p, r)
    # D2: head='atm' equals inlet head when pIn = p_atm; differs otherwise
    assert perfmap.gds_cavitation_limits(dict(p, pIn=perfmap.P_ATM_BAR), r, head="atm")["rpmTip"] == \
        pytest.approx(perfmap.gds_cavitation_limits(dict(p, pIn=perfmap.P_ATM_BAR), r)["rpmTip"])
    assert perfmap.gds_cavitation_limits(p, r, head="atm")["rpmTip"] > base["rpmTip"]
    # D4: single-port area -> lower gallery limit with double fill
    assert perfmap.gds_cavitation_limits(p, r, double_fill_area=False)["rpmGallery"] < base["rpmGallery"]
    # D6: symmetric lever-arm variant reproduces the default
    m0 = friction.compute_mechanical(p, r)
    m1 = friction.compute_mechanical(p, r, journal=dict(l1=1, l2=1, L1=10, L2=10))
    assert m1["Mjb"] == pytest.approx(m0["Mjb"], rel=1e-9)
    m2 = friction.compute_mechanical(p, r, journal=dict(l1=1, l2=3, L1=10, L2=10))
    assert m2["Mjb"] > 0 and m2["Mjb"] != pytest.approx(m0["Mjb"], rel=1e-6)
