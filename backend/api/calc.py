"""Calculation dispatcher: request (design + settings + load cases) -> results per module.

Request / project shape (see schema/project.schema.json):
    design           JS design keys, units mm, bar, rpm, cSt, kg/m^3, MPa (bulk), GPa
                     (plain numbers or {"value": x, "unit": "..."} objects)
    fluid            {oil, oilT, nu, rho, bulk, pVap, uT1..uRho15} (schema /3); merged into the design
                     dict for gerotor_core (fluid wins over legacy design keys)
    operatingPoints  [{name, rpm, dp, oilT?, pIn?, nu?}]  load cases (perfmap.operating_point);
                     per case: pIn overrides design.pIn; nu = case nu, else fluid oil grade
                     (fluid.OILS key or "user") evaluated at case oilT (ASTM D341, rho too),
                     else the base fluid nu/rho
    settings         {samples, contactQuasiStatic, variants{...}, maxSpeed{...}}
    measured         optional {N, rp, Dt, Dr, Dl, Dv} for module "reverse"

Literature-variant switches (settings.variants); defaults = JS tool behaviour (bit parity):
    A-D2 cavHead             "inlet" (p_in - p_vap) | "atm" (GDS: p_atm - p_vap)
    A-D3 clearanceInput      "equidistance" (design.c = Ivanovic eps) | "peakGap" (design.c is
                             the peak tip-to-tip gap, converted with geometry.peak_gap_to_c)
    A-D4 cavAreaDoubleFill   true (suction area x fillS) | false (GDS single-port area)
    A-D5 clearanceConvention "diametral" | "radial" (odClr/jbClr given radial -> x2)
    A-D6 journal             null (symmetric W/2) | {l1, l2, L1, L2} mm (Totaro lever-arm split)
    A-D7 lambdaConvention    "ivanovic" (R/(N e)) | "gamez" (inverse) - reporting label only
    A-D8 (Hertz single lobe, rho_eq cap) is fixed and only reported as an assumption.
"""
from __future__ import annotations

import copy
import math

import gerotor_core as G
from gerotor_core import InvalidDesignError, contact, fluid, friction, geometry, perfmap, reverse, spectrum, tolerance

from . import units
from .project import design_units

DESIGN_UNITS = design_units()

MODULES = ("geometry", "backlash", "ports", "contact", "friction", "spectrum", "cavitation",
           "operating", "reverse")

VARIANT_DEFAULTS = {
    "cavHead": "inlet",
    "clearanceInput": "equidistance",
    "cavAreaDoubleFill": True,
    "clearanceConvention": "diametral",
    "journal": None,
    "lambdaConvention": "ivanovic",
}
VARIANT_IDS = {"cavHead": "A-D2", "clearanceInput": "A-D3", "cavAreaDoubleFill": "A-D4",
               "clearanceConvention": "A-D5", "journal": "A-D6", "lambdaConvention": "A-D7"}
from .criteria import DEFAULT as ACCEPTANCE_DEFAULT, neutralize_checks  # noqa: E402  (schema /4)
# samples = 96 per lobe pitch: numerical setting, converged (docs/convergence.md, N01).
# maxSpeed search: voidLimit is a judgement limit and rpmMin / rpmMax / tol define the search range
# and the reported resolution - all user inputs, no defaults (audit C07); missing -> NOT EVALUATED.
SETTINGS_DEFAULTS = {"samples": 96, "contactQuasiStatic": False, "acceptanceCriteria": ACCEPTANCE_DEFAULT,
                     "maxSpeed": {"enabled": False, "voidLimit": None, "rpmMin": None, "rpmMax": None, "tol": None}}

# ---- inputs: no silent defaults (owner rule no-unexplained-numbers; audit C01-C03) --------------------
# Without these nothing can be computed -> InvalidDesignError.
BASE_KEYS = ("N", "e", "R", "rp", "b", "c", "OD", "bore", "rpm", "dp")
# Structural switches / offsets: absent = feature off, port radii derived from Rv / inner root, or
# nominal (theoretical) port timing. They carry no magnitude that needs a source; the values applied
# are echoed in results["structural"] and are part of the resolved input hash.
STRUCTURAL = {"portsOn": False, "leakOn": False, "portRoAuto": True, "portRiAuto": True,
              "sucStart": 0, "sucEnd": 0, "delStart": 0, "delEnd": 0,
              "gSucStart": 0, "gSucEnd": 0, "gDelStart": 0, "gDelEnd": 0}
LAYOUT_KEYS = ("dblIn", "dblOut", "shadow", "portLayout", "faceSupport", "doubleFill")
MATERIAL_KEYS = ("Ein", "nuIn", "Eout", "nuOut")
# result module -> core sub-model whose inputs it needs
MODULE_MODEL = {"ports": "ports", "contact": "contact", "friction": "mech", "spectrum": "spectrum",
                "cavitation": "cavitation", "operating": "operating"}

GEOMETRY_KEYS = ("valid", "rhoMin", "tipSpeed", "psiContactMax", "AminActual", "AmaxActual", "M", "dt",
                 "Amin", "Amax", "dispInner", "cc", "ccCheck", "flowLpm", "ripple", "torque", "power",
                 "chamberOffset", "lobe")


def split_request(body: dict):
    """Return (design_inputs, settings, variants, operating_points, measured) with defaults applied."""
    if not isinstance(body, dict):
        raise InvalidDesignError("request body must be a JSON object")
    if "design" in body:
        inputs = body.get("design") or {}
    else:  # bare design dict
        inputs = {k: v for k, v in body.items() if k not in ("settings", "operatingPoints", "measured", "fluid")}
    if not isinstance(inputs, dict):
        raise InvalidDesignError("design must be an object")
    fl = body.get("fluid")
    if fl is not None:
        if not isinstance(fl, dict):
            raise InvalidDesignError("fluid must be an object")
        inputs = dict(inputs, **fl)
    s = copy.deepcopy(SETTINGS_DEFAULTS)
    s.update(copy.deepcopy(body.get("settings") or {}))
    s["maxSpeed"] = dict(SETTINGS_DEFAULTS["maxSpeed"], **(s.get("maxSpeed") or {}))
    v = dict(VARIANT_DEFAULTS, **(s.get("variants") or {}))
    s["variants"] = v
    ops = body.get("operatingPoints") or []
    return inputs, s, v, ops, body.get("measured")


def design_values(inputs: dict) -> dict:
    """{"value", "unit"} objects -> plain numbers in the x-unit of the key (units.UnitError if not possible)."""
    return units.to_plain(inputs, DESIGN_UNITS)


def build_design(inputs: dict, v: dict, applied: dict | None = None) -> dict:
    """Design dict for gerotor_core: unit-convention variants (A-D3, A-D5), structural switches, derive.

    No physical default is filled in. Missing BASE_KEYS (or Rv / RvClear) -> InvalidDesignError;
    inputs of individual sub-models are checked by ``missing_inputs`` (NOT EVALUATED). ``applied``
    (optional dict) receives the STRUCTURAL switches that were absent and set.
    """
    p = design_values(inputs)
    miss = [k for k in BASE_KEYS if p.get(k) is None]
    if p.get("RvAuto"):
        miss += [k for k in ("RvClear",) if p.get(k) is None]
    elif p.get("Rv") is None:
        miss.append("Rv (or RvAuto + RvClear)")
    if miss:
        raise InvalidDesignError(f"design is missing {', '.join(miss)} (no default values are applied)")
    app = {k: d for k, d in STRUCTURAL.items() if p.get(k) is None}
    p.update(app)
    if applied is not None:
        applied.update(app)
    if v["clearanceInput"] == "peakGap" and p.get("c") is not None:
        p["c"] = geometry.peak_gap_to_c(p["c"])
    if v["clearanceConvention"] == "radial":
        for k in ("odClr", "jbClr"):
            if p.get(k) is not None:
                p[k] = friction.radial_to_diametral(p[k])
    try:
        return G.design(**p)
    except (KeyError, TypeError) as exc:
        raise InvalidDesignError(f"design could not be derived: {exc}") from exc


def _absent(p, keys):
    return [k for k in keys if p.get(k) is None]


def missing_inputs(p: dict) -> dict:
    """{model: [missing input keys]} for the core sub-models; a model also misses its dependencies.

    ports      portsOn: rho, bulk, Cd, pIn, pVap, porting layout; grooveW if a groove length > 0;
               leakOn: nu, axialClr, shaftVent
    contact    dp > 0: rotor material Ein, nuIn, Eout, nuOut (+ ports when portsOn: pressure source)
    mech       nu, rho, axialClr, odClr, jbClr, jbLen, layout, faceMu if single-sided (+ contact, ports)
    spectrum   ports when portsOn;  cavitation: ports + nu;  operating: ports, contact, mech
    """
    from gerotor_core.friction import single_sided
    has_layout = any(p.get(k) is not None for k in LAYOUT_KEYS)
    lay = [] if has_layout else ["porting layout (dblIn/dblOut/shadow)"]
    m: dict = {}
    if p.get("portsOn"):
        k = _absent(p, ("rho", "bulk", "Cd", "pIn", "pVap")) + lay
        if any((p.get(g) or 0) > 0 for g in ("gSucStart", "gSucEnd", "gDelStart", "gDelEnd")):
            k += _absent(p, ("grooveW",))
        if p.get("leakOn"):
            k += _absent(p, ("nu", "axialClr", "shaftVent"))
        if k:
            m["ports"] = list(dict.fromkeys(k))
    dep_ports = ["ports: " + ", ".join(m["ports"])] if "ports" in m else []
    if p["dp"] > 0:
        k = _absent(p, MATERIAL_KEYS) + dep_ports
        if k:
            m["contact"] = k
    dep_contact = ["contact: " + ", ".join(m["contact"])] if "contact" in m else []
    k = _absent(p, ("nu", "rho", "axialClr", "odClr", "jbClr", "jbLen")) + lay
    if has_layout and single_sided(p):
        k += _absent(p, ("faceMu",))
    k += dep_contact or dep_ports
    if k:
        m["mech"] = k
    if dep_ports:
        m["spectrum"] = list(dep_ports)
    k = dep_ports + _absent(p, ("nu",))
    if p.get("portsOn") and k:
        m["cavitation"] = k
    k = list(dict.fromkeys(dep_ports + dep_contact + (["friction: " + ", ".join(m["mech"])] if "mech" in m else [])))
    if k:
        m["operating"] = k
    return m


def _missing_check(module, keys):
    return {"level": "missing", "title": f"Missing input - {module} NOT EVALUATED", "module": module,
            "missing": list(keys), "detail": "no default values are applied; enter: " + "; ".join(keys)}


def oil_check(p: dict) -> list[dict]:
    """Oil-library (fluid.OILS) rows without a datasheet source -> NOT FOR CERTIFICATION check row."""
    key = p.get("oil")
    if not isinstance(key, str) or key not in fluid.OILS:
        return []
    st = fluid.oil_source_status(key)
    rows = []
    if st["unsourced"]:
        rows.append({"level": "warn", "title": "Unsourced oil data - NOT FOR CERTIFICATION", "oil": key,
                     "unsourced": st["unsourced"], "certification": False,
                     "detail": f"library oil '{key}' ({st['label']}): " + ", ".join(st["unsourced"])
                               + " have no datasheet source (References/Oil-Datasheets/sources.md)"})
    for fl in st["flags"]:
        rows.append({"level": "warn", "title": "Suspicious oil-library value", "oil": key, "detail": fl})
    return rows


def certification(checks) -> dict:
    """Report-level certification status from the check rows (unsourced data, missing inputs)."""
    reasons = [c["detail"] for c in checks if c.get("certification") is False]
    reasons += [c["title"] for c in checks if c.get("level") == "missing"]
    return {"status": "NOT FOR CERTIFICATION" if reasons else "NO BLOCKING ITEM FOUND",
            "reasons": reasons,
            "note": "The software only detects unsourced library data and missing inputs; acceptance of the "
                    "design rests with the certifying authority."}


NUMERIC_SETTINGS = {
    "geometry": ("TOOL_COARSE_N", "TOOL_GOLDEN_STEPS", "INNER_SECTOR_PANELS", "FILLET_PROFILE_N", "FILLET_PTS",
                 "FILLET_POS_PER_LOBE", "FILLET_ENDS", "CURV_N", "CURV_N_FAST", "CHAMBER_N_IN", "CHAMBER_N_OUT",
                 "ACTUAL_AREA_STRIDE", "PEAK_GAP_FACTOR"),
    "ports": ("PORT_EXTENT_N_IN", "PORT_EXTENT_N_OUT", "PORT_ARC_N", "PIECE_SEGMENTS", "FILLET_ARC_N",
              "FILLET_CORNER_N", "GROOVE_PIECE_DEG", "DISK_N", "CH_SUB_DEFAULT", "CH_CYCLES", "CH_BISECT",
              "OPEN_TOL_REL"),
    "leakage": ("RHO_EQ_CAP_MM", "NET_SUB_DEFAULT", "NET_SWEEPS", "NET_CYCLES", "NET_BISECT", "OUT_SUB",
                "OUT_CYCLES", "OUT_BISECT"),
    "backlash": ("NEWTON_ITERS", "NEWTON_TOL", "DELTA_DOUBLINGS", "DELTA_BISECT", "CONTACT_GAP_FRAC"),
    "friction": ("ECC_BISECT",),
    "contact": ("LOBE_PROBE_LAG",),
    "tolerance": ("GRID_LEVELS",),
}


def numerics() -> dict:
    """Current values of the core numerical settings (docs/convergence.md) - part of the resolved hash."""
    import importlib
    return {m: {k: getattr(importlib.import_module("gerotor_core." + m), k) for k in ks}
            for m, ks in NUMERIC_SETTINGS.items()}


def resolved_inputs(body: dict) -> dict:
    """Every value the calculation actually uses, after unit conversion, variants and derive.

    design          core design dict (converted units, A-D3/A-D5 applied, structural switches, derived)
    structural      structural switches that were absent and applied (see STRUCTURAL)
    settings        effective settings incl. SETTINGS_DEFAULTS and variants
    numerics        core numerical settings (grid / iteration constants, docs/convergence.md)
    acceptance      SHA-256 of the effective acceptance-criteria set (profile library + overrides)
    operatingPoints per case the values passed to the core (rpm, dp, pIn, nu, rho)
    oil             OILS row values + source status when fluid.oil is a library key
    measured        reverse-engineering input
    Basis of the resolved input hash (project.resolved_hash): two requests that compute differently
    differ here. A design that cannot be built is represented by its error text.
    """
    from .criteria import effective
    inputs, s, v, ops, measured = split_request(body)
    out = {"settings": s, "measured": measured, "numerics": numerics(),
           "acceptance": effective(s.get("acceptanceCriteria")).get("hash")}
    try:
        st: dict = {}
        p = build_design(inputs, v, st)
    except (InvalidDesignError, units.UnitError) as exc:
        out["designError"] = str(exc)
        return out
    out["structural"] = st
    out["design"] = p
    cases = []
    for op in ops:
        q = case_design(p, op) if isinstance(op, dict) and op.get("rpm") is not None and op.get("dp") is not None \
            else {}
        cases.append({"name": op.get("name") if isinstance(op, dict) else None,
                      **{k: q.get(k) for k in ("pIn", "nu", "rho")},
                      **({k: op.get(k) for k in ("rpm", "dp", "oilT")} if isinstance(op, dict) else {})})
    out["operatingPoints"] = cases
    key = p.get("oil")
    if isinstance(key, str) and key in fluid.OILS:
        o = fluid.OILS[key]
        out["oil"] = {"key": key, **{q: o[q] for q in fluid.QUANTITIES},
                      "source": {q: o["source"][q]["status"] for q in fluid.QUANTITIES}}
    return out


def _sub(d, keys):
    return {k: d[k] for k in keys if k in d}


def run(body: dict, modules=None) -> dict:
    """Evaluate the requested modules (default: all). Raises InvalidDesignError / KeyError(module)."""
    inputs, s, v, ops, measured = split_request(body)
    modules = list(modules or MODULES)
    for m in modules:
        if m not in MODULES:
            raise KeyError(m)
    out: dict = {"modules": modules, "settings": s}
    if modules == ["reverse"]:
        out["reverse"] = _reverse(measured)
        return out
    structural: dict = {}
    p = build_design(inputs, v, structural)
    miss = missing_inputs(p)
    need_sub = any(m not in ("geometry", "reverse") for m in modules)
    res = geometry.analyse(p, samples=int(s["samples"]), sub_models=need_sub,
                           skip=tuple(m for m in ("ports", "contact", "mech") if m in miss))
    out["design"] = p
    out["structural"] = structural
    out["checks"] = neutralize_checks(res.get("checks", []))
    nev = {m: miss[MODULE_MODEL[m]] for m in modules if MODULE_MODEL.get(m) in miss}
    out["notEvaluated"] = nev
    out["checks"] += [_missing_check(m, k) for m, k in nev.items()]
    out["checks"] += oil_check(p)
    out["checks"] += density_check(p, ops)
    out["certification"] = certification(out["checks"])
    out["valid"] = bool(res.get("valid"))
    if not res.get("valid"):
        raise InvalidDesignError("design is invalid", res.get("checks"))

    if "geometry" in modules:
        geo = _sub(res, GEOMETRY_KEYS)
        geo.update(A=res.get("A"), dA=res.get("dA"), q=res.get("q"), polys=res.get("polys"),
                   **{"lambda": p["lambda"], "lambdaGamez": geometry.lambda_gamez(p["R"], p["N"], p["e"]),
                      "lambdaConvention": v["lambdaConvention"]})
        out["geometry"] = geo
    if "backlash" in modules:
        out["backlash"] = res.get("backlash")
    if "ports" in modules:
        out["ports"] = res.get("ports")
        if out["ports"] and out["ports"].get("checks") is not None:
            out["ports"] = dict(out["ports"], checks=neutralize_checks(out["ports"]["checks"]))
    if s["contactQuasiStatic"] and res.get("contact") is not None:
        res["contact"] = contact.compute_contact(p, res, quasi_static=True)
        if res.get("mech") is not None:
            res["mech"] = friction.compute_mechanical(p, res)
    if v["journal"] and res.get("mech") is not None:
        res["mech"] = friction.compute_mechanical(p, res, journal=v["journal"])
    if "contact" in modules:
        out["contact"] = res.get("contact")
    if "friction" in modules:
        out["friction"] = res.get("mech")
    if "spectrum" in modules:
        out["spectrum"] = None if "spectrum" in nev else spectrum.ripple_spectrum(p, res)
    if "cavitation" in modules:
        cav = {"gds": None, "maxSpeed": None}
        if "cavitation" in nev:
            cav = None
        elif res.get("ports") and res["ports"].get("As") is not None:
            cav["gds"] = perfmap.gds_cavitation_limits(p, res, head=v["cavHead"],
                                                       double_fill_area=bool(v["cavAreaDoubleFill"]))
            ms = s["maxSpeed"]
            ms_miss = [k for k in ("voidLimit", "rpmMin", "rpmMax", "tol") if ms.get(k) is None]
            if ms.get("enabled") and ms_miss:
                cav["maxSpeed"] = {"status": "NOT EVALUATED", "missing": ["settings.maxSpeed." + k for k in ms_miss]}
                out["checks"].append(_missing_check("cavitation.maxSpeed", cav["maxSpeed"]["missing"]))
                out["certification"] = certification(out["checks"])
            elif ms.get("enabled"):
                cav["maxSpeed"] = perfmap.max_speed(p, res, ms["voidLimit"], None, ms["rpmMin"], ms["rpmMax"], ms["tol"])
                if cav["maxSpeed"] is not None:
                    cav["maxSpeed"] = inlet_rpm_from_criteria(cav["maxSpeed"], p, res, s.get("acceptanceCriteria"))
        out["cavitation"] = cav
    if "operating" in modules and "operating" in nev:
        out["operating"] = None
    elif "operating" in modules:
        rows = []
        for i, op in enumerate(ops):
            r = perfmap.operating_point(case_design(p, op), res, float(op["rpm"]), float(op["dp"]))
            r.update({k: op[k] for k in ("oilT", "pIn") if op.get(k) is not None})
            rows.append(dict(r, name=op.get("name") or f"OP{i + 1}", etaVBasis=ETA_V_BASIS))
        if s.get("clearanceTolerance"):
            for row, op in zip(rows, ops):
                row["tolerance"] = tolerance_interval(inputs, v, op, s)
        out["operating"] = rows
    if "reverse" in modules and measured:
        out["reverse"] = _reverse(measured)
    return out


def inlet_rpm_from_criteria(ms: dict, p: dict, res: dict, ac) -> dict:
    """Replace core max_speed.rpmInlet (hard-coded 2 m/s, unsourced - audit R01) by the speed at which
    the inlet port velocity reaches the user limit of criterion C-PORT-V-IN:
        n = v_lim A_suction fillS / (cc 1e-6 / 60)   (same velocity formula as ports.inletVelocity).
    No limit entered -> rpmInlet = None (NOT EVALUATED)."""
    from .criteria import effective
    lim = next((c.get("limit") for c in effective(ac)["criteria"] if c["id"] == "C-PORT-V-IN"
                and c.get("enabled", True) and not c.get("unitMismatch")), None)
    suc = (res.get("ports") or {}).get("suction") or {}
    fill = p.get("fillS") or 1
    ok = isinstance(lim, (int, float)) and not isinstance(lim, bool) and suc.get("area") and res.get("cc")
    rpm = lim * suc["area"] * 1e-6 * fill / (res["cc"] * 1e-6 / 60) if ok else None
    return dict(ms, rpmInlet=rpm, rpmInletBasis=("C-PORT-V-IN limit %g m/s (user)" % lim) if ok else
                "NOT EVALUATED - no C-PORT-V-IN limit (former 2 m/s had no source)")


def case_design(p: dict, op: dict) -> dict:
    """Design dict of one load case: pIn, nu, rho overrides (see module docstring)."""
    q = dict(p)
    if op.get("pIn") is not None:
        q["pIn"] = float(op["pIn"])
    if op.get("nu") is not None:
        q["nu"] = float(op["nu"])
    elif op.get("oilT") is not None and p.get("oil"):
        t = float(op["oilT"])
        props = fluid.user_oil(p, t) if p["oil"] == "user" else fluid.oil_properties(p["oil"], t, p.get("rhoExp"))
        if props and props.get("nu") is not None:
            q["nu"] = props["nu"]
            if props.get("rho") is not None and math.isfinite(props["rho"]):
                q["rho"] = props["rho"]
            else:  # no rhoExp: density stays the user's fluid rho (flagged by density_check)
                q["rhoUncorrected"] = True
    return q


def tolerance_interval(inputs: dict, v: dict, op: dict, s: dict) -> dict:
    """eta_v, eta_hm, eta intervals of one load case over settings.clearanceTolerance (gerotor_core.tolerance).
    Bands are in the input unit / convention of each clearance (A-D3, A-D5 are applied by build_design)."""
    try:
        bands = tolerance.check_bands(s["clearanceTolerance"], design_values(inputs))
    except ValueError as exc:
        raise InvalidDesignError(str(exc)) from None
    rpm, dp = float(op["rpm"]), float(op["dp"])

    def make(ov):
        return case_design(build_design(dict(inputs, **ov), v), op)

    def analyse(p):
        return geometry.analyse(p, samples=int(s["samples"]), skip=("contact", "mech"))

    def op_point(p, res, mds):
        return perfmap.operating_point(p, res, rpm, dp, mds)

    return tolerance.interval(make, analyse, op_point, bands)


def density_check(p: dict, ops) -> list[dict]:
    """Check row when load cases at oilT use an oil model but the expansion coefficient rhoExp is absent:
    the density is then NOT temperature-corrected (fluid rho is used); no default coefficient is applied."""
    if p.get("rhoExp") is not None or not p.get("oil") or p["oil"] == "custom":
        return []
    names = [op.get("name") or f"OP{i + 1}" for i, op in enumerate(ops)
             if isinstance(op, dict) and op.get("oilT") is not None and op.get("nu") is None]
    if not names:
        return []
    return [{"level": "missing", "title": "Missing input - density temperature correction NOT EVALUATED",
             "module": "fluid", "missing": ["fluid.rhoExp"],
             "detail": "no thermal expansion coefficient entered; load cases " + ", ".join(names)
                       + " use the fluid density rho unchanged (former 6.5e-4 1/K had no source)"}]


ETA_V_BASIS = ("eta_v = Q_out / Q_th from the chamber network: includes internal leakage, fluid compressibility "
               "and incomplete filling (void fraction); it is not a pure leakage efficiency")


def _reverse(measured):
    if not isinstance(measured, dict):
        raise InvalidDesignError("module reverse needs 'measured' {N, rp, Dt, Dr, Dl, Dv}")
    miss = [k for k in ("N", "rp", "Dt", "Dr", "Dl") if measured.get(k) is None]
    if miss:
        raise InvalidDesignError(f"measured is missing {', '.join(miss)}")
    return reverse.reverse_engineer(measured)
