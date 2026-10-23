/*
 * Oil properties vs temperature.
 *   Kinematic viscosity — ASTM D341 (Ubbelohde–Walther):
 *     log10(log10(ν + 0.7)) = A − B·log10(T[K])          (ν in cSt, valid for ν ≥ 2 cSt)
 *   Two datasheet points give A and B exactly; with three or more points (e.g. a low-temperature
 *   value) A and B are a least-squares fit in the Walther coordinates. The simulation takes ν at the
 *   operating temperature from this curve.
 *   Density — linear thermal expansion: ρ(T) = ρ15·(1 − α·(T − 15)), α ≈ 6.5·10⁻⁴ 1/K.
 * Preset values are typical datasheet figures (VI ≈ 95–160), not a specific product.
 */
(function (G) {
  'use strict';

  const OILS = {
    vg32: { label: 'ISO VG 32 (HLP 32)', nu40: 32, nu100: 5.4, rho15: 870 },
    vg46: { label: 'ISO VG 46 (HLP 46)', nu40: 46, nu100: 6.8, rho15: 875 },
    vg68: { label: 'ISO VG 68 (HLP 68)', nu40: 68, nu100: 8.7, rho15: 880 },
    sae5w30: { label: 'SAE 5W-30 engine oil', nu40: 62, nu100: 10.5, rho15: 855 },
    mil23699: { label: 'MIL-PRF-23699 turbine oil', nu40: 25, nu100: 5.0, rho15: 1000 },
    atf: { label: 'ATF (Dexron type)', nu40: 34, nu100: 7.4, rho15: 860 },
  };

  const NU_MIN = 2;                                   // lower validity limit of the 0.7 form [cSt]
  const Z = nu => Math.log10(Math.log10(nu + 0.7));
  const X = tC => Math.log10(tC + 273.15);

  // Walther fit through points [[tC, ν], ...]: exact for two, least squares for more.
  function waltherFitPoints(points) {
    const pts = points.filter(([t, nu]) => Number.isFinite(t) && nu > 0 && t > -273.15);
    if (pts.length < 2) return null;
    const n = pts.length;
    let sx = 0, sz = 0, sxx = 0, sxz = 0;
    for (const [t, nu] of pts) { const x = X(t), z = Z(nu); sx += x; sz += z; sxx += x * x; sxz += x * z; }
    const den = n * sxx - sx * sx;
    if (!(Math.abs(den) > 1e-14)) return null;      // all points at the same temperature
    const B = -(n * sxz - sx * sz) / den;
    const A = (sz + B * sx) / n;
    let ss = 0;
    for (const [t, nu] of pts) ss += (viscosityFromFit({ A, B }, t) / nu - 1) ** 2;
    const tMin = Math.min(...pts.map(q => q[0])), tMax = Math.max(...pts.map(q => q[0]));
    return { A, B, rms: Math.sqrt(ss / n), tMin, tMax, n };
  }

  const viscosityFromFit = (fit, tC) => Math.pow(10, Math.pow(10, fit.A - fit.B * X(tC))) - 0.7;

  const waltherFit = (nu40, nu100) => waltherFitPoints([[40, nu40], [100, nu100]]);
  const viscosityAt = (nu40, nu100, tC) => viscosityFromFit(waltherFit(nu40, nu100), tC);
  const densityAt = (rho15, tC) => rho15 * (1 - 6.5e-4 * (tC - 15));

  function oilProperties(key, tC) {
    const o = OILS[key];
    if (!o) return null;
    return { nu: viscosityAt(o.nu40, o.nu100, tC), rho: densityAt(o.rho15, tC), label: o.label, fit: waltherFit(o.nu40, o.nu100) };
  }

  /*
   * User oil from datasheet values in the parameters:
   *   uT1/uNu1, uT2/uNu2 (required), uT3/uNu3 (optional, ν3 = 0 → unused), uRho15.
   * Returns ν, ρ at tC plus the fit and validity notes.
   */
  function userOil(p, tC) {
    const pts = [[p.uT1, p.uNu1], [p.uT2, p.uNu2]];
    if (p.uNu3 > 0) pts.push([p.uT3, p.uNu3]);
    const fit = waltherFitPoints(pts);
    if (!fit) return { error: 'Enter viscosities at two different temperatures.' };
    const nu = viscosityFromFit(fit, tC);
    const notes = [];
    if (tC < fit.tMin - 1e-9 || tC > fit.tMax + 1e-9) notes.push(`extrapolated outside the datasheet range ${fit.tMin}…${fit.tMax} °C`);
    if (nu < NU_MIN) notes.push(`ν < ${NU_MIN} cSt: outside the ASTM D341 (0.7) range`);
    if (fit.n > 2 && fit.rms > 0.05) notes.push(`datasheet points deviate ${(100 * fit.rms).toFixed(0)} % rms from one Walther line`);
    if (!(fit.B > 0)) notes.push('viscosity does not fall with temperature — check the inputs');
    return { nu, rho: densityAt(p.uRho15, tC), fit, notes, points: pts };
  }

  Object.assign(G, { OILS, viscosityAt, densityAt, oilProperties, waltherFit, waltherFitPoints, viscosityFromFit, userOil, NU_MIN });
})(window.Gerotor);
