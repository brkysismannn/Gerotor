/*
 * Oil properties vs temperature.
 *   Kinematic viscosity — ASTM D341 (Walther):  log10(log10(ν + 0.7)) = A − B·log10(T[K]),
 *   fitted through the datasheet values at 40 °C and 100 °C.
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

  const Z = nu => Math.log10(Math.log10(nu + 0.7));

  function waltherFit(nu40, nu100) {
    const x1 = Math.log10(313.15), x2 = Math.log10(373.15);
    const B = (Z(nu40) - Z(nu100)) / (x2 - x1);
    return { A: Z(nu40) + B * x1, B };
  }

  function viscosityAt(nu40, nu100, tC) {
    const { A, B } = waltherFit(nu40, nu100);
    return Math.pow(10, Math.pow(10, A - B * Math.log10(tC + 273.15))) - 0.7;
  }

  const densityAt = (rho15, tC) => rho15 * (1 - 6.5e-4 * (tC - 15));

  function oilProperties(key, tC) {
    const o = OILS[key];
    if (!o) return null;
    return { nu: viscosityAt(o.nu40, o.nu100, tC), rho: densityAt(o.rho15, tC), label: o.label };
  }

  Object.assign(G, { OILS, viscosityAt, densityAt, oilProperties, waltherFit });
})(window.Gerotor);
