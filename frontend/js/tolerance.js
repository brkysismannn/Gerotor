/*
 * Clearance tolerance -> intervals of eta_v, eta_hm and eta (mirror of backend gerotor_core/tolerance.py).
 * Monotone axes are sampled at their two ends (exact vertex interval); the non-monotone axis c is
 * sampled on GRID_LEVELS points with parabolic refinement of interior extrema. eta: guaranteed
 * enclosure [min eta_v min eta_hm, max eta_v max eta_hm] + range over the evaluated points.
 * Method and evidence: docs/tolerance.md.
 */
(function (G) {
  'use strict';

  const KEYS = ['c', 'axialClr', 'odClr', 'jbClr'];
  const AXIS_METHOD = { c: 'grid', axialClr: 'corners', odClr: 'corners', jbClr: 'corners' };
  const SET = { GRID_LEVELS: 5 };   // numerical setting, docs/tolerance.md
  const MECH_ONLY = ['odClr', 'jbClr'];

  function checkBands(tol, nominal) {
    const out = {};
    for (const [k, b] of Object.entries(tol || {})) {
      if (!KEYS.includes(k)) throw new Error(`clearanceTolerance: unknown clearance '${k}' (allowed: ${KEYS.join(', ')})`);
      if (!b || b.min === undefined || b.min === null || b.max === undefined || b.max === null) throw new Error(`clearanceTolerance.${k}: needs min and max`);
      const lo = +b.min, hi = +b.max, nom = nominal[k];
      if (!(lo >= 0 && lo <= hi)) throw new Error(`clearanceTolerance.${k}: need 0 <= min <= max`);
      if (nom === undefined || nom === null || !(lo <= nom && nom <= hi)) throw new Error(`clearanceTolerance.${k}: nominal ${nom} is outside [${lo}, ${hi}]`);
      out[k] = [lo, hi];
    }
    return out;
  }

  function levels(band, method) {
    const [lo, hi] = band;
    if (hi === lo) return [lo];
    if (method === 'corners') return [lo, hi];
    const n = SET.GRID_LEVELS;
    return Array.from({ length: n }, (_, i) => lo + (hi - lo) * i / (n - 1));
  }

  function seriesExtrema(vals) {
    let lo = Math.min(...vals), hi = Math.max(...vals), ref = 0;
    for (let i = 1; i < vals.length - 1; i++) {
      const f0 = vals[i - 1], f1 = vals[i], f2 = vals[i + 1], curv = f0 - 2 * f1 + f2;
      if (curv === 0) continue;
      const fv = f1 - (f2 - f0) ** 2 / (8 * curv);
      if (curv > 0 && f1 <= f0 && f1 <= f2) { lo = Math.min(lo, fv); ref = Math.max(ref, Math.abs(f1 - fv)); }
      else if (curv < 0 && f1 >= f0 && f1 >= f2) { hi = Math.max(hi, fv); ref = Math.max(ref, Math.abs(f1 - fv)); }
    }
    return [lo, hi, ref];
  }

  function product(keys, axes) {
    let out = [{}];
    for (const k of keys) out = out.flatMap(o => axes[k].levels.map(v => Object.assign({}, o, { [k]: v })));
    return out;
  }

  // makeDesign(overrides) -> design; analyse(p) -> res; opPoint(p, res, mechDesigns) -> {etaV, etaM, mechEtaM}
  function interval(makeDesign, analyse, opPoint, bands) {
    const axes = {};
    for (const [k, b] of Object.entries(bands)) axes[k] = { min: b[0], max: b[1], method: AXIS_METHOD[k], levels: levels(b, AXIS_METHOD[k]) };
    const order = KEYS.filter(k => k in axes);
    const gridKeys = order.filter(k => axes[k].method === 'grid');
    const cornerKeys = order.filter(k => axes[k].method === 'corners');
    const netCorner = cornerKeys.filter(k => !MECH_ONLY.includes(k)), mechCorner = cornerKeys.filter(k => MECH_ONLY.includes(k));
    const mechSets = product(mechCorner, axes), gridSets = product(gridKeys, axes), netSets = product(netCorner, axes);
    const etaV = new Map(), etaM = new Map(), analyses = new Map();
    let runs = 0;
    gridSets.forEach((g, gi) => netSets.forEach((nc, ni) => {
      const p = makeDesign(Object.assign({}, g, nc));
      const key = JSON.stringify(Object.entries(g).sort());
      if (!analyses.has(key)) analyses.set(key, analyse(p));
      const res = analyses.get(key);
      const mds = mechSets.map(m => makeDesign(Object.assign({}, g, nc, m)));
      const r = opPoint(p, res, mds);
      runs++;
      etaV.set(ni + ',' + gi, r.etaV);
      mechSets.forEach((_, mi) => etaM.set(ni + ',' + mi + ',' + gi, r.mechEtaM[mi]));
    }));
    const ng = gridSets.length;
    const ext = vals => gridKeys.length === 1 ? seriesExtrema(vals) : [Math.min(...vals), Math.max(...vals), 0];
    let vLo = Infinity, vHi = -Infinity, mLo = Infinity, mHi = -Infinity, tLo = Infinity, tHi = -Infinity, ref = 0;
    netSets.forEach((_, ni) => {
      const sv = Array.from({ length: ng }, (_, gi) => etaV.get(ni + ',' + gi));
      let [a, b, rf] = ext(sv); vLo = Math.min(vLo, a); vHi = Math.max(vHi, b); ref = Math.max(ref, rf);
      mechSets.forEach((_, mi) => {
        const sm = Array.from({ length: ng }, (_, gi) => etaM.get(ni + ',' + mi + ',' + gi));
        [a, b, rf] = ext(sm); mLo = Math.min(mLo, a); mHi = Math.max(mHi, b); ref = Math.max(ref, rf);
        [a, b] = ext(sv.map((x, i) => x * sm[i])); tLo = Math.min(tLo, a); tHi = Math.max(tHi, b);
      });
    });
    return {
      method: 'vertex enumeration on monotone axes, grid + parabolic refinement on non-monotone axes',
      axes, networkRuns: runs, analyses: analyses.size,
      etaV: [vLo, vHi], etaM: [mLo, mHi],
      etaT: [vLo * mLo, vHi * mHi], etaTBasis: 'enclosure [min eta_v min eta_hm, max eta_v max eta_hm]',
      etaTEvaluated: [tLo, tHi], refinement: ref,
    };
  }

  // UI helper: interval of one load case from the raw form design (input units) and the tolerance settings.
  function caseInterval(raw, tol) {
    const bands = checkBands(tol, raw);
    if (!Object.keys(bands).length) return null;
    const make = ov => G.derive(Object.assign({}, raw, ov));
    return interval(make, p => G.analyse(p), (p, res, mds) => G.operatingPoint(p, res, raw.rpm, raw.dp, mds), bands);
  }

  G.tolerance = { KEYS, AXIS_METHOD, SET, MECH_ONLY, checkBands, levels, seriesExtrema, interval, caseInterval };
})(window.Gerotor);
