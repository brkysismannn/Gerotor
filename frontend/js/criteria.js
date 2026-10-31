/*
 * Acceptance criteria (offline twin of backend/api/criteria.py; same rules, same output shape).
 *
 *  - Profiles, material library and quantity list come from the bundled copy js/criteria.generated.js
 *    (G.criteriaCatalogue, generated from GET /api/criteria/profiles) or the live endpoint (G.criteriaLive).
 *  - EVERY numeric limit, safety factor and material allowable ships empty (null). Boolean model-validity
 *    predicates are the only pre-set criteria. A user value is an Override record
 *    {target, id, field, value, unit, reason, user, timestamp}; reason and user are mandatory.
 *    The templates are never edited.
 *  - Status per criterion: PASS / FAIL / NOT EVALUATED. Overall: FAIL if any enabled criterion FAILs; PASS only if
 *    at least one is enabled and all enabled PASS; otherwise INCOMPLETE.
 *  - Comparison with safety factor S (null = 1): "<=": allowable = limit/S, margin = (allowable - x)/allowable;
 *    ">=": required = limit*S, margin = (x - required)/required; "range": margin = min(x-min, max-x)/(max-min);
 *    "true": predicate. Governing case = smallest margin (a failing case first).
 *  - criteriaHash = SHA-256 of the RFC 8785 canonical JSON of the effective set (as the backend).
 * No DOM access here.
 */
(function (G) {
  'use strict';

  const PASS = 'PASS', FAIL = 'FAIL', NE = 'NOT EVALUATED';
  const STATEMENT = 'This report is a calculation result against the criteria profile named above. No limit value is supplied by the software; all limits shown were entered by the user (see overrides) or are internal model-validity checks. Final acceptance of the design rests with the user\'s certifying authority or customer; this report does not constitute certification or approval.';
  const NO_LIMIT = { label: 'no value shipped - enter from your authority / customer specification', doc: null, clause: null, verified: false };
  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const catalogue = () => G.criteriaLive || G.criteriaCatalogue || null;
  const statement = () => (catalogue() && catalogue().statement) || STATEMENT;
  const hashOf = v => G.project.sha256Sync(G.project.canonical(v));

  function defaultAC() {
    const c = catalogue();
    return clone(c ? c.default : { schemaVersion: 1, activeProfileId: 'generic', authority: { name: null, document: null, edition: null }, materials: { inner: null, outer: null }, overrides: [], customCriteria: [] });
  }
  const isDefault = ac => !ac || G.project.canonical(ac) === G.project.canonical(defaultAC());
  const profileList = () => (catalogue() ? catalogue().profiles : []);
  const quantityMap = () => { const m = {}; if (catalogue()) for (const q of catalogue().quantities) m[q.key] = q; return m; };
  const materialList = () => (catalogue() ? catalogue().materials : []);

  // ---- migration of the gerotor-project/3 placeholder {authority, status, criteria[]} (as backend _v3_to_v4)
  function migrateV3(old) {
    if (!isObj(old) || 'schemaVersion' in old) return old;
    const crit = [];
    for (const c of old.criteria || []) {
      const row = {};
      for (const k of ['id', 'quantity', 'comparison', 'limit', 'unit']) if (k in c) row[k] = c[k];
      row.source = { label: String(c.source || 'migrated from gerotor-project/3'), doc: null, clause: null, verified: false };
      crit.push(row);
    }
    return { schemaVersion: 1, activeProfileId: crit.length ? 'customer-defined' : 'generic', authority: { name: old.authority === undefined ? null : old.authority, document: null, edition: null },
      materials: { inner: null, outer: null }, overrides: [], customCriteria: crit };
  }

  // ---- effective set = template + customCriteria + overrides (later record wins)
  function effective(acIn) {
    const ac = Object.assign(defaultAC(), clone(acIn || {}));
    const profs = {}; for (const p of profileList()) profs[p.id] = p;
    const Q = quantityMap(), issues = [];
    const pid = ac.activeProfileId || 'generic';
    if (!profs[pid]) issues.push(`unknown profile '${pid}'`);
    const prof = clone(profs[pid]) || { id: pid, name: pid, version: null, basis: null, criteria: [] };
    const crit = new Map(prof.criteria.map(c => [c.id, c]));
    for (const c of ac.customCriteria || []) {
      const q = Q[c.quantity];
      const row = { title: c.id, comparison: '<=', unit: q ? q.unit : c.unit, limit: null, safetyFactor: null, enabled: true, gate: null, materialDependent: false,
        loadCases: q && q.kind === 'case' ? 'all' : 'n/a', source: Object.assign({}, NO_LIMIT, { label: 'customer-defined' }) };
      Object.assign(row, clone(c));
      row.custom = true;
      crit.set(row.id, row);
    }
    const mats = {}; for (const m of materialList()) { const r = clone(m); const id = r.id; delete r.id; mats[id] = r; }
    const overridden = new Map();
    (ac.overrides || []).forEach((o, i) => {
      const tgt = o.target === undefined ? 'criterion' : o.target, oid = o.id, field = o.field;
      const pool = tgt === 'criterion' ? crit : tgt === 'material' ? mats : null;
      const has = pool && (pool instanceof Map ? pool.has(oid) : Object.prototype.hasOwnProperty.call(pool, oid));
      if (!has) { issues.push(`override #${i}: unknown ${tgt} '${oid}'`); return; }
      const row = pool instanceof Map ? pool.get(oid) : pool[oid];
      const okField = tgt === 'material' ? Object.prototype.hasOwnProperty.call(row, field) : ['limit', 'safetyFactor', 'enabled', 'source'].includes(field);
      if (!okField) { issues.push(`override #${i}: field '${field}' cannot be overridden`); return; }
      const unit = o.unit === undefined ? null : o.unit, want = row.unit;
      if (field === 'limit' && unit !== null && unit !== want) row.unitMismatch = `override unit '${unit}' != criterion unit '${want}'`;
      else if (field === 'sigmaHlim' && unit !== null && unit !== want) row.unitMismatch = `override unit '${unit}' != material unit '${want}'`;
      const old = row[field] === undefined ? null : row[field];
      row[field] = clone(o.value === undefined ? null : o.value);
      const key = tgt + '\u0000' + oid;
      if (!overridden.has(key)) overridden.set(key, { tgt, oid, rows: [] });
      overridden.get(key).rows.push({ field, oldValue: old, newValue: o.value === undefined ? null : o.value, unit, reason: o.reason === undefined ? null : o.reason, user: o.user === undefined ? null : o.user, timestamp: o.timestamp === undefined ? null : o.timestamp });
    });
    for (const { tgt, oid, rows } of overridden.values()) (tgt === 'criterion' ? crit.get(oid) : mats[oid]).overrides = rows;
    const sel = ac.materials || {};
    const eff = { profileId: pid, profileName: prof.name, profileVersion: prof.version === undefined ? null : prof.version, basis: prof.basis === undefined ? null : prof.basis,
      authority: ac.authority, materials: { inner: sel.inner === undefined ? null : sel.inner, outer: sel.outer === undefined ? null : sel.outer }, materialLibrary: mats, criteria: Array.from(crit.values()) };
    eff.hash = hashOf(eff);
    eff.issues = issues;
    return eff;
  }

  // ---- quantities of one load case (JS twin of criteria.quantity_values; same units as the catalogue)
  // params/res: Calc.run result of that case (cases) or of the design (design-level quantities).
  function caseQuantities(p, res) {
    const ok = !!(res && res.A), pr = ok ? res.ports : null, ct = ok ? res.contact : null, me = ok ? res.mech : null;
    const q = {};
    q['contact.hertzMax'] = ct && num(ct.pmaxMax) !== null ? ct.pmaxMax * 1e-6 : null;
    q['contact.hertzValidity'] = ct && num(ct.pmaxMax) !== null && num(ct.Es) ? 2 * ct.pmaxMax / ct.Es : null;
    q['ports.voidMax'] = pr && num(pr.voidMax) !== null ? pr.voidMax : null;
    const fillS = p.fillS || 1, fillD = p.fillD || 1;
    const aS = pr && pr.suction ? num(pr.suction.area) : null, aD = pr && pr.delivery ? num(pr.delivery.area) : null;
    q['ports.inletVelocity'] = aS && ok && num(res.cc) && num(p.rpm) !== null ? res.cc * p.rpm / (60 * aS * fillS) : (pr && num(pr.inletVelocity) !== null ? pr.inletVelocity : null);
    const flow = pr && num(pr.flowLpm) !== null ? pr.flowLpm : null;
    q['ports.outletVelocity'] = aD && flow !== null ? flow * 1000 / (60 * aD * fillD) : null;
    q['efficiency.volumetric'] = me && num(me.etaV) !== null ? me.etaV : null;
    q['efficiency.mechanical'] = me && num(me.etaM) !== null ? me.etaM : null;
    q['ripple.port'] = pr && num(pr.ripple) !== null ? pr.ripple : (ok && num(res.ripple) !== null ? res.ripple : null);
    q['geometry.tipSpeed'] = ok && num(res.tipSpeed) !== null ? res.tipSpeed : null;
    return q;
  }

  // ctx = { params, res (design point, base design), cases: [{name, rpm, params, res}] }
  function quantityValues(key, ctx) {
    const p = ctx.params || {}, res = ctx.res || {}, ok = !!(res && res.A);
    const geoOnly = {
      'geometry.valid': () => [['n/a', ctx.res ? res.valid === true : false]],
      'geometry.noUndercut': () => { const rm = ok ? num(res.rhoMin) : null, rp = num(p.rp), c = num(p.c); return [['n/a', rm !== null && rp !== null && c !== null ? (rp + c) < rm : null]]; },
      'geometry.tipSharpness': () => { const rm = ok ? num(res.rhoMin) : null, rp = num(p.rp), c = num(p.c); return [['n/a', rm !== null && rp !== null && c !== null && rm ? (rp + c) / rm : null]]; },
      'ripple.kinematic': () => [['n/a', ok ? num(res.ripple) : null]],
      'geometry.outerWallRatio': () => [['n/a', p.OD && p.R && num(p.Rv) !== null ? (p.OD / 2 - p.Rv) / p.R : null]],
      'geometry.innerWallRatio': () => [['n/a', num(p.innerRoot) && num(p.bore) !== null ? (p.innerRoot - p.bore / 2) / p.innerRoot : null]],
      'ports.trappedVolumeSwing': () => [['n/a', null]],      // not exported by the core (as backend)
      'ports.pressureOvershoot': () => {
        const pr = ok ? res.ports : null, sim = (pr && pr.sim) || {};
        const pmax = pr ? num(pr.pMaxBar) : null, pd = num(sim.pD), ps = num(sim.pS);
        return [['design point', pmax !== null && pd !== null && ps !== null ? (pmax * 1e5 - pd) / Math.max(pd - ps, 1e4) : null]];
      },
    };
    if (geoOnly[key]) return geoOnly[key]();
    if (key.startsWith('backlash.')) return [['n/a', ok && res.backlash ? num(res.backlash[key.split('.')[1]]) : null]];
    const cases = ctx.cases && ctx.cases.length ? ctx.cases : [{ name: 'design point', rpm: p.rpm, params: p, res }];
    const out = [];
    for (const c of cases) {
      let v;
      if (c.res === null) v = null;          // this load case could not be analysed
      else if (key === 'cavitation.speedRatio') {
        const lim = ctx.gdsRpm === undefined ? null : num(ctx.gdsRpm);
        v = lim !== null && c.rpm ? lim / c.rpm : null;
      } else {
        const qs = caseQuantities(c.params || p, c.res || res);
        if (!(key in qs)) return [];
        v = qs[key];
      }
      out.push([c.name, v]);
    }
    return out;
  }

  // ---- evaluation
  function limitOf(c, mats, sel) {
    const lim = c.limit;
    if (isObj(lim) && 'fromMaterial' in lim) {
      const field = lim.fromMaterial, ids = [sel.inner, sel.outer].filter(Boolean);
      if (!ids.length) return [null, 'no material selected (settings.acceptanceCriteria.materials)'];
      const vals = [];
      for (const m of ids) {
        const row = mats[m];
        if (row === undefined) return [null, `unknown material '${m}'`];
        if (row.unitMismatch) return [null, row.unitMismatch];
        if (num(row[field]) === null) return [null, `material '${m}' ${field} is empty`];
        vals.push(Number(row[field]));
      }
      return [Math.min(...vals), `min ${field} of ${ids.join(', ')}`];
    }
    return [lim === undefined ? null : lim, null];
  }

  // returns [passed, margin, allowable]; throws Error for an unusable limit
  function check(comp, x, lim, sf) {
    const s = sf === null || sf === undefined ? 1 : Number(sf);
    if (!(s > 0)) throw new Error('safety factor must be > 0');
    if (comp === 'true') return [x === true, null, true];
    if (comp === 'range') {
      const lo = isObj(lim) ? num(lim.min) : null, hi = isObj(lim) ? num(lim.max) : null;
      if (lo === null || hi === null || hi <= lo) throw new Error('range limit needs {min, max} with max > min');
      return [lo <= x && x <= hi, Math.min(x - lo, hi - x) / (hi - lo), { min: lo, max: hi }];
    }
    const L = num(lim);
    if (L === null) throw new Error('limit is not a number');
    if (comp === '<=') { const a = L / s; return [x <= a, a ? (a - x) / a : null, a]; }
    if (comp === '>=') { const a = L * s; return [x >= a, a ? (x - a) / a : null, a]; }
    throw new Error(`unknown comparison '${comp}'`);
  }

  function evaluate(acIn, ctx) {
    const eff = effective(acIn), mats = eff.materialLibrary, sel = eff.materials, Q = quantityMap();
    const rows = [], status = {};
    const order = eff.criteria.slice().sort((a, b) => (a.gate ? 1 : 0) - (b.gate ? 1 : 0));     // stable: gates first
    for (const c of order) {
      const q = Q[c.quantity];
      const row = { id: c.id, title: c.title === undefined ? null : c.title, quantity: c.quantity === undefined ? null : c.quantity, quantityTitle: q ? q.title : null, unit: c.unit === undefined ? null : c.unit,
        comparison: c.comparison === undefined ? null : c.comparison, limit: c.limit === undefined ? null : c.limit, safetyFactor: c.safetyFactor === undefined ? null : c.safetyFactor, allowable: null,
        value: null, margin: null, marginPct: null, governingCase: null, cases: [], status: NE, reason: null, source: c.source === undefined ? null : c.source,
        enabled: c.enabled === undefined ? true : !!c.enabled, gate: c.gate === undefined ? null : c.gate, overridden: !!(c.overrides && c.overrides.length), overrides: c.overrides || [],
        materialDependent: !!c.materialDependent, custom: !!c.custom };
      rows.push(row);
      const ne = why => { row.reason = why; status[c.id] = NE; };
      if (!row.enabled) { ne('disabled'); continue; }
      if (!q) { ne(`unknown quantity '${c.quantity}'`); continue; }
      if (c.unitMismatch) { ne(c.unitMismatch); continue; }
      if (c.gate && status[c.gate] !== PASS) { ne(`gate ${c.gate} is ${status[c.gate] || NE}`); continue; }
      const [lim, note] = c.comparison === 'true' ? [true, null] : limitOf(c, mats, sel);
      if (lim === null) { ne(note || 'no limit entered'); continue; }
      const vals = quantityValues(c.quantity, ctx);
      const good = vals.filter(([, x]) => x !== null && x !== undefined);
      if (!good.length) { ne('quantity not available in results'); continue; }
      let checks;
      try { checks = good.map(([n, x]) => [n, x].concat(check(c.comparison, x, lim, c.safetyFactor))); } catch (e) { ne(e.message); continue; }
      row.cases = checks.map(([n, x, okk, m]) => ({ case: n, value: x, status: okk ? PASS : FAIL, margin: m }));
      let gov = checks[0];
      for (const t of checks) {            // Python min(key=(passed, margin or inf)): first minimum wins
        const kt = [t[2] ? 1 : 0, t[3] !== null ? t[3] : Infinity], kg = [gov[2] ? 1 : 0, gov[3] !== null ? gov[3] : Infinity];
        if (kt[0] < kg[0] || (kt[0] === kg[0] && kt[1] < kg[1])) gov = t;
      }
      Object.assign(row, { value: gov[1], governingCase: gov[0], allowable: gov[4], margin: gov[3], marginPct: gov[3] === null ? null : 100 * gov[3], limitNote: note });
      const missing = vals.filter(([, x]) => x === null || x === undefined).map(([n]) => n);
      if (missing.length && gov[2]) { ne(`quantity missing for case(s) ${missing.join(', ')}`); continue; }
      status[c.id] = row.status = gov[2] ? PASS : FAIL;
    }
    const ids = eff.criteria.map(c => c.id);
    rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    const enabled = rows.filter(r => r.enabled);
    const counts = {}; for (const k of [PASS, FAIL, NE]) counts[k] = enabled.filter(r => r.status === k).length;
    counts.disabled = rows.length - enabled.length;
    const overall = counts[FAIL] ? FAIL : (enabled.length && counts[PASS] === enabled.length ? PASS : 'INCOMPLETE');
    const over = [];
    for (const c of eff.criteria) for (const o of c.overrides || []) over.push(Object.assign({}, o, { target: 'criterion', id: c.id }));
    for (const id of Object.keys(mats)) for (const o of mats[id].overrides || []) over.push(Object.assign({}, o, { target: 'material', id }));
    return { evaluated: true, schemaVersion: 1, profileId: eff.profileId, profileName: eff.profileName, profileVersion: eff.profileVersion, basis: eff.basis,
      authority: eff.authority, materials: eff.materials,
      materialLibrary: Object.keys(mats).filter(k => k === sel.inner || k === sel.outer).map(k => Object.assign({ id: k }, mats[k])),
      criteriaHash: eff.hash, overall, counts, criteria: rows, overrides: over, issues: eff.issues, assumptions: ['A-AC1'], statement: statement() };
  }

  // ---- UI-side edits: always append an Override record, never touch templates
  function makeOverride(rec, now) {
    const need = s => typeof s === 'string' && s.trim() !== '';
    if (!need(rec.reason)) throw new Error('A reason is mandatory for every limit or allowable.');
    if (!need(rec.user)) throw new Error('The user name is mandatory (enter the author in Project properties).');
    if (!need(rec.id) || !need(rec.field)) throw new Error('Override needs a target id and field.');
    return { target: rec.target || 'criterion', id: rec.id, field: rec.field, value: rec.value === undefined ? null : rec.value, unit: rec.unit === undefined ? null : rec.unit,
      reason: rec.reason.trim(), user: rec.user.trim(), timestamp: now || new Date().toISOString() };
  }
  function addOverride(ac, rec, now) {
    const o = makeOverride(rec, now), out = Object.assign(defaultAC(), clone(ac || {}));
    out.overrides = (out.overrides || []).concat([o]);
    return out;
  }
  // value of a field as seen by the UI (effective row)
  function effectiveRow(ac, id) { return effective(ac).criteria.find(c => c.id === id) || null; }
  const limitValue = (ac, id) => { const r = effectiveRow(ac, id); return r && r.enabled !== false && !r.unitMismatch && num(r.limit) !== null ? r.limit : null; };

  // Evaluation context from the workspace: base design (params/res), optional per-case runs [{name, rpm, params, res}].
  // GDS cavitation limit at the base design inlet head with the settings.variants A-D2/A-D4 (as backend calc cavitation.gds).
  function context(settings, params, res, caseRuns) {
    const v = (settings && settings.variants) || {};
    let gdsRpm = null;
    if (res && res.A && res.ports && res.ports.As && G.gdsCavitationLimits) gdsRpm = G.gdsCavitationLimits(params, res, v.cavHead, v.cavAreaDoubleFill).rpm;
    return { params, res, cases: caseRuns && caseRuns.length ? caseRuns : null, gdsRpm };
  }

  G.criteria = { context, PASS, FAIL, NE, STATEMENT, catalogue, statement, defaultAC, isDefault, migrateV3, effective, caseQuantities, quantityValues, evaluate, check, makeOverride, addOverride, effectiveRow, limitValue, profileList, materialList, quantityMap };
})(window.Gerotor = window.Gerotor || {});
