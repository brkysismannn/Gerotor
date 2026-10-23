/*
 * Reverse engineering: profile parameters from measured diameters of an existing gerotor set.
 *
 *   inner tip Ø   Dt = 2(R + e − rp − c)
 *   inner root Ø  Dr = 2(R − e − rp − c)
 *   outer minor Ø Dl = 2(R − rp)          (across the lobe tips)
 *   outer major Ø Dv = 2·Rv               (valley / root circle of the outer rotor)
 *   lobe radius   rp                      (pin diameter / radius gauge)
 *
 *   ⇒ e = (Dt − Dr)/4,  c = Dl/2 − (Dt + Dr)/4,  R = Dl/2 + rp,  Rv = Dv/2.
 */
(function (G) {
  'use strict';

  function reverseEngineer(m) {
    const issues = [];
    const e = (m.Dt - m.Dr) / 4;
    const c = m.Dl / 2 - (m.Dt + m.Dr) / 4;
    const R = m.Dl / 2 + m.rp;
    const Rv = m.Dv / 2;
    const RvMin = R + 2 * e - m.rp;
    if (!(e > 0)) issues.push('Inner tip Ø must exceed inner root Ø.');
    if (c < -1e-9) issues.push(`Negative clearance (${(c * 1000).toFixed(1)} µm): outer minor Ø too small for the inner rotor; check the measurements.`);
    if (!(R > m.N * e)) issues.push(`R (${R.toFixed(3)}) must exceed N·e (${(m.N * e).toFixed(3)}): inconsistent lobe count or diameters.`);
    if (m.Dv > 0 && Rv < RvMin - Math.max(c, 0) - 1e-9) issues.push(`Outer major Ø ${m.Dv} is smaller than the tooth-tip path 2(R + 2e − rp − c) = ${(2 * (RvMin - Math.max(c, 0))).toFixed(3)}.`);
    const params = {
      N: m.N, e: +e.toFixed(5), R: +R.toFixed(5), rp: m.rp, c: +Math.max(0, c).toFixed(5),
      RvAuto: !(m.Dv > 0), Rv: m.Dv > 0 ? +Rv.toFixed(5) : undefined,
    };
    if (m.b > 0) params.b = m.b;
    if (m.OD > 0) params.OD = m.OD;
    if (m.bore >= 0) params.bore = m.bore;
    return {
      ok: issues.length === 0, issues, params,
      derived: { e, c, R, Rv, lambda: R / (m.N * e), k: m.rp / e, valleyMargin: Rv - RvMin + Math.max(c, 0) },
    };
  }

  // Forward model (used by tests and as a check): measured diameters of a design.
  function measuredDiameters(p) {
    return {
      N: p.N, Dt: 2 * (p.R + p.e - p.rp - p.c), Dr: 2 * (p.R - p.e - p.rp - p.c),
      Dl: 2 * (p.R - p.rp), Dv: 2 * p.Rv, rp: p.rp,
    };
  }

  Object.assign(G, { reverseEngineer, measuredDiameters });
})(window.Gerotor);
