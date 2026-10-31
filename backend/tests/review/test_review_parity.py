"""Independent reviewer cross-check: runs unmodified js/ in V8 (mini-racer) for NEW designs and compares the
FULL analyse() result tree (every key JS returns, except polygon-like geometry dumps) with gerotor_core."""
import json, math, pathlib, sys
import pytest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
py_mini_racer = pytest.importorskip("py_mini_racer")
from gerotor_core import geometry, ports, perfmap, spectrum

_ROOT = pathlib.Path(__file__).resolve().parents[3]
JS = next((d for d in (_ROOT / "frontend" / "js", _ROOT / "js") if d.is_dir()), _ROOT / "frontend" / "js")
FILES = ["geometry.js", "backlash.js", "leakage.js", "contact.js", "friction.js", "fluid.js",
         "ports.js", "spectrum.js", "reverse.js", "perfmap.js",
         "criteria.generated.js", "criteria.js"]  # criteria: JS check rows are neutralised (NOT EVALUATED)
BASE = dict(c=0, RvAuto=True, RvClear=0.1, bore=0, rpm=1000, dp=10, portsOn=False, portRoAuto=True, portRiAuto=True,
            sucStart=0, sucEnd=0, delStart=0, delEnd=0, gSucStart=0, gSucEnd=0, gDelStart=0, gDelEnd=0, grooveW=1,
            doubleFill=False, pIn=1, pVap=0.2, rho=860, bulk=1400, Cd=0.7, nu=30, leakOn=False, axialClr=0.05,
            shaftVent=True, odClr=0.15, jbLen=0, jbClr=0.04, faceSupport="balanced", faceMu=0.08,
            Ein=210, nuIn=0.3, Eout=210, nuOut=0.3)  # EXAMPLE inputs (= JS contact.js fallback); backend has no default
D = {
 "minN3": (dict(N=3, e=2, R=9, rp=3, b=10, OD=40, rpm=1000, dp=10), 24),
 "N4_ports": (dict(N=4, e=2, R=12, rp=3.5, b=12, OD=45, bore=8, c=0.02, portsOn=True, leakOn=True, simSub=3), 24),
 "maxN21": (dict(N=21, e=0.8, R=21*0.8*1.4, rp=0.8, b=8, OD=2*(21*0.8*1.4+1.6)+10, rpm=800, dp=10), 24),
 "N15_ports_leak": (dict(N=15, e=1.2, R=21, rp=1.4, b=10, OD=60, bore=10, c=0.01, portsOn=True, leakOn=True, simSub=3, rpm=900, dp=30), 16),
 "bigE": (dict(N=6, e=6, R=26, rp=9, b=15, OD=80, bore=12, c=0.03, portsOn=True, leakOn=True, simSub=3), 24),
 "bigE_valid": (dict(N=6, e=4.5, R=36, rp=6, b=15, OD=90, bore=12, c=0.03, portsOn=True, leakOn=True, simSub=3), 24),
 "zeroClr_ports": (dict(N=8, e=2.5, R=24, rp=6, b=14, OD=70, bore=14, c=0, RvClear=0, portsOn=True, leakOn=True, axialClr=0, odClr=0, jbClr=0, simSub=3), 24),
 "extreme_speed": (dict(N=7, e=3, R=30, rp=8, b=20, OD=80, bore=18, c=0.03, rpm=12000, dp=5, portsOn=True, leakOn=True, simSub=3), 24),
 "extreme_pressure": (dict(N=7, e=3, R=30, rp=8, b=20, OD=80, bore=18, c=0.03, rpm=500, dp=400, pIn=0.5, portsOn=True, leakOn=True, simSub=3, faceSupport="single"), 24),
 "low_vis_hot": (dict(N=9, e=3, R=36, rp=8, b=16, OD=90, bore=20, c=0.05, nu=2, rho=700, bulk=900, rpm=3000, dp=150, portsOn=True, leakOn=True, simSub=3, pVap=0.9), 24),
 "high_vis_cold": (dict(N=9, e=3, R=36, rp=8, b=16, OD=90, bore=20, c=0.05, nu=1500, rpm=300, dp=20, portsOn=True, leakOn=True, simSub=3), 24),
 "single_sided_ports": (dict(N=7, e=3, R=30, rp=8, b=20, OD=80, bore=18, c=0.03, portsOn=True, leakOn=True, simSub=3,
                             sucStart=-8, sucEnd=-15, delStart=0, delEnd=0, doubleFill=False, shaftVent=False), 24),
 "ports_shifted_double": (dict(N=10, e=3.5, R=40, rp=9, b=18, OD=95, bore=22, c=0.04, portsOn=True, leakOn=True, simSub=3,
                               sucEnd=5, delStart=-4, gSucEnd=3, gDelStart=2, grooveD=0.7, dblIn=True, dblOut=True, doubleFill=True, fillet=1.5, portFillet=0.8, outletVol=30), 16),
 "tip_models": (dict(N=7, e=3, R=30, rp=8, b=20, OD=80, bore=18, c=0.03, portsOn=True, leakOn=True, simSub=3, tipGapModel="uniform", jbLen=15), 24),
 "fast_samples8": (dict(N=7, e=3, R=30, rp=8, b=20, OD=80, bore=18, c=0.03, RvClear=1.0, portsOn=True, leakOn=True, simSub=2), 8),
}

FREE_TEXT = {'detail', 'notes', 'issues', 'label', 'group', 'points'}  # same free-text keys the author skips

HARN = r"""
var DROP={polys:1,outline:1,pieces:1,waste:1,polygon:1};
function ser(x){ if(x===null||x===undefined) return null; if(ArrayBuffer.isView(x)) return Array.from(x);
 if(typeof x==='number') return Number.isFinite(x)?x:String(x); if(Array.isArray(x)) return x.map(ser);
 if(typeof x==='function') return null;
 if(typeof x==='object'){const o={};for(const k in x){if(DROP[k])continue;o[k]=ser(x[k]);}return o;} return x;}
function run(d,opts){const G=globalThis.Gerotor;const p=G.derive(d);const r=G.analyse(p,opts);const L=G.lobeLimits(p);
 const out={params:ser(p),res:ser(r),lobe:ser(L),tool:ser(G.innerToolDiameter(p))};
 out.cham=[0.05,0.37,0.81].map(t=>{const ch=G.chamber(p,t,L,0);return ser({area:ch.area,psi0:ch.psi0,psi1:ch.psi1,contacts:ch.contacts,dAdt:ch.dAdt,act:G.chamberActualArea(p,t,L)});});
 if(r.ports&&r.ports.As){out.single=ser(G.simulateChamber(p,r,r.ports.As,r.ports.Ad));out.gds=ser(G.gdsCavitationLimits(p,r));
  const op=G.operatingPoint(p,r,0.4*p.rpm,0.9*p.dp);delete op.stressCurve;out.op=ser(op);}
 try{out.spectrum=ser(G.rippleSpectrum(p,r,12));}catch(e){out.spectrumErr=String(e);}
 return JSON.stringify(out);}
"""


@pytest.fixture(scope="module")
def ctx():
    c = py_mini_racer.MiniRacer()
    c.eval("var window=globalThis;var performance={now:()=>0};")
    for f in FILES:
        c.eval((JS / f).read_text(encoding="utf-8"))
    c.eval(HARN)
    return c


def num(x):
    if isinstance(x, str) and x in ("NaN", "Infinity", "-Infinity"):
        return float(x.replace("Infinity", "inf"))
    return x


def cmp(py, ref, path, errs, scale, cnt):
    if ref is None:
        return
    if isinstance(ref, dict):
        if not isinstance(py, dict):
            errs.append(f"{path}: not dict")
            return
        for k, v in ref.items():
            if v is None or k in FREE_TEXT:
                continue
            if k not in py:
                errs.append(f"{path}.{k}: MISSING in py")
                continue
            cmp(py[k], v, f"{path}.{k}", errs, None, cnt)
        return
    if isinstance(ref, list):
        if len(py) != len(ref):
            errs.append(f"{path}: len {len(py)} vs {len(ref)}")
            return
        nums = [abs(num(v)) for v in ref if isinstance(num(v), (int, float)) and not isinstance(v, bool) and math.isfinite(num(v))]
        sc = max(nums) if nums else 1.0
        for i, (a, b) in enumerate(zip(py, ref)):
            cmp(a, b, f"{path}[{i}]", errs, sc, cnt)
        return
    ref = num(ref)
    cnt[0] += 1
    if isinstance(ref, bool):
        if bool(py) != ref:
            errs.append(f"{path}: {py!r} != {ref!r}")
        return
    if isinstance(ref, str):
        if py != ref:
            errs.append(f"{path}: {py!r} != {ref!r}")
        return
    py = float(py)
    if math.isnan(ref) or math.isinf(ref):
        if not (py == ref or (math.isnan(py) and math.isnan(ref))):
            errs.append(f"{path}: {py} != {ref}")
        return
    sc = max(abs(ref), scale or 0.0)
    atol = 1e-7 if path.endswith("tool.phi") else (1e-9 if path.endswith(".amp") else 1e-12)  # arg-min of flat minimum (diameter itself is checked)
    if abs(py - ref) > 1e-8 * sc + atol:
        errs.append(f"{path}: py {py!r} JS {ref!r} (rel-to-scale {abs(py - ref) / max(sc, 1e-300):.2e})")


NE = " - NOT EVALUATED"


def _pop_checks(x, out, path="res"):
    """Remove every 'checks' list from the JS tree (compared separately by check_rows)."""
    if isinstance(x, dict):
        if isinstance(x.get("checks"), list):
            out[path] = x.pop("checks")
        for k, v in x.items():
            _pop_checks(v, out, f"{path}.{k}")


def check_rows(py_checks, js_checks, path, errs):
    """JS criteria.js emits unsourced verdicts as '<title> - NOT EVALUATED' info rows: compare the
    remaining verdicts exactly and require every core verdict neutralised by the API to be among the
    JS NOT EVALUATED criterion ids (api.criteria.NEUTRALIZED_CHECKS)."""
    from api.criteria import NEUTRALIZED_CHECKS, neutralize_checks
    py = neutralize_checks(py_checks)
    a = [(c["level"], c["title"]) for c in py if not c["title"].endswith(NE)]
    b = [(c["level"], c["title"]) for c in js_checks if not c["title"].endswith(NE)]
    if a != b:
        errs.append(f"{path}: verdicts py {a} JS {b}")
    js_ids = {NEUTRALIZED_CHECKS.get(c["title"][: -len(NE)]) for c in js_checks if c["title"].endswith(NE)}
    if not {c["criterion"] for c in py if c["title"].endswith(NE)} <= js_ids:
        errs.append(f"{path}: neutralised criteria not in JS NOT EVALUATED rows")


@pytest.mark.parametrize("name", list(D))
def test_design(name, ctx):
    ov, samples = D[name]
    d = dict(BASE, **ov)
    ref = json.loads(ctx.call("run", d, dict(samples=samples), timeout=600000))
    p = geometry.derive(dict(d))
    r = geometry.analyse(p, samples=samples)
    L = geometry.lobe_limits(p)
    errs, cnt = [], [0]
    cmp(p, ref["params"], "params", errs, None, cnt)
    js_checks = {}
    _pop_checks(ref["res"], js_checks)
    cmp(r, ref["res"], "res", errs, None, cnt)
    for path, rows in js_checks.items():
        node = r
        for k in path.split(".")[1:]:
            node = node[k]
        check_rows(node["checks"], rows, path, errs)
    cmp(L, ref["lobe"], "lobe", errs, None, cnt)
    cmp(geometry.inner_tool_diameter(p), ref["tool"], "tool", errs, None, cnt)
    for t, c in zip([0.05, 0.37, 0.81], ref["cham"]):
        ch = geometry.chamber(p, t, L, 0)
        cmp({"area": ch["area"], "psi0": ch["psi0"], "psi1": ch["psi1"], "contacts": ch["contacts"], "dAdt": ch["dAdt"],
             "act": geometry.chamber_actual_area(p, t, L)}, c, f"cham{t}", errs, None, cnt)
    if "single" in ref:
        P = r["ports"]
        cmp(ports.simulate_chamber(p, r, P["As"], P["Ad"]), ref["single"], "single", errs, None, cnt)
        cmp(perfmap.gds_cavitation_limits(p, r), ref["gds"], "gds", errs, None, cnt)
        cmp(perfmap.operating_point(p, r, 0.4 * p["rpm"], 0.9 * p["dp"]), ref["op"], "op", errs, None, cnt)
    if "spectrumErr" in ref:
        print("   JS rippleSpectrum THREW:", ref["spectrumErr"])
        try:
            spectrum.ripple_spectrum(p, r, 12)
            print("   python did NOT raise")
        except Exception as ex:
            print("   python raised too:", repr(ex)[:100])
        ref["spectrum"] = {}
    sp, rs = (spectrum.ripple_spectrum(p, r, 12) if "spectrumErr" not in ref else {}), ref["spectrum"]
    for k in ("kinTop", "portTop"):  # ranking among round-off-level (<1e-6 %) harmonics is arbitrary (same as author)
        if rs.get(k):
            rs[k] = [h for h in rs[k] if h["amp"] > 1e-6]
            sp[k] = sp[k][:len(rs[k])]
    cmp(sp, rs, "spectrum", errs, None, cnt)
    print(f"\n[{name}] leaves={cnt[0]} ports={bool(ref['res'].get('ports'))} single={'single' in ref} mismatches={len(errs)}")
    for e in errs[:40]:
        print("   ", e)
    assert cnt[0] > (50 if name == "bigE" else 200), "vacuous?"  # bigE is an invalid design (JS also has no flow)
    assert not errs
