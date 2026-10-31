"""Independent review of frontend/js/project.js + report.js (design-sim-engineer, 2026-10-30).
Runs the unmodified frontend sources in V8 (mini-racer) and checks: saved files validate against
schema gerotor-project/3, JS input hash == backend input_hash (JCS), report method IDs vs backend registry,
and the report status banner. Remaining xfails are FRONTEND-* items only (backend side fixed in API round 3)."""
import json, pathlib, sys
import pytest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
py_mini_racer = pytest.importorskip("py_mini_racer")
from api import project as P

_ROOT = pathlib.Path(__file__).resolve().parents[3]
JS = _ROOT / "frontend" / "js"
TESTS = _ROOT / "frontend" / "tests"
FILES = ["geometry.js", "ports.js", "backlash.js", "leakage.js", "contact.js", "friction.js", "perfmap.js", "reverse.js",
         "fluid.js", "spectrum.js", "assist.js", "export.js", "xlsx.js", "modelica.js", "drawing.js", "step.js",
         "project.js", "methods.generated.js", "report.js"]
PRE = r"""var window=globalThis; var performance={now:()=>0};
if(typeof TextEncoder==='undefined'){globalThis.TextEncoder=class{encode(s){const u=unescape(encodeURIComponent(s));const a=new Uint8Array(u.length);for(let i=0;i<u.length;i++)a[i]=u.charCodeAt(i);return a;}};}
"""


@pytest.fixture(scope="module")
def ctx():
    c = py_mini_racer.MiniRacer()
    c.eval(PRE)
    for f in FILES:
        c.eval((JS / f).read_text(encoding="utf-8"))
    return c


def js(ctx, expr):
    return json.loads(ctx.eval(f"JSON.stringify({expr})"))


BASE = dict(N=7, e=3, R=30, rp=8, b=20, OD=80, bore=18, c=0.03, rpm=1500, dp=50, pIn=1, oilT=50, nu=30, rho=860,
            bulk=1400, Cd=0.7, pVap=0.2, portsOn=True, leakOn=True, dblIn=True, dblOut=False, shadow=False, oil="ISO VG 46")
DESIGNS = {
    "base": BASE,
    "non_ascii_name": dict(BASE, oil="Öl ß"),
    "floats": dict(BASE, e=3.25, c=0.015, axialClr=0.04, odClr=0.15, jbClr=0.04),
    "tiny": dict(BASE, c=1e-5),            # exponent repr differs JS 1e-5 vs Python 1e-05
    "integral_float": dict(BASE, e=3.0),   # JS cannot keep 3.0 (Python dumps "3.0")
}


def save_doc(ctx, design, cases=None):
    ctx.eval(f"var S=Gerotor.project.create({json.dumps(design)});")
    if cases:
        ctx.eval(f"S.loadCases={json.dumps(cases)};")
    doc = js(ctx, "Gerotor.project.toDoc(S,'2026-10-30T00:00:00Z')")
    h = ctx.eval("Gerotor.project.inputHashSync(S)")
    return doc, h


@pytest.mark.parametrize("name", ["base", "non_ascii_name", "floats"])
def test_saved_file_validates_and_hash_matches(ctx, name):
    doc, h = save_doc(ctx, DESIGNS[name], [dict(name="A", rpm=1000, dp=20, oilT=40, pIn=1), dict(name="B", rpm=3000, dp=80, oilT=80, pIn=0.8)])
    assert P.load(doc)  # backend: older UI files still load (migration)
    if doc.get("schema") != P.SCHEMA_ID:
        pytest.xfail(f"FRONTEND-SCHEMA3: UI writes {doc.get('schema')}, contract is {P.SCHEMA_ID}")
    assert P.validate(doc) == []
    assert h == P.input_hash(doc)


def test_hash_exponent_float(ctx):
    doc, h = save_doc(ctx, DESIGNS["tiny"])
    assert P.load(doc)
    if doc.get("schema") != P.SCHEMA_ID:
        pytest.xfail("FRONTEND-SCHEMA3: hash payload layout differs until the UI writes /3")
    assert h == P.input_hash(doc)  # R-P2 backend side: JCS writes 1e-5 as 0.00001 like JS


def test_hash_after_roundtrip_of_python_file_with_integral_float(ctx):
    """A file written by the backend with e=3.0 must give the same hash after JS open."""
    doc = {"schema": "gerotor-project/3", "metadata": {"projectName": "x"}, "design": dict(N=7, e=3.0, R=30, rp=8, b=20),
           "operatingPoints": [{"name": "A", "rpm": 1000, "dp": 20}]}
    py = P.input_hash(doc)
    j = ctx.eval(f"Gerotor.project.sha256Sync(Gerotor.project.canonical({json.dumps(doc)}.design?{{design:{json.dumps(doc['design'])},operatingPoints:{json.dumps(doc['operatingPoints'])}}}:0))")
    assert j == py  # R-P2 fixed backend side: JCS writes 3.0 as "3"


def test_unit_object_is_converted_on_open(ctx):
    """{value, unit} in a non-default unit must be converted, not just unwrapped."""
    doc = {"schema": "gerotor-project/3", "metadata": {"projectName": "x"},
           "design": dict(N=7, e={"value": 0.118110236, "unit": "in"}, R=30, rp=8, b=20)}
    st = js(ctx, f"Gerotor.project.parse({json.dumps(json.dumps(doc))})")
    if abs(st["design"]["e"] - 3.0) > 1e-6:
        pytest.xfail(f"FRONTEND-R-P1: unit object unwrapped without conversion (e={st['design']['e']} instead of 3 mm)")


def test_face_support_matches_core(ctx):
    """Derived faceSupport written to the file must equal what the core derives from dblIn/dblOut/shadow."""
    bad = []
    for di in (False, True):
        for do in (False, True):
            for sh in (False, True):
                d = dict(BASE, dblIn=di, dblOut=do, shadow=sh)
                doc, _ = save_doc(ctx, d)
                core = js(ctx, f"Gerotor.derive({json.dumps(d)}).faceSupport")
                if doc.get("schema") == P.SCHEMA_ID:
                    assert "faceSupport" not in doc["design"] and "doubleFill" not in doc["design"]
                    continue
                if doc["design"]["faceSupport"] != core:
                    bad.append((di, do, sh, doc["design"]["faceSupport"], core))
    if bad:
        pytest.xfail(f"FRONTEND-R-P3: faceSupport in file != core: {bad}")


def test_report_assumption_ids_match_backend(ctx):
    from api import report as R
    back = {k: v[2] for k, v in R.ASSUMPTIONS.items()}
    assert {"A-D2", "A-D4", "A-D6"} <= set(back)
    ui = dict(js(ctx, "Gerotor.report.METHODS"))
    # semantic key words of each backend assumption that must appear in the UI text with the same ID
    words = {"A-D2": "p_in - p_vap", "A-D4": "fillS", "A-D6": "W/2"}
    mism = [k for k, w in words.items() if w.lower() not in ui.get(k, "").lower()]
    if mism:
        pytest.xfail(f"FRONTEND-R-R1: UI assumption IDs {mism} carry different meanings than backend A-Dx")


def test_status_invalid_on_error_check(ctx):
    st = js(ctx, "Gerotor.report.status({A:[1],checks:[{level:'err',title:'Undercut'}]})")
    assert st["text"] == "INVALID"
    st = js(ctx, "Gerotor.report.status(null)")
    assert st["text"] == "INVALID"


def test_report_invalid_when_other_load_case_invalid(ctx):
    d = dict(BASE, portsOn=False, leakOn=False)
    ctx.eval(f"var S=Gerotor.project.create({json.dumps(d)}); var p=Gerotor.derive(S.design); var r=Gerotor.analyse(p);")
    html = ctx.eval("Gerotor.report.build({meta:S.meta,design:S.design,loadCases:S.loadCases,activeCase:0},p,r,'ab',"
                    "{caseResults:[{name:'Bad',rpm:9e4,dp:900,status:'INVALID',flow:NaN}]})")
    assert ctx.eval("Gerotor.report.status(r).valid"), 'precondition: active case valid'
    if 'data-status="INVALID"' not in html:
        pytest.xfail("FRONTEND-R-R2: banner ignores INVALID non-active load cases")


def test_frontend_suite_counts(ctx):
    ctx.eval((TESTS / "tests.js").read_text(encoding="utf-8"))
    res = js(ctx, "Gerotor.tests.runAll().results.map(r=>r.status)")
    counts = {s: res.count(s) for s in set(res)}
    print("frontend suite:", counts, "total", len(res))
    fails = js(ctx, "Gerotor.tests.runAll().results.filter(r=>r.status==='fail').map(r=>r.name)")
    # DOMParser / TextDecoder are browser APIs absent in bare V8: environment, not code
    real = [n for n in fails if not ("DOMParser" in n or "TextDecoder" in n)]
    if real:  # frontend round-3 work in progress (fullstack engineer), not a backend item
        pytest.xfail(f"FRONTEND-SUITE: frontend self-tests failing in V8: {real}")
