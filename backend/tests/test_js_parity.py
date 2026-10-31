"""JS parity: the Python core must reproduce the browser tool (js/) for representative designs.

Reference JSON files are produced by backend/tools/make_js_reference.py, which runs the unmodified
js/ sources in an embedded V8. Tolerance: relative 1e-9 of the largest magnitude of each quantity
(observed agreement ~1e-13, i.e. floating-point round-off only).
"""
import json
import math
import pathlib

import numpy as np
import pytest

from api.criteria import NEUTRALIZED_CHECKS, neutralize_checks
from examples import EXAMPLE_MATERIAL
from gerotor_core import fluid, geometry, perfmap, ports, reverse, spectrum

REF = pathlib.Path(__file__).parent / "reference"
CASES = sorted(f.stem for f in REF.glob("*.json"))
RTOL = 1e-9
# Absolute floors for quantities that are analytically zero (only round-off is compared):
# pitchDist = 0 (line of action through the pitch point) [mm]; harmonic amplitudes that are
# not multiples of N [% of mean]; tool.phi: arg-min of a flat curvature minimum (the diameter
# itself is checked to 1e-9) [rad].
ATOL = {"pitchDist": 1e-12, "amp": 1e-9, "phi": 1e-7}
SKIP_KEYS = {"issues", "notes", "detail", "label", "group", "points"}  # free text


def _num(x):
    if isinstance(x, str) and x in ("NaN", "Infinity", "-Infinity"):
        return float(x.replace("Infinity", "inf"))
    return x


def _flatten_numbers(x):
    if isinstance(x, dict):
        return [v for k in x for v in _flatten_numbers(x[k])]
    if isinstance(x, (list, tuple, np.ndarray)):
        return [v for y in x for v in _flatten_numbers(y)]
    x = _num(x)
    return [abs(float(x))] if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) else []


def compare(py, ref, path, errors, scale=None, key=None):
    """Recursive comparison; keys absent / null in the JS reference are not checked."""
    if ref is None:
        return
    if isinstance(ref, dict):
        if not isinstance(py, dict):
            errors.append(f"{path}: expected dict, got {type(py).__name__}")
            return
        for k, v in ref.items():
            if k in SKIP_KEYS or v is None:
                continue
            if k not in py:
                errors.append(f"{path}.{k}: missing in Python")
                continue
            compare(py[k], v, f"{path}.{k}", errors, key=k)
        return
    if isinstance(ref, list):
        arr = np.asarray(py, dtype=object) if not isinstance(py, np.ndarray) else py
        if len(arr) != len(ref):
            errors.append(f"{path}: length {len(arr)} != {len(ref)}")
            return
        nested = any(isinstance(v, (list, dict)) for v in ref)
        nums = _flatten_numbers(ref)
        sc = None if nested else (max(nums) if nums else 1.0)
        for i, (a, b) in enumerate(zip(py, ref)):
            compare(a, b, f"{path}[{i}]", errors, sc, key)
        return
    ref = _num(ref)
    if isinstance(ref, bool):
        if bool(py) != ref:
            errors.append(f"{path}: {py} != {ref}")
        return
    if isinstance(ref, str):
        if py != ref:
            errors.append(f"{path}: {py!r} != {ref!r}")
        return
    py = float(py)
    if math.isnan(ref):
        if not math.isnan(py):
            errors.append(f"{path}: {py} != NaN")
        return
    if math.isinf(ref):
        if py != ref:
            errors.append(f"{path}: {py} != {ref}")
        return
    sc = max(abs(ref), scale or 0.0, 1e-300)
    if abs(py - ref) > RTOL * sc + ATOL.get(key, 0.0):
        errors.append(f"{path}: {py!r} vs JS {ref!r} (rel {abs(py - ref) / sc:.2e})")


@pytest.fixture(scope="module", params=CASES)
def case(request):
    ref = json.loads((REF / f"{request.param}.json").read_text(encoding="utf-8"))
    # The JS references were generated with the contact.js material fallback (210 GPa / 0.3); the
    # backend has no fallback, so the same values are supplied here as EXAMPLE inputs.
    p = geometry.derive(dict(EXAMPLE_MATERIAL, **ref["params"]))
    r = geometry.analyse(p, **ref["opts"])
    return request.param, ref, p, r


def check(py, ref, name):
    errors = []
    compare(py, ref, name, errors)
    assert not errors, f"{len(errors)} mismatches, first: " + "; ".join(errors[:5])


def test_derive(case):
    _, ref, p, _ = case
    check(p, ref["params"], "params")


def test_analysis_core(case):
    _, ref, p, r = case
    check({k: r.get(k) for k in ref["res"] if k != "checks"}, {k: v for k, v in ref["res"].items() if k != "checks"}, "res")
    # The JS tool (criteria.js) now emits unsourced verdicts as info rows "<title> - NOT EVALUATED" linked
    # to a criterion id; the core keeps the raw verdicts (JS parity of values). Compare (a) all verdicts
    # that are not neutralised exactly and (b) the criterion ids: every core verdict that the API
    # neutralises must be one of the JS NOT EVALUATED criteria.
    ne = " - NOT EVALUATED"
    py = neutralize_checks(r["checks"])
    js = [tuple(c) for c in ref["res"]["checks"]]
    assert [(c["level"], c["title"]) for c in py if not c["title"].endswith(ne)] == [c for c in js if not c[1].endswith(ne)]
    js_ids = {NEUTRALIZED_CHECKS[t[: -len(ne)]] for _l, t in js if t.endswith(ne)}
    assert {c["criterion"] for c in py if c["title"].endswith(ne)} <= js_ids


def test_lobe_tool_chamber(case):
    _, ref, p, r = case
    L = geometry.lobe_limits(p)
    check(L, ref["lobe"], "lobe")
    check(geometry.inner_tool_diameter(p), ref["tool"], "tool")
    ch = geometry.chamber(p, 0.37, L, 0)
    check({k: ch[k] for k in ("area", "psi0", "psi1", "contacts", "dAdt")}, ref["chamber037"], "chamber")
    check(geometry.chamber_actual_area(p, 0.37, L), ref["actual037"], "actual")


def test_backlash(case):
    _, ref, p, r = case
    if "backlash" not in ref:
        assert "backlash" not in r
        return
    check(r["backlash"], ref["backlash"], "backlash")


def test_contact(case):
    _, ref, p, r = case
    if "contact" in ref:
        check(r["contact"], ref["contact"], "contact")


def test_friction(case):
    _, ref, p, r = case
    if "mech" in ref:
        check(r["mech"], ref["mech"], "mech")


def test_ports_and_network(case):
    _, ref, p, r = case
    if "ports" not in ref:
        return
    P = r["ports"]
    sim = P["sim"]
    py = dict(angles=P["angles"], crossDeg=P["crossDeg"], inletVelocity=P["inletVelocity"],
              suctionArea=P["suction"]["area"], deliveryArea=P["delivery"]["area"], As=P["As"], Ad=P["Ad"],
              qMean=P["qMean"], qTheo=P["qTheo"], portEfficiency=P["portEfficiency"], ripple=P["ripple"],
              pMaxBar=P["pMaxBar"], pMinBar=P["pMinBar"], voidMax=P["voidMax"], leak=P["leak"], outlet=P["outlet"],
              simP=sim["P"], simQout=sim["Qout"], simQS=sim["QS"], simQD=sim["QD"],
              conductances=sim["conductances"], Gtip=sim["Gtip"], Qland=sim["Qland"])
    check(py, ref["ports"], "ports")


def test_single_chamber_gds_operating_point(case):
    _, ref, p, r = case
    if "single" not in ref:
        return
    check(ports.simulate_chamber(p, r, r["ports"]["As"], r["ports"]["Ad"]), ref["single"], "single")
    check(perfmap.gds_cavitation_limits(p, r), ref["gds"], "gds")
    check(perfmap.operating_point(p, r, 0.7 * p["rpm"], 0.5 * p["dp"]), ref["opPoint"], "opPoint")


def test_spectrum_reverse_fluid(case):
    _, ref, p, r = case
    sp, rs = spectrum.ripple_spectrum(p, r, 12), dict(ref["spectrum"])
    # Ranking among round-off-level harmonics is arbitrary: compare only the physical (> 1e-6 %) top entries.
    for k in ("kinTop", "portTop"):
        if rs.get(k):
            rs[k] = [h for h in rs[k] if h["amp"] > 1e-6]
            sp[k] = sp[k][:len(rs[k])]
    check(sp, rs, "spectrum")
    check(reverse.reverse_engineer(reverse.measured_diameters(p)), ref["reverse"], "reverse")
    check(fluid.oil_properties("vg46", 63), ref["oil"], "oil")
    check(fluid.user_oil({"uT1": 40, "uNu1": 46, "uT2": 100, "uNu2": 6.8, "uT3": 0, "uNu3": 400, "uRho15": 875}, 63),
          ref["userOil"], "userOil")
