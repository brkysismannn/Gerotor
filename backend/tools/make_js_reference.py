"""Record JS reference outputs for the Python parity tests.

Runs the unmodified browser sources in js/ inside an embedded V8 (pip package
``mini-racer``; Node.js is not required) and writes one JSON file per design to
backend/tests/reference/.

    python backend/tools/make_js_reference.py
"""
import json
import pathlib

from py_mini_racer import MiniRacer

ROOT = pathlib.Path(__file__).resolve().parents[2]
JS = next((d for d in (ROOT / "frontend" / "js", ROOT / "js") if d.is_dir()), ROOT / "frontend" / "js")
OUT = ROOT / "backend" / "tests" / "reference"
FILES = ["geometry.js", "backlash.js", "leakage.js", "contact.js", "friction.js", "fluid.js",
         "ports.js", "spectrum.js", "reverse.js", "perfmap.js", "tolerance.js",
         "criteria.generated.js", "criteria.js"]  # criteria: JS check rows are neutralised (NOT EVALUATED)

BASE = dict(
    c=0, RvAuto=True, RvClear=0.1, bore=0, rpm=1000, dp=10, portsOn=False,
    portRoAuto=True, portRiAuto=True, sucStart=0, sucEnd=0, delStart=0, delEnd=0,
    gSucStart=0, gSucEnd=0, gDelStart=0, gDelEnd=0, grooveW=1,
    doubleFill=False, pIn=1, pVap=0.2, rho=860, bulk=1400, Cd=0.7,
    nu=30, leakOn=False, axialClr=0.05, shaftVent=True,
    odClr=0.15, jbLen=0, jbClr=0.04, faceSupport="balanced", faceMu=0.08,
)

# name -> (design overrides, analyse options)
DESIGNS = {
    "n7_ports_leak": (dict(N=7, e=3, R=30, rp=8, c=0.03, b=20, OD=80, bore=18, rpm=1500, dp=100,
                           RvClear=0.5, portsOn=True, leakOn=True, simSub=4), dict(samples=24)),
    "n9_gds_fillet_grooves": (dict(N=9, e=3.861, R=42.861, rp=10, b=10, OD=95, bore=22, RvClear=0, c=0.02,
                                   fillet=2, rpm=2000, dp=40, portsOn=True, leakOn=True, portFillet=1,
                                   gSucEnd=4, gDelStart=5, grooveD=0.5, dblIn=True, dblOut=False, shadow=True,
                                   jbLen=20, simSub=3, outletVol=50, tipGapModel="uniform"),
                              dict(samples=16)),
    "n5_single_noleak": (dict(N=5, e=2, R=15, rp=4, b=10, OD=48, bore=8, RvClear=0.2, c=0, rpm=3000, dp=20,
                              portsOn=True, leakOn=False, faceSupport="single", sucEnd=-3, delStart=2, simSub=4),
                         dict(samples=24)),
    "n11_antoniak_geom": (dict(N=11, R=1.659 * 11 / 2, e=1.659 * 0.833 / 2, rp=1.11 * 1.659 / 2, b=7,
                               OD=2 * (1.659 * 11 / 2 + 2 * 1.659 * 0.833 / 2) + 20, dp=10, rpm=1000),
                          dict()),
}

HARNESS = r"""
function ser(x) {
  if (x === null || x === undefined) return null;
  if (ArrayBuffer.isView(x)) return Array.from(x);
  if (typeof x === 'number') return Number.isFinite(x) ? x : String(x);
  if (Array.isArray(x)) return x.map(ser);
  if (typeof x === 'object') { const o = {}; for (const k in x) { if (k === 'polys' || k === 'outline' || k === 'pieces' || k === 'waste' || k === 'polygon') continue; o[k] = ser(x[k]); } return o; }
  return x;
}
function runDesign(d, opts) {
  const G = globalThis.Gerotor;
  const p = G.derive(d);
  const r = G.analyse(p, opts);
  const L = G.lobeLimits(p);
  const out = { params: ser(p), opts };
  const keep = ['valid','Amin','Amax','AminActual','AmaxActual','cc','ccCheck','dispInner','flowLpm','ripple','torque','power',
    'rhoMin','psiContactMax','tipSpeed','filletClearance','M','dt','chamberOffset','A','dA','q'];
  out.res = {}; for (const k of keep) out.res[k] = ser(r[k]);
  out.res.checks = r.checks.map(c => [c.level, c.title]);
  out.lobe = ser(L);
  out.tool = ser(G.innerToolDiameter(p));
  const ch = G.chamber(p, 0.37, L, 0);
  out.chamber037 = ser({ area: ch.area, psi0: ch.psi0, psi1: ch.psi1, contacts: ch.contacts, dAdt: ch.dAdt });
  out.actual037 = G.chamberActualArea(p, 0.37, L);
  if (r.backlash) out.backlash = ser(r.backlash);
  if (r.contact) out.contact = ser(r.contact);
  if (r.mech) out.mech = ser(r.mech);
  if (r.ports) {
    const P = r.ports;
    out.ports = ser({ angles: P.angles, crossDeg: P.crossDeg, inletVelocity: P.inletVelocity,
      suctionArea: P.suction && P.suction.area, deliveryArea: P.delivery && P.delivery.area,
      As: P.As, Ad: P.Ad, qMean: P.qMean, qTheo: P.qTheo, portEfficiency: P.portEfficiency, ripple: P.ripple,
      pMaxBar: P.pMaxBar, pMinBar: P.pMinBar, voidMax: P.voidMax, leak: P.leak, outlet: P.outlet,
      simP: P.sim && P.sim.P, simQout: P.sim && P.sim.Qout, simQS: P.sim && P.sim.QS, simQD: P.sim && P.sim.QD,
      conductances: P.sim && P.sim.conductances, Gtip: P.sim && P.sim.Gtip, Qland: P.sim && P.sim.Qland });
    if (P.As) {
      out.single = ser(G.simulateChamber(p, r, P.As, P.Ad));
      out.gds = ser(G.gdsCavitationLimits(p, r));
      const op = G.operatingPoint(p, r, 0.7 * p.rpm, 0.5 * p.dp);
      delete op.stressCurve;
      out.opPoint = ser(op);
    }
  }
  out.spectrum = ser(G.rippleSpectrum(p, r, 12));
  out.reverse = ser(G.reverseEngineer(G.measuredDiameters(p)));
  out.oil = ser(G.oilProperties('vg46', 63));
  out.userOil = ser(G.userOil({ uT1: 40, uNu1: 46, uT2: 100, uNu2: 6.8, uT3: 0, uNu3: 400, uRho15: 875 }, 63));
  return JSON.stringify(out);
}
"""


def main():
    ctx = MiniRacer()
    ctx.eval("var window = globalThis; var performance = { now: () => 0 };")
    for f in FILES:
        ctx.eval((JS / f).read_text(encoding="utf-8"))
    ctx.eval(HARNESS)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (d, opts) in DESIGNS.items():
        p = dict(BASE, **d)
        txt = ctx.call("runDesign", p, opts, timeout=600000)
        (OUT / f"{name}.json").write_text(json.dumps(json.loads(txt), indent=0), encoding="utf-8")
        print("wrote", name)


if __name__ == "__main__":
    main()
