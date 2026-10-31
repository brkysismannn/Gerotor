"""Round 2: cache, origin guard, save/modelica, units, methods registry, schema v2."""
import base64
import copy
import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from api import cache, calc, exports, project, report, units
from api.app import app
from api.methods import METHODS

BACKEND = pathlib.Path(__file__).resolve().parents[1]
EXAMPLE = json.loads((BACKEND / "schema" / "example.project.json").read_text(encoding="utf-8"))
BASE = "http://127.0.0.1:8770"
client = TestClient(app, base_url=BASE)
H = {"X-Gerotor-Request": "1"}


def small():
    d = copy.deepcopy(EXAMPLE)
    d["settings"]["samples"] = 16
    d["design"]["portsOn"] = False
    d["design"]["leakOn"] = False
    return d


# ---- 1 cache -------------------------------------------------------------
def test_cache_hit_and_key():
    cache.clear()
    d = small()
    a = client.post("/api/calc/geometry", json=d).json()
    b = client.post("/api/calc/geometry", json=d).json()
    assert a == b and cache.info()["hits"] == 1 and cache.info()["misses"] == 1
    d2 = copy.deepcopy(d)
    d2["metadata"]["notes"] = "metadata is not part of the key"
    client.post("/api/calc/geometry", json=d2)
    assert cache.info()["hits"] == 2
    d2["design"]["e"] = 3.1
    assert cache.key(d2, ["geometry"]) != cache.key(d, ["geometry"])
    assert cache.key(d, ["geometry"]) != cache.key(d, ["contact"])


def test_cache_code_version_and_bound(monkeypatch):
    d = small()
    k1 = cache.key(d, None)
    monkeypatch.setattr(report, "API_VERSION", "9.9.9")
    assert cache.key(d, None) != k1
    monkeypatch.setattr(cache, "MAXSIZE", 2)
    cache.clear()
    for e in (2.9, 3.0, 3.1):
        x = copy.deepcopy(d)
        x["design"]["e"] = e
        cache.cached_run(x, ["geometry"])
    assert cache.info()["size"] == 2


# ---- 2 origin guard ------------------------------------------------------
def test_origin_guard():
    d = small()
    assert client.post("/api/calc/geometry", json=d, headers={"Origin": BASE}).status_code == 200
    r = client.post("/api/calc/geometry", json=d, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403 and r.json() == {"ok": False, "error": "forbidden"}
    assert client.post("/api/calc/geometry", json=d, headers={"Origin": "http://localhost:9999"}).status_code == 403
    evil = TestClient(app, base_url="http://evil.example")
    assert evil.post("/api/calc/geometry", json=d).status_code == 403  # DNS rebinding
    assert evil.get("/api/health").status_code == 200  # GET is not guarded
    assert TestClient(app, base_url="http://localhost:8770").post("/api/project/validate", json=d).status_code == 200


# ---- 3 save / modelica ---------------------------------------------------
@pytest.fixture
def tmpdirs(tmp_path, monkeypatch):
    monkeypatch.setattr(exports, "EXPORTS_DIR", tmp_path / "exports")
    monkeypatch.setattr(exports, "MODELICA_DIR", tmp_path / "modelica")
    monkeypatch.setattr(exports, "find_openmodelica", lambda: None)
    return tmp_path


def test_save_contract_and_traversal(tmpdirs):
    body = {"files": {"a.csv": "x,y\n1,2", "../../evil.txt": "no", "b.exe": "skip", "..\\c.txt": "z"},
            "base64": {"p.pdf": base64.b64encode(b"%PDF-1").decode()}}
    assert client.post("/api/save", json=body).status_code == 403  # header missing
    r = client.post("/api/save", json=body, headers=H)
    j = r.json()
    assert r.status_code == 200 and j["ok"] is True and pathlib.Path(j["dir"]) == tmpdirs / "exports"
    names = sorted(pathlib.Path(f).name for f in j["files"])
    assert names == ["_.._evil.txt", "_c.txt", "a.csv", "p.pdf"]
    for f in j["files"]:
        assert pathlib.Path(f).resolve().parent == (tmpdirs / "exports").resolve()
    assert (tmpdirs / "exports" / "p.pdf").read_bytes() == b"%PDF-1"
    assert not (tmpdirs / "evil.txt").exists()
    assert client.post("/api/save", json={"base64": {"x.pdf": "@@@"}}, headers=H).status_code == 400


def test_modelica_contract(tmpdirs):
    r = client.post("/api/modelica", headers=H,
                    json={"name": "../My Pump", "files": {"x.mo": "model x end x;", "y.exe": "no"}, "open": True})
    j = r.json()
    assert r.status_code == 200 and j["ok"] and j["openModelica"] is None
    assert pathlib.Path(j["dir"]) == tmpdirs / "modelica" / "___My_Pump"
    assert [pathlib.Path(f).name for f in j["files"]] == ["x.mo"]
    assert j["opened"] is False and "not found" in j["error"]


# ---- 4 units -------------------------------------------------------------
def test_unit_conversion():
    assert units.convert(3, "mm", "mm") == 3
    assert units.convert(0.003, "m", "mm") == pytest.approx(3)
    assert units.convert(30, "um", "mm") == pytest.approx(0.03)
    assert units.convert(1e7, "Pa", "bar") == pytest.approx(100)
    assert units.convert(1.4e3, "MPa", "MPa") == 1400
    assert units.convert(30, "mm2/s", "cSt") == pytest.approx(30)
    assert units.convert(40, "degC", "K") == pytest.approx(313.15)
    with pytest.raises(units.UnitError):
        units.convert(1, "inch", "mm")
    with pytest.raises(units.UnitError):
        units.convert(1, "bar", "mm")


def test_units_in_calc_same_result():
    d = small()
    a = client.post("/api/calc/geometry", json=d).json()["geometry"]["cc"]
    d["design"].update(e={"value": 0.003, "unit": "m"}, b={"value": 20000, "unit": "um"},
                       dp={"value": 10, "unit": "MPa"},
                       rpm={"value": 1500, "unit": "rpm"})
    d["fluid"]["nu"] = {"value": 30, "unit": "mm2/s"}
    j = client.post("/api/calc/geometry", json=d).json()
    assert j["geometry"]["cc"] == pytest.approx(a, rel=1e-12)
    assert j["design"]["dp"] == pytest.approx(100) and j["design"]["e"] == pytest.approx(3)


@pytest.mark.parametrize("bad", [{"value": 3, "unit": "inch"}, {"value": 3, "unit": "bar"}])
def test_bad_unit_422(bad):
    d = small()
    d["design"]["e"] = bad
    r = client.post("/api/calc/geometry", json=d)
    assert r.status_code == 422 and r.json()["error"] == "InvalidUnit"
    d = small()
    d["design"]["foo"] = {"value": 1, "unit": "mm"}
    assert client.post("/api/calc/geometry", json=d).status_code == 422


# ---- 5 methods registry --------------------------------------------------
def test_methods_registry_complete():
    known = set(report.ASSUMPTIONS)
    for key, m in METHODS.items():
        assert m["method"] and m["equations"], key
        assert m["sources"] and all(s["ref"] and s["kind"] in ("literature", "standard", "derivation")
                                    for s in m["sources"]), key
        assert set(m["assumptions"]) <= known, key
        for f in m["functions"]:
            assert callable(getattr(m["module"], f)), (key, f)
    assert set(calc.MODULES) <= set(METHODS)
    covered = {a for m in METHODS.values() for a in m["assumptions"]}
    assert covered == known  # every named assumption belongs to a method


def test_report_methods_and_acceptance():
    j = client.post("/api/report/data", json=small()).json()
    assert all(m["references"] for m in j["methods"])
    by = {m["id"]: m for m in j["methods"]}
    assert "ASTM D341 (Ubbelohde-Walther)" in by["fluid"]["references"]
    assert by["contact"]["assumptions"] == ["A-D8a", "A-D8b"]
    ac = j["acceptanceCriteria"]
    assert ac["status"] == "pending" and ac["evaluated"] is False and ac["criteria"] == []
    assert j["metadata"]["signOff"]["author"]["name"] and j["metadata"]["scope"]


# ---- 6 schema v2 ---------------------------------------------------------
def test_example_v2_valid_and_v1_migrates():
    assert project.validate(EXAMPLE) == []
    v1 = copy.deepcopy(EXAMPLE)
    v1["schema"] = "gerotor-project/1"
    for k in ("scope", "revisions", "signOff"):
        v1["metadata"].pop(k)
    v1["settings"].pop("acceptanceCriteria")
    v1["metadata"]["checker"] = "QA"
    doc = project.load(v1)
    md = doc["metadata"]
    assert doc["schema"] == "gerotor-project/3" and md["scope"] == ""
    assert md["revisions"] == [{"rev": "A", "date": "2026-10-30", "author": "Design and Simulation Engineer",
                                "description": "migrated from gerotor-project/1"}]
    assert md["signOff"]["checker"] == {"name": "QA", "date": ""}
    assert md["signOff"]["approver"] == {"name": "", "date": ""}
    r = client.post("/api/project/validate", json=v1).json()
    assert r["valid"] and r["migratedFrom"] == 1
    # input hash unaffected by metadata-only migration
    assert project.input_hash(doc) == project.input_hash(v1)


def test_schema_v2_rejects_bad_signoff_and_criteria_status():
    d = copy.deepcopy(EXAMPLE)
    d["metadata"]["signOff"]["approver"] = {"name": "X", "date": "30.10.2026"}
    assert project.validate(d)
    d = copy.deepcopy(EXAMPLE)
    d["settings"]["acceptanceCriteria"]["status"] = "passed"
    assert project.validate(d)
