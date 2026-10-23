/*
 * Mechanical (viscous) losses, shaft torque and efficiencies — Totaro, Zardin & Borghi (2025),
 * "Evaluation of a simple method to estimate the shaft torque in a gerotor pump".
 *
 *   M_shaft = M_press + τ·(M_out,radial + M_out,lateral) + M_in,lateral + M_jb
 *
 *   M_th            = V·Δp / 2π                      (ideal; η_m = M_th / M_shaft)
 *   M_press         = mean pressure torque from the chamber model (= M_th without ports)
 *   Pressure load   W = Δp · 2·R_W · L              (R_W = inner tip radius; about half the
 *                                                     chambers at delivery pressure)
 *   Short journal bearing (Ocvirk), load W, radial clearance c, length L, radius R:
 *     W = μ·ω·R·L³/(4c²) · ε/(1−ε²)² · sqrt(π²(1−ε²) + 16ε²)   → solve ε
 *     M = 2π·μ·ω·R³·L / (c·sqrt(1−ε²))
 *   Lateral ring (two faces, gap h per face):  M = μ·π·ω·(R⁴ − r⁴) / h
 *     outer rotor: r = Rv … R = OD/2 (ω2);  inner rotor: r = bore/2 … R = root radius (ω1)
 *
 * Valid for full-film lubrication; the paper reports underestimation at low speed / high
 * pressure (mixed lubrication) and overestimation at high speed.
 *
 * Axial support (Gerotor Design Studio power model, 2016):
 *   balanced (shadow or double-sided ports): rotors float, gap axialClr/2 on each face (above);
 *   single-sided ports: the rotors are pressed onto the housing floor, the whole axial clearance
 *     is on the port face (one viscous face, gap axialClr) and the floor carries Coulomb friction
 *       M_c = μ_f · (Δp · A/2) · R_eff,   R_eff = 2/3 · (ro³ − ri³)/(ro² − ri²)
 *     on each rotor face annulus (GDS: normal load = pressure × half the rotor face area).
 */
(function (G) {
  'use strict';

  const TAU = 2 * Math.PI;

  const ocvirkLoad = (mu, w, R, L, c, eps) =>
    mu * w * R * L ** 3 / (4 * c * c) * eps / (1 - eps * eps) ** 2 * Math.sqrt(Math.PI ** 2 * (1 - eps * eps) + 16 * eps * eps);

  // Eccentricity ratio carrying load W (bisection; load grows monotonically with ε).
  function solveEccentricity(W, mu, w, R, L, c) {
    if (!(W > 0) || !(w > 0)) return 0;
    let lo = 0, hi = 1 - 1e-12;
    for (let i = 0; i < 100; i++) {
      const m = 0.5 * (lo + hi);
      if (ocvirkLoad(mu, w, R, L, c, m) < W) lo = m; else hi = m;
    }
    return 0.5 * (lo + hi);
  }

  const journalTorque = (mu, w, R, L, c, eps) => TAU * mu * w * R ** 3 * L / (c * Math.sqrt(1 - eps * eps));
  const ringTorque = (mu, w, rIn, rOut, h) => (h > 0 && rOut > rIn) ? mu * Math.PI * w * (rOut ** 4 - rIn ** 4) / h : 0;
  // Coulomb friction torque of an annulus pressed with uniform contact pressure q.
  const coulombRingTorque = (muF, q, rIn, rOut) => (rOut > rIn && q > 0) ? muF * q * TAU / 3 * (rOut ** 3 - rIn ** 3) : 0;

  // Rotors pressed to the floor: single-sided ports without shadow ports or double fill.
  const singleSided = p => p.faceSupport === 'single' && !p.doubleFill;

  function computeMechanical(p, res) {
    const mm = 1e-3, tau = (p.N - 1) / p.N;
    const mu = p.nu * 1e-6 * p.rho;
    const w1 = p.rpm * TAU / 60, w2 = w1 * tau;
    const dp = p.dp * 1e5, L = p.b * mm;
    const single = singleSided(p);
    // Viscous lateral faces: two faces with axialClr/2 each, or one face with the whole clearance
    // (ringTorque is written for two faces; one face with gap h equals two faces with gap 2h).
    const hLat = Math.max(0, p.axialClr) / 2 * mm * (single ? 4 : 1);
    const cOut = Math.max(0, p.odClr) / 2 * mm;                    // radial clearance outer rotor ↔ housing

    const Mth = res.cc * 1e-6 * dp / TAU;
    const W = dp * 2 * p.innerTip * mm * L;

    let MoutRad = 0, epsOut = 0;
    if (cOut > 0 && w2 > 0) {
      epsOut = solveEccentricity(W, mu, w2, p.OD / 2 * mm, L, cOut);
      MoutRad = journalTorque(mu, w2, p.OD / 2 * mm, L, cOut, epsOut);
    }
    const MoutLat = ringTorque(mu, w2, p.Rv * mm, p.OD / 2 * mm, hLat);
    const MinLat = ringTorque(mu, w1, p.bore / 2 * mm, p.innerRoot * mm, hLat);
    // Floor friction (single-sided): contact pressure Δp/2 over the rotor face annuli.
    const muF = Math.max(0, p.faceMu || 0);
    const MoutFloor = single ? coulombRingTorque(muF, dp / 2, p.Rv * mm, p.OD / 2 * mm) : 0;
    const MinFloor = single ? coulombRingTorque(muF, dp / 2, p.bore / 2 * mm, p.innerRoot * mm) : 0;

    let Mjb = 0, epsJb = 0;
    const cJb = Math.max(0, p.jbClr) / 2 * mm, Ljb = Math.max(0, p.jbLen) * mm, Rjb = p.bore / 2 * mm;
    if (cJb > 0 && Ljb > 0 && Rjb > 0 && w1 > 0) {
      // Two equal bearings sharing the load, each of length Ljb/2.
      epsJb = solveEccentricity(W / 2, mu, w1, Rjb, Ljb / 2, cJb);
      Mjb = 2 * journalTorque(mu, w1, Rjb, Ljb / 2, cJb, epsJb);
    }

    // Pressure torque from the simulated chamber pressures when available (includes port
    // throttling and the pressure relief by leakage; may be above or below M_th).
    const Mpress = res.contact && res.contact.pressureSource === 'simulated' ? res.contact.torqueMean : Mth;
    const Mports = Mpress - Mth;

    const Mshaft = Mpress + tau * (MoutRad + MoutLat + MoutFloor) + MinLat + MinFloor + Mjb;
    const etaV = res.ports && res.ports.portEfficiency !== undefined ? res.ports.portEfficiency : 1;
    const etaM = Mshaft > 0 ? Mth / Mshaft : 1;
    return {
      Mth, Mports, MoutRad, MoutLat, MinLat, MoutFloor, MinFloor, Mjb, Mshaft, epsOut, epsJb, W, single,
      etaM, etaV, etaT: etaM * etaV,
      powerIn: Mshaft * w1,                     // W
      powerOut: etaV * res.cc * 1e-6 * p.rpm / 60 * dp,
      lossPower: (Mshaft - Mth) * w1,
    };
  }

  Object.assign(G, { computeMechanical, ocvirkLoad, solveEccentricity, journalTorque, ringTorque, coulombRingTorque, singleSided });
})(window.Gerotor);
