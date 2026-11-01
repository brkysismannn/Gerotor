"""API round 4: acceptance criteria (api/criteria.py), schema gerotor-project/4, check neutralisation."""
import copy
import json
import pathlib

from fastapi.testclient import TestClient

from api import calc, criteria as C, project
from api.app import app

BACKEND = pathlib.Path(__file__).resolve().parents[1]
EXAMPLE = json.loads((BACKEND / "schema" / "example.project.json").read_text(encoding="utf-8"))
client = TestClient(app, base_url="http://127.0.0.1:8770")

# synthetic results (no calculation needed for the status logic)
RES = {"valid": True, "checks": [], "design": {"rpm": 1000, "rp": 8.0, "c": 0.05, "OD": 90, "Rv": 40, "R": 30,
                                               "innerRoot": 20, "bore": 20, "fillS": 1, "fillD": 1},
       "geometry": {"rhoMin": 12.0, "tipSpeed": 4.0, "ripple": 0.05, "cc": 16.0},
       "contact": {"pmaxMax": 600e6, "Es": 115e9},
       "operating": [{"name": "A", "rpm": 1000, "hertz": 500e6, "etaV": 0.9, "etaM": 0.95},
                     {"name": "B", "rpm": 2000, "hertz": 700e6, "etaV": 0.8, "etaM": 0.97}]}


def ov(cid, field, value, unit=None, target="criterion"):
    return {"target": target, "id": cid, "field": field, "value": value, "unit": unit, "reason": "test spec",
            "user": "tester", "timestamp": "2026-10-31T10:00:00Z"}


def only(*ids, overrides=()):
    """generic profile, all criteria disabled except ids."""
    off = [ov(c["id"], "enabled", False) for c in C.profiles()["generic"]["criteria"] if c["id"] not in ids]
    return dict(C.DEFAULT, overrides=off + list(overrides))


def row(ev, cid):
    return next(r for r in ev["criteria"] if r["id"] == cid)


def test_all_profiles_ship_without_numbers():
    cat = C.catalogue()
    assert {p["id"] for p in cat["profiles"]} == {"generic", "iso-based", "class-society", "customer-defined"}
    for p in cat["profiles"]:
        for c in p["criteria"]:
            assert c["safetyFactor"] is None and c["source"]["label"]
            assert c["limit"] is None or c["limit"] == {"fromMaterial": "sigmaHlim"}
    for m in cat["materials"]:
        assert m["sigmaHlim"] is None and m["yield"] is None and m["source"]["label"]


def test_default_is_incomplete_never_pass():
    ev = C.evaluate(None, RES)
    assert ev["overall"] == "INCOMPLETE" and ev["counts"]["FAIL"] == 0
    assert row(ev, "C-GEOM-VALID")["status"] == "PASS"
    assert row(ev, "C-PORT-V-IN")["status"] == "NOT EVALUATED" and row(ev, "C-PORT-V-IN")["reason"] == "no limit entered"
    assert "certifying authority" in ev["statement"]


def test_pass_fail_governing_case_and_margin():
    ev = C.evaluate(only("C-ETA-V", overrides=[ov("C-ETA-V", "limit", 0.75, "-")]), RES)
    r = row(ev, "C-ETA-V")
    assert ev["overall"] == "PASS" and r["status"] == "PASS" and r["governingCase"] == "B"
    assert abs(r["margin"] - (0.8 - 0.75) / 0.75) < 1e-12 and r["overridden"]
    ev = C.evaluate(only("C-ETA-V", overrides=[ov("C-ETA-V", "limit", 0.85, "-")]), RES)
    assert ev["overall"] == "FAIL" and row(ev, "C-ETA-V")["governingCase"] == "B"
    assert [c["status"] for c in row(ev, "C-ETA-V")["cases"]] == ["PASS", "FAIL"]


def test_safety_factor_and_material_hertz_with_gate():
    base = [ov("C-HERTZ-VALID", "limit", 0.1, "-"), ov("steel-case-hardened", "sigmaHlim", 1400, "MPa", "material"),
            ov("C-HERTZ", "safetyFactor", 2.0)]
    ac = only("C-HERTZ-VALID", "C-HERTZ", overrides=base)
    ev = C.evaluate(ac, RES)
    assert row(ev, "C-HERTZ")["reason"].startswith("no material selected")
    ac["materials"] = {"inner": "steel-case-hardened", "outer": None}
    ev = C.evaluate(ac, RES)
    r = row(ev, "C-HERTZ")
    assert r["status"] == "PASS" and r["allowable"] == 700 and r["value"] == 700 and r["governingCase"] == "B"
    assert abs(row(ev, "C-HERTZ-VALID")["value"] - 2 * 700e6 / 115e9) < 1e-15
    ac["overrides"].append(ov("C-HERTZ-VALID", "limit", 0.001, "-"))  # gate fails -> Hertz not evaluated
    ev = C.evaluate(ac, RES)
    assert row(ev, "C-HERTZ-VALID")["status"] == "FAIL" and row(ev, "C-HERTZ")["status"] == "NOT EVALUATED"
    assert ev["overall"] == "FAIL"


def test_overrides_recorded_hash_and_unit_mismatch():
    a = C.evaluate(only("C-ETA-M", overrides=[ov("C-ETA-M", "limit", 0.9, "-")]), RES)
    b = C.evaluate(only("C-ETA-M", overrides=[ov("C-ETA-M", "limit", 0.91, "-")]), RES)
    assert a["criteriaHash"] != b["criteriaHash"] and len(a["criteriaHash"]) == 64
    rec = [o for o in a["overrides"] if o["field"] == "limit"][0]
    assert rec == {"field": "limit", "oldValue": None, "newValue": 0.9, "unit": "-", "reason": "test spec",
                   "user": "tester", "timestamp": "2026-10-31T10:00:00Z", "target": "criterion", "id": "C-ETA-M"}
    ev = C.evaluate(only("C-PORT-V-IN", overrides=[ov("C-PORT-V-IN", "limit", 2, "ft/s")]), RES)
    assert "unit" in row(ev, "C-PORT-V-IN")["reason"] and ev["overall"] == "INCOMPLETE"


def test_customer_profile_empty_is_incomplete_and_custom_criteria():
    ac = dict(C.DEFAULT, activeProfileId="customer-defined")
    assert C.evaluate(ac, RES)["overall"] == "INCOMPLETE"
    ac["customCriteria"] = [{"id": "X1", "quantity": "ripple.kinematic", "comparison": "<=", "limit": 0.1}]
    ev = C.evaluate(ac, RES)
    assert ev["overall"] == "PASS" and row(ev, "X1")["custom"]
    ac["customCriteria"].append({"id": "BAD", "quantity": "nope", "limit": 1})
    assert C.evaluate(ac, RES)["overall"] == "INCOMPLETE"


def test_migration_v3_to_v4():
    v3 = copy.deepcopy(EXAMPLE)
    v3["schema"] = "gerotor-project/3"
    v3["settings"]["acceptanceCriteria"] = {"authority": "ACME spec 12", "status": "pending",
                                           "criteria": [{"id": "K1", "quantity": "ripple.kinematic",
                                                         "comparison": "<=", "limit": 0.2, "source": "ACME 4.1"}]}
    doc = project.load(v3)
    ac = doc["settings"]["acceptanceCriteria"]
    assert doc["schema"] == "gerotor-project/4" and ac["activeProfileId"] == "customer-defined"
    assert ac["authority"]["name"] == "ACME spec 12" and ac["customCriteria"][0]["source"]["label"] == "ACME 4.1"
    empty = copy.deepcopy(v3)
    empty["settings"]["acceptanceCriteria"] = {"authority": None, "status": "pending", "criteria": []}
    assert project.load(empty)["settings"]["acceptanceCriteria"]["activeProfileId"] == "generic"
    assert project.validate(EXAMPLE) == []


def test_schema_requires_override_reason():
    d = copy.deepcopy(EXAMPLE)
    o = ov("C-ETA-V", "limit", 0.8, "-")
    o.pop("reason")
    d["settings"]["acceptanceCriteria"]["overrides"] = [o]
    assert project.validate(d)


def test_unsourced_core_checks_neutralised():
    chk = [{"level": "ok", "title": "Tip speed", "detail": ""}, {"level": "warn", "title": "Sharp inner rotor tips"},
           {"level": "ok", "title": "No cross-porting", "detail": ""}]
    out = C.neutralize_checks(chk)
    titles = [c["title"] for c in out]
    assert titles == ["Tip speed - NOT EVALUATED", "No undercut", "Sharp inner rotor tips - NOT EVALUATED",
                      "No cross-porting"]
    assert out[0]["criterion"] == "C-TIP-SPEED" and out[0]["level"] == "info"


def test_endpoints_profiles_methods_report():
    cat = client.get("/api/criteria/profiles").json()
    assert len(cat["profiles"]) == 4 and cat["quantities"]
    m = client.get("/api/methods").json()
    assert "A-AC1" in {a["id"] for a in m["assumptions"]} and "acceptance" in {x["id"] for x in m["methods"]}
    d = copy.deepcopy(EXAMPLE)
    d["settings"]["samples"] = 16
    d["settings"]["acceptanceCriteria"]["overrides"] = [ov("C-ETA-M", "limit", 0.5, "-")]
    j = client.post("/api/report/data", json=d).json()
    ac = j["acceptanceCriteria"]
    assert ac["evaluated"] and ac["overall"] == "INCOMPLETE" and row(ac, "C-ETA-M")["status"] == "PASS"
    assert row(ac, "C-ETA-M")["governingCase"] in ("rated", "low speed")
    assert not any(c["title"] in C.NEUTRALIZED_CHECKS for lvl in j["checks"].values() for c in lvl)
    assert row(ac, "C-GEOM-UNDERCUT")["status"] == "PASS"


def test_audit_r01_r02_r04_r06():
    import numpy as np
    from api import methods, report
    from api.serialize import to_json
    assert callable(C.neutralize_checks) and report.methods()  # R04: registry functions resolve
    out = to_json({"a": list(range(65)), "b": np.zeros(3), "c": 1}, arrays=False)  # R06
    assert out["c"] == 1 and {o["key"]: o["length"] for o in out["_omitted"]} == {"a": 65, "b": 3}
    # R02 resolved 2026-10-31: the unsourced 6.5e-4 1/K is removed; rhoExp is a user input (no default)
    src = [x for x in methods.METHODS["fluid"]["sources"] if "rhoExp" in x["use"]]
    assert src and src[0]["kind"] == "user input"
    assert not [x for x in methods.METHODS["fluid"]["sources"] if x["kind"] == "unsourced" and "6.5e-4" in x["ref"]]
    p, res = {"fillS": 2}, {"cc": 16.0, "ports": {"suction": {"area": 500.0}}}
    ms = calc.inlet_rpm_from_criteria({"rpmInlet": 1.0}, p, res, None)  # R01
    assert ms["rpmInlet"] is None and "NOT EVALUATED" in ms["rpmInletBasis"]
    ms = calc.inlet_rpm_from_criteria({}, p, res, dict(C.DEFAULT, overrides=[ov("C-PORT-V-IN", "limit", 1.5, "m/s")]))
    assert abs(ms["rpmInlet"] - 1.5 * 500e-6 * 2 / (16e-6 / 60)) < 1e-9
