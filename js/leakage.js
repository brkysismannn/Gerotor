/*
 * Multi-chamber lumped-parameter model with internal leakage
 * (the in-browser equivalent of a GT-SUITE gerotor network: N chamber volumes,
 * port orifices, inter-chamber gaps, axial face gaps, port-to-port lands).
 *
 * Components (all SI internally; written so that each maps 1:1 to a Modelica model):
 *
 *   Chamber volume k      dp_k/dt = K/V_k · (Σ Q_in,k − dV_k/dt)      (+ cavitation void)
 *   Port orifice          Q = sgn(Δp)·Cd·A(t)·sqrt(2|Δp|/ρ)
 *   Tip / flank gap       between chambers k and k+1 at their common contact point;
 *                         gap h(t) from the backlash contact model (or uniform c).
 *                         Laminar flow through the gap between two curved surfaces
 *                         (min. gap h, equivalent radius ρeq): integrating Reynolds'
 *                         equation with h(x) = h + x²/(2ρeq) gives
 *                           Q = 2·b·h^{5/2}·Δp / (9π·μ·sqrt(2ρeq))
 *   Axial face gap        radial Poiseuille flow across an annular sector of angle θ:
 *                           Q = θ·h³·Δp / (12·μ·ln(r2/r1))   (per face, two faces)
 *                         chamber → shaft bore (drain, vented to inlet) and
 *                         chamber → outer-rotor periphery node.
 *   Port land             slot flow delivery → suction across the two port lands:
 *                           Q = w·h³·Δp / (12·μ·L)
 *   Periphery node        massless; pressure = conductance-weighted mean of chambers.
 *
 * Not modelled (yet): Couette (shear-driven) flow in the gaps, inter-chamber face
 * leakage across tooth lands, radial micro-motion of the outer rotor.
 */
(function (G) {
  'use strict';

  const TAU = 2 * Math.PI;

  // ------------------------------------------------------------ gap conductances [m³/(s·Pa)]

  const tipConductance = (b, h, mu, rhoEq) => 2 * b * Math.pow(h, 2.5) / (9 * Math.PI * mu * Math.sqrt(2 * rhoEq));
  const sectorConductance = (theta, h, mu, r1, r2) => (r2 > r1 && r1 > 0) ? theta * h * h * h / (12 * mu * Math.log(r2 / r1)) : 0;
  const slotConductance = (w, h, mu, L) => (w > 0 && L > 0) ? w * h * h * h / (12 * mu * L) : 0;

  // Equivalent radius of curvature [mm] at the contact between the convex lobe (rp)
  // and the inner profile (offset trochoid, signed radius ρt − rp; negative = concave).
  function contactRhoEq(p, phi) {
    const rt = G.trochoidCurvatureRadius(p, phi);
    const ri = rt - p.rp;
    const inv = 1 / p.rp + 1 / ri;
    return inv > 1e-6 ? Math.min(1 / inv, 1e4) : 1e4;
  }

  function orifice(A, pUp, pCh, Cd, rho) {
    const d = pUp - pCh;
    return A > 0 ? Math.sign(d) * Cd * A * Math.sqrt(2 * Math.abs(d) / rho) : 0;
  }

  /*
   * Simulate all N chambers over three outer-rotor revolutions (last one recorded).
   * res: geometric analysis (A, dA on the grid t = j·dt); As, Ad: opening areas of chamber 0.
   * ports: { suction, delivery } port objects (for the land leakage).
   */
  function simulateNetwork(p, res, As, Ad, ports) {
    const { M, dt, A, dA } = res, N = p.N, step = M / N;
    const w1 = p.rpm * TAU / 60, w2 = w1 * (N - 1) / N;
    const b = p.b * 1e-3, K = p.bulk * 1e6, rho = p.rho, Cd = p.Cd;
    const mu = p.nu * 1e-6 * rho;
    const pS = p.pIn * 1e5, pD = (p.pIn + p.dp) * 1e5, pV = p.pVap * 1e5;
    const sub = p.simSub || 6, h = dt / w2 / sub, sweeps = 3;
    const leak = !!p.leakOn;

    // Gap heights [m].
    const hTip = leak ? Math.max(0, p.c) * 1e-3 : 0;
    // Axial faces: balanced rotors have axialClr/2 on both faces; single-sided ports press the
    // rotors onto the housing floor, leaving the whole clearance on the port face only.
    const single = G.singleSided(p), nFaces = single ? 1 : 2;
    const hAx = leak ? Math.max(0, p.axialClr) / nFaces * 1e-3 : 0;     // per open face

    // Leading-contact gap and equivalent radius of chamber 0 on the grid → tip conductance.
    // Gap: actual backlash gap h(t) (js/backlash.js) or a uniform gap c.
    const useBacklash = p.tipGapModel !== 'uniform' && res.backlash;
    const Gtip0 = new Float64Array(M);
    if (hTip > 0) {
      for (let j = 0; j < M; j++) {
        const phi1 = -(j * dt) / (N - 1) + TAU / N;
        const hj = useBacklash ? Math.max(0, res.backlash.gapLead[j]) * 1e-3 : hTip;
        Gtip0[j] = hj > 0 ? tipConductance(b, hj, mu, contactRhoEq(p, phi1) * 1e-3) : 0;
      }
    }
    // Face conductances (open faces).
    const theta = TAU / N;
    const Gbore = hAx > 0 && p.bore > 0 ? nFaces * sectorConductance(theta, hAx, mu, p.bore / 2 * 1e-3, p.innerRoot * 1e-3) : 0;
    const Gper = hAx > 0 ? nFaces * sectorConductance(theta, hAx, mu, p.Rv * 1e-3, p.OD / 2 * 1e-3) : 0;
    const boreVented = p.shaftVent !== false;
    // Port lands: on every face that carries the delivery port.
    let Gland = 0;
    if (hAx > 0 && ports && ports.suction) {
      const ri = Math.max(p.portRi, 0), w = (p.portRo - ri) * 1e-3, rm = 0.5 * (p.portRo + ri) * 1e-3;
      const landMax = ports.delivery.a0 - ports.suction.a1, landMin = ports.suction.a0 + TAU - ports.delivery.a1;
      Gland = (p.fillD || (p.doubleFill ? 2 : 1)) * (slotConductance(w, hAx, mu, landMax * rm) + slotConductance(w, hAx, mu, landMin * rm));
    }
    const Qland = Gland * (pD - pS);

    const lerp = (arr, j, f) => arr[j] + (arr[(j + 1) % M] - arr[j]) * f;
    const P = new Float64Array(N).fill(pS), voids = new Float64Array(N);
    const Pold = new Float64Array(N);
    const geo = { V: new Float64Array(N), dV: new Float64Array(N), as: new Float64Array(N), ad: new Float64Array(N), gt: new Float64Array(N) };

    // Records (last cycle): chamber 0 histories and network totals.
    const rec = {
      P: new Float64Array(M), QS: new Float64Array(M), QD: new Float64Array(M), VF: new Float64Array(M),
      Qout: new Float64Array(M), Qin: new Float64Array(M),
      Qtip: new Float64Array(M), Qbore: new Float64Array(M), Qper: new Float64Array(M),
    };

    const fillS = p.fillS || (p.doubleFill ? 2 : 1), fillD = p.fillD || (p.doubleFill ? 2 : 1);
    for (let cycle = 0; cycle < 3; cycle++) {
      const last = cycle === 2;
      for (let j = 0; j < M; j++) {
        let acc = { qs0: 0, qd0: 0, out: 0, inn: 0, tip: 0, bore: 0, per: 0 };
        for (let s = 0; s < sub; s++) {
          const f = (s + 0.5) / sub;
          for (let k = 0; k < N; k++) {
            const jk = (j + k * step) % M;
            geo.V[k] = lerp(A, jk, f) * 1e-6 * b;
            geo.dV[k] = lerp(dA, jk, f) * 1e-6 * b * w2;
            geo.as[k] = lerp(As, jk, f) * 1e-6 * fillS;    // double-sided ports: both faces
            geo.ad[k] = lerp(Ad, jk, f) * 1e-6 * fillD;
            geo.gt[k] = lerp(Gtip0, jk, f);                 // gap between k and k+1
            Pold[k] = P[k];
          }
          let pPer = 0;
          for (let sw = 0; sw < sweeps; sw++) {
            pPer = 0;
            for (let k = 0; k < N; k++) pPer += P[k];
            pPer /= N;
            const pBore = boreVented ? pS : pPer;
            for (let k = 0; k < N; k++) {
              const kp = (k + N - 1) % N, kn = (k + 1) % N;
              const gPrev = geo.gt[kp], gNext = geo.gt[k];
              const V = geo.V[k], dV = geo.dV[k], as = geo.as[k], ad = geo.ad[k];
              const Qin = x => orifice(as, pS, x, Cd, rho) + orifice(ad, pD, x, Cd, rho) +
                gPrev * (P[kp] - x) + gNext * (P[kn] - x) + Gbore * (pBore - x) + Gper * (pPer - x);
              if (voids[k] > 0) {
                P[k] = pV;
                if (sw === sweeps - 1) voids[k] = Math.max(0, voids[k] + (dV - Qin(pV)) * h);
                continue;
              }
              const F = x => (V / K) * (x - Pold[k]) / h - Qin(x) + dV;
              if (F(pV) > 0) {
                P[k] = pV;
                if (sw === sweeps - 1) voids[k] = Math.max(0, (dV - Qin(pV)) * h);
                continue;
              }
              let lo = pV, hi = Math.max(Pold[k], pD, pS) + 1e5;
              for (let g = 0; g < 60 && F(hi) < 0; g++) hi *= 2;
              for (let it = 0; it < 50; it++) {
                const mid = 0.5 * (lo + hi);
                if (F(mid) > 0) hi = mid; else lo = mid;
              }
              P[k] = 0.5 * (lo + hi);
            }
          }
          if (last) {
            const pBore = boreVented ? pS : pPer;
            let out = 0, inn = 0, tip = 0, bore = 0, per = 0;
            for (let k = 0; k < N; k++) {
              const qs = orifice(geo.as[k], pS, P[k], Cd, rho), qd = orifice(geo.ad[k], pD, P[k], Cd, rho);
              out -= qd; inn += qs;
              tip += Math.abs(geo.gt[k] * (P[(k + 1) % N] - P[k]));
              bore += Gbore * (P[k] - pBore);
              per += Math.abs(Gper * (P[k] - pPer));
              if (k === 0) { acc.qs0 += qs; acc.qd0 += qd; }
            }
            acc.out += out - Qland; acc.inn += inn - Qland; acc.tip += tip; acc.bore += bore; acc.per += 0.5 * per;
          }
        }
        if (last) {
          const j1 = (j + 1) % M;
          rec.P[j1] = P[0];
          rec.VF[j1] = voids[0] / Math.max(geo.V[0], 1e-18);
          rec.QS[j] = acc.qs0 / sub; rec.QD[j] = acc.qd0 / sub;
          rec.Qout[j] = acc.out / sub; rec.Qin[j] = acc.inn / sub;
          rec.Qtip[j] = acc.tip / sub; rec.Qbore[j] = acc.bore / sub; rec.Qper[j] = acc.per / sub;
        }
      }
    }

    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    return Object.assign(rec, {
      pS, pD, pV, mu, Qland,
      conductances: { Gbore, Gper, Gland, GtipMean: mean(Gtip0) }, Gtip: Gtip0, boreVented,
      leakMean: { tip: mean(rec.Qtip), bore: mean(rec.Qbore), periphery: mean(rec.Qper), land: Qland },
    });
  }

  /*
   * Outlet pressure ripple: the delivered flow Q(t) of the network (computed at constant p_D) feeds
   * an outlet volume V_out and a load restriction sized for the mean flow at the target Δp
   * (as the GT-SUITE "OutletRestriction"):
   *   V_out/K · dp/dt = Q(t) − Cd·A_r·sqrt(2(p − p_in)/ρ),   A_r = Q̄ / (Cd·sqrt(2Δp/ρ))
   * One-way coupling (the ripple does not feed back on the chamber flows). V_out = 0 gives the
   * purely resistive limit p = p_in + ρ/2·(Q/(Cd·A_r))².
   */
  function outletRipple(p, res, sim) {
    const { M, dt } = res, N = p.N;
    const w2 = p.rpm * TAU / 60 * (N - 1) / N, T = dt / w2;            // time per grid step
    const K = p.bulk * 1e6, rho = p.rho, Cd = p.Cd, pS = sim.pS, dP = sim.pD - sim.pS;
    const Q = sim.Qout;
    let qm = 0;
    for (let j = 0; j < M; j++) qm += Q[j];
    qm /= M;
    if (!(qm > 0) || !(dP > 0)) return null;
    const Ar = qm / (Cd * Math.sqrt(2 * dP / rho));
    const Qr = x => Cd * Ar * Math.sign(x - pS) * Math.sqrt(2 * Math.abs(x - pS) / rho);
    const C = Math.max(0, p.outletVol || 0) * 1e-6 / K;                // compliance [m³/Pa]
    const PD = new Float64Array(M);
    if (C === 0) {
      for (let j = 0; j < M; j++) PD[j] = pS + rho / 2 * (Math.max(Q[j], 0) / (Cd * Ar)) ** 2;
    } else {
      const sub = 8, h = T / sub;
      let x = sim.pD;
      for (let cycle = 0; cycle < 4; cycle++) {
        for (let j = 0; j < M; j++) {
          for (let s = 0; s < sub; s++) {
            const q = Q[j], x0 = x;
            // Implicit Euler: C(x − x0)/h + Qr(x) − q = 0 (monotonic in x).
            let lo = Math.min(x0, pS) - 1e7, hi = Math.max(x0, sim.pD) * 2 + 1e7;
            for (let it = 0; it < 60; it++) {
              const m = 0.5 * (lo + hi);
              if (C * (m - x0) / h + Qr(m) - q > 0) hi = m; else lo = m;
            }
            x = 0.5 * (lo + hi);
          }
          PD[j] = x;
        }
      }
    }
    let mn = Infinity, mx = -Infinity, sum = 0;
    for (const x of PD) { mn = Math.min(mn, x); mx = Math.max(mx, x); sum += x; }
    return { PD, Ar, pMean: sum / M, ripplePa: mx - mn, rippleRel: (mx - mn) / dP, tau: C > 0 ? C * 2 * dP / qm : 0 };
  }

  Object.assign(G, { simulateNetwork, outletRipple, tipConductance, sectorConductance, slotConductance, contactRhoEq });
})(window.Gerotor);
