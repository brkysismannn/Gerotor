# Convergence and sensitivity of the numerical settings (backend, round 5, 2026-10-31)

Rule: every numerical setting needs a convergence or sensitivity justification (company/memory/no-unexplained-numbers.md).
Script: `backend/tools/convergence_study.py` (JSON lines; `STUDY_ONLY` selects settings). Designs: the 4 JS parity references
(`backend/tests/reference/*.json`: n5_single_noleak, n7_ports_leak, n9_gds_fillet_grooves, n11_antoniak_geom; example rotor material
210 GPa / 0.3), each at its reference grid (samples 24/24/16, n11 96). Settings are named module constants in gerotor_core
(values unchanged = JS values, so JS parity holds); they are also part of the resolved input hash (`api.calc.numerics`).

"Change" = max relative change of the listed outputs against the finest value tried, worst design. Outputs that a design does
not produce (n11 has no ports, only n9 has fillets/grooves) are skipped for it.

| Setting (audit id) | Values tried | Monitored | Change at chosen value (worst design) | Chosen | Justification |
|---|---|---|---|---|---|
| samples per lobe pitch (N01) | 24, 48, 96, 192, 384 | cc, ripple, A actual | 2e-4 (ripple, n9); cc exact | 96 (API default) | ripple error < 0.02 % of its value; cc uses sampled extrema, already exact to 1e-15 |
| CURV_N undercut scan (N02) | 1000, 2000, 4000, 16000 | rhoMin | 4e-7; vs closed form Colbourne Eq. 11 <= 7e-7 (test_literature_validation) | 4000 | far below any manufacturing tolerance |
| TOOL_COARSE_N, TOOL_GOLDEN_STEPS (N03) | 180-2880; 20-100 | tool diameter | 0 | 720, 60 | identical result from 180 / 20 upwards |
| FILLET_PROFILE_N (N04) | 750-12000 | filletClearance | 5e-5 (n9) | 3000 | converged |
| FILLET_POS_PER_LOBE (N04) | 16-256 | filletClearance | 3e-5 (n9) | 64 | converged |
| **FILLET_PTS + FILLET_ENDS (N04), changed round 6** | ends omitted: 3, 4, 7, 14, 28, 56, 112, 224, 448 (n9: 0.818, 0.768, 0.642, 0.539, 0.483, 0.455, 0.441, 0.434, 0.430 mm, O(1/n) towards 0.4265); ends included: 3 ... 112 | filletClearance | ends included: 0 (0.426529 mm for every n >= 3); with FILLET_POS_PER_LOBE 64 -> 1024: 3e-6 | FILLET_PTS 14 (unchanged), **FILLET_ENDS = True (new)** | The round-5 non-convergence was not a point count but a sampling defect: the minimum clearance lies at the tangency END point of the fillet arc, which `fillet_points` omitted (it is shared with the profile builder, where end points are duplicates). With the end points the result is exact for any n >= 3 and the JS value 0.5386 mm overstated the clearance by 26 % on n9. Only n9 has fillets among the 4 references; review design ports_shifted_double (fillet 1.5) changes the same way |
| INNER_SECTOR_PANELS (N05) | 6, 12, 24, 96 | cc, ripple | 1e-10 | 24 | spectral convergence of 8-point Gauss-Legendre; confirms the docstring claim ~1e-10 |
| CHAMBER_N_IN (N06) | 12, 24, 48, 192 | port areas, pressures, crossDeg | 1e-2 (AsMax, n9); 3e-3 (n7 pMinBar) | 48 | ~1 % polygon error of the opening area on the groove design; acceptable for timing, flagged |
| CHAMBER_N_OUT (N06) | 4, 8, 16, 64 | same | 5e-3 (n5 pMaxBar) | 16 | < 0.5 % |
| ACTUAL_AREA_STRIDE (N06) | 4, 2, 1 | AminActual, AmaxActual | 0 | 2 | extrema fall on even samples for these grids |
| PORT_ARC_N, DISK_N, PORT_EXTENT_N_IN (N07) | 24-384; 32-512; 24-384 | port outputs | 0 | 96, 128, 96 | no effect at all tried values |
| PIECE_SEGMENTS (N07) | 6, 12, 24, 96 | port outputs | 9e-4 (n9 pMinBar) | 24 | < 0.1 % |
| FILLET_ARC_N (N07) | 3, 6, 12, 48 | port outputs | 8e-6 | 12 | converged |
| simSub network sub-steps (N08, design input) | 1, 2, 4, 6, 12, 24 | qMean, p, eta, torque | at the reference values 3-4: 9e-3 (n5 pMaxBar), 7e-3 (n9 pMinBar); at 12: 1.4e-3 | user / design input; NET_SUB_DEFAULT 6 and CH_SUB_DEFAULT 12 if absent | first-order time integration: pressure peaks move ~1 % at 4 sub-steps. Reports should use >= 12 when peak pressures matter |
| CH_SUB_DEFAULT (N08) | 3-48 | single-chamber p_max | 0 (references set simSub, so the default is not exercised) | 12 | covered by the simSub row |
| CH_CYCLES (N08) | 2, 3, 6 | single-chamber p_max | 0 at 3 (2 cycles: start-up transient still present) | 3 | periodic steady state reached at the 3rd revolution |
| CH_BISECT, NET_BISECT, OUT_BISECT, DELTA_BISECT (N08-N10) | 30-80 | pressures, lag | <= 2e-14 at the chosen value | 60, 50, 60, 60 | bisection to round-off |
| NET_SWEEPS 3-pass leakage loop (N08) | 1, 2, 3, 6 | eta_v, eta_T | 4e-8 (n7 portEfficiency) | 3 | Gauss-Seidel residual below 1e-7 |
| NET_CYCLES (N08) | 2, 3, 6 | network outputs | 0 | 3 | periodic state already at 2 |
| OUT_SUB (N09) | 2, 4, 8, 32 | outlet rippleRel | 1.3e-2 (n9, outlet volume 50 cm^3) | 8 | ~1 % on the outlet ripple; flagged |
| OUT_CYCLES (N09) | 2, 4, 8 | outlet rippleRel | 0 | 4 | converged |
| NEWTON_ITERS (N10) | 3, 5, 8, 20 | lag, pulsation | 0 from 5 | 8 | margin over 5 |
| ECC_BISECT (N11) | 40, 60, 100, 150 | Mshaft, etaT | 0 from 60 | 100 | round-off |
| RHO_EQ_CAP_MM Hertz cap (C04 / A-D8b) | 1e3, 1e4, 1e5, 1e7 mm (4 references); 1e3, 3e3, 1e4, 3e4, 1e5, 1e7 (cap-active design) | pmaxMax, Pmax(t), eta_v, tip leakage | references: 0 (cap never active). Cap-active design, 1e4 vs 1e7: Pmax(t) 2e-9, eta_v 1.5e-7, tip leakage 5.5e-6 | 1e4 | Derivation (Colbourne Eq. 8 at the trochoid valley): on the concave flank rho_eq = rp + rp^2/abs(rho_c), abs(rho_c) = (R - N e)^2/(N^2 e - R); with no undercut (rp < rho_min, Colbourne Eq. 11) and lobes reaching the valley (rp > e) the cap is reachable only near the cusp limit and at large size (N = 7 needs e > ~10 mm). Constructed design N 7, e 20, R 145, rp 20.5, b 20, c 0.03 mm, OD 400, ports + leakage, 300 rpm, 100 bar: rho_eq up to 1.4e4 mm, valid. The capped points carry negligible load (p ~ rho^-1/2) and a tip conductance ~ rho^-1/2, so the results are insensitive (test_api_round5::test_hertz_cap_active_design) |
| LOBE_PROBE_LAG (C10) | 1e-5 ... 1e-9 rad | pmaxMax, Fmax | 0 | 1e-7 | loaded-lobe choice insensitive over 4 decades |
| **OPEN_TOL_REL (C18), changed round 6** | 1e-4, 3e-5, 1e-5, 3e-6, 1e-6, 1e-7, 1e-8, 1e-10, 0 | cross-porting sample count on all 4 references + 14 review designs | n9: 2 samples (1e-4) -> 3 for every tol <= 3e-5 down to 0; single_sided_ports 3 -> 4 (<= 1e-5); ports_shifted_double 4 / 5 / 6 (<= 1e-6 .. 0); all others 0 at every value | **0.0** (open = clipped area > 0) | Closed chambers give clipped areas that are exactly 0 (no round-off floor was found on 18 designs), so any positive tolerance only discards real overlaps; the smallest real overlaps are 9.4e-5, 2.2e-5 and 8.9e-6 of Amax. The limit tol -> 0 is reached at 0 itself: a derived value, no tuning number. n9 crossDeg 5.0 -> 7.5 deg (cross-porting ERR verdict unchanged) |

Not varied: spectrum harmonic count (display), reverse-engineering rounding, curvature fast mode (Design Assist only, see below),
CONTACT_GAP_FRAC 0.01 (display count nContact; sensitivity not run), PEAK_GAP_FACTOR (cited, Ivanovic 2012 Figs. 6-8).

Settings changed: round 5 none. **Round 6 (MD decision): FILLET_ENDS = True and OPEN_TOL_REL = 0.0 in Python**; the JS mirror is
pending (see the design-sim-engineer API report, "Round 6 - JS mirror"); until then the parity tests that differ only in
filletClearance / crossDeg / trappedVolumeSwing are xfailed "awaiting JS mirror". simSub (a design input) at 3-4 gives ~1 % on
pressure peaks; use >= 12 when peak pressures matter.

Kim 2006 port edges (Fig. 6: 8.680 and 18.202 deg about X_e) versus code (chamber-extent half angles about the outer centre O2:
8.424 and 18.236 deg; about the inner centre O1: 9.131 and 16.879 deg). The max-volume edge agrees to 0.03 deg about O2 and the
same design reproduces Kim's sigma1 (12.294 vs 12.29 deg) and the chamber maximum (343.64 deg), so the profile model agrees. The
min-volume edge lies between the O2 and O1 values; Kim does not define X_e or the construction of the edges (p. 1630). Verdict:
a definition difference (reference centre / edge construction), not a model deviation; unresolved until the construction is known.

Literature cross-checks that also act as convergence evidence (backend/tests/test_literature_validation.py): Colbourne 1975 Table 2
and Fig. 1 (rho_min, flow, flow variation), Colbourne Eq. 11 (rho_min, rel. 1e-5), Colbourne Eq. 28 (dA/dt to round-off),
Ivanovic 2012 Figs. 9a/10a (outer-rotor lag x N/(N-1)), Kim 2006 (sigma1 = 12.29 deg, chamber maximum at 343.64 deg, port edges).


## Design Assist (frontend/js/assist.js, added 2026-10-31)

Rule: no number without an origin (company/memory/no-unexplained-numbers.md). Removed from Design Assist: the rp/e lower bound 1.5, the sharp-tip limit 0.85 and the tip-speed limit 15 m/s (now optional user inputs, empty by default), the lobe-overlap margin 0.98 (exact boundary k < lambda N sin(pi/N), Ivanovic cond. 6), the lobe-arc margin 0.05 e (exact condition Rv < R + rp), the lambda start 1.05 and k start 1.02 (the open intervals 1 < lambda < 2 and k > 1 are searched with interior grid points only), and the objective weights 1e-4 / 1e-3 (ranking is lexicographic: the chosen quantity first, a second quantity only breaks exact ties).

Remaining numerical search settings (object `SEARCH`, exported as `Gerotor.assistSearch`): grid 14 (lambda) x 12 (k) per lobe count, pattern-search step 0.04 / 0.08 halved on failure, stop at 0.006, 10 iterations, seed separation 0.15 / 0.3, de-duplication 0.01 / 0.02. They are not physical limits; every reported design is re-analysed at full resolution, so the shown numbers are exact for that design. What is not claimed: that it is the global optimum.

Convergence check (V8, default requirements; best verified result; N = winning lobe count):

| Requirement | Setting | N | lambda | k | objective |
|---|---|---|---|---|---|
| ripple, 15 L/min at 1000 rpm, b 10, OD max 95, bore 22 | base | 11 | 1.0667 | 1.1947 | ripple 1.7037 % |
| | grid x2 | 11 | 1.0690 | 1.2175 | 1.7108 % |
| | grid x4 | 11 | 1.0526 | 1.0462 | 1.6506 % |
| | step/2, stop/2, wide seeds | 11 | 1.0667 | 1.1947 | 1.7037 % |
| compact (same inputs) | base | 5 | 1.2000 | 2.1662 | OD 76.333 mm |
| | grid x2 / x4 | 5 | 1.2414 / 1.1754 | 2.3771 / 2.0519 | 76.328 / 76.298 mm |
| | step/2, stop/2 | 5 | 1.2000 | 2.1662 / 2.1762 | 76.333 / 76.297 mm |
| contact, 30 L/min at 1500 rpm, b 15, OD max 100, dp 50 bar | base | 10 | 1.9734 | 5.2918 | p_max 126.0 MPa |
| | grid x2 / x4 | 10 | 1.9655 / 1.9824 | 5.2079 / 5.3876 | 126.9 / 125.0 MPa |
| | step/2 | 10 | 1.9933 | 5.4917 | 123.8 MPa |

Result: the winning lobe count never changes. The objective changes by up to 3 % (ripple, grid x4), 0.05 % (outer diameter) and 2.5 % (contact stress) when the grid or steps are refined, because the optimum lies on a flat ridge against the packaging limit. Step, stop and seed settings do not change the result except in the contact case (step/2). So the defaults are adequate for ranking and for choosing N; the lambda and k of the winner are only good to about +-0.1 and +-0.3. The test `27 · Design Assist` asserts N unchanged and objective within 5 % for a doubled grid. If a tighter optimum is needed, pass `search: { nLam: 56, nK: 48 }` (about 2.5x run time).
