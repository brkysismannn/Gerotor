# Lumped-parameter model (reference for the OpenModelica port)

The chamber-pressure / leakage simulation (`js/ports.js`, `js/leakage.js`) is written as a network of
components with one equation each, so it can be re-implemented 1:1 as Modelica models
(e.g. on top of `Modelica.Fluid` / OpenHydraulics connectors: pressure p, volume flow q).

Units below are SI. Geometry functions of the rotor angle come from `js/geometry.js`
(exact chamber area A(θ), its derivative dA/dθ by the vector-ray method, contact points) and from
`js/ports.js` (opening areas As(θ), Ad(θ) by polygon clipping). In Modelica these become
`CombiTable1Ds` look-up tables indexed by the outer-rotor angle (periodic).

## Kinematics

| Quantity | Equation |
|---|---|
| Inner shaft speed | ω₁ = 2π·n/60 |
| Outer rotor speed | ω₂ = ω₁·(N − 1)/N |
| Chamber k angle | θ_k(t) = ω₂·t + 2π·k/N |

## Components

| Component | Ports | Equation |
|---|---|---|
| `ChamberVolume` (k = 0…N−1) | 1 fluid port | V = b·A(θ_k); (V/K)·dp/dt = Σq_in − dV/dt; if p ≤ p_cav: p = p_cav and void: dV_void/dt = dV/dt − Σq_in (until V_void = 0) |
| `PortOrifice` (suction, delivery) | chamber ↔ port | q = sgn(Δp)·Cd·A_open(θ_k)·√(2|Δp|/ρ) |
| `TipGap` (k ↔ k+1) | chamber ↔ chamber | q = G_tip·Δp, G_tip = 2·b·h(θ_k)^{5/2} / (9π·μ·√(2ρ_eq(θ_k))); h(θ) from the backlash contact model (table) or uniform c |
| `FaceGapBore` (2 faces) | chamber ↔ bore | q = G·Δp, G = 2·(2π/N)·h_ax³ / (12·μ·ln(r_root/r_bore)) |
| `FaceGapPeriphery` (2 faces) | chamber ↔ periphery | q = G·Δp, G = 2·(2π/N)·h_ax³ / (12·μ·ln(r_OD/R_v)) |
| `PortLand` (2 lands, 1 or 2 faces) | delivery ↔ suction | q = Σ w·h_ax³ / (12·μ·L_land)·Δp, w = R_port,o − R_port,i, L_land = Δθ_land·r_mid |
| `PeripheryNode` | massless | Σq = 0 |
| `BoreNode` | boundary | p = p_in if vented, else massless node |
| Boundaries | suction, delivery | p_s = p_in, p_d = p_in + Δp |

ρ_eq is the equivalent radius at the contact between the convex lobe (r_p) and the inner profile
(signed radius ρ_t − r_p, ρ_t = trochoid radius of curvature): 1/ρ_eq = 1/r_p + 1/(ρ_t − r_p).
The tip-gap equation is the exact integral of Reynolds' equation for h(x) = h + x²/(2ρ_eq).

## Outputs

- Delivered flow Q_out = −Σ_k q_d,k − q_land; volumetric efficiency η_v = mean(Q_out) / (V_disp·n/60)
- Chamber pressure history, peak/min pressure, void fraction (cavitation / incomplete filling)
- Leak flows by path (tip gross circulation, bore drain, lands)

## Numerical scheme (browser)

Implicit Euler per step, Gauss–Seidel over chambers (3 sweeps), bisection on each chamber pressure;
3 outer-rotor revolutions, last one recorded. Verified: leakage off ≡ single-chamber model (1e-12),
time-step convergence, mass balance, scaling laws (see `docs/validation.md` §5, §8).

## Not yet modelled

Couette (shear) flow in gaps, inter-chamber face leakage over tooth lands, outer rotor radial
micro-motion / OD clearance, elastic deformation at the contacts, metering grooves,
fluid inertia in ports, temperature–viscosity coupling.
