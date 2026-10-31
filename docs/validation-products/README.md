# Validation products dataset (real gerotor / orbit products)

Built 2026-10-31 from the 21 PDFs in `projects/Gerotor/References/Test Products/` using the pypdf text dumps in `.text/<file>.pdf.txt` (pages marked `=== page N ===`). Page numbers in `products.csv` are PDF page indices (the `=== page N ===` markers), not printed page numbers. Nothing was invented: empty cell = not given in the text. Chart images (curves) carry no extractable numbers and are NOT transcribed.

`products.csv`: 364 data rows (300 + 41 Eagle rows + 23 OCR rows: HYQUIP/Rexroth PGZ 10, Ametek 5979 3, DoubleA 10; OCR rows are marked "OCR-sourced; medium confidence" in notes; Eagle rows added in round 2: EBMP p13 11, EBMR p40 10, EBMR-BK01 p60 9, EBMJ p182 11; also fixed 4 Hema rows that had too many empty columns) (comma separated, no quoted fields, no commas inside text; semicolons separate items in free text).

## Columns
brand, series, model, type (pump/motor/pump unit/pump element), principle (gerotor, geroler = roller-stator orbit, as named by the source), displacement_cm3_rev (numeric cm3/rev), displacement_as_given (original text and unit), teeth_inner, teeth_outer (lobe counts, only where stated), rotor_OD_mm (outer rotor OD), rotor_ID_mm (inner rotor bore), rotor_width_mm (rotor height / gerotor width), eccentricity_mm, speed_min_rpm, speed_max_rpm (continuous max unless notes say otherwise), rated_pressure_bar (continuous), max_pressure_bar (peak or intermittent, see notes), flow_l_min, flow_at_rpm, flow_at_pressure_bar, vol_eff_pct, overall_eff_pct (always empty: no source gives a numeric efficiency value), test_viscosity_fluid, power_kW, torque_Nm, power_torque_conditions, source_file, page, supports (tags below), notes (intermittent values, conversions, inconsistencies).
Conversions: in3 x 16.387 = cm3; gpm x 3.7854 = l/min; psi / 14.504 = bar; MPa x 10 = bar; hp x 0.7457 = kW; in-lb x 0.11298 = Nm. The original unit is kept in displacement_as_given or notes.

Support tags: DISP (geometry-based displacement check), DISP_given_only (displacement stated but no geometry), FLOW (displacement + speed + flow in the same row), FLOW_calc (vendor-calculated, not measured), FLOW_needs_displacement / FLOW_needs_speed (one input missing), EFF_grid / VE_curve / PERF_grid (efficiency or performance data exists only as chart or grid not transcribed), GEO_width (rotor width given), TORQUE_only, SERIES_RANGE_ONLY.

## Per-document summary (21 files)
| File | Decision | Rows | Notes |
|---|---|---|---|
| List of Gerotors with Salient Features & Displacement Values.pdf (Adamjee) | included, gerotor sets | 24 (12 parts x min/max height) | lobes, OD, ID, eccentricity, height, displacement at 95% of theoretical, calc flow at 1500 rpm 5 bar. PDF p1-2 |
| List of Sintered Gerotors with Nomenclature & Applications.pdf (Adamjee) | included | 12 | same parts, one height each, cc/rev/mm, tip and form diameters in notes. Page 4 has no text (unreadable). Conflicts with list 1: PMP-784/785 OD 66.713 vs 67.713; heights differ; displacement per mm differs 1-6% for some parts; PMP/663-664 14.20 cc/rev vs 0.406 x 35.4 = 14.37 |
| Parker Gerotor.pdf | included | 10 (MGG2 motors 5, PGG2 pumps 5) | page 1 empty (cover, unreadable) |
| SKF-GEROTOR-OIL-PUMP-1-1204-3-EN.pdf | included | 19 | p8 table; flow vs back-pressure curves are images |
| 1-9.pdf | included, older edition of SKF series 143 | 0 new | same rows as SKF EN p8 for B03 to P02 (identical values); EN edition adds R/T/V sizes |
| vogel_gerotor_pumps.pdf | included | 10 | 143-011 line (displacement not printed except 560); 143-011-560 and ZP pumps classification uncertain (page 2 headings ambiguous) |
| Gerotor-Pumps.pdf (asa hydraulik) | included | 2 | displacement and speed not stated; characteristic is an image |
| VISCOMAT-GEROTOR_EN_11.2025_web.pdf (Piusi) | included | 1 | displacement not stated; flow-pressure chart image |
| DA370001_BFP.pdf (Buhler) | included | 18 | displacement (in3) and gpm given, speed not stated |
| HYQUIP Product.pdf | included (Rexroth PGZ data sheet copy, gerotor) | 10 (OCR) | PGZ4 sizes 20-80 (p4) and PGZ5 63-140 (p5): displacement, n min/max, flow at 1450 rpm 10 bar 30 mm2/s, min driving power, sound. Skipped: PGZ5 weights (OCR dropped cells), inertia. PGZ4-63 displacement blank on p2 but 64.4 on p4 |
| RE 10545-B_2013-11.pdf | included (PGZ gerotor pump) | 0 | instruction manual; p37 refers to data sheet 10545 for technical data, no numbers inside |
| Danfoss-hydraulic-motor-WD-WP-_-WR.pdf | included, orbit motors | 42 (WD 13, WP 13, WR 16) | p15, p27, p47 spec tables; performance grids (speed/torque vs flow/pressure at 46 cSt) pp16-22, 28-34, 48-55 not transcribed |
| BC435972720220en-000101.pdf (Danfoss H/S/2000) | included | 29 (H 10, S 10, 2000 9) | gerotor width X for H and S |
| BC152886483631en-000503.pdf (Danfoss TMT) | included with caveat | 6 | document does not say gerotor or geroler (only orbital motor) |
| BC152986483537en-000202.pdf (Danfoss TMTHW) | included with caveat | 5 | same caveat |
| Hydraulics_Catalogue_20230309.pdf (Hema) | included, orbital motors only | 4 series-range rows | HMP gerotor, HMR/HMS/HMH geroler; only min...max ranges. Gear pumps, axial piston pumps and gear motors in this catalogue are excluded (not gerotor). Page 1 empty (unreadable). Transmission and engine oil pumps are said to be "spur gear or gerotor" with no data |
| Eagle-Hydraulic-Motors.pdf | included, orbit motors | 159 (118 + 41) | EBMM, EBMP, EOZ, EBMR, EOK, EBMH, EBMSY, EBMT, EBMV, EBMK2, EBMK6, EBME2, EBMER, plus round 2: EBMP p13 (31.75/32 mm shaft table; differs from p12 for sizes 250-500), EBMR p40, EBMR-BK01 p60 (rated/cont/inter columns; peak not given), EBMJ p182 (model names are in the text; earlier note was wrong). Not transcribed: EGM02 gear motor (excluded: gear), brakes, valves, all other series' performance grids (see below) |
| Gear-Pump-Catalogue-Datasheet.pdf (Applied Pumps / Haight) | excluded | 0 | gear-within-a-gear internal gear pump; the word gerotor does not occur in the text (borderline: check if the Haight rotor is trochoidal) |
| Pumps_Axial_Piston_Pumps_HPP4_Piston_Pumps_Catalogue_HPP4_Series.pdf | excluded | 0 | variable axial piston pump |
| pdt5979-updated-061213ametek.pdf | included (OCR) | 3 | lube 4.5 gpm at 130 psid, scavenge A 16 gpm and B 4.5 gpm at 65 psid, MIL-L-7808 oil, temperature read as 75 F (graph header OCR "85T" conflicts); speed and displacement not stated; p3 curve is a chart |
| DoubleA-Gerotor-Pumps-brochure.pdf | included (OCR) | 10 | nominal sizes B .4/.75/1.5, H 3/5/8/12, O 20/30/40 gpm, min speed 400, max speeds (p4); no displacement; H-12 max speed left blank (OCR ambiguity); efficiency/delivery curves pp5-7 are charts (190 SSU, 120 F, 5 in Hg inlet vacuum); per-fluid pressure ratings p4 not transcribed (OCR layout interleaved) |

## Unreadable (empty text) pages
(Ametek, DoubleA and HYQUIP now OCR-read, see table; their curves remain charts.) Parker Gerotor p1; Hydraulics_Catalogue p1; Adamjee nomenclature list p4; HYQUIP all numeric content (encoded).

## performance_points.csv (round 2)
Columns: brand, model, displacement_cm3_rev, flow_l_min, pressure_drop_bar, speed_rpm, torque_Nm, vol_eff_pct, overall_eff_pct, test_fluid_viscosity_temp, source_file, page, notes. Only printed values; Nm and l/min taken from the parenthesised metric figures; efficiency cells empty because none is printed.

Points per series (6256 total, 0 with efficiency; first 209 rows = hand transcription EBMP 36/50/80, rest from `backend/tools/parse_eagle_grids.py --write`):
| Series | Points | Grids | Source pdf pages |
|---|---|---|---|
| Eagle EBMP | 741 (209 hand + 532 parsed) | 11 | 16-21 |
| Eagle EBMM | 234 | 6 | 5-7 |
| Eagle EBMR | 907 | 13 | 42-47 |
| Eagle EBMH | 323 | 5 | 67-69 |
| Eagle EBMSY | 420 | 9 | 78-82 |
| Eagle EBMT | 650 | 12 | 102-105 |
| Eagle EBMV | 403 | 6 | 125-127 |
| Eagle EBMK (K2 + K6) | 1632 | 19 | 136-161 |
| Eagle EBME (E2) | 442 | 11 | 169-174 |
| Eagle EBMER | 504 | 15 | 189-197 |
| Danfoss WD/WP/WR, H, S, 2000, TMT, TMTHW | 0 | 0 | see below |

Eagle method: each flow has a flow line, a Torque row and a Speed row; values map left to right onto the pressure header. A row may be shorter than the header (higher pressures not rated); torque and speed counts must be equal and never exceed the header. Shorter rows are accepted only if the left-aligned reading is physically plausible (torque <= 1.12 x theoretical, speed <= 1.05 x flow/displacement, speed not rising with pressure) and fits the other rows of the grid at least as well as a right-aligned reading; otherwise the row is SKIPPED (alignment ambiguous, e.g. most EBMER rows, whose short rows start at a higher pressure). Skips are in `performance_points_skipped.log` (138 flow rows/grids: EBMER 105, EBMK 27, EBMM 2, EBMH 2, EBME 2). Units: pressure bar and torque Nm (parenthesised values) are the columns; the printed psi, gpm and lbf-ft are kept in the notes column ("printed: ..."). Notes also flag source problems (gpm/lpm heading mismatch, lbf-ft vs Nm mismatch, missing closing parenthesis, "check:" physical-bound warnings, 7 points). Test fluid, viscosity and temperature are not stated for Eagle. Validation: the parser reproduces all 209 hand points exactly (model, flow, pressure, displacement, speed, torque; 0 differences); test `backend/tests/test_parse_eagle_grids.py`. Source typos kept and flagged (EBMP 36 45 lpm 125 bar torque 46 Nm vs 39.9 lbf-ft; EBMP 80 75 lpm torque row 87/112/151/169/169; EBMR 375 10 lpm last speed 32 rising). Repeated model/page duplicates exist (EBMR 36 on pp42 and 43, EBMR 375 on pp46 and 47) because the source repeats the grid.

Eagle grids still NOT transcribed: the EOZ, EOK and other series without a "Pressure PSI (bar)" grid in the text (parser found 107 grids in total; EBMM8 20 lpm row has a bare "0" torque without Nm and is skipped), and the skipped rows listed in the log.

Danfoss status:
- WD/WP/WR pp16-22, 28-34, 48-55: text is a flattened column stream. Pressure header (e.g. 30, 60, 80, 100, 120, 140 bar) and flow axis exist, but per-pressure speed/torque groups have 7-9 values for 8 flow rows (rows at high pressure are missing), model headers are detached, and torque is printed as separate [lb-in] and Nm lists. Alignment of values to flow row and pressure column is ambiguous, so SKIPPED. Efficiency appears only as a colour band legend (70-100 %, 40-69 %, 0-39 %): chart only, needs digitising.
- H, S (BC435972720220 p5-8, p11-14) and 2000 series (p24-27): torque and volumetric efficiency vs speed at 3.43, 6.87, 12.3 MPa are charts only; the text holds axis ticks only. Chart only, needs digitising (test fluid 37 cSt for H and S, 34 cSt for 2000, from the page text).
- TMT (BC152886483631) and TMTHW (BC152986483537): only spec tables and pressure-drop / speed-torque envelope charts; no numeric grid. Chart only, needs digitising.

## What each row supports (row counts)
- Displacement check from geometry (lobes + OD + ID + eccentricity + height all given): 36 rows (Adamjee, 12 distinct parts x 2 heights for list 1 and 12 for list 2). Partial geometry (rotor width only, no lobes, OD, or eccentricity): 20 Danfoss H and S rows. Note Adamjee displacement is 95% of theoretical, so compare against 0.95 x geometric.
- Flow vs speed (displacement, speed and flow in the same row): 216 rows (Parker 10, SKF 19, Vogel 560 1, Adamjee 36 vendor-calculated at 1500 rpm 5 bar, Danfoss WD/WP/WR 42, Danfoss S 10, Eagle 87, TMT 6, TMTHW 5). 18 Buhler rows have displacement and flow but no speed; Vogel 143-011 and asa/Piusi have flow but no displacement.
- Efficiency (flow + pressure + viscosity at a stated speed): no row has a numeric efficiency. 1 row (Vogel 143-011-560: 4 cm3/rev, 5.4 l/min at 1400 rpm, 1 bar, 140 mm2/s) allows a derived volumetric efficiency of about 96%, which is NOT stated by the source. 71 Danfoss rows (WD/WP/WR 42 at 46 cSt; H/S/2000 29 at 37 or 34 cSt) have efficiency or performance data only as charts and grids that need transcription or digitising.
