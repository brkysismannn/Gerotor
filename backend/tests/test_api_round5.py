"""Round 5: no silent defaults (audit C01-C03, C07, C08), oil-library source status (C05, R03),
resolved input hash (audit 7.2), numerical settings as named constants (docs/convergence.md)."""
import copy
import json
import pathlib

import pytest
from fastapi.testclient import TestClient

import gerotor_core as G
from api import cache, calc, project, report
from api.app import app
from gerotor_core import InvalidDesignError, contact, fluid, geometry, leakage

BACKEND = pathlib.Path(__file__).resolve().parents[1]
EXAMPLE = json.loads((BACKEND / "schema" / "example.project.json").read_text(encoding="utf-8"))
client = TestClient(app, base_url="http://127.0.0.1:8770")


def small(**design):
    d = copy.deepcopy(EXAMPLE)
    d["settings"]["samples"] = 16
    d["design"].update(design)
    for k, v in list(d["design"].items()):
        if v is None:
            del d["design"][k]
    return d


# ---- C01-C03: no defaults ------------------------------------------------------------------------
def test_core_has_no_default_inputs():
    assert not hasattr(G, "DEFAULTS")
    with pytest.raises(InvalidDesignError, match="OD"):
        G.design(N=7, e=3, R=30, rp=8, b=20, c=0.03, RvAuto=True, RvClear=0.5)  # OD fallback removed
    with pytest.raises(InvalidDesignError, match="RvClear"):
        G.design(N=7, e=3, R=30, rp=8, b=20, c=0.03, OD=80, RvAuto=True)


def test_contact_has_no_material_fallback():
    import examples
    p = examples.design(N=7, e=3, R=30, rp=8, b=20, c=0.03, OD=80, bore=18, rpm=1500, dp=100)
    res = geometry.analyse(p, samples=8, sub_models=False)
    q = {k: v for k, v in p.items() if k not in ("Ein", "Eout", "nuIn", "nuOut")}
    with pytest.raises(InvalidDesignError, match="Ein"):
        contact.compute_contact(q, res)


@pytest.mark.parametrize("key", list(calc.BASE_KEYS))
def test_missing_base_input_is_422(key):
    d = small(**{key: None})
    r = client.post("/api/calc/geometry", json=d)
    assert r.status_code == 422 and key in r.json()["reason"]  # schema-required (N, e, R, rp, b) or calc
    if key not in ("N", "e", "R", "rp", "b"):
        assert "no default" in r.json()["reason"]


def test_missing_material_not_evaluated():
    out = calc.run(small(Ein=None), ["geometry", "contact", "friction", "operating"])
    assert out["geometry"]["cc"] > 0                      # geometry does not need the material
    assert out["contact"] is None and out["friction"] is None and out["operating"] is None
    assert "Ein" in out["notEvaluated"]["contact"]
    miss = [c for c in out["checks"] if c["level"] == "missing"]
    assert {c["module"] for c in miss} == {"contact", "friction", "operating"}
    assert out["certification"]["status"] == "NOT FOR CERTIFICATION"


@pytest.mark.parametrize("key", ["Cd", "pIn", "axialClr"])
def test_missing_fluid_or_clearance_not_evaluated(key):
    d = small(**{key: None})
    out = calc.run(d, ["ports", "contact", "friction"])
    assert out["ports"] is None and key in out["notEvaluated"]["ports"]
    assert out["contact"] is None and out["friction"] is None  # contact needs the simulated pressures


def test_missing_fluid_block_value():
    d = small()
    del d["fluid"]["bulk"]
    out = calc.run(d, ["ports"])
    assert out["ports"] is None and "bulk" in out["notEvaluated"]["ports"]


def test_facemu_only_needed_single_sided():
    bal = calc.run(small(faceMu=None), ["friction"])          # shadow = True: balanced, no floor friction
    assert bal["friction"] is not None and "friction" not in bal["notEvaluated"]
    one = calc.run(small(faceMu=None, shadow=False), ["friction"])  # single-sided
    assert one["friction"] is None and "faceMu" in one["notEvaluated"]["friction"]


def test_structural_switches_are_echoed():
    out = calc.run(small(), ["geometry"])
    assert out["structural"]["sucStart"] == 0 and "portsOn" not in out["structural"]


def test_max_speed_needs_user_limits():
    d = small()
    d["settings"]["maxSpeed"] = {"enabled": True}
    out = calc.run(d, ["cavitation"])
    ms = out["cavitation"]["maxSpeed"]
    assert ms["status"] == "NOT EVALUATED" and "settings.maxSpeed.voidLimit" in ms["missing"]


# ---- oil library source status ---------------------------------------------------------------------
def test_oil_library_rows_are_tagged():
    for k, o in fluid.OILS.items():
        assert set(o["source"]) == {"nu40", "nu100", "rho15"}
        exp_nu40 = "standard" if k.startswith("vg") else "unsourced"
        if not any(s["status"] == "cited" for s in o["source"].values()):
            assert o["source"]["nu40"]["status"] == exp_nu40
            assert o["source"]["nu100"]["status"] == o["source"]["rho15"]["status"] == "unsourced"
    assert any("suspicious" in f for f in fluid.OILS["mil23699"]["flags"])


def test_unsourced_oil_marks_report_not_for_certification():
    d = small()
    out = calc.run(d, ["geometry"])
    rows = [c for c in out["checks"] if c["title"].startswith("Unsourced oil data")]
    assert rows and "rho15" in rows[0]["unsourced"]
    rep = report.build(project.load(d))
    assert rep["certification"]["status"] == "NOT FOR CERTIFICATION"
    d["fluid"]["oil"] = "customer datasheet XY"   # free text: nu/rho are user inputs
    out = calc.run(d, ["geometry"])
    assert not [c for c in out["checks"] if c["title"].startswith("Unsourced oil")]


def test_sources_md_loader(tmp_path):
    md = tmp_path / "sources.md"
    md.write_text("| key | quantity | value | unit | file | page |\n|---|---|---|---|---|---|\n"
                  "| vg46 | nu100 | 6,9 | mm2/s | vg46__Acme_Hydro_46.pdf | 2 |\n"
                  "| vg46 | rho15 | 0.872 | g/cm3 | vg46__Acme_Hydro_46.pdf | 2 |\n"
                  "| mil23699 | rho15 | 990 | kg/m3 | mil23699__X.pdf | 1 |\n"
                  "| nosuch | nu40 | 1 | cSt | x.pdf | 1 |\n| vg46 | nu40 | abc | cSt | x.pdf | 1 |\n",
                  encoding="utf-8")
    rows = fluid.load_sources(md)
    assert len(rows) == 5 and "error" in rows[-1]
    oils = copy.deepcopy(fluid.OILS)
    r = fluid.apply_sources(rows, oils)
    assert len(r["applied"]) == 3 and len(r["ignored"]) == 2
    assert oils["vg46"]["nu100"] == 6.9 and oils["vg46"]["rho15"] == pytest.approx(872)
    assert oils["vg46"]["source"]["nu100"] == {"status": "cited", "ref": "vg46__Acme_Hydro_46.pdf, p. 2",
                                               "file": "vg46__Acme_Hydro_46.pdf", "page": "2", "replacedValue": 6.8}
    assert oils["mil23699"]["flags"] == []          # cited density replaces the suspicious flag
    assert fluid.OILS["vg46"]["source"]["nu100"]["status"] == "unsourced"  # global table untouched
    assert fluid.load_sources(tmp_path / "absent.md") == []


# ---- resolved input hash -----------------------------------------------------------------------------
def _hashes(d):
    return project.input_hash(d), project.resolved_hash(calc.resolved_inputs(d))


def test_same_computation_same_resolved_hash():
    a, b = small(), small(e={"value": 0.003, "unit": "m"})
    assert project.input_hash(a) != project.input_hash(b)       # document differs ...
    assert _hashes(a)[1] == _hashes(b)[1]                         # ... computation does not


def test_different_computation_never_shares_resolved_hash(monkeypatch):
    """Each case keeps the document (and its hash) identical but changes a value the calculation uses."""
    d = small()
    del d["settings"]["samples"]                                   # the settings default is used
    monkeypatch.setitem(calc.SETTINGS_DEFAULTS, "samples", 16)
    doc0, res0 = _hashes(d)
    cache.clear()
    base = calc.run(d, ["operating"])["operating"][1]
    cases = [
        lambda: monkeypatch.setitem(fluid.OILS["vg46"], "nu100", 7.5),          # library row (oilT case)
        lambda: monkeypatch.setitem(calc.SETTINGS_DEFAULTS, "samples", 12),       # settings default
        lambda: monkeypatch.setattr(leakage, "NET_SWEEPS", 4),                     # numerical setting
        lambda: monkeypatch.setitem(calc.STRUCTURAL, "sucStart", 1),               # structural switch
    ]
    seen = {res0}
    for apply in cases:
        apply()
        doc, res = _hashes(d)
        assert doc == doc0 and res not in seen
        seen.add(res)
    cache.clear()
    assert calc.run(d, ["operating"])["operating"][1]["etaT"] != base["etaT"]  # it did compute differently
    monkeypatch.undo()
    cache.clear()


def test_cache_key_covers_fluid():
    a, b = small(), small()
    b["fluid"]["nu"] = 45
    assert cache.key(a, None) != cache.key(b, None)


def test_api_reports_resolved_and_document_hash():
    d = small()
    j = client.post("/api/calc/geometry", json=d).json()
    assert j["inputHash"] == _hashes(project.load(d))[1] and j["documentHash"] == project.input_hash(d)


# ---- numerical settings keep the JS values (parity) --------------------------------------------------
def test_numerical_settings_unchanged():
    n = calc.numerics()
    assert n["geometry"]["CURV_N"] == 4000 and n["geometry"]["CHAMBER_N_IN"] == 48
    assert n["leakage"]["RHO_EQ_CAP_MM"] == 1e4 and n["leakage"]["NET_SWEEPS"] == 3
    assert n["ports"]["CH_SUB_DEFAULT"] == 12 and n["ports"]["OPEN_TOL_REL"] == 0.0  # round 6


def test_hertz_cap_active_design():
    """Constructed design where rho_eq exceeds the 1e4 mm cap (docs/convergence.md, C04): results insensitive."""
    import examples
    import numpy as np
    from gerotor_core import geometry as g
    p = examples.design(N=7, e=20, R=145, rp=20.5, b=20, c=0.03, OD=400, bore=10, rpm=300, dp=100, RvClear=0.0,
                        portsOn=True, leakOn=True, simSub=6, dblIn=False, dblOut=False, shadow=True)
    phis = np.linspace(0, 2 * np.pi / 6, 4001)
    assert max(leakage.contact_rho_eq(p, ph, cap=1e30) for ph in phis) > leakage.RHO_EQ_CAP_MM  # cap is active
    a = g.analyse(p, samples=24)
    leakage.RHO_EQ_CAP_MM = 1e7
    try:
        b = g.analyse(p, samples=24)
    finally:
        leakage.RHO_EQ_CAP_MM = 1e4
    assert a["valid"]
    assert np.max(np.abs(np.asarray(a["contact"]["Pmax"]) - b["contact"]["Pmax"]) / np.maximum(b["contact"]["Pmax"], 1)) < 1e-6
    assert a["ports"]["portEfficiency"] == pytest.approx(b["ports"]["portEfficiency"], rel=1e-5)
