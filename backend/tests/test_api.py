"""API (FastAPI TestClient), project schema / migration and report dataset tests."""
import copy
import datetime as dt
import json
import math
import pathlib

import pytest
from fastapi.testclient import TestClient

from api import calc, project, report
from api.app import app
from gerotor_core import geometry as g, design as core_design, perfmap

BACKEND = pathlib.Path(__file__).resolve().parents[1]
EXAMPLE = json.loads((BACKEND / "schema" / "example.project.json").read_text(encoding="utf-8"))
REF = json.loads((BACKEND / "tests" / "reference" / "n7_ports_leak.json").read_text(encoding="utf-8"))

client = TestClient(app, base_url="http://127.0.0.1:8770")


def small(doc=None):
    d = copy.deepcopy(doc or EXAMPLE)
    d["settings"]["samples"] = 16
    return d


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "ok" and j["version"] and "git" in j and j["projectSchema"] == "gerotor-project/3"


def test_example_project_valid():
    assert project.validate(EXAMPLE) == []


def test_schema_rejects_bad_project():
    d = copy.deepcopy(EXAMPLE)
    del d["design"]["R"]
    d["settings"]["variants"]["cavHead"] = "moon"
    errs = project.validate(d)
    assert any("R" in e for e in errs) and any("cavHead" in e for e in errs)
    r = client.post("/api/calc/geometry", json=d)
    assert r.status_code == 422 and r.json()["error"] == "InvalidProject"


def test_migration_v0_bare_design():
    doc = project.migrate(dict(REF["params"], name="old"))
    assert doc["schema"] == "gerotor-project/3" and doc["metadata"]["projectName"] == "old"
    assert project.validate(doc) == []
    with pytest.raises(project.ProjectError):
        project.migrate({"schema": "gerotor-project/99"})


def test_input_hash_stable_and_sensitive():
    a, b = copy.deepcopy(EXAMPLE), copy.deepcopy(EXAMPLE)
    b["metadata"]["notes"] = "changed"           # metadata is not an input
    assert project.input_hash(a) == project.input_hash(b)
    b["design"]["b"] = 21
    assert project.input_hash(a) != project.input_hash(b)
    assert project.results_stale(a)


def test_calc_geometry_matches_core():
    """API result equals a direct gerotor_core call (bare-design body, JS reference design)."""
    body = dict(REF["params"], settings={"samples": 24})
    r = client.post("/api/calc/geometry", json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    res = g.analyse(core_design(**REF["params"]), samples=24, sub_models=False)
    assert j["geometry"]["cc"] == pytest.approx(res["cc"], rel=1e-14)
    assert j["geometry"]["cc"] == pytest.approx(REF["res"]["cc"], rel=1e-9)
    assert len(j["geometry"]["A"]) == res["M"]
    assert len(j["inputHash"]) == 64


def test_calc_all_project():
    r = client.post("/api/calc/all", json=small(), params={"arrays": "false"})
    assert r.status_code == 200, r.text
    j = r.json()
    for m in ("geometry", "backlash", "ports", "contact", "friction", "spectrum", "cavitation", "operating"):
        assert m in j, m
    assert [o["name"] for o in j["operating"]] == ["rated", "low speed"]
    assert 0 < j["operating"][0]["etaT"] < 1
    assert "A" not in j["geometry"]  # arrays dropped
    assert j["cavitation"]["gds"]["rpm"] > 0


def test_invalid_design_422():
    d = small()
    d["design"]["rp"] = 40  # pin radius larger than R: no profile
    r = client.post("/api/calc/all", json=d)
    assert r.status_code == 422
    j = r.json()
    assert j["error"] == "InvalidDesign" and j["reason"]
    assert isinstance(j["checks"], list)


def test_missing_key_422_and_unknown_module_404():
    assert client.post("/api/calc/geometry", json={"N": 7, "e": 3}).status_code == 422
    assert client.post("/api/calc/nonsense", json={"N": 7}).status_code == 404


def test_reverse_module():
    m = {"N": 7, "rp": 8, "Dt": 2 * 24.97, "Dr": 2 * 18.97, "Dl": 2 * 22 - 0.0}
    r = client.post("/api/calc/reverse", json={"measured": m})
    assert r.status_code == 200, r.text
    assert r.json()["reverse"]["params"]["e"] == pytest.approx(3.0)


def test_variants_change_results():
    base = small()
    a = calc.run(base, ["cavitation", "friction"])
    v = small()
    v["settings"]["variants"].update(cavHead="atm", cavAreaDoubleFill=False,
                                     journal={"l1": 10, "l2": 30, "L1": 10, "L2": 10})
    v["design"]["jbLen"] = 20
    b = calc.run(v, ["cavitation", "friction"])
    # A-D2 atm head (1.013 - 0.2) vs inlet (1 - 0.2): GDS speed changes
    assert a["cavitation"]["gds"]["rpmTip"] != b["cavitation"]["gds"]["rpmTip"]
    # A-D5 radial: odClr doubled before the core call
    r = small()
    r["settings"]["variants"]["clearanceConvention"] = "radial"
    assert calc.run(r, ["geometry"])["design"]["odClr"] == pytest.approx(0.30)
    # A-D3 peak gap input: c halved (peak ~ 2c)
    pg = small()
    pg["settings"]["variants"]["clearanceInput"] = "peakGap"
    assert calc.run(pg, ["geometry"])["design"]["c"] == pytest.approx(g.peak_gap_to_c(0.03))


def test_operating_point_matches_core():
    d = small()
    out = calc.run(d, ["operating"])
    p = calc.build_design(d["design"], calc.VARIANT_DEFAULTS)
    res = g.analyse(p, samples=16)
    ref = perfmap.operating_point(p, res, 1500.0, 100.0)
    assert out["operating"][0]["etaT"] == pytest.approx(ref["etaT"], rel=1e-12)


def test_report_data_deterministic():
    d = small()
    t = dt.datetime(2026, 10, 30, tzinfo=dt.timezone.utc)
    a = report.build(project.load(d), now=t)
    b = report.build(project.load(d), now=t)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    assert a["inputHash"] == project.input_hash(d)
    assert a["software"]["gerotor_core"] and a["metadata"]["partNo"] == "GP-0007"
    ids = [x["id"] for x in a["assumptions"]]
    assert ids[:6] == ["A-D2", "A-D3", "A-D4", "A-D5", "A-D6", "A-D7"]
    refs = [r for m in a["methods"] for r in m["references"]]
    assert any("Totaro" in r for r in refs) and any("Rundo" in r for r in refs)
    # all floats finite or None (strict JSON)
    json.dumps(a, allow_nan=False)


def test_report_endpoint():
    r = client.post("/api/report/data", json=small())
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["format"] == "gerotor-report/1" and j["valid"] is True
    assert "errors" in j["checks"] and j["results"]["operating"]


def test_static_frontend_served():
    if not (BACKEND.parent / "frontend" / "index.html").exists():
        pytest.skip("no frontend")
    assert client.get("/").status_code == 200
