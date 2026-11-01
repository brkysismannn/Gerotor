# Clearance tolerance → intervals of η_v, η_hm and η (2026-10-31)

Code: `backend/gerotor_core/tolerance.py`, mirror `frontend/js/tolerance.js` (parity rel. 1e-9,
`tests/test_tolerance.py::test_python_interval_equals_js`). API: `settings.clearanceTolerance`;
UI: Load cases → "Clearance tolerance bands"; report: load-case table.

## Inputs (no defaults)

| Input | Where | Meaning |
|---|---|---|
| `settings.clearanceTolerance.{c, axialClr, odClr, jbClr} = {min, max}` | API settings / UI load-case panel | Band of each clearance, **same unit and convention as the design input** (mm; c per A-D3, odClr/jbClr diametral per A-D5). 0 ≤ min ≤ nominal ≤ max, else HTTP 422. Absent key = no band on that clearance; no band at all = no interval. |
| `fluid.rhoExp` [1/K] | API fluid / UI "Thermal expansion" | Linear expansion coefficient of the oil (datasheet), ρ(T) = ρ15 (1 − α (T − 15)). Replaces the unsourced 6.5e-4 1/K. Absent: density is **not** temperature-corrected (the entered ρ is used) and the check row "Missing input - density temperature correction NOT EVALUATED" is issued. |
| `design.shaftVent` | API design / UI checkbox | Bore vented to the inlet. Now required when leakOn (no silent "vented" default): API → NOT EVALUATED, core → InvalidDesignError, JS → error. |

## Method

η_hm = η_m of the tool (M_th / M_shaft). For each load case:

1. **Monotone axes → band ends (vertices).** If a function is monotone in each variable separately, its minimum and
   maximum over a box lie on box vertices. The vertex values are then the exact interval (no sampling error).
2. **Non-monotone axis → grid + parabola.** The axis is sampled at `GRID_LEVELS` equally spaced points. Each interior
   local extremum f1 (neighbours f0, f2) is refined by the vertex of the parabola through the three points,
   f_v = f1 − (f2 − f0)² / (8 (f0 − 2 f1 + f2)). This is exact for a quadratic and has O(Δ³) error for a smooth function.
3. **η = η_v η_hm.** η_v falls and η_hm rises with clearance, so the product is not monotone and vertex values do not
   bound it. The reported η interval is the enclosure [min η_v · min η_hm, max η_v · max η_hm]. It is valid because
   both factors are positive. It is conservative (wider than the true range). The range over the evaluated points
   (`etaTEvaluated`) is also given, but it is not a bound.
4. Cost: odClr and jbClr enter only the friction model, so their vertices reuse the same network/contact run.
   The number of network runs is (c levels) × (axialClr ends). For bands on c and axialClr that is 5 × 2 = 10 runs,
   using 5 geometry analyses (geometry depends only on c).

## Monotonicity evidence (axis classification)

Each clearance was swept alone over 0.25…1.75 × nominal (17 points), with the others at nominal. The tip gap used
the **backlash** model, so c acts through the backlash gap function. Designs:
- n7: N 7, balanced, journal length 0.
- n9: N 9, fillet 2, double inlet, shadow ports, journal 20 mm.
- n5s: N 5, single-sided ports, journal 10 mm.

Operating points (rpm, Δp bar): (500, 5), (1500, 50), (3000, 150). Engine: JS in V8 at samples 24, which equals the
Python core by parity. The Python core was cross-checked at samples 24 on n7 at (1500, 100), (500, 10), (3000, 150)
with 9 points per axis: same trends.

| Clearance | η_v | η_hm | Classification |
|---|---|---|---|
| c (backlash gap) | decreasing in all 9 cases | **NOT monotone**: n7 at all 3 points and n9 at 1500/50 and 3000/150 (shallow minimum: the pressure torque and the leakage-dependent chamber pressures compete). Increasing elsewhere. | **grid** |
| axialClr | decreasing (9/9) | increasing (9/9) | band ends |
| odClr | constant (does not enter the network) | increasing (9/9) | band ends |
| jbClr | constant | increasing, or constant when jbLen = 0 | band ends |

Regression tests: `tests/test_tolerance.py` (9-point sweeps, 3 designs × 2 operating points, every axis):
`test_corner_axes_are_monotone`, `test_tip_clearance_backlash_eta_v_monotone`,
`test_tip_clearance_eta_hm_not_monotone_so_c_is_grid`, `test_python_core_sweep_matches_trends`. If a future model
change makes a band-end axis non-monotone, these tests fail and the axis must move to "grid" (`AXIS_METHOD`).
Not proven: monotonicity for designs and operating points outside this set (the vertex rule is exact only where
monotonicity holds). This is why the report states the method.

## Grid convergence (`GRID_LEVELS`, numerical setting)

c band 0.5…1.5 × nominal, everything else at nominal, η_hm minimum (the non-monotone quantity):

| Design, point | 3 levels | 5 levels | 9 levels | 17 levels |
|---|---|---|---|---|
| n7 500/5 | 0.740403 | 0.740262 | 0.740270 | 0.740271 |
| n7 1500/50 | 0.893238 | 0.893062 | 0.893066 | 0.893039 |
| n7 3000/150 | 0.922582 | 0.922467 | 0.922510 | 0.922511 |

n9 and n5s: identical in the 6th digit for 3 to 17 levels. η_v intervals are identical for every level count (monotone).
With 5 levels, η_hm differs from the 17-level value by at most 4.4e-5 (0.0044 percentage points), and the
5-level minimum is the lower one in 2 of 3 cases. With 3 levels the difference is 2e-4. `GRID_LEVELS = 5` is chosen:
its error is below the 0.1 % display resolution of the report, at about half the cost of 9 levels.

## Observed model limitation (not changed)

n5s (single-sided, 4 × face leakage) at axialClr ≥ about 1.5 × nominal and Δp ≥ 50 bar gives **η_v < 0**: the modelled
leakage exceeds the displacement. The model has no physical floor for this. It flags designs or clearances that
cannot work, and such an interval must be read as "outside the pump's working range".
