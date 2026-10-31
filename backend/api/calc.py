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
from gerotor_core import InvalidDesignError, contact, fluid, friction, geometry, perfmap, reverse, spectrum

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
ACCEPTANCE_DEFAULT = {"authority": None, "status": "pending", "criteria": []}
SETTINGS_DEFAULTS = {"samples": 96, "contactQuasiStatic": False, "acceptanceCriteria": ACCEPTANCE_DEFAULT,
                     "maxSpeed": {"enabled": False, "voidLimit": 0.005, "rpmMin": 100, "rpmMax": 20000, "tol": 10}}

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


def build_design(inputs: dict, v: dict) -> dict:
    """Design dict for gerotor_core: unit-convention variants (A-D3, A-D5), defaults, derive."""
    p = design_values(inputs)
    miss = [k for k in ("N", "e", "R", "rp", "b") if p.get(k) is None]
    if miss:
        raise InvalidDesignError(f"design is missing {', '.join(miss)}")
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
    p = build_design(inputs, v)
    need_sub = any(m not in ("geometry", "reverse") for m in modules)
    res = geometry.analyse(p, samples=int(s["samples"]), sub_models=need_sub)
    out["design"] = p
    out["checks"] = res.get("checks", [])
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
    if s["contactQuasiStatic"] and res.get("contact") is not None:
        res["contact"] = contact.compute_contact(p, res, quasi_static=True)
        res["mech"] = friction.compute_mechanical(p, res)
    if v["journal"] and res.get("mech") is not None:
        res["mech"] = friction.compute_mechanical(p, res, journal=v["journal"])
    if "contact" in modules:
        out["contact"] = res.get("contact")
    if "friction" in modules:
        out["friction"] = res.get("mech")
    if "spectrum" in modules:
        out["spectrum"] = spectrum.ripple_spectrum(p, res)
    if "cavitation" in modules:
        cav = {"gds": None, "maxSpeed": None}
        if res.get("ports") and res["ports"].get("As") is not None:
            cav["gds"] = perfmap.gds_cavitation_limits(p, res, head=v["cavHead"],
                                                       double_fill_area=bool(v["cavAreaDoubleFill"]))
            ms = s["maxSpeed"]
            if ms.get("enabled"):
                cav["maxSpeed"] = perfmap.max_speed(p, res, ms["voidLimit"], None, ms["rpmMin"], ms["rpmMax"], ms["tol"])
        out["cavitation"] = cav
    if "operating" in modules:
        rows = []
        for i, op in enumerate(ops):
            r = perfmap.operating_point(case_design(p, op), res, float(op["rpm"]), float(op["dp"]))
            r.update({k: op[k] for k in ("oilT", "pIn") if op.get(k) is not None})
            rows.append(dict(r, name=op.get("name") or f"OP{i + 1}"))
        out["operating"] = rows
    if "reverse" in modules and measured:
        out["reverse"] = _reverse(measured)
    return out


def case_design(p: dict, op: dict) -> dict:
    """Design dict of one load case: pIn, nu, rho overrides (see module docstring)."""
    q = dict(p)
    if op.get("pIn") is not None:
        q["pIn"] = float(op["pIn"])
    if op.get("nu") is not None:
        q["nu"] = float(op["nu"])
    elif op.get("oilT") is not None and p.get("oil"):
        t = float(op["oilT"])
        props = fluid.user_oil(p, t) if p["oil"] == "user" else fluid.oil_properties(p["oil"], t)
        if props and props.get("nu") is not None:
            q["nu"] = props["nu"]
            if props.get("rho") is not None and math.isfinite(props["rho"]):
                q["rho"] = props["rho"]
    return q


def _reverse(measured):
    if not isinstance(measured, dict):
        raise InvalidDesignError("module reverse needs 'measured' {N, rp, Dt, Dr, Dl, Dv}")
    miss = [k for k in ("N", "rp", "Dt", "Dr", "Dl") if measured.get(k) is None]
    if miss:
        raise InvalidDesignError(f"measured is missing {', '.join(miss)}")
    return reverse.reverse_engineer(measured)
