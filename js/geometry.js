/*
 * Gerotor geometry & analysis core.
 *
 * Classic gerotor: outer rotor has N circular lobes (radius rp) whose centres lie
 * on a circle of radius R; inner rotor has N-1 teeth whose profile is the conjugate
 * envelope of the lobes. Outer rotor centre O2 = (0,0), inner rotor centre O1 = (e,0).
 *
 * Kinematics: outer rotor angle t, inner rotor angle a1 = N t / (N-1).
 * Seen from the inner rotor, a lobe centre traces the trochoid
 *     Q(phi) = R e^{i phi} - e e^{i N phi}
 * and the inner profile is Q offset inward by rp (plus clearance).
 *
 * Units: mm, rad.
 */
(function (global) {
  'use strict';

  const TAU = 2 * Math.PI;

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const rot = (p, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [c * p[0] - s * p[1], s * p[0] + c * p[1]];
  };
  const add = (p, q) => [p[0] + q[0], p[1] + q[1]];

  function linspace(a, b, n) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = a + (b - a) * i / (n - 1);
    return out;
  }

  // Signed area swept from the origin along an open polyline (Green's theorem term).
  function sectorSum(pts) {
    let s = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
    }
    return s / 2;
  }

  function polygonArea(pts) {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  // ---------------------------------------------------------------- inner rotor

  function trochoid(p, phi) {
    return [
      p.R * Math.cos(phi) - p.e * Math.cos(p.N * phi),
      p.R * Math.sin(phi) - p.e * Math.sin(p.N * phi),
    ];
  }

  function trochoidD1(p, phi) {
    const Ne = p.N * p.e;
    return [
      -p.R * Math.sin(phi) + Ne * Math.sin(p.N * phi),
      p.R * Math.cos(phi) - Ne * Math.cos(p.N * phi),
    ];
  }

  function trochoidD2(p, phi) {
    const N2e = p.N * p.N * p.e;
    return [
      -p.R * Math.cos(phi) + N2e * Math.cos(p.N * phi),
      -p.R * Math.sin(phi) + N2e * Math.sin(p.N * phi),
    ];
  }

  // Signed radius of curvature of the trochoid; positive where it is convex.
  function trochoidCurvatureRadius(p, phi) {
    const d1 = trochoidD1(p, phi), d2 = trochoidD2(p, phi);
    const L = Math.hypot(d1[0], d1[1]);
    return (L * L * L) / (d1[0] * d2[1] - d1[1] * d2[0]);
  }

  // Inner rotor profile point (inner-rotor frame), trochoid offset inward by `offset`.
  function innerPoint(p, phi, offset) {
    const q = trochoid(p, phi), d = trochoidD1(p, phi);
    const L = Math.hypot(d[0], d[1]);
    return [q[0] - offset * d[1] / L, q[1] + offset * d[0] / L];
  }

  function innerProfile(p, n, offset) {
    const pts = new Array(n);
    for (let i = 0; i < n; i++) pts[i] = innerPoint(p, TAU * i / n, offset);
    return pts;
  }

  function trochoidCurve(p, n) {
    const pts = new Array(n);
    for (let i = 0; i < n; i++) pts[i] = trochoid(p, TAU * i / n);
    return pts;
  }

  // ---------------------------------------------------------------- outer rotor

  /*
   * A lobe point is parametrised by psi: 0 = lobe tip (closest to O2), positive psi
   * towards the next lobe (CCW). The usable arc ends where it meets either the
   * valley circle Rv or the neighbouring lobe.
   */
  function lobeLimits(p) {
    const { N, R, rp, Rv } = p;
    const c = (R * R + rp * rp - Rv * Rv) / (2 * R * rp);
    const psiValley = c <= -1 ? Math.PI : (c >= 1 ? 0 : Math.acos(c));
    const half = Math.PI / N;
    const disc = rp * rp - Math.pow(R * Math.sin(half), 2);
    let psiNeighbour = Infinity;
    if (disc >= 0) {
      const t1 = R * Math.cos(half) - Math.sqrt(disc);
      psiNeighbour = Math.acos(clamp((R * R + rp * rp - t1 * t1) / (2 * R * rp), -1, 1));
    }
    const hasValley = psiValley < psiNeighbour;
    const psiMax = Math.min(psiValley, psiNeighbour);
    const beta = Math.atan2(rp * Math.sin(psiMax), R - rp * Math.cos(psiMax));
    const L = { psiMax, beta, hasValley, lobesOverlap: disc > 0, psiMaxRaw: psiMax };
    if (p.fillet > 0) addFillet(p, L);
    return L;
  }

  /*
   * Fillet of radius rf between lobe arc and valley circle (outer rotor). Its centre F is
   * internally tangent to the valley circle (|F| = Rv − rf) and externally tangent to the
   * lobe (|F − C| = rp + rf). The lobe arc then ends at ψF and the valley arc starts at the
   * polar angle γ of F. L.psiMax / L.beta are replaced by ψF / γ, and the two fillet arcs of
   * the k = 0 pitch are stored (trailing side of lobe 0, leading side of lobe 1).
   */
  function addFillet(p, L) {
    const { N, R, rp, Rv } = p, rf = p.fillet;
    if (!L.hasValley) { L.filletError = 'no valley arc (lobes intersect)'; return; }
    const rF = Rv - rf;
    const cg = (R * R + rF * rF - (rp + rf) * (rp + rf)) / (2 * R * rF);
    if (!(rF > 0) || Math.abs(cg) > 1) { L.filletError = 'fillet does not fit between lobe and valley'; return; }
    const gamma = Math.acos(cg);
    const F = [rF * Math.cos(gamma), rF * Math.sin(gamma)];
    const T1 = [R + rp * (F[0] - R) / (rp + rf), rp * F[1] / (rp + rf)];
    const psiF = lobePsi(p, 0, T1);
    if (!(gamma < Math.PI / N) || !(psiF > 0) || !(psiF < L.psiMax)) { L.filletError = 'fillet too large for the lobe pitch'; return; }
    const J = lobePoint(p, 0, L.psiMax);                     // original sharp corner
    const arc = (Fc, A, B) => {
      const aa = Math.atan2(A[1] - Fc[1], A[0] - Fc[0]), ab = Math.atan2(B[1] - Fc[1], B[0] - Fc[0]);
      let d = Math.atan2(Math.sin(ab - aa), Math.cos(ab - aa));
      const m = [Fc[0] + rf * Math.cos(aa + d / 2), Fc[1] + rf * Math.sin(aa + d / 2)];
      if (Math.hypot(m[0] - J1(Fc)[0], m[1] - J1(Fc)[1]) > Math.hypot(Fc[0] - J1(Fc)[0], Fc[1] - J1(Fc)[1])) d -= Math.sign(d) * TAU;
      return { c: Fc, a0: aa, d };
    };
    // Corner nearest to a fillet centre (trailing corner of lobe 0 or leading corner of lobe 1).
    const th1 = TAU / N, J1pt = rot([J[0], -J[1]], th1);
    const J1 = Fc => (Math.hypot(Fc[0] - J[0], Fc[1] - J[1]) < Math.hypot(Fc[0] - J1pt[0], Fc[1] - J1pt[1]) ? J : J1pt);
    const T2 = [Rv * Math.cos(gamma), Rv * Math.sin(gamma)];
    const F1 = rot([F[0], -F[1]], th1), T2b = rot([T2[0], -T2[1]], th1), T1b = rot([T1[0], -T1[1]], th1);
    L.fillets = [arc(F, T1, T2), arc(F1, T2b, T1b)];
    L.psiMax = psiF;
    L.beta = gamma;
    L.filletCentre = F;
  }

  function filletPoints(p, L, k, which, n) {
    if (!L.fillets) return [];
    const f = L.fillets[which], th = TAU * k / p.N, pts = [];
    for (let i = 1; i < n - 1; i++) {
      const a = f.a0 + f.d * i / (n - 1);
      pts.push(rot([f.c[0] + p.fillet * Math.cos(a), f.c[1] + p.fillet * Math.sin(a)], th));
    }
    return pts;
  }

  function lobePoint(p, k, psi) {
    const th = TAU * k / p.N, cu = Math.cos(th), su = Math.sin(th);
    const a = p.R - p.rp * Math.cos(psi), b = p.rp * Math.sin(psi);
    return [a * cu - b * su, a * su + b * cu];
  }

  // psi of a point lying on lobe k (outer-rotor frame).
  function lobePsi(p, k, pt) {
    const th = TAU * k / p.N, cu = Math.cos(th), su = Math.sin(th);
    const wx = pt[0] - p.R * cu, wy = pt[1] - p.R * su;
    return Math.atan2(-wx * su + wy * cu, -(wx * cu + wy * su));
  }

  function valleyPoints(p, L, k, n) {
    if (!L.hasValley) return [];
    const a0 = TAU * k / p.N + L.beta, a1 = TAU * (k + 1) / p.N - L.beta;
    return linspace(a0, a1, n).slice(1, -1).map(a => [p.Rv * Math.cos(a), p.Rv * Math.sin(a)]);
  }

  function outerProfile(p, nLobe, nValley, L) {
    L = L || lobeLimits(p);
    const pts = [];
    for (let k = 0; k < p.N; k++) {
      for (const psi of linspace(-L.psiMax, L.psiMax, nLobe)) pts.push(lobePoint(p, k, psi));
      pts.push(...filletPoints(p, L, k, 0, nValley));
      pts.push(...valleyPoints(p, L, k, nValley));
      pts.push(...filletPoints(p, L, k, 1, nValley));
    }
    return pts;
  }

  // Outer profile from psiA on lobe k to psiB on lobe k+1 (outer-rotor frame).
  function outerPath(p, L, k, psiA, psiB, n) {
    const pts = linspace(psiA, L.psiMax, n).map(psi => lobePoint(p, k, psi));
    pts.push(...filletPoints(p, L, k, 0, n));
    pts.push(...valleyPoints(p, L, k, n));
    pts.push(...filletPoints(p, L, k, 1, n));
    for (const psi of linspace(-L.psiMax, psiB, n)) pts.push(lobePoint(p, k + 1, psi));
    return pts;
  }

  // ---------------------------------------------------------------- kinematics

  function innerAngle(p, t) { return p.N * t / (p.N - 1); }

  // ---------------------------------------------------------------- exact sector integrals
  //
  // S = ½∫(x dy − y dx) about O2. Chamber area = S(outer path) − S(inner path)
  // between the two contact points (Green's theorem; Rundo 2017 Eq. 22).

  // Circular arc of centre c, radius r, from polar angle α0 to α1 (about c).
  function arcSector(c, r, a0, a1) {
    return 0.5 * (r * r * (a1 - a0) + r * (c[0] * (Math.sin(a1) - Math.sin(a0)) - c[1] * (Math.cos(a1) - Math.cos(a0))));
  }

  // Lobe k point at ψ sits at circle angle α = θk − ψ + π about the lobe centre.
  function lobeSector(p, k, psiA, psiB) {
    const th = TAU * k / p.N;
    return arcSector([p.R * Math.cos(th), p.R * Math.sin(th)], p.rp, th - psiA + Math.PI, th - psiB + Math.PI);
  }

  function outerSector(p, L, psiA, psiB) {
    let s = lobeSector(p, 0, psiA, L.psiMax) + lobeSector(p, 1, -L.psiMax, psiB);
    if (L.hasValley) s += 0.5 * p.Rv * p.Rv * (TAU / p.N - 2 * L.beta);
    if (L.fillets) for (const f of L.fillets) s += arcSector(f.c, p.fillet, f.a0, f.a0 + f.d);
    return s;
  }

  // 8-point Gauss–Legendre nodes/weights on [−1, 1].
  const GLX = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498,
    0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
  const GLW = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620,
    0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

  /*
   * Inner profile P(φ) = Q − r·n (inner frame) maps to X = Rot(a1)·P + C1.
   * P' = Q'·(1 − r·κ) for the offset curve, so
   *   ½∫ X × X' dφ = ½∫ P × P' dφ + ½ C1 × Rot(a1)·(P(φ1) − P(φ0)).
   */
  function innerSector(p, phi0, phi1, a1, C1, nSub, offset) {
    nSub = nSub || 24;                   // converged to ~1e-10 relative on sharp-tipped designs
    const r = offset === undefined ? p.rp : offset, h = (phi1 - phi0) / nSub;
    let s = 0;
    for (let m = 0; m < nSub; m++) {
      const mid = phi0 + (m + 0.5) * h;
      for (let i = 0; i < 8; i++) {
        const ph = mid + 0.5 * h * GLX[i];
        const q = trochoid(p, ph), d1 = trochoidD1(p, ph), d2 = trochoidD2(p, ph);
        const sp = d1[0] * d1[0] + d1[1] * d1[1], L = Math.sqrt(sp);
        const kap = (d1[0] * d2[1] - d1[1] * d2[0]) / (sp * L);
        const P = [q[0] - r * d1[1] / L, q[1] + r * d1[0] / L];
        const f = 1 - r * kap;
        s += GLW[i] * 0.5 * h * (P[0] * d1[1] * f - P[1] * d1[0] * f);
      }
    }
    const dP = rot([innerPoint(p, phi1, r)[0] - innerPoint(p, phi0, r)[0], innerPoint(p, phi1, r)[1] - innerPoint(p, phi0, r)[1]], a1);
    return 0.5 * s + 0.5 * (C1[0] * dP[1] - C1[1] * dP[0]);
  }

  /*
   * Actual chamber area with profile clearance c: outer path between the lobe contacts,
   * closed by the normal segments to the clearance-offset inner profile (offset rp + c).
   */
  function chamberActualArea(p, t, L) {
    const a1 = innerAngle(p, t), C1 = [p.e, 0];
    const phi0 = -t / (p.N - 1), phi1 = phi0 + TAU / p.N, off = p.rp + Math.max(0, p.c);
    const fx = q => add(rot(q, a1), C1);
    const c0 = fx(innerPoint(p, phi0, p.rp)), c1 = fx(innerPoint(p, phi1, p.rp));
    const i0 = fx(innerPoint(p, phi0, off)), i1 = fx(innerPoint(p, phi1, off));
    const psi0 = lobePsi(p, 0, rot(c0, -t)), psi1 = lobePsi(p, 1, rot(c1, -t));
    const cross = (A, B) => 0.5 * (A[0] * B[1] - A[1] * B[0]);
    return outerSector(p, L, psi0, psi1) + cross(c1, i1) - innerSector(p, phi0, phi1, a1, C1, 24, off) + cross(i0, c0);
  }

  /*
   * Minimum radial clearance between the fillet arcs and the inner rotor (clearance profile)
   * over one revolution [mm]; negative = the inner teeth cut into the fillets.
   */
  function filletClearance(p, L) {
    if (!L.fillets) return Infinity;
    const n = 3000, ang = new Float64Array(n), rad = new Float64Array(n);
    const prof = innerProfile(p, n, p.rp + Math.max(0, p.c)).map(q => [Math.atan2(q[1], q[0]), Math.hypot(q[0], q[1])]);
    prof.sort((a, b) => a[0] - b[0]);
    prof.forEach((q, i) => { ang[i] = q[0]; rad[i] = q[1]; });
    const radiusAt = a => {
      let lo = 0, hi = n - 1;
      if (a <= ang[0] || a >= ang[n - 1]) {                     // wrap-around segment
        const a0 = ang[n - 1] - TAU, f = (a < ang[0] ? a - a0 : a - TAU - a0) / (ang[0] - a0);
        return rad[n - 1] + (rad[0] - rad[n - 1]) * f;
      }
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ang[m] <= a) lo = m; else hi = m; }
      return rad[lo] + (rad[hi] - rad[lo]) * (a - ang[lo]) / (ang[hi] - ang[lo]);
    };
    const pts = [...filletPoints(p, L, 0, 0, 14), ...filletPoints(p, L, 0, 1, 14)];
    let worst = Infinity;
    const M = p.N * 64;
    for (let j = 0; j < M; j++) {
      const t = TAU * j / M, a1 = innerAngle(p, t);
      for (const P of pts) {
        const q = rot(sub2(rot(P, t), [p.e, 0]), -a1);
        worst = Math.min(worst, Math.hypot(q[0], q[1]) - radiusAt(Math.atan2(q[1], q[0])));
      }
    }
    return worst;
  }
  const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];

  /*
   * Chamber between lobe 0 and lobe 1 at outer-rotor angle t (theoretical, zero
   * clearance). Chamber k at time t equals chamber 0 at time t + 2*pi*k/N.
   * Area is exact (closed-form arcs + Gauss–Legendre on the inner profile);
   * the polygon (fixed frame) is only built when nIn > 0.
   */
  function chamber(p, t, L, nIn, nOut) {
    if (nIn === undefined) nIn = 64;
    nOut = nOut || 24;
    const a1 = innerAngle(p, t), C1 = [p.e, 0];
    const phi0 = -t / (p.N - 1), phi1 = phi0 + TAU / p.N;
    const c0 = add(rot(innerPoint(p, phi0, p.rp), a1), C1), c1 = add(rot(innerPoint(p, phi1, p.rp), a1), C1);
    const psi0 = lobePsi(p, 0, rot(c0, -t));
    const psi1 = lobePsi(p, 1, rot(c1, -t));
    // Volume derivative by the vector-ray method (Rundo 2017, Eq. 18), exact, per rad
    // of outer rotation: dA/dt = −½·N/(N−1)·[(ρD1² − ρD2²) + τ(ρd2² − ρd1²)], τ = (N−1)/N.
    const tau = (p.N - 1) / p.N;
    const rD = c => (c[0] - C1[0]) * (c[0] - C1[0]) + c[1] * c[1], rd = c => c[0] * c[0] + c[1] * c[1];
    const dAdt = -0.5 / tau * ((rD(c0) - rD(c1)) + tau * (rd(c1) - rd(c0)));
    if (nIn < 0) return { psi0, psi1, contacts: [c0, c1], dAdt };          // contacts only
    const area = outerSector(p, L, psi0, psi1) - innerSector(p, phi0, phi1, a1, C1);
    const out = { area, psi0, psi1, contacts: [c0, c1], dAdt };
    if (nIn > 1) {
      const inner = linspace(phi0, phi1, nIn).map(ph => add(rot(innerPoint(p, ph, p.rp), a1), C1));
      const outer = outerPath(p, L, 0, psi0, psi1, nOut).map(q => rot(q, t));
      out.polygon = inner.concat(outer.slice().reverse());
    }
    return out;
  }

  // ---------------------------------------------------------------- derived data

  function derive(p) {
    const Rv = p.RvAuto ? p.R + 2 * p.e - p.rp + p.RvClear : p.Rv;
    const q = Object.assign({}, p, { Rv });
    // Port arrangement (GDS terms) → internal flags:
    //   single: ports on one face, rotors pressed to the housing floor (floor friction);
    //   shadow: one-sided ports + shallow shadow ports opposite, rotors balanced;
    //   double: ports on both faces (double orifice area), rotors balanced.
    if (p.portLayout) {
      q.doubleFill = p.portLayout === 'double';
      q.faceSupport = p.portLayout === 'single' ? 'single' : 'balanced';
    }
    const innerRoot = p.R - p.e - p.rp - p.c;
    return Object.assign(q, {
      innerTip: p.R + p.e - p.rp - p.c,
      innerRoot,
      portRo: p.portRoAuto === false ? p.portRo : Rv,
      portRi: p.portRiAuto === false ? p.portRi : innerRoot,
      outerTip: p.R - p.rp,
      RvMin: p.R + 2 * p.e - p.rp,
      pitchInner: (p.N - 1) * p.e,
      pitchOuter: p.N * p.e,
      lambda: p.R / (p.N * p.e),
    });
  }

  function minConvexCurvature(p, n) {
    n = n || 4000;
    const span = TAU / (p.N - 1);
    let best = Infinity;
    for (let i = 0; i <= n; i++) {
      const r = trochoidCurvatureRadius(p, span * i / n);
      if (r > 0 && r < best) best = r;
    }
    return best;
  }

  /*
   * opts.samples: chamber samples per lobe pitch (default 96); opts.fast lowers
   * profile resolution and skips the port model (used by the design search).
   */
  function analyse(p, opts) {
    opts = opts || {};
    const res = { valid: false, checks: [] };
    const push = (level, title, detail) => res.checks.push({ level, title, detail });
    const f = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : '—';

    if (!(Number.isInteger(p.N) && p.N >= 3)) {
      push('err', 'Invalid lobe count', 'N must be an integer ≥ 3.');
      return res;
    }
    if (!(p.e > 0 && p.R > 0 && p.rp > 0)) {
      push('err', 'Non-positive dimension', 'e, R and rp must be greater than zero.');
      return res;
    }
    if (p.R <= p.N * p.e) {
      push('err', 'Trochoid forms loops', `R (${f(p.R)}) must exceed N·e (${f(p.N * p.e)}). λ = R/(N·e) = ${f(p.lambda, 3)}.`);
      return res;
    }

    const L = lobeLimits(p);
    res.lobe = L;
    if (p.fillet > 0) {
      if (L.filletError) {
        push('err', 'Invalid fillet', `Fillet radius ${f(p.fillet)} mm: ${L.filletError}.`);
        return res;
      }
      if (!opts.fast) {
        res.filletClearance = filletClearance(p, L);
        if (res.filletClearance < 0) push('err', 'Fillet hits inner rotor', `Inner teeth cut ${f(-res.filletClearance * 1000, 1)} µm into the fillets; reduce the fillet radius.`);
        else push('ok', 'Fillet clearance', `Min. radial clearance fillet ↔ inner rotor ${f(res.filletClearance, 3)} mm.`);
      }
    }
    res.rhoMin = minConvexCurvature(p, opts.fast ? 800 : 4000);

    // Undercut / pointed teeth on the inner rotor.
    const off = p.rp + p.c;
    if (off >= res.rhoMin) {
      push('err', 'Inner rotor undercut', `rp + c (${f(off)}) ≥ minimum trochoid radius of curvature ρmin (${f(res.rhoMin)}). Tooth tips self-intersect.`);
    } else if (off > 0.85 * res.rhoMin) {
      push('warn', 'Sharp inner rotor tips', `(rp + c) / ρmin = ${f(off / res.rhoMin, 3)}. Tips become sharp; wear and stress risk.`);
    } else {
      push('ok', 'No undercut', `(rp + c) / ρmin = ${f(off / res.rhoMin, 3)}.`);
    }

    // Outer rotor valley.
    if (p.Rv >= p.R + p.rp) {
      push('err', 'Lobes do not reach valley', `Rv (${f(p.Rv)}) must be < R + rp (${f(p.R + p.rp)}).`);
    } else if (!L.hasValley) {
      push('info', 'No valley arc', 'Adjacent lobes intersect inside the Rv circle; the outer profile consists of lobe arcs only.');
    }
    if (p.Rv < p.RvMin - Math.max(0, p.c) - 1e-9) {          // clearance c shortens the inner tooth tips
      push('err', 'Tooth tip hits valley', `Rv (${f(p.Rv)}) must be ≥ R + 2e − rp (${f(p.RvMin)}).`);
    } else {
      push('ok', 'Tip-to-valley clearance', `Rv − (R + 2e − rp) = ${f(p.Rv - p.RvMin, 3)} mm.`);
    }

    // Walls.
    const outerWall = p.OD / 2 - p.Rv;
    if (outerWall <= 0) push('err', 'No outer rotor wall', `OD (${f(p.OD)}) must exceed 2·Rv.`);
    else if (outerWall < 0.1 * p.R) push('warn', 'Thin outer rotor wall', `Min. wall ≈ ${f(outerWall)} mm.`);
    else push('ok', 'Outer rotor wall', `Min. wall ≈ ${f(outerWall)} mm.`);

    const innerWall = p.innerRoot - p.bore / 2;
    if (innerWall <= 0) push('err', 'Bore cuts tooth roots', `Bore radius must be < root radius (${f(p.innerRoot)}).`);
    else if (innerWall < 0.15 * p.innerRoot) push('warn', 'Thin inner rotor wall', `Root − bore = ${f(innerWall)} mm.`);
    else push('ok', 'Inner rotor wall', `Root − bore = ${f(innerWall)} mm.`);

    if (p.c < 0) push('err', 'Negative clearance', 'Profile clearance c must be ≥ 0.');

    // Inner rotor tip speed (Gamez-Montero: keep below 15 m/s for good filling).
    res.tipSpeed = p.rpm * TAU / 60 * p.innerTip / 1000;
    if (res.tipSpeed > 15) push('warn', 'High tip speed', `Inner rotor tip speed ${f(res.tipSpeed, 1)} m/s > 15 m/s; chamber filling may suffer.`);
    else push('ok', 'Tip speed', `Inner rotor tip speed ${f(res.tipSpeed, 1)} m/s (limit 15 m/s).`);

    // Chamber area and its exact derivative over one outer-rotor revolution.
    // Fast mode: contacts and dA/dt only (no areas, no polygons).
    const N = p.N, M = N * (opts.samples || 96), dt = TAU / M;
    const A = opts.fast ? null : new Float64Array(M);
    const dA = new Float64Array(M);
    const polys = opts.fast ? null : new Array(M);
    let psiAbs = 0;
    for (let j = 0; j < M; j++) {
      const ch = chamber(p, j * dt, L, opts.fast ? -1 : 48, 16);
      dA[j] = ch.dAdt;
      if (!opts.fast) { A[j] = ch.area; polys[j] = ch.polygon; }
      psiAbs = Math.max(psiAbs, Math.abs(ch.psi0), Math.abs(ch.psi1));
    }
    res.psiContactMax = psiAbs;
    if (psiAbs > L.psiMax + 1e-6) {
      push('err', 'Contact leaves lobe arc', `Max. contact angle ${f(psiAbs * 180 / Math.PI, 1)}° > lobe arc ±${f(L.psiMax * 180 / Math.PI, 1)}°.`);
    } else {
      push('ok', 'Contact within lobe arc', `Max. contact angle ${f(psiAbs * 180 / Math.PI, 1)}° / arc ±${f(L.psiMax * 180 / Math.PI, 1)}°.`);
    }

    let Amin = NaN, Amax = NaN;
    if (A) {
      Amin = Infinity; Amax = -Infinity;
      for (const a of A) { if (a < Amin) Amin = a; if (a > Amax) Amax = a; }
      // Actual chamber areas including the profile clearance c (dead volume, compare with CAD).
      let mn = Infinity, mx = -Infinity;
      for (let j = 0; j < M; j += 2) {
        const a = chamberActualArea(p, j * dt, L);
        if (a < mn) mn = a; if (a > mx) mx = a;
      }
      res.AminActual = mn; res.AmaxActual = mx;
    }

    // Delivery per unit width, per rad of outer rotation: sum of shrinking chambers.
    const step = M / N, q = new Float64Array(M);
    for (let j = 0; j < M; j++) {
      let s = 0;
      for (let k = 0; k < N; k++) s += Math.max(0, -dA[(j + k * step) % M]);
      q[j] = s;
    }
    let qMin = Infinity, qMax = -Infinity, qSum = 0;
    for (const v of q) { qMin = Math.min(qMin, v); qMax = Math.max(qMax, v); qSum += v; }
    const qMean = qSum / M;

    // Displacement per inner-shaft rev: (N−1)·ΔA·b, or in fast mode the mean of
    // Σ negative dV/dφ (Rundo Eq. 20). Both are computed in full mode as a cross-check.
    const ccCheck = qMean * TAU * p.b * (N - 1) / N / 1000;
    const cc = A ? (N - 1) * (Amax - Amin) * p.b / 1000 : ccCheck;
    const dispInner = cc * 1000;   // mm^3
    const flowLpm = cc * p.rpm / 1000;

    Object.assign(res, {
      M, dt, A, dA, q, polys,
      Amin, Amax,
      dispInner, cc, ccCheck,
      flowLpm,
      ripple: (qMax - qMin) / qMean,
      torque: cc * p.dp / (20 * Math.PI),        // N·m (ideal)
      power: flowLpm * p.dp / 600,               // kW (ideal hydraulic)
      chamberOffset: Math.PI / N,                // chamber-0 housing angle = t + pi/N
    });
    // Contact with clearance: backlash angle and actual tip gaps (js/backlash.js).
    if (!opts.fast && p.c > 0 && global.Gerotor.computeBacklash) {
      res.backlash = global.Gerotor.computeBacklash(p, res);
    }
    if (p.portsOn && !opts.fast && global.Gerotor.analysePorts) {
      res.ports = global.Gerotor.analysePorts(p, res, L);
      res.checks.push(...res.ports.checks);
    }
    // Contact force / Hertz stress (js/contact.js), with simulated pressures when available.
    if (!opts.fast && p.dp > 0 && global.Gerotor.computeContact) {
      const ct = res.contact = global.Gerotor.computeContact(p, res);
      if (ct.reversal) {
        push('warn', 'Contact force reversal', `Outer-rotor torque reverses (min contact force ${f(ct.Fmin, 1)} N): flank change, tooth rattle / noise risk.`);
      } else {
        push('ok', 'Contact force', `Max ${f(ct.Fmax, 0)} N, Hertz pressure ${f(ct.pmaxMax / 1e6, 0)} MPa (${ct.pressureSource} pressures).`);
      }
    }
    // Viscous friction torque and efficiencies (js/friction.js, Totaro et al. 2025).
    if (!opts.fast && p.rpm > 0 && p.nu > 0 && global.Gerotor.computeMechanical) {
      res.mech = global.Gerotor.computeMechanical(p, res);
    }
    res.valid = !res.checks.some(c => c.level === 'err');
    return res;
  }

  global.Gerotor = Object.assign(global.Gerotor || {}, {
    TAU, rot, add, linspace, polygonArea,
    trochoid, trochoidCurve, innerPoint, innerProfile,
    lobeLimits, lobePoint, outerProfile,
    innerAngle, chamber, derive, analyse,
    innerSector, outerSector, lobePsi, trochoidCurvatureRadius, chamberActualArea, filletClearance,
  });
})(typeof window !== 'undefined' ? window : globalThis);
