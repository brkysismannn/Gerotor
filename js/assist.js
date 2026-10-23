/*
 * Design Assist: find gerotor geometries that deliver a target displacement
 * within packaging constraints.
 *
 * Key property: for fixed N, λ = R/(N·e) and k = rp/e every length scales with e,
 * so displacement = b · e² · g(N, λ, k). g and the scale-free quantities (flow
 * ripple, ρmin/e, contact-arc check) are computed once with e = 1 using the exact
 * chamber model; e then follows directly from the target: e = sqrt(V / (b·g)).
 *
 * Search: coarse grid over (N, λ, k) → constraint filter → pattern search around
 * the best candidates → full-resolution re-analysis of the final designs.
 *
 * Also provides the Gamez-Montero et al. best-practice estimate for comparison.
 */
(function (G) {
  'use strict';

  const TAU = 2 * Math.PI;

  const OBJECTIVES = {
    ripple: { label: 'Lowest flow ripple', score: c => c.ripple + 1e-4 * c.ODreq },
    compact: { label: 'Smallest outer diameter', score: c => c.ODreq + 1e-3 * c.ripple },
    contact: { label: 'Lowest contact stress', score: c => c.pmax / 1e6 + c.ripple },
  };

  const DEFAULTS = {
    flow: 15, rpm: 1000, volEff: 100,   // L/min, rpm, %
    b: 10, ODmax: 95, bore: 22, wallOut: 5, wallIn: 5,
    clearance: 0.02, valleyMargin: 0.1,
    Nmin: 5, Nmax: 11, objective: 'ripple',
    lamMin: 1.05, lamMax: 2.0,          // λ = R/(N·e)   (Ivanović: 1 < λ < 2)
    kMin: 1.5,                          // rp/e lower bound; published designs use 1.3 … 4
    sharpLimit: 0.85, tipLimit: 15,
    dp: 50,                             // bar, for contact stress (quasi-static chamber pressures)
    Ein: 210, nuIn: 0.3, Eout: 210, nuOut: 0.3,
  };

  const kMax = (N, lam) => 0.98 * lam * N * Math.sin(Math.PI / N);   // no lobe overlap (Ivanović cond. 6)

  /*
   * Scale-free evaluation at e = 1, b = 1 (cached). With withContact, the quasi-static Hertz
   * pressure at Δp = 1 bar is added: at fixed shape F ∝ Δp·b·e and ρ_eq ∝ e, so
   * p_max = hertz1 · sqrt(Δp[bar]) independently of e and b.
   */
  function unitEval(cache, N, lam, k, fast, req) {
    const withContact = !!(req && req.objective === 'contact');
    const key = `${N}|${lam.toFixed(5)}|${k.toFixed(5)}|${fast ? 1 : 0}|${withContact ? 1 : 0}`;
    if (cache.has(key)) return cache.get(key);
    const mat = req ? { Ein: req.Ein, nuIn: req.nuIn, Eout: req.Eout, nuOut: req.nuOut } : {};
    const p = G.derive(Object.assign({
      N, e: 1, R: lam * N, rp: k, c: 0, RvAuto: true, RvClear: 0, b: 1, OD: 1e6, bore: 0,
      rpm: 0, dp: 1, portsOn: false,
    }, mat));
    const r = G.analyse(p, fast ? { fast: true, samples: 24 } : {});
    const fatal = r.checks.some(c => c.level === 'err' && c.title !== 'Inner rotor undercut');
    const u = r.q ? { ok: !fatal, g: r.cc, ripple: r.ripple, rhoMin: r.rhoMin } : { ok: false };
    if (u.ok && withContact) {
      const ct = G.computeContact(p, r, { quasiStatic: true });
      u.hertz1 = ct.pmaxMax; u.reversal = ct.reversal;
    }
    cache.set(key, u);
    return u;
  }

  // Physical design from a unit evaluation and the requirements.
  function scale(req, N, lam, k, u) {
    const V = req.displacement;
    const e = Math.sqrt(V / (req.b * u.g));
    const R = lam * N * e, rp = k * e;
    const Rv = R + 2 * e - rp + req.valleyMargin;
    const innerRoot = R - e - rp - req.clearance, innerTip = R + e - rp - req.clearance;
    const c = {
      N, lam, k, e, R, rp, Rv, innerRoot, innerTip,
      ODreq: 2 * (Rv + req.wallOut),
      boreWall: innerRoot - req.bore / 2,
      sharp: (rp + req.clearance) / (u.rhoMin * e),
      tip: req.rpm * TAU / 60 * innerTip / 1000,
      ripple: u.ripple,
      pmax: u.hertz1 !== undefined ? u.hertz1 * Math.sqrt(req.dp) : NaN,
    };
    const why = [];
    if (!u.ok) why.push('geometry');
    if (k >= kMax(N, lam)) why.push('lobe overlap');
    if (k < req.kMin) why.push('lobe radius');
    if (Rv >= R + rp - 0.05 * e) why.push('lobe arc');            // lobes must reach the valley circle
    if (req.ODmax > 0 && c.ODreq > req.ODmax) why.push('outer diameter');
    if (c.boreWall < req.wallIn) why.push('bore wall');
    if (!(c.sharp <= req.sharpLimit)) why.push('sharp teeth');
    if (c.tip > req.tipLimit) why.push('tip speed');
    c.feasible = why.length === 0;
    c.why = why;
    return c;
  }

  function normalise(input) {
    const req = Object.assign({}, DEFAULTS, input);
    req.displacement = req.flow * 1000 / req.rpm / (req.volEff / 100);   // cm³/rev
    req.objective = OBJECTIVES[req.objective] ? req.objective : 'ripple';
    return req;
  }

  function designAssist(input) {
    const req = normalise(input);
    const score = OBJECTIVES[req.objective].score;
    const cache = new Map();
    const t0 = performance.now();
    const all = [];
    let evaluated = 0;
    const counts = {};

    // 1. Coarse grid.
    for (let N = req.Nmin; N <= req.Nmax; N++) {
      for (let i = 0; i < 14; i++) {
        const lam = req.lamMin + (req.lamMax - req.lamMin) * i / 13;
        const km = kMax(N, lam), k0 = Math.max(1.02, req.kMin);
        if (km <= k0) continue;
        for (let j = 0; j < 12; j++) {
          const k = k0 + (km - k0) * j / 11;
          const u = unitEval(cache, N, lam, k, true, req);
          evaluated++;
          if (!u.ok || !(u.g > 0)) { counts.geometry = (counts.geometry || 0) + 1; continue; }
          const c = scale(req, N, lam, k, u);
          for (const w of c.why) counts[w] = (counts[w] || 0) + 1;
          if (c.feasible) all.push(c);
        }
      }
    }

    // 2. Pattern search around the best distinct candidates.
    // Seeds: the two best distinct candidates of every lobe count, so that a
    // slightly worse coarse point of another N can still win after refinement.
    all.sort((a, b) => score(a) - score(b));
    const seeds = [];
    for (let N = req.Nmin; N <= req.Nmax; N++) {
      const own = [];
      for (const c of all) {
        if (c.N !== N) continue;
        if (!own.some(s => Math.abs(s.lam - c.lam) < 0.15 && Math.abs(s.k - c.k) < 0.3)) own.push(c);
        if (own.length >= 2) break;
      }
      seeds.push(...own);
    }
    const refined = seeds.map(seed => {
      let best = seed, dl = 0.04, dk = 0.08;
      for (let it = 0; it < 10 && dl > 0.006; it++) {
        let moved = false;
        for (const [sl, sk] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const lam = best.lam + sl * dl, k = best.k + sk * dk;
          if (lam < req.lamMin || lam > req.lamMax || k < req.kMin || k >= kMax(best.N, lam)) continue;
          const u = unitEval(cache, best.N, lam, k, true, req);
          evaluated++;
          if (!u.ok || !(u.g > 0)) continue;
          const c = scale(req, best.N, lam, k, u);
          if (c.feasible && score(c) < score(best)) { best = c; moved = true; }
        }
        if (!moved) { dl /= 2; dk /= 2; }
      }
      return best;
    });

    // 3. Full-resolution verification.
    const results = [];
    for (const c of refined.sort((a, b) => score(a) - score(b))) {
      if (results.some(r => r.N === c.N && Math.abs(r.lam - c.lam) < 0.01 && Math.abs(r.k - c.k) < 0.02)) continue;
      const v = verify(req, snap(req, c, cache), cache);
      if (v) results.push(v);
    }
    results.sort((a, b) => score(a) - score(b));
    return {
      req, results, evaluated, feasibleCount: all.length, rejected: counts,
      gamez: gamezEstimate(req), ms: performance.now() - t0,
      objectiveLabel: OBJECTIVES[req.objective].label,
    };
  }

  // Dimensions are rounded to 0.1 µm so the form shows clean values.
  function designParams(req, c) {
    const r4 = x => Math.round(x * 1e4) / 1e4;
    return {
      N: c.N, e: r4(c.e), R: r4(c.R), rp: r4(c.rp), c: req.clearance, RvAuto: true, RvClear: req.valleyMargin,
      b: req.b, OD: req.ODmax > 0 ? req.ODmax : Math.ceil(c.ODreq * 2) / 2, bore: req.bore, rpm: req.rpm,
      dp: req.dp, Ein: req.Ein, nuIn: req.nuIn, Eout: req.Eout, nuOut: req.nuOut,
    };
  }

  // Re-derive λ, k from the rounded dimensions so the verified design is exactly what gets applied.
  function snap(req, c, cache) {
    const pr = designParams(req, c);
    return Object.assign({}, c, { lam: pr.R / (c.N * pr.e), k: pr.rp / pr.e });
  }

  function verify(req, c, cache) {
    const u = unitEval(cache, c.N, c.lam, c.k, false, req);  // full-resolution unit model
    if (!u.ok) return null;
    const v = scale(req, c.N, c.lam, c.k, u);
    if (!v.feasible) return null;
    const params = designParams(req, v);
    // Full analysis with quasi-static pressures (no port model) → contact stress at req.dp.
    const r = G.analyse(G.derive(Object.assign({ portsOn: false }, params)));
    if (!r.A || r.checks.some(x => x.level === 'err')) return null;
    return Object.assign(v, {
      params,
      cc: r.cc,
      ccErr: 100 * (r.cc - req.displacement) / req.displacement,
      rippleFull: r.ripple,
      pmaxFull: r.contact ? r.contact.pmaxMax : NaN,
      Fmax: r.contact ? r.contact.Fmax : NaN,
      reversal: r.contact ? r.contact.reversal : false,
      checks: r.checks.filter(x => x.level === 'err' || x.level === 'warn').map(x => x.title),
    });
  }

  /*
   * Gamez-Montero, Castilla & Codina, "best practice rules" (Eqs. 1–3):
   *   wc = 0.075·Dc;  e² − (Dc/4 − wc/2)·e + 39.8·cv/H = 0 (small root);
   *   S = Z·e/λs − 0.995·(0.5·Dc − wc) + 2e,  λs = 0.6 … 0.8.
   */
  function gamezEstimate(input) {
    const req = input.displacement ? input : normalise(input);
    const Dc = req.ODmax, H = req.b, cv = req.displacement;
    const wc = 0.075 * Dc, B = Dc / 4 - wc / 2, C = 39.8 * cv / H;
    const disc = B * B - 4 * C;
    if (!(Dc > 0) || disc < 0) return { ok: false, reason: 'no real eccentricity (target too large for the outer diameter)' };
    const e = (B - Math.sqrt(disc)) / 2;
    const Rv = 0.995 * (0.5 * Dc - wc);
    const rows = [];
    for (let N = req.Nmin; N <= req.Nmax; N++) {
      for (const lamS of [0.6, 0.7, 0.8]) {
        const R = N * e / lamS, S = R - Rv + 2 * e;
        const p = G.derive({ N, e, R, rp: S, c: 0, RvAuto: false, Rv: Math.max(Rv, R + 2 * e - S), b: H, OD: Dc, bore: 0, rpm: 0, dp: 0, portsOn: false });
        const r = G.analyse(p, { fast: true, samples: 48 });
        rows.push({
          N, lamS, e, R, rp: S, wc,
          cc: r.cc, ccErr: r.cc ? 100 * (r.cc - cv) / cv : NaN,
          valid: !!r.A && !r.checks.some(x => x.level === 'err'),
        });
      }
    }
    return { ok: true, e, wc, Rv, rows };
  }

  Object.assign(G, { designAssist, gamezEstimate, assistDefaults: DEFAULTS, assistObjectives: OBJECTIVES, assistParams: designParams });
})(window.Gerotor);
