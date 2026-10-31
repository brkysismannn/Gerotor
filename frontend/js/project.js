/*
 * Project model: gerotor-project/4 files (backend/schema/project.schema.json), SHA-256 input hash over the RFC 8785 (JCS)
 * canonical JSON of {design, operatingPoints, settings, measured} (same as backend/api/project.py), undo/redo history,
 * recent-project list and the Calc adapter. Reads /1, /2 (note "oilT=..; pIn=.." migrated), /3 and /4
 * (/3 -> /4: the placeholder settings.acceptanceCriteria is migrated by G.criteria.migrateV3, as backend _v3_to_v4). No DOM access here.
 * metadata.designLabel marks the pre-filled default design as "Example design (not a recommendation)" (owner rule no-unexplained-numbers).
 *
 * Internal state:  { meta:{project,partNo,revision,author,checker,approver,date,notes,scope,created,checked,revisions:[{rev,date,author,description}],signOff},
 *                    design:{flat input keys}, loadCases:[{name,rpm,dp,oilT,pIn,nu?}], activeCase, calcMode, settings:{schema settings, passed through} }
 * File mapping:    meta.project -> metadata.projectName; revisions/signOff/scope -> same names; load cases -> operatingPoints[{name,rpm,dp,oilT,pIn,nu?}];
 *                  oil settings (FLUID_KEYS: oil, oilT, nu, rho, bulk, pVap, user-oil points) -> top-level luid; porting inputs dblIn/dblOut/shadow are stored,
 *                  faceSupport/doubleFill are derived by the backend and never written;
 *                  activeCase, calcMode, approver -> metadata.workspace.
 */
(function (G) {
  'use strict';

  const VERSION = { app: '0.2.0', core: 'gerotor-js 0.2.0', gitHash: null, api: null };
  const SCHEMA = 'gerotor-project/4';
  const SCHEMA_VERSION = 4;
  const EXAMPLE_LABEL = 'Example design (not a recommendation)';
  const FLUID_KEYS = ['oil', 'oilT', 'nu', 'rho', 'bulk', 'pVap', 'uT1', 'uNu1', 'uT2', 'uNu2', 'uT3', 'uNu3', 'uRho15'];
  const CASE_KEYS = ['oilT', 'pIn', 'nu'];
  const EXT = '.gerotor.json';
  const HASHED_KEYS = ['design', 'fluid', 'operatingPoints', 'settings', 'measured'];     // as backend/api/project.py

  const today = () => new Date().toISOString().slice(0, 10);
  function defaultMeta() {
    return { project: 'Untitled gerotor', partNo: '', revision: 'A', author: '', checker: '', approver: '',
      date: today(), notes: '', scope: '', designLabel: EXAMPLE_LABEL, created: new Date().toISOString(), checked: null, revisions: [], signOff: {} };
  }

  function defaultLoadCases(design) {
    return [{ name: 'Rated', rpm: design.rpm, dp: design.dp, oilT: design.oilT, pIn: design.pIn }];
  }

  function create(design) {
    return { meta: defaultMeta(), design: Object.assign({}, design), loadCases: defaultLoadCases(design), activeCase: 0, calcMode: 'js', settings: {} };
  }

  // ---- canonical JSON per RFC 8785 (JCS): keys sorted by UTF-16 code units, no whitespace, ES number format
  // (JSON.stringify), strings escaped minimally, UTF-8 when hashed. Backend uses the same rule.
  function canonical(v) {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'number' && !Number.isFinite(v)) return 'null';
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => canonical(k) + ':' + canonical(v[k])).join(',') + '}';
  }

  // Pure-JS SHA-256 fallback (SubtleCrypto is missing in insecure contexts and in the test harness).
  function sha256Sync(str) {
    const bytes = new TextEncoder().encode(str);
    const K = new Uint32Array(64), H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    for (let n = 2, c = 0; c < 64; n++) {
      let pr = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { pr = false; break; }
      if (pr) K[c++] = Math.floor((Math.cbrt(n) % 1) * 4294967296);
    }
    const l = bytes.length, total = (((l + 9 + 63) >> 6) << 6), buf = new Uint8Array(total);
    buf.set(bytes); buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(l / 0x20000000)); dv.setUint32(total - 4, (l << 3) >>> 0);
    const w = new Uint32Array(64), rr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + 4 * i);
      for (let i = 16; i < 64; i++) {
        const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return Array.from(H, x => x.toString(16).padStart(8, '0')).join('');
  }

  async function sha256Hex(str) {
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (_) { /* fall through */ }
    return sha256Sync(str);
  }

  // ---- document <-> state
  // /2 files carried oilT / pIn in the operating-point note; read for migration only.
  function parseCaseNote(note) {
    const t = /oilT\s*=\s*([-+]?[0-9.]+(?:[eE][-+]?[0-9]+)?)/.exec(note || ''), p = /pIn\s*=\s*([-+]?[0-9.]+(?:[eE][-+]?[0-9]+)?)/.exec(note || '');
    return { oilT: t ? +t[1] : undefined, pIn: p ? +p[1] : undefined };
  }

  // Design as written to the file: porting inputs dblIn/dblOut/shadow are stored; faceSupport/doubleFill are derived by
  // the backend (rule in geometry.derive) and never written; oil settings go to the top-level fluid object.
  function designOut(d) {
    const o = {}, f = {};
    for (const [k, v] of Object.entries(d)) {
      if (k === 'faceSupport' || k === 'doubleFill' || k === 'fluid') continue;
      if (FLUID_KEYS.includes(k)) f[k] = v; else o[k] = v;
    }
    return { design: o, fluid: f };
  }
  const opOut = c => { const o = { name: c.name, rpm: c.rpm, dp: c.dp }; for (const k of CASE_KEYS) if (Number.isFinite(c[k])) o[k] = c[k]; return o; };

  function toDoc(state, now) {
    const m = state.meta, iso = now || new Date().toISOString();
    const so = (role, name) => ({ name: name || '', date: (m.signOff && m.signOff[role] && m.signOff[role].date) || '' });
    const doc = {
      schema: SCHEMA,
      metadata: {
        projectName: m.project || 'Untitled gerotor', partNo: m.partNo || '', revision: m.revision || '', author: m.author || '', checker: m.checker || '',
        designLabel: m.designLabel || '', created: m.created || iso, modified: iso, checked: m.checked || null, notes: m.notes || '', scope: m.scope || '',
        revisions: (m.revisions || []).map(r => ({ rev: String(r.rev || '-'), date: r.date || '', author: r.author || '', description: r.description || r.note || '' })),
        signOff: { author: so('author', m.author), checker: so('checker', m.checker), approver: so('approver', m.approver) },
        workspace: { app: 'Gerotor Workspace ' + VERSION.app, activeCase: state.activeCase, calcMode: state.calcMode || 'js', calcDate: m.date || '' },
      },
      design: designOut(state.design).design,
      operatingPoints: state.loadCases.map(opOut),
      results: null,
    };
    const flo = designOut(state.design).fluid;
    if (Object.keys(flo).length) doc.fluid = flo;
    if (state.settings && Object.keys(state.settings).length) doc.settings = state.settings;
    if (state.measured && Object.keys(state.measured).length) doc.measured = state.measured;
    return doc;
  }

  function serialize(state) { return JSON.stringify(toDoc(state), null, 2) + '\n'; }

  // Hash of the calculation inputs exactly as backend/api/project.py input_hash (design, operatingPoints, settings, measured).
  function inputsOfDoc(doc) {
    const o = {};
    for (const k of HASHED_KEYS) { const v = doc[k]; if (v !== null && v !== undefined && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) o[k] = v; }
    return o;
  }
  const inputsOf = state => inputsOfDoc(toDoc(state, 'x'));
  function inputHash(state) { return sha256Hex(canonical(inputsOf(state))); }
  const inputHashSync = state => sha256Sync(canonical(inputsOf(state)));

  // ---- units: {value, unit} inputs are converted to the unit of the key (as backend/api/units.py), never just unwrapped
  // unit -> [dimension, factor to SI, offset to SI]
  const UNITS = {
    mm: ['length', 1e-3, 0], m: ['length', 1, 0], um: ['length', 1e-6, 0], 'µm': ['length', 1e-6, 0], cm: ['length', 1e-2, 0], in: ['length', 0.0254, 0],
    bar: ['pressure', 1e5, 0], 'bar(a)': ['pressure', 1e5, 0], 'bar abs': ['pressure', 1e5, 0], Pa: ['pressure', 1, 0], kPa: ['pressure', 1e3, 0], MPa: ['pressure', 1e6, 0], GPa: ['pressure', 1e9, 0],
    rpm: ['speed', 1, 0], '1/min': ['speed', 1, 0],
    cSt: ['kinvisc', 1e-6, 0], 'mm2/s': ['kinvisc', 1e-6, 0], 'mm^2/s': ['kinvisc', 1e-6, 0], 'm2/s': ['kinvisc', 1, 0], 'm^2/s': ['kinvisc', 1, 0],
    degC: ['temperature', 1, 273.15], K: ['temperature', 1, 0],
    'kg/m3': ['density', 1, 0], 'kg/m^3': ['density', 1, 0],
    deg: ['angle', Math.PI / 180, 0], rad: ['angle', 1, 0],
    cm3: ['volume', 1e-6, 0], mm3: ['volume', 1e-9, 0], L: ['volume', 1e-3, 0], m3: ['volume', 1, 0],
    '-': ['none', 1, 0], '': ['none', 1, 0],
  };
  const UNIT_ALIAS = { '°': 'deg', '°C': 'degC', 'cm³': 'cm3', 'mm³': 'mm3', 'kg/m³': 'kg/m3', 'N·m': 'Nm' };
  const normUnit = u => (UNIT_ALIAS[u] !== undefined ? UNIT_ALIAS[u] : u);
  function convertUnit(value, unit, target, where) {
    unit = normUnit(unit); target = normUnit(target);
    if (unit === target) return value;
    const a = UNITS[unit], b = UNITS[target];
    if (!a) throw new Error(`${where}: unknown unit "${unit}"`);
    if (!b) throw new Error(`${where}: key has no convertible unit (expects "${target}"), got "${unit}"`);
    if (a[0] !== b[0]) throw new Error(`${where}: unit "${unit}" (${a[0]}) is not compatible with "${target}" (${b[0]})`);
    return (a[1] * value + a[2] - b[2]) / b[1];
  }
  // key's own unit; extra: op-point keys not in FIELDS
  const OP_UNITS = { rpm: 'rpm', dp: 'bar', oilT: 'degC', pIn: 'bar', nu: 'cSt' };
  function quantity(key, v, where) {
    if (!(v && typeof v === 'object' && !Array.isArray(v) && 'value' in v)) return v;
    const target = OP_UNITS[key] || (FIELDS[key] ? FIELDS[key][2] : undefined);
    if (v.unit === undefined || v.unit === null) return v.value;
    if (typeof v.unit !== 'string') throw new Error(`${where}.${key}: unit must be a string`);
    if (typeof v.value !== 'number') throw new Error(`${where}.${key}: a value with a unit must be a number`);
    if (target === undefined) throw new Error(`${where}.${key}: key has no defined unit, cannot convert "${v.unit}"`);
    return convertUnit(v.value, v.unit, target, `${where}.${key}`);
  }

  // settings.acceptanceCriteria (schema /4): every override needs reason, user and timestamp (schema "required").
  function checkCriteria(ac) {
    if (ac === undefined || ac === null) return;
    if (typeof ac !== 'object' || Array.isArray(ac)) throw new Error('settings.acceptanceCriteria must be an object');
    (ac.overrides || []).forEach((o, i) => {
      for (const k of ['id', 'field', 'reason', 'user', 'timestamp']) if (typeof o[k] !== 'string' || !o[k].trim()) throw new Error(`settings.acceptanceCriteria.overrides[${i}]: "${k}" is mandatory`);
    });
  }

  // Accepts gerotor-project/1..4 files or a legacy bare parameter JSON; throws Error with a readable message.
  function parse(text, designDefaults, migrateDesign) {
    let o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('Not valid JSON: ' + e.message); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Project must be a JSON object');
    let design, st;
    const dd = designDefaults || null;
    if (typeof o.schema === 'string' && o.schema.startsWith('gerotor-project/')) {
      const ver = parseInt(o.schema.split('/')[1], 10);
      if (!(ver >= 1) || ver > SCHEMA_VERSION) throw new Error('Unsupported project schema ' + o.schema + ' (this software reads up to ' + SCHEMA + ')');
      if (!o.design || typeof o.design !== 'object' || Array.isArray(o.design)) throw new Error('Project has no "design" section');
      const md = o.metadata || {}, ws = md.workspace || {};
      design = {};
      for (const [k, v] of Object.entries(o.design)) {
        design[k] = quantity(k, v, 'design');
      }
      if (o.fluid && typeof o.fluid === 'object' && !Array.isArray(o.fluid)) for (const [fk, fv] of Object.entries(o.fluid)) design[fk] = quantity(fk, fv, 'fluid');
      st = create(dd || design);
      st.meta = Object.assign(defaultMeta(), {
        project: md.projectName || 'Untitled gerotor', partNo: md.partNo || '', revision: md.revision || '', author: md.author || '', checker: md.checker || '',
        approver: (md.signOff && md.signOff.approver && md.signOff.approver.name) || '', date: ws.calcDate || today(), notes: md.notes || '', scope: md.scope || '', designLabel: md.designLabel || '',
        created: md.created || new Date().toISOString(), checked: md.checked || null, signOff: md.signOff || {},
        revisions: Array.isArray(md.revisions) ? md.revisions.map(r => ({ rev: r.rev, date: r.date, author: r.author, description: r.description })) : [],
      });
      if (Array.isArray(o.operatingPoints) && o.operatingPoints.length) {
        const base = Object.assign({}, dd || {}, design);
        st.loadCases = o.operatingPoints.map((c, i) => {
          const w = `operatingPoints[${i}]`, q = k => quantity(k, c[k], w);
          const x = ver < 3 ? parseCaseNote(c.note) : {};
          const out = { name: c.name || ('Case ' + (i + 1)), rpm: +q('rpm'), dp: +q('dp') };
          for (const k of ['oilT', 'pIn']) { const v = c[k] !== undefined ? +q(k) : x[k]; out[k] = v !== undefined ? v : base[k]; }
          if (c.nu !== undefined) out.nu = +q('nu');
          return out;
        });
      } else st.loadCases = defaultLoadCases(Object.assign({}, dd || {}, design));
      st.activeCase = Number.isInteger(ws.activeCase) && ws.activeCase >= 0 && ws.activeCase < st.loadCases.length ? ws.activeCase : 0;
      st.calcMode = ws.calcMode || 'js';
      st.settings = o.settings && typeof o.settings === 'object' ? JSON.parse(JSON.stringify(o.settings)) : {};
      if (ver < 4 && st.settings.acceptanceCriteria && G.criteria) st.settings.acceptanceCriteria = G.criteria.migrateV3(st.settings.acceptanceCriteria);
      checkCriteria(st.settings.acceptanceCriteria);
      if (o.measured) st.measured = o.measured;
    } else {
      if (!('N' in o) || !('e' in o)) throw new Error('Not a Gerotor project or parameter file (no schema / N / e)');
      design = o;
      st = create(dd || design);
      st.meta.designLabel = '';        // a foreign bare parameter file is not the built-in example
    }
    if (migrateDesign) migrateDesign(design);
    st.design = Object.assign({}, dd || {}, design);
    delete st.design.faceSupport; delete st.design.doubleFill;       // derived again on save
    if (dd) for (const [k, v] of Object.entries(st.design)) {
      const dv = dd[k];
      if (dv !== undefined && typeof dv !== typeof v) throw new Error(`Design field "${k}" has the wrong type`);
    }
    if (!(typeof o.schema === 'string')) st.loadCases = defaultLoadCases(st.design);
    return st;
  }

  // ---- undo / redo (snapshots); coalesces by key within 600 ms
  class History {
    constructor(limit) { this.limit = limit || 200; this.undoS = []; this.redoS = []; this.cur = null; this.lastKey = null; this.lastT = 0; }
    reset(snap) { this.undoS = []; this.redoS = []; this.cur = typeof snap === 'string' ? snap : JSON.stringify(snap); this.lastKey = null; }
    setCur(snap) { this.cur = typeof snap === 'string' ? snap : JSON.stringify(snap); }   // replace without a history step
    push(snap, key, now) {
      const s = JSON.stringify(snap);
      if (this.cur !== null && s === this.cur) return false;
      now = now === undefined ? Date.now() : now;
      const merge = key && key === this.lastKey && now - this.lastT < 600 && this.undoS.length;
      if (!merge && this.cur !== null) { this.undoS.push(this.cur); if (this.undoS.length > this.limit) this.undoS.shift(); }
      this.cur = s; this.redoS = []; this.lastKey = key || null; this.lastT = now;
      return true;
    }
    canUndo() { return this.undoS.length > 0; }
    canRedo() { return this.redoS.length > 0; }
    undo() { if (!this.canUndo()) return null; this.redoS.push(this.cur); this.cur = this.undoS.pop(); this.lastKey = null; return JSON.parse(this.cur); }
    redo() { if (!this.canRedo()) return null; this.undoS.push(this.cur); this.cur = this.redoS.pop(); this.lastKey = null; return JSON.parse(this.cur); }
  }

  // ---- recent list in a Storage-like object
  const RECENT_KEY = 'gerotor.recent.v1';
  function recentList(store) {
    try { const a = JSON.parse(store.getItem(RECENT_KEY)); return Array.isArray(a) ? a : []; } catch (_) { return []; }
  }
  function recentAdd(store, name, text, max) {
    max = max || 8;
    const list = recentList(store).filter(r => r.name !== name);
    list.unshift({ name, savedAt: new Date().toISOString(), text });
    while (list.length > max) list.pop();
    for (;;) {      // drop the oldest entries when the quota is exceeded
      try { store.setItem(RECENT_KEY, JSON.stringify(list)); return list; } catch (_) { if (list.length <= 1) return list; list.pop(); }
    }
  }

  function fileName(meta) {
    const base = (meta.partNo || meta.project || 'gerotor').replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '') || 'gerotor';
    return base + (meta.revision ? '_rev' + meta.revision.replace(/[^\w.\-]+/g, '_') : '') + EXT;
  }

  // ---- Calc adapter: 'js' runs the in-page engine; 'api' / 'parity' plug in via register().
  const Calc = {
    mode: 'js',
    impls: {
      js: { label: 'JavaScript (in browser)', sync: true, run(raw) { const params = G.derive(raw); return { params, res: G.analyse(params), engine: 'js' }; } },
    },
    register(name, impl) { this.impls[name] = impl; },
    available() { return Object.keys(this.impls); },
    setMode(m) { if (!this.impls[m]) return false; this.mode = m; return true; },
    // Synchronous path used by the UI; non-sync engines fall back to js and report it.
    run(raw) {
      const impl = this.impls[this.mode];
      if (impl && impl.sync) return impl.run(raw);
      const out = this.impls.js.run(raw); out.note = `Mode "${this.mode}" is not synchronous; JS engine used`; return out;
    },
    // Promise path for api / parity engines (POST /api/calc/all on port 8770, see backend/api/app.py).
    async runAsync(raw) { const impl = this.impls[this.mode] || this.impls.js; return impl.run(raw); },
  };

  // ---- code-version stamp and methods registry from the backend (offline: not stamped -> reports are INVALID)
  // health = GET /api/health: { status, git, gerotor_core, api, ... }
  function stamp(h) {
    if (h && h.status === 'ok' && h.git && h.git !== 'unknown' && h.gerotor_core) {
      VERSION.gitHash = String(h.git); VERSION.api = String(h.api || h.version || ''); VERSION.core = 'gerotor_core ' + h.gerotor_core + (VERSION.api ? ' (api ' + VERSION.api + ')' : '');
      return true;
    }
    VERSION.gitHash = null; VERSION.api = null; VERSION.core = 'gerotor-js 0.2.0';
    return false;
  }
  const isStamped = () => !!VERSION.gitHash;
  async function getJson(base, path) {
    if (typeof fetch !== 'function') throw new Error('fetch unavailable');
    const r = await fetch((base || '') + path);
    if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status);
    return r.json();
  }
  // Resolved-input hash and certification status from the backend (POST /api/report/data with the project document).
  // The resolved hash covers every value the calculation used (library rows, core settings); it cannot be reproduced offline,
  // so offline only the document hash (inputHash in this file) exists. Returns null when the API is not reachable.
  const resolved = { base: null, last: null };
  async function fetchResolved(state) {
    if (resolved.base === null || typeof fetch !== 'function') return null;
    try {
      const r = await fetch(resolved.base + '/api/report/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toDoc(state)) });
      if (!r.ok) return null;
      const d = await r.json();
      return (resolved.last = { inputHash: d.inputHash, documentHash: d.documentHash, certification: d.certification || null });
    } catch (_) { return null; }
  }
  // Tries the page origin (when served by the backend), then the default backend on port 8770.
  async function connectBackend(bases) {
    const list = bases || ((typeof location !== 'undefined' && /^https?:/.test(location.protocol)) ? ['', 'http://127.0.0.1:8770'] : ['http://127.0.0.1:8770']);
    for (const b of list) {
      try {
        const h = await getJson(b, '/api/health');
        if (!stamp(h)) continue;
        try { const m = await getJson(b, '/api/methods'); if (m && m.assumptions && m.methods) G.methodsLive = m; } catch (_) { /* generated copy is used */ }
        resolved.base = b;
        return { base: b, health: h };
      } catch (_) { /* try next */ }
    }
    return null;
  }
  // Methods/assumptions registry: live endpoint data, else the bundled copy generated from it, else null.
  const methodsData = () => G.methodsLive || G.methodsData || null;

  // ---- design-field metadata: symbol, definition, unit (tooltips + report)
  const FIELDS = {
    uT1: ['T_1', 'User oil datasheet point 1: temperature', '°C'], uNu1: ['ν_1', 'User oil datasheet point 1: kinematic viscosity', 'cSt'],
    uT2: ['T_2', 'User oil datasheet point 2: temperature', '°C'], uNu2: ['ν_2', 'User oil datasheet point 2: kinematic viscosity', 'cSt'],
    uT3: ['T_3', 'User oil datasheet point 3 (optional): temperature', '°C'], uNu3: ['ν_3', 'User oil datasheet point 3 (0 = unused): kinematic viscosity', 'cSt'],
    uRho15: ['ρ_15', 'User oil density at 15 °C', 'kg/m³'],
    N: ['N', 'Number of outer-rotor lobes (inner rotor has N-1 teeth)', '-'],
    e: ['e', 'Eccentricity: distance between rotor axes', 'mm'],
    R: ['R', 'Pitch-circle radius of the outer-rotor lobe centres', 'mm'],
    rp: ['r_p', 'Radius of the circular outer-rotor lobes (generating roller)', 'mm'],
    c: ['c', 'Profile equidistance clearance c: inner profile is offset by c; peak tip gap is about 2c', 'mm'],
    Rv: ['R_v', 'Outer-rotor valley radius (centre of rotor to valley bottom)', 'mm'],
    RvClear: ['-', 'Auto valley margin: extra radial room beyond the lobe tips when R_v is automatic', 'mm'],
    fillet: ['r_f', 'Fillet radius at the outer-rotor valley corners', 'mm'],
    b: ['b', 'Rotor (axial) width', 'mm'],
    OD: ['D_o', 'Outer diameter of the outer rotor', 'mm'],
    bore: ['d_b', 'Inner-rotor shaft bore diameter', 'mm'],
    rpm: ['n', 'Inner-shaft speed', 'rpm'],
    dp: ['Δp', 'Pressure rise between outlet and inlet', 'bar'],
    sucStart: ['-', 'Suction port start offset from the theoretical edge (+ = rotation direction)', '°'],
    sucEnd: ['-', 'Suction port end offset', '°'], delStart: ['-', 'Delivery port start offset', '°'], delEnd: ['-', 'Delivery port end offset', '°'],
    portRo: ['r_po', 'Outer radius of the port slots', 'mm'], portRi: ['r_pi', 'Inner radius of the port slots (about the inner-rotor axis O1)', 'mm'],
    grooveW: ['-', 'Relief groove width', 'mm'], grooveD: ['-', 'Relief groove depth (0 = full port depth)', 'mm'],
    portFillet: ['-', 'Port corner radius', 'mm'], outletVol: ['V_o', 'Volume behind the outlet port for pressure ripple', 'cm³'],
    pIn: ['p_in', 'Inlet absolute pressure', 'bar abs'], pVap: ['p_v', 'Cavitation (vapour/gas release) pressure, absolute', 'bar abs'],
    rho: ['ρ', 'Fluid density', 'kg/m³'], bulk: ['K', 'Fluid bulk modulus', 'MPa'], Cd: ['C_d', 'Port discharge coefficient', '-'],
    nu: ['ν', 'Kinematic viscosity at operating temperature', 'cSt'], oilT: ['T', 'Oil temperature', '°C'],
    axialClr: ['δ_a', 'Axial clearance, total over both faces', 'mm'],
    odClr: ['δ_OD', 'DIAMETRAL clearance between outer-rotor OD and housing bore (radial gap = half)', 'mm'],
    jbLen: ['L_j', 'Shaft journal bearing length (0 = none)', 'mm'],
    jbClr: ['δ_j', 'DIAMETRAL journal-bearing clearance (radial gap = half)', 'mm'],
    faceMu: ['μ', 'Coulomb friction coefficient at the floor (one-sided ports)', '-'],
    Ein: ['E_i', 'Young modulus, inner rotor', 'GPa'], nuIn: ['ν_i', 'Poisson ratio, inner rotor', '-'],
    Eout: ['E_o', 'Young modulus, outer rotor', 'GPa'], nuOut: ['ν_o', 'Poisson ratio, outer rotor', '-'],
  };

  G.project = { VERSION, SCHEMA, SCHEMA_VERSION, EXAMPLE_LABEL, EXT, HASHED_KEYS, FLUID_KEYS, UNITS, convertUnit, quantity, stamp, isStamped, connectBackend, methodsData, create, defaultMeta, defaultLoadCases, canonical, sha256Hex, sha256Sync,
    inputHash, inputHashSync, fetchResolved, resolved, inputsOf, inputsOfDoc, toDoc, serialize, parse, parseCaseNote, History, recentList, recentAdd, fileName, FIELDS };
  G.Calc = Calc;
})(window.Gerotor = window.Gerotor || {});
