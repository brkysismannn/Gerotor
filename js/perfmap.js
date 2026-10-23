/*
 * Performance map: delivered flow, volumetric / mechanical / overall efficiency, shaft torque
 * and input power over a grid of shaft speeds and pressure rises.
 *
 * Geometry, port opening areas and backlash gaps do not depend on the operating point, so they
 * are taken from the current analysis; for every point only the chamber network
 * (js/leakage.js), the pressure torque (js/contact.js) and the friction model
 * (js/friction.js) are re-evaluated.
 */
(function (G) {
  'use strict';

  const linspace = (a, b, n) => n <= 1 ? [a] : Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));

  function operatingPoint(p0, res, rpm, dp) {
    const p = Object.assign({}, p0, { rpm, dp, simSub: p0.simSub || 6 });
    const qTheo = res.cc * 1e-6 * rpm / 60;
    const r = Object.assign({}, res, { ports: null, contact: null });
    let etaV = 1, ripple = res.ripple, pMax = (p.pIn + dp), voidMax = 0;
    if (p.portsOn && res.ports && res.ports.As && rpm > 0) {
      const sim = G.simulateNetwork(p, res, res.ports.As, res.ports.Ad, res.ports);
      let qs = 0, qMin = Infinity, qMax = -Infinity;
      for (let j = 0; j < res.M; j++) {
        const q = sim.Qout[j]; qs += q; qMin = Math.min(qMin, q); qMax = Math.max(qMax, q);
        pMax = Math.max(pMax, sim.P[j] / 1e5); voidMax = Math.max(voidMax, sim.VF[j]);
      }
      const qMean = qs / res.M;
      etaV = qMean / qTheo;
      ripple = (qMax - qMin) / qMean;
      r.ports = { sim, portEfficiency: etaV };
    }
    if (dp > 0) r.contact = G.computeContact(p, r, { quasiStatic: !r.ports });
    const mech = G.computeMechanical(p, r);
    return {
      rpm, dp,
      flowLpm: etaV * qTheo * 6e4,
      etaV, etaM: mech.etaM, etaT: mech.etaT,
      torque: mech.Mshaft, powerIn: mech.powerIn, powerOut: mech.powerOut,
      ripple, pMaxBar: pMax, voidMax,
      hertz: r.contact ? r.contact.pmaxMax : NaN,
    };
  }

  function performanceMap(p, res, opt) {
    const speeds = linspace(opt.rpmMin, opt.rpmMax, opt.nRpm);
    const pressures = linspace(opt.dpMin, opt.dpMax, opt.nDp);
    const t0 = performance.now(), points = [];
    for (const dp of pressures) for (const rpm of speeds) points.push(operatingPoint(p, res, rpm, dp));
    return { speeds, pressures, points, ms: performance.now() - t0 };
  }

  // Peak chamber void fraction at one speed (network model only).
  function voidAt(p0, res, rpm, dp) {
    const p = Object.assign({}, p0, { rpm, dp, simSub: p0.simSub || 6 });
    const sim = G.simulateNetwork(p, res, res.ports.As, res.ports.Ad, res.ports);
    let v = 0;
    for (let j = 0; j < res.M; j++) v = Math.max(v, sim.VF[j]);
    return v;
  }

  /*
   * Filling-limited maximum speed: highest shaft speed whose peak chamber void fraction stays
   * below `voidLimit` (default 0.5 %, the tool's cavitation warning level), by bisection on rpm.
   * Also reports the speed at which the suction-port inlet velocity reaches 2 m/s.
   */
  function maxSpeed(p, res, opt) {
    opt = opt || {};
    if (!(p.portsOn && res.ports && res.ports.As)) return null;
    const limit = opt.voidLimit || 0.005, dp = opt.dp === undefined ? p.dp : opt.dp;
    let lo = opt.rpmMin || 100, hi = opt.rpmMax || 20000, evals = 0;
    const ok = rpm => { evals++; return voidAt(p, res, rpm, dp) <= limit; };
    const fill = p.doubleFill ? 2 : 1, qPerRpm = res.cc * 1e-6 / 60;       // m³/s per rpm
    const rpmInlet = res.ports.suction ? 2 * res.ports.suction.area * 1e-6 * fill / qPerRpm : NaN;
    if (!ok(lo)) return { rpm: NaN, below: lo, rpmInlet, evals, limit };
    if (ok(hi)) return { rpm: hi, above: hi, rpmInlet, evals, limit };
    while (hi - lo > (opt.tol || 10)) {
      const mid = 0.5 * (lo + hi);
      if (ok(mid)) lo = mid; else hi = mid;
    }
    return { rpm: lo, rpmInlet, evals, limit };
  }

  function mapCsv(map) {
    const cols = ['rpm', 'dp_bar', 'flow_Lmin', 'eta_v', 'eta_m', 'eta_t', 'torque_Nm', 'power_in_W', 'power_out_W', 'flow_ripple', 'p_max_bar_abs', 'void_max', 'hertz_MPa'];
    const rows = map.points.map(q => [q.rpm, q.dp, q.flowLpm, q.etaV, q.etaM, q.etaT, q.torque, q.powerIn, q.powerOut, q.ripple, q.pMaxBar, q.voidMax, q.hertz / 1e6]
      .map(x => Number.isFinite(x) ? +x.toPrecision(6) : '').join(','));
    return cols.join(',') + '\n' + rows.join('\n') + '\n';
  }

  Object.assign(G, { performanceMap, operatingPoint, mapCsv, maxSpeed, voidAt });
})(window.Gerotor);
