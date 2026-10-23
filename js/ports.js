/*
 * Port plate (kidney ports) and single-chamber pressure model.
 *
 * Housing frame: outer rotor centre O2 = (0,0), inner rotor centre O1 = (e,0).
 * Rotation is CCW; a chamber at housing angle 0 is at minimum volume, at pi at
 * maximum volume. Suction port spans (0, pi), delivery port spans (pi, 2pi).
 *
 * Port outline: radial edges from O2, outer arc about O2 (radius portRo), inner
 * arc about O1 (radius portRi). Theoretical edge angles are the angular extent
 * of the chamber at its min / max position (Kim et al. 2006; Gamez-Montero et al.),
 * shifted by user timing offsets (positive = in the direction of rotation).
 *
 * Pressure model (lumped parameter, e.g. Rundo 2017; Kim et al. 2006):
 *   dp/dt = K/V (Qs + Qd - dV/dt),  Q = sgn(dp) Cd A sqrt(2|dp|/rho)
 * solved implicitly per step; below the cavitation pressure a vapour/air void
 * volume is tracked instead of letting the pressure fall further.
 *
 * Units: geometry mm / rad; pressure model SI internally.
 */
(function (G) {
  'use strict';

  const TAU = 2 * Math.PI;
  const DEG = Math.PI / 180;
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));

  // ---------------------------------------------------------------- polygon tools

  // Sutherland–Hodgman: clip any simple polygon by a convex CCW polygon.
  function clipConvex(subject, clip) {
    let out = subject;
    for (let i = 0, n = clip.length; i < n && out.length; i++) {
      const a = clip[i], b = clip[(i + 1) % n];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const side = q => ex * (q[1] - a[1]) - ey * (q[0] - a[0]);
      const input = out;
      out = [];
      for (let j = 0, m = input.length; j < m; j++) {
        const P = input[j], Q = input[(j + 1) % m];
        const sp = side(P), sq = side(Q);
        if (sp >= 0) out.push(P);
        if ((sp >= 0) !== (sq >= 0)) {
          const t = sp / (sp - sq);
          out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
        }
      }
    }
    return out;
  }

  const area = poly => poly.length < 3 ? 0 : Math.abs(G.polygonArea(poly));

  function circlePoly(c, r, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = TAU * i / n;
      pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
    return pts;
  }

  // ---------------------------------------------------------------- port geometry

  // Polar extent of the chamber polygon about O2, relative to housing angle thC.
  function chamberExtent(p, L, thC) {
    const poly = G.chamber(p, thC - Math.PI / p.N, L, 96, 32).polygon;
    let lo = Infinity, hi = -Infinity;
    for (const q of poly) {
      const a = wrapPi(Math.atan2(q[1], q[0]) - thC);
      if (a < lo) lo = a;
      if (a > hi) hi = a;
    }
    return [thC + lo, thC + hi];
  }

  function portAngles(p, L) {
    const [minLo, minHi] = chamberExtent(p, L, 0);
    const [maxLo, maxHi] = chamberExtent(p, L, Math.PI);
    const o = k => (p[k] || 0) * DEG;
    return {
      theory: { minLo, minHi, maxLo, maxHi },
      suction: [minHi + o('sucStart'), maxLo + o('sucEnd')],
      delivery: [maxHi + o('delStart'), TAU + minLo + o('delEnd')],
    };
  }

  // Distance along the ray from O2 at angle a to the circle (O1, Ri), outer root.
  function rayToInner(p, a) {
    if (!(p.portRi > 0)) return 0;
    const ux = Math.cos(a), uy = Math.sin(a);
    const b = ux * p.e;                          // u · O1
    const disc = b * b - p.e * p.e + p.portRi * p.portRi;
    return disc < 0 ? 0 : b + Math.sqrt(disc);
  }

  // Closed outline (CCW) of a kidney port spanning [a0, a1].
  function portOutline(p, a0, a1, n) {
    n = n || 96;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      pts.push([p.portRo * Math.cos(a), p.portRo * Math.sin(a)]);
    }
    if (p.portRi > 0) {
      const s1 = rayToInner(p, a1), s0 = rayToInner(p, a0);
      const P1 = [s1 * Math.cos(a1), s1 * Math.sin(a1)], P0 = [s0 * Math.cos(a0), s0 * Math.sin(a0)];
      const f1 = Math.atan2(P1[1], P1[0] - p.e), f0 = Math.atan2(P0[1], P0[0] - p.e);
      let d = f0 - f1;
      while (d > 0) d -= TAU;
      while (d <= -TAU) d += TAU;
      for (let i = 0; i <= n; i++) {
        const f = f1 + d * i / n;
        pts.push([p.e + p.portRi * Math.cos(f), p.portRi * Math.sin(f)]);
      }
    } else {
      pts.push([0, 0]);
    }
    return pts;
  }

  // Convex pieces (sectors of at most 90°) used for area clipping.
  function sectorPieces(p, a0, a1) {
    const pieces = [], nPieces = Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 2)));
    for (let k = 0; k < nPieces; k++) {
      const b0 = a0 + (a1 - a0) * k / nPieces, b1 = a0 + (a1 - a0) * (k + 1) / nPieces;
      const poly = [[0, 0]];
      for (let i = 0; i <= 24; i++) {
        const a = b0 + (b1 - b0) * i / 24;
        poly.push([p.portRo * Math.cos(a), p.portRo * Math.sin(a)]);
      }
      pieces.push(poly);
    }
    return pieces;
  }

  function makePort(p, a0, a1) {
    const outline = portOutline(p, a0, a1);
    return {
      a0, a1, outline,
      area: area(outline),
      pieces: sectorPieces(p, a0, a1),
    };
  }

  /*
   * Relief / metering groove: a thin annular strip of radial width w on the port's mid radius,
   * running from a port edge into the land by `lenDeg` (dir = +1 forward, −1 backward).
   * Split into ≤ 2° quadrilaterals (convex) for clipping; exact area = w · r_mid · Δθ.
   */
  function makeGroove(p, edge, dir, lenDeg, w) {
    if (!(lenDeg > 0) || !(w > 0)) return null;
    const rIn0 = Math.max(rayToInner(p, edge), 0), rm = 0.5 * (p.portRo + rIn0);
    const r1 = rm - w / 2, r2 = rm + w / 2;
    const b0 = Math.min(edge, edge + dir * lenDeg * DEG), b1 = Math.max(edge, edge + dir * lenDeg * DEG);
    const n = Math.max(1, Math.ceil(lenDeg / 2)), pieces = [], outlineIn = [], outlineOut = [];
    const pt = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    for (let i = 0; i < n; i++) {
      const a = b0 + (b1 - b0) * i / n, b = b0 + (b1 - b0) * (i + 1) / n;
      pieces.push([pt(r1, a), pt(r2, a), pt(r2, b), pt(r1, b)]);   // CCW, as clipConvex expects
    }
    for (let i = 0; i <= 4 * n; i++) {
      const a = b0 + (b1 - b0) * i / (4 * n);
      outlineIn.push(pt(r1, a)); outlineOut.push(pt(r2, a));
    }
    return { pieces, outline: outlineIn.concat(outlineOut.reverse()), area: w * rm * (b1 - b0), rm, w, a0: b0, a1: b1 };
  }

  // Area of chamber polygon open to a port: (chamber ∩ sector) − (… ∩ inner disk) + grooves.
  function openArea(poly, port, disk) {
    let s = 0;
    for (const piece of port.pieces) {
      const c = clipConvex(poly, piece);
      if (c.length < 3) continue;
      s += area(c);
      if (disk) s -= area(clipConvex(c, disk));
    }
    for (const g of port.grooves || []) {
      for (const piece of g.pieces) s += area(clipConvex(poly, piece));
    }
    return Math.max(0, s);
  }

  // ---------------------------------------------------------------- pressure model

  function orifice(A, pUp, pCh, Cd, rho) {
    const d = pUp - pCh;
    return A > 0 ? Math.sign(d) * Cd * A * Math.sqrt(2 * Math.abs(d) / rho) : 0;
  }

  /*
   * Simulate chamber 0 over its cycle (one outer-rotor revolution).
   * Inputs on the analysis grid j = 0..M-1 (outer angle t = j*dt):
   *   A [mm²], dA [mm²/rad], As, Ad [mm²].
   */
  function simulateChamber(p, res, As, Ad) {
    const { M, dt, A, dA } = res;
    const w1 = p.rpm * TAU / 60, w2 = w1 * (p.N - 1) / p.N;
    const b = p.b * 1e-3;
    const K = p.bulk * 1e6, rho = p.rho, Cd = p.Cd;
    const pS = p.pIn * 1e5, pD = (p.pIn + p.dp) * 1e5, pV = p.pVap * 1e5;
    const sub = p.simSub || 12, h = dt / w2 / sub;   // time step [s]

    const P = new Float64Array(M), QS = new Float64Array(M), QD = new Float64Array(M), VF = new Float64Array(M);
    let pc = pS, void_ = 0;

    const lerp = (arr, j, f) => arr[j] + (arr[(j + 1) % M] - arr[j]) * f;

    for (let cycle = 0; cycle < 3; cycle++) {
      for (let j = 0; j < M; j++) {
        let qsAcc = 0, qdAcc = 0;
        for (let s = 0; s < sub; s++) {
          const f = (s + 0.5) / sub;
          const V = lerp(A, j, f) * 1e-6 * b;                     // m³
          const dVdt = lerp(dA, j, f) * 1e-6 * b * w2;              // m³/s
          const as = lerp(As, j, f) * 1e-6, ad = lerp(Ad, j, f) * 1e-6;
          const Qin = pp => orifice(as, pS, pp, Cd, rho) + orifice(ad, pD, pp, Cd, rho);

          if (void_ > 0) {
            // Void present: pressure held at cavitation level until it refills.
            pc = pV;
            void_ += (dVdt - Qin(pV)) * h;
            if (void_ < 0) void_ = 0;
          } else {
            const F = pp => (V / K) * (pp - pc) / h - Qin(pp) + dVdt;
            if (F(pV) > 0) {
              pc = pV;
              void_ += (dVdt - Qin(pV)) * h;
              if (void_ < 0) void_ = 0;
            } else {
              let lo = pV, hi = Math.max(pc, pD, pS) + 1e5;
              for (let g = 0; g < 60 && F(hi) < 0; g++) hi *= 2;
              for (let it = 0; it < 60; it++) {
                const mid = 0.5 * (lo + hi);
                if (F(mid) > 0) hi = mid; else lo = mid;
              }
              pc = 0.5 * (lo + hi);
            }
          }
          qsAcc += orifice(as, pS, pc, Cd, rho);
          qdAcc += orifice(ad, pD, pc, Cd, rho);
          if (s === sub - 1 && cycle === 2) {
            P[(j + 1) % M] = pc;
            VF[(j + 1) % M] = void_ / Math.max(V, 1e-18);
          }
        }
        if (cycle === 2) { QS[j] = qsAcc / sub; QD[j] = qdAcc / sub; }
      }
    }
    return { P, QS, QD, VF, pS, pD, pV };
  }

  // ---------------------------------------------------------------- analysis

  function analysePorts(p, res, L) {
    const checks = [];
    const push = (level, title, detail) => checks.push({ level, title, detail });
    const f = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : '—';
    const out = { checks };

    const ang = portAngles(p, L);
    out.angles = ang;
    const [s0, s1] = ang.suction, [d0, d1] = ang.delivery;
    if (!(s1 > s0) || !(d1 > d0)) {
      push('err', 'Invalid port angles', 'A port has zero or negative angular span; check the timing offsets.');
      return out;
    }
    if (s0 < d1 - TAU || d0 < s1) {
      push('err', 'Ports overlap', 'Suction and delivery ports overlap; check the timing offsets.');
      return out;
    }
    const minInner = Math.min(rayToInner(p, s0), rayToInner(p, s1), rayToInner(p, d0), rayToInner(p, d1));
    if (p.portRi > 0 && !(p.portRo > minInner)) {
      push('err', 'Port has no radial width', `Port outer radius ${f(p.portRo)} mm must exceed the inner boundary.`);
      return out;
    }

    out.suction = makePort(p, s0, s1);
    out.delivery = makePort(p, d0, d1);
    // Relief grooves into the lands: suction start/end, delivery start/end.
    const w = p.grooveW || 0;
    out.suction.grooves = [makeGroove(p, s0, -1, p.gSucStart, w), makeGroove(p, s1, +1, p.gSucEnd, w)].filter(Boolean);
    out.delivery.grooves = [makeGroove(p, d0, -1, p.gDelStart, w), makeGroove(p, d1, +1, p.gDelEnd, w)].filter(Boolean);

    // Port radii vs rotors.
    if (p.portRo > p.Rv + 1e-9) push('warn', 'Port beyond outer valley', `Port outer radius ${f(p.portRo)} > Rv ${f(p.Rv)}; reduces outer rotor face sealing.`);
    if (p.portRi > 0 && p.portRi < p.bore / 2) push('warn', 'Port reaches shaft bore', `Port inner radius ${f(p.portRi)} < bore radius ${f(p.bore / 2)}; leakage path to the shaft.`);

    // Opening areas for chamber 0 over its cycle.
    const { M, dt, polys } = res;
    const disk = p.portRi > 0 ? circlePoly([p.e, 0], p.portRi, 128) : null;
    const As = new Float64Array(M), Ad = new Float64Array(M);
    for (let j = 0; j < M; j++) {
      As[j] = openArea(polys[j], out.suction, disk);
      Ad[j] = openArea(polys[j], out.delivery, disk);
    }
    out.As = As; out.Ad = Ad;

    // Cross-porting and trapped volume.
    const tol = 1e-4 * res.Amax;
    let cross = 0, trappedSwing = 0, inTrap = false, trapStart = 0;
    for (let j = 0; j < M; j++) {
      if (As[j] > tol && Ad[j] > tol) cross++;
      const trapped = As[j] <= tol && Ad[j] <= tol;
      if (trapped && !inTrap) { inTrap = true; trapStart = res.A[j]; }
      if (trapped) trappedSwing = Math.max(trappedSwing, Math.abs(res.A[j] - trapStart));
      if (!trapped) inTrap = false;
    }
    out.crossDeg = cross * dt * 180 / Math.PI;
    if (cross > 0) push('err', 'Cross-porting', `A chamber connects both ports over ${f(out.crossDeg, 1)}° of rotation (direct leakage path).`);
    else push('ok', 'No cross-porting', 'Lands separate suction and delivery at all positions.');
    const swingPct = 100 * trappedSwing / (res.Amax - res.Amin);
    if (swingPct > 2) push('warn', 'Trapped volume change', `Volume changes by ${f(swingPct, 1)} % of the stroke while sealed from both ports.`);

    // Inlet velocity (Nichols / Gamez-Montero: below 2 m/s).
    const fill = p.doubleFill ? 2 : 1;
    out.inletVelocity = res.flowLpm * 1000 / (60 * out.suction.area * fill);
    if (out.inletVelocity > 2) push('warn', 'High inlet port velocity', `${f(out.inletVelocity)} m/s > 2 m/s; enlarge the port or use double fill.`);
    else push('ok', 'Inlet port velocity', `${f(out.inletVelocity)} m/s (limit 2 m/s).`);

    // Pressure model.
    if (p.rpm > 0) {
      // Multi-chamber network (js/leakage.js); with leakage off it reduces to the
      // single-chamber model (checked in tests).
      const sim = G.simulateNetwork(p, res, As, Ad, out);
      out.sim = sim;
      const Qout = sim.Qout;
      let qSum = 0, qMin = Infinity, qMax = -Infinity, pMax = -Infinity, pMin = Infinity, vfMax = 0;
      for (let j = 0; j < M; j++) {
        const s = Qout[j];
        qSum += s;
        qMin = Math.min(qMin, s); qMax = Math.max(qMax, s);
        pMax = Math.max(pMax, sim.P[j]); pMin = Math.min(pMin, sim.P[j]);
        vfMax = Math.max(vfMax, sim.VF[j]);
      }
      const qMean = qSum / M;                           // m³/s
      const qTheo = res.cc * 1e-6 * p.rpm / 60;
      Object.assign(out, {
        Qout, qMean, qTheo,
        flowLpm: qMean * 6e4,
        portEfficiency: qMean / qTheo,                  // volumetric efficiency (timing + leakage)
        ripple: (qMax - qMin) / qMean,
        pMaxBar: pMax / 1e5, pMinBar: pMin / 1e5, voidMax: vfMax,
        leak: sim.leakMean,
      });
      if (p.leakOn) {
        const lossPct = 100 * (1 - qMean / qTheo);
        push(lossPct > 10 ? 'warn' : 'ok', 'Volumetric efficiency', `${f(100 * qMean / qTheo, 1)} % (tip gaps, axial faces, port lands, timing).`);
      }
      const over = (pMax - sim.pD) / Math.max(sim.pD - sim.pS, 1e4);
      if (over > 0.2) push('warn', 'Pressure overshoot', `Peak chamber pressure ${f(pMax / 1e5, 1)} bar abs, ${f(100 * over, 0)} % of Δp above delivery.`);
      else push('ok', 'Pressure peaks', `Peak chamber pressure ${f(pMax / 1e5, 1)} bar abs.`);
      if (vfMax > 0.005) push('warn', 'Cavitation / incomplete filling', `Max void ${f(100 * vfMax, 1)} % of chamber volume; delay the suction port end or add a metering groove.`);
      else if (pMin <= sim.pV * 1.0001) push('info', 'Brief cavitation at port edges', `Pressure touches the cavitation limit near the port edges (max void ${f(100 * vfMax, 2)} %).`);
      else push('ok', 'No cavitation', `Min chamber pressure ${f(pMin / 1e5, 2)} bar abs.`);
    }
    return out;
  }

  Object.assign(G, { analysePorts, portOutline, portAngles, clipConvex, simulateChamber, makeGroove, portOpenArea: openArea });
})(window.Gerotor);
