/*
 * Tooth contact with clearance (backlash).
 *
 * The inner profile is the trochoid offset by rp + c, so with c > 0 the rotors are not
 * exactly conjugate. In a pump the inner rotor drives: the outer rotor lags behind its
 * conjugate position by an angle δ(t) until the first lobe touches (Ivanović et al. 2012;
 * Rundo 2017 §4.1.3). Then 1 (sometimes 2) lobes are in contact and the other lobes have
 * a gap between 0 and ~2c.
 *
 * Gap at lobe k:  h_k = c + d_k,  d_k = signed normal distance (outward positive) from the
 * lobe centre to the trochoid, both expressed in the inner-rotor frame.
 * δ(t) solves  min_k h_k(δ) = 0  (bisection).
 * By symmetry h_k(t) = h_0(t + 2πk/N) and δ is 2π/N-periodic.
 */
(function (G) {
  'use strict';

  const TAU = 2 * Math.PI;

  // Signed distance (outward +) from point Y (inner frame) to the trochoid, starting at φ0.
  function signedDistance(p, Y, phi0) {
    let phi = phi0;
    for (let it = 0; it < 8; it++) {
      const q = G.trochoid(p, phi), d1 = trochoidD1(p, phi), d2 = trochoidD2(p, phi);
      const rx = q[0] - Y[0], ry = q[1] - Y[1];
      const g = rx * d1[0] + ry * d1[1];
      const gp = d1[0] * d1[0] + d1[1] * d1[1] + rx * d2[0] + ry * d2[1];
      const step = g / gp;
      phi -= step;
      if (Math.abs(step) < 1e-13) break;
    }
    const q = G.trochoid(p, phi), d1 = trochoidD1(p, phi), L = Math.hypot(d1[0], d1[1]);
    return ((Y[0] - q[0]) * d1[1] - (Y[1] - q[1]) * d1[0]) / L;
  }

  // Local copies of the trochoid derivatives (same formulas as geometry.js).
  function trochoidD1(p, phi) {
    const Ne = p.N * p.e;
    return [-p.R * Math.sin(phi) + Ne * Math.sin(p.N * phi), p.R * Math.cos(phi) - Ne * Math.cos(p.N * phi)];
  }
  function trochoidD2(p, phi) {
    const N2e = p.N * p.N * p.e;
    return [-p.R * Math.cos(phi) + N2e * Math.cos(p.N * phi), -p.R * Math.sin(phi) + N2e * Math.sin(p.N * phi)];
  }

  // Gaps of all lobes at outer angle t when the outer rotor lags by delta.
  function gapsAt(p, t, delta, out) {
    const N = p.N, a1 = N * t / (N - 1), ca = Math.cos(-a1), sa = Math.sin(-a1);
    for (let k = 0; k < N; k++) {
      const th = t - delta + TAU * k / N;
      const X = [p.R * Math.cos(th) - p.e, p.R * Math.sin(th)];
      const Y = [ca * X[0] - sa * X[1], sa * X[0] + ca * X[1]];
      out[k] = p.c + signedDistance(p, Y, -t / (N - 1) + TAU * k / N);
    }
    return out;
  }

  // Backlash angle δ at outer angle t: smallest δ ≥ 0 with min gap = 0.
  function solveDelta(p, t, buf) {
    if (!(p.c > 0)) return 0;
    const minGap = d => { gapsAt(p, t, d, buf); let m = Infinity; for (const g of buf) m = Math.min(m, g); return m; };
    let lo = 0, hi = p.c / p.R;
    for (let i = 0; i < 40 && minGap(hi) > 0; i++) hi *= 2;
    for (let it = 0; it < 60; it++) {
      const mid = 0.5 * (lo + hi);
      if (minGap(mid) > 0) lo = mid; else hi = mid;
    }
    return hi;
  }

  /*
   * Over the analysis grid t_j = j·dt (one outer revolution):
   *   delta[j]   backlash angle [rad]
   *   gapLead[j] gap at the leading contact of chamber 0 (lobe 1) [mm]
   *   nContact[j] lobes with gap < 1 % of c
   */
  function computeBacklash(p, res) {
    const { M, dt } = res, N = p.N, step = M / N;
    const delta = new Float64Array(M), gap0 = new Float64Array(M), nContact = new Uint8Array(M);
    const buf = new Float64Array(N);
    // δ is 2π/N-periodic: solve one lobe pitch, reuse.
    for (let j = 0; j < step; j++) delta[j] = solveDelta(p, j * dt, buf);
    for (let j = step; j < M; j++) delta[j] = delta[j % step];
    for (let j = 0; j < M; j++) {
      gapsAt(p, j * dt, delta[j], buf);
      gap0[j] = buf[0];
      let n = 0;
      for (const g of buf) if (g < 0.01 * p.c) n++;
      nContact[j] = n;
    }
    // Leading contact of chamber 0 is lobe 1: h_1(t) = h_0(t + 2π/N).
    const gapLead = new Float64Array(M);
    for (let j = 0; j < M; j++) gapLead[j] = gap0[(j + step) % M];

    // Outer rotor speed pulsation: ω2,actual/ω2 = 1 − dδ/dt.
    let dMax = 0, dMin = Infinity, rateMax = 0, double = 0;
    for (let j = 0; j < M; j++) {
      dMax = Math.max(dMax, delta[j]); dMin = Math.min(dMin, delta[j]);
      rateMax = Math.max(rateMax, Math.abs(delta[(j + 1) % M] - delta[(j - 1 + M) % M]) / (2 * dt));
      if (nContact[j] >= 2) double++;
    }
    // Tip-to-tip gap at the maximum-volume position (housing angle π): lobe at θ = π.
    const jTip = Math.round((Math.PI - 0) / dt) % M;
    return {
      delta, gap0, gapLead, nContact,
      deltaMax: dMax, deltaMin: dMin,
      speedPulsation: rateMax,                 // max |dδ/dt| (fraction of ω2)
      doubleContactFraction: double / M,
      tipToTipGap: gap0[jTip],
    };
  }

  Object.assign(G, { computeBacklash, backlashGaps: gapsAt, backlashDelta: solveDelta });
})(window.Gerotor);
