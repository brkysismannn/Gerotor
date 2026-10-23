/*
 * Contact force, Hertz contact stress, sliding velocity and wear indicator.
 *
 * Fluid torques (Rundo 2017, Eqs. 18–19; vector rays to the two contacts of each chamber,
 * c0 = trailing contact on lobe k, c1 = leading contact on lobe k+1), per chamber with gauge
 * pressure g = p − p_in:
 *   inner rotor (about O1):  T_i = g·b/2·(|c0 − O1|² − |c1 − O1|²)
 *   outer rotor (about O2):  T_o = g·b/2·(|c1|² − |c0|²)
 *   shaft torque (ideal):    T_shaft = Σ (T_i + τ·T_o),  τ = (N−1)/N   (power balance)
 * The outer rotor turns freely, so the contact force balances its fluid torque:
 *   F_n · arm_o = Σ T_o,  arm_o = moment arm of the contact normal about O2.
 * The contacting lobe comes from the backlash model (inner rotor drives).
 *
 * Hertz line contact (length b), 1/E* = (1−ν1²)/E1 + (1−ν2²)/E2:
 *   p_max = sqrt(F·E* / (π·b·ρ_eq)),  half-width a = sqrt(4·F·ρ_eq / (π·b·E*))
 * Sliding velocity: v_s = |ω1 − ω2|·|P − I| = (ω1/N)·|P − I|, I = pitch point (N·e, 0).
 * Wear-rate proportional factor (Ivanović 2020, after Colbourne): WRPF = p_max · v_s.
 */
(function (G) {
  'use strict';

  const TAU = 2 * Math.PI;

  const eStar = (E1, nu1, E2, nu2) => 1 / ((1 - nu1 * nu1) / E1 + (1 - nu2 * nu2) / E2);
  const hertzPmax = (F, b, rhoEq, Es) => Math.sqrt(F * Es / (Math.PI * b * rhoEq));
  const hertzHalfWidth = (F, b, rhoEq, Es) => Math.sqrt(4 * F * rhoEq / (Math.PI * b * Es));

  // Lobe that carries the load at outer angle t (inner rotor drives). Reuses the backlash
  // angle from the analysis when available.
  // Without a solved δ: all gaps equal c at δ = 0, so the first lobe to close is the one whose gap
  // shrinks fastest — found from the gaps at a tiny lag (first-order, exact except at switching).
  function contactLobe(p, t, buf, delta) {
    if (delta !== undefined && p.c > 0) G.backlashGaps(p, t, delta, buf);
    else G.backlashGaps(Object.assign({}, p, { c: 0 }), t, 1e-7, buf);
    let k0 = 0;
    for (let k = 1; k < p.N; k++) if (buf[k] < buf[k0]) k0 = k;
    return k0;
  }

  /*
   * pressures: 'sim' uses the simulated chamber pressures (res.ports.sim.P) when available,
   * otherwise quasi-static: delivery pressure on chambers in housing angle (π, 2π).
   */
  function computeContact(p, res, opts) {
    opts = opts || {};
    const { M, dt, dA } = res, N = p.N, step = M / N, tau = (N - 1) / N;
    const L = G.lobeLimits(p);
    const b = p.b * 1e-3, dpPa = p.dp * 1e5;
    const w1 = p.rpm * TAU / 60;
    const Es = eStar((p.Ein || 210) * 1e9, p.nuIn ?? 0.3, (p.Eout || 210) * 1e9, p.nuOut ?? 0.3);
    const sim = !opts.quasiStatic && res.ports && res.ports.sim ? res.ports.sim : null;
    const gauge = (j, k) => {
      const jk = (j + k * step) % M;
      if (sim) return sim.P[jk] - sim.pS;
      const th = (jk * dt + Math.PI / N) % TAU;          // housing angle of chamber k
      return th > Math.PI ? dpPa : 0;
    };

    const F = new Float64Array(M), Pmax = new Float64Array(M), Vs = new Float64Array(M), W = new Float64Array(M);
    const Tshaft = new Float64Array(M), Tenergy = new Float64Array(M), armRatio = new Float64Array(M), pitchDist = new Float64Array(M);
    const lobe = new Uint8Array(M), buf = new Float64Array(N);
    const I = [N * p.e, 0];

    // All quantities are 2π/N-periodic (chamber k at t ≡ chamber 0 at t + 2πk/N), so one lobe
    // pitch is computed and replicated.
    for (let j = 0; j < step; j++) {
      const t = j * dt;
      let To = 0, Ti = 0, Te = 0;
      for (let k = 0; k < N; k++) {
        const ch = G.chamber(p, t + TAU * k / N, L, -1);
        const [c0, c1] = ch.contacts, g = gauge(j, k);
        const m = v => v * 1e-3;
        To += g * b / 2 * (m(c1[0]) ** 2 + m(c1[1]) ** 2 - m(c0[0]) ** 2 - m(c0[1]) ** 2);
        Ti += g * b / 2 * ((m(c0[0] - p.e)) ** 2 + m(c0[1]) ** 2 - (m(c1[0] - p.e)) ** 2 - m(c1[1]) ** 2);
        Te += g * (-dA[(j + k * step) % M]) * 1e-6 * b * tau;        // power balance, per inner rad
      }
      Tshaft[j] = Ti + tau * To;
      Tenergy[j] = Te;

      // Loaded contact: lobe kc, contact point = trailing contact of chamber kc.
      const kc = contactLobe(p, t, buf, res.backlash ? res.backlash.delta[j] : undefined);
      lobe[j] = kc;
      const tk = t + TAU * kc / N;
      const P = G.chamber(p, tk, L, -1).contacts[0];
      const C = [p.R * Math.cos(tk), p.R * Math.sin(tk)];
      const nx = C[0] - P[0], ny = C[1] - P[1], nl = Math.hypot(nx, ny);
      const n = [nx / nl, ny / nl];                                  // force on the outer lobe
      const armO = (P[0] * n[1] - P[1] * n[0]) * 1e-3;               // about O2
      const armI = ((P[0] - p.e) * n[1] - P[1] * n[0]) * 1e-3;       // about O1 (reaction −n)
      armRatio[j] = armI / armO;
      pitchDist[j] = Math.abs((I[0] - P[0]) * n[1] - (I[1] - P[1]) * n[0]);   // line of action ↔ pitch point [mm]
      F[j] = To / armO;            // To is the resisting fluid torque; > 0: inner rotor drives the outer
      const rhoEq = G.contactRhoEq(p, -tk / (N - 1)) * 1e-3;
      Pmax[j] = F[j] > 0 ? hertzPmax(F[j], b, rhoEq, Es) : 0;
      Vs[j] = (w1 / N) * Math.hypot(P[0] - I[0], P[1] - I[1]) * 1e-3;
      W[j] = Pmax[j] * Vs[j];
    }
    for (let j = step; j < M; j++) {
      const j0 = j % step, sh = Math.floor(j / step);
      F[j] = F[j0]; Pmax[j] = Pmax[j0]; Vs[j] = Vs[j0]; W[j] = W[j0];
      Tshaft[j] = Tshaft[j0]; Tenergy[j] = Tenergy[j0]; armRatio[j] = armRatio[j0]; pitchDist[j] = pitchDist[j0];
      lobe[j] = ((lobe[j0] - sh) % N + N) % N;      // one pitch later the next-lower lobe sits there
    }

    const max = a => a.reduce((m, x) => Math.max(m, x), -Infinity);
    const min = a => a.reduce((m, x) => Math.min(m, x), Infinity);
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    const tm = mean(Tshaft);
    return {
      F, Pmax, Vs, W, Tshaft, Tenergy, armRatio, pitchDist, lobe, Es,
      pressureSource: sim ? 'simulated' : 'quasi-static',
      Fmax: max(F), Fmin: min(F),
      pmaxMax: max(Pmax), vsMax: max(Vs), wrpfMax: max(W),
      torqueMean: tm, torqueRipple: (max(Tshaft) - min(Tshaft)) / Math.abs(tm),
      reversal: min(F) < 0,
    };
  }

  Object.assign(G, { computeContact, hertzPmax, hertzHalfWidth, eStar });
})(window.Gerotor);
