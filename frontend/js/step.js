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

  // Exact regions: arcs (outer rotor, OD, bore) and B-splines (inner profile) as segment loops.
  function exactRegions(p, scope, tol) {
    tol = tol || DEFAULT_TOL;
    const out = [];
    if (scope !== 'inner') {
      out.push({ name: 'OuterRotor', outer: orientSegs(circleSegs([0, 0], p.OD / 2), true), holes: [orientSegs(outerProfileSegs(p), false)], dx: 0 });
    }
    if (scope !== 'outer') {
      const prof = innerProfileSegs(p, tol);
      const holes = p.bore > 0 ? [orientSegs(circleSegs([0, 0], p.bore / 2), false)] : [];
      const outer = orientSegs(prof, true);
      out.push({ name: 'InnerRotor', outer, holes, dx: scope === 'assembly' ? p.e : 0, maxDev: prof.maxDev, ctrlCount: prof.ctrlCount });
    }
    return out;
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

  // ------------------------------------------------------------------ exact profile segments
  //
  // A loop is a list of segments { a, b, kind: 'line' | 'arc' | 'spline', … } with b of one segment
  // = a of the next. arc: centre c, radius r, ccw (traversal a → b counter-clockwise about +z).
  // spline: clamped cubic B-spline { ctrl, knots } parameterised along the traversal.

  const linesFromPts = pts => pts.map((a, i) => ({ kind: 'line', a, b: pts[(i + 1) % pts.length] }));

  function reverseLoop(segs) {
    return segs.slice().reverse().map(s => {
      const r = Object.assign({}, s, { a: s.b, b: s.a });
      if (s.kind === 'arc') r.ccw = !s.ccw;
      if (s.kind === 'spline') { r.ctrl = s.ctrl.slice().reverse(); r.knots = s.knots.slice().reverse().map(u => 1 - u); }
      return r;
    });
  }

  // Sample points of a segment (for orientation / checks).
  function segPoints(s, n) {
    if (s.kind === 'line') return [s.a];
    if (s.kind === 'arc') {
      const t0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]);
      let d = Math.atan2(s.b[1] - s.c[1], s.b[0] - s.c[0]) - t0;
      if (s.ccw && d <= 0) d += TAU; if (!s.ccw && d >= 0) d -= TAU;
      return Array.from({ length: n }, (_, i) => [s.c[0] + s.r * Math.cos(t0 + d * i / n), s.c[1] + s.r * Math.sin(t0 + d * i / n)]);
    }
    return Array.from({ length: n }, (_, i) => bsplinePoint(s, i / n));
  }
  const loopArea = segs => signedArea(segs.flatMap(s => segPoints(s, 16)));
  const orientSegs = (segs, ccw) => (loopArea(segs) > 0) === ccw ? segs : reverseLoop(segs);

  // Arc segment from polar angle t0 swept by d about centre c.
  const arcSeg = (c, r, t0, d) => ({ kind: 'arc', c, r, ccw: d > 0,
    a: [c[0] + r * Math.cos(t0), c[1] + r * Math.sin(t0)], b: [c[0] + r * Math.cos(t0 + d), c[1] + r * Math.sin(t0 + d)] });

  // Full circle as four quarter arcs.
  const circleSegs = (c, r) => [0, 1, 2, 3].map(i => arcSeg(c, r, i * Math.PI / 2, Math.PI / 2));

  // Outer rotor lobed profile as exact arcs: lobe, fillet, valley, fillet per pitch.
  function outerProfileSegs(p) {
    const L = G.lobeLimits(p), segs = [], rot = (q, a) => [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
    for (let k = 0; k < p.N; k++) {
      const th = TAU * k / p.N, C = [p.R * Math.cos(th), p.R * Math.sin(th)];
      // Lobe k: point at ψ sits at circle angle α = θ − ψ + π; ψ from −ψmax to +ψmax.
      segs.push(arcSeg(C, p.rp, th + L.psiMax + Math.PI, -2 * L.psiMax));
      if (L.fillets) { const f = L.fillets[0]; segs.push(arcSeg(rot(f.c, th), p.fillet, f.a0 + th, f.d)); }
      if (L.hasValley) segs.push(arcSeg([0, 0], p.Rv, th + L.beta, TAU / p.N - 2 * L.beta));
      if (L.fillets) { const f = L.fillets[1]; segs.push(arcSeg(rot(f.c, th), p.fillet, f.a0 + th, f.d)); }
    }
    // Snap consecutive end/start points (they coincide analytically).
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i], t = segs[(i + 1) % segs.length];
      if (Math.hypot(s.b[0] - t.a[0], s.b[1] - t.a[1]) > 1e-6) throw new Error('outer profile arcs do not join');
      t.a = s.b;
    }
    return segs;
  }

  // ---- cubic B-spline interpolation with end derivatives (Piegl & Tiller §9.2.2)

  function basis(U, u) {                     // all cubic basis functions at u (clamped knots)
    const m = U.length - 1, nCtrl = m - 3, N = new Float64Array(nCtrl);
    let span = 3;
    if (u >= U[nCtrl]) span = nCtrl - 1;
    else while (span < nCtrl - 1 && !(u >= U[span] && u < U[span + 1])) span++;
    const left = [0, 0, 0, 0], right = [0, 0, 0, 0], Nl = [1, 0, 0, 0];
    for (let j = 1; j <= 3; j++) {
      left[j] = u - U[span + 1 - j]; right[j] = U[span + j] - u;
      let saved = 0;
      for (let r = 0; r < j; r++) {
        const tmp = Nl[r] / (right[r + 1] + left[j - r]);
        Nl[r] = saved + right[r + 1] * tmp; saved = left[j - r] * tmp;
      }
      Nl[j] = saved;
    }
    for (let j = 0; j <= 3; j++) N[span - 3 + j] = Nl[j];
    return N;
  }

  function bsplinePoint(s, u) {
    const N = basis(s.knots, Math.min(Math.max(u, 0), 1));
    let x = 0, y = 0;
    for (let j = 0; j < N.length; j++) if (N[j]) { x += N[j] * s.ctrl[j][0]; y += N[j] * s.ctrl[j][1]; }
    return [x, y];
  }

  function solveDense(A, B) {                // Gaussian elimination with partial pivoting; B: columns
    const n = A.length;
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        if (!f) continue;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        for (let k = 0; k < B[r].length; k++) B[r][k] -= f * B[c][k];
      }
    }
    const X = B.map(row => row.slice());
    for (let r = n - 1; r >= 0; r--) {
      for (let k = 0; k < X[r].length; k++) {
        let s = X[r][k];
        for (let c = r + 1; c < n; c++) s -= A[r][c] * X[c][k];
        X[r][k] = s / A[r][r];
      }
    }
    return X;
  }

  function interpolate(Q, D0, Dn) {
    const n = Q.length - 1, ub = [0];
    let total = 0;
    for (let k = 1; k <= n; k++) total += Math.hypot(Q[k][0] - Q[k - 1][0], Q[k][1] - Q[k - 1][1]);
    for (let k = 1; k <= n; k++) ub.push(ub[k - 1] + Math.hypot(Q[k][0] - Q[k - 1][0], Q[k][1] - Q[k - 1][1]) / total);
    ub[n] = 1;
    const U = [0, 0, 0, 0, ...ub.slice(1, n), 1, 1, 1, 1];
    const m = n + 3, P = new Array(m);
    P[0] = Q[0]; P[m - 1] = Q[n];
    P[1] = [Q[0][0] + U[4] / 3 * D0[0] * total, Q[0][1] + U[4] / 3 * D0[1] * total];
    P[m - 2] = [Q[n][0] - (1 - U[n + 2]) / 3 * Dn[0] * total, Q[n][1] - (1 - U[n + 2]) / 3 * Dn[1] * total];
    // Rows k = 1 … n−1 for the unknowns P[2] … P[n].
    const A = [], B = [];
    for (let k = 1; k <= n - 1; k++) {
      const N = basis(U, ub[k]), row = new Array(n - 1).fill(0);
      let bx = Q[k][0], by = Q[k][1];
      for (let j = 0; j < m; j++) {
        if (!N[j]) continue;
        if (j >= 2 && j <= n) row[j - 2] = N[j];
        else { bx -= N[j] * P[j][0]; by -= N[j] * P[j][1]; }
      }
      A.push(row); B.push([bx, by]);
    }
    if (n >= 2) solveDense(A, B).forEach((x, i) => { P[i + 2] = x; });
    return { kind: 'spline', ctrl: P, knots: U, a: Q[0], b: Q[n] };
  }

  // Inner rotor profile: one interpolating cubic B-spline per tooth (G1 joints), refined until the
  // deviation from a dense reference profile is ≤ tol.
  function innerProfileSegs(p, tol) {
    const off = p.rp + p.c, teeth = p.N - 1, per = TAU / teeth;
    const tangent = phi => {
      const e = 1e-6, a = G.innerPoint(p, phi - e, off), b = G.innerPoint(p, phi + e, off);
      const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]);
      return [d[0] / L, d[1] / L];
    };
    const segs = [];
    let maxDev = 0, ctrlCount = 0;
    for (let j = 0; j < teeth; j++) {
      const ph0 = per * j, ph1 = per * (j + 1);
      const ref = Array.from({ length: 1201 }, (_, i) => G.innerPoint(p, ph0 + (ph1 - ph0) * i / 1200, off));
      let seg = null, dev = Infinity;
      for (let K = 24; K <= 1200 && dev > tol; K *= 2) {
        const Q = Array.from({ length: K + 1 }, (_, i) => ref[Math.round(i * 1200 / K)]);
        seg = interpolate(Q, tangent(ph0), tangent(ph1));
        // Deviation: reference points vs a fine polyline of the spline (local nearest segment).
        const S = Array.from({ length: 12 * K + 1 }, (_, i) => bsplinePoint(seg, i / (12 * K)));
        dev = 0;
        let ptr = 0;
        for (const q of ref) {
          let best = Infinity;
          for (let k = Math.max(0, ptr - 30); k < Math.min(S.length - 1, ptr + 60); k++) {
            const a = S[k], b = S[k + 1], t = [b[0] - a[0], b[1] - a[1]], L2 = t[0] * t[0] + t[1] * t[1];
            const u = L2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * t[0] + (q[1] - a[1]) * t[1]) / L2)) : 0;
            const dd = Math.hypot(q[0] - a[0] - u * t[0], q[1] - a[1] - u * t[1]);
            if (dd < best) { best = dd; ptr = k; }
          }
          dev = Math.max(dev, best);
        }
      }
      maxDev = Math.max(maxDev, dev);
      ctrlCount += seg.ctrl.length;
      segs.push(seg);
    }
    for (let i = 0; i < segs.length; i++) segs[(i + 1) % segs.length].a = segs[i].b;   // shared joint points
    segs.maxDev = maxDev; segs.ctrlCount = ctrlCount;
    return segs;
  }

  // Solid of one region (loops of segments) extruded over z = 0 … h; returns the MANIFOLD_SOLID_BREP id.
  function solid(w, reg, h) {
    const dx = reg.dx || 0;
    const loops = [reg.outer, ...reg.holes].map(l => Array.isArray(l[0]) ? linesFromPts(l) : l);
    const faces = [];
    const zD = w.dir(0, 0, 1), zDn = w.dir(0, 0, -1), xD = w.dir(1, 0, 0);
    const P3 = (q, z) => [q[0] + dx, q[1], z];
    const lineCurve = (A, B) => {
      const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], len = Math.hypot(...d);
      return w.add(`LINE('',#${w.pt(...A)},#${w.add(`VECTOR('',#${w.dir(d[0] / len, d[1] / len, d[2] / len)},${fmt(len)})`)})`);
    };
    const curveAt = (s, z) => {
      if (s.kind === 'line') return { id: lineCurve(P3(s.a, z), P3(s.b, z)), sense: true };
      if (s.kind === 'arc') {
        const ax = w.add(`AXIS2_PLACEMENT_3D('',#${w.pt(s.c[0] + dx, s.c[1], z)},#${zD},#${xD})`);
        return { id: w.add(`CIRCLE('',#${ax},${fmt(s.r)})`), sense: s.ccw };
      }
      const pts = s.ctrl.map(q => '#' + w.pt(q[0] + dx, q[1], z)).join(',');
      const uniq = [], mult = [];
      for (const u of s.knots) { if (uniq.length && Math.abs(u - uniq[uniq.length - 1]) < 1e-14) mult[mult.length - 1]++; else { uniq.push(u); mult.push(1); } }
      return { id: w.add(`B_SPLINE_CURVE_WITH_KNOTS('',3,(${pts}),.UNSPECIFIED.,.F.,.F.,(${mult.join(',')}),(${uniq.map(fmt).join(',')}),.UNSPECIFIED.)`), sense: true };
    };
    // Vertices and edges per loop.
    const L = loops.map(segs => {
      const n = segs.length, vb = [], vt = [];
      for (const s of segs) {
        vb.push(w.add(`VERTEX_POINT('',#${w.pt(...P3(s.a, 0))})`));
        vt.push(w.add(`VERTEX_POINT('',#${w.pt(...P3(s.a, h))})`));
      }
      const eb = [], et = [], ev = [], cb = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, s = segs[i];
        const b = curveAt(s, 0), t = curveAt(s, h);
        cb.push(b.id);
        eb.push(w.add(`EDGE_CURVE('',#${vb[i]},#${vb[j]},#${b.id},${b.sense ? '.T.' : '.F.'})`));
        et.push(w.add(`EDGE_CURVE('',#${vt[i]},#${vt[j]},#${t.id},${t.sense ? '.T.' : '.F.'})`));
        ev.push(w.add(`EDGE_CURVE('',#${vb[i]},#${vt[i]},#${lineCurve(P3(s.a, 0), P3(s.a, h))},.T.)`));
      }
      return { segs, n, eb, et, ev, cb };
    });
    const oe = (e, sense) => w.add(`ORIENTED_EDGE('',*,*,#${e},${sense ? '.T.' : '.F.'})`);
    // Side faces: plane (line), cylinder (arc), linear extrusion (B-spline).
    for (const lp of L) {
      for (let i = 0; i < lp.n; i++) {
        const j = (i + 1) % lp.n, s = lp.segs[i];
        let surf, same = true;
        if (s.kind === 'line') {
          const d = [s.b[0] - s.a[0], s.b[1] - s.a[1]], len = Math.hypot(d[0], d[1]);
          const nrm = [d[1] / len, -d[0] / len];           // outward for CCW outer loops and CW holes
          surf = w.add(`PLANE('',#${w.add(`AXIS2_PLACEMENT_3D('',#${w.pt(...P3(s.a, 0))},#${w.dir(nrm[0], nrm[1], 0)},#${w.dir(d[0] / len, d[1] / len, 0)})`)})`);
        } else if (s.kind === 'arc') {
          surf = w.add(`CYLINDRICAL_SURFACE('',#${w.add(`AXIS2_PLACEMENT_3D('',#${w.pt(s.c[0] + dx, s.c[1], 0)},#${zD},#${xD})`)},${fmt(s.r)})`);
          same = s.ccw;                                     // outward normal = radial outward iff traversed CCW
        } else {
          surf = w.add(`SURFACE_OF_LINEAR_EXTRUSION('',#${lp.cb[i]},#${w.add(`VECTOR('',#${zD},${fmt(h)})`)})`);
        }
        const loop = w.add(`EDGE_LOOP('',(#${oe(lp.eb[i], true)},#${oe(lp.ev[j], true)},#${oe(lp.et[i], false)},#${oe(lp.ev[i], false)}))`);
        faces.push(w.add(`ADVANCED_FACE('',(#${w.add(`FACE_OUTER_BOUND('',#${loop},.T.)`)}),#${surf},${same ? '.T.' : '.F.'})`));
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
    const regs = opt.mode === 'facet' ? regions(p, scope, res, opt.tol) : exactRegions(p, scope, opt.tol);
    const solids = regs.map(r => solid(w, r, p.b));
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

  G.step = { stepFile, checkStep, regions, exactRegions, signedArea, simplifyClosed, DEFAULT_TOL,
    interpolate, bsplinePoint, outerProfileSegs, innerProfileSegs, segPoints, loopArea };
})(window.Gerotor);
