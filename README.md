# Gerotor Design Tool

Browser-based design tool for classic gerotors (trochoidal inner rotor + circular-arc lobed outer rotor).
No installation: open `index.html` in a browser.

## Features

- **Profile generation:** N-lobe outer rotor and conjugate (N−1)-tooth inner rotor; live animation, zoom and pan.
- **Geometric checks:** trochoid loops (R > N·e), inner rotor undercut (rp + c < ρmin), tip-to-valley
  clearance, contact staying on the lobe arc, wall thicknesses.
- **Performance:** chamber area vs. angle, displacement (cm³/rev), theoretical flow, flow ripple, ideal torque and power.
- **Port plate:** kidney ports with theoretical edges from the chamber extent at min/max volume (Kim et al. 2006,
  Gamez-Montero et al.), user timing offsets, outer/inner radii; chamber–port opening areas by polygon clipping.
- **Chamber pressure model:** lumped-parameter, compressible, orifice flow (Rundo 2017), solved implicitly with a
  cavitation void model. Gives chamber pressure history, delivery flow ripple with ports, port timing efficiency.
- **Multi-chamber leakage model:** all N chambers coupled through tip/flank gaps (Reynolds solution for curved
  surfaces), axial face gaps to the shaft bore and periphery, and port-land leakage; gives volumetric efficiency
  and leak flows by path. Structured as Modelica-ready components (`docs/lumped-model.md`).
- **Backlash contact model:** with profile clearance the outer rotor lags until one lobe touches; gives the
  backlash angle, outer-rotor speed pulsation, tip-to-tip gap and the actual time-varying tip gaps used by the
  leakage model.
- **Outer rotor fillets & actual chamber volumes:** tangent fillets between lobes and valley (with interference
  checks against the inner teeth); chamber volumes including the profile clearance (dead volume, CAD comparison).
- **Contact force & Hertz stress:** fluid torques by the vector-ray method, single loaded contact from the
  backlash model, Hertz line contact, sliding velocity, wear factor (p·v), shaft torque ripple, torque-reversal
  (rattle) warning. Material E, ν for both rotors.
- **Viscous friction & efficiencies:** outer-rotor OD and face shear, inner-rotor face shear, optional shaft
  journal bearings (Totaro et al. 2025); shaft torque, mechanical / overall efficiency, input power.
- **Charts (GDS style):** sweep of the pump performance range (speeds × delivery pressures); tick the charts to
  show — flow, drive power, drive torque, volumetric / mechanical / overall efficiency, outlet pressure ripple
  (vs delivery pressure, one line per speed) and Hertz contact stress over the outer-rotor rotation; export to
  Excel (.xlsx, no dependencies) or CSV.
- **Outlet pressure ripple:** delivered flow into an outlet volume and a load restriction sized for the target Δp.
- **Results like GDS:** max tool Ø to cut the inner rotor, max speed to avoid cavitation, shaft side load,
  pressure ripple.
- **Reverse engineering:** profile parameters and profile clearance from measured diameters of an existing set.
- **Oil presets and your own oil:** viscosity (ASTM D341 / Walther) and density vs temperature for common oils,
  or a line fitted through your datasheet values (2 points, optional 3rd); the simulation reads ν, ρ at the oil
  temperature from it (log-scale ν–T chart with the datasheet points).
- **Flow ripple spectrum:** tooth-pass frequency and the strongest ripple harmonics (kinematic and port model).
- **Relief / metering grooves:** optional grooves from each port edge into the lands (length, width); included
  in opening areas, pressure model, cross-porting check, drawing and DXF/SVG export.
- **Filling-limited max speed:** highest speed with chamber void ≤ 0.5 % (bisection on the network model), the
  speed where the inlet port velocity reaches 2 m/s, and the GDS criteria (tip dynamic pressure, inlet gallery Re).
- **Port arrangement:** one-sided (rotors pressed to the housing floor: Coulomb floor friction, whole axial
  clearance on the port face), one-sided + shadow ports (balanced) or double-sided (ports on both faces: double
  orifice area and port-land leakage, balanced) — as in the GDS power model.
- **Shaft side load:** radial load on the shaft from chamber pressures and the tooth contact (magnitude, angle).
- **Benchmarks against real pumps:** Bosch Rexroth PGZ4-80 (flow −3 %, drive power +0.6 %) and the Mancò 2002
  miniature gerotor (drive torque −6 %); see `docs/validation.md` §18.
- **Port checks:** cross-porting, trapped volume, inlet velocity ≤ 2 m/s, inner tip speed ≤ 15 m/s,
  pressure overshoot, cavitation.
- **Design Assist:** from flow, speed, volumetric efficiency and packaging limits (max outer Ø, rotor width,
  shaft, wall thicknesses, tip clearance) finds geometries that hit the displacement exactly; objectives:
  lowest flow ripple, smallest outer diameter or lowest Hertz contact stress. Uses the scaling law V = b·e²·g(N, λ, rp/e) with the exact
  chamber model, grid + pattern search, full re-verification; shows the Gamez-Montero heuristic for comparison.
- **OpenModelica:** one click builds a Modelica package (gerotor component with the exact angle tables, outlet
  volume, load restriction, tanks, speed source — a ready system model) plus the case table, and opens it in
  OMEdit via the local server (`tools/serve.ps1`); or download the `.mo` / `cases.mos`. GT-SUITE-like network
  (chamber volumes, tip gaps, axial gaps, port volumes, outlet restriction, friction, shaft inertia, gear, speed
  source) with oil viscosity/density vs temperature (ASTM D341). Cross-checked against the browser model
  (delivered flow −0.02 … +0.3 %, torque ≈ 0).
- **Technical drawings (PDF, A3):** one sheet per export scope — outer rotor, inner rotor, port plate (port
  edge angles, port radii about O2 / O1, corner radii, grooves, port data) and the assembly overview; diameter
  dimensions, side views, data tables, notes and title block.
- **STEP AP242:** rotors (or the assembly) as exact B-rep solids — true circular arcs / cylinders for the outer
  rotor, OD and bore, cubic B-spline extrusions (≤ 2 µm) for the inner profile; imported as valid closed solids
  in FreeCAD / OpenCascade (`tools/check_step.py`). A faceted mode is available as well.
- **Export:** DXF (R12, layered: OUTER_ROTOR, INNER_ROTOR, PORTS), SVG (mm), CSV point cloud; parameters can be saved/loaded as JSON.

## Parameters

| Symbol | Meaning |
|---|---|
| N | Outer rotor lobe count (inner rotor has N−1 teeth) |
| e | Eccentricity (centre distance) |
| R | Radius of the circle through the lobe centres |
| rp | Lobe radius |
| c | Normal clearance applied to the inner rotor profile |
| Rv | Outer rotor valley radius between lobes (auto: R + 2e − rp + margin) |

Dimensionless form used in the literature: λ = R/(N·e) (trochoid coefficient), c/e = rp/e (equidistant coefficient).

## Mathematics

Outer rotor centre O₂ = (0,0), inner rotor centre O₁ = (e,0). When the outer rotor turns by t, the inner
rotor turns by N·t/(N−1). Seen from the inner rotor, a lobe centre traces the trochoid

    Q(φ) = R·e^{iφ} − e·e^{iNφ}

and the inner profile is its inward offset by rp + c. Chamber areas are computed with Green's theorem along
the inner and outer profiles between consecutive contact points (Rundo 2017, Eq. 22). Theoretical flow is the
sum of negative chamber-volume derivatives (Rundo 2017, Eq. 20). Displacement per inner-shaft revolution:

    V = (N − 1) · (A_max − A_min) · b

### Validation

- Sum of chamber areas equals cavity area (outer profile minus inner rotor) to 0.005 %.
- Chamber-area derivative matches the vector-ray formula (Rundo 2017, Eq. 18) to ~1e-5.
- Displacement within 0.2 % of Antoniak (2026) and Ivanović (2020) published designs; flow ripple within ~1 point of Ivanović.

See `docs/literatur-notlari.md` for literature notes and benchmark designs.

**Test suite:** open `tests/index.html` — validation & regression tests with error vs. reference for every
model (geometry, displacement, ripple, ports, pressure model, export). Results are summarised in
`docs/validation.md`. Every new feature must add tests and keep the suite at 0 fail.

## File layout

```
index.html        UI
css/style.css     styles (light/dark)
js/geometry.js    geometry and analysis core
js/ports.js       port plate geometry, opening areas, chamber pressure model
js/leakage.js     multi-chamber network with leakage paths
js/backlash.js    tooth contact with clearance (backlash angle, actual tip gaps)
js/contact.js     contact force, Hertz stress, sliding velocity, shaft torque
js/friction.js    viscous friction losses, efficiencies
js/perfmap.js     performance map (+ js/perfmap-ui.js)
js/reverse.js     reverse engineering from measured diameters
js/fluid.js       oil viscosity / density vs temperature
js/spectrum.js    flow ripple spectrum
tools/serve.ps1   local static server (PowerShell, no dependencies)
js/assist.js      Design Assist search
js/assist-ui.js   Design Assist dialog
tests/            validation & regression suite (open tests/index.html)
js/render.js      canvas rendering
js/charts.js      charts
js/export.js      DXF / SVG / CSV
js/app.js         UI wiring
docs/             literature notes
```

## Roadmap

- Port edges following the lobe profile
- FMU export of the Modelica system model
- Couette flow in gaps, face leakage over tooth lands
- Multi-tooth load sharing with elastic deformation
- STEP export
