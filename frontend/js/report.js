/*
 * Calculation report: result rows, min/max/mean series and the printable HTML document.
 * Pure functions (no DOM); the workspace opens the returned HTML in a window and calls print().
 * Content follows company/reports/2026-10-30-production-manager-report-spec.md.
 */
(function (G) {
  'use strict';

  const DEG = 180 / Math.PI;
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fx = (x, d) => Number.isFinite(x) ? x.toFixed(d) : '-';

  // ---- result rows per report section: [label, value, unit]
  function rows(p, res) {
    const ok = !!(res && res.A), pr = ok && res.ports, ct = ok && res.contact, me = ok && res.mech, bl = ok && res.backlash;
    const S = [];
    const geo = [
      ['Inner rotor teeth', String(p.N - 1), '-'],
      ['Inner rotor tip diameter', fx(2 * p.innerTip, 3), 'mm'], ['Inner rotor root diameter', fx(2 * p.innerRoot, 3), 'mm'],
      ['Outer lobe tip diameter', fx(2 * p.outerTip, 3), 'mm'], ['Outer valley diameter', fx(2 * p.Rv, 3), 'mm'],
      ['Pitch diameter, inner', fx(2 * p.pitchInner, 3), 'mm'], ['Pitch diameter, outer', fx(2 * p.pitchOuter, 3), 'mm'],
      ['Lambda = R / (N e)', fx(p.lambda, 4), '-'],
    ];
    if (ok) geo.push(['Trochoid minimum radius of curvature', fx(res.rhoMin, 3), 'mm'],
      ['Chamber area min / max', fx(res.Amin, 2) + ' / ' + fx(res.Amax, 2), 'mm²'],
      ['Chamber volume min / max (with c)', fx(res.AminActual * p.b, 2) + ' / ' + fx(res.AmaxActual * p.b, 2), 'mm³'],
      ['Maximum contact (pressure) angle', fx(res.psiContactMax * DEG, 1), '°']);
    S.push({ id: 'geometry', title: 'Geometry', rows: geo });
    if (ok) {
      const kin = [['Displacement', fx(res.cc, 3), 'cm³/rev'], ['Theoretical flow', fx(res.flowLpm, 2), 'L/min'],
        ['Kinematic flow ripple', fx(res.ripple * 100, 2), '%'], ['Ideal torque', fx(res.torque, 2), 'N·m'],
        ['Hydraulic power', fx(res.power, 2), 'kW'], ['Inner tip speed', fx(res.tipSpeed, 2), 'm/s']];
      if (bl) kin.push(['Backlash angle min / max', fx(bl.deltaMin * DEG * 60, 2) + ' / ' + fx(bl.deltaMax * DEG * 60, 2), 'arcmin'],
        ['Outer rotor speed pulsation', fx(bl.speedPulsation * 100, 3), '%'], ['Tip-to-tip gap at max volume', fx(bl.tipToTipGap * 1000, 1), 'µm']);
      S.push({ id: 'kinematics', title: 'Kinematics and flow', rows: kin });
    }
    if (pr && pr.sim) {
      const lk = [['Delivery flow (port model)', fx(pr.flowLpm, 2), 'L/min'],
        [p.leakOn ? 'Volumetric efficiency' : 'Port timing efficiency', fx(pr.portEfficiency * 100, 1), '%'],
        ['Flow ripple (port model)', fx(pr.ripple * 100, 2), '%']];
      if (p.leakOn && pr.leak) lk.push(['Leak flow, tip (gross)', fx(pr.leak.tip * 6e4, 3), 'L/min'],
        ['Leak flow, bore drain', fx(pr.leak.bore * 6e4, 3), 'L/min'], ['Leak flow, lands', fx(pr.leak.land * 6e4, 3), 'L/min']);
      S.push({ id: 'leakage', title: 'Leakage and volumetric efficiency', rows: lk });
    }
    if (ct) S.push({ id: 'contact', title: 'Contact and Hertz stress', rows: [
      ['Contact force max', fx(ct.Fmax, 0), 'N'], ['Hertz pressure max', fx(ct.pmaxMax / 1e6, 0), 'MPa'],
      ['Sliding speed max', fx(ct.vsMax, 3), 'm/s'], ['Wear factor p·v max', fx(ct.wrpfMax / 1e6, 1), 'MPa·m/s'],
      ['Shaft torque mean', fx(ct.torqueMean, 2), 'N·m'], ['Shaft torque ripple', fx(ct.torqueRipple * 100, 1), '%'],
      ['Shaft side load mean / max', fx(ct.shaftLoadMean, 0) + ' / ' + fx(ct.shaftLoadMax, 0), 'N'],
      ['Contact reversal (F < 0)', ct.reversal ? 'yes' : 'no', '-'],
      ['Safety factor', 'not evaluated (criterion open, see section Methods)', '-']] });
    if (me) S.push({ id: 'friction', title: 'Friction and mechanical efficiency', rows: [
      ['Shaft torque incl. losses', fx(me.Mshaft, 2), 'N·m'], ['Mechanical efficiency', fx(me.etaM * 100, 1), '%'],
      ['Overall efficiency', fx(me.etaT * 100, 1), '%'], ['Input power', fx(me.powerIn / 1000, 3), 'kW'],
      ['Loss torque: OD / outer faces / inner faces / ports',
        [me.MoutRad * (p.N - 1) / p.N, me.MoutLat * (p.N - 1) / p.N, me.MinLat, me.Mports].map(x => fx(x, 3)).join(' / '), 'N·m']] });
    if (pr && pr.suction) {
      const a = x => fx(((x * DEG) % 360 + 360) % 360, 1) + '°';
      const po = [['Suction port', a(pr.suction.a0) + ' to ' + a(pr.suction.a1), '-'], ['Delivery port', a(pr.delivery.a0) + ' to ' + a(pr.delivery.a1), '-'],
        ['Port radii outer / inner', fx(p.portRo, 2) + ' / ' + fx(p.portRi, 2), 'mm'], ['Port area (each)', fx(pr.suction.area, 1), 'mm²'],
        ['Chamber pressure min / max', fx(pr.pMinBar, 2) + ' / ' + fx(pr.pMaxBar, 1), 'bar abs'], ['Inlet port velocity', fx(pr.inletVelocity, 2), 'm/s']];
      if (pr.outlet) po.push(['Outlet pressure ripple', fx(pr.outlet.ripplePa / 1e5, 2), 'bar p-p']);
      if (G.gdsCavitationLimits) { const cv = G.gdsCavitationLimits(p, res); po.push(['Max speed, cavitation (GDS criteria)', fx(cv.rpm, 0) + ' (' + cv.basis + ')', 'rpm']); }
      S.push({ id: 'ports', title: 'Ports and cavitation', rows: po });
    }
    if (ok && p.rpm > 0 && G.rippleSpectrum) {
      const sp = G.rippleSpectrum(p, res), top = l => l.slice(0, 3).map(h => `${fx(h.f, 0)} Hz: ${fx(h.amp, 2)} %`).join('; ');
      const rs = [['Tooth-pass frequency', fx(sp.kin.toothPass, 1), 'Hz'], ['Dominant harmonics (kinematic)', top(sp.kinTop), '-']];
      if (sp.portTop) rs.push(['Dominant harmonics (port model)', top(sp.portTop), '-']);
      S.push({ id: 'spectrum', title: 'Ripple spectrum', rows: rs });
    }
    return S;
  }

  // ---- series statistics over one cycle: [name, unit, min, max, mean]
  function stat(a, scale) {
    let mn = Infinity, mx = -Infinity, s = 0;
    for (let i = 0; i < a.length; i++) { const v = a[i] * scale; if (v < mn) mn = v; if (v > mx) mx = v; s += v; }
    return { min: mn, max: mx, mean: s / a.length };
  }
  function series(p, res) {
    const out = [];
    if (!res || !res.A) return out;
    const add = (name, unit, arr, k, d) => { if (arr && arr.length) out.push(Object.assign({ name, unit, d: d === undefined ? 3 : d }, stat(arr, k))); };
    add('Chamber area (one chamber)', 'mm²', res.A, 1, 2);
    if (res.q) { let m = 0; for (const v of res.q) m += v; m /= res.q.length; add('Kinematic delivery flow', 'L/min', res.q, res.flowLpm / m, 2); }
    const pr = res.ports;
    if (pr && pr.Qout) add('Delivery flow (port model)', 'L/min', pr.Qout, 6e4, 2);
    if (pr && pr.sim && pr.sim.P) add('Chamber pressure', 'bar abs', pr.sim.P, 1e-5, 2);
    const ct = res.contact;
    if (ct) {
      add('Contact force', 'N', ct.F, 1, 0); add('Hertz pressure', 'MPa', ct.Pmax, 1e-6, 0);
      add('Sliding speed', 'm/s', ct.Vs, 1, 3); add('Shaft torque', 'N·m', ct.Tshaft, 1, 3);
    }
    return out;
  }

  // Known open issues of the validation suite (literature discrepancies). `inRange(params)` -> true/false when the affected input range
  // is defined; without it the range is not defined and the entry is listed as "not evaluated" (it does not invalidate by itself).
  const KNOWN_ISSUES = [
    { id: 'KI-1', title: 'GDS "Approx. capacity" differs from the numerical displacement; GDS matches the Stryczek closed form' },
    { id: 'KI-2', title: 'Antoniak 2026 Table 1 flow irregularity: definition of delta_e (Stryczek Eq. 3) not yet reproduced' },
    { id: 'KI-3', title: 'Stryczek closed-form displacement is 1.5-2 % higher than the numerical value (transcription from PDF)' },
    { id: 'KI-4', title: 'Hussain 2022 volumetric efficiency: plausibility only, clearances assumed (graph reading)' },
  ];
  function knownIssues(p) {
    return KNOWN_ISSUES.map(k => ({ id: k.id, title: k.title, state: typeof k.inRange === 'function' ? (k.inRange(p) ? 'in range' : 'out of range') : 'range not defined (not evaluated)' }));
  }

  const kindTag = k => (k === 'unsourced' ? '<span class="kind-unsourced">[unsourced]</span>' : `<span class="small">[${esc(k)}]</span>`);
  const rankOf = t => /INVALID/.test(t) ? 2 : (/WARN/.test(t) ? 1 : 0);
  /*
   * Overall status = worst over the analysed case and ALL load cases (opts.caseResults). INVALID when: the analysis failed, any check is
   * an error, any load case is INVALID, a known issue is unresolved inside the input range; with opts.release (the report) also when
   * the code version is not stamped or the methods registry is missing. Spec: 2026-10-30-production-manager-report-spec.md.
   * Returns { valid, text, reasons, warn, cases:[{name,status}], notForCertification }.
   */
  function status(res, opts) {
    opts = opts || {};
    const reasons = [], cases = [];
    let warn = 0, worst = 0;
    const add = (name, text) => { cases.push({ name, status: text }); worst = Math.max(worst, rankOf(text)); };
    if (!res || !res.A) { reasons.push('analysis did not complete (invalid geometry)'); add(opts.activeName || 'Active case', 'INVALID'); }
    else {
      const errs = (res.checks || []).filter(c => c.level === 'err');
      for (const c of errs) reasons.push(c.title);
      if (res.valid === false && !errs.length) reasons.push('analysis flagged the design as invalid');
      const w = (res.checks || []).filter(c => c.level === 'warn').length;
      warn += w;
      add(opts.activeName || 'Active case', reasons.length ? 'INVALID' : (w ? 'VALID WITH WARNINGS' : 'VALID'));
    }
    for (const r of opts.caseResults || []) {
      const t = r.status || (Number.isFinite(r.flow) ? 'VALID' : 'INVALID');
      add(r.name, t);
      if (rankOf(t) === 2) reasons.push(`load case "${r.name}" is INVALID` + (r.error ? ' (' + r.error + ')' : ''));
      else if (rankOf(t) === 1) warn++;
    }
    if (opts.params) for (const k of knownIssues(opts.params)) if (k.state === 'in range') reasons.push(`known issue ${k.id} unresolved inside the input range`);
    if (opts.release) {
      if (!G.project.isStamped()) reasons.push('code version not stamped (no git hash from the backend /api/health)');
      if (!G.project.methodsData()) reasons.push('methods registry (assumptions, sources) not available');
    }
    const valid = reasons.length === 0;
    return { valid, text: valid ? (warn ? 'VALID WITH WARNINGS' : 'VALID') : 'INVALID', reasons, warn, cases, notForCertification: !valid };
  }

  // Assumption texts from the backend registry (live /api/methods or the bundled generated copy); never hand-written IDs.
  function assumptionPairs() { const d = G.project.methodsData(); return d ? d.assumptions.map(a => [a.id, a.text]) : []; }
  function referenceList() {
    const d = G.project.methodsData(), seen = new Set(), out = [];
    if (d) for (const m of d.methods) for (const s of m.sources || []) if (!seen.has(s.ref)) { seen.add(s.ref); out.push({ ref: s.ref, kind: s.kind }); }
    return out;
  }
  const variantValue = (a, st) => {
    const v = st && st.settings && st.settings.variants;
    return v && a.switch && v[a.switch] !== undefined ? v[a.switch] : a.default;
  };

  // ---- DRAFT / UNSIGNED: a report without author or checker is not a signed document
  const unsigned = m => !String(m.author || '').trim() || !String(m.checker || '').trim();

  // ---- backend bulk data dropped by to_json(arrays=False) is listed in "_omitted": [{key, length, reason}] on the parent object
  function collectOmitted(tree, path, out) {
    out = out || []; path = path || '';
    if (tree && typeof tree === 'object') {
      if (Array.isArray(tree._omitted)) for (const o of tree._omitted) out.push({ path: path || '(root)', key: o.key, length: o.length, reason: o.reason });
      if (!Array.isArray(tree)) for (const k of Object.keys(tree)) if (k !== '_omitted' && tree[k] && typeof tree[k] === 'object') collectOmitted(tree[k], path ? path + '.' + k : k, out);
    }
    return out;
  }

  // ---- acceptance criteria section (backend /api/report/data acceptanceCriteria shape)
  const fv = x => (typeof x === 'number' && Number.isFinite(x) ? String(+x.toPrecision(5)) : '-');
  function limitText(c) {
    const lim = c.limit;
    if (lim === null || lim === undefined) return '-';
    if (typeof lim === 'object') return 'fromMaterial' in lim ? 'material ' + esc(lim.fromMaterial) : fv(lim.min) + ' .. ' + fv(lim.max);
    return fv(lim);
  }
  function allowText(c) {
    const a = c.allowable;
    if (a === null || a === undefined) return c.comparison === 'true' ? 'must hold' : (c.limit === null || c.limit === undefined ? 'no limit entered' : '-');
    if (a === true) return 'must hold';
    if (typeof a === 'object') return fv(a.min) + ' .. ' + fv(a.max);
    return (c.comparison === '<=' ? '&le; ' : c.comparison === '>=' ? '&ge; ' : '') + fv(a) + (c.safetyFactor ? ' (limit ' + limitText(c) + ', S = ' + fv(c.safetyFactor) + ')' : ' (limit ' + limitText(c) + ')');
  }
  function criteriaSection(ac, num) {
    const h = [];
    h.push(`<h2 id="criteria">${num} Acceptance criteria</h2>`);
    h.push(`<p data-criteria-overall="${esc(ac.overall)}"><b>Overall: ${esc(ac.overall)}</b> &nbsp; PASS ${ac.counts.PASS} / FAIL ${ac.counts.FAIL} / NOT EVALUATED ${ac.counts['NOT EVALUATED']} / disabled ${ac.counts.disabled}. Profile: ${esc(ac.profileName)} (version ${esc(ac.profileVersion)}, basis ${esc(ac.basis)}).</p>`);
    const au = ac.authority || {};
    h.push(`<p class="small">Authority: ${esc(au.name || 'not stated')}${au.document ? ', ' + esc(au.document) : ''}${au.edition ? ', edition ' + esc(au.edition) : ''}. Materials: inner ${esc((ac.materials || {}).inner || 'none selected')}, outer ${esc((ac.materials || {}).outer || 'none selected')}.</p>`);
    h.push(`<table class="criteria"><tr><th>ID</th><th>Quantity</th><th>Value</th><th>Allowable (limit, S)</th><th>Margin %</th><th>Status</th><th>Governing case</th><th>Source</th></tr>`);
    for (const c of ac.criteria) {
      const cls = c.status === 'FAIL' ? 'lvl-err' : c.status === 'PASS' ? 'lvl-ok' : 'lvl-warn';
      const val = c.value === null || c.value === undefined ? '-' : typeof c.value === 'boolean' ? (c.value ? 'true' : 'false') : fv(c.value);
      const src = c.source ? esc(c.source.label || '') + (c.source.doc ? '<br>' + esc(c.source.doc) : '') + (c.source.clause ? ', ' + esc(c.source.clause) : '') + (c.source.verified === false ? ' <span class="small">[not verified]</span>' : '') : '';
      h.push(`<tr id="crit-${esc(c.id)}" data-criterion="${esc(c.id)}"${c.enabled ? '' : ' class="small"'}><td><b>${esc(c.id)}</b>${c.overridden ? ' *' : ''}${c.custom ? ' (custom)' : ''}</td><td>${esc(c.quantityTitle || c.title)}</td><td class="n">${esc(val)} ${esc(c.unit && c.unit !== '-' ? c.unit : '')}</td><td>${allowText(c)}</td>` +
        `<td class="n">${c.marginPct === null || c.marginPct === undefined ? '-' : fx(c.marginPct, 1)}</td><td class="${cls}" data-status="${esc(c.status)}">${esc(c.status)}${c.reason ? '<br><span class="small">' + esc(c.reason) + '</span>' : ''}</td><td>${esc(c.governingCase || '-')}</td><td>${src}</td></tr>`);
    }
    h.push(`</table><p class="small">* = limit, safety factor, enabled flag, source or material value was entered by the user (see overrides).</p>`);
    h.push(`<h3>Overrides (user-entered values)</h3>`);
    if (!ac.overrides.length) h.push(`<p data-overrides="none">No override has been entered: no limit value is set, every limit-based criterion is NOT EVALUATED.</p>`);
    else {
      h.push(`<table class="overrides"><tr><th>Target</th><th>ID</th><th>Field</th><th>Old value</th><th>New value</th><th>Unit</th><th>Reason</th><th>User</th><th>Timestamp</th></tr>`);
      for (const o of ac.overrides) {
        const js = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
        h.push(`<tr><td>${esc(o.target)}</td><td>${esc(o.id)}</td><td>${esc(o.field)}</td><td>${esc(js(o.oldValue))}</td><td>${esc(js(o.newValue))}</td><td>${esc(o.unit)}</td><td>${esc(o.reason)}</td><td>${esc(o.user)}</td><td>${esc(o.timestamp)}</td></tr>`);
      }
      h.push(`</table>`);
    }
    if (ac.materialLibrary && ac.materialLibrary.length) {
      h.push(`<h3>Selected materials (allowables)</h3><table class="materials"><tr><th>ID</th><th>Name</th><th>&sigma;<sub>Hlim</sub> (${esc(ac.materialLibrary[0].unit)})</th><th>Yield</th><th>Condition</th><th>Source</th></tr>`);
      for (const m of ac.materialLibrary) h.push(`<tr><td>${esc(m.id)}</td><td>${esc(m.name)}</td><td class="n">${fv(m.sigmaHlim)}</td><td class="n">${fv(m.yield)}</td><td>${esc(m.condition)}</td><td>${esc((m.source || {}).label)}${(m.source || {}).doc ? '<br>' + esc(m.source.doc) : ''}</td></tr>`);
      h.push(`</table>`);
    }
    if (ac.issues && ac.issues.length) h.push(`<p class="lvl-err">Issues in the criteria set: ${esc(ac.issues.join('; '))}</p>`);
    h.push(`<p>Criteria-set hash (SHA-256 of the effective set: profile, authority, materials, library, criteria): <span class="mono" id="criteriaHash">${esc(ac.criteriaHash)}</span></p>`);
    h.push(`<p class="small">Assumptions used: ${esc((ac.assumptions || []).join(', '))} (see Methods and assumptions).</p>`);
    h.push(`<p class="statement" data-statement="acceptance"><b>${esc(ac.statement)}</b></p>`);
    return h.join('\n');
  }

  const CSS = `
  @page { size: A4; margin: 18mm 14mm 18mm 14mm;
    @bottom-left { content: "Gerotor calculation report"; font: 8pt Arial, sans-serif; color: #555; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Arial, sans-serif; color: #555; } }
  * { box-sizing: border-box; }
  body { font: 10pt/1.35 Arial, "Segoe UI", sans-serif; color: #111; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 4px; } h2 { font-size: 13pt; margin: 18px 0 6px; padding-bottom: 2px; border-bottom: 1.5px solid #234; break-after: avoid; }
  h3 { font-size: 10.5pt; margin: 10px 0 4px; break-after: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; break-inside: auto; } tr { break-inside: avoid; }
  th, td { border: 1px solid #b8bec6; padding: 2px 6px; text-align: left; vertical-align: top; font-size: 9pt; }
  th { background: #eceff3; } td.n { text-align: right; font-family: Consolas, monospace; white-space: nowrap; } td.u { color: #444; white-space: nowrap; }
  .cover { min-height: 235mm; break-after: page; } .cover .sub { color: #444; margin-bottom: 18px; }
  .banner { display: inline-block; padding: 6px 14px; border: 2px solid; font-weight: bold; font-size: 13pt; margin: 8px 0 14px; }
  .banner.ok { color: #137a3d; border-color: #137a3d; } .banner.warn { color: #9a6a00; border-color: #9a6a00; } .banner.bad { color: #b02424; border-color: #b02424; }
  .mono { font-family: Consolas, monospace; font-size: 8.5pt; word-break: break-all; }
  .lvl-ok { color: #137a3d; } .lvl-warn { color: #9a6a00; } .lvl-err { color: #b02424; font-weight: bold; } .lvl-info { color: #2a5db0; }
  .draft { color: #b02424; border-color: #b02424; } .kind-unsourced { color: #b02424; font-weight: bold; }
  [data-draft-mark] { position: fixed; top: 4px; left: 8px; font-weight: bold; font-size: 9pt; }
  .statement { border: 1.5px solid #234; padding: 6px 10px; margin: 8px 0; }
  .sign td { height: 34px; } .small { font-size: 8.5pt; color: #444; }
  .noprint { position: fixed; top: 8px; right: 8px; } @media print { .noprint { display: none; } }
  `;

  /*
   * state: { meta, design, loadCases, settings }; params/res from the Calc adapter; hash: SHA-256 hex of the inputs.
   * opts: { caseResults: [{name, rpm, dp, oilT, flow, etaV, etaT, hertz, valid}], date, errors, svg }
   */
  function build(state, params, res, hash, opts) {
    opts = opts || {};
    const m = state.meta, p = params, V = G.project.VERSION, F = G.project.FIELDS;
    const activeCase = (state.loadCases || [])[state.activeCase || 0];
    const st = status(res, { caseResults: opts.caseResults, params: p, release: true, activeName: activeCase ? activeCase.name + ' (active)' : 'Active case' });
    const date = opts.date || new Date().toISOString().slice(0, 10);
    const reportId = 'GR-' + (hash || 'nohash').slice(0, 10).toUpperCase() + '-' + date.replace(/-/g, '');
    const cls = st.valid ? (st.warn ? 'warn' : 'ok') : 'bad';
    const h = [];
    h.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(m.project)} - calculation report</title><style>${CSS}</style></head><body>`);
    h.push(`<button class="noprint" onclick="window.print()">Print / save as PDF</button>`);
    if (unsigned(m)) h.push(`<div class="small lvl-err" data-draft-mark="true">DRAFT / UNSIGNED - author or checker missing</div>`);
    // cover
    h.push(`<section class="cover"><h1>Gerotor pump calculation report</h1><div class="sub">${esc(m.project)}</div>`);
    const draft = unsigned(m);
    const AC = opts.criteria || (G.criteria ? G.criteria.evaluate(state.settings && state.settings.acceptanceCriteria, G.criteria.context(state.settings, p, res, opts.caseRuns)) : null);
    h.push(`<div class="banner ${cls}" data-status="${esc(st.text)}">Calculation status: ${esc(st.text)}</div>`);
    if (draft) h.push(`<div class="banner draft" data-draft="true">DRAFT / UNSIGNED</div><p class="lvl-err">${!String(m.author || '').trim() ? 'Author' : ''}${!String(m.author || '').trim() && !String(m.checker || '').trim() ? ' and ' : ''}${!String(m.checker || '').trim() ? 'Checker' : ''} not entered in Project properties: this report is a draft and has not been signed by a responsible person.</p>`);
    if (m.designLabel) h.push(`<p data-design-label="1"><b>Design basis: ${esc(m.designLabel)}.</b> The input values were not derived by this software.</p>`);
    if (!st.valid) h.push(`<div class="banner bad" data-cert="not-for-certification">NOT FOR CERTIFICATION</div><p class="lvl-err">This report is INVALID: ${esc(st.reasons.join('; '))}. Do not use the numbers for release.</p>`);
    h.push(`<h3>Status per load case (worst case governs)</h3><table class="casestatus"><tr><th>Case</th><th>Status</th></tr>` +
      st.cases.map(c => `<tr><td>${esc(c.name)}</td><td class="${rankOf(c.status) === 2 ? 'lvl-err' : rankOf(c.status) === 1 ? 'lvl-warn' : 'lvl-ok'}">${esc(c.status)}</td></tr>`).join('') + `</table>`);
    if (AC) h.push(`<p data-acceptance="${esc(AC.overall.toLowerCase())}"><b>Acceptance criteria: ${esc(AC.overall)}</b> (PASS ${AC.counts.PASS}, FAIL ${AC.counts.FAIL}, NOT EVALUATED ${AC.counts['NOT EVALUATED']}; profile ${esc(AC.profileName)}; see section Acceptance criteria). ${esc(AC.statement)}</p>`);
    else h.push(`<p data-acceptance="not-evaluated"><b>Acceptance criteria: NOT EVALUATED.</b> The criteria module is not loaded; the numbers are calculation results, not a pass/fail verdict.</p>`);
    h.push(`<table class="ident"><tr><th>Project</th><td>${esc(m.project)}</td><th>Report ID</th><td>${esc(reportId)}</td></tr>
      <tr><th>Part number</th><td>${esc(m.partNo)}</td><th>Date</th><td>${esc(date)}</td></tr>
      <tr><th>Revision</th><td>${esc(m.revision)}</td><th>Calculation mode</th><td>${esc(state.calcMode || 'js')}</td></tr>
      <tr><th>Author</th><td>${esc(m.author)}</td><th>Software</th><td>${esc(V.core)} (workspace ${esc(V.app)})</td></tr>
      <tr><th>Checker</th><td>${esc(m.checker)}</td><th>Git commit</th><td>${esc(V.gitHash || 'NOT STAMPED')}</td></tr></table>`);
    const RS = opts.resolved || null;
    h.push(`<h3>Input hash (SHA-256 of canonical design + load cases)</h3><div class="mono" id="inputHash">${esc(hash)}</div>`);
    if (RS && RS.inputHash) h.push(`<p class="small">Resolved-input hash (backend, every value used incl. library rows and numerical settings): <span class="mono" id="resolvedHash">${esc(RS.inputHash)}</span><br>Document hash (file): <span class="mono" id="documentHash">${esc(RS.documentHash)}</span></p>`);
    else h.push(`<p class="small" data-resolved="offline">Document hash only (offline): the resolved-input hash needs the backend.</p>`);
    if (RS && RS.certification) h.push(`<p class="${RS.certification.status === 'NO BLOCKING ITEM FOUND' ? 'lvl-ok' : 'lvl-err'}" data-certification="${esc(RS.certification.status)}"><b>Certification status: ${esc(RS.certification.status)}</b>${(RS.certification.reasons || []).length ? ' - ' + esc(RS.certification.reasons.join('; ')) : ''}<br><span class="small">${esc(RS.certification.note || '')}</span></p>`);
    h.push(`<p class="small">Reproducibility: the same input hash and the same software version give identical numbers.${V.gitHash ? '' : ' The git commit is not stamped in this build, so the report is not fully traceable.'}</p>`);
    if (m.notes) h.push(`<h3>Notes</h3><p>${esc(m.notes).replace(/\n/g, '<br>')}</p>`);
    h.push(`</section>`);

    h.push(`<h2>1 Scope and units</h2>${m.scope ? '<p><b>Scope statement:</b> ' + esc(m.scope).replace(/\n/g, '<br>') + '</p>' : ''}<p>Hydraulic and mechanical design calculation of a trochoidal (classic) gerotor pump: geometry, displacement and flow ripple, port flow and cavitation, internal leakage, Hertz contact, and friction losses at the listed operating points. User units: mm, bar, rpm, cSt, degrees. Internal calculation in SI.</p>`);

    // inputs
    h.push(`<h2>2 Input data</h2>`);
    const groups = [['Geometry', ['N', 'e', 'R', 'rp', 'c', 'Rv', 'RvClear', 'fillet']], ['Body', ['b', 'OD', 'bore']],
      ['Operating point (active)', ['rpm', 'dp']], ['Ports', ['portRo', 'portRi', 'sucStart', 'sucEnd', 'delStart', 'delEnd', 'grooveW', 'grooveD', 'portFillet', 'outletVol']],
      ['Fluid', ['oilT', 'pIn', 'pVap', 'rho', 'bulk', 'Cd', 'nu']], ['Leakage and friction', ['axialClr', 'odClr', 'jbLen', 'jbClr', 'faceMu']],
      ['Material', ['Ein', 'nuIn', 'Eout', 'nuOut']]];
    h.push(`<table class="inputs"><tr><th>Quantity</th><th>Symbol</th><th>Value</th><th>Unit</th><th>Definition</th></tr>`);
    for (const [gt, keys] of groups) {
      h.push(`<tr><th colspan="5">${esc(gt)}</th></tr>`);
      for (const k of keys) {
        if (!(k in state.design)) continue;
        const f = F[k] || ['-', k, ''];
        h.push(`<tr data-key="${esc(k)}"><td>${esc(k)}</td><td>${esc(f[0])}</td><td class="n">${esc(state.design[k])}</td><td class="u">${esc(f[2])}</td><td>${esc(f[1])}</td></tr>`);
      }
    }
    const flags = ['portsOn', 'portRoAuto', 'portRiAuto', 'RvAuto', 'dblIn', 'dblOut', 'shadow', 'leakOn', 'shaftVent', 'tipGapModel', 'oil'];
    h.push(`<tr><th colspan="5">Options</th></tr>`);
    for (const k of flags) if (k in state.design) h.push(`<tr data-key="${esc(k)}"><td>${esc(k)}</td><td></td><td class="n">${esc(state.design[k])}</td><td></td><td></td></tr>`);
    h.push(`</table>`);
    h.push(`<h3>Load cases</h3><table class="cases"><tr><th>#</th><th>Name</th><th>Speed (rpm)</th><th>Δp (bar)</th><th>Oil T (°C)</th><th>Inlet p (bar abs)</th></tr>`);
    state.loadCases.forEach((c, i) => h.push(`<tr><td>${i + 1}</td><td>${esc(c.name)}${i === state.activeCase ? ' (active, used below)' : ''}</td><td class="n">${esc(c.rpm)}</td><td class="n">${esc(c.dp)}</td><td class="n">${esc(c.oilT)}</td><td class="n">${esc(c.pIn)}</td></tr>`));
    h.push(`</table>`);

    // results
    let sec = 3;
    const secs = res && res.A ? rows(p, res) : [];
    for (const s of secs) {
      h.push(`<h2>${sec++} ${esc(s.title)}</h2><table class="results" data-section="${esc(s.id)}"><tr><th>Quantity</th><th>Value</th><th>Unit</th></tr>`);
      for (const [a, b, u] of s.rows) h.push(`<tr><td>${esc(a)}</td><td class="n">${esc(b)}</td><td class="u">${esc(u)}</td></tr>`);
      h.push(`</table>`);
    }
    if (!secs.length) h.push(`<h2>${sec++} Results</h2><p class="lvl-err">No results: the design could not be evaluated.</p>`);
    const ser = series(p, res);
    if (ser.length) {
      h.push(`<h2>${sec++} Cycle statistics (one revolution)</h2><table class="series"><tr><th>Quantity</th><th>Unit</th><th>Min</th><th>Max</th><th>Mean</th></tr>`);
      for (const r of ser) h.push(`<tr><td>${esc(r.name)}</td><td class="u">${esc(r.unit)}</td><td class="n">${fx(r.min, r.d)}</td><td class="n">${fx(r.max, r.d)}</td><td class="n">${fx(r.mean, r.d)}</td></tr>`);
      h.push(`</table>`);
    }
    if (opts.caseResults && opts.caseResults.length) {
      const anyTol = opts.caseResults.some(r => r.tol || r.tolError);
      const iv = (r, k) => r.tol ? `${fx(100 * r.tol[k][0], 1)} … ${fx(100 * r.tol[k][1], 1)}` : esc(r.tolError || '-');
      h.push(`<h2>${sec++} Load case results</h2><table class="caseres"><tr><th>Case</th><th>rpm</th><th>Δp bar</th><th>Flow L/min</th><th>η vol %</th><th>η total %</th>${anyTol ? '<th>η vol % (tolerance)</th><th>η hm % (tolerance)</th><th>η % (tolerance, enclosure)</th>' : ''}<th>Hertz MPa</th><th>Status</th></tr>`);
      for (const r of opts.caseResults) h.push(`<tr><td>${esc(r.name)}</td><td class="n">${esc(r.rpm)}</td><td class="n">${esc(r.dp)}</td><td class="n">${fx(r.flow, 2)}</td><td class="n">${fx(r.etaV, 1)}</td><td class="n">${fx(r.etaT, 1)}</td>${anyTol ? `<td class="n">${iv(r, 'etaV')}</td><td class="n">${iv(r, 'etaM')}</td><td class="n">${iv(r, 'etaT')}</td>` : ''}<td class="n">${fx(r.hertz, 0)}</td><td>${esc(r.status)}</td></tr>`);
      h.push(`</table>`);
      h.push(`<p class="small">η vol = Q_out / Q_th of the chamber network: it includes internal leakage, fluid compressibility and incomplete filling, not leakage alone.</p>`);
      if (anyTol) {
        const t = (opts.caseResults.find(r => r.tol) || {}).tol;
        const ax = t ? Object.entries(t.axes).map(([k, a]) => `${esc(k)} ${a.min}…${a.max} mm (${a.method === 'grid' ? a.levels.length + '-point grid' : 'band ends'})`).join('; ') : '';
        h.push(`<p class="small">Tolerance intervals: ${ax}. Monotone clearances are evaluated at their band ends (exact for a monotone model); the tip clearance c is not monotone for η hm and is evaluated on a grid with parabolic refinement. η is the enclosure [min η vol · min η hm, max η vol · max η hm]. Method and evidence: docs/tolerance.md.</p>`);
      }
    }
    // checks
    h.push(`<h2>${sec++} Checks, warnings and errors</h2>`);
    const checks = (res && res.checks) || [];
    if (!checks.length) h.push(`<p>No checks available.</p>`); else {
      const ord = { err: 0, warn: 1, info: 2, ok: 3 };
      h.push(`<table class="checks"><tr><th>Level</th><th>Check</th><th>Detail</th></tr>`);
      for (const c of checks.slice().sort((a, b) => ord[a.level] - ord[b.level])) h.push(`<tr><td class="lvl-${esc(c.level)}">${esc(String(c.level).toUpperCase())}</td><td>${esc(c.title)}</td><td>${esc(c.detail)}${c.criterion ? ` (<a href="#crit-${esc(c.criterion)}" data-criterion-link="${esc(c.criterion)}">criterion ${esc(c.criterion)}</a>)` : ''}</td></tr>`);
      h.push(`</table>`);
    }
    if (AC) h.push(criteriaSection(AC, sec++));
    const omitted = (opts.omitted || []).concat(opts.backendData ? collectOmitted(opts.backendData) : []);
    if (omitted.length) h.push(`<h3>Omitted bulk data</h3><p class="small" data-omitted="${omitted.length}">The backend left out the following bulk arrays from the report data (they are not truncated results; they are in the full calculation): ${omitted.map(o => esc(o.path + '.' + o.key) + ' (' + esc(o.length) + ' entries' + (o.reason ? ', ' + esc(o.reason) : '') + ')').join('; ')}.</p>`);
    // methods
    const md = G.project.methodsData();
    h.push(`<h2>${sec++} Methods and assumptions</h2>`);
    if (!md) h.push(`<p class="lvl-err">Methods registry not available (no backend and no bundled methods.generated.js): assumptions and sources cannot be listed; the report is INVALID.</p>`);
    else {
      h.push(`<p class="small">Source: ${esc(md.source || 'backend methods registry')}${md.backendGit ? ', backend git ' + esc(md.backendGit) : ''}. Units: user units mm, bar, rpm, cSt, degrees; internal calculation in SI.</p>`);
      h.push(`<h3>Assumptions and active variants</h3><table class="assumptions"><tr><th>ID</th><th>Name</th><th>Active variant</th><th>Statement</th></tr>`);
      for (const a of md.assumptions) {
        const v = variantValue(a, state), nd = a.switch && JSON.stringify(v) !== JSON.stringify(a.default);
        h.push(`<tr data-id="${esc(a.id)}"><td><b>${esc(a.id)}</b></td><td>${esc(a.name)}</td><td>${a.switch ? esc(a.switch + ' = ' + JSON.stringify(v)) + (nd ? ' (non-default)' : ' (default)') : 'fixed'}</td><td>${esc(a.text)}</td></tr>`);
      }
      h.push(`</table><h3>Methods per result module</h3><table class="methods"><tr><th>Module</th><th>Method and equations</th><th>Sources</th><th>Assumptions</th></tr>`);
      for (const mm of md.methods) h.push(`<tr data-method="${esc(mm.id)}"><td><b>${esc(mm.id)}</b></td><td>${esc(mm.method)}<br>${(mm.equations || []).map(e => '<span class="mono">' + esc(e) + '</span>').join('<br>')}</td><td>${(mm.sources || []).map(s => esc(s.ref) + ' ' + kindTag(s.kind) + ': ' + esc(s.use)).join('<br>')}</td><td>${esc((mm.assumptions || []).join(', ') || '-')}</td></tr>`);
      h.push(`</table>`);
    }
    h.push(`<p class="small"><b>Limits:</b> limits and safety factors are not supplied by the software; see section Acceptance criteria for what the user entered. Sources of kind <span class="kind-unsourced">[unsourced]</span> have no documented origin and must be replaced before release. Thermal and elastic deformation are not modelled.</p>`);
    h.push(`<h3>Known open issues of the validation suite</h3><table class="known"><tr><th>ID</th><th>Issue</th><th>Input range</th></tr>` +
      knownIssues(p).map(k => `<tr><td>${esc(k.id)}</td><td>${esc(k.title)}</td><td>${esc(k.state)}</td></tr>`).join('') + `</table>`);
    h.push(`<h2>${sec++} References</h2><ol>`);
    for (const r of referenceList()) h.push(`<li>${esc(r.ref)} ${kindTag(r.kind)}</li>`);
    h.push(`</ol><p class="small">Standards context (owner to confirm the authority): ISO 9001 documented records; ISO/IEC 17025 style stated method and traceability.</p>`);
    h.push(`<h2>${sec++} Software and validation status</h2><table><tr><th>Item</th><th>Value</th></tr>
      <tr><td>Calculation engine</td><td>${esc(V.core)}</td></tr><tr><td>Workspace</td><td>${esc(V.app)}</td></tr>
      <tr><td>Git commit</td><td>${esc(V.gitHash || 'NOT STAMPED (report INVALID)')}</td></tr>
      <tr><td>Input hash</td><td class="mono">${esc(hash)}</td></tr>
      <tr><td>Validation suite</td><td>${esc(opts.validation || 'see frontend/tests/index.html and docs/validation.md; run date not recorded in this build')}</td></tr></table>`);
    // revisions + signoff
    h.push(`<h2>${sec++} Revision history</h2><table><tr><th>Rev</th><th>Date</th><th>Author</th><th>Change</th></tr>`);
    const revs = (m.revisions && m.revisions.length) ? m.revisions : [{ rev: m.revision, date: m.date, author: m.author, note: 'Current revision' }];
    for (const r of revs) h.push(`<tr><td>${esc(r.rev)}</td><td>${esc(r.date)}</td><td>${esc(r.author)}</td><td>${esc(r.description || r.note)}</td></tr>`);
    h.push(`</table><h2>${sec++} Sign-off</h2><table class="sign"><tr><th>Role</th><th>Name</th><th>Date</th><th>Signature</th></tr>
      <tr><td>Author</td><td>${esc(m.author)}</td><td></td><td></td></tr><tr><td>Checker</td><td>${esc(m.checker)}</td><td></td><td></td></tr>
      <tr><td>Approver</td><td>${esc(m.approver || '')}</td><td></td><td></td></tr></table>`);
    h.push(`<p class="small">End of report ${esc(reportId)}.</p></body></html>`);
    return h.join('\n');
  }

  G.report = { build, criteriaSection, collectOmitted, unsigned, rows, series, status, knownIssues, KNOWN_ISSUES, referenceList, esc,
    get METHODS() { return assumptionPairs(); } };
})(window.Gerotor);
