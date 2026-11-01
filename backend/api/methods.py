"""Explicit methods registry for the calculation report (replaces docstring regex extraction).

One entry per result module: the method name, the governing equations (as implemented in
gerotor_core, plain text), the literature sources and the named assumptions (A-Dx, see
report.ASSUMPTIONS). Sources are only those already cited in gerotor_core docstrings and
re-read in the researcher review; no clause numbers are invented. Where an equation is a
textbook / in-house derivation and not taken from a cited paper, the source says so
(``kind = "derivation"``). tests/test_api.py enforces that every module lists >= 1 source and
that every assumption id exists.

Fields per source: ``ref`` (short citation), ``kind``, ``use`` (what is taken from it).
Provenance kinds (owner rule no-unexplained-numbers): "literature" / "standard" (cited),
"derivation" (equation chain in the docs), "numerical-justified" (setting with a convergence study,
docs/convergence.md), "user input" (no default; missing -> NOT EVALUATED), "validation" (literature
test vector reproduced by a test), "unverified" (attributed source not checked), "unsourced".
"""
from __future__ import annotations

from . import criteria as _criteria
from gerotor_core import backlash, contact, fluid, friction, geometry, leakage, perfmap, ports, reverse, spectrum, tolerance

IVANOVIC = "Ivanovic et al. 2012"
RUNDO = "Rundo 2017"
KIM = "Kim et al. 2006"
TOTARO = "Totaro, Zardin & Borghi 2025, Evaluation of a simple method to estimate the shaft torque in a gerotor pump"
GAMEZ = "Gamez-Montero et al. (gerotor design review)"
GDS_CAV = "GDS 2017, Calculation of Cavitation Limits"
GDS_POWER = "GDS 2016, power model (single-sided ports)"
JOHNSON = "Johnson, Contact Mechanics (Hertz line contact)"
COLBOURNE = "Colbourne 1975, Trans. CSME 3(4) 215-223"
BONANDRINI = "Bonandrini et al. 2009, Proc. IMechE C 223 1469-1479"
CONVERGENCE = "docs/convergence.md (convergence / sensitivity study, 4 reference designs)"


def _s(ref, kind, use):
    return {"ref": ref, "kind": kind, "use": use}


NUMERICS = _s(CONVERGENCE, "numerical-justified", "grid, sample, sub-step and iteration settings")
USER = lambda what: _s("user input (no default; missing -> NOT EVALUATED)", "user input", what)  # noqa: E731


# key in results -> registry entry
METHODS = {
    "geometry": {
        "module": geometry, "functions": ("derive", "analyse"),
        "method": "Trochoidal gerotor geometry, chamber areas and kinematic displacement",
        "equations": [
            "Q(phi) = R e^{i phi} - e e^{i N phi}  (lobe-centre trochoid in the inner-rotor frame)",
            "inner profile = Q offset inward by rp + c (c = profile equidistance eps)",
            "a1 = N t / (N - 1);  lambda = R / (N e) (Ivanovic), lambda_G = N e / R (Gamez)",
            "cc = (N - 1) (A_max - A_min) b / 1000 [cm^3 per shaft rev]",
        ],
        "sources": [_s(IVANOVIC, "literature", "profile generation, equidistance eps Eq.(9), peak gap ~ 2c"),
                    _s(GAMEZ, "literature", "lambda_G = N e / R Eq.(3), recommended range 0.6-0.8"),
                    _s(COLBOURNE, "literature", "trochoid curvature Eq. 8, undercut Eq. 9-11, RvMin p. 219, "
                       "dA/dpsi Eq. 28, flow Eq. 29"),
                    _s(COLBOURNE + " Table 2 / Fig. 1, Eq. 11, Eq. 28", "validation",
                       "tests/test_literature_validation.py: rho_min, flow, flow variation, dA reproduced"),
                    USER("N, e, R, rp, b, c, OD, bore, rpm, dp, Rv/RvClear (InvalidDesign if missing)"),
                    NUMERICS],
        "assumptions": ["A-D3", "A-D7"],
    },
    "backlash": {
        "module": backlash, "functions": ("compute_backlash",),
        "method": "Outer-rotor lag (backlash) from the clearance gap function",
        "equations": ["h_k = c + d_k (signed normal distance lobe centre to trochoid)",
                      "delta(t) = OUTER-ROTOR LAG: min_k h_k(delta) = 0 (bisection), period 2 pi / N",
                      "inner-gear lag (Ivanovic) = delta N / (N - 1)"],
        "sources": [_s(IVANOVIC, "literature", "lagging outer rotor, double-contact intervals"),
                    _s(RUNDO, "literature", "sec. 4.1.3 contact with clearance, Eq. 24-25"),
                    _s(IVANOVIC + " Figs. 9a/10a (fixed axes, u = 1.2)", "validation",
                       "outer-rotor lag x N/(N-1) = inner-gear lag 0.22-0.29 deg reproduced"),
                    NUMERICS],
        "assumptions": ["A-D3"],
    },
    "ports": {
        "module": ports, "functions": ("analyse_ports", "simulate_chamber"),
        "method": "Kidney-port opening areas and single-chamber pressure model",
        "equations": ["dp/dt = K/V (Qs + Qd - dV/dt)",
                      "Q = sgn(dp) Cd A sqrt(2 |dp| / rho)",
                      "implicit Euler; void volume below p_cav"],
        "sources": [_s(KIM, "literature", "theoretical port edges, chamber pressure model"),
                    _s(GAMEZ, "literature", "theoretical port edges"),
                    _s(RUNDO, "literature", "lumped chamber pressure model"),
                    _s("Kim 2006 p. 1629: dp = K dV/V (1 % ~ 17 MPa at K = 1.62 GPa)", "derivation",
                       "trapped-volume pressure rise = K x swing; the allowed swing / rise is a user criterion "
                       "(C-TRAPPED, empty)"),
                    USER("rho, bulk, Cd, pIn, pVap, porting layout, grooveW (if grooves)"),
                    NUMERICS],
        "assumptions": [],
    },
    "leakage": {
        "module": leakage, "functions": ("simulate_network", "outlet_ripple"),
        "method": "Multi-chamber lumped-parameter network with internal leakage",
        "equations": ["dp_k/dt = K/V_k (sum Q_in,k - dV_k/dt)",
                      "tip/flank gap: Q = 2 b h^{5/2} dp / (9 pi mu sqrt(2 rho_eq))",
                      "axial face: Q = theta h^3 dp / (12 mu ln(r2/r1))",
                      "port land: Q = w h^3 dp / (12 mu L)"],
        "sources": [_s(RUNDO, "literature", "lumped-parameter chamber network"),
                    _s(KIM, "literature", "chamber pressure model"),
                    _s("Reynolds equation, laminar Poiseuille gap flow (docs/lumped-model.md)", "derivation",
                       "gap conductances; Couette flow not modelled"),
                    _s("periphery / unvented bore node mass balance sum_k G (p_k - p_node) = 0 with equal G "
                       "(docs/lumped-model.md)", "derivation", "p_node = mean chamber pressure (A-D9)"),
                    _s("docs/convergence.md 'Guards' (bracket and division guards)", "derivation",
                       "RHO_EQ_INV_MIN, PRESSURE_BRACKET_PA, BRACKET_DOUBLINGS do not change a converged result"),
                    USER("nu, axialClr, shaftVent (leakOn; no default)"), NUMERICS],
        "assumptions": ["A-D3", "A-D8b", "A-D9"],
    },
    "contact": {
        "module": contact, "functions": ("compute_contact",),
        "method": "Fluid torques, contact force, Hertz line-contact stress, sliding velocity, wear indicator",
        "equations": ["T_i = g b/2 (|c0 - O1|^2 - |c1 - O1|^2),  T_o = g b/2 (|c1|^2 - |c0|^2)",
                      "F_n arm_o = sum T_o",
                      "p_max = sqrt(F E* / (pi b rho_eq)),  a = sqrt(4 F rho_eq / (pi b E*))",
                      "v_s = (omega1 / N) |P - I|,  WRPF = p_max v_s"],
        "sources": [_s(RUNDO, "literature", "fluid torques Eqs. 18-19"),
                    _s(JOHNSON, "literature", "Hertz line contact"),
                    _s("Ivanovic 2020 (not on the desk; not in Colbourne 1974/1975 or Ivanovic 2021)", "unverified",
                       "wear-rate proportional factor WRPF = p_max v_s - provenance UNVERIFIED"),
                    USER("rotor material Ein, nuIn, Eout, nuOut (no 210 GPa / 0.3 fallback)"),
                    _s(CONVERGENCE + " (rho_eq cap 1e3/1e4/1e5 mm)", "numerical-justified", "A-D8b cap sensitivity"),
                    _s(TOTARO, "literature", "single-contact hypothesis p.4 (A-D8a)")],
        "assumptions": ["A-D8a", "A-D8b"],
    },
    "friction": {
        "module": friction, "functions": ("compute_mechanical",),
        "method": "Viscous / Coulomb mechanical losses and shaft torque",
        "equations": ["M_shaft = M_press + tau (M_out,radial + M_out,lateral) + M_in,lateral + M_jb",
                      "M_th = V dp / 2 pi;  eta_m = M_th / M_shaft",
                      "Ocvirk short bearing: W(eps), M = 2 pi mu w R^3 L / (c sqrt(1 - eps^2))",
                      "lateral ring: M = mu pi w (R^4 - r^4) / h",
                      "single-sided: M_c = mu_f q 2 pi/3 (ro^3 - ri^3), q = dp/2"],
        "sources": [_s(TOTARO, "literature", "shaft-torque model, Eqs. (8)-(9) bearing load split"),
                    _s(GDS_POWER, "literature", "single-sided port Coulomb floor friction"),
                    USER("nu, rho, axialClr, odClr, jbClr, jbLen, faceMu (single-sided only)"), NUMERICS],
        "assumptions": ["A-D5", "A-D6"],
    },
    "spectrum": {
        "module": spectrum, "functions": ("ripple_spectrum",),
        "method": "DFT of the delivered flow over one outer revolution",
        "equations": ["f2 = n (N-1) / (60 N);  harmonic h at h f2",
                      "tooth-pass f_tp = n (N-1) / 60 (harmonic N)"],
        "sources": [_s(GAMEZ, "literature", "lobe-count parity changes ripple amplitude (after Manco 2000)"),
                    _s("discrete Fourier transform; dominant harmonic N verified numerically (tests)",
                       "derivation", "frequency rule")],
        "assumptions": [],
    },
    "cavitation": {
        "module": perfmap, "functions": ("gds_cavitation_limits", "max_speed"),
        "method": "GDS cavitation speed limits and filling-limited maximum speed",
        "equations": ["rotor tip: 1/2 rho V^2 = dP_avail, n = 60 V / (2 pi r_tip)",
                      "inlet gallery: Re = U D / nu = 2000, n = U A / V_disp",
                      "max speed: bisection on rpm for peak void fraction <= limit (network model)"],
        "sources": [_s(GDS_CAV, "literature", "tip-speed and gallery limits"),
                    _s(RUNDO, "literature", "void fraction from the chamber network"),
                    USER("maxSpeed voidLimit, rpmMin, rpmMax, tol (former 0.005 / 100 / 20000 / 10 had no source)")],
        "assumptions": ["A-D2", "A-D4"],
    },
    "operating": {
        "module": perfmap, "functions": ("operating_point",),
        "method": "Operating point: network, pressure torque and friction re-evaluated per load case",
        "equations": ["Q_out from the chamber network; eta_v = Q_out / Q_th (includes leakage, compressibility and "
                      "incomplete filling - not a pure leakage efficiency)",
                      "M_shaft per friction model; eta_m = M_th / M_shaft"],
        "sources": [_s(RUNDO, "literature", "chamber network"),
                    _s(TOTARO, "literature", "shaft torque")],
        "assumptions": ["A-D5", "A-D6"],
    },
    "fluid": {
        "module": fluid, "functions": (),
        "method": "Oil viscosity and density vs temperature",
        "equations": ["log10(log10(nu + 0.7)) = A - B log10(T[K]) (nu >= 2 cSt)",
                      "rho(T) = rho15 (1 - alpha (T - 15)), alpha = rhoExp [1/K] user input"],
        "sources": [_s("ASTM D341 (Ubbelohde-Walther)", "standard", "viscosity-temperature relation"),
                    _s("ISO 3448 viscosity grades (clause not verified)", "standard", "ISO VG nu40 = grade midpoint"),
                    _s("OILS nu100, rho15 and all non-ISO-VG rows (fluid.OILS source tags)", "unsourced",
                       "using a library oil marks the report NOT FOR CERTIFICATION until "
                       "References/Oil-Datasheets/sources.md cites it (fluid.load_sources)"),
                    USER("rhoExp [1/K] thermal expansion coefficient (former unsourced 6.5e-4 removed, audit R02); "
                         "absent -> density not temperature-corrected, check row 'density temperature correction "
                         "NOT EVALUATED'"),
                    _s("user-oil Walther fit rms deviation reported as information (former 5 % warning limit had "
                       "no source)", "derivation", "rms of nu_fit/nu - 1 over the datasheet points")],
        "assumptions": [],
    },
    "reverse": {
        "module": reverse, "functions": ("reverse_engineer",),
        "method": "Reverse engineering of design parameters from measured diameters",
        "equations": ["Dt = 2(R + e - rp - c), Dr = 2(R - e - rp - c), Dl = 2(R - rp), Dv = 2 Rv",
                      "e = (Dt - Dr)/4, c = Dl/2 - (Dt + Dr)/4, R = Dl/2 + rp, Rv = Dv/2"],
        "sources": [_s(IVANOVIC, "literature", "profile definition (R, rp, eps) the inversion is based on"),
                    _s("closed-form inversion of the profile diameters (in-house)", "derivation", "equations")],
        "assumptions": ["A-D3"],
    },
}

METHODS["tolerance"] = {
    "module": tolerance, "functions": ("check_bands", "interval"),
    "method": "Clearance tolerance -> intervals of eta_v, eta_hm and eta per load case",
    "equations": ["monotone axis (axialClr, odClr, jbClr): extreme at the band ends -> vertex enumeration, exact",
                  "non-monotone axis (c: eta_hm has an interior minimum): GRID_LEVELS uniform points + parabola vertex "
                  "f1 - (f2 - f0)^2 / (8 (f0 - 2 f1 + f2)) at interior extrema",
                  "eta enclosure [min eta_v min eta_hm, max eta_v max eta_hm] (eta_v, eta_hm > 0)"],
    "sources": [_s("docs/tolerance.md (monotonicity sweeps, 3 designs x 3 operating points x 4 clearances; "
                   "tests/test_tolerance.py)", "derivation", "axis classification and interval method"),
                _s("docs/tolerance.md grid study 3/5/9/17 levels", "numerical-justified", "GRID_LEVELS = 5"),
                USER("settings.clearanceTolerance {c, axialClr, odClr, jbClr: {min, max}} (no default band)")],
    "assumptions": ["A-D3", "A-D5"],
}

METHODS["acceptance"] = {
    "module": _criteria, "functions": ("evaluate", "effective", "quantity_values", "neutralize_checks"),
    "method": "Acceptance-criteria evaluation (authority-independent profiles, user limits, overrides)",
    "equations": ["'<=': allowable = limit / S, margin = (allowable - x) / allowable",
                  "'>=': required = limit S, margin = (x - required) / required",
                  "'range': margin = min(x - min, max - x) / (max - min)",
                  "governing case = min margin over load cases; overall = FAIL | PASS (all enabled PASS) | INCOMPLETE",
                  "Hertz validity a / rho_eq = 2 p_max / E*  (from p_max = 2F/(pi a b), p_max^2 = F E*/(pi b rho_eq))",
                  "no undercut: rp + c < rho_min (offset of the epitrochoid stays cusp-free)"],
    "sources": [_s("production-expert acceptance-criteria model 2026-10-31 (company report)", "derivation",
                   "criteria structure, status rules; no limit values shipped"),
                _s("ISO 6336-5:2016 (catalogue level only, not read)", "standard",
                   "analogy only: allowable = limit stress number / S (A-AC1)"),
                _s(JOHNSON, "literature", "Hertz line-contact relations used for a / rho_eq"),
                _s(COLBOURNE + " Eq. 9-11; " + BONANDRINI + " Eq. 7", "literature",
                   "hard undercut limit rp + c < rho_min (C-UNDERCUT); the 0.85 sharp-tip factor is NOT sourced "
                   "and stays an empty user criterion (C-TIP-SHARP)"),
                _s("Kim 2006 p. 1629 (dp = K dV/V)", "derivation",
                   "trapped-volume swing -> pressure rise route for C-TRAPPED; limit stays an empty user criterion")],
    "assumptions": ["A-AC1"],
}

# Named assumptions (single source of truth for the report and the UI, served by GET /api/methods).
# id -> name, settings.variants switch (None = fixed), statement, variants {value: meaning}, sources.
ASSUMPTION_REGISTRY = {
    "A-D2": {"name": "CAV_HEAD_INLET", "switch": "cavHead",
             "statement": "Available cavitation head p_in - p_vap; 'atm' = GDS p_atm - p_vap.",
             "variants": {"inlet": "p_in - p_vap (inlet pressure of the case)", "atm": "GDS: p_atm - p_vap"},
             "sources": [_s(GDS_CAV, "literature", "'atm' variant, tip-speed and gallery limits"),
                         _s("Bernoulli at the inlet with the actual inlet pressure (in-house)", "derivation",
                            "'inlet' default")]},
    "A-D3": {"name": "C_EQUIDISTANCE", "switch": "clearanceInput",
             "statement": "c is the profile equidistance (Ivanovic eps); peak tip gap ~ 2c.",
             "variants": {"equidistance": "design.c = eps", "peakGap": "design.c = peak tip gap, converted to eps"},
             "sources": [_s(IVANOVIC, "literature", "equidistance eps Eq.(9), R = lam z e, rp = c e")]},
    "A-D4": {"name": "CAV_AREA_DOUBLE_FILL", "switch": "cavAreaDoubleFill",
             "statement": "Gallery area = suction-port area x fillS; false = GDS single port.",
             "variants": {True: "suction area x fillS (fillS = 2 if dblIn)", False: "GDS single-port area"},
             "sources": [_s(GDS_CAV, "literature", "inlet gallery Re = 2000 limit, single port area")]},
    "A-D5": {"name": "OD_CLEARANCE_DIAMETRAL", "switch": "clearanceConvention",
             "statement": "odClr, jbClr diametral; Ocvirk uses radial = half.",
             "variants": {"diametral": "inputs diametral", "radial": "inputs radial, doubled internally"},
             "sources": [_s(TOTARO, "literature", "outer-rotor radial and journal viscous torque model"),
                         _s("Ocvirk short-bearing solution (textbook)", "derivation", "radial clearance = diametral/2")]},
    "A-D6": {"name": "JOURNAL_SYMMETRIC", "switch": "journal",
             "statement": "W/2 per bearing; object = Totaro Eq.(8)-(9) lever-arm split.",
             "variants": {None: "symmetric W/2 per bearing", "object": "{l1, l2, L1, L2} lever-arm split"},
             "sources": [_s(TOTARO, "literature", "Eqs. (8)-(9) bearing load split")]},
    "A-D7": {"name": "LAMBDA_IVANOVIC", "switch": "lambdaConvention",
             "statement": "lambda = R/(N e) (settled: Ivanovic = Bonandrini alpha3 = Colbourne b/(e m)); "
                          "Gamez uses the inverse.",
             "variants": {"ivanovic": "lambda = R/(N e)", "gamez": "lambda_G = N e / R (label only)"},
             "settled": "SETTLED 2026-10-31: Ivanovic lambda = Bonandrini alpha3 = Colbourne b/(e m) (three sources)",
             "sources": [_s(IVANOVIC, "literature", "lambda definition"), _s(GAMEZ, "literature", "Eq.(3) inverse"),
                         _s(BONANDRINI, "literature", "alpha3 = (a/e)/N = R/(N e), p. 1474"),
                         _s(COLBOURNE, "literature", "b/(e m) > 1, p. 220")]},
    "A-D8a": {"name": "HERTZ_SINGLE_LOBE", "switch": None,
              "statement": "Whole balancing force on one lobe (conservative in double contact).",
              "variants": {}, "sources": [_s(TOTARO, "literature", "single-contact hypothesis p.4")]},
    "A-D8b": {"name": "HERTZ_CONFORMAL_CAP", "switch": None,
              "statement": "rho_eq capped at 1e4 mm; Hertz validity a/rho reported, not enforced.",
              "variants": {}, "sources": [_s(JOHNSON, "literature", "Hertz line contact, validity a << rho"),
                                          _s(CONVERGENCE, "numerical-justified", "cap sensitivity 1e3-1e5 mm")]},
    "A-D9": {"name": "PERIPHERY_SEALED", "switch": None,
             "statement": "Outer-rotor periphery (and unvented bore) is a massless, sealed node joined to every chamber "
                          "by the same face conductance, so its pressure is the mean chamber pressure.",
             "variants": {},
             "sources": [_s("mass balance sum_k G (p_k - p_node) = 0, G equal for all k (sector 2 pi/N); "
                            "docs/lumped-model.md", "derivation", "p_node = mean_k p_k")]},
    "A-AC1": {"name": "HERTZ_GEAR_ANALOGY", "switch": None,
              "statement": "Gerotor 2-D Hertz peak pressure is compared with a gear contact limit stress "
                           "(ISO 6336-5 style allowable = sigma_Hlim / S). Modelling analogy: ISO 6336 covers "
                           "involute gears, not gerotor profiles; no allowable value is shipped.",
              "variants": {}, "sources": [_s("ISO 6336-5:2016 (catalogue level only, not read)", "standard",
                                             "concept of limit stress number / safety factor")]},
}


def _variant_key(val):
    return "object" if isinstance(val, dict) else val


def assumptions(variants: dict | None = None, defaults: dict | None = None) -> list[dict]:
    """Assumption rows with the active variant for ``variants`` (settings.variants, defaults applied)."""
    variants, defaults = variants or {}, defaults or {}
    rows = []
    for aid, a in ASSUMPTION_REGISTRY.items():
        key = a["switch"]
        val = variants.get(key, defaults.get(key)) if key else None
        default = defaults.get(key) if key else None
        used = [m for m, e in METHODS.items() if aid in e["assumptions"]]
        rows.append({"id": aid, "name": a["name"], "switch": key, "statement": a["statement"], "text": a["statement"],
                     "value": val, "default": default, "literatureVariant": bool(key) and val != default,
                     "active": a["variants"].get(_variant_key(val)) if key else "fixed",
                     "variants": [{"value": k,
                                   "meaning": t} for k, t in a["variants"].items()],
                     "usedBy": used, "sources": [dict(x) for x in a["sources"]]})
    return rows
