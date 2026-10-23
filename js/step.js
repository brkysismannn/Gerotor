/*
 * STEP AP242 (ISO 10303-242, MIM long form) export of the rotors as B-rep solids, no dependencies.
 *
 * Each rotor is the extrusion (z = 0 … b) of a planar region: one outer loop (CCW) and holes (CW),
 * e.g. outer rotor = OD circle minus the lobed profile, inner rotor = profile minus the shaft bore.
 * Topology: top / bottom planar faces with inner bounds, one planar side face per polyline segment
 * (faceted; chord error set by the profile resolution). Every edge is shared by exactly two faces with
 * opposite orientation (closed manifold shell) — checked in tests/tests.js.
 *
 * Scope 'outer' / 'inner': one part; 'assembly': one part with both solids (inner rotor at x = e).
 */
(function (G) {
  'use strict';

  const TAU = 2 * Math.PI;
  const fmt = v => {
    if (Math.abs(v) < 1e-12) return '0.';
    const s = (+v.toPrecision(12)).toString();
    return /e/.test(s) ? s.replace(/e/, 'E') : (s.includes('.') ? s : s + '.');
  };
  const strq = s => "'" + String(s).replace(/'/g, "''") + "'";

  function signedArea(pts) {
    let a = 0;
    for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
    return a / 2;
  }
  const orient = (pts, ccw) => (signedArea(pts) > 0) === ccw ? pts : pts.slice().reverse();

  // Remove consecutive duplicates (and a closing duplicate).
  function clean(pts) {
    const out = [];
    for (const q of pts) if (!out.length || Math.hypot(q[0] - out[out.length - 1][0], q[1] - out[out.length - 1][1]) > 1e-7) out.push(q);
    while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-7) out.pop();
    return out;
  }

  const DEFAULT_TOL = 0.002;                  // max facet deviation from the true profile [mm]

  // Polygon of a circle with chord deviation ≤ tol.
  function circle(c, r, tol) {
    const n = Math.max(24, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tol / r))));
    return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos(TAU * i / n), c[1] + r * Math.sin(TAU * i / n)]);
  }

  /*
   * Closed dense polyline → facets: greedy chord growth, keeping every dense point within tol of its
   * chord (Douglas–Peucker-like, one pass). Returns the kept vertices.
   */
  function simplifyClosed(dense, tol) {
    const n = dense.length, keep = [dense[0]];
    const dist = (q, a, b) => {
      const t = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(t[0], t[1]);
      return L < 1e-15 ? Math.hypot(q[0] - a[0], q[1] - a[1]) : Math.abs((q[0] - a[0]) * t[1] - (q[1] - a[1]) * t[0]) / L;
    };
    let i = 0;
    while (i < n) {
      let j = i + 1;
      // Grow the chord i → j while all intermediate points stay within tol.
      while (j + 1 <= n) {
        const a = dense[i], b = dense[(j + 1) % n];
        let ok = true;
        for (let k = i + 1; k <= j; k++) if (dist(dense[k % n], a, b) > tol) { ok = false; break; }
        if (!ok) break;
        j++;
      }
      if (j >= n) break;
      keep.push(dense[j % n]);
      i = j;
    }
    return keep;
  }

  // Planar regions of the parts: { name, outer: [...], holes: [[...]] } (mm, part coordinates).
  function regions(p, scope, res, tol) {
    tol = tol || DEFAULT_TOL;
    const out = [];
    if (scope !== 'inner') {
      const prof = simplifyClosed(clean(G.outerProfile(p, 600, 300)), tol);
      out.push({ name: 'OuterRotor', outer: orient(circle([0, 0], p.OD / 2, tol), true), holes: [orient(prof, false)], dx: 0 });
    }
    if (scope !== 'outer') {
      const dense = clean(G.innerProfile(p, Math.max(20000, (p.N - 1) * 4000), p.rp + p.c));
      const prof = simplifyClosed(dense, tol);
      const holes = p.bore > 0 ? [orient(circle([0, 0], p.bore / 2, tol), false)] : [];
      out.push({ name: 'InnerRotor', outer: orient(prof, true), holes, dx: scope === 'assembly' ? p.e : 0, dense });
    }
    return out;
  }

  function Writer() {
    const lines = [];
    let id = 0;
    const add = s => { id++; lines.push(`#${id}=${s};`); return id; };
    const dirCache = new Map();
    const dir = (x, y, z) => {
      const k = [x, y, z].map(v => fmt(v)).join(',');
      if (!dirCache.has(k)) dirCache.set(k, add(`DIRECTION('',(${k}))`));
      return dirCache.get(k);
    };
    const pt = (x, y, z) => add(`CARTESIAN_POINT('',(${fmt(x)},${fmt(y)},${fmt(z)}))`);
    return { lines, add, dir, pt, get count() { return id; } };
  }

  // Solid of one region extruded over z = 0 … h; returns the MANIFOLD_SOLID_BREP id.
  function solid(w, reg, h) {
    const dx = reg.dx || 0;
    const loops = [reg.outer, ...reg.holes];
    const faces = [];
    const zD = w.dir(0, 0, 1), zDn = w.dir(0, 0, -1), xD = w.dir(1, 0, 0);
    // Vertices and edges per loop.
    const L = loops.map(pts => {
      const n = pts.length;
      const vb = [], vt = [];
      for (const q of pts) {
        vb.push(w.add(`VERTEX_POINT('',#${w.pt(q[0] + dx, q[1], 0)})`));
        vt.push(w.add(`VERTEX_POINT('',#${w.pt(q[0] + dx, q[1], h)})`));
      }
      const lineE = (a, b, A, B) => {
        const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], len = Math.hypot(...d);
        const ln = w.add(`LINE('',#${w.pt(...A)},#${w.add(`VECTOR('',#${w.dir(d[0] / len, d[1] / len, d[2] / len)},${fmt(len)})`)})`);
        return w.add(`EDGE_CURVE('',#${a},#${b},#${ln},.T.)`);
      };
      const eb = [], et = [], ev = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, P = pts[i], Q = pts[j];
        eb.push(lineE(vb[i], vb[j], [P[0] + dx, P[1], 0], [Q[0] + dx, Q[1], 0]));
        et.push(lineE(vt[i], vt[j], [P[0] + dx, P[1], h], [Q[0] + dx, Q[1], h]));
        ev.push(lineE(vb[i], vt[i], [P[0] + dx, P[1], 0], [P[0] + dx, P[1], h]));
      }
      return { pts, n, eb, et, ev };
    });
    const oe = (e, sense) => w.add(`ORIENTED_EDGE('',*,*,#${e},${sense ? '.T.' : '.F.'})`);
    // Side faces.
    for (const lp of L) {
      for (let i = 0; i < lp.n; i++) {
        const j = (i + 1) % lp.n, P = lp.pts[i], Q = lp.pts[j];
        const d = [Q[0] - P[0], Q[1] - P[1]], len = Math.hypot(d[0], d[1]);
        const nrm = [d[1] / len, -d[0] / len];             // outward for CCW outer loops and CW holes
        const ax = w.add(`AXIS2_PLACEMENT_3D('',#${w.pt(P[0] + dx, P[1], 0)},#${w.dir(nrm[0], nrm[1], 0)},#${w.dir(d[0] / len, d[1] / len, 0)})`);
        const plane = w.add(`PLANE('',#${ax})`);
        const loop = w.add(`EDGE_LOOP('',(#${oe(lp.eb[i], true)},#${oe(lp.ev[j], true)},#${oe(lp.et[i], false)},#${oe(lp.ev[i], false)}))`);
        faces.push(w.add(`ADVANCED_FACE('',(#${w.add(`FACE_OUTER_BOUND('',#${loop},.T.)`)}),#${plane},.T.)`));
      }
    }
    // Top (+z) and bottom (−z) faces with inner bounds.
    const cap = (top) => {
      const bounds = L.map((lp, k) => {
        const idx = Array.from({ length: lp.n }, (_, i) => i);
        const edges = top ? idx.map(i => oe(lp.et[i], true)) : idx.reverse().map(i => oe(lp.eb[i], false));
        const loop = w.add(`EDGE_LOOP('',(${edges.map(e => '#' + e).join(',')}))`);
        return w.add(`${k === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',#${loop},.T.)`);
      });
      const ax = w.add(`AXIS2_PLACEMENT_3D('',#${w.pt(dx, 0, top ? h : 0)},#${top ? zD : zDn},#${xD})`);
      return w.add(`ADVANCED_FACE('',(${bounds.map(b => '#' + b).join(',')}),#${w.add(`PLANE('',#${ax})`)},.T.)`);
    };
    faces.push(cap(true), cap(false));
    const shell = w.add(`CLOSED_SHELL('',(${faces.map(f => '#' + f).join(',')}))`);
    return w.add(`MANIFOLD_SOLID_BREP(${strq(reg.name)},#${shell})`);
  }

  function stepFile(p, res, opt) {
    opt = opt || {};
    const scope = opt.scope || 'assembly';
    const name = opt.name || `Gerotor_N${p.N}_${scope}`;
    const w = Writer();
    const appCtx = w.add(`APPLICATION_CONTEXT('managed model based 3d engineering')`);
    w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','ap242_managed_model_based_3d_engineering',2014,#${appCtx})`);
    const prodCtx = w.add(`PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
    const prod = w.add(`PRODUCT(${strq(name)},${strq(name)},${strq(`Gerotor N=${p.N}, e=${p.e}, R=${p.R}, rp=${p.rp}, c=${p.c}, b=${p.b} mm`)},(#${prodCtx}))`);
    w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#${prod}))`);
    const pdf = w.add(`PRODUCT_DEFINITION_FORMATION('1','',#${prod})`);
    const pdCtx = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);
    const pd = w.add(`PRODUCT_DEFINITION('design','',#${pdf},#${pdCtx})`);
    const pds = w.add(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
    const mm = w.add(`(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))`);
    const rad = w.add(`(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))`);
    const sr = w.add(`(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())`);
    const unc = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#${mm},'distance_accuracy_value','confusion accuracy')`);
    const ctx = w.add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${mm},#${rad},#${sr})) REPRESENTATION_CONTEXT('Context3D','3D Context with UNIT and UNCERTAINTY'))`);
    const origin = w.add(`AXIS2_PLACEMENT_3D('',#${w.pt(0, 0, 0)},#${w.dir(0, 0, 1)},#${w.dir(1, 0, 0)})`);
    const solids = regions(p, scope, res, opt.tol).map(r => solid(w, r, p.b));
    const rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${strq(name)},(#${origin},${solids.map(s => '#' + s).join(',')}),#${ctx})`);
    w.add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${rep})`);

    const now = (opt.date || new Date().toISOString()).slice(0, 19);
    const header = [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION(('Gerotor rotor set, B-rep solids (faceted)'),'2;1');`,
      `FILE_NAME(${strq(name + '.step')},${strq(now)},('Gerotor Design Tool'),(''),'Gerotor Design Tool','Gerotor Design Tool','');`,
      `FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));`,
      'ENDSEC;',
      'DATA;',
    ];
    return header.join('\n') + '\n' + w.lines.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n';
  }

  /*
   * Structural check of a STEP text produced here: every #ref defined; per closed shell every
   * EDGE_CURVE used exactly twice with opposite senses; Euler–Poincaré V − E + F − (L − F) = 2(1 − G);
   * enclosed volume by the divergence theorem over the planar faces.
   */
  function checkStep(text) {
    const ent = new Map();
    for (const m of text.matchAll(/^#(\d+)=(.*);$/gm)) ent.set(+m[1], m[2]);
    let missing = 0;
    for (const body of ent.values()) for (const r of body.matchAll(/#(\d+)/g)) if (!ent.has(+r[1])) missing++;
    const refs = s => [...s.matchAll(/#(\d+)/g)].map(r => +r[1]);
    const point = idn => { const m = /CARTESIAN_POINT\('',\(([^)]*)\)\)/.exec(ent.get(idn)); return m[1].split(',').map(Number); };
    const vertexPt = v => point(refs(ent.get(v))[0]);
    const shells = [];
    for (const [k, body] of ent) {
      if (!body.startsWith('MANIFOLD_SOLID_BREP')) continue;
      const shell = refs(body)[0], faces = refs(ent.get(shell));
      const use = new Map(), verts = new Set();
      let loops = 0, vol = 0;
      for (const f of faces) {
        const fb = refs(ent.get(f));
        const bounds = fb.slice(0, -1);
        for (const b of bounds) {
          loops++;
          const loop = refs(ent.get(b))[0];
          const poly = [];
          for (const o of refs(ent.get(loop))) {
            const ob = ent.get(o), e = refs(ob)[0], sense = /\.T\.\)$/.test(ob);
            const u = use.get(e) || { t: 0, f: 0 };
            sense ? u.t++ : u.f++;
            use.set(e, u);
            const [v1, v2] = refs(ent.get(e));
            verts.add(v1); verts.add(v2);
            poly.push(vertexPt(sense ? v1 : v2));
          }
          // Divergence theorem: V = 1/3 Σ_faces (n·x0) A = 1/6 Σ triangle fans (x0 · (x1 × x2)) over the loops.
          for (let i = 1; i + 1 < poly.length; i++) {
            const a = poly[0], b2 = poly[i], c = poly[i + 1];
            vol += (a[0] * (b2[1] * c[2] - b2[2] * c[1]) - a[1] * (b2[0] * c[2] - b2[2] * c[0]) + a[2] * (b2[0] * c[1] - b2[1] * c[0])) / 6;
          }
        }
      }
      let bad = 0;
      for (const u of use.values()) if (u.t !== 1 || u.f !== 1) bad++;
      const V = verts.size, E = use.size, F = faces.length;
      shells.push({ name: /'([^']*)'/.exec(body)[1], V, E, F, loops, euler: V - E + F - (loops - F), badEdges: bad, volume: vol });
    }
    return { entities: ent.size, missingRefs: missing, shells };
  }

  G.step = { stepFile, checkStep, regions, signedArea, simplifyClosed, DEFAULT_TOL };
})(window.Gerotor);
