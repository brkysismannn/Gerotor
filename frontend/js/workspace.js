/*
 * Workspace shell: menu bar, toolbar, project tree, document tabs, docks, bottom panels, status bar,
 * project files (open/save/recent/undo), validation, load cases and the calculation report.
 * Sits on top of js/app.js (G.app) and js/project.js (G.project, G.Calc).
 */
(function (G) {
  'use strict';
  const A = G.app, P = G.project, form = A.form;
  const $ = id => document.getElementById(id);
  const LS = (() => { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return localStorage; } catch (_) { return { getItem: () => null, setItem() {}, removeItem() {} }; } })();
  const AUTOSAVE_KEY = 'gerotor.workspace.v1';

  // ------------------------------------------------------------------ project state
  let meta = P.defaultMeta(), cases = P.defaultLoadCases(A.readForm()), active = 0, calcMode = 'js', settings = {};
  let savedStr = '', fileHandle = null, fileLabel = null, applying = false, lastCaseResults = null;
  const hist = new P.History(200);

  function design() { return A.readForm(); }
  function state() { return { meta, design: design(), loadCases: cases, activeCase: active, calcMode, settings }; }
  function snapshot() { return state(); }
  const snapStr = () => JSON.stringify(snapshot());
  const isDirty = () => snapStr() !== savedStr;

  // ------------------------------------------------------------------ messages / status
  const log = [];            // event log {t, level, text}
  let live = [];             // issues from the last calculation {level, src, text}
  function say(text, level) {
    log.unshift({ t: new Date(), level: level || 'info', text });
    if (log.length > 200) log.pop();
    renderMessages();
  }
  function renderMessages() {
    const all = live.concat(log.map(l => ({ level: l.level, src: l.t.toLocaleTimeString(), text: l.text })));
    $('msgList').innerHTML = all.length ? all.map(m => `<li class="${m.level}"><span class="lv">${m.level === 'err' ? 'Error' : m.level === 'warn' ? 'Warning' : 'Message'}</span><span class="src">${esc(m.src)}</span><span>${esc(m.text)}</span></li>`).join('') : '<li class="info"><span class="lv">Message</span><span class="src"></span><span>No messages.</span></li>';
    const nE = live.filter(m => m.level === 'err').length, nW = live.filter(m => m.level === 'warn').length;
    const nM = live.filter(m => m.level === 'info').length + log.length;
    $('stErr').innerHTML = `Errors: <b>${nE}</b>`; $('stWarn').innerHTML = `Warnings: <b>${nW}</b>`; $('stMsg').innerHTML = `Messages: <b>${nM}</b>`;
    $('stErr').classList.toggle('on', nE > 0); $('stWarn').classList.toggle('on', nW > 0);
    $('msgBadge').textContent = String(nE + nW + nM);
    $('msgBadge').className = 'badge' + (nE ? ' err' : nW ? ' warn' : '');
  }
  function esc(s) { return G.report.esc(s); }

  // ------------------------------------------------------------------ tabs, tree, docks
  const TABS = {
    project: ['Project properties', 'Identification, notes, revision history and calculation engine. Stored in the project file and printed on the report cover.'],
    geometry: ['Geometry', 'Rotor geometry: lobes, eccentricity, lobe radius, profile equidistance clearance and rotor body. Design Assist (Calculation menu) finds a geometry from a flow target.'],
    ports: ['Ports', 'Port plate: radii, timing offsets, relief grooves, corner radii and porting type.'],
    fluid: ['Fluid & operating points', 'Oil from the library or from datasheet viscosities (ASTM D341); operating point of the active load case.'],
    cases: ['Load cases', 'List of operating points. Select a row to make it the active case.'],
    leakage: ['Leakage', 'Internal leakage gaps; tip/flank gaps follow from the profile clearance c.'],
    contact: ['Contact', 'Material data for the Hertz contact between the rotors.'],
    friction: ['Friction', 'Viscous and floor friction (Totaro et al. 2025); full-film lubrication assumed. Clearances are diametral.'],
    map: ['Performance map', 'Speed x pressure sweep with charts, Excel and CSV export.'],
    criteria: ['Acceptance criteria', 'Profile, limits, safety factors and material allowables. The software ships NO limit values: every value you enter is recorded as an override with reason, user and time. Final acceptance rests with your certifying authority or customer.'],
    outputs: ['Outputs', 'Drawings (PDF), CAD (STEP AP242, DXF, SVG), point data and the OpenModelica system model.'],
  };
  const openTabs = ['geometry', 'ports', 'fluid'];
  let curTab = 'geometry';
  const TREE = [
    { label: 'Project', tab: 'project', mod: 'project', kids: [
      { label: 'Design', kids: [
        { label: 'Geometry', tab: 'geometry', mod: 'geometry' },
        { label: 'Body', tab: 'geometry', mod: 'body', scroll: 'Body' },
        { label: 'Ports', tab: 'ports', mod: 'ports' },
        { label: 'Fluid & operating points', tab: 'fluid', mod: 'fluid' },
        { label: 'Load cases', tab: 'cases', mod: 'cases' } ] },
      { label: 'Analysis', kids: [
        { label: 'Leakage', tab: 'leakage', mod: 'leakage' },
        { label: 'Contact', tab: 'contact', mod: 'contact' },
        { label: 'Friction', tab: 'friction', mod: 'friction' },
        { label: 'Performance map', tab: 'map', mod: 'map' },
        { label: 'Acceptance criteria', tab: 'criteria', mod: 'criteria' } ] },
      { label: 'Output', kids: [
        { label: 'Calculation report', cmd: 'report', mod: 'report' },
        { label: 'Drawings & CAD', tab: 'outputs', mod: 'cad' },
        { label: 'Modelica export', tab: 'outputs', mod: 'modelica', scroll: 'OpenModelica' } ] } ] },
  ];
  const ICON = { ok: '✓', warn: '▲', err: '✕', na: '○' };
  let modStatus = {};

  function injectTabCss() {
    const st = document.createElement('style');
    st.textContent = Object.keys(TABS).map(k => `body[data-step="${k}"] [data-steps]:not([data-steps~="${k}"]){display:none!important}`).join('\n');
    document.head.appendChild(st);
  }

  function renderTabs() {
    $('tabs').innerHTML = openTabs.map(id => `<button type="button" role="tab" data-tab="${id}" class="${id === curTab ? 'active' : ''}">${esc(TABS[id][0])}<span class="x" data-close="${id}" title="Close tab">×</span></button>`).join('');
    $('stepIntro').textContent = TABS[curTab][1] + (meta.designLabel ? '  [' + meta.designLabel + ']' : '');
  }
  function showTab(id, scroll) {
    if (!TABS[id]) return;
    if (!openTabs.includes(id)) openTabs.push(id);
    curTab = id; document.body.dataset.step = id;
    renderTabs(); renderTree();
    if (id === 'criteria') renderCriteria();
    if (scroll) {
      const lg = [...document.querySelectorAll('.centre legend, .centre h2')].find(l => l.textContent.trim().startsWith(scroll));
      if (lg) lg.scrollIntoView({ block: 'start' });
    } else $('centre').querySelector('.centre-body').scrollTop = 0;
    requestAnimationFrame(() => A.redraw());
  }
  function closeTab(id) {
    const i = openTabs.indexOf(id);
    if (i < 0 || openTabs.length === 1) return;
    openTabs.splice(i, 1);
    if (curTab === id) showTab(openTabs[Math.min(i, openTabs.length - 1)]); else renderTabs();
  }
  $('tabs').addEventListener('click', ev => {
    const c = ev.target.closest('[data-close]');
    if (c) { closeTab(c.dataset.close); return; }
    const b = ev.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab);
  });

  function renderTree() {
    const li = (n, depth) => {
      const st = n.mod ? (modStatus[n.mod] || 'na') : '';
      const head = `<div class="node${n.tab === curTab && n.tab && !n.scroll ? ' sel' : ''}" style="padding-left:${6 + depth * 12}px" ${n.tab ? `data-tab="${n.tab}"` : ''} ${n.scroll ? `data-scroll="${esc(n.scroll)}"` : ''} ${n.cmd ? `data-cmd="${n.cmd}"` : ''} role="treeitem">` +
        `<span class="ico ${st}" title="${st === 'ok' ? 'calculated, no issues' : st === 'warn' ? 'warnings' : st === 'err' ? 'errors' : st === 'na' ? 'not calculated / off' : ''}">${st ? ICON[st] : ''}</span>${esc(n.label)}</div>`;
      return `<li>${head}${n.kids ? `<ul>${n.kids.map(k => li(k, depth + 1)).join('')}</ul>` : ''}</li>`;
    };
    $('tree').innerHTML = TREE.map(n => li(n, 0)).join('');
  }
  $('tree').addEventListener('click', ev => {
    const n = ev.target.closest('.node'); if (!n) return;
    document.body.classList.remove('tree-open');
    if (n.dataset.cmd) run(n.dataset.cmd); else if (n.dataset.tab) showTab(n.dataset.tab, n.dataset.scroll);
  });

  function showDock(name) {
    document.querySelectorAll('#dockTabs button').forEach(b => b.classList.toggle('active', b.dataset.dock === name));
    document.querySelectorAll('.dock-pane').forEach(p => { p.hidden = p.dataset.pane !== name; });
    if (name === 'rotor') requestAnimationFrame(() => A.redraw());
  }
  $('dockTabs').addEventListener('click', ev => { const b = ev.target.closest('[data-dock]'); if (b) showDock(b.dataset.dock); });
  function showBottom(name) {
    document.body.classList.remove('no-bottom');
    document.querySelectorAll('#bottomTabs [data-bt]').forEach(b => b.classList.toggle('active', b.dataset.bt === name));
    document.querySelectorAll('.bt-pane').forEach(p => { p.hidden = p.dataset.btp !== name; });
    requestAnimationFrame(() => A.redraw());
  }
  $('bottomTabs').addEventListener('click', ev => { const b = ev.target.closest('[data-bt]'); if (b) showBottom(b.dataset.bt); });
  $('bottomHide').addEventListener('click', () => { document.body.classList.add('no-bottom'); requestAnimationFrame(() => A.redraw()); });
  $('stErr').addEventListener('click', () => showBottom('msgs'));
  $('stWarn').addEventListener('click', () => showBottom('msgs'));
  $('stMsg').addEventListener('click', () => showBottom('msgs'));

  // ------------------------------------------------------------------ module status, tooltips, validation
  const classify = c => /port|cross|trapped|pressure|cavitation|void|inlet/i.test(c.title) ? 'ports' : /^contact force/i.test(c.title) ? 'contact' : /wall|bore/i.test(c.title) ? 'body' : 'geometry';
  const worst = (list) => list.some(c => c.level === 'err') ? 'err' : list.some(c => c.level === 'warn') ? 'warn' : 'ok';

  function computeStatus(st) {
    const { params, res } = st, ok = !!(res && res.A);
    const by = { geometry: [], body: [], ports: [], contact: [] };
    if (ok) for (const c of res.checks) by[classify(c)].push(c);
    const m = {};
    m.project = ok ? worst(res.checks) : 'err';
    m.geometry = ok ? worst(by.geometry) : 'err';
    m.body = ok ? worst(by.body) : 'err';
    m.ports = !ok ? 'na' : params.portsOn ? worst(by.ports) : 'na';
    m.fluid = ok ? 'ok' : 'na';
    m.cases = lastCaseResults ? (lastCaseResults.some(r => r.status === 'INVALID') ? 'err' : 'ok') : 'na';
    m.leakage = ok && params.leakOn && res.ports && res.ports.leak ? 'ok' : 'na';
    m.contact = ok && res.contact ? worst(by.contact) : 'na';
    m.friction = ok && res.mech ? 'ok' : 'na';
    m.map = $('mapCsv') && !$('mapCsv').disabled ? 'ok' : 'na';
    m.report = ok ? (worst(res.checks) === 'err' ? 'err' : 'ok') : 'na';
    m.cad = ok ? 'ok' : 'na';
    if (ok && G.criteria && G.criteria.catalogue()) { const o = evalCriteria().overall; m.criteria = o === 'FAIL' ? 'err' : o === 'PASS' ? 'ok' : 'warn'; } else m.criteria = 'na';
    m.modelica = 'na';
    return m;
  }

  function addTips() {
    for (const el of form.elements) {
      const f = P.FIELDS[el.name]; if (!f) continue;
      const lab = el.closest('label'); if (!lab || lab.dataset.tip) continue;
      lab.dataset.tip = `${f[0] !== '-' ? f[0] + ': ' : ''}${f[1]}${f[2] && f[2] !== '-' ? ' [' + f[2] + ']' : ''}`;
    }
    const extra = { portsOn: 'Enable the port plate / chamber pressure model', leakOn: 'Include internal leakage in flow and efficiency', shaftVent: 'Shaft bore drains to the inlet', dblIn: 'Inlet port on both faces', dblOut: 'Outlet port on both faces', shadow: 'Shadow ports balance the axial pressure force', RvAuto: 'Compute R_v from tip geometry plus the margin' };
    for (const [k, t] of Object.entries(extra)) { const e = form.elements[k]; const l = e && e.closest('label'); if (l && !l.dataset.tip) l.dataset.tip = t; }
  }

  const fmsg = new WeakMap();
  function setFieldMsg(el, level, text) {
    el.classList.toggle('invalid', level === 'err'); el.classList.toggle('warned', level === 'warn');
    let span = fmsg.get(el);
    if (!text) { if (span) span.remove(); fmsg.delete(el); return; }
    if (!span) { span = document.createElement('span'); span.className = 'fmsg'; fmsg.set(el, span); (el.closest('label') || el.parentNode).appendChild(span); }
    span.className = 'fmsg ' + level; span.textContent = text;
  }
  const NAMES = {};
  function labelOf(el) { if (NAMES[el.name]) return NAMES[el.name]; const l = el.closest('label'); const t = l ? l.firstChild && l.textContent.replace(/\s+/g, ' ').split(/mm|bar|rpm|°|cSt|GPa|kg|MPa|cm³/)[0].trim() : el.name; return (NAMES[el.name] = t || el.name); }

  function validate(st) {
    const issues = [];
    const add = (el, level, text) => { setFieldMsg(el, level, text); if (level) issues.push({ level, src: 'Input', text: `${labelOf(el)}: ${text}` }); };
    for (const el of form.elements) {
      if (!el.hasAttribute('data-num') || el.disabled) { if (el.hasAttribute('data-num')) setFieldMsg(el, null); continue; }
      const v = G.num.parse(el.value), mn = el.min !== '' ? +el.min : -Infinity, mx = el.max !== '' ? +el.max : Infinity;
      if (el.value.trim() === '' || !Number.isFinite(v)) add(el, 'err', 'enter a number');
      else if (v < mn) add(el, 'err', `must be >= ${mn}`);
      else if (v > mx) add(el, 'err', `must be <= ${mx}`);
      else setFieldMsg(el, null);
    }
    const { params: p, res } = st;
    if (p && res && res.A) {
      const mark = (name, level, text) => { const el = form.elements[name]; if (el && !el.classList.contains('invalid')) add(el, level, text); };
      if (!p.RvAuto && p.Rv < p.RvMin) mark('Rv', 'err', `must be >= ${p.RvMin.toFixed(2)} (R + 2e - rp)`);
      if (p.OD <= 2 * p.Rv) mark('OD', 'err', `must exceed 2 R_v = ${(2 * p.Rv).toFixed(2)}`);
      if (p.bore / 2 >= p.innerRoot) mark('bore', 'err', `must be < inner root diameter ${(2 * p.innerRoot).toFixed(2)}`);
      if (p.rp + p.c >= res.rhoMin) mark('rp', 'err', `r_p + c must be < rho_min = ${res.rhoMin.toFixed(2)} (undercut)`);
      if (p.c > 0 && p.c > 0.25 * p.e) mark('c', 'warn', 'c is large relative to e; check the gap model');
    }
    return issues;
  }

  // ------------------------------------------------------------------ results grid and load cases
  const fn = (x, d) => Number.isFinite(x) ? x.toFixed(d) : '-';
  function renderGrid(st) {
    const rows = G.report.series(st.params, st.res);
    $('resGrid').innerHTML = rows.length ? `<thead><tr><th>Quantity (one revolution, active case)</th><th>Unit</th><th>Min</th><th>Max</th><th>Mean</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.unit)}</td><td class="n">${fn(r.min, r.d)}</td><td class="n">${fn(r.max, r.d)}</td><td class="n">${fn(r.mean, r.d)}</td></tr>`).join('') + '</tbody>'
      : '<tbody><tr><td>No results: the design is not valid.</td></tr></tbody>';
  }
  function renderCaseList() {
    $('caseList').innerHTML = '<thead><tr><th>#</th><th>Name</th><th>rpm</th><th>Δp bar</th><th>Oil T °C</th><th>p_in bar abs</th></tr></thead><tbody>' +
      cases.map((c, i) => `<tr data-i="${i}" class="${i === active ? 'sel' : ''}"><td>${i + 1}</td><td><input data-f="name" value="${esc(c.name)}"></td>` +
        ['rpm', 'dp', 'oilT', 'pIn'].map(k => `<td><input data-f="${k}" type="text" inputmode="decimal" data-num step="any" value="${esc(c[k])}"></td>`).join('') + '</tr>').join('') + '</tbody>';
  }
  $('caseList').addEventListener('click', ev => {
    const tr = ev.target.closest('tr[data-i]'); if (!tr || +tr.dataset.i === active) return;
    selectCase(+tr.dataset.i);
  });
  $('caseList').addEventListener('change', ev => {
    const inp = ev.target, tr = inp.closest('tr[data-i]'); if (!tr) return;
    const i = +tr.dataset.i, k = inp.dataset.f;
    cases[i][k] = k === 'name' ? inp.value : G.num.parse(inp.value);
    if (i === active && k !== 'name' && Number.isFinite(cases[i][k])) { form.elements[k].value = cases[i][k]; A.scheduleRecompute(); }
    lastCaseResults = null; touch('case' + i + k);
  });
  function selectCase(i) {
    active = i;
    const c = cases[i];
    for (const k of ['rpm', 'dp', 'oilT', 'pIn']) if (Number.isFinite(c[k])) form.elements[k].value = c[k];
    renderCaseList(); A.recompute(); touch();
  }
  function caseRaw(c) {
    const raw = design();
    for (const k of ['rpm', 'dp', 'oilT', 'pIn']) raw[k] = c[k];
    if (Number.isFinite(c.nu) && c.nu > 0) raw.nu = c.nu;           // op-point viscosity overrides the oil model
    else if (raw.oil !== 'custom') {
      const oil = raw.oil === 'user' ? G.userOil(raw, raw.oilT) : G.oilProperties(raw.oil, raw.oilT);
      if (oil && Number.isFinite(oil.nu) && oil.nu > 0) { raw.nu = oil.nu; raw.rho = oil.rho; }
    }
    return raw;
  }
  function calcCases() {
    const out = [];
    for (const c of cases) {
      let r;
      try {
        const o = G.Calc.run(caseRaw(c)), res = o.res, pr = res.ports, ok = !!res.A;
        const stt = G.report.status(res, { params: o.params });
        r = { name: c.name, rpm: c.rpm, dp: c.dp, oilT: c.oilT, status: stt.text, run: { name: c.name, rpm: c.rpm, params: o.params, res },
          flow: ok ? (pr && pr.sim ? pr.flowLpm : res.flowLpm) : NaN, etaV: ok && pr && pr.sim ? pr.portEfficiency * 100 : NaN,
          etaT: ok && res.mech ? res.mech.etaT * 100 : NaN, hertz: ok && res.contact ? res.contact.pmaxMax / 1e6 : NaN,
          torque: ok && res.mech ? res.mech.Mshaft : NaN, power: ok && res.mech ? res.mech.powerIn / 1000 : NaN };
      } catch (e) { r = { name: c.name, rpm: c.rpm, dp: c.dp, oilT: c.oilT, status: 'INVALID', flow: NaN, etaV: NaN, etaT: NaN, hertz: NaN, torque: NaN, power: NaN, error: e.message, run: { name: c.name, rpm: c.rpm, params: null, res: null } }; }
      out.push(r);
    }
    return out;
  }
  function renderCaseResults() {
    const r = lastCaseResults;
    $('caseResGrid').innerHTML = r ? '<thead><tr><th>Case</th><th>rpm</th><th>Δp bar</th><th>Oil T °C</th><th>Flow L/min</th><th>η vol %</th><th>η total %</th><th>Shaft torque N·m</th><th>Input kW</th><th>Hertz MPa</th><th>Status</th></tr></thead><tbody>' +
      r.map(x => `<tr class="${x.status === 'INVALID' ? 'bad' : ''}"><td>${esc(x.name)}</td><td class="n">${esc(x.rpm)}</td><td class="n">${esc(x.dp)}</td><td class="n">${esc(x.oilT)}</td><td class="n">${fn(x.flow, 2)}</td><td class="n">${fn(x.etaV, 1)}</td><td class="n">${fn(x.etaT, 1)}</td><td class="n">${fn(x.torque, 2)}</td><td class="n">${fn(x.power, 3)}</td><td class="n">${fn(x.hertz, 0)}</td><td>${esc(x.status)}</td></tr>`).join('') + '</tbody>'
      : '<tbody><tr><td>Not calculated. Use Calculation > Calculate all load cases.</td></tr></tbody>';
  }
  function runCases() {
    lastCaseResults = calcCases(); renderCaseResults(); showBottom('cases'); refreshStatus(A.getState());
    say(`Calculated ${cases.length} load case${cases.length > 1 ? 's' : ''}.`);
  }

  // ------------------------------------------------------------------ meta form
  const metaForm = $('metaForm');
  function syncMetaForm() {
    for (const k of ['project', 'partNo', 'revision', 'author', 'checker', 'approver', 'date', 'notes', 'scope', 'designLabel']) metaForm.elements[k].value = meta[k] || '';
    metaForm.elements.calcMode.value = calcMode;
    $('revList').innerHTML = (meta.revisions || []).map(r => `<li><b>${esc(r.rev)}</b> ${esc(r.date)} ${esc(r.author)} - ${esc(r.description)}</li>`).join('');
  }
  metaForm.addEventListener('input', ev => {
    const el = ev.target, k = el.name;
    if (k in meta && k !== 'revisions') meta[k] = el.value;
    if (k === 'designLabel') renderTabs();
    if (k === 'calcMode') { calcMode = el.value; G.Calc.setMode(el.value); }
    touch('meta' + k);
  });
  $('revAdd').addEventListener('click', () => {
    const rev = metaForm.elements.revNew.value || meta.revision, note = metaForm.elements.revNote.value;
    if (!note) { say('Enter a change description for the revision entry.', 'warn'); return; }
    meta.revisions.push({ rev, date: new Date().toISOString().slice(0, 10), author: meta.author, description: note });
    metaForm.elements.revNote.value = ''; syncMetaForm(); touch();
  });

  // ------------------------------------------------------------------ change tracking
  let autoTimer = 0;
  function touch(key) {
    if (applying) return;
    hist.push(snapshot(), key);
    updateChrome();
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { try { LS.setItem(AUTOSAVE_KEY, P.serialize(state())); } catch (_) { /* quota */ } }, 400);
  }
  function updateChrome() {
    const d = isDirty();
    document.title = `${d ? '* ' : ''}${meta.project || 'Untitled'} - Gerotor Workspace`;
    $('stDirty').textContent = d ? 'Modified (unsaved)' : 'Saved';
    $('stDirty').classList.toggle('on', d);
    $('stCase').textContent = `Case ${active + 1}/${cases.length}: ${cases[active] ? cases[active].name : ''}`;
    $('stMode').textContent = `Engine: ${G.Calc.mode}`;
    const t = $('titleName'); if (t) t.textContent = `${d ? '* ' : ''}${meta.project || 'Untitled'}${meta.revision ? '  rev ' + meta.revision : ''}${fileLabel ? '  (' + fileLabel + ')' : ''}${meta.designLabel ? '  - ' + meta.designLabel : ''}`;
    for (const [id, can] of [['undo', hist.canUndo()], ['redo', hist.canRedo()]]) document.querySelectorAll(`[data-cmd="${id}"]`).forEach(b => b.classList.toggle('disabled', !can));
  }
  form.addEventListener('change', ev => {          // commit (Enter / blur / select), not every keystroke
    const k = ev.target.name;
    if (['rpm', 'dp', 'oilT', 'pIn'].includes(k) && cases[active]) {
      const v = G.num.parse(ev.target.value); if (Number.isFinite(v)) { cases[active][k] = v; lastCaseResults = null; renderCaseList(); }
    }
    setTimeout(() => touch('f' + k), 40);
  });

  function refreshStatus(st) {
    if (!st.res) return;
    lastEval = null;
    modStatus = computeStatus(st);
    renderTree();
    renderGrid(st);
    if (curTab === 'criteria' && !$('critRoot').contains(document.activeElement)) renderCriteria();
    live = [];
    const ok = !!(st.res && st.res.A);
    if (ok) for (const c of st.res.checks) if (c.level !== 'ok') live.push({ level: c.level, src: 'Check', text: `${c.title}: ${c.detail}` });
    live = validate(st).concat(live);
    renderMessages();
    $('stCalc').textContent = `Calculated in ${st.calcMs.toFixed(0)} ms`;
    updateChrome();
  }
  A.onChange((ev, st) => { if (ev === 'compute') refreshStatus(st); });

  // ------------------------------------------------------------------ apply / new / open / save
  function applyProject(st, label) {
    applying = true;
    meta = st.meta; cases = st.loadCases; active = st.activeCase; calcMode = st.calcMode; settings = st.settings;
    if (!G.Calc.setMode(calcMode)) calcMode = G.Calc.mode;
    const c = cases[active] || {};
    A.setDesign(Object.assign({}, st.design, ['rpm', 'dp', 'oilT', 'pIn'].reduce((o, k) => (Number.isFinite(c[k]) && (o[k] = c[k]), o), {})));
    syncMetaForm(); renderCaseList(); lastCaseResults = null; renderCaseResults(); lastEval = null;
    savedStr = snapStr(); hist.reset(savedStr); fileLabel = label || null;
    applying = false;
    refreshStatus(A.getState());
  }
  function confirmDiscard() { return !isDirty() || confirm('Discard unsaved changes?'); }

  function newProject() {
    if (!confirmDiscard()) return;
    fileHandle = null;
    applyProject(P.create(A.DEFAULTS));
    say('New project created.');
  }

  function openText(text, label) {
    try {
      const st = P.parse(text, A.DEFAULTS, A.migrate);
      fileLabel = label;
      applyProject(st, label);
      LS.setItem(AUTOSAVE_KEY, P.serialize(state()));
      P.recentAdd(LS, label || meta.project, P.serialize(state()));
      say(`Opened ${label || 'project'}.`);
    } catch (e) { say('Could not open the file: ' + e.message, 'err'); alert('Could not open the file:\n' + e.message); }
  }
  async function openFile() {
    if (!confirmDiscard()) return;
    if (window.showOpenFilePicker) {
      try {
        const [h] = await window.showOpenFilePicker({ types: [{ description: 'Gerotor project', accept: { 'application/json': ['.json'] } }] });
        const f = await h.getFile(); fileHandle = h; openText(await f.text(), f.name); return;
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    $('openInput').value = ''; $('openInput').click();
  }
  $('openInput').addEventListener('change', ev => {
    const f = ev.target.files[0]; if (!f) return;
    fileHandle = null; f.text().then(t => openText(t, f.name));
  });

  async function save(as) {
    const text = P.serialize(state()), name = P.fileName(meta);
    try {
      if (window.showSaveFilePicker && (as || !fileHandle)) {
        fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Gerotor project', accept: { 'application/json': ['.json'] } }] });
      }
      if (fileHandle && fileHandle.createWritable) {
        const w = await fileHandle.createWritable(); await w.write(text); await w.close(); fileLabel = fileHandle.name;
      } else { G.exporters.download(name, text, 'application/json'); fileLabel = name; }
    } catch (e) { if (e && e.name === 'AbortError') return; say('Save failed: ' + e.message, 'err'); return; }
    savedStr = snapStr(); P.recentAdd(LS, fileLabel, text); updateChrome(); say(`Saved ${fileLabel}.`);
  }

  function recentItems() { return P.recentList(LS).map(r => ({ label: `${r.name}  (${(r.savedAt || '').slice(0, 16).replace('T', ' ')})`, run() { if (confirmDiscard()) openText(r.text, r.name); } })); }

  // ------------------------------------------------------------------ undo / redo
  function restore(snap) {
    if (!snap) return;
    applying = true;
    meta = snap.meta; cases = snap.loadCases; active = snap.activeCase; calcMode = snap.calcMode; settings = snap.settings;
    A.setDesign(snap.design); syncMetaForm(); renderCaseList(); lastEval = null;
    applying = false; updateChrome(); refreshStatus(A.getState());
  }
  function undo() { const s = hist.undo(); if (s) { restore(s); hist.setCur(snapStr()); updateChrome(); } }
  function redo() { const s = hist.redo(); if (s) { restore(s); hist.setCur(snapStr()); updateChrome(); } }

  // ------------------------------------------------------------------ report
  async function buildReport() {
    const st = A.getState();
    const s = state();
    const hash = await P.inputHash(s);
    const resolved = await P.fetchResolved(s);
    setResolvedStatus(resolved);
    const cr = cases.length > 1 || lastCaseResults ? (lastCaseResults || (lastCaseResults = calcCases())) : null;   // all cases always evaluated for the status
    if (cr) renderCaseResults();
    const runs = cr ? cr.filter(r => r.run).map(r => r.run) : [];
    return { html: G.report.build(s, st.params, st.res, hash, { resolved, caseResults: cr, caseRuns: runs.length ? runs : (st.res && cases[active] ? [{ name: cases[active].name, rpm: cases[active].rpm, params: st.params, res: st.res }] : []) }), hash };
  }
  function setResolvedStatus(r) {
    const el = $('stHash'); if (!el) return;
    el.textContent = r ? `Resolved ${r.inputHash.slice(0, 10)} · ${r.certification ? r.certification.status : '-'}` : 'Document hash only (offline)';
    el.title = r ? `resolved ${r.inputHash}
document ${r.documentHash}` : 'The resolved-input hash and certification status need the backend';
    el.classList.toggle('on', !!(r && r.certification && r.certification.status !== 'NO BLOCKING ITEM FOUND'));
  }
  async function reportPrint() {
    const st = A.getState();
    if (!st.res || !st.res.A) { say('Report: the design is not valid; the report will be marked INVALID.', 'warn'); }
    const { html, hash } = await buildReport();
    const w = window.open('', '_blank');
    if (!w) { G.exporters.download(P.fileName(meta).replace(P.EXT, '_report.html'), html, 'text/html'); say('Pop-up blocked: report downloaded as HTML; open it and print to PDF.', 'warn'); return; }
    w.document.open(); w.document.write(html); w.document.close();
    say(`Report generated (input hash ${hash.slice(0, 12)}...).`);
    setTimeout(() => { try { w.focus(); w.print(); } catch (_) { /* user prints manually */ } }, 500);
  }
  async function reportDownload() {
    const { html } = await buildReport();
    G.exporters.download(P.fileName(meta).replace(P.EXT, '_report.html'), html, 'text/html'); say('Report downloaded (HTML, print to PDF).');
  }
  function resultsCsv() {
    const st = A.getState(), rows = G.report.series(st.params, st.res);
    const csv = 'quantity,unit,min,max,mean\n' + rows.map(r => `"${r.name}",${r.unit},${r.min},${r.max},${r.mean}`).join('\n') + '\n';
    G.exporters.download(P.fileName(meta).replace(P.EXT, '_results.csv'), csv, 'text/csv');
  }

  // ------------------------------------------------------------------ calculate
  function calculate() {
    A.recompute();
    lastCaseResults = calcCases(); renderCaseResults();
    refreshStatus(A.getState());
    P.fetchResolved(state()).then(setResolvedStatus);
    const st = G.report.status(A.getState().res, { caseResults: lastCaseResults, params: A.getState().params });
    say(`Calculation complete: ${st.text}${st.reasons.length ? ' (' + st.reasons.join('; ') + ')' : ''}.`, st.valid ? 'info' : 'err');
  }

  // ------------------------------------------------------------------ theme
  function setTheme(t) { document.documentElement.dataset.theme = t; LS.setItem('gerotor.theme', t); A.redraw(); }
  const theme = () => document.documentElement.dataset.theme;

  // ------------------------------------------------------------------ commands, menus, toolbar
  const dlg = $('metaDlg');
  function info(title, html) { $('metaDlgTitle').textContent = title; $('metaDlgBody').innerHTML = html; dlg.showModal(); }
  $('metaDlgClose').addEventListener('click', () => dlg.close());

  const SHORTCUTS = [['Ctrl+S', 'Save'], ['Ctrl+Shift+S', 'Save as'], ['Ctrl+O', 'Open'], ['F5', 'Calculate'], ['Ctrl+P', 'Calculation report (print / PDF)'], ['Ctrl+Z', 'Undo'], ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'], ['F1', 'Help'], ['Esc', 'Close menu / dialog']];
  const CMD = {
    new: newProject, open: openFile, save: () => save(false), saveAs: () => save(true),
    undo, redo, reset: () => { A.reset(); touch('reset'); say('Inputs reset to defaults.'); },
    calc: calculate, calcCases: runCases, assist: () => $('assistOpen').click(),
    maxspeed: () => { showTab('map'); $('maxRun').click(); },
    report: reportPrint, reportDl: reportDownload, resultsCsv,
    props: () => showTab('project'),
    mode: () => showTab('project'),
    toggleTree: () => { if (window.matchMedia('(max-width: 1000px)').matches) document.body.classList.toggle('tree-open'); else document.body.classList.toggle('no-tree'); requestAnimationFrame(() => A.redraw()); },
    toggleBottom: () => { document.body.classList.toggle('no-bottom'); requestAnimationFrame(() => A.redraw()); },
    dockRotor: () => showDock('rotor'), dockResults: () => showDock('results'), dockChecks: () => showDock('checks'),
    themeLight: () => setTheme('light'), themeDark: () => setTheme('dark'),
    shortcuts: () => info('Keyboard shortcuts', '<table class="grid-table">' + SHORTCUTS.map(([k, t]) => `<tr><td><kbd>${k}</kbd></td><td>${t}</td></tr>`).join('') + '</table>'),
    symbols: () => info('Quantities and symbols', '<table class="grid-table"><tr><th>Key</th><th>Symbol</th><th>Definition</th><th>Unit</th></tr>' + Object.entries(P.FIELDS).map(([k, f]) => `<tr><td>${k}</td><td>${esc(f[0])}</td><td>${esc(f[1])}</td><td>${esc(f[2])}</td></tr>`).join('') + '</table>'),
    about: () => info('About', `<p><b>Gerotor Workspace</b> ${P.VERSION.app}<br>Engine: ${P.VERSION.core}<br>Calculation modes available: ${G.Calc.available().join(', ')}.<br>Runs from file:// or a local server; no data leaves the browser.</p>`),
    help: () => CMD.shortcuts(),
  };
  const MENUS = [
    ['File', [['New', 'new'], ['Open...', 'open', 'Ctrl+O'], ['Open recent', 'recent'], '-', ['Save', 'save', 'Ctrl+S'], ['Save as...', 'saveAs', 'Ctrl+Shift+S'], '-', ['Project properties', 'props']]],
    ['Edit', [['Undo', 'undo', 'Ctrl+Z'], ['Redo', 'redo', 'Ctrl+Y'], '-', ['Reset inputs to defaults', 'reset']]],
    ['Calculation', [['Calculate', 'calc', 'F5'], ['Calculate all load cases', 'calcCases'], '-', ['Design Assist...', 'assist'], ['Maximum speed (filling limit)', 'maxspeed'], ['Calculation engine...', 'mode']]],
    ['Report', [['Calculation report (print / PDF)', 'report', 'Ctrl+P'], ['Download report as HTML', 'reportDl'], ['Results grid as CSV', 'resultsCsv']]],
    ['View', [['Project tree', 'toggleTree'], ['Bottom panel', 'toggleBottom'], '-', ['Rotor view', 'dockRotor'], ['Results', 'dockResults'], ['Checks', 'dockChecks'], '-', ['Light theme', 'themeLight'], ['Dark theme', 'themeDark']]],
    ['Help', [['Keyboard shortcuts', 'shortcuts', 'F1'], ['Quantities and symbols', 'symbols'], ['About', 'about']]],
  ];
  const IC = { new: 'M6 3h8l4 4v14H6zM14 3v4h4', open: 'M3 7h6l2 2h10v10H3z', save: 'M4 4h13l3 3v13H4zM8 4v5h8V4M8 20v-6h8v6', saveAs: 'M4 4h13l3 3v6M4 4v16h9M8 4v5h8V4M17 15v6M14 18h6',
    undo: 'M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 8', redo: 'M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 8', calc: 'M5 3h14v18H5zM8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2', report: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3', assist: 'M12 3a6 6 0 0 0-4 10v3h8v-3a6 6 0 0 0-4-10zM9 20h6', toggleTree: 'M4 5h16M4 12h16M4 19h16' };
  const icon = n => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${IC[n]}"/></svg>`;
  const TOOLS = [['new', 'New', 'New'], ['open', 'Open', 'Open (Ctrl+O)'], ['save', 'Save', 'Save (Ctrl+S)'], ['saveAs', 'Save as', 'Save as (Ctrl+Shift+S)'], '|', ['undo', 'Undo', 'Undo (Ctrl+Z)'], ['redo', 'Redo', 'Redo (Ctrl+Y)'], '|', ['calc', 'Calculate', 'Calculate (F5)'], ['report', 'Report', 'Calculation report (Ctrl+P)'], ['assist', 'Assist', 'Design Assist'], '|', ['toggleTree', 'Tree', 'Show / hide the project tree']];
  function renderBars() {
    $('menubar').innerHTML = MENUS.map(([t], i) => `<button type="button" class="mi" data-menu="${i}" role="menuitem">${t}</button>`).join('') + '<span class="titlename" id="titleName"></span>';
    $('toolbar').innerHTML = TOOLS.map(t => t === '|' ? '<span class="sep"></span>' : `<button type="button" class="tb ${t[0] === 'calc' ? 'accent' : ''}" data-cmd="${t[0]}" title="${t[2]}">${icon(t[0])}<span>${t[1]}</span></button>`).join('') +
      '<span class="sp"></span><span class="tb-info" id="tbInfo"></span>';
  }
  let openMenu = null, popup = null;
  function closeMenu() { if (popup) popup.remove(); popup = null; document.querySelectorAll('.mi.open').forEach(b => b.classList.remove('open')); openMenu = null; }
  function showMenu(i) {
    closeMenu(); openMenu = i;
    const btn = document.querySelector(`.mi[data-menu="${i}"]`); btn.classList.add('open');
    popup = document.createElement('div'); popup.className = 'menu-pop'; popup.setAttribute('role', 'menu');
    const r = btn.getBoundingClientRect(); popup.style.left = r.left + 'px'; popup.style.top = r.bottom + 'px';
    popup.innerHTML = MENUS[i][1].map(it => {
      if (it === '-') return '<div class="msep"></div>';
      if (it[1] === 'recent') {
        const rec = recentItems();
        return `<div class="mrow sub"><span>${it[0]} &#9656;</span><div class="submenu">${rec.length ? rec.map((x, j) => `<div class="mrow" data-recent="${j}">${esc(x.label)}</div>`).join('') : '<div class="mrow disabled">(none)</div>'}</div></div>`;
      }
      const dis = (it[1] === 'undo' && !hist.canUndo()) || (it[1] === 'redo' && !hist.canRedo());
      return `<div class="mrow${dis ? ' disabled' : ''}" data-cmd="${it[1]}"><span>${it[0]}</span><kbd>${it[2] || ''}</kbd></div>`;
    }).join('');
    document.body.appendChild(popup);
    popup._recent = recentItems();
  }
  document.addEventListener('click', ev => {
    const mi = ev.target.closest('.mi');
    if (mi) { const i = +mi.dataset.menu; if (openMenu === i) closeMenu(); else showMenu(i); return; }
    const rc = ev.target.closest('[data-recent]');
    if (rc && popup) { const it = popup._recent[+rc.dataset.recent]; closeMenu(); it.run(); return; }
    const c = ev.target.closest('[data-cmd]');
    if (c && !c.classList.contains('disabled') && CMD[c.dataset.cmd] && (c.closest('.menu-pop') || c.closest('#toolbar'))) { closeMenu(); run(c.dataset.cmd); return; }
    if (!ev.target.closest('.menu-pop')) closeMenu();
  });
  document.addEventListener('mouseover', ev => { const mi = ev.target.closest('.mi'); if (mi && openMenu !== null && +mi.dataset.menu !== openMenu) showMenu(+mi.dataset.menu); });
  function run(name) { try { const r = CMD[name](); if (r && r.catch) r.catch(e => say(String(e.message || e), 'err')); } catch (e) { say(String(e.message || e), 'err'); console.error(e); } }

  document.addEventListener('keydown', ev => {
    const k = ev.key.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'Escape') { closeMenu(); return; }
    const inText = ev.target.matches && ev.target.matches('textarea, input[type=text], input[type=date], input[data-num]');
    if (ev.key === 'F5') { ev.preventDefault(); run('calc'); }
    else if (ev.key === 'F1') { ev.preventDefault(); run('help'); }
    else if (ctrl && k === 's') { ev.preventDefault(); run(ev.shiftKey ? 'saveAs' : 'save'); }
    else if (ctrl && k === 'o') { ev.preventDefault(); run('open'); }
    else if (ctrl && k === 'p') { ev.preventDefault(); run('report'); }
    else if (ctrl && k === 'z' && !inText) { ev.preventDefault(); run(ev.shiftKey ? 'redo' : 'undo'); }
    else if (ctrl && k === 'y' && !inText) { ev.preventDefault(); run('redo'); }
  });
  window.addEventListener('beforeunload', ev => { if (isDirty()) { ev.preventDefault(); ev.returnValue = ''; } });

  $('caseAdd').addEventListener('click', () => { cases.push(Object.assign({}, cases[active], { name: 'Case ' + (cases.length + 1) })); lastCaseResults = null; renderCaseList(); touch('caseadd'); });
  $('caseDup').addEventListener('click', () => { cases.splice(active + 1, 0, Object.assign({}, cases[active], { name: cases[active].name + ' copy' })); lastCaseResults = null; renderCaseList(); touch('casedup'); });
  $('caseDel').addEventListener('click', () => {
    if (cases.length < 2) { say('At least one load case is required.', 'warn'); return; }
    cases.splice(active, 1); active = Math.min(active, cases.length - 1); lastCaseResults = null; selectCase(active);
  });
  $('caseRun').addEventListener('click', runCases);

  // ------------------------------------------------------------------ acceptance criteria (tab "criteria")
  // Profiles are templates with EMPTY limits. Every value typed here becomes an Override record
  // {target, id, field, value, unit, reason, user, timestamp}; the reason is mandatory. Templates are never edited.
  const CR = () => G.criteria;
  const acNow = () => settings.acceptanceCriteria || CR().defaultAC();
  function setAC(next, key) {
    if (CR().isDefault(next)) delete settings.acceptanceCriteria; else settings.acceptanceCriteria = next;
    touch(key || 'ac'); lastEval = null; renderCriteria(); refreshModStatus();
  }
  let lastEval = null;
  function critCtx() {
    const st = A.getState();
    const runs = lastCaseResults ? lastCaseResults.filter(r => r.run).map(r => r.run)
      : (st.res && cases[active] ? [{ name: cases[active].name, rpm: cases[active].rpm, params: st.params, res: st.res }] : []);
    return CR().context(settings, st.params, st.res, runs);
  }
  function evalCriteria() {
    if (!lastEval) lastEval = CR().evaluate(acNow(), critCtx());
    return lastEval;
  }
  function refreshModStatus() {
    const st = A.getState(); if (!st.res) return;
    modStatus = computeStatus(st); renderTree();
  }
  const fmtv = x => (typeof x === 'number' && Number.isFinite(x) ? String(+x.toPrecision(5)) : '');
  function critLimitCell(r) {
    if (r.comparison === 'true') return '<span class="note">predicate</span>';
    if (r.limit && typeof r.limit === 'object' && 'fromMaterial' in r.limit) return `<span class="note">material ${esc(r.limit.fromMaterial)}</span>`;
    if (r.comparison === 'range') { const l = r.limit && typeof r.limit === 'object' ? r.limit : {}; return `<input data-f="min" type="text" inputmode="decimal" data-num step="any" placeholder="min" value="${esc(fmtv(l.min))}"> <input data-f="max" type="text" inputmode="decimal" data-num step="any" placeholder="max" value="${esc(fmtv(l.max))}">`; }
    return `<input data-f="limit" type="text" inputmode="decimal" data-num step="any" placeholder="empty" value="${esc(fmtv(r.limit))}">`;
  }
  function renderCriteria() {
    const root = $('critRoot'); if (!root) return;
    const C = CR(), cat = C.catalogue();
    if (!cat) { root.innerHTML = '<p class="note">The criteria catalogue is not loaded (js/criteria.generated.js).</p>'; return; }
    const ac = acNow(), ev = C.evaluate(ac, critCtx()); lastEval = ev;
    const au = ac.authority || {};
    const sel = (name, val, opts) => `<select name="${name}">${opts.map(([v, t]) => `<option value="${esc(v)}"${v === (val || '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const matOpts = [['', '(none)']].concat(cat.materials.map(m => [m.id, m.name]));
    const cls = ev.overall === 'FAIL' ? 'lvl-err' : ev.overall === 'PASS' ? 'lvl-ok' : 'lvl-warn';
    let h = `<p class="note">${esc(C.statement())}</p>`;
    h += `<div class="grid2"><label>Profile ${sel('profile', ac.activeProfileId, cat.profiles.map(p => [p.id, p.name]))}</label>` +
      `<label>Authority / customer <input name="authName" type="text" value="${esc(au.name || '')}" placeholder="society, customer ..."></label>` +
      `<label>Rule document <input name="authDoc" type="text" value="${esc(au.document || '')}"></label>` +
      `<label>Edition <input name="authEd" type="text" value="${esc(au.edition || '')}"></label>` +
      `<label>Inner rotor material ${sel('matInner', (ac.materials || {}).inner, matOpts)}</label>` +
      `<label>Outer rotor material ${sel('matOuter', (ac.materials || {}).outer, matOpts)}</label></div>`;
    const prof = cat.profiles.find(p => p.id === ac.activeProfileId);
    h += `<p class="note">${esc(prof ? prof.description + ' ' + prof.authorityNote : '')} Template version ${esc(cat.profileSetVersion)}; ${esc(prof ? prof.source.label : '')}.</p>`;
    h += `<p><b class="${cls}" id="critOverall" data-overall="${esc(ev.overall)}">Overall: ${esc(ev.overall)}</b> &nbsp; PASS ${ev.counts.PASS}, FAIL ${ev.counts.FAIL}, NOT EVALUATED ${ev.counts['NOT EVALUATED']}, disabled ${ev.counts.disabled}. ` +
      `<span class="note">${lastCaseResults ? 'All calculated load cases.' : 'Active load case only (use Calculate all load cases for every case).'}</span></p>`;
    h += `<div class="grid2"><label>User (recorded with every change) <input name="critUser" type="text" value="${esc(meta.author || '')}"></label>` +
      `<label>Reason for the change (mandatory) <input name="critReason" type="text" placeholder="source or justification of the value"></label></div>`;
    h += `<table class="grid-table" id="critTable"><thead><tr><th>ID</th><th>Quantity</th><th>Cmp</th><th>Limit</th><th>Unit</th><th>S</th><th>On</th><th>Source label</th><th>Value</th><th>Status</th><th></th></tr></thead><tbody>`;
    for (const r of ev.criteria) {
      const pass = r.status === 'PASS' ? 'ok' : r.status === 'FAIL' ? 'bad' : '';
      const unit = r.unit && r.unit !== '-' ? r.unit : '';
      const val = r.value === null || r.value === undefined ? '' : typeof r.value === 'boolean' ? String(r.value) : fmtv(r.value);
      h += `<tr data-id="${esc(r.id)}" class="${pass}"><td title="${esc(r.title)}"><b>${esc(r.id)}</b>${r.overridden ? ' *' : ''}</td><td>${esc(r.quantityTitle || r.title)}</td><td>${esc(r.comparison)}</td><td>${critLimitCell(r)}</td><td>${esc(unit)}</td>` +
        `<td>${r.comparison === 'true' ? '' : `<input data-f="sf" type="text" inputmode="decimal" data-num step="any" min="0" placeholder="1" value="${esc(fmtv(r.safetyFactor))}">`}</td>` +
        `<td><input data-f="enabled" type="checkbox"${r.enabled ? ' checked' : ''}></td>` +
        `<td>${r.comparison === 'true' ? esc((r.source || {}).label || '') : `<input data-f="source" type="text" value="${esc((r.source || {}).label || '')}">`}</td>` +
        `<td class="n">${esc(val)}${r.governingCase && r.governingCase !== 'n/a' ? `<br><small>${esc(r.governingCase)}</small>` : ''}</td><td>${esc(r.status)}${r.reason ? `<br><small>${esc(r.reason)}</small>` : ''}</td>` +
        `<td><button type="button" data-set="${esc(r.id)}">Set</button></td></tr>`;
    }
    h += `</tbody></table>`;
    h += `<div class="btn-row">Add criterion: <input name="custId" type="text" placeholder="id, e.g. C-MINE-1" size="14"> <select name="custQ">${cat.quantities.filter(q => q.kind !== 'predicate').map(q => `<option value="${esc(q.key)}">${esc(q.title)} [${esc(q.unit)}]</option>`).join('')}</select> ` +
      `<select name="custCmp"><option>&lt;=</option><option>&gt;=</option><option>range</option></select> <button type="button" id="custAdd">Add</button></div>`;
    h += `<h3>Material allowables</h3><p class="note">No allowable is shipped. Enter values from the datasheet or standard you apply; the Hertz criterion uses the lower sigma_Hlim of the selected rotor materials divided by S (gear analogy, assumption A-AC1).</p>`;
    h += `<table class="grid-table" id="matTable"><thead><tr><th>Material</th><th>sigma_Hlim ${esc(cat.materials[0].unit)}</th><th>Yield ${esc(cat.materials[0].unit)}</th><th>Condition</th><th>Source</th><th></th></tr></thead><tbody>`;
    const eff = C.effective(ac);
    for (const m of cat.materials) {
      const row = eff.materialLibrary[m.id];
      h += `<tr data-mid="${esc(m.id)}"><td title="${esc(m.basis)}">${esc(m.name)}${row.overrides && row.overrides.length ? ' *' : ''}</td>` +
        `<td><input data-f="sigmaHlim" type="text" inputmode="decimal" data-num step="any" value="${esc(fmtv(row.sigmaHlim))}"></td><td><input data-f="yield" type="text" inputmode="decimal" data-num step="any" value="${esc(fmtv(row.yield))}"></td>` +
        `<td><input data-f="condition" type="text" value="${esc(row.condition || '')}"></td><td><input data-f="source" type="text" value="${esc((row.source || {}).label || '')}" title="${esc((row.source || {}).doc || '')}"></td>` +
        `<td><button type="button" data-setm="${esc(m.id)}">Set</button></td></tr>`;
    }
    h += `</tbody></table>`;
    h += `<h3>Overrides</h3>`;
    h += ev.overrides.length ? `<table class="grid-table" id="ovTable"><thead><tr><th>Target</th><th>ID</th><th>Field</th><th>Old</th><th>New</th><th>Unit</th><th>Reason</th><th>User</th><th>Time</th></tr></thead><tbody>` +
      ev.overrides.map(o => { const j = v => esc(v !== null && typeof v === 'object' ? JSON.stringify(v) : v); return `<tr><td>${esc(o.target)}</td><td>${esc(o.id)}</td><td>${esc(o.field)}</td><td>${j(o.oldValue)}</td><td>${j(o.newValue)}</td><td>${esc(o.unit)}</td><td>${esc(o.reason)}</td><td>${esc(o.user)}</td><td>${esc(o.timestamp)}</td></tr>`; }).join('') + `</tbody></table>`
      : '<p class="note">No override entered. Every limit-based criterion is NOT EVALUATED.</p>';
    if (ev.issues.length) h += `<p class="lvl-err">Issues: ${esc(ev.issues.join('; '))}</p>`;
    h += `<p class="note">Criteria-set hash: <span class="mono" id="critHash">${esc(ev.criteriaHash)}</span></p>`;
    root.innerHTML = h;
  }

  function critField(tr, f) { const e = tr.querySelector(`[data-f="${f}"]`); return e; }
  const parseNum = e => { if (!e || e.value.trim() === '') return null; const v = G.num.parse(e.value); return Number.isFinite(v) ? v : NaN; };
  function critContext() {
    const root = $('critRoot');
    return { user: root.querySelector('[name="critUser"]').value, reason: root.querySelector('[name="critReason"]').value };
  }
  function critSetRow(id) {
    const C = CR(), ac = acNow(), eff = C.effective(ac), row = eff.criteria.find(c => c.id === id); if (!row) return;
    const tr = $('critRoot').querySelector(`tr[data-id="${id}"]`), cx = critContext(), recs = [];
    const add = (field, value, unit) => recs.push({ target: 'criterion', id, field, value, unit, reason: cx.reason, user: cx.user });
    const same = (a, b) => G.project.canonical(a === undefined ? null : a) === G.project.canonical(b === undefined ? null : b);
    if (row.comparison !== 'true') {
      if (row.comparison === 'range') {
        const lo = parseNum(critField(tr, 'min')), hi = parseNum(critField(tr, 'max'));
        if (Number.isNaN(lo) || Number.isNaN(hi) || (lo === null) !== (hi === null)) { say('Enter both range values (min and max) or leave both empty.', 'warn'); return; }
        const nv = lo === null ? null : { min: lo, max: hi };
        if (!same(nv, row.limit)) add('limit', nv, row.unit);
      } else if (!(row.limit && typeof row.limit === 'object')) {
        const v = parseNum(critField(tr, 'limit'));
        if (Number.isNaN(v)) { say('The limit must be a number.', 'warn'); return; }
        if (!same(v, row.limit)) add('limit', v, row.unit);
      }
      const sf = parseNum(critField(tr, 'sf'));
      if (Number.isNaN(sf) || (sf !== null && sf <= 0)) { say('The safety factor must be a number greater than zero.', 'warn'); return; }
      if (!same(sf, row.safetyFactor)) add('safetyFactor', sf, '-');
      const lab = critField(tr, 'source').value;
      if (lab !== ((row.source || {}).label || '')) add('source', { label: lab, doc: null, clause: null, verified: false }, null);
    }
    const en = critField(tr, 'enabled').checked;
    if (en !== (row.enabled !== false)) add('enabled', en, null);
    if (!recs.length) { say(`${id}: nothing changed.`); return; }
    try {
      const now = new Date().toISOString();
      let next = ac;
      for (const r of recs) next = C.addOverride(next, r, now);
      setAC(next, 'acset'); say(`${id}: ${recs.length} override${recs.length > 1 ? 's' : ''} recorded (${recs.map(r => r.field).join(', ')}).`);
    } catch (e) { say(e.message, 'warn'); }
  }
  function critSetMaterial(mid) {
    const C = CR(), ac = acNow(), row = C.effective(ac).materialLibrary[mid], tr = $('critRoot').querySelector(`tr[data-mid="${mid}"]`), cx = critContext(), recs = [];
    const add = (field, value, unit) => recs.push({ target: 'material', id: mid, field, value, unit, reason: cx.reason, user: cx.user });
    for (const f of ['sigmaHlim', 'yield']) {
      const v = parseNum(critField(tr, f));
      if (Number.isNaN(v)) { say(`${f} must be a number.`, 'warn'); return; }
      if (v !== (row[f] === undefined ? null : row[f])) add(f, v, row.unit);
    }
    const cond = critField(tr, 'condition').value; if (cond !== (row.condition || '')) add('condition', cond, null);
    const lab = critField(tr, 'source').value; if (lab !== ((row.source || {}).label || '')) add('source', Object.assign({}, row.source, { label: lab, verified: false }), null);
    if (!recs.length) { say(`${mid}: nothing changed.`); return; }
    try {
      const now = new Date().toISOString(); let next = ac;
      for (const r of recs) next = C.addOverride(next, r, now);
      setAC(next, 'acmat'); say(`${mid}: ${recs.length} material override${recs.length > 1 ? 's' : ''} recorded.`);
    } catch (e) { say(e.message, 'warn'); }
  }
  $('critRoot').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.set) critSetRow(b.dataset.set);
    else if (b.dataset.setm) critSetMaterial(b.dataset.setm);
    else if (b.id === 'custAdd') {
      const root = $('critRoot'), id = root.querySelector('[name="custId"]').value.trim(), q = root.querySelector('[name="custQ"]').value, cmp = root.querySelector('[name="custCmp"]').value;
      const ac = Object.assign(CR().defaultAC(), JSON.parse(JSON.stringify(acNow())));
      if (!id) { say('Enter an id for the new criterion.', 'warn'); return; }
      if (CR().effective(ac).criteria.some(c => c.id === id)) { say(`Criterion ${id} already exists.`, 'warn'); return; }
      ac.customCriteria = (ac.customCriteria || []).concat([{ id, quantity: q, comparison: cmp, title: id }]);
      setAC(ac, 'accust'); say(`Criterion ${id} added (no limit: NOT EVALUATED until you enter one).`);
    }
  });
  $('critRoot').addEventListener('change', ev => {
    const n = ev.target.name; if (!n) return;
    const ac = Object.assign(CR().defaultAC(), JSON.parse(JSON.stringify(acNow())));
    if (n === 'profile') ac.activeProfileId = ev.target.value;
    else if (n === 'authName') ac.authority = Object.assign({}, ac.authority, { name: ev.target.value || null });
    else if (n === 'authDoc') ac.authority = Object.assign({}, ac.authority, { document: ev.target.value || null });
    else if (n === 'authEd') ac.authority = Object.assign({}, ac.authority, { edition: ev.target.value || null });
    else if (n === 'matInner') ac.materials = Object.assign({}, ac.materials, { inner: ev.target.value || null });
    else if (n === 'matOuter') ac.materials = Object.assign({}, ac.materials, { outer: ev.target.value || null });
    else return;
    setAC(ac, 'acsel');
  });
  // Checks/messages that name a criterion link to its row.
  function gotoCriterion(id) {
    showTab('criteria'); renderCriteria();
    const tr = $('critRoot').querySelector(`tr[data-id="${id}"]`);
    if (tr) { tr.scrollIntoView({ block: 'center' }); tr.classList.add('sel'); }
  }
  $('checks').addEventListener('click', ev => { const li = ev.target.closest('[data-criterion]'); if (li) gotoCriterion(li.dataset.criterion); });

  // ------------------------------------------------------------------ splitter between the forms and the dock
  (function () {
    const work = $('work'), sp = $('splitter'), KEY = 'gerotor.formWidth';
    const set = px => { work.style.setProperty('--form-w', px + 'px'); work.style.setProperty('--form-w-user', px + 'px'); };
    const clamp = px => Math.max(260, Math.min(px, work.clientWidth * 0.7));
    try { const v = +LS.getItem(KEY); if (v >= 260) set(v); } catch (_) { /* default */ }
    sp.addEventListener('pointerdown', ev => {
      ev.preventDefault(); sp.setPointerCapture(ev.pointerId); sp.classList.add('drag');
      const x0 = ev.clientX, w0 = $('centre').getBoundingClientRect().width;
      const move = e => set(Math.round(clamp(w0 + e.clientX - x0)));
      const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); try { LS.setItem(KEY, String(Math.round($('centre').getBoundingClientRect().width))); } catch (_) { /* quota */ } A.redraw(); };
      sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
    });
    sp.addEventListener('dblclick', () => { work.style.removeProperty('--form-w'); work.style.removeProperty('--form-w-user'); try { LS.removeItem(KEY); } catch (_) { /* ignore */ } A.redraw(); });
  })();

  // ------------------------------------------------------------------ init
  injectTabCss();
  renderBars(); addTips(); renderTabs();
  try { const t = LS.getItem('gerotor.theme'); if (t) document.documentElement.dataset.theme = t; } catch (_) { /* default light */ }
  let restored = false;
  try {
    const saved = LS.getItem(AUTOSAVE_KEY);
    if (saved) { applying = true; const st = P.parse(saved, A.DEFAULTS, A.migrate); applying = false; applyProject(st); restored = true; }
  } catch (_) { applying = false; }
  if (!restored) { syncMetaForm(); renderCaseList(); savedStr = snapStr(); hist.reset(savedStr); }
  renderCaseResults(); renderMessages();
  showTab('geometry'); showBottom('grid');
  refreshStatus(A.getState());
  updateChrome();
  new ResizeObserver(() => A.redraw()).observe($('rightDock'));
  // Stamp git hash/version from the backend (offline: stays "not stamped" and reports are INVALID).
  P.connectBackend().then(r => { if (r) { say(`Backend connected: ${P.VERSION.core}, git ${P.VERSION.gitHash}.`); P.fetchResolved(state()).then(setResolvedStatus); } else say('No backend: code version not stamped, reports will be marked INVALID.', 'warn'); }).catch(() => {});

  G.workspace = { showTab, showDock, showBottom, run, CMD, state, applyProject, openText, snapshot, hist, say, get dirty() { return isDirty(); }, calcCases, validate, buildReport, markSaved() { savedStr = snapStr(); updateChrome(); } };
})(window.Gerotor);
