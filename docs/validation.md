# Validation Report

Run the suite by opening `tests/index.html` (served or from file). Every new feature must add tests here
and keep the suite at **0 fail**. Status `known` marks a documented open discrepancy, not a regression.

Last run: 2026-10-23 — **281 pass · 0 fail · 3 known** (284 tests, ~140 s).

## Change log of the numerical core

- **2026-10-22 — exact chamber area.** Chamber area is now computed analytically (closed-form circular arcs
  for the outer rotor, 24×8-point Gauss–Legendre on the offset inner profile with P' = Q'(1 − r·κ)), and the
  volume derivative dV/dφ by the vector-ray formula (Rundo 2017, Eq. 18) instead of a numerical derivative.
  The previous polyline areas carried a chord error of ~2·10⁻⁴ whose differentiation inflated flow ripple
  (e.g. default design 4.98 % → 4.49 %). All literature errors below improved as a result.

## 1. Internal consistency

| Test | Error |
|---|---|
| Σ chamber areas = cavity area (4 designs, N = 5…11) | ≤ 1.5·10⁻⁴ % |
| Displacement: (N−1)·ΔA·b vs mean Σ negative dV/dφ | ≤ 0.0013 % |
| Exact area vs 16 000-point polygon | ≤ 3·10⁻⁷ rel. |
| dV/dφ (vector-ray) vs numerical derivative of exact area | 1.4·10⁻⁷ % of max |
| Displacement independent of valley radius | 0 |
| Fast model (24 samples/pitch) vs full: ripple / displacement | ≤ 0.01 pts / ≤ 1·10⁻⁴ rel. |

## 2. Displacement vs published data

| Source / design | Published | Tool | Error |
|---|---|---|---|
| Antoniak 2026, Table 1 #1–#5 (z1 = 10) | 0.479–0.493 cm³/rev | 0.4788–0.4931 | 0.005–0.105 % |
| Ivanović 2020, Models 1 / 2 | ≈ 14 cm³/rev | 13.997 / 14.002 | 0.019 / 0.013 % |
| Ivanović 2020, Model 3 | ≈ 14 cm³/rev | 13.675 | 2.3 % (paper gives "≈ 14") |
| GDS screenshot — outer root radius | 40.583 mm | 40.583 | 0 |
| GDS — max chamber volume | 2015 mm³ | 2019.8 | 0.24 % |
| GDS — swept volume from its own chamber volumes | 15.789 cm³/rev | 15.751 | 0.24 % |
| GDS — area ratio | 20.79 % | 20.87 % | 0.40 % |
| Kim 2006 — max chamber area (graph reading) | ≈ 75 mm² | 78.5 | 4.7 % |

GDS design: N = 9, e = 3.861, lobe radius 10, inner root radius 29 (→ R = 42.861), b = 10.

## 3. Kinematic flow ripple vs published data

| Source / design | Published δq | Tool | Error (rel.) |
|---|---|---|---|
| Ivanović 2020 Model 1 | ≈ 10 % | 9.81 % | 1.9 % |
| Ivanović 2020 Model 2 | ≈ 10 % | 9.95 % | 0.5 % |
| Ivanović 2020 Model 3 | 9.7 % | 9.50 % | 2.0 % |
| Antoniak 2026 #5 | 1.26 % | 1.34 % | 6.6 % |
| Trend: δq decreases with N | yes | 10.75 > 4.44 > 2.36 > 1.45 % | ✓ |

## 4. Known open issues

| Item | Published | Tool | Comment |
|---|---|---|---|
| GDS "Approx. capacity" | 15.921 | 15.751 (−1.1 %) | GDS value ≈ Stryczek closed form (15.956) |
| Stryczek closed form (Antoniak Eq. 2) vs exact | — | formula +1.25 … +3.1 % | Antoniak's own Table 1 agrees with the exact value |
| Antoniak δe #1 | 1.15 % | 1.40 % | δe definition (Stryczek Eq. 3) not reproduced; #5 agrees within 6.6 % |
| ~~GDS min chamber volume~~ | 41.4 mm³ | 42.85 mm³ (3.5 %) | **resolved** by the fillet + clearance volume model (§11) |

## 5. Ports & chamber pressure model

| Test | Result |
|---|---|
| Theoretical port edges mirror-symmetric about line of centres | exact |
| No cross-porting with theoretical ports; −4° delivery start detected | ✓ |
| Opening area ≤ chamber area; mid-suction chamber open | 0 % excess; 99.8 % open |
| Mass balance incl. compressibility: net inflow = −(1/K)∮p dV | 0.87 % |
| Time-step convergence (6 vs 48 sub-steps): flow / peak p / ripple | 0.001 % / 0.33 % / 1.5 % |
| Low-speed limit (20 rpm, Δp = 0): flow / ripple → kinematic | 0.006 % / 0.22 pts |
| Trends: early suction close lowers flow; peak pressure rises with speed | ✓ |

## 11. Outer rotor fillets & actual chamber volume

Fillet of radius r_f tangent to lobe and valley circle (closed-form arcs); actual chamber volume includes the
profile clearance c (inner profile offset r_p + c, closed by normal segments at the contacts).

| Test | Result |
|---|---|
| Tangency to valley circle / lobe | exact / 1·10⁻¹³ % |
| Σ chamber areas = cavity area (with fillets) | 2·10⁻⁶ rel. |
| Fillet removes equal area at min and max volume; displacement unchanged | 3·10⁻¹² % / 2·10⁻¹⁴ % |
| Oversized fillet rejected; interference with inner teeth detected (GDS design: first at r_f = 4 mm) | ✓ |
| Clearance volume ΔA = c × inner arc length | 1·10⁻⁵ % |
| **GDS screenshot with its 2 mm fillets and 0.02 mm tip clearance**: max chamber volume | 2015 vs 2014.7 mm³ (0.017 %) |
| **GDS**: min chamber volume | 41.42 vs 42.85 mm³ (3.5 %) |

Fix found during this work: the tip-to-valley check used Rv ≥ R + 2e − r_p **+** c; the clearance shortens the
inner teeth, so the correct limit is Rv ≥ R + 2e − r_p − c (GDS uses exactly R + 2e − r_p with c = 0.02).

## 12. Viscous friction & efficiencies (`js/friction.js`, Totaro et al. 2025)

M_shaft = M_press + τ(M_OD + M_outer faces) + M_inner faces + M_bearings; η_m = M_th / M_shaft.

| Test | Result |
|---|---|
| Short-bearing (Ocvirk) eccentricity solve: load(ε) = W | 6·10⁻¹⁴ % |
| Journal torque at ε = 0 = Petroff | exact |
| Lateral ring torque vs numerical shear integration | 5·10⁻⁹ % |
| Totaro: lateral losses independent of pressure; ∝ speed | exact |
| Totaro: OD loss grows with pressure; outer-rotor losses dominate; smaller clearance → more loss | ✓ |
| Nichols: smaller outer Ø → lower viscous loss | ✓ |
| Power balance P_out / P_in = η_v·η_m | 3·10⁻¹⁴ % |
| η_m falls at low pressure (default design 100 → 10 bar) | 94.0 → 66.6 % |

Totaro et al. report that this full-film model underestimates torque at low speed / high pressure (mixed
lubrication) and overestimates it at high speed; no absolute torque data are available to us.

## 13. Performance map (`js/perfmap.js`)

| Test | Result |
|---|---|
| Map point = full analysis at the same operating point (η_v, η_m, torque) | exact |
| η_v rises with speed; η_m falls with speed at low Δp; η_t optimum above the lowest speed at high Δp | ✓ |
| CSV export (13 columns) | ✓ |

## 14. Reverse engineering (`js/reverse.js`)

e = (Dt − Dr)/4, c = Dl/2 − (Dt + Dr)/4, R = Dl/2 + r_p, Rv = Dv/2.

| Test | Result |
|---|---|
| Round trip (3 designs incl. GDS and Ivanović M1) | ≤ 5·10⁻¹² µm |
| GDS screenshot dimensions → e = 3.861, valley margin 0 | exact |
| Inconsistent measurement (negative clearance) flagged | ✓ |

## 15. Oil viscosity & flow-ripple spectrum (`js/fluid.js`, `js/spectrum.js`)

| Test | Result |
|---|---|
| ASTM D341 (Walther) fit through ν40 and ν100 (ISO VG 46, MIL-PRF-23699) | ≤ 7·10⁻¹³ % |
| Viscosity monotonic in temperature; MIL-PRF-23699 ν(−40 °C) ≤ 13 000 cSt | 10 606 cSt ✓ |
| Kinematic ripple has energy only at multiples of N (tooth pass) | 1·10⁻¹³ % |
| Even N (6, 8): dominant harmonic = tooth pass | ✓ |
| Odd N (7): dominant = tooth pass, but two ripple minima per tooth pass and a stronger 2nd harmonic (2N/N 0.59 vs 0.27–0.30) | ✓ |
| **Parity rule (Nichols; Mancò 2000; Gamez-Montero): even inner-tooth count < odd with one more tooth** | 6 inner 4.44 % < 7 inner 6.25 %; 8 inner 2.36 % < 9 inner 4.12 % |

The parity effect, listed as open while the chamber area was polygon-based, is reproduced by the exact model.

## 16. Relief grooves (`js/ports.js`)

Groove: annular strip of width w on the port mid radius, from a port edge into the land, split into 2°
quadrilaterals; its clipped overlap with the chamber is added to that port's opening area.
Test design N7, e 3, R 30, rp 8, 1500 rpm, Δp 100 bar.

| Test | Result |
|---|---|
| Groove area by clipping = w·r_mid·Δθ (4°/1 mm, 10°/0.5 mm, 25°/2 mm) | 0.02 % (chord error) |
| Delivery opened 16° late → trapped compression peak | 289 vs 137 bar ✓ |
| **Groove 15° at delivery start, width 0.25 / 0.5 / 1 mm (Kim et al. 2006 trend)** | 289 → 189 → 154 → 137 bar (back to un-trapped value, 0.0 %) |
| Groove inside the land: no cross-porting; groove through the land (40° vs 12° delay): detected | ✓ |
| Suction closed 6° early; 5° × 2 mm groove at suction end | void 1.25 % → 0.75 %, flow ↑ ✓ |
| Zero-length grooves change nothing; DXF PORTS layer holds ports + grooves | ✓ |

## 17. Filling-limited maximum speed (`js/perfmap.js` `maxSpeed`)

Bisection on shaft speed for peak chamber void = 0.5 % (the tool's cavitation warning level), network
model at the current Δp. Filling through the suction port is orifice-limited, so the speed limit should follow
n_max ∝ C_d · A_open · √((p_in − p_vap)/ρ). The model reproduces this law without it being coded anywhere:

| Test | Expected | Error |
|---|---|---|
| Bracket: void ≤ 0.5 % at n_max, > 0.5 % at n_max + 20 rpm | — | ✓ (2626 rpm) |
| C_d 0.7 → 0.5 | × 0.714 | 0.40 % |
| ρ 860 → 1000 kg/m³ | × 0.927 | 0.15 % |
| p_in 1 → 2 bar abs (p_vap 0.2) | × 1.500 | 0.21 % |
| p_in 1 → 0.6 bar abs | × 0.707 | 0.44 % |
| Double fill (ports on both faces) | × 2 | 0.32 % |
| Inlet-velocity limit: v = 2 m/s at reported n_inlet | 2 m/s | 0 |

GDS cavitation criteria (tip dynamic pressure, inlet-gallery Re = 2000; see §18) are reported next to it.

Fix found while adding this: the network model ignored *double fill* for the orifice areas (it only doubled
the port-land leakage); suction and delivery opening areas are now doubled.

## 18. GDS documents: correlation pumps, axial support, cavitation limits, side load

Source: Gerotor Design Studio documents in `References/GDS Documents/` (correlation study V2.0.30, power,
cavitation and contact-stress notes, user guide V2021). GDS inputs → this tool: R = inner root radius + r_p + e,
outer root radius = R + 2e − r_p (valley margin 0), tip clearance → c, axial clearance → axialClr,
circumferential clearance = axial clearance (GDS assumption) → odClr.

| Test | Reference | This tool | Error |
|---|---|---|---|
| **Rexroth PGZ4-80** (N 9, e 4.4, root 35, r_p 20, b 39, OD 110; shadow ports): displacement | 84.2 cm³ (catalogue) | 83.83 | −0.44 % |
| Rexroth: flow 1450 rpm, 10 bar, 30 cSt | 116 L/min (GDS 116.94) | 112.36 | −3.1 % |
| Rexroth: drive power at Δp ≈ 10 bar | 3.0 kW (GDS 2994 W) | 3019 W | +0.6 % |
| Rexroth: drive power at Δp ≈ 1 bar | 1.1 kW (GDS 1134 W) | 1172 W | +6.6 % |
| **Mancò 2002 miniature gerotor** (N 13, e 0.5, root 7.25, r_p 1.5, b 3.8): min chamber volume | 0.43 mm³ (GDS) | 0.427 | −0.7 % |
| Miniature: max chamber volume | 16.04 mm³ (GDS) | 15.72 | −2.0 % |
| Miniature: drive torque 1500 rpm, 50 bar, single-sided ports, μ 0.04 | 0.48 N·m measured (GDS 0.55) | 0.453 | −5.7 % |
| Single-sided support: viscous face drag ¼ of balanced (GDS: balanced ×4); face leakage ×4 | — | exact | 0 |
| Floor friction μ·(Δp·A/2)·R_eff; double-sided ports override single-sided support | — | exact | 0 |
| Port arrangement select (one-sided / + shadow / double-sided) maps to the support and fill flags; one-sided reproduces the single-sided result | — | exact | 0 |
| GDS cavitation criteria: ½ρ(r_tip·ω)² = p_in − p_vap; inlet gallery Re = 2000 | — | exact | 0 |
| Shaft side load: zero with equal chamber pressures | 0 N | 1·10⁻¹¹ N | — |
| Side load direction (quasi-static, delivery in the lower half) | 90° | 90.04° | 0.04° |
| Side load vs projected-area estimate Δp·2R_tip·b (Totaro 2025) | 9988 N | 8582 N | −14 % (estimate projects the full tip Ø) |

Not used as a test — **Parker PGG20010**: the rotor set is GDS's guess (Nichols 4086, b 7 mm), its GDS capacity
(0.236 in³) exceeds the catalogue 0.218 in³, and with the assumed 0.08 mm tip clearance this tool's tip leakage
(backlash gaps up to ~2c on the delivery side) gives η_v ≈ 15 % at 1000 rpm / 34.5 bar vs 86 % measured;
c ≈ 0.02–0.04 mm reproduces the measured 3.33 L/min. Too many unknowns for a benchmark (GDS itself: "values
could be very different if a different rotor set is actually used").
GDS "Approx. capacity" vs exact displacement: +0.7 % (Rexroth, miniature), +1.1 % (GDS screenshot), +4.6 %
(Parker, N 5) — a closed-form approximation, consistently above the exact value.

## 19. User oil from datasheet values (`js/fluid.js`, ASTM D341)

The user enters the datasheet viscosities at two temperatures (a third, e.g. a cold value, is optional) and
ρ at 15 °C. The Walther line log log(ν + 0.7) = A − B·log T passes exactly through two points; with three it is
a least-squares fit. The simulation uses ν and ρ at the oil temperature from this curve (chart in the Fluid panel).

| Test | Result |
|---|---|
| Two points at arbitrary temperatures (0 / 60 °C) reproduced | 1·10⁻¹³ % |
| User oil at 40/100 °C = preset path | exact |
| Three collinear points: least-squares B = two-point B, rms 0 | exact |
| **Independent: Mobil DTE 10 Excel 32** (32.7 cSt @ 40 °C, 6.63 @ 100 °C; datasheet in the GDS study): ν(−20 °C) vs Brookfield 1090 cP | 1067 vs 1259 cSt (−15 %; 60 K extrapolation, VI 164 oil) |
| Adding the −20 °C value as third point: ν(−30 °C) vs Brookfield 3360 cP | error −27 % → −12 % |
| Flags: extrapolation outside the datasheet range, ν < 2 cSt (0.7-form limit), inconsistent third point, equal temperatures | ✓ |
| Density ρ15·(1 − 6.5·10⁻⁴·(T − 15)) | exact |

Brookfield values are low-shear dynamic viscosities converted with ρ(T); for polymer-containing high-VI oils
they exceed the Newtonian extrapolation, so the cold-end comparison is a plausibility check.

## 20. GDS results panel, outlet pressure ripple, charts, Excel export

Reference: Gerotor Design Studio V2021 screenshot (user supplied) — N 9, e 3.861, inner root 29, r_p 10,
b 10, OD 95, shaft 22, fillet 2, tip clearance 0.1, axial 0.1, radial 0.15, ρ 855, ν 14 cSt, double-sided
outlet port; results at 5000 rpm / 10 bar.

| Quantity | GDS | This tool | Error |
|---|---|---|---|
| Max tool Ø to cut the inner rotor (concave root: 2·(|ρ_trochoid| + r_p)) | 20.5 mm | 20.49 mm | −0.05 % |
| Shaft side load | 713.8 N | see test (≈ 670 N) | ≈ −6 % |
| Pressure ripple | 13.15 % | ≈ 12.1 % (resistive load) | ≈ −8 % |
| Max chamber volume | 2024 mm³ | 2037.7 mm³ | +0.7 % |
| Max speed to avoid cavitation, tip criterion | 4808 rpm | 4014 rpm with r_tip = 36.62 mm | GDS evidently uses a smaller radius (≈ 30.6 mm, near the inner pitch radius 30.9 mm); not a test |
| Hertz stress, 10 bar | ≈ 150 MPa (chart) | ≈ 340 MPa | not comparable: GDS loads the contact with the inner-rotor torque incl. friction; this tool with the outer-rotor fluid torque on one backlash contact |
| Volumetric efficiency | flat ≈ 80 % vs pressure | falls with pressure (laminar leakage ∝ Δp) | GDS curves are model output, not measurements |

GDS applies the tip clearance outside the inner-rotor offset (its tool Ø matches c = 0); this tool offsets the
inner profile by r_p + c, so its own tool Ø is 2c larger.

Outlet pressure ripple: the network's delivered flow Q(t) (at constant p_D) feeds an outlet volume and a load
restriction sized for the mean flow at the target Δp (GT-SUITE "OutletRestriction"),
V/K·dp/dt = Q(t) − C_d·A_r·sqrt(2(p − p_in)/ρ), one-way coupled. (A two-way coupled version inside the
Gauss–Seidel chamber sweep did not converge — chamber and outlet node track each other through the open port
orifice, ripple varied 3–13 % with the sub-step count — so it was replaced.)

| Test | Result |
|---|---|
| Resistive limit (V = 0): p − p_in = Δp·(Q/Q̄)² | exact |
| Outlet volume filters the ripple (0 → 20 → 200 cm³) | monotonic ✓ |
| Mean outlet pressure = p_in + Δp | < 1 % |
| xlsx writer: CRC-32 check value, ZIP records, column names; workbook opened by .NET ZipArchive, all parts well-formed XML | ✓ |

## 21. Porting type, metering-groove depth, port corner radii (GDS "Port Design" parity)

- **Porting type** as in GDS: double-sided inlet, double-sided outlet, shadow ports (independent). Inlet and
  outlet orifice areas are doubled separately; the rotors are balanced when the outlet is double-sided or
  shadow ports are present, otherwise pressed to the housing floor (§18).
- **Groove depth d:** the groove cross-section w·d is in series with the groove's face opening A_o:
  A_eff = (A_o⁻² + (w·d)⁻²)^(−½); d = 0 means full depth.
- **Port fillet radii:** tangent fillets at the four port corners (radial edge × outer circle about O2 /
  inner circle about O1). The corner material is removed from the opening area as a fan of signed triangles
  from the corner point (exact also on the concave inner circle); the outline is drawn and exported filleted.

| Test | Result |
|---|---|
| Flags: outlet-only, inlet-only (no shadow → pressed to floor), shadow-only | ✓ |
| Double-sided inlet halves the inlet port velocity | exact |
| Double-sided outlet lowers the delivery throttling peak (3000 rpm) | ✓ |
| Groove depth series law (w·d = A_o → A_o/√2) | exact |
| Very deep groove = full-depth groove; 0.05 mm deep groove relieves the trapped peak less | ✓ |
| Filleted port: clipped opening of a covering chamber = outline area | < 0.1 % |
| Two outer corners (r_f 1 mm, R_o 28.5 mm): removed area vs exact corner area (sector − quadrilateral − fillet sector) | 0.4585 vs 0.4539 mm² (0.005 mm², chord discretisation of the port arc) |
| Oversized fillet rejected (sharp corners used, error shown) | ✓ |

## 22. OpenModelica export (`js/modelica.js`, `tools/serve.ps1` → OMEdit)

The "Open in OpenModelica" button writes a self-contained Modelica package (MSL 4.1) to
`modelica/<name>/` and starts OMEdit: `Components.Gerotor` (N chambers, port orifices, tip/face/land
leakage, shaft torque by the power balance), `Volume`, `Restriction`, `Tank`, and
`Examples.PumpSystem` (constant-speed source → gerotor → outlet volume → load restriction → tank, as the
GT-SUITE model GDS builds). Angle-dependent geometry (A, dA/dθ, A_s, A_d, G_tip) is embedded as periodic tables
from the browser model. `cases.mos` runs the case table (Charts range: speeds × pressure rises, restriction
sized for each Δp at the expected flow — GT "Case Setup"); `cases.csv` lists the case parameters.

In-browser tests (suite 22): identifier sanitising, package contents, table = analysis data (area, G_tip),
all table rows numeric, case count and `.mos` commands, restriction sizing law, case CSV.

**Cross-check OpenModelica 1.26.3 vs browser network** (default design N 7, 1500 rpm, 100 bar, leakage on;
`omc` simulation of `PumpSystem`, 6 revolutions, mean of the last 2; outlet volume 1 cm³):

| Quantity | Browser (constant p_D) | OpenModelica (outlet volume + restriction) | Difference |
|---|---|---|---|
| Delivered flow | 21.05 L/min at Δp 100 bar | 21.11 L/min at mean Δp 100.8 bar | +0.3 % |
| Shaft (pressure) torque | 25.74 N·m (×100.8/100 = 25.95) | 25.95 N·m | ≈ 0 |
| Min chamber pressure | 0.846 bar | 0.847 bar | ≈ 0 |
| `checkModel` | — | 114 equations / 114 variables, passed | — |

**Network model (GT-SUITE layout).** `Examples.PumpSystem` is built from separate components like the GT model
Gerotor Design Studio generates: `Vol1…VolN` (chamber volumes with their In/Out port orifices, placed on a ring at
their housing angles), `gap1…gapN` (tip gaps), `Axial_Gap` (face gaps to periphery and bore), `Port_Land`,
`InletEnv → InletLine → InletVol`, `OutletVol → OutletRestriction → OutletEnv`, `rotor` (PumpAnalysis: angle to
all chambers, chamber torques summed on its flange), `GerotorFriction` (viscous + floor-friction loss torque,
coefficients from js/friction.js, reads outlet/inlet pressure), `PumpMechShaft` (rotor inertia),
`PumpGearRatio`, `EngineSpeed`. `PumpSystemLumped` keeps the one-block gerotor.

| Check (default design, 1500 rpm, 100 bar) | Result |
|---|---|
| Network vs lumped: pressure torque | 25.94853 vs 25.94842 N·m |
| Network vs lumped: mean outlet pressure | 101.7917 vs 101.7918 bar |
| Network: shaft torque incl. losses vs browser (25.95 pressure + 1.646 friction) | 27.595 vs 27.59 N·m |
| `checkModel` of the network system | 250 equations / 250 variables |
| In-browser: one chamber + one tip gap per lobe; friction block reproduces M_shaft − M_pressure (balanced and single-sided) | exact |

**Viscosity–temperature coupling (`FluidProperties`, the GT "VisSensor").** `inner fluid` computes
ν(T) by ASTM D341 with the Walther A, B of the selected oil (preset or datasheet fit; 'custom' oil → constant),
ρ(T) = ρ15(1 − α(T − 15)) and μ = νρ; parameter `T_oil` or an optional temperature input. All laminar gap
conductances (tip gaps, axial gaps, port lands) are scaled by μ_ref/μ, the viscous friction by μ/μ_ref, the
orifices use ρ(T). `cases.mos` overrides `T_oil` per case.

| Check (ISO VG 32, design at 40 °C, run at 80 °C) | Browser model (recomputed at 80 °C) | OpenModelica (T_oil = 80) | Difference |
|---|---|---|---|
| ν(80 °C) | 8.5332 cSt | 8.5332 cSt | 0 |
| Delivered flow at the same mean Δp (64.88 bar; 1 L outlet volume, ripple ±0.8 %) | 17.3267 L/min | 17.3227 L/min | −0.02 % |
| Pressure torque at Δp 67.07 bar | 17.232 N·m | 17.229 N·m | −0.02 % |
| Shaft torque incl. losses | 17.743 N·m | 17.679 N·m | −0.4 % (journal-bearing eccentricity kept at the 40 °C value) |

With a 1 cm³ outlet volume the outlet pressure pulsated ±15 % and the mean delivered flow differed by 2.6 % — a real
two-way effect of a stiff outlet; the port volumes are therefore now port area × rotor width (GDS port depth).

Compile ≈ 19 s, simulation ≈ 2 s. Differences in the model: cavitation by a smooth bulk-modulus drop instead
of a void volume; orifice √ regularised below 100 Pa; outlet pressure two-way coupled (the browser ripple
estimate is one-way, §20).

## 23. PDF technical drawing and STEP AP242 (`js/drawing.js`, `js/step.js`)

**PDF drawing** (A3 landscape, vector, Helvetica): outer rotor and inner rotor front views with diameter
dimensions (OD, valley Ø, lobe-tip Ø; tip Ø, root Ø, bore Ø), side views with the width, assembly view with the
eccentricity, profile-data table (N, e, R, r_p, c, R_v, b, λ, displacement, max tool Ø), notes and title block;
largest standard scale with the outer rotor ≤ 115 mm. Checked: PDF header/trailer, every xref offset points to
its object, stream length, dimension texts present; rendered with pdf.js and inspected.

**STEP AP242** (ISO 10303-242 MIM LF): per rotor a `MANIFOLD_SOLID_BREP`; product structure, mm units,
1e-7 uncertainty; scope outer / inner / assembly (two solids, inner rotor at x = e).
- **Exact mode (default):** outer rotor, OD and bore as true `CIRCLE` edges / `CYLINDRICAL_SURFACE` faces (lobe,
  fillet and valley arcs of the analytical profile); inner profile as one cubic B-spline per tooth (global
  interpolation with end derivatives, Piegl & Tiller §9.2.2, G1 joints) on `SURFACE_OF_LINEAR_EXTRUSION`
  faces, refined until the deviation is ≤ 2 µm. Files: 21 kB (outer), 60 kB (inner).
- **Facet mode:** one planar side face per segment (tolerance-driven, 2 µm).

**Import check in FreeCAD 1.1.4 (OpenCascade)** — `tools/check_step.py`, default design:

| File | Shape | isValid / closed / check | Faces (types) | Volume FreeCAD | Exact volume | Difference |
|---|---|---|---|---|---|---|
| exact outer | Solid | ✓ / ✓ / ok | 20 (Cylinder, Plane) | 59 464.0461 | 59 464.0461 | 0 |
| exact outer, fillets 1.5 | Solid | ✓ / ✓ / ok | 34 (Cylinder, Plane) | 59 564.2957 | 59 564.2957 | 0 |
| exact inner (bore) | Solid | ✓ / ✓ / ok | 12 (SurfaceOfExtrusion, Cylinder, Plane) | 25 387.49 | 25 357.36 | +0.12 % * |
| exact inner, no bore | Solid | ✓ / ✓ / ok | 8 | 30 476.87 | 30 446.74 | +0.10 % * |
| exact assembly | Compound of 2 solids | ✓ / ✓ / ok | 20 + 12 | as above | | |
| facet outer / inner / assembly | Solid(s) | ✓ / ✓ / ok | 849 / 614 planes | 59 455.87 / 25 358.68 | | −0.014 % / +0.005 % (chords) |

\* The cross-section of the imported inner rotor is exact (bottom face area 1522.345 mm² vs 1522.337 mm² of a
200 000-point profile; spline deviation ≤ 0.4 µm); FreeCAD's **own** extrusion of that face gives the identical
volume 30 476.87 mm³ and side area 3238.913 mm², i.e. the +0.1 % is OpenCascade's numerical volume integration
over B-spline extrusion faces, not the exported geometry.

| Check (default design) | Result |
|---|---|
| All `#` references defined | 0 missing (outer ≈ 1.1 MB, inner ≈ 0.8 MB, assembly ≈ 1.9 MB) |
| Every edge used exactly twice with opposite senses (closed manifold shell) | ✓ all shells |
| Euler–Poincaré V − E + F − (L − F) = 2(1 − G), G = through-holes | 0 = 0 (rotors with a hole) |
| Enclosed volume by the divergence theorem = region area × b | exact (1e-9 %) |
| Facets: tolerance-driven (max deviation 2 µm from a 24 000-point profile; circles by chord height) | 462 inner-profile facets, max deviation 1.9997 µm |
| Faceting: inner-profile area vs 20 000-point profile | 0.0006 % |

A first version sampled the profile uniformly in the trochoid parameter (720 facets): the facet deviation reached
13.8 µm at the tooth root, where the offset profile moves fastest — replaced by the tolerance-driven facets.

In-browser tests (suite 23) additionally check the exact mode: no dangling references, closed shells and
Euler–Poincaré, face/surface types, arcs of the outer profile joined end to end (with fillets), spline
deviation ≤ 2 µm, and the interpolation itself (data points to 2e-16, prescribed end tangent).

## 6. Export

DXF (EOF, 3 layers), SVG parse, CSV first point = root radius — all ✓.

## 7. Design Assist

| Test | Result |
|---|---|
| Scaling law displacement ∝ e² | 2·10⁻¹³ % |
| All results meet target displacement (worst) | 0.001 % |
| All results satisfy outer Ø, bore wall, geometry checks | ✓ |
| Search ripple (fast) vs full model (worst) | 8·10⁻⁵ pts |
| Restricted (N = 9) vs full search optimum | 0 pts |
| GDS packaging (Ø 95, b 10, bore 22, walls 5): N = 9 optimum vs GDS design ripple | 2.09 % vs 3.14 % |
| **Antoniak #1 re-optimised with its packaging**: ripple 1.400 % vs published design 1.405 %; parameters m / λs / v | 0.29 % / 0.36 % / 2.1 % from published |
| Compact objective gives smaller Ø than ripple objective | 76.9 vs 95.0 mm |
| Hertz pressure independent of size at fixed shape (used by the contact objective) | 3·10⁻¹⁴ % |
| Contact objective: search prediction vs full model (worst) | 0.006 % |
| Contact objective (Δp 50 bar, GDS packaging): best Hertz pressure vs ripple objective | 202 vs 731 MPa |
| Gamez-Montero heuristic (N = 9, λs = 0.7) vs target | −2.0 % |
| Runtime (default requirement, N = 5…11) | ~2–3 s |

## 8. Multi-chamber leakage model

Model structure and equations: `docs/lumped-model.md`.

| Test | Result |
|---|---|
| Tip-gap closed form vs numerical Reynolds integration | 1·10⁻¹⁰ % |
| Face-gap (annular sector) formula vs numerical integration | 7·10⁻¹⁰ % |
| Leakage off: network ≡ single-chamber model (flow / peak pressure) | 1·10⁻¹² % / 2·10⁻¹⁴ % |
| Face leakage ∝ h³ (2× axial clearance → ×8) | 7.93 (0.9 %) |
| Tip leakage ∝ h^2.5 (2× tip clearance → ×5.66) | 5.68 (0.4 %) |
| Leakage ∝ 1/μ (2× viscosity → ×0.5) | 0.505 (0.9 %) |
| Leakage ∝ Δp (2× pressure → ×2) | 2.11 (5.8 %; chamber pressures shift) |
| Network mass balance |Qin − Qout − Qdrain| / Qth | 0.71 % (= compressibility term) |
| Trends: ηv ↓ with Δp, ↑ with speed; leakage relieves trapped-volume peak | ✓ |

**Plausibility vs measurements — Hussain et al. 2022** (aero lube pump N = 5, e = 3.5, S = 17.6, K = 31.6,
G = 21.8, b = 7; MIL-PRF-23699 at 100 °C, ν ≈ 5 cSt). Clearances are *not published*; tip 0.065 mm and
axial 0.05 mm (total) assumed from the Nichols engine-lube range. Measured values read from the graphs.

| Δp, speed | Measured ηv | Model, uniform gap | Model, backlash gap (default) |
|---|---|---|---|
| 1 bar, 3000 rpm | ≈ 95.0 % | 96.0 % (+1.0) | 95.6 % (+0.6) |
| 1 bar, 5500 rpm | ≈ 96.9 % | 97.1 % (+0.2) | 96.9 % (0.0) |
| 3 bar, 3000 rpm | ≈ 87.0 % | 89.3 % (+2.3) | 88.5 % (+1.5) |
| 3 bar, 5500 rpm | ≈ 92.7 % | 93.6 % (+0.9) | 93.1 % (+0.4) |

This shows correct magnitude and trends with assumed clearances; it is not an independent validation of the
leakage coefficients. A pump with published clearances and measured ηv is needed for that.

## 9. Backlash contact model (`js/backlash.js`)

The outer rotor lags by δ(t) until the first lobe touches; tip gaps h_k = c + d_k (d_k = signed distance of
lobe centre from the trochoid). Used by the leakage model for the actual tip gaps.

| Test | Result |
|---|---|
| δ ∝ c (c/10 → δ/10) | 10.007 (0.07 %) |
| Contact closes at every position: \|min gap\| | 3·10⁻¹¹ µm |
| All gaps within [0, 2.2c] | 0 … 61 µm for c = 30 µm |
| Tip-to-tip gap at max-volume position = c | 0.13 % |
| Rundo 2017: contacts at the beginning of suction (housing 0°–90°) | 100 % of contacts |
| δ(t) 2π/N-periodic (independent solves) | 1·10⁻¹¹ % |
| Effect on default design (100 bar): ηv / delivered-flow ripple | 86.7 vs 87.9 % / 17.4 vs 7.4 % (uniform gap) |

Not validated: Ivanović 2012's statement that the double-gearing interval grows for smaller λ. In a rigid model
two lobes touch only at the switching instant; the measured "double contact" fraction depends on the
tolerance and grid, so the metric was removed. Needs elastic deformation (Hertz) to be meaningful.

## 10. Contact force & Hertz stress (`js/contact.js`)

| Test | Result |
|---|---|
| Mean shaft torque from pressure integration = Δp·V/(2π) | 0.0006 % |
| Instantaneous: vector-ray torques = power balance | 6·10⁻¹⁴ N·m |
| Line of action through pitch point (law of gearing) | 7·10⁻¹⁴ mm |
| Moment-arm ratio inner/outer = (N−1)/N | 7·10⁻¹³ % |
| Hertz p_max: E* form vs same-material form; (π/4)·p_max·2a·b = F | exact |
| Sliding velocity (ω1/N)·\|P − I\| = tangential relative velocity | 1·10⁻¹³ % |
| Force ∝ Δp, Hertz ∝ √Δp (quasi-static) | exact |
| **Ivanović 2020:** max contact stress reduction Model 3 vs Model 1 | published ≈ 35 %, tool 40 % (5 pts) |
| **Ivanović 2020:** WRPF reduction Model 2 vs Model 1 | published ≈ 14 %, tool 19 % (5 pts) |

Single loaded contact from the backlash model (inner rotor drives); torque reversal (negative contact force) is
reported as a rattle/noise warning. Ivanović's load sharing over several teeth and elastic deformation are not
modelled; their text is ambiguous on which model has the lowest WRPF.
