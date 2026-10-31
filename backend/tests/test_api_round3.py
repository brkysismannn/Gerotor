"""API round 3: RFC 8785 (JCS) input hash, schema gerotor-project/3 (fluid, per-case oilT/pIn/nu,
derived faceSupport/doubleFill) and GET /api/methods (assumption registry)."""
import copy
import hashlib
import json
import pathlib

import pytest
from fastapi.testclient import TestClient

import gerotor_core as G
from api import calc, project
from api.app import app
from api.methods import ASSUMPTION_REGISTRY, METHODS
from api.serialize import _jcs_number, jcs

BACKEND = pathlib.Path(__file__).resolve().parents[1]
EXAMPLE = json.loads((BACKEND / "schema" / "example.project.json").read_text(encoding="utf-8"))
client = TestClient(app, base_url="http://127.0.0.1:8770")

# RFC 8785 Appendix B / ECMAScript Number.prototype.toString vectors
NUMS = {0.0: "0", -0.0: "0", 3.0: "3", 1e-5: "0.00001", 1e-6: "0.000001", 1e-7: "1e-7", 1e21: "1e+21",
        1e20: "100000000000000000000", 5e-324: "5e-324", 1.7976931348623157e308: "1.7976931348623157e+308",
        333333333.3333333: "333333333.3333333", 4.5e-7: "4.5e-7", 0.1: "0.1", -1.5: "-1.5",
        9007199254740992: "9007199254740992", 1.5e22: "1.5e+22", 295147905179352830000: "295147905179352830000",
        123.456: "123.456"}


@pytest.mark.parametrize("x,s", list(NUMS.items()))
def test_jcs_numbers(x, s):
    assert _jcs_number(x) == s


def test_jcs_structure_and_strings():
    nl, bs, q = chr(10), chr(92), chr(34)
    got = jcs({"b": [1, "Öl" + nl, None, True], "a": {"€": 1, chr(0x1F600): 2, "z": 0.5}})
    assert got.startswith("{" + q + "a" + q + ":{" + q + "z" + q + ":0.5," + q + "€" + q + ":1," + q + chr(0x1F600) + q + ":2},")
    assert got.endswith("[1," + q + "Öl" + bs + "n" + q + ",null,true]}")
    assert jcs(chr(1) + q + bs) == q + bs + "u0001" + bs + q + bs + bs + q


def test_hash_is_sha256_of_jcs_utf8():
    doc = {"design": {"N": 7, "e": 3.0, "c": 1e-5}, "fluid": {"oil": "Öl"}}
    exp = hashlib.sha256('{"design":{"N":7,"c":0.00001,"e":3},"fluid":{"oil":"Öl"}}'.encode()).hexdigest()
    assert project.input_hash(doc) == exp
    assert project.input_hash({"design": {"N": 7, "e": 3, "c": 0.00001}, "fluid": {"oil": "Öl"}}) == exp


def test_example_is_v3_and_valid():
    assert EXAMPLE["schema"] == project.SCHEMA_ID == "gerotor-project/3"
    assert project.validate(EXAMPLE) == []


def test_v2_migration_moves_fluid_and_derives_porting():
    v2 = {"schema": "gerotor-project/2", "metadata": {"projectName": "x"},
          "design": dict(N=7, e=3, R=30, rp=8, b=20, nu=30, rho=860, bulk=1400, pVap=0.2, faceSupport="balanced",
                         doubleFill=False), "results": {"inputHash": "0" * 64, "software": {}}}
    d = project.load(v2)
    assert d["fluid"] == dict(nu=30, rho=860, bulk=1400, pVap=0.2)
    assert "faceSupport" not in d["design"] and d["design"]["shadow"] is True
    assert project.results_stale(d)  # hash recomputed: old stored results are stale (documented)


@pytest.mark.parametrize("fs,df", [("single", False), ("balanced", False), ("balanced", True)])
def test_migration_preserves_core_porting(fs, df):
    base = dict(N=7, e=3, R=30, rp=8, b=20, c=0.03)
    old = G.design(**base, faceSupport=fs, doubleFill=df)
    d = project.migrate({"schema": "gerotor-project/2", "metadata": {"projectName": "x"},
                         "design": dict(base, faceSupport=fs, doubleFill=df)})["design"]
    new = G.design(**d)
    assert [old[k] for k in ("faceSupport", "fillS", "fillD")] == [new[k] for k in ("faceSupport", "fillS", "fillD")]


def test_derived_porting_equals_core_rule():
    for di in (False, True):
        for do in (False, True):
            for sh in (False, True):
                q = G.design(N=7, e=3, R=30, rp=8, b=20, c=0.03, dblIn=di, dblOut=do, shadow=sh)
                r = project.derived_porting({"dblIn": di, "dblOut": do, "shadow": sh})
                assert all(r[k] == q[k] for k in r)


def test_v3_rejects_stored_derived_and_design_fluid_keys():
    d = copy.deepcopy(EXAMPLE)
    d["design"]["faceSupport"] = "single"
    assert project.validate(d)
    d = copy.deepcopy(EXAMPLE)
    d["design"]["nu"] = 30
    assert project.validate(d)


def test_case_fluid_overrides():
    p = dict(nu=30, rho=860, pIn=1, oil="vg46")
    assert calc.case_design(p, {"rpm": 1, "dp": 1}) == p
    q = calc.case_design(p, {"oilT": 40, "pIn": 0.8})
    assert abs(q["nu"] - 46) < 1e-6 and q["pIn"] == 0.8 and q["rho"] < 875
    assert calc.case_design(p, {"oilT": 40, "nu": 12})["nu"] == 12


def test_operating_points_use_case_fluid():
    d = copy.deepcopy(EXAMPLE)
    d["settings"]["samples"] = 16
    d["operatingPoints"] = [{"name": "cold", "rpm": 1500, "dp": 100, "oilT": 20},
                            {"name": "hot", "rpm": 1500, "dp": 100, "oilT": 90}]
    r = client.post("/api/calc/operating?arrays=false", json=d)
    assert r.status_code == 200, r.text
    cold, hot = r.json()["operating"]
    assert cold["oilT"] == 20 and hot["etaV"] < cold["etaV"]  # thinner oil leaks more


def test_methods_endpoint():
    j = client.get("/api/methods").json()
    ids = [a["id"] for a in j["assumptions"]]
    assert set(ids) == set(ASSUMPTION_REGISTRY) >= {"A-D2", "A-D3", "A-D4", "A-D5", "A-D6", "A-D7", "A-D8a", "A-D8b"}
    for a in j["assumptions"]:
        assert a["statement"] and a["sources"] and a["active"]
        assert all(m in METHODS for m in a["usedBy"])
    a2 = next(a for a in j["assumptions"] if a["id"] == "A-D2")
    assert a2["value"] == "inlet" and not a2["literatureVariant"]
    assert {m["id"] for m in j["methods"]} == set(METHODS)
    j = client.post("/api/methods", json={"settings": {"variants": {"cavHead": "atm"}}}).json()
    a2 = next(a for a in j["assumptions"] if a["id"] == "A-D2")
    assert a2["value"] == "atm" and a2["literatureVariant"] and "GDS" in a2["active"]
    # every assumption referenced by a method is defined
    assert {x for m in METHODS.values() for x in m["assumptions"]} <= set(ASSUMPTION_REGISTRY)
