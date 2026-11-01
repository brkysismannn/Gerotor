"""Clearance tolerance intervals and the registry fixes of 2026-10-31 (design-sim-engineer).

* Monotonicity: each clearance swept alone (others nominal), eta_v and eta_hm must move one way only on the
  axes that gerotor_core.tolerance samples at their band ends ("corners"); the tip clearance c is swept with
  the backlash tip-gap model. The c sweep must show the non-monotone eta_hm that makes c a grid axis.
  The sweeps run the JS mirror in V8 (fast); the Python core is checked on a shorter sweep and by parity.
* Interval method: parabola refinement, band validation, Python == JS interval, API 422 / rows.
* Registry fixes: shaftVent no default, rhoExp no default (density check row), A-D9, leakage assumption ids.
"""
import copy
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import examples  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import gerotor_core as G  # noqa: E402
from api import calc, methods  # noqa: E402
from api.app import app  # noqa: E402
from gerotor_core import InvalidDesignError, fluid, geometry, leakage, perfmap, tolerance  # noqa: E402

py_mini_racer = pytest.importorskip("py_mini_racer")
ROOT = pathlib.Path(__file__).resolve().parents[2]
JS = ROOT / "frontend" / "js"
FILES = ["geometry.js", "backlash.js", "leakage.js", "contact.js", "friction.js", "fluid.js", "ports.js",
         "spectrum.js", "reverse.js", "perfmap.js", "tolerance.js"]
BACKEND = pathlib.Path(__file__).resolve().parents[1]
EXAMPLE = json.loads((BACKEND / "schema" / "example.project.json").read_text(encoding="utf-8"))
client = TestClient(app, base_url="http://127.0.0.1:8770")

# test designs (example inputs, tests/examples.py; not software defaults)
MAT = dict(examples.EXAMPLE_INPUTS, **examples.EXAMPLE_MATERIAL)
DES = {
    "n7": dict(MAT, N=7, e=3, R=30, rp=8, c=0.03, b=20, OD=80, bore=18, RvClear=0.5, portsOn=True, leakOn=True,
               tipGapModel="backlash"),
    "n9": dict(MAT, N=9, e=3.861, R=42.861, rp=10, b=10, OD=95, bore=22, RvClear=0, c=0.02, fillet=2, portsOn=True,
               leakOn=True, dblIn=True, dblOut=False, shadow=True, jbLen=20, tipGapModel="backlash"),
    "n5s": dict(MAT, N=5, e=2, R=15, rp=4, b=10, OD=48, bore=8, RvClear=0.2, c=0.02, portsOn=True, leakOn=True,
                faceSupport="single", jbLen=10, tipGapModel="backlash"),
}
OPS = [(500, 5), (3000, 150)]
SAMPLES = 24
NPTS = 9  # sweep points over 0.25 ... 1.75 x nominal


@pytest.fixture(scope="module")
def ctx():
    c = py_mini_racer.MiniRacer()
    c.eval("var window=globalThis; var performance={now:()=>0}; window.Gerotor={};")
    for f in FILES:
        c.eval((JS / f).read_text(encoding="utf-8"))
    c.eval("""function evalPt(raw, ov, rpm, dp, samples) {
      const p = Gerotor.derive(Object.assign({}, raw, ov, {rpm, dp}));
      const r = Gerotor.operatingPoint(p, Gerotor.analyse(p, {samples}), rpm, dp);
      return [r.etaV, r.etaM]; }""")
    return c


def jsj(ctx, expr):
    return json.loads(ctx.eval(f"JSON.stringify({expr})"))


def trend(v):
    d = [b - a for a, b in zip(v, v[1:])]
    if all(x == 0 for x in d):
        return "const"
    if all(x >= 0 for x in d):
        return "inc"
    if all(x <= 0 for x in d):
        return "dec"
    return "NON"


def sweep(ctx, d, key, rpm, dp):
    nom = d[key]
    xs = [nom * (0.25 + 1.5 * i / (NPTS - 1)) for i in range(NPTS)]
    rows = [jsj(ctx, f"evalPt({json.dumps(d)}, {{{json.dumps(key)}: {x}}}, {rpm}, {dp}, {SAMPLES})") for x in xs]
    return trend([r[0] for r in rows]), trend([r[1] for r in rows])


# expected trends on the corner axes: (eta_v, eta_hm); "const" is also monotone
EXPECT = {"axialClr": ({"dec"}, {"inc"}), "odClr": ({"const"}, {"inc", "const"}), "jbClr": ({"const"}, {"inc", "const"})}


@pytest.mark.parametrize("name", list(DES))
@pytest.mark.parametrize("key", list(EXPECT))
def test_corner_axes_are_monotone(ctx, name, key):
    assert tolerance.AXIS_METHOD[key] == "corners"
    for rpm, dp in OPS:
        tv, tm = sweep(ctx, DES[name], key, rpm, dp)
        assert tv in EXPECT[key][0] and tm in EXPECT[key][1], (name, key, rpm, dp, tv, tm)


@pytest.mark.parametrize("name", list(DES))
def test_tip_clearance_backlash_eta_v_monotone(ctx, name):
    for rpm, dp in OPS:
        tv, _ = sweep(ctx, DES[name], "c", rpm, dp)
        assert tv == "dec", (name, rpm, dp, tv)


def test_tip_clearance_eta_hm_not_monotone_so_c_is_grid(ctx):
    """Monotonicity FAILS for eta_hm in c (n7, shallow minimum): corners are not used there."""
    _, tm = sweep(ctx, DES["n7"], "c", 3000, 150)
    assert tm == "NON"
    assert tolerance.AXIS_METHOD["c"] == "grid"


def test_python_core_sweep_matches_trends():
    """Python core, short sweep (5 points): eta_v falls with c and axialClr, eta_hm rises with axialClr."""
    out = {}
    for key in ("c", "axialClr"):
        ev, em = [], []
        for f in (0.5, 0.75, 1.0, 1.25, 1.5):
            d = dict(DES["n7"], **{key: DES["n7"][key] * f})
            p = G.design(**d)
            r = perfmap.operating_point(p, geometry.analyse(p, samples=16), 1500, 50)
            ev.append(r["etaV"])
            em.append(r["etaM"])
        out[key] = (trend(ev), trend(em))
    assert out["c"][0] == "dec" and out["axialClr"] == ("dec", "inc")


# ---- interval method -------------------------------------------------------------------------------
def test_parabola_refinement_exact_for_quadratic():
    xs = [i / 4 for i in range(5)]
    lo, hi, ref = tolerance.series_extrema([(x - 0.3) ** 2 for x in xs])
    assert lo == pytest.approx(0.0, abs=1e-15) and hi == pytest.approx(0.49) and ref > 0


def test_corners_exact_for_monotone_function():
    def make(ov):
        return dict(ov)

    def op(p, res, mds):
        return {"etaV": 1 - p["axialClr"], "etaM": 0.5 + 0.0, "mechEtaM": [0.5 + q["odClr"] for q in mds]}
    r = tolerance.interval(make, lambda p: None, op, {"axialClr": (0.1, 0.2), "odClr": (0.1, 0.3)})
    assert r["etaV"] == pytest.approx([0.8, 0.9]) and r["etaM"] == pytest.approx([0.6, 0.8])
    assert r["etaT"] == pytest.approx([0.8 * 0.6, 0.9 * 0.8])


@pytest.mark.parametrize("tol,match", [({"zz": {"min": 0, "max": 1}}, "unknown"), ({"c": {"min": 0.04, "max": 0.05}}, "outside"),
                                       ({"c": {"min": 0.05, "max": 0.01}}, "min <= max"), ({"c": {"min": 0.01}}, "min and max")])
def test_band_validation(tol, match):
    with pytest.raises(ValueError, match=match):
        tolerance.check_bands(tol, {"c": 0.03})


def test_python_interval_equals_js(ctx):
    d = dict(DES["n7"], rpm=1500, dp=50, simSub=4)
    bands = {"c": (0.025, 0.035), "axialClr": (0.04, 0.06), "odClr": (0.12, 0.18)}
    py = tolerance.interval(lambda ov: G.design(**dict(d, **ov)), lambda p: geometry.analyse(p, samples=16),
                            lambda p, res, mds: perfmap.operating_point(p, res, 1500, 50, mds), bands)
    jb = json.dumps({k: list(v) for k, v in bands.items()})
    js = jsj(ctx, f"Gerotor.tolerance.interval(ov => Gerotor.derive(Object.assign({{}}, {json.dumps(d)}, ov)), "
                  f"p => Gerotor.analyse(p, {{samples: 16}}), (p, res, mds) => Gerotor.operatingPoint(p, res, 1500, 50, mds), {jb})")
    for k in ("etaV", "etaM", "etaT", "etaTEvaluated"):
        assert py[k] == pytest.approx(js[k], rel=1e-9), k
    assert py["networkRuns"] == js["networkRuns"] == 10 and py["analyses"] == js["analyses"] == 5


def _body(**tol):
    b = copy.deepcopy(EXAMPLE)
    b["settings"]["samples"] = 16
    b["operatingPoints"] = b["operatingPoints"][:1]
    if tol:
        b["settings"]["clearanceTolerance"] = tol
    return b


def test_api_tolerance_rows_contain_nominal():
    d = EXAMPLE["design"]
    b = _body(axialClr={"min": d["axialClr"] * 0.8, "max": d["axialClr"] * 1.2},
              odClr={"min": d["odClr"] * 0.8, "max": d["odClr"] * 1.2})
    r = client.post("/api/calc/operating", json=b)
    assert r.status_code == 200, r.text
    row = r.json()["operating"][0]
    t = row["tolerance"]
    assert t["etaV"][0] <= row["etaV"] <= t["etaV"][1]
    assert t["etaM"][0] <= row["etaM"] <= t["etaM"][1]
    assert t["etaT"][0] <= row["etaT"] <= t["etaT"][1]
    assert "compressibility" in row["etaVBasis"]


def test_api_bad_tolerance_is_422():
    r = client.post("/api/calc/operating", json=_body(c={"min": 1.0, "max": 2.0}))
    assert r.status_code == 422


# ---- registry fixes ----------------------------------------------------------------------------------
def test_shaft_vent_has_no_default():
    p = G.design(**dict(DES["n7"], shaftVent=None))
    res = geometry.analyse(p, samples=8, skip=("ports", "contact", "mech"))
    with pytest.raises(InvalidDesignError, match="shaftVent"):
        leakage.simulate_network(p, res, [0.0] * res["M"], [0.0] * res["M"])
    assert "shaftVent" in calc.missing_inputs(dict(p, shaftVent=None)).get("ports", [])


def test_density_needs_rho_exp():
    assert fluid.density_at(870, 80) is None and fluid.oil_properties("vg46", 80)["rho"] is None
    assert fluid.density_at(870, 80, 7e-4) == pytest.approx(870 * (1 - 7e-4 * 65))
    u = fluid.user_oil({"uT1": 40, "uNu1": 46, "uT2": 100, "uNu2": 6.8, "uRho15": 875}, 60)
    assert u["rho"] is None and any("rhoExp" in n for n in u["notes"])
    b = copy.deepcopy(EXAMPLE)
    b["settings"]["samples"] = 16
    rows = [c for c in calc.run(b, ["geometry"])["checks"] if c.get("module") == "fluid"]
    assert any(op.get("oilT") is not None for op in b["operatingPoints"]) and rows and rows[0]["level"] == "missing"
    b["fluid"]["rhoExp"] = 7e-4
    assert not [c for c in calc.run(b, ["geometry"])["checks"] if c.get("module") == "fluid"]


def test_registry_ids():
    assert "A-D9" in methods.ASSUMPTION_REGISTRY
    assert {"A-D3", "A-D8b", "A-D9"} <= set(methods.METHODS["leakage"]["assumptions"])
    assert "tolerance" in methods.METHODS and calc.numerics()["tolerance"]["GRID_LEVELS"] == tolerance.GRID_LEVELS
