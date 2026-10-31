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

  // group: shown as <optgroup> in the fluid list. Engine-oil grades use the ν40/ν100 pairs of the
  // GT-SUITE fluid library names (e.g. "Oil-5W30-62-10cSt"); densities are typical values.
  const OILS = {
    vg10: { group: 'Hydraulic (ISO VG)', label: 'ISO VG 10 (HLP 10)', nu40: 10, nu100: 2.6, rho15: 850 },
    vg15: { group: 'Hydraulic (ISO VG)', label: 'ISO VG 15 (HLP 15)', nu40: 15, nu100: 3.5, rho15: 860 },
    vg22: { group: 'Hydraulic (ISO VG)', label: 'ISO VG 22 (HLP 22)', nu40: 22, nu100: 4.3, rho15: 865 },
    vg32: { group: 'Hydraulic (ISO VG)', label: 'ISO VG 32 (HLP 32)', nu40: 32, nu100: 5.4, rho15: 870 },
    vg46: { group: 'Hydraulic (ISO VG)', label: 'ISO VG 46 (HLP 46)', nu40: 46, nu100: 6.8, rho15: 875 },
    vg68: { group: 'Hydraulic (ISO VG)', label: 'ISO VG 68 (HLP 68)', nu40: 68, nu100: 8.7, rho15: 880 },
    vg100: { group: 'Hydraulic (ISO VG)', label: 'ISO VG 100 (HLP 100)', nu40: 100, nu100: 11.1, rho15: 885 },
    hvlp32: { group: 'Hydraulic (ISO VG)', label: 'HVLP 32, VI ≈ 164', nu40: 32.7, nu100: 6.63, rho15: 847 },
    sae0w20: { group: 'Engine oil (SAE)', label: 'SAE 0W-20 (44 / 8.5 cSt)', nu40: 44, nu100: 8.5, rho15: 845 },
    sae0w30: { group: 'Engine oil (SAE)', label: 'SAE 0W-30 (72 / 12 cSt)', nu40: 72, nu100: 12, rho15: 850 },
    sae5w20: { group: 'Engine oil (SAE)', label: 'SAE 5W-20 (43 / 8 cSt)', nu40: 43, nu100: 8, rho15: 850 },
    sae5w30: { group: 'Engine oil (SAE)', label: 'SAE 5W-30 (62 / 10 cSt)', nu40: 62, nu100: 10, rho15: 855 },
    sae5w40: { group: 'Engine oil (SAE)', label: 'SAE 5W-40 (85 / 14 cSt)', nu40: 85, nu100: 14, rho15: 855 },
    sae10w30: { group: 'Engine oil (SAE)', label: 'SAE 10W-30 (77 / 11 cSt)', nu40: 77, nu100: 11, rho15: 865 },
    sae10w40: { group: 'Engine oil (SAE)', label: 'SAE 10W-40 (82 / 15 cSt)', nu40: 82, nu100: 15, rho15: 865 },
    sae15w40: { group: 'Engine oil (SAE)', label: 'SAE 15W-40 (123 / 16 cSt)', nu40: 123, nu100: 16, rho15: 875 },
    sae20w50: { group: 'Engine oil (SAE)', label: 'SAE 20W-50 (114 / 20 cSt)', nu40: 114, nu100: 20, rho15: 880 },
    sae25w40: { group: 'Engine oil (SAE)', label: 'SAE 25W-40 (145 / 15 cSt)', nu40: 145, nu100: 15, rho15: 880 },
    atf: { group: 'Other', label: 'ATF (Dexron type)', nu40: 34, nu100: 7.4, rho15: 860 },
    mil23699: { group: 'Other', label: 'MIL-PRF-23699 turbine oil', nu40: 25, nu100: 5.0, rho15: 1000 },
    mil5606: { group: 'Other', label: 'MIL-PRF-5606 aviation hydraulic', nu40: 14, nu100: 5.2, rho15: 860 },
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
