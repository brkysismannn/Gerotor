/*
 * Validation & regression suite. Open tests/index.html in a browser.
 *
 * Each test produces { suite, name, ref, value, err, tol, status, note }.
 *   status: 'pass' | 'fail' | 'known' (documented open discrepancy, not a regression)
 * Errors are relative (%) unless the test says otherwise.
 */
(function (G) {
  'use strict';

  const TAU = 2 * Math.PI;
  const results = [];

  function record(suite, name, ref, value, tol, opts) {
    opts = opts || {};
    const err = opts.abs ? Math.abs(value - ref) : Math.abs(value - ref) / Math.abs(ref) * 100;
    let status = err <= tol ? 'pass' : 'fail';
    if (opts.known && status === 'fail') status = 'known';
    results.push({ suite, name, ref, value, err, tol, unit: opts.abs ? (opts.unit || 'abs') : '%', status, note: opts.note || '' });
  }

  function check(suite, name, ok, note) {
    results.push({ suite, name, ref: null, value: null, err: null, tol: null, unit: '', status: ok ? 'pass' : 'fail', note: note || '' });
  }

  const BASE = {
    c: 0, RvAuto: true, RvClear: 0.1, bore: 0, rpm: 1000, dp: 10, portsOn: false,
    portRoAuto: true, portRiAuto: true, sucStart: 0, sucEnd: 0, delStart: 0, delEnd: 0,
    gSucStart: 0, gSucEnd: 0, gDelStart: 0, gDelEnd: 0, grooveW: 1,
    doubleFill: false, pIn: 1, pVap: 0.2, rho: 860, bulk: 1400, Cd: 0.7,
    nu: 30, leakOn: false, axialClr: 0.05, shaftVent: true,
    odClr: 0.15, jbLen: 0, jbClr: 0.04, faceSupport: 'balanced', faceMu: 0.08,
  };

  function design(d) {
    const p = Object.assign({}, BASE, d);
    if (p.OD === undefined) p.OD = 2 * (p.R + 2 * p.e) + 20;
    return G.derive(p);
  }

  // Notation converters (see docs/literatur-notlari.md §1).
  const fromStryczek = (z1, m, lam, v, b, extra) => design(Object.assign({ N: z1 + 1, R: m * (z1 + 1) / 2, e: m * lam / 2, rp: v * m / 2, b }, extra));
  const fromIvanovic = (z, lam, c, e, b, extra) => design(Object.assign({ N: z, R: lam * z * e, rp: c * e, e, b }, extra));

  // Stryczek closed-form displacement (Antoniak 2026, Eq. 2), cm³/rev.
  const stryczekQ = (z1, m, lam, v, b) => {
    const Z = z1 + 1;
    return 0.25 * Math.PI * b * m * m * ((Z + lam - v) ** 2 - z1 / Z * (Z - v) ** 2 + z1 * lam * lam) / 1000;
  };

  // ------------------------------------------------------------ 1. internal consistency

  function suiteConsistency() {
    const S = '1 · Internal consistency';
    const designs = [
      ['N7 default', design({ N: 7, e: 3, R: 30, rp: 8, b: 20 })],
      ['N5', design({ N: 5, e: 2, R: 15, rp: 4, b: 10 })],
      ['N10', design({ N: 10, e: 2, R: 30, rp: 6, b: 10 })],
      ['N11 overlap-free', fromStryczek(10, 1.659, 0.833, 1.11, 7)],
    ];
    for (const [name, p] of designs) {
      const L = G.lobeLimits(p), r = G.analyse(p);
      // Σ chamber areas = cavity area (outer profile − inner rotor).
      const cav = Math.abs(G.polygonArea(G.outerProfile(p, 4000, 400, L))) - Math.abs(G.polygonArea(G.innerProfile(p, 40000, p.rp)));
      let s = 0;
      for (let k = 0; k < p.N; k++) s += G.chamber(p, 0.37 + TAU * k / p.N, L, 400, 200).area;
      record(S, `${name}: Σ chamber areas = cavity area`, cav, s, 0.05);
      // Displacement: (N−1)ΔA·b vs mean of Σ negative dV/dφ (Rundo Eq. 20).
      record(S, `${name}: displacement, ΔA method vs flow integral`, r.cc, r.ccCheck, 0.1);
    }

    // Vector-ray formula (Rundo Eq. 18) vs numerical dA/dφ.
    const p = designs[0][1], L = G.lobeLimits(p), k = (p.N - 1) / p.N;
    let maxErr = 0, maxVal = 0;
    for (const deg of [10, 37, 80, 123, 170, 200, 260, 311]) {
      const phi = deg * Math.PI / 180, h = 1e-4;
      const dA = (G.chamber(p, (phi + h) * k, L, 400, 150).area - G.chamber(p, (phi - h) * k, L, 400, 150).area) / (2 * h);
      const [c1, c2] = G.chamber(p, phi * k, L, 4, 4).contacts;
      const rD = c => (c[0] - p.e) ** 2 + c[1] ** 2, rd = c => c[0] ** 2 + c[1] ** 2;
      const vr = -0.5 * ((rD(c1) - rD(c2)) + k * (rd(c2) - rd(c1)));
      maxErr = Math.max(maxErr, Math.abs(dA - vr)); maxVal = Math.max(maxVal, Math.abs(dA));
    }
    record(S, 'Vector-ray dV/dφ (Rundo Eq. 18) vs numerical derivative, max over 8 angles', 0, 100 * maxErr / maxVal, 0.05, { abs: true, unit: '% of max' });

    // Displacement must not depend on the valley radius.
    const ccs = [0.01, 0.2, 0.5, 1.0].map(cl => G.analyse(design({ N: 7, e: 3, R: 30, rp: 8, b: 20, RvClear: cl })).cc);
    record(S, 'Displacement independent of valley radius (Rv + 0.01 … +1.0 mm)', ccs[0], ccs[3], 0.2);

    // Chamber k at t equals chamber 0 at t + 2πk/N (symmetry used everywhere).
    const a1 = G.chamber(p, 0.2 + TAU * 3 / p.N, L, 200, 80).area;
    const r0 = G.analyse(p);
    const j = Math.round((0.2 + TAU * 3 / p.N) / r0.dt) % r0.M;
    record(S, 'Chamber phase symmetry (grid lookup vs direct)', a1, r0.A[j], 0.5, { note: 'grid rounding' });
  }

  // ------------------------------------------------------------ 2. literature: displacement

  function suiteDisplacement() {
    const S = '2 · Displacement vs literature';
    const antoniak = [
      ['#1', 1.659, 0.833, 1.11, 0.493], ['#2', 1.658, 0.828, 1.10, 0.490], ['#3', 1.656, 0.814, 1.07, 0.482],
      ['#4', 1.658, 0.823, 1.09, 0.487], ['#5', 1.655, 0.809, 1.06, 0.479],
    ];
    for (const [id, m, lam, v, q] of antoniak) {
      record(S, `Antoniak 2026 Table 1 ${id} (z1=10, b=7)`, q, G.analyse(fromStryczek(10, m, lam, v, 7)).cc, 1.0,
        { note: 'published, 3 significant digits' });
    }
    for (const [id, z, lam, c] of [['Model 1', 6, 1.575, 3.95], ['Model 2', 6, 1.375, 2.75], ['Model 3', 5, 1.85, 3.75]]) {
      record(S, `Ivanović 2020 ${id} (q ≈ 14 cm³/rev)`, 14, G.analyse(fromIvanovic(z, lam, c, 3.56, 16.46)).cc, 3.0,
        { note: 'paper states "≈14" for all three' });
    }
    // Gerotor Design Studio screenshot: N=9, e=3.861, rp=10, inner root R=29, b=10.
    const gds = design({ N: 9, e: 3.861, R: 29 + 3.861 + 10, rp: 10, b: 10, RvClear: 0 });
    const rg = G.analyse(gds);
    record(S, 'GDS screenshot: outer root radius = R + 2e − rp', 40.583, gds.RvMin, 0.01);
    record(S, 'GDS screenshot: max chamber volume (2015 mm³)', 2015, rg.Amax * 10, 1.0);
    record(S, 'GDS screenshot: swept volume (Vmax − Vmin)·(N−1) from GDS volumes', (2015 - 41.42) * 8 / 1000, rg.cc, 1.5,
      { note: 'GDS uses 2 mm outer fillets and 0.02 mm tip clearance; not modelled' });
    record(S, 'GDS screenshot: "Approx. capacity" 15.9207', 15.9207, rg.cc, 1.0,
      { known: true, note: 'GDS value matches the Stryczek closed form (15.956, see suite 4)' });
    const outerA = Math.abs(G.polygonArea(G.outerProfile(gds, 3000, 300))), innerA = Math.abs(G.polygonArea(G.innerProfile(gds, 20000, gds.rp)));
    record(S, 'GDS screenshot: area ratio 20.79 % (cavity / outer profile area)', 20.79, 100 * (outerA - innerA) / outerA, 1.0,
      { note: 'interpretation of "Area Ratio" assumed' });
    // With GDS's 2 mm outer fillets and 0.02 mm tip clearance (actual volumes incl. clearance).
    const gdsF = design({ N: 9, e: 3.861, R: 42.861, rp: 10, b: 10, RvClear: 0, c: 0.02, fillet: 2 });
    const rgF = G.analyse(gdsF);
    record(S, 'GDS (fillet 2, c 0.02): min chamber volume 41.42 mm³', 41.42, rgF.AminActual * 10, 5);
    record(S, 'GDS (fillet 2, c 0.02): max chamber volume 2015 mm³', 2015, rgF.AmaxActual * 10, 0.5);
    check(S, 'GDS (fillet 2, c 0.02): geometry valid, fillets clear the inner rotor', !rgF.checks.some(x => x.level === 'err'));
    record(S, 'Fillet does not change displacement', rg.cc, rgF.cc, 1e-6);
    // Kim et al. 2006 (graph reading).
    const kim = design({ N: 11, e: 2.2, R: 34.4, rp: 7.5, b: 10, RvAuto: false, Rv: 32 });
    record(S, 'Kim 2006: max chamber area ≈ 75 mm² (read from Fig. 4)', 75, G.analyse(kim).Amax, 6, { note: 'graph reading ±3 mm²' });
  }

  // ------------------------------------------------------------ 3. literature: flow ripple

  function suiteRipple() {
    const S = '3 · Kinematic flow ripple vs literature';
    for (const [id, z, lam, c, ref] of [['Model 1', 6, 1.575, 3.95, 10], ['Model 2', 6, 1.375, 2.75, 10], ['Model 3', 5, 1.85, 3.75, 9.7]]) {
      record(S, `Ivanović 2020 ${id} (δq ${ref === 10 ? '≈ ' : ''}${ref} %)`, ref,
        100 * G.analyse(fromIvanovic(z, lam, c, 3.56, 16.46)).ripple, 10, { note: 'relative error of δq' });
    }
    for (const [id, m, lam, v, d] of [['#1', 1.659, 0.833, 1.11, 1.15], ['#5', 1.655, 0.809, 1.06, 1.26]]) {
      record(S, `Antoniak 2026 Table 1 ${id} δe = ${d} %`, d, 100 * G.analyse(fromStryczek(10, m, lam, v, 7)).ripple, 10,
        { known: true, note: 'open: δe definition (Stryczek Eq. 3) not yet reproduced' });
    }
    // Ripple decreases with tooth count at fixed λ, c/e.
    const rip = [5, 7, 9, 11].map(N => G.analyse(design({ N, e: 2, R: 1.4 * N * 2, rp: 5, b: 10 })).ripple);
    check(S, 'Ripple decreases with N (λ = 1.4, fixed e, rp): ' + rip.map(x => (100 * x).toFixed(2)).join(' > '),
      rip.every((x, i) => i === 0 || x < rip[i - 1]));
  }

  // ------------------------------------------------------------ 4. closed-form formula comparison

  function suiteClosedForm() {
    const S = '4 · Stryczek closed form vs numerical (diagnostic)';
    for (const [name, z1, m, lam, v, b] of [
      ['Antoniak #1', 10, 1.659, 0.833, 1.11, 7],
      ['GDS screenshot', 8, 2 * 42.861 / 9, 2 * 3.861 / (2 * 42.861 / 9), 2 * 10 / (2 * 42.861 / 9), 10],
      ['Ivanović Model 1', 5, 2 * 33.642 / 6, 2 * 3.56 / (2 * 33.642 / 6), 2 * 14.062 / (2 * 33.642 / 6), 16.46],
    ]) {
      record(S, `${name}: formula vs numerical`, stryczekQ(z1, m, lam, v, b), G.analyse(fromStryczek(z1, m, lam, v, b)).cc, 3,
        { known: true, note: 'formula is consistently ~1.5–2 % higher; formula as transcribed from PDF' });
    }
  }

  // ------------------------------------------------------------ 5. ports & pressure model

  function suitePorts() {
    const S = '5 · Ports & chamber pressure model';
    const P = { N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5, portsOn: true };
    const run = d => G.analyse(design(Object.assign({}, P, d)));

    const r = run({});
    const pr = r.ports, ang = pr.angles;
    // Theoretical ports are mirror-symmetric about the line of centres.
    record(S, 'Port symmetry: suction start = 2π − delivery end', TAU - ang.delivery[1], ang.suction[0], 1e-6, { abs: true, unit: 'rad' });
    record(S, 'Port symmetry: suction end = 2π − delivery start', TAU - ang.delivery[0], ang.suction[1], 1e-6, { abs: true, unit: 'rad' });
    check(S, 'Theoretical ports: no cross-porting', pr.crossDeg === 0);
    check(S, 'Delivery start −4°: cross-porting detected', run({ delStart: -4 }).ports.crossDeg > 0);

    // Opening area never exceeds chamber area; mid-suction chamber fully open.
    let over = 0;
    for (let j = 0; j < r.M; j++) over = Math.max(over, (pr.As[j] + pr.Ad[j]) / r.A[j] - 1);
    record(S, 'Opening area ≤ chamber area (max excess)', 0, 100 * Math.max(0, over), 0.5, { abs: true, unit: '%' });
    const jMid = Math.round((Math.PI / 2 - r.chamberOffset) / r.dt);
    record(S, 'Chamber at 90° (mid-suction) open area / chamber area', 1, pr.As[jMid] / r.A[jMid], 5,
      { note: 'port radii bracket the chamber except near the rotor tips' });

    // Mass conservation per chamber over a cycle. With a compressible fluid the net
    // volumetric inflow is not zero: ∮Q dt = ∮(V/K) dp = −(1/K) ∮ p dV.
    {
      const w2 = 1500 * TAU / 60 * (P.N - 1) / P.N, hs = r.dt / w2, b = P.b * 1e-3;
      let net = 0, pdv = 0;
      for (let j = 0; j < r.M; j++) {
        net += (pr.sim.QS[j] + pr.sim.QD[j]) * hs;
        const j1 = (j + 1) % r.M, pm = 0.5 * (pr.sim.P[j] + pr.sim.P[j1]);
        pdv += pm * (r.A[j1] - r.A[j]) * 1e-6 * b;
      }
      record(S, 'Mass balance: net cycle inflow = −(1/K)∮p dV (compression of delivered oil)', -pdv / (1400e6), net, 5,
        { note: 'checks solver consistency incl. compressibility' });
    }

    // Time-step convergence.
    const coarse = run({ simSub: 6, sucEnd: 3.5, delStart: 5.5 }).ports, fine = run({ simSub: 48, sucEnd: 3.5, delStart: 5.5 }).ports;
    record(S, 'Convergence (sub-steps 6 vs 48): delivered flow', fine.qMean, coarse.qMean, 0.1);
    record(S, 'Convergence (sub-steps 6 vs 48): peak pressure', fine.pMaxBar, coarse.pMaxBar, 1);
    record(S, 'Convergence (sub-steps 6 vs 48): flow ripple', fine.ripple, coarse.ripple, 3);

    // Low-speed, zero-Δp limit: port model approaches the kinematic flow.
    const slow = run({ rpm: 20, dp: 0, sucEnd: 0, delStart: 0 });
    record(S, 'Low-speed limit (20 rpm, Δp = 0): delivered / theoretical flow', 1, slow.ports.portEfficiency, 0.5);
    record(S, 'Low-speed limit: port-model ripple vs kinematic ripple', 100 * slow.ripple, 100 * slow.ports.ripple, 1.0,
      { abs: true, unit: 'pts' });

    // Physical trends.
    check(S, 'Closing suction 6° early lowers delivered flow (incomplete filling)',
      run({ sucEnd: -6, delStart: 6 }).ports.qMean < run({ sucEnd: 0, delStart: 6 }).ports.qMean);
    check(S, 'Peak pressure rises with speed (throttling ∝ ω²)', run({ rpm: 3000 }).ports.pMaxBar > run({ rpm: 1000 }).ports.pMaxBar);

    // Inlet velocity formula.
    const v = r.flowLpm * 1000 / (60 * pr.suction.area);
    record(S, 'Inlet port velocity = Q / A_port', v, pr.inletVelocity, 1e-9);
  }

  // ------------------------------------------------------------ 7. design assist

  function suiteAssist() {
    const S = '7 · Design Assist';
    // Scaling law used by the search: displacement ∝ e² at fixed N, λ, rp/e.
    const p1 = design({ N: 7, e: 3, R: 30, rp: 8, b: 20, RvClear: 0 }), p2 = design({ N: 7, e: 5.1, R: 51, rp: 13.6, b: 20, RvClear: 0 });
    record(S, 'Scaling law: displacement ∝ e² (e × 1.7)', G.analyse(p1).cc * 1.7 * 1.7, G.analyse(p2).cc, 1e-4);

    // Default requirement (GDS-like): every result meets the target and the constraints.
    const a = G.designAssist({});
    const req = a.req;
    check(S, `Search returns designs (${a.results.length} in ${(a.ms / 1000).toFixed(1)} s)`, a.results.length >= 5 && a.ms < 15000);
    let worstErr = 0, worstRip = 0, allOk = true;
    for (const c of a.results) {
      worstErr = Math.max(worstErr, Math.abs(c.ccErr));
      worstRip = Math.max(worstRip, Math.abs(c.rippleFull - c.ripple) * 100);
      const p = G.derive(Object.assign({ dp: 0, portsOn: false }, c.params));
      const r = G.analyse(p);
      const ok = 2 * (p.Rv + req.wallOut) <= req.ODmax + 1e-6 && p.innerRoot - req.bore / 2 >= req.wallIn - 1e-6 &&
        !r.checks.some(x => x.level === 'err');
      allOk = allOk && ok;
    }
    record(S, 'All results: |displacement − target| (worst)', 0, worstErr, 0.05, { abs: true, unit: '%' });
    check(S, 'All results satisfy outer Ø, bore wall and geometry checks', allOk);
    record(S, 'Search ripple (fast model) vs full model (worst)', 0, worstRip, 0.05, { abs: true, unit: 'pts' });
    check(S, 'Results sorted by objective (ripple)', a.results.every((c, i) => i === 0 || c.ripple >= a.results[i - 1].ripple - 1e-12));

    // Restricting N must give the same optimum for that N.
    const n9 = G.designAssist({ Nmin: 9, Nmax: 9 }).results[0];
    const n9all = a.results.find(c => c.N === 9);
    record(S, 'N = 9 optimum: restricted search vs full search', 100 * n9.rippleFull, 100 * n9all.rippleFull, 0.02, { abs: true, unit: 'pts' });

    // GDS screenshot design is feasible for its own requirement; our N = 9 optimum is no worse.
    const gds = design({ N: 9, e: 3.861, R: 42.861, rp: 10, b: 10, c: 0.02, RvClear: 0.1, OD: 95, bore: 22 });
    const rg = G.analyse(gds);
    check(S, `GDS design fits the same packaging (outer wall ${(47.5 - gds.Rv).toFixed(2)} mm ≥ 5, bore wall ${(gds.innerRoot - 11).toFixed(2)} mm ≥ 5)`,
      47.5 - gds.Rv >= 5 && gds.innerRoot - 11 >= 5);
    check(S, `N = 9 optimum ripple ${(100 * n9.rippleFull).toFixed(2)} % ≤ GDS design ripple ${(100 * rg.ripple).toFixed(2)} % (same N, b, Ø 95)`,
      n9.rippleFull <= rg.ripple);

    // Antoniak 2026 #1 (z1 = 10): optimiser with its packaging finds ripple ≤ the published design.
    const ant = fromStryczek(10, 1.659, 0.833, 1.11, 7, { RvClear: 0.1 });
    const ra = G.analyse(ant);
    const aa = G.designAssist({ flow: ra.cc, rpm: 1000, b: 7, Nmin: 11, Nmax: 11, kMin: 1.3, ODmax: 2 * (ant.Rv + 1.5),
      bore: 0, wallOut: 1.5, wallIn: 1, clearance: 0, valleyMargin: 0.1 });
    check(S, `Antoniak #1 packaging: optimum ripple ${aa.results[0] ? (100 * aa.results[0].rippleFull).toFixed(3) : '—'} % ≤ published design ${(100 * ra.ripple).toFixed(3)} %`,
      aa.results.length > 0 && aa.results[0].rippleFull <= ra.ripple + 1e-4);
    if (aa.results[0]) {
      const o = aa.results[0], mO = 2 * o.R / 11;
      record(S, 'Antoniak #1 re-optimised: module m (published 1.659)', 1.659, mO, 1.0);
      record(S, 'Antoniak #1 re-optimised: shortening coeff. λs (published 0.833)', 0.833, 2 * o.e / mO, 1.0);
      record(S, 'Antoniak #1 re-optimised: equidistant coeff. v (published 1.11)', 1.11, 2 * o.rp / mO, 5.0,
        { note: 'ripple is flat in v near the optimum' });
    }

    // Compact objective gives a smaller outer diameter than the ripple objective.
    const ac = G.designAssist({ objective: 'compact' });
    check(S, `Compact objective: Ø ${ac.results[0].ODreq.toFixed(1)} mm < ripple objective Ø ${a.results[0].ODreq.toFixed(1)} mm`,
      ac.results[0].ODreq < a.results[0].ODreq);

    // Contact-stress objective: Hertz pressure is scale-free at fixed shape; search prediction = full model.
    {
      const shapeP = (e, bb) => {
        const q = design({ N: 7, e, R: 10 * e, rp: 2.7 * e, b: bb, rpm: 1000, dp: 50, RvClear: 0 });
        return G.computeContact(q, G.analyse(q), { quasiStatic: true }).pmaxMax;
      };
      record(S, 'Hertz pressure independent of size at fixed shape (e 1 → 7.3, b 1 → 4)', shapeP(1, 1), shapeP(7.3, 4), 1e-6);
      const acon = G.designAssist({ objective: 'contact' });
      let worstPred = 0;
      for (const c of acon.results) worstPred = Math.max(worstPred, Math.abs(c.pmax / c.pmaxFull - 1) * 100);
      record(S, 'Contact objective: predicted vs full-model Hertz pressure (worst)', 0, worstPred, 0.5, { abs: true, unit: '%' });
      check(S, 'Contact objective results sorted by Hertz pressure', acon.results.every((c, i) => i === 0 || c.pmax >= acon.results[i - 1].pmax - 1e-6));
      check(S, `Contact objective lowers Hertz pressure: ${(acon.results[0].pmaxFull / 1e6).toFixed(0)} MPa vs ${(a.results[0].pmaxFull / 1e6).toFixed(0)} MPa (ripple objective)`,
        acon.results[0].pmaxFull < a.results[0].pmaxFull);
    }

    // Gamez-Montero heuristic vs exact model (diagnostic).
    const gzRow = a.gamez.rows.find(r => r.N === 9 && r.lamS === 0.7);
    record(S, 'Gamez-Montero heuristic (N = 9, λs = 0.7): displacement vs target', req.displacement, gzRow.cc, 5,
      { known: true, note: 'heuristic sizing rule; exact model used for the search' });
  }

  // ------------------------------------------------------------ 8. leakage network

  function suiteLeakage() {
    const S = '8 · Multi-chamber leakage model';
    const mu = 0.0258, h = 30e-6, b = 0.02, rho = 0.006, dp = 1e7;

    // Tip-gap closed form vs numerical integration of Reynolds' equation (h(x) = h0 + x²/2ρ).
    {
      const L = 400 * Math.sqrt(2 * rho * h), n = 400000;
      let I = 0;
      for (let i = 0; i <= n; i++) {
        const x = -L + 2 * L * i / n, w = (i === 0 || i === n) ? 0.5 : 1;
        I += w / Math.pow(h + x * x / (2 * rho), 3);
      }
      I *= 2 * L / n;
      const qNum = dp * b / (12 * mu * I);
      record(S, 'Tip-gap formula vs numerical Reynolds integration', qNum, G.tipConductance(b, h, mu, rho) * dp, 0.1);
    }
    // Annular-sector face formula vs numerical radial integration.
    {
      const th = 0.9, r1 = 0.01, r2 = 0.03, n = 200000;
      let I = 0;
      for (let i = 0; i <= n; i++) { const r = r1 + (r2 - r1) * i / n; I += ((i === 0 || i === n) ? 0.5 : 1) / r; }
      I *= (r2 - r1) / n;
      record(S, 'Face-gap (annular sector) formula vs numerical integration', th * h ** 3 * dp / (12 * mu * I),
        G.sectorConductance(th, h, mu, r1, r2) * dp, 0.01);
    }

    const P = { N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5, portsOn: true, simSub: 6 };
    const run = d => G.analyse(design(Object.assign({}, P, d))).ports;

    // With leakage off the network must reproduce the single-chamber model exactly.
    {
      const p = design(P), r = G.analyse(p), pr = r.ports;
      const single = G.simulateChamber(p, r, pr.As, pr.Ad);
      const step = r.M / p.N;
      let qs = 0;
      for (let j = 0; j < r.M; j++) for (let k = 0; k < p.N; k++) qs -= single.QD[(j + k * step) % r.M];
      qs /= r.M;
      record(S, 'Leakage off: network delivered flow = single-chamber model', qs, pr.qMean, 1e-6);
      record(S, 'Leakage off: network peak pressure = single-chamber model', Math.max(...single.P) / 1e5, pr.pMaxBar, 1e-6);
    }

    const noLeak = run({ leakOn: false });
    const loss = d => noLeak.portEfficiency - run(Object.assign({ leakOn: true }, d)).portEfficiency;

    // Scaling laws (small-leak regime, loss measured against the no-leak model).
    {
      const a = run({ leakOn: true, c: 0, axialClr: 0.04 }), bb = run({ leakOn: true, c: 0, axialClr: 0.08 });
      record(S, 'Face leakage ∝ h³: bore drain flow ratio for 2× axial clearance', 8, bb.leak.bore / a.leak.bore, 1.0);
      const l1 = loss({ c: 0.008, axialClr: 0 }), l2 = loss({ c: 0.016, axialClr: 0 });
      record(S, 'Tip leakage ∝ h^2.5: efficiency loss ratio for 2× tip clearance', Math.pow(2, 2.5), l2 / l1, 10,
        { note: 'small-leak regime; chamber pressures shift slightly' });
      const n1 = loss({ c: 0.01, axialClr: 0.02, nu: 30 }), n2 = loss({ c: 0.01, axialClr: 0.02, nu: 60 });
      record(S, 'Leakage ∝ 1/μ: efficiency loss ratio for 2× viscosity', 0.5, n2 / n1, 10);
    }
    {
      const base20 = run({ leakOn: false, dp: 20 }), base40 = run({ leakOn: false, dp: 40 });
      const l20 = base20.portEfficiency - run({ leakOn: true, c: 0.01, axialClr: 0.02, dp: 20 }).portEfficiency;
      const l40 = base40.portEfficiency - run({ leakOn: true, c: 0.01, axialClr: 0.02, dp: 40 }).portEfficiency;
      record(S, 'Leakage ∝ Δp: efficiency loss ratio for 2× pressure', 2, l40 / l20, 10);
    }

    // Global mass balance: suction inflow = delivery outflow + bore drain (+ compressibility).
    {
      const pr = run({ leakOn: true });
      const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
      record(S, 'Network mass balance: |Qin − Qout − Qdrain| / Qth', 0,
        100 * Math.abs(mean(pr.sim.Qin) - mean(pr.sim.Qout) - pr.leak.bore) / pr.qTheo, 1.0, { abs: true, unit: '%' });
    }

    // Physical trends.
    const ref = run({ leakOn: true });
    check(S, `ηv falls with pressure (100 → 200 bar: ${(100 * ref.portEfficiency).toFixed(1)} → ${(100 * run({ leakOn: true, dp: 200 }).portEfficiency).toFixed(1)} %)`,
      run({ leakOn: true, dp: 200 }).portEfficiency < ref.portEfficiency);
    check(S, 'ηv rises with speed (1500 → 3000 rpm)', run({ leakOn: true, rpm: 3000 }).portEfficiency > ref.portEfficiency);
    check(S, 'Leakage relieves trapped-volume pressure peak', ref.pMaxBar < noLeak.pMaxBar);

    // Plausibility vs Hussain et al. 2022 (aero lube pump, measured ηv, read from Fig. 7/8).
    // Clearances are not published: tip 0.065 mm and axial 0.05 mm assumed (Nichols engine-lube range).
    const hb = { N: 5, e: 3.5, R: 31.6, rp: 17.6, RvAuto: false, Rv: 21.8, b: 7, OD: 52, bore: 12, c: 0.065, axialClr: 0.05,
      rho: 930, nu: 5, leakOn: true, portsOn: true, simSub: 6 };
    for (const [dpb, rpm, eta] of [[1, 3000, 95.0], [1, 5500, 96.9], [3, 3000, 87.0], [3, 5500, 92.7]]) {
      const pr = G.analyse(design(Object.assign({}, hb, { dp: dpb, rpm }))).ports;
      record(S, `Hussain 2022 plausibility: Δp ${dpb} bar, ${rpm} rpm, measured ηv ≈ ${eta} %`, eta, 100 * pr.portEfficiency, 3,
        { abs: true, unit: 'pts', known: true, note: 'clearances assumed; graph reading' });
    }
  }

  // ------------------------------------------------------------ 9. backlash contact model

  function suiteBacklash() {
    const S = '9 · Backlash contact model';
    const P = { N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, RvClear: 0.5 };
    const p = design(P), r = G.analyse(p), bl = r.backlash;
    const buf = new Float64Array(p.N);

    // δ ∝ c for small clearance (first-order theory).
    const d1 = G.backlashDelta(p, 0.3, buf), d2 = G.backlashDelta(design(Object.assign({}, P, { c: 0.003 })), 0.3, buf);
    record(S, 'Backlash angle ∝ clearance (c / 10 → δ / 10)', 10, d1 / d2, 0.5);

    // Exactly one lobe touches: min gap = 0, all gaps in [0, ~2c].
    let worstMin = 0, gMin = Infinity, gMax = -Infinity, inSuctionStart = 0, contacts = 0;
    for (let j = 0; j < r.M; j++) {
      G.backlashGaps(p, j * r.dt, bl.delta[j], buf);
      let m = Infinity;
      for (let k = 0; k < p.N; k++) {
        m = Math.min(m, buf[k]); gMin = Math.min(gMin, buf[k]); gMax = Math.max(gMax, buf[k]);
        if (buf[k] < 0.01 * p.c) {
          contacts++;
          const ang = ((j * r.dt + TAU * k / p.N) % TAU) * 180 / Math.PI;
          if (ang > 0 && ang < 90) inSuctionStart++;
        }
      }
      worstMin = Math.max(worstMin, Math.abs(m));
    }
    record(S, 'Contact closes: |min gap| over all positions', 0, worstMin * 1000, 1e-3, { abs: true, unit: 'µm' });
    check(S, `Gaps within [0, 2.2c]: ${(gMin * 1000).toFixed(2)} … ${(gMax * 1000).toFixed(1)} µm (c = 30 µm)`, gMin > -1e-9 && gMax < 2.2 * p.c);
    record(S, 'Tip-to-tip gap at max-volume position = c', p.c * 1000, bl.tipToTipGap * 1000, 1);
    record(S, 'Rundo 2017: contacts lie at the beginning of suction (housing 0°–90°)', 100, 100 * inSuctionStart / contacts, 1);

    // Periodicity, by independent solves.
    const ta = 0.41, tb = ta + TAU / p.N;
    record(S, 'δ(t) is 2π/N-periodic (independent solves)', G.backlashDelta(p, ta, buf), G.backlashDelta(p, tb, buf), 1e-6);

    // Leakage uses the actual gap: sealed contact → zero tip conductance somewhere in the cycle.
    check(S, 'Leading-contact gap reaches zero during the cycle', Math.min(...bl.gapLead) < 1e-9);
    const uni = G.analyse(design(Object.assign({}, P, { rpm: 1500, dp: 100, portsOn: true, leakOn: true, simSub: 6, tipGapModel: 'uniform' }))).ports;
    const bla = G.analyse(design(Object.assign({}, P, { rpm: 1500, dp: 100, portsOn: true, leakOn: true, simSub: 6 }))).ports;
    check(S, `Backlash vs uniform gap: ηv ${(100 * bla.portEfficiency).toFixed(2)} vs ${(100 * uni.portEfficiency).toFixed(2)} %, ripple ${(100 * bla.ripple).toFixed(1)} vs ${(100 * uni.ripple).toFixed(1)} % (diagnostic)`,
      Number.isFinite(bla.portEfficiency) && Number.isFinite(uni.portEfficiency));
  }

  // ------------------------------------------------------------ 10. contact force & Hertz stress

  function suiteContact() {
    const S = '10 · Contact force & Hertz stress';
    const p = design({ N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5 });
    const r = G.analyse(p), ct = r.contact;
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;

    // Energy balance: mean shaft torque from pressure integration = Δp·V/(2π).
    record(S, 'Mean shaft torque (pressure integration) = Δp·V/(2π)', r.cc * 1e-6 * p.dp * 1e5 / TAU, ct.torqueMean, 0.01);
    let worst = 0;
    for (let j = 0; j < r.M; j++) worst = Math.max(worst, Math.abs(ct.Tshaft[j] - ct.Tenergy[j]));
    record(S, 'Instantaneous torque: vector-ray torques = power balance (max deviation)', 0, worst, 1e-9, { abs: true, unit: 'N·m' });

    // Law of gearing: contact normal through the pitch point → arm ratio inner/outer = (N−1)/N.
    record(S, 'Line of action passes through the pitch point (max distance)', 0, Math.max(...ct.pitchDist), 1e-9, { abs: true, unit: 'mm' });
    record(S, 'Moment-arm ratio inner/outer = (N−1)/N', (p.N - 1) / p.N, mean(ct.armRatio), 1e-6);

    // Hertz: two independent forms (E* form vs same-material form p = sqrt(F·E/(2π(1−ν²)·b·ρ))).
    const F = 500, b = 0.02, rho = 0.004, E = 210e9, nu = 0.3;
    record(S, 'Hertz p_max: E* form vs same-material form', Math.sqrt(F * E / (2 * Math.PI * (1 - nu * nu) * b * rho)),
      G.hertzPmax(F, b, rho, G.eStar(E, nu, E, nu)), 1e-9);
    // Hertz consistency: mean pressure over contact width × width = force per length (p_mean = π/4 · p_max).
    const Es = G.eStar(E, nu, E, nu), a = G.hertzHalfWidth(F, b, rho, Es);
    record(S, 'Hertz: (π/4)·p_max·2a·b = F', F, Math.PI / 4 * G.hertzPmax(F, b, rho, Es) * 2 * a * b, 1e-9);

    // Sliding velocity: (ω1/N)·|P − I| vs relative surface velocity at the contact.
    {
      const L = G.lobeLimits(p), t = 0.5, j = Math.round(t / r.dt), kc = r.contact.lobe[j];
      const tk = j * r.dt + TAU * kc / p.N, P = G.chamber(p, tk, L, -1).contacts[0];
      const w1 = p.rpm * TAU / 60, w2 = w1 * (p.N - 1) / p.N;
      const v1 = [-w1 * P[1], w1 * (P[0] - p.e)], v2 = [-w2 * P[1], w2 * P[0]];
      const C = [p.R * Math.cos(tk), p.R * Math.sin(tk)], n = [C[0] - P[0], C[1] - P[1]], nl = Math.hypot(n[0], n[1]);
      const tvec = [-n[1] / nl, n[0] / nl];
      const vrel = Math.abs((v1[0] - v2[0]) * tvec[0] + (v1[1] - v2[1]) * tvec[1]) * 1e-3;
      record(S, 'Sliding velocity: (ω1/N)·|P − I| = tangential relative velocity', vrel, r.contact.Vs[j], 1e-6);
    }

    // Force ∝ Δp, Hertz ∝ sqrt(Δp) (quasi-static).
    const q1 = G.computeContact(p, r, { quasiStatic: true });
    const p2 = design({ N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 200, RvClear: 0.5 });
    const q2 = G.computeContact(p2, G.analyse(p2), { quasiStatic: true });
    record(S, 'Contact force ∝ Δp (2× Δp)', 2, q2.Fmax / q1.Fmax, 1e-6);
    record(S, 'Hertz pressure ∝ sqrt(Δp)', Math.SQRT2, q2.pmaxMax / q1.pmaxMax, 1e-6);

    // Ivanović 2020 (Δp 0.6 MPa, 1500 rpm, clearance 0.07 mm): Model 3 lowers max contact stress
    // "up to 35 %" vs commercial Model 1; Model 2 lowers WRPF "approximately 14 %".
    const iv = (z, lam, c) => {
      const d = fromIvanovic(z, lam, c, 3.56, 16.46, { c: 0.07, rpm: 1500, dp: 6, RvClear: 0.1 });
      return G.computeContact(d, G.analyse(d), { quasiStatic: true });
    };
    const m1 = iv(6, 1.575, 3.95), m2 = iv(6, 1.375, 2.75), m3 = iv(5, 1.85, 3.75);
    record(S, 'Ivanović 2020: max contact stress reduction Model 3 vs Model 1 (≈ 35 %)', 35, 100 * (1 - m3.pmaxMax / m1.pmaxMax), 10,
      { abs: true, unit: 'pts', note: 'their load sharing / pressure model differs' });
    record(S, 'Ivanović 2020: WRPF reduction Model 2 vs Model 1 (≈ 14 %)', 14, 100 * (1 - m2.wrpfMax / m1.wrpfMax), 10,
      { abs: true, unit: 'pts', note: 'paper text is ambiguous on which model has the lowest WRPF' });
  }

  // ------------------------------------------------------------ 11. outer rotor fillets

  function suiteFillet() {
    const S = '11 · Outer rotor fillets';
    const p = design({ N: 9, e: 3.861, R: 42.861, rp: 10, b: 10, RvClear: 0, c: 0.02, fillet: 2 });
    const L = G.lobeLimits(p), F = L.filletCentre;
    record(S, 'Fillet tangent to valley circle: |F| + rf = Rv', p.Rv, Math.hypot(F[0], F[1]) + p.fillet, 1e-9);
    record(S, 'Fillet tangent to lobe: |F − C| = rp + rf', p.rp + p.fillet, Math.hypot(F[0] - p.R, F[1]), 1e-9);
    // Exact chamber areas with fillets vs dense polygon cavity.
    const cav = Math.abs(G.polygonArea(G.outerProfile(p, 4000, 600, L))) - Math.abs(G.polygonArea(G.innerProfile(p, 40000, p.rp)));
    let s = 0;
    for (let k = 0; k < p.N; k++) s += G.chamber(p, 0.37 + TAU * k / p.N, L, 0).area;
    record(S, 'Σ chamber areas = cavity area (with fillets)', cav, s, 1e-3);
    // Each fillet removes the same area from every chamber: ΔAmin = ΔAmax.
    const r0 = G.analyse(design({ N: 9, e: 3.861, R: 42.861, rp: 10, b: 10, RvClear: 0, c: 0 })), r1 = G.analyse(design({ N: 9, e: 3.861, R: 42.861, rp: 10, b: 10, RvClear: 0, c: 0, fillet: 2 }));
    record(S, 'Fillet removes equal area at min and max volume', r0.Amin - r1.Amin, r0.Amax - r1.Amax, 1e-6);
    // Oversized fillet is rejected; a fillet that reaches the tooth path is detected.
    const big = G.analyse(design({ N: 9, e: 3.861, R: 42.861, rp: 10, b: 10, RvClear: 0, c: 0, fillet: 30 }));
    check(S, 'Oversized fillet (30 mm) rejected', big.checks.some(x => x.title === 'Invalid fillet'));
    let hit = null;
    for (const rf of [3, 4, 5, 6, 8]) {
      const r = G.analyse(design({ N: 9, e: 3.861, R: 42.861, rp: 10, b: 10, RvClear: 0, c: 0, fillet: rf }));
      if (r.checks.some(x => x.title === 'Fillet hits inner rotor' || x.title === 'Contact leaves lobe arc')) { hit = rf; break; }
    }
    check(S, `Large fillet flagged as interference (first at rf = ${hit} mm)`, hit !== null);
    // Clearance volume: actual − theoretical ≈ c × inner arc length between contacts (first order).
    const pc = design({ N: 7, e: 3, R: 30, rp: 8, b: 20, RvClear: 0.5, c: 0.03 }), Lc = G.lobeLimits(pc);
    const t = 1.1, phi0 = -t / 6, phi1 = phi0 + TAU / 7;
    let len = 0, prev = G.innerPoint(pc, phi0, pc.rp + 0.015);
    for (let i = 1; i <= 4000; i++) { const q = G.innerPoint(pc, phi0 + (phi1 - phi0) * i / 4000, pc.rp + 0.015); len += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; }
    record(S, 'Clearance volume ΔA = c × inner arc length (mid-offset)', 0.03 * len,
      G.chamberActualArea(pc, t, Lc) - G.chamber(pc, t, Lc, 0).area, 0.5);
  }

  // ------------------------------------------------------------ 12. friction & efficiencies

  function suiteFriction() {
    const S = '12 · Viscous friction & efficiencies';
    const mu = 0.026, w = 150, R = 0.04, Lb = 0.02, c = 75e-6;
    const W = 2000, eps = G.solveEccentricity(W, mu, w, R, Lb, c);
    record(S, 'Short-bearing (Ocvirk) eccentricity solve: load(ε) = W', W, G.ocvirkLoad(mu, w, R, Lb, c, eps), 1e-6);
    record(S, 'Journal torque at ε = 0 equals Petroff 2π·μ·ω·R³·L/c', 2 * Math.PI * mu * w * R ** 3 * Lb / c, G.journalTorque(mu, w, R, Lb, c, 0), 1e-9);
    {
      const r1 = 0.01, r2 = 0.04, h = 25e-6, n = 100000;
      let I = 0;
      for (let i = 0; i <= n; i++) { const r = r1 + (r2 - r1) * i / n; I += ((i === 0 || i === n) ? 0.5 : 1) * r ** 3; }
      I *= (r2 - r1) / n;
      record(S, 'Lateral ring torque vs numerical shear integration (2 faces)', 2 * mu * w / h * 2 * Math.PI * I, G.ringTorque(mu, w, r1, r2, h), 1e-6);
    }

    const P = { N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5, portsOn: false, nu: 30 };
    const mech = d => G.analyse(design(Object.assign({}, P, d))).mech;
    const m = mech({}), m10 = mech({ dp: 10 }), mFast = mech({ rpm: 3000 });
    record(S, 'Totaro: lateral losses independent of pressure (outer faces, 10 vs 100 bar)', m10.MoutLat, m.MoutLat, 1e-9);
    record(S, 'Totaro: lateral losses ∝ speed (2× rpm)', 2 * m.MoutLat, mFast.MoutLat, 1e-6);
    check(S, `Totaro: OD (radial) loss grows with pressure (${m10.MoutRad.toFixed(3)} → ${m.MoutRad.toFixed(3)} N·m)`, m.MoutRad > m10.MoutRad);
    const tau = 6 / 7;
    check(S, `Totaro: outer-rotor losses dominate (${(tau * (m.MoutRad + m.MoutLat)).toFixed(3)} vs inner ${m.MinLat.toFixed(3)} N·m)`, tau * (m.MoutRad + m.MoutLat) > m.MinLat);
    check(S, 'Totaro: smaller clearances dissipate more (axial 0.05 → 0.03 mm)', mech({ axialClr: 0.03 }).MoutLat > m.MoutLat);
    check(S, 'Nichols: smaller outer Ø → lower viscous loss (80 → 72 mm)', mech({ OD: 72 }).Mshaft < m.Mshaft);
    record(S, 'No port model: M_shaft = M_th + τ(M_OD + M_outer faces) + M_inner faces', m.Mth + tau * (m.MoutRad + m.MoutLat) + m.MinLat, m.Mshaft, 1e-9);
    const mp = mech({ portsOn: true, leakOn: true, simSub: 6 });
    record(S, 'Power balance: P_out / P_in = η_v · η_m', mp.etaV * mp.etaM, mp.powerOut / mp.powerIn, 1e-6);
    check(S, `Mechanical efficiency falls at low pressure (100 bar ${(100 * m.etaM).toFixed(1)} % → 10 bar ${(100 * m10.etaM).toFixed(1)} %)`, m10.etaM < m.etaM);
  }

  // ------------------------------------------------------------ 13. performance map

  function suitePerfMap() {
    const S = '13 · Performance map';
    const p = design({ N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5,
      portsOn: true, leakOn: true, simSub: 6 });
    const r = G.analyse(p);
    const op = G.operatingPoint(p, r, 1500, 100);
    record(S, 'Map point = full analysis at the same operating point: η_v', r.ports.portEfficiency, op.etaV, 1e-9);
    record(S, 'Map point = full analysis: η_m', r.mech.etaM, op.etaM, 1e-9);
    record(S, 'Map point = full analysis: shaft torque', r.mech.Mshaft, op.torque, 1e-9);
    const map = G.performanceMap(p, r, { rpmMin: 500, rpmMax: 3500, nRpm: 4, dpMin: 20, dpMax: 100, nDp: 2 });
    check(S, `Grid size ${map.points.length} = 4 × 2`, map.points.length === 8);
    const row = dp => map.points.filter(q => q.dp === dp);
    check(S, 'η_v rises with speed at fixed Δp (leakage time shrinks)', row(100).every((q, i, a) => i === 0 || q.etaV > a[i - 1].etaV));
    check(S, 'η_m falls with speed at low Δp (viscous losses ∝ ω)', row(20).every((q, i, a) => i === 0 || q.etaM < a[i - 1].etaM));
    check(S, 'High Δp: overall efficiency has its optimum above the lowest speed', Math.max(...row(100).map(q => q.etaT)) > row(100)[0].etaT);
    const csv = G.mapCsv(map).trim().split('\n');
    const nc = G.MAP_COLS.length;
    check(S, `CSV: header + ${csv.length - 1} rows, ${nc} columns`, csv.length === 9 && csv[0].split(',').length === nc && csv[1].split(',').length === nc);
  }

  // ------------------------------------------------------------ 14. reverse engineering

  function suiteReverse() {
    const S = '14 · Reverse engineering';
    for (const [name, d] of [['default N7', { N: 7, e: 3, R: 30, rp: 8, c: 0.03, RvClear: 0.5 }],
      ['GDS N9 (c 0.02)', { N: 9, e: 3.861, R: 42.861, rp: 10, c: 0.02, RvClear: 0 }],
      ['Ivanović M1', { N: 6, e: 3.56, R: 1.575 * 6 * 3.56, rp: 3.95 * 3.56, c: 0.07, RvClear: 0.2 }]]) {
      const p = design(Object.assign({ b: 10 }, d));
      const out = G.reverseEngineer(G.measuredDiameters(p));
      const err = Math.max(Math.abs(out.derived.e - p.e), Math.abs(out.derived.R - p.R), Math.abs(out.derived.c - p.c), Math.abs(out.derived.Rv - p.Rv));
      record(S, `Round trip ${name}: max |param − original|`, 0, err * 1000, 1e-6, { abs: true, unit: 'µm' });
      check(S, `Round trip ${name}: no consistency issues`, out.ok);
    }
    // GDS screenshot values: inner root radius 29, lobe radius 10, outer root radius 40.583, e = 3.861.
    const g = G.reverseEngineer({ N: 9, rp: 10, Dt: 2 * (29 + 2 * 3.861), Dr: 58, Dl: 2 * (29 + 3.861), Dv: 81.166 });
    record(S, 'GDS screenshot dimensions → eccentricity 3.861', 3.861, g.derived.e, 1e-6);
    record(S, 'GDS screenshot dimensions → valley margin 0 (root radius = R + 2e − rp)', 0, g.derived.valleyMargin, 1e-6, { abs: true, unit: 'mm' });
    // Inconsistent measurements are flagged.
    const bad = G.reverseEngineer({ N: 9, rp: 10, Dt: 73.4, Dr: 57.96, Dl: 65.0, Dv: 81.2 });
    check(S, 'Outer minor Ø too small → negative clearance flagged', !bad.ok && /Negative clearance/.test(bad.issues.join(' ')));
  }

  // ------------------------------------------------------------ 15. fluid properties & ripple spectrum

  function suiteFluidSpectrum() {
    const S = '15 · Oil viscosity & flow ripple spectrum';
    for (const key of ['vg46', 'mil23699']) {
      const o = G.OILS[key];
      record(S, `Walther fit passes through ν40 (${o.label})`, o.nu40, G.viscosityAt(o.nu40, o.nu100, 40), 1e-9);
      record(S, `Walther fit passes through ν100 (${o.label})`, o.nu100, G.viscosityAt(o.nu40, o.nu100, 100), 1e-9);
    }
    const temps = [-20, 0, 20, 40, 60, 80, 100, 120];
    check(S, 'Viscosity decreases monotonically with temperature (ISO VG 46)',
      temps.every((t, i) => i === 0 || G.oilProperties('vg46', t).nu < G.oilProperties('vg46', temps[i - 1]).nu));
    const mil = G.oilProperties('mil23699', -40).nu;
    check(S, `MIL-PRF-23699 limit ν(−40 °C) ≤ 13 000 cSt (model ${mil.toFixed(0)} cSt)`, mil <= 13000);

    // Spectrum: the kinematic flow is 2π/N-periodic → only multiples of N carry energy.
    const sp = N => {
      const p = design({ N, e: 2, R: 1.4 * N * 2, rp: 5, b: 10, rpm: 1500 });
      return G.flowSpectrum(G.analyse(p).q, 1500, N, 4 * N);
    };
    const s6 = sp(6), s7 = sp(7), s8 = sp(8);
    const off = s => Math.max(...s.harmonics.filter(h => h.h % (s.toothPass / s.f2 | 0) !== 0).map(h => h.amp));
    record(S, 'No ripple energy outside multiples of N (N = 7)', 0, off(s7), 1e-6, { abs: true, unit: '%' });
    const dom = s => s.harmonics.slice().sort((a, b) => b.amp - a.amp)[0].h;
    check(S, `Even N = 6: dominant harmonic = tooth pass (h ${dom(s6)} = 6)`, dom(s6) === 6);
    check(S, `Even N = 8: dominant harmonic = tooth pass (h ${dom(s8)} = 8)`, dom(s8) === 8);
    check(S, `Odd N = 7: dominant harmonic still = tooth pass (h ${dom(s7)} = 7)`, dom(s7) === 7);
    const h2 = s => s.harmonics[2 * (s.toothPass / s.f2 | 0) - 1].amp / s.harmonics[(s.toothPass / s.f2 | 0) - 1].amp;
    check(S, `Odd N carries a stronger 2nd tooth-pass harmonic (2N/N: N7 ${h2(s7).toFixed(2)} vs N6 ${h2(s6).toFixed(2)}, N8 ${h2(s8).toFixed(2)})`,
      h2(s7) > h2(s6) && h2(s7) > h2(s8));
    // Nichols / Mancò: an even number of inner teeth gives lower ripple than an odd inner with one more tooth.
    const rip = N => G.analyse(design({ N, e: 2, R: 1.4 * N * 2, rp: 5, b: 10 })).ripple;
    check(S, `Parity rule: 6 inner teeth (N7) ${(100 * rip(7)).toFixed(2)} % < 7 inner teeth (N8) ${(100 * rip(8)).toFixed(2)} %`, rip(7) < rip(8));
    check(S, `Parity rule: 8 inner teeth (N9) ${(100 * rip(9)).toFixed(2)} % < 9 inner teeth (N10) ${(100 * rip(10)).toFixed(2)} %`, rip(9) < rip(10));
    record(S, 'Tooth-pass frequency = n·(N−1)/60', 1500 * 6 / 60, s7.toothPass, 1e-12);
  }

  // ------------------------------------------------------------ 16. relief grooves

  function suiteGrooves() {
    const S = '16 · Relief grooves';
    const P = { N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5, portsOn: true };
    const run = d => G.analyse(design(Object.assign({}, P, d)));
    const p = design(P);

    // Opening area of a fully covered groove = w · r_mid · Δθ.
    const big = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
    for (const [len, w] of [[4, 1], [10, 0.5], [25, 2]]) {
      const g = G.makeGroove(p, 1.0, -1, len, w);
      record(S, `Groove area (${len}°, ${w} mm) by clipping = w·r_mid·Δθ`, w * g.rm * len * Math.PI / 180,
        G.portOpenArea(big, { pieces: [], grooves: [g] }, null), 0.1, { note: '2° chords' });
    }

    // Delayed delivery opening traps the chamber → compression peak; a groove into the land relieves it.
    // (Kim et al. 2006: relief grooves cut the trapped-volume peak.)
    const free = run({}).ports, trap = run({ delStart: 16 }).ports;
    const peaks = [0.25, 0.5, 1].map(w => run({ delStart: 16, gDelStart: 15, grooveW: w }).ports);
    check(S, `Delivery opened 16° late: trapped compression peak (${trap.pMaxBar.toFixed(0)} vs ${free.pMaxBar.toFixed(0)} bar)`, trap.pMaxBar > 1.5 * free.pMaxBar);
    check(S, `Trapped peak falls with groove width 0.25/0.5/1 mm (${[trap, ...peaks].map(q => q.pMaxBar.toFixed(0)).join(' → ')} bar)`,
      peaks[0].pMaxBar < trap.pMaxBar && peaks[1].pMaxBar < peaks[0].pMaxBar && peaks[2].pMaxBar <= peaks[1].pMaxBar);
    record(S, 'Wide groove brings the peak back to the un-trapped value', free.pMaxBar, peaks[2].pMaxBar, 2);
    check(S, 'Groove inside the land: no cross-porting', peaks.every(q => q.crossDeg === 0));
    check(S, 'Groove through the land (40° vs 12° delay): cross-porting detected', run({ delStart: 12, gDelStart: 40, grooveW: 1 }).ports.crossDeg > 0);

    // Early suction closing → incomplete filling; a groove beyond the suction end refills the chamber.
    const early = run({ sucEnd: -6, delStart: 8 }).ports, fed = run({ sucEnd: -6, delStart: 8, gSucEnd: 5, grooveW: 2 }).ports;
    check(S, `Suction-end groove reduces void (${(100 * early.voidMax).toFixed(2)} % → ${(100 * fed.voidMax).toFixed(2)} %)`, fed.voidMax < early.voidMax);
    check(S, 'Suction-end groove raises delivered flow', fed.qMean > early.qMean);

    // Zero-length grooves leave results unchanged; grooves are exported on the PORTS layer.
    record(S, 'Grooves of zero length: delivered flow unchanged', run({}).ports.qMean, run({ grooveW: 3 }).ports.qMean, 1e-9);
    const r = run({ gDelStart: 3, gSucEnd: 3 });
    const loops = (G.exporters.dxf(design(Object.assign({}, P, { gDelStart: 3, gSucEnd: 3 })), 'ports', r).match(/POLYLINE/g) || []).length;
    check(S, `DXF ports layer holds 2 ports + 2 grooves (${loops} polylines)`, loops === 4);
  }

  // ------------------------------------------------------------ 17. filling-limited max speed

  function suiteMaxSpeed() {
    const S = '17 · Filling-limited max speed';
    const P = { N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5, portsOn: true };
    const ms = d => { const p = design(Object.assign({}, P, d)), r = G.analyse(p); return { p, r, m: G.maxSpeed(p, r, { tol: 20 }) }; };
    const base = ms({});
    const n0 = base.m.rpm;
    check(S, `Bracket: void ≤ 0.5 % at ${n0.toFixed(0)} rpm and > 0.5 % at +20 rpm`,
      G.voidAt(base.p, base.r, n0, 100) <= 0.005 && G.voidAt(base.p, base.r, n0 + 20, 100) > 0.005);
    // Filling is orifice-limited: n_max ∝ Cd · A_open · √((p_in − p_vap)/ρ).
    record(S, 'Scaling with Cd (0.7 → 0.5)', n0 * 0.5 / 0.7, ms({ Cd: 0.5 }).m.rpm, 2.5);
    record(S, 'Scaling with density (860 → 1000 kg/m³)', n0 * Math.sqrt(860 / 1000), ms({ rho: 1000 }).m.rpm, 2.5);
    record(S, 'Scaling with inlet pressure (1 → 2 bar abs)', n0 * Math.sqrt((2 - 0.2) / (1 - 0.2)), ms({ pIn: 2 }).m.rpm, 2.5);
    record(S, 'Scaling with inlet pressure (1 → 0.6 bar abs)', n0 * Math.sqrt((0.6 - 0.2) / (1 - 0.2)), ms({ pIn: 0.6 }).m.rpm, 2.5);
    record(S, 'Double fill (ports on both faces) doubles the opening → 2× speed', 2 * n0, ms({ doubleFill: true }).m.rpm, 2.5);
    record(S, 'Inlet-velocity speed limit: v = 2 m/s at n_inlet', 2, base.r.flowLpm / P.rpm * base.m.rpmInlet * 1000 / (60 * base.r.ports.suction.area), 1e-6);
  }

  // ------------------------------------------------------------ 18. GDS documents: pumps, axial support, cavitation, side load

  function suiteGds() {
    const S = '18 · GDS correlation pumps & models';
    // GDS geometry inputs: root = inner root radius → R = root + rp + e; outer root radius = R + 2e − rp.
    const gds = (N, e, root, rp, d) => design(Object.assign({ N, e, R: root + rp + e, rp, RvClear: 0, portsOn: true, leakOn: true }, d));

    // Bosch Rexroth PGZ4-80 (GDS correlation study 2016; catalogue RE 10233): shadow ports → balanced.
    // Catalogue: V 84.2 cm³, q 116 L/min at 1450 rpm / 10 bar / 30 cSt, drive power 1.1 kW (Δp≈1 bar), 3.0 kW (Δp≈10 bar).
    const rex = d => G.analyse(gds(9, 4.4, 35, 20, Object.assign({ c: 0.1, fillet: 2, b: 39, OD: 110, bore: 42, axialClr: 0.07, odClr: 0.07, nu: 30, rho: 847, rpm: 1450, dp: 10 }, d)));
    const r10 = rex({}), r1 = rex({ dp: 1 });
    record(S, 'Rexroth PGZ4-80: displacement vs catalogue', 84.2, r10.cc, 1);
    record(S, 'Rexroth PGZ4-80: flow at 1450 rpm, 10 bar vs catalogue', 116, r10.ports.flowLpm, 5,
      { note: 'GDS 116.94; tip/axial clearances assumed by GDS (0.1 / 0.07 mm)' });
    record(S, 'Rexroth PGZ4-80: drive power at Δp ≈ 10 bar vs catalogue', 3000, r10.mech.powerIn, 5, { note: 'GDS 2994 W' });
    record(S, 'Rexroth PGZ4-80: drive power at Δp ≈ 1 bar vs catalogue', 1100, r1.mech.powerIn, 10, { note: 'GDS 1134 W; catalogue value is rounded' });

    // Mancò et al. 2002 miniature gerotor (GDS model inputs; single-sided ports, μ 0.04 as fitted by GDS).
    const mini = d => gds(13, 0.5, 7.25, 1.5, Object.assign({ c: 0.002, fillet: 0.5, b: 3.8, OD: 23, bore: 5, axialClr: 0.01, odClr: 0.01, nu: 46, rho: 870, rpm: 1500, dp: 50, faceSupport: 'single', faceMu: 0.04 }, d));
    const mg = G.analyse(mini({ c: 0, portsOn: false, rpm: 0, dp: 0 }));
    record(S, 'Miniature gerotor: min chamber volume vs GDS', 0.43, mg.Amin * 3.8, 2);
    record(S, 'Miniature gerotor: max chamber volume vs GDS', 16.04, mg.Amax * 3.8, 3, { note: 'GDS shows inputs rounded to 0.001–0.01 mm' });
    record(S, 'Miniature gerotor: drive torque at 1500 rpm, 50 bar vs measured (Mancò 2002)', 0.48, G.analyse(mini({})).mech.Mshaft, 10,
      { note: 'GDS 0.55 N·m; measured offset 0.14 N·m at 0 bar from seals is not modelled' });

    // Axial support: single-sided = one open face with the whole clearance.
    const base = { N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5, portsOn: true, leakOn: true, axialClr: 0.06 };
    const bal = G.analyse(design(base)), sgl = G.analyse(design(Object.assign({}, base, { faceSupport: 'single', faceMu: 0.1 })));
    record(S, 'Single-sided: viscous face drag = ¼ of balanced (GDS: balanced ×4)', 0.25, sgl.mech.MinLat / bal.mech.MinLat, 1e-9);
    record(S, 'Single-sided: face leakage conductance = 4× balanced', 4, sgl.ports.sim.conductances.Gper / bal.ports.sim.conductances.Gper, 1e-9);
    const p = design(base), ro = p.OD / 2e3, ri = p.Rv / 1e3, q = 50e5;
    record(S, 'Floor friction = μ·(Δp/2·A)·R_eff, R_eff = ⅔(ro³−ri³)/(ro²−ri²)',
      0.1 * q * Math.PI * (ro * ro - ri * ri) * 2 / 3 * (ro ** 3 - ri ** 3) / (ro * ro - ri * ri), sgl.mech.MoutFloor, 1e-9);
    check(S, 'Single-sided: lower η_v and η_m than balanced', sgl.ports.portEfficiency < bal.ports.portEfficiency && sgl.mech.etaM < bal.mech.etaM);
    const dbl = G.analyse(design(Object.assign({}, base, { faceSupport: 'single', doubleFill: true })));
    check(S, 'Double-sided ports override single-sided support (rotors balanced)', !dbl.mech.single && dbl.mech.MoutFloor === 0);
    // Port arrangement select (GDS terms) → internal flags.
    const lay = l => design(Object.assign({}, base, { portLayout: l }));
    check(S, 'Port arrangement "single" = one face, rotors pressed to floor', lay('single').faceSupport === 'single' && !lay('single').doubleFill);
    check(S, 'Port arrangement "shadow" = one face, balanced', lay('shadow').faceSupport === 'balanced' && !lay('shadow').doubleFill);
    check(S, 'Port arrangement "double" = ports on both faces, balanced', lay('double').faceSupport === 'balanced' && lay('double').doubleFill);
    record(S, 'Port arrangement "single" reproduces the single-sided result (shaft torque)', sgl.mech.Mshaft,
      G.analyse(design(Object.assign({}, base, { portLayout: 'single', faceMu: 0.1 }))).mech.Mshaft, 1e-9);

    // GDS cavitation limits.
    const lim = G.gdsCavitationLimits(p, bal);
    const w = lim.rpmTip * TAU / 60, rT = p.innerTip * 1e-3;
    record(S, 'GDS tip criterion: ½ρ(r_tip·ω)² = p_in − p_vap', (p.pIn - p.pVap) * 1e5, 0.5 * p.rho * (rT * w) ** 2, 1e-9);
    const A = bal.ports.suction.area * 1e-6, U = bal.cc * 1e-6 * lim.rpmGallery / 60 / A;
    record(S, 'GDS gallery criterion: Re = U·D/ν = 2000', 2000, U * Math.sqrt(4 * A / Math.PI) / (p.nu * 1e-6), 1e-9);

    // Shaft side load.
    const qsc = G.computeContact(p, bal, { quasiStatic: true });
    record(S, 'Side load with equal pressure in all chambers', 0, G.computeContact(p, bal, { gauge: () => 1e7 }).shaftLoadMax, 1e-6, { abs: true, unit: 'N' });
    record(S, 'Side load direction: perpendicular to the line of centres, delivery → suction side', 90, qsc.shaftLoadAngle, 2, { abs: true, unit: '°' });
    const W = p.dp * 1e5 * 2 * p.innerTip * 1e-3 * p.b * 1e-3;
    record(S, 'Side load vs projected-area estimate Δp·2R_tip·b (Totaro 2025)', W, qsc.shaftLoadMean, 20,
      { note: 'estimate projects the full tip diameter; the loaded chord is shorter' });
    const q2 = G.computeContact(design(Object.assign({}, base, { dp: 200 })), bal, { quasiStatic: true });
    record(S, 'Side load ∝ Δp (quasi-static)', 2, q2.shaftLoadMean / qsc.shaftLoadMean, 1e-9);
  }

  // ------------------------------------------------------------ 19. user oil from datasheet (ASTM D341)

  function suiteUserOil() {
    const S = '19 · User oil (ASTM D341 datasheet fit)';
    const oil = d => Object.assign({ uT1: 40, uNu1: 32, uT2: 100, uNu2: 5.4, uT3: 0, uNu3: 0, uRho15: 870 }, d);
    // Two points at any temperatures are reproduced exactly.
    const u = oil({ uT1: 0, uNu1: 300, uT2: 60, uNu2: 15 });
    record(S, 'Two points (0 °C / 60 °C): ν(0 °C) reproduced', 300, G.userOil(u, 0).nu, 1e-9);
    record(S, 'Two points (0 °C / 60 °C): ν(60 °C) reproduced', 15, G.userOil(u, 60).nu, 1e-9);
    // Same as the preset path with 40/100 °C points.
    record(S, 'User oil 40/100 °C = ISO VG 32 preset at 75 °C', G.oilProperties('vg32', 75).nu, G.userOil(oil({}), 75).nu, 1e-9);
    // Three points on one Walther line → least squares returns that line.
    const ref = G.waltherFit(46, 6.8), nu0 = G.viscosityFromFit(ref, -10);
    const f3 = G.userOil(oil({ uNu1: 46, uNu2: 6.8, uT3: -10, uNu3: nu0 }), 20);
    record(S, 'Three collinear points: least-squares B = two-point B', ref.B, f3.fit.B, 1e-9);
    record(S, 'Three collinear points: rms deviation', 0, 100 * f3.fit.rms, 1e-6, { abs: true, unit: '%' });
    // Independent check: Mobil DTE 10 Excel 32 datasheet (reproduced in the GDS correlation study):
    // 32.7 cSt @ 40 °C, 6.63 cSt @ 100 °C, Brookfield 1090 cP @ −20 °C, ρ15 846.8 kg/m³.
    const dte = oil({ uNu1: 32.7, uNu2: 6.63, uRho15: 846.8 });
    const at20 = G.userOil(dte, -20);
    record(S, 'DTE 10 Excel 32: extrapolated ν(−20 °C) vs Brookfield 1090 cP / ρ', 1090 / (at20.rho / 1000), at20.nu, 20,
      { note: 'extrapolation 60 K below the datasheet range; high-VI oil' });
    // A low-temperature third point improves the cold extrapolation (Brookfield 3360 cP @ −30 °C).
    const two = G.userOil(dte, -30), three = G.userOil(Object.assign({}, dte, { uT3: -20, uNu3: 1090 / (at20.rho / 1000) }), -30);
    const ref30 = 3360 / (two.rho / 1000);
    check(S, `Third point at −20 °C: ν(−30 °C) error ${(100 * (two.nu / ref30 - 1)).toFixed(0)} % → ${(100 * (three.nu / ref30 - 1)).toFixed(0)} %`,
      Math.abs(three.nu / ref30 - 1) < Math.abs(two.nu / ref30 - 1));
    check(S, 'Extrapolation outside the datasheet temperatures is flagged', at20.notes.some(n => /extrapolated/.test(n)) && !G.userOil(dte, 60).notes.length);
    check(S, 'ν < 2 cSt (outside the 0.7-form range) is flagged', G.userOil(oil({}), 250).notes.some(n => /2 cSt/.test(n)));
    check(S, 'Inconsistent third point (non-Walther) is flagged', G.userOil(oil({ uT3: 0, uNu3: 100 }), 40).notes.some(n => /deviate/.test(n)));
    check(S, 'Both points at one temperature → error', !!G.userOil(oil({ uT2: 40 }), 40).error);
    record(S, 'Density ρ(T) = ρ15·(1 − 6.5·10⁻⁴·(T − 15))', 870 * (1 - 6.5e-4 * 65), G.userOil(oil({}), 80).rho, 1e-9);
    // Fluid library: every entry is consistent and its curve passes through its datasheet values.
    const lib = Object.entries(G.OILS);
    let worst = 0;
    for (const [, o] of lib) worst = Math.max(worst, Math.abs(G.viscosityAt(o.nu40, o.nu100, 40) / o.nu40 - 1), Math.abs(G.viscosityAt(o.nu40, o.nu100, 100) / o.nu100 - 1));
    record(S, `Fluid library (${lib.length} oils): curves through ν40 and ν100`, 0, 100 * worst, 1e-9, { abs: true, unit: '%' });
    check(S, 'Fluid library: ν100 < ν40, ρ15 > 0, group set for every entry', lib.every(([, o]) => o.nu100 < o.nu40 && o.rho15 > 0 && o.group));
  }

  // ------------------------------------------------------------ 20. GDS results panel: tool Ø, outlet ripple, charts, Excel

  function suiteGdsResults() {
    const S = '20 · GDS results & charts';
    // GDS V2021 screenshot design (N 9, e 3.861, root 29, r_p 10, b 10, OD 95, shaft 22, fillet 2,
    // tip clr 0.1, axial 0.1, radial 0.15, ρ 855, ν 14 cSt, double-sided outlet; 5000 rpm, 10 bar).
    const gp = d => design(Object.assign({ N: 9, e: 3.861, R: 42.861, rp: 10, c: 0.1, fillet: 2, RvClear: 0, b: 10, OD: 95, bore: 22,
      axialClr: 0.1, odClr: 0.15, rho: 855, nu: 14, bulk: 15000, pIn: 1.013, pVap: 0.0001, portsOn: true, leakOn: true,
      portLayout: 'double', rpm: 5000, dp: 10 }, d));
    record(S, 'GDS: max tool Ø to cut inner rotor (clearance not offset, as GDS)', 20.5, G.innerToolDiameter(gp({ c: 0 })).diameter, 0.5);
    check(S, 'Tool Ø with c = 0.1 mm offset is 2c larger', Math.abs(G.innerToolDiameter(gp({})).diameter - G.innerToolDiameter(gp({ c: 0 })).diameter - 0.2) < 1e-3);
    const r = G.analyse(gp({}));
    record(S, 'GDS: shaft side load at 5000 rpm, 10 bar', 713.83, r.contact.shaftLoadMax, 10, { note: 'GDS port angles not reproduced exactly' });
    record(S, 'GDS: outlet pressure ripple at 5000 rpm, 10 bar (resistive load)', 13.15, 100 * r.ports.outlet.rippleRel, 15,
      { note: 'GDS ripple definition not documented; our load = restriction only' });
    record(S, 'GDS: max chamber volume with 0.1 mm tip clearance', 2024, r.AmaxActual * 10, 1);

    // Outlet ripple model limits.
    const P = { N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5, portsOn: true };
    const rr = G.analyse(design(P)), sim = rr.ports.sim;
    const res0 = G.outletRipple(Object.assign({}, design(P), { outletVol: 0 }), rr, sim);
    let qmin = Infinity, qmax = -Infinity, qm = 0;
    for (const q of sim.Qout) { qmin = Math.min(qmin, q); qmax = Math.max(qmax, q); qm += q / sim.Qout.length; }
    record(S, 'Resistive limit: p − p_in = Δp·(Q/Q̄)² (ripple from flow extremes)', ((qmax / qm) ** 2 - (Math.max(qmin, 0) / qm) ** 2) * 100, 100 * res0.rippleRel, 1e-6);
    const v20 = G.outletRipple(Object.assign({}, design(P), { outletVol: 20 }), rr, sim), v200 = G.outletRipple(Object.assign({}, design(P), { outletVol: 200 }), rr, sim);
    check(S, `Outlet volume filters the ripple (${(100 * res0.rippleRel).toFixed(1)} → ${(100 * v20.rippleRel).toFixed(1)} → ${(100 * v200.rippleRel).toFixed(1)} %)`,
      v20.rippleRel < res0.rippleRel && v200.rippleRel < v20.rippleRel);
    record(S, 'Outlet model: mean pressure = p_in + Δp', P.dp, (v20.pMean - sim.pS) / 1e5, 1);

    // Excel writer.
    record(S, 'CRC-32 check value ("123456789" → CBF43926)', 0xCBF43926, G.xlsx.crc32(new TextEncoder().encode('123456789')), 0, { abs: true, unit: '' });
    const wb = G.xlsx.workbook([{ name: 'A', rows: [['x', 1]] }]);
    check(S, 'xlsx: ZIP signature and end-of-central-directory record', wb[0] === 0x50 && wb[1] === 0x4B && wb[wb.length - 22] === 0x50 && wb[wb.length - 21] === 0x4B && wb[wb.length - 20] === 5 && wb[wb.length - 19] === 6);
    check(S, 'xlsx: column names A, Z, AA, AZ, BA', ['A', 'Z', 'AA', 'AZ', 'BA'].join() === [0, 25, 26, 51, 52].map(G.xlsx.colName).join());
  }

  // ------------------------------------------------------------ 21. GDS porting options: double-sided in/out, shadow, groove depth, port fillets

  function suitePorting() {
    const S = '21 · Porting type, groove depth, port fillets';
    const P = { N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5, portsOn: true };
    const d = x => design(Object.assign({}, P, x));
    const f = (x, k) => d(x)[k];
    check(S, 'Double-sided outlet only: outlet ×2, inlet ×1, rotors balanced', f({ dblIn: false, dblOut: true, shadow: false }, 'fillD') === 2 && f({ dblIn: false, dblOut: true, shadow: false }, 'fillS') === 1 && f({ dblIn: false, dblOut: true, shadow: false }, 'faceSupport') === 'balanced');
    check(S, 'Double-sided inlet only, no shadow ports: rotors pressed to floor', f({ dblIn: true, dblOut: false, shadow: false }, 'faceSupport') === 'single' && f({ dblIn: true, dblOut: false, shadow: false }, 'fillS') === 2);
    check(S, 'Shadow ports only: balanced, single orifices', f({ dblIn: false, dblOut: false, shadow: true }, 'faceSupport') === 'balanced' && f({ shadow: true, dblIn: false, dblOut: false }, 'fillD') === 1);
    const one = G.analyse(d({ dblIn: false, dblOut: false, shadow: true })).ports, din = G.analyse(d({ dblIn: true, dblOut: false, shadow: true })).ports;
    record(S, 'Double-sided inlet halves the inlet port velocity', 0.5, din.inletVelocity / one.inletVelocity, 1e-9);
    const dout = G.analyse(d({ dblIn: false, dblOut: true, shadow: false, rpm: 3000 })).ports, one3 = G.analyse(d({ dblIn: false, dblOut: false, shadow: true, rpm: 3000 })).ports;
    check(S, `Double-sided outlet lowers the delivery throttling peak (${one3.pMaxBar.toFixed(1)} → ${dout.pMaxBar.toFixed(1)} bar)`, dout.pMaxBar < one3.pMaxBar);

    // Groove depth: series resistance of the groove cross-section.
    // A fully covered groove (open area A_o) with depth chosen so that w·d = A_o gives A_eff = A_o/√2.
    const sq = [[-99, -99], [99, -99], [99, 99], [-99, 99]], wG = 1;
    const Ao = G.portOpenArea(sq, { pieces: [], grooves: [G.makeGroove(design(P), 1, -1, 10, wG, 0)] }, null);
    const Aeff = G.portOpenArea(sq, { pieces: [], grooves: [G.makeGroove(design(P), 1, -1, 10, wG, Ao / wG)] }, null);
    record(S, 'Groove depth: A_eff = (A_o⁻² + (w·d)⁻²)^(−½) → A_o/√2 when w·d = A_o', Math.SQRT1_2, Aeff / Ao, 1e-9);
    const trapG = x => G.analyse(d(Object.assign({ delStart: 16, gDelStart: 15, grooveW: 1 }, x))).ports.pMaxBar;
    const full = trapG({ grooveD: 0 }), deep = trapG({ grooveD: 50 }), shallow = trapG({ grooveD: 0.05 });
    record(S, 'Very deep groove = full-depth groove (trapped peak)', full, deep, 0.5);
    check(S, `Shallow groove (0.05 mm) relieves less (${full.toFixed(0)} → ${shallow.toFixed(0)} bar)`, shallow > full + 1);

    // Port fillets.
    const big = [[-200, -200], [200, -200], [200, 200], [-200, 200]];
    const pf = d({ portFillet: 2 }), pr = G.analyse(Object.assign({}, pf, { rpm: 0 })).ports;
    const disk = Array.from({ length: 720 }, (_, i) => [pf.e + pf.portRi * Math.cos(TAU * i / 720), pf.portRi * Math.sin(TAU * i / 720)]);
    record(S, 'Filleted port: opening area of a covering chamber = outline area', pr.suction.area, G.portOpenArea(big, pr.suction, disk), 0.1);
    // Apex sector (no inner arc): two outer corners of 90°; waste → 2·rf²·(1 − π/4) for Ro ≫ rf.
    const ap = d({ portRiAuto: false, portRi: 0 }), apf = d({ portRiAuto: false, portRi: 0, portFillet: 1 });
    const a0 = G.analyse(Object.assign({}, ap, { rpm: 0 })).ports.suction, a1 = G.analyse(Object.assign({}, apf, { rpm: 0 })).ports.suction;
    // Exact corner area between radial edge, outer arc (Ro) and fillet (rf): circle sector O2 from T_c to K
    // minus quadrilateral O2-T_l-C-T_c minus the fillet sector at C.
    const Ro = apf.portRo, rf = 1, s = Math.sqrt((Ro - rf) ** 2 - rf * rf);
    const C = [s, rf], Tl = [s, 0], Tc = [C[0] * Ro / (Ro - rf), C[1] * Ro / (Ro - rf)];
    const quad = Math.abs(G.polygonArea([[0, 0], Tl, C, Tc]));
    const phiF = Math.acos(((Tl[0] - C[0]) * (Tc[0] - C[0]) + (Tl[1] - C[1]) * (Tc[1] - C[1])) / (rf * rf));
    const corner1 = 0.5 * Ro * Ro * Math.atan2(Tc[1], Tc[0]) - quad - 0.5 * rf * rf * phiF;
    record(S, `Outer corners: removed area = exact corner area ×2 (rf 1, Ro ${Ro.toFixed(1)}; flat limit 2·rf²(1−π/4) = ${(2 * (1 - Math.PI / 4)).toFixed(3)})`,
      2 * corner1, G.portOpenArea(big, a0, null) - G.portOpenArea(big, a1, null), 0.01,
      { abs: true, unit: 'mm²', note: 'port outer arc is a 24-chord polygon per 90° piece' });
    check(S, 'Oversized port fillet is rejected', G.analyse(d({ portFillet: 6 })).ports.checks.some(c => c.title === 'Port fillet'));
  }

  // ------------------------------------------------------------ 22. OpenModelica export

  function suiteModelica() {
    const S = '22 · OpenModelica export';
    const P = { N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5, portsOn: true, leakOn: true };
    const p = design(P), r = G.analyse(p);
    const ex = G.modelica.exportModelica(p, r, { name: 'Test pump 1', rpmMin: 1000, rpmMax: 3000, nRpm: 3, dpMin: 20, dpMax: 100, nDp: 2 });
    const mo = ex.files[ex.name + '.mo'];
    check(S, `Package name sanitised to a Modelica identifier (${ex.name})`, /^[A-Za-z_][A-Za-z0-9_]*$/.test(ex.name));
    check(S, 'Package contains connector, network components (rotor, chamber, tip gap, axial gap, port land, friction), lumped gerotor, volume, restriction, tank, examples',
      ['connector FluidPort', 'model Rotor', 'model Chamber', 'model TipGap', 'model AxialGap', 'model PortLand', 'model GerotorFriction',
        'model GerotorLumped', 'model Volume', 'model Restriction', 'model Tank', 'model PumpSystem', 'model PumpSystemLumped', `end ${ex.name};`].every(s => mo.includes(s)));
    const nVol = (mo.match(/Components\.Chamber Vol\d+\(k=\d+\)/g) || []).length, nGap = (mo.match(/Components\.TipGap gap\d+\(k=\d+\)/g) || []).length;
    check(S, `Network: one chamber and one tip gap per lobe (${nVol} / ${nGap}, N = ${p.N})`, nVol === p.N && nGap === p.N);
    const fd = G.modelica.frictionData(p, r), w1 = p.rpm * TAU / 60;
    record(S, 'Friction block: C_visc·ω + K_floor·Δp = M_shaft − M_pressure (design point)', r.mech.Mshaft - r.contact.torqueMean,
      fd.Cvisc * w1 + fd.Kfloor * p.dp * 1e5, 1e-9);
    const ps = design(Object.assign({}, P, { dblIn: false, dblOut: false, shadow: false })), rs = G.analyse(ps), fs = G.modelica.frictionData(ps, rs);
    record(S, 'Friction block, single-sided ports: floor friction term', rs.mech.Mshaft - rs.contact.torqueMean, fs.Cvisc * w1 + fs.Kfloor * ps.dp * 1e5, 1e-9);
    const tab = G.modelica.tables(p, r);
    check(S, `Angle table: M + 1 rows (${tab.length}), θ from 0 to 2π`, tab.length === r.M + 1 && tab[0][0] === 0 && Math.abs(tab[r.M][0] - TAU) < 1e-9);
    record(S, 'Table: chamber area column = analysis area (SI)', r.A[10] * 1e-6, tab[10][1], 1e-12);
    const jg = r.ports.sim.Gtip.indexOf(Math.max(...r.ports.sim.Gtip));
    record(S, 'Table: tip conductance column = network G_tip', r.ports.sim.Gtip[jg], tab[jg][5], 1e-12);
    const i0 = mo.indexOf('table[:, 6] = [');
    const rowsTxt = mo.slice(i0, mo.indexOf(']', i0 + 16)).split('\n').slice(1);
    const rowRe = /^\s+[-0-9.e]+, [-0-9.e]+, [-0-9.e]+, [-0-9.e]+, [-0-9.e]+, [-0-9.e]+;?$/;
    check(S, `All ${tab.length} table rows written as numbers`, rowsTxt.length === tab.length && rowsTxt.every(l => rowRe.test(l)));
    const cs = G.modelica.cases(p, r, { rpmMin: 1000, rpmMax: 3000, nRpm: 3, dpMin: 20, dpMax: 100, nDp: 2 });
    check(S, `Case table: speeds × pressures = ${cs.length} cases; .mos runs each`, cs.length === 6 && (ex.files['cases.mos'].match(/simulate\(/g) || []).length === 6);
    const c1 = cs[1], q = r.cc * 1e-6 * c1.rpm / 60 * r.ports.portEfficiency;
    record(S, 'Load restriction sized for the case Δp at the expected flow: Cd·A·√(2Δp/ρ) = Q', q, p.Cd * c1.A * Math.sqrt(2 * c1.dp * 1e5 / p.rho), 1e-9);
    check(S, 'Case CSV: header + one row per case', ex.files['cases.csv'].trim().split('\n').length === cs.length + 1);

    // Viscosity–temperature coupling (FluidProperties = GT "VisSensor").
    const walther = (od, T) => Math.pow(10, Math.pow(10, od.A - od.B * Math.log10(T + 273.15))) - 0.7;
    const vg = G.OILS.vg46, pv = design(Object.assign({}, P, { oil: 'vg46', oilT: 60, nu: G.viscosityAt(vg.nu40, vg.nu100, 60), rho: G.densityAt(vg.rho15, 60) }));
    const od = G.modelica.oilData(pv);
    record(S, 'Oil data (ISO VG 46): Walther A, B give ν at the design temperature', pv.nu, walther(od, 60), 1e-9);
    record(S, 'Oil data: ν(100 °C) from the exported A, B = datasheet ν100', vg.nu100, walther(od, 100), 1e-9);
    record(S, 'Oil data: ρ15·(1 − α(T − 15)) = design density', pv.rho, od.rho15 * (1 - od.alpha * (60 - 15)), 1e-9);
    const oc = G.modelica.oilData(design(P));
    const nuC = design(P).nu;
    check(S, 'Custom oil (ν, ρ only): B = 0 and α = 0 → constant properties', oc.B === 0 && oc.alpha === 0 && Math.abs(walther(oc, 120) / nuC - 1) < 1e-9);
    const nOuter = (mo.match(/outer FluidProperties fluid;/g) || []).length;
    check(S, `Fluid properties used by chamber, tip gap, axial gap, port land, friction, lumped gerotor, restriction (${nOuter} components)`, nOuter === 7 && /inner Components\.FluidProperties fluid/.test(mo));
    check(S, 'Case script overrides speed, restriction area and oil temperature', /-override=w=[^,]+,A=[^,]+,T_oil=/.test(ex.files['cases.mos']));
  }

  // ------------------------------------------------------------ 23. PDF drawing & STEP AP242

  function suiteDrawingStep() {
    const S = '23 · PDF drawing & STEP AP242';
    const P = { N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5, portsOn: false };
    const p = design(P), r = G.analyse(p);

    // PDF: header, cross-reference offsets, trailer, dimension texts.
    const pdf = new TextDecoder('latin1').decode(G.drawing.technicalDrawing(p, r, { date: '2026-01-01' }));
    check(S, 'PDF: header %PDF-1.4 and %%EOF', pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
    const xrefAt = +/startxref\n(\d+)/.exec(pdf)[1];
    const offs = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => +m[1]);
    check(S, `PDF: startxref points to the xref table; all ${offs.length} object offsets point to "k 0 obj"`,
      pdf.slice(xrefAt, xrefAt + 4) === 'xref' && offs.every((o, k) => pdf.slice(o).startsWith(`${k + 1} 0 obj`)));
    const len = +/\/Length (\d+) >>\nstream\n/.exec(pdf)[1], s0 = pdf.indexOf('stream\n') + 7;
    check(S, 'PDF: content stream /Length matches the stream', pdf.slice(s0 + len, s0 + len + 10) === '\nendstream');
    const need = ['Ø80', 'Ø' + (2 * p.innerTip).toFixed(2).replace(/\.?0+$/, ''), 'Ø18', 'OUTER ROTOR', 'INNER ROTOR', 'ASSEMBLY', 'PROFILE DATA', '16.177 cm³/rev'];
    check(S, `PDF: dimension and table texts present (${need.length})`, need.every(t => pdf.includes('(' + G.drawing.pdfString(t)) || pdf.includes(G.drawing.pdfString(t))));
    check(S, 'PDF: standard scale chosen so that the outer rotor fits the view (1:1 for OD 80)', pdf.includes('(1:1)'));

    // One sheet per export scope.
    const pp = design(Object.assign({}, P, { portsOn: true, portFillet: 1, gDelStart: 4, grooveW: 1 })), rp = G.analyse(pp);
    const sheet = sc => new TextDecoder('latin1').decode(G.drawing.drawingFor(pp, rp, sc, { date: '2026-01-01' }));
    const sO = sheet('outer'), sI = sheet('inner'), sP = sheet('ports'), sA = sheet('assembly');
    const has = (txt, t) => txt.includes(G.drawing.pdfString(t));
    check(S, 'Outer-rotor sheet: title, OD, valley Ø, lobe radius, data table, own drawing number', has(sO, 'OUTER ROTOR N7') && has(sO, 'Ø80') && has(sO, 'Ø57') && has(sO, 'R8 (7x)') && has(sO, 'OUTER ROTOR DATA') && has(sO, '-OR'));
    check(S, 'Inner-rotor sheet: title, tip / root / bore Ø, pitch circle, tool Ø, own drawing number', has(sI, 'INNER ROTOR N6') && has(sI, 'Ø' + (2 * pp.innerTip).toFixed(2)) && has(sI, 'Ø18') && has(sI, 'Pitch circle') && has(sI, 'Max tool') && has(sI, '-IR'));
    const angs = [rp.ports.suction.a0, rp.ports.suction.a1, rp.ports.delivery.a0, rp.ports.delivery.a1].map(a => (Math.round(((a % TAU) + TAU) % TAU * 18000 / Math.PI) / 100).toFixed(2) + '°');
    check(S, `Port-plate sheet: the four edge angles (${angs.join(', ')}), port radii, corner radii, grooves`, angs.every(a => has(sP, a)) && has(sP, 'R' + (+pp.portRo.toFixed(3))) && has(sP, 'PORT DATA') && has(sP, 'Corner radii') && has(sP, '1x 1 wide'));
    check(S, 'Assembly sheet is the overview with all views', has(sA, 'ASSEMBLY') && has(sA, 'OUTER ROTOR') && has(sA, 'INNER ROTOR'));
    check(S, 'Four different sheets', new Set([sO, sI, sP, sA].map(t => t.length + t.slice(-300))).size === 4);

    // STEP exact mode (default): arcs → circles / cylinders, inner profile → cubic B-splines / extrusions.
    for (const scope of ['outer', 'inner', 'assembly']) {
      const txt = G.step.stepFile(p, r, { scope, date: '2026-01-01T00:00:00' });
      const ck = G.step.checkStep(txt);
      const regs = G.step.exactRegions(p, scope);
      check(S, `STEP exact ${scope}: no dangling #refs; every shell closed (edges used twice, opposite senses); Euler–Poincaré`,
        ck.missingRefs === 0 && ck.shells.length === regs.length && ck.shells.every((sh, i) => sh.badEdges === 0 && sh.euler === 2 * (1 - regs[i].holes.length)));
      if (scope === 'outer') check(S, 'STEP exact outer: circle edges and cylindrical faces only (no facets)', /CYLINDRICAL_SURFACE/.test(txt) && !/SURFACE_OF_LINEAR_EXTRUSION/.test(txt) && (txt.match(/ADVANCED_FACE/g) || []).length === 4 + regs[0].holes[0].length + 2);
      if (scope === 'inner') check(S, `STEP exact inner: ${p.N - 1} B-spline teeth (linear-extrusion faces) + bore cylinders`,
        (txt.match(/SURFACE_OF_LINEAR_EXTRUSION/g) || []).length === p.N - 1 && (txt.match(/B_SPLINE_CURVE_WITH_KNOTS/g) || []).length === 2 * (p.N - 1));
    }
    const segs = G.step.outerProfileSegs(design(Object.assign({}, P, { fillet: 1.5 })));
    check(S, `Exact outer profile with fillets: ${segs.length} arcs (lobe, fillet, valley, fillet per lobe) joined end to end`, segs.length === 4 * P.N);
    const sp = G.step.innerProfileSegs(p, 0.002);
    record(S, `Inner profile B-splines (${sp.ctrlCount} control points): max deviation from the true profile ≤ 2 µm`, 0, sp.maxDev * 1000, 2, { abs: true, unit: 'µm' });
    // Interpolation with end derivatives reproduces the data points and end tangents.
    const Q = Array.from({ length: 9 }, (_, i) => [Math.cos(i * 0.2), Math.sin(i * 0.2)]);
    const s9 = G.step.interpolate(Q, [0, 1], [-Math.sin(1.6), Math.cos(1.6)]);
    let qerr = 0;
    const ub = [0]; for (let k = 1; k < 9; k++) ub.push(ub[k - 1] + Math.hypot(Q[k][0] - Q[k - 1][0], Q[k][1] - Q[k - 1][1]));
    for (let k = 0; k < 9; k++) { const c = G.step.bsplinePoint(s9, ub[k] / ub[8]); qerr = Math.max(qerr, Math.hypot(c[0] - Q[k][0], c[1] - Q[k][1])); }
    record(S, 'Cubic B-spline interpolation (Piegl & Tiller): passes through the data points', 0, qerr, 1e-9, { abs: true, unit: 'mm' });
    const d0 = [G.step.bsplinePoint(s9, 1e-6)[0] - Q[0][0], G.step.bsplinePoint(s9, 1e-6)[1] - Q[0][1]];
    check(S, 'Cubic B-spline interpolation: start tangent = prescribed direction', Math.abs(Math.atan2(d0[1], d0[0]) - Math.PI / 2) < 1e-3);
    record(S, 'Arc of radius 1 sampled by the spline: radius error', 1, Math.hypot(...G.step.bsplinePoint(s9, 0.37)), 1e-3);

    // STEP facet mode: references, closed manifold shells, Euler–Poincaré, volume = area × b.
    for (const scope of ['outer', 'inner', 'assembly']) {
      const txt = G.step.stepFile(p, r, { scope, mode: 'facet', date: '2026-01-01T00:00:00' });
      const ck = G.step.checkStep(txt);
      const regs = G.step.regions(p, scope, r);
      check(S, `STEP ${scope}: AP242 schema, ${ck.entities} entities, no dangling #refs`,
        /FILE_SCHEMA\(\('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF/.test(txt) && ck.missingRefs === 0 && /END-ISO-10303-21;\s*$/.test(txt));
      ck.shells.forEach((sh, i) => {
        const g = regs[i].holes.length;                  // through-holes = genus
        check(S, `STEP ${scope} / ${sh.name}: every edge used twice with opposite senses; Euler–Poincaré = 2(1 − ${g}) (${sh.euler})`,
          sh.badEdges === 0 && sh.euler === 2 * (1 - g));
        const vRef = (G.step.signedArea(regs[i].outer) + regs[i].holes.reduce((a, h) => a + G.step.signedArea(h), 0)) * p.b;
        record(S, `STEP ${scope} / ${sh.name}: enclosed volume (divergence theorem) = area × b`, vRef, sh.volume, 1e-9);
      });
    }
    // Faceting error: max deviation of a facet from the true inner profile (mid-parameter point vs chord).
    // Facets are a subset of the dense profile (same point objects): check every dense point against its facet.
    const reg = G.step.regions(p, 'inner', r)[0], dense = reg.dense, idx = new Map(dense.map((q, i) => [q, i]));
    const kept = reg.outer.map(q => idx.get(q)).filter(i => i !== undefined).sort((a, b) => a - b), n = kept.length;
    let dev = 0;
    for (let s = 0; s < n; s++) {
      const i0 = kept[s], i1 = s + 1 < n ? kept[s + 1] : kept[0] + dense.length, a = dense[i0], b = dense[i1 % dense.length];
      const t = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(t[0], t[1]);
      for (let k = i0 + 1; k < i1; k++) {
        const q = dense[k % dense.length];
        dev = Math.max(dev, Math.abs((q[0] - a[0]) * t[1] - (q[1] - a[1]) * t[0]) / L);
      }
    }
    check(S, `STEP inner profile: ${n} facets cover the ${dense.length}-point profile`, n === reg.outer.length && n > 50);
    record(S, `STEP inner profile faceting (${n} facets): max deviation from the dense profile ≤ tolerance 2 µm`, 0, dev * 1000, 2, { abs: true, unit: 'µm' });
    const exactInner = Math.abs(G.polygonArea(G.innerProfile(p, 20000, p.rp + p.c)));
    record(S, 'STEP inner profile faceting: area vs 20 000-point profile', exactInner, Math.abs(G.step.signedArea(reg.outer)), 0.05);
  }

  // ------------------------------------------------------------ 6. export

  function suiteExport() {
    const S = '6 · Export';
    const p = design({ N: 7, e: 3, R: 30, rp: 8, c: 0.03, b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100, RvClear: 0.5, portsOn: true });
    const r = G.analyse(p);
    const dxf = G.exporters.dxf(p, 'assembly', r);
    check(S, 'DXF ends with EOF and has 3 layers', /EOF\r\n$/.test(dxf) && /PORTS/.test(dxf) && /INNER_ROTOR/.test(dxf) && /OUTER_ROTOR/.test(dxf));
    const svg = G.exporters.svg(p, 'assembly', r);
    check(S, 'SVG parses', !new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror'));
    // Exported inner profile matches analysis geometry (first point at tooth root).
    const csv = G.exporters.csv(p, 'inner', r).split('\n')[1].split(',');
    record(S, 'CSV inner profile first point = root radius', p.innerRoot, Math.hypot(+csv[3], +csv[4]), 1e-3);
  }

  function runAll() {
    results.length = 0;
    const t0 = performance.now();
    for (const s of [suiteConsistency, suiteDisplacement, suiteRipple, suiteClosedForm, suitePorts, suiteExport, suiteAssist, suiteLeakage, suiteBacklash, suiteContact, suiteFillet, suiteFriction, suitePerfMap, suiteReverse, suiteFluidSpectrum, suiteGrooves, suiteMaxSpeed, suiteGds, suiteUserOil, suiteGdsResults, suitePorting, suiteModelica, suiteDrawingStep]) {
      try { s(); } catch (e) { check(s.name, 'Suite threw: ' + e.message, false); }
    }
    return { results: results.slice(), ms: performance.now() - t0 };
  }

  G.tests = { runAll };
})(window.Gerotor);
