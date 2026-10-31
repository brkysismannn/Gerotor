"""Authority-independent acceptance criteria: profiles, material library, overrides, evaluation.

Design: company/reports/2026-10-31-production-expert-acceptance-criteria.md (owner decisions
2026-10-31). Rules implemented here:

* Profiles ("generic", "iso-based", "class-society", "customer-defined") are immutable templates
  shipped by the software. EVERY numeric limit and safety factor ships EMPTY (None): no
  unverified number is a default. Boolean model-validity predicates (geometry valid, no undercut)
  are internal software checks, not authority limits, and carry the source label "internal".
* User-entered values are Override records {target, id, field, value, unit, reason, user,
  timestamp}; the effective set = template + overrides (later record wins). Nothing is changed
  silently; every override is echoed in the report together with the SHA-256 (JCS) of the
  effective criteria set.
* Status per criterion: PASS / FAIL / NOT EVALUATED. NOT EVALUATED when the criterion is
  disabled, the limit (or referenced material allowable) is empty, the quantity is not available,
  an override unit does not match, or a gate criterion (e.g. Hertz validity) did not PASS.
* Overall: FAIL if any FAIL; PASS only if there is at least one enabled criterion and all enabled
  criteria PASS; otherwise INCOMPLETE. Disabled criteria are not applicable.
* Comparison with safety factor S (None = 1):  "<=": allowable = limit / S,
  margin = (allowable - x) / allowable;  ">=": required = limit * S, margin = (x - required) /
  required;  "range": margin = min(x - min, max - x) / (max - min);  "true": predicate.
  Governing load case = the case with the smallest margin (any failing case governs).
* Hertz: the comparison of the 2-D line-contact peak pressure with a gear contact limit stress
  (ISO 6336-5 style allowable = limit stress number / S) is a modelling analogy, assumption
  A-AC1 (api.methods.ASSUMPTION_REGISTRY). Hertz validity ratio a/rho_eq = 2 p_max / E*
  (closed form from p_max = 2F/(pi a b) and p_max = sqrt(F E*/(pi b rho_eq))).
"""
from __future__ import annotations

import copy
import math

from .serialize import sha256

CRITERIA_SCHEMA_VERSION = 1
PROFILE_SET_VERSION = "2026-10-31"
STATEMENT = ("This report is a calculation result against the criteria profile named above. No limit value "
             "is supplied by the software; all limits shown were entered by the user (see overrides) or are "
             "internal model-validity checks. Final acceptance of the design rests with the user's certifying "
             "authority or customer; this report does not constitute certification or approval.")
NO_LIMIT = {"label": "no value shipped - enter from your authority / customer specification",
            "doc": None, "clause": None, "verified": False}
INTERNAL = {"label": "internal model-validity check (software)", "doc": None, "clause": None, "verified": True}
PASS, FAIL, NE = "PASS", "FAIL", "NOT EVALUATED"

# ---- material library (values EMPTY; user fills via overrides target="material") ----------------
_MSRC = {"label": "no value shipped - enter from datasheet / standard", "doc": None, "clause": None,
         "verified": False}
MATERIALS = {
    "steel-case-hardened": {"name": "Case-hardened wrought steel", "sigmaHlim": None, "yield": None, "unit": "MPa",
                            "condition": "", "basis": "gear-analogy (ISO 6336-5 limit stress number)",
                            "source": dict(_MSRC, doc="ISO 6336-5:2016 (not read; values to be obtained)")},
    "steel-through-hardened": {"name": "Through-hardened steel", "sigmaHlim": None, "yield": None, "unit": "MPa",
                               "condition": "", "basis": "gear-analogy (ISO 6336-5 limit stress number)",
                               "source": dict(_MSRC, doc="ISO 6336-5:2016 (not read; values to be obtained)")},
    "pm-sintered-steel": {"name": "PM / sintered steel (state density)", "sigmaHlim": None, "yield": None,
                          "unit": "MPa", "condition": "density, heat treatment", "basis": "supplier datasheet",
                          "source": dict(_MSRC, doc="MPIF Standard 35 or supplier datasheet (unverified)")},
    "aluminium-alloy": {"name": "Aluminium alloy", "sigmaHlim": None, "yield": None, "unit": "MPa",
                        "condition": "alloy, temper", "basis": "supplier datasheet", "source": dict(_MSRC)},
}
MATERIAL_FIELDS = ("sigmaHlim", "yield", "condition", "source")

# ---- quantities: key -> (title, unit, kind, description) -------------------------------------------
QUANTITIES = {
    "contact.hertzMax": ("Max Hertz contact pressure", "MPa", "case",
                         "operating[i].hertz (per load case) else contact.pmaxMax; 2-D line contact, A-D8a/b"),
    "contact.hertzValidity": ("Hertz validity ratio a/rho_eq", "-", "case",
                              "2 p_max / E* (contact.Es); Hertz assumes a << rho_eq"),
    "cavitation.speedRatio": ("Cavitation speed ratio n_limit / n", "-", "case",
                              "cavitation.gds.rpm (base design inlet head, A-D2/A-D4) / case rpm"),
    "ports.voidMax": ("Peak void fraction", "-", "case", "operating[i].voidMax else ports.voidMax"),
    "ports.inletVelocity": ("Inlet port velocity", "m/s", "case",
                            "Q_theo / (A_suction fillS), Q_theo = cc rpm (as ports.inletVelocity)"),
    "ports.outletVelocity": ("Outlet port velocity", "m/s", "case",
                             "Q_delivered / (A_delivery fillD), Q = operating[i].flowLpm else ports.flowLpm"),
    "efficiency.volumetric": ("Volumetric efficiency", "-", "case", "operating[i].etaV else friction.etaV"),
    "efficiency.mechanical": ("Mechanical efficiency", "-", "case", "operating[i].etaM else friction.etaM"),
    "ripple.kinematic": ("Kinematic flow ripple (peak-peak / mean)", "-", "design",
                         "geometry.ripple; kinematic prediction, not an ISO 10767-1 measurement"),
    "ripple.port": ("Delivered flow ripple (network model)", "-", "case", "operating[i].ripple else ports.ripple"),
    "backlash.tipToTipGap": ("Tip-to-tip gap", "mm", "design", "backlash.tipToTipGap"),
    "backlash.deltaMax": ("Max backlash angle", "rad", "design", "backlash.deltaMax"),
    "geometry.tipSpeed": ("Inner rotor tip speed", "m/s", "case",
                          "geometry.tipSpeed x case rpm / design rpm (v = omega r_innerTip)"),
    "geometry.outerWallRatio": ("Outer rotor wall / R", "-", "design", "(OD/2 - Rv) / R"),
    "geometry.innerWallRatio": ("Inner rotor wall / root radius", "-", "design",
                                "(innerRoot - bore/2) / innerRoot"),
    "ports.trappedVolumeSwing": ("Trapped-volume change", "-", "design",
                                 "not yet exported by gerotor_core.ports (always NOT EVALUATED)"),
    "ports.pressureOvershoot": ("Pressure overshoot (pMax - pD)/(pD - pS)", "-", "design",
                                "ports.sim (design point); denominator floored at 1e4 Pa (numerical guard)"),
    "geometry.valid": ("Geometry valid (analyse)", "-", "predicate", "results.valid"),
    "geometry.noUndercut": ("No undercut", "-", "predicate",
                            "rp + c < rhoMin (offset curve of the epitrochoid has no cusp; derivation)"),
    "geometry.tipSharpness": ("Tip sharpness (rp + c) / rhoMin", "-", "design", "geometry.rhoMin, design rp, c"),
}


def _c(cid, title, quantity, comparison, *, gate=None, limit=None, material=None, enabled=True, source=None):
    unit = QUANTITIES[quantity][1]
    return {"id": cid, "title": title, "quantity": quantity, "comparison": comparison, "unit": unit,
            "limit": limit if material is None else {"fromMaterial": material},
            "safetyFactor": None, "enabled": enabled, "gate": gate,
            "loadCases": "all" if QUANTITIES[quantity][2] == "case" else "n/a",
            "materialDependent": material is not None,
            "source": dict(source or (INTERNAL if comparison == "true" else NO_LIMIT))}


def _base_criteria():
    return [
        _c("C-GEOM-VALID", "Geometry valid", "geometry.valid", "true"),
        _c("C-GEOM-UNDERCUT", "No undercut", "geometry.noUndercut", "true"),
        _c("C-TIP-SHARP", "Tip sharpness (rp + c) / rhoMin", "geometry.tipSharpness", "<=",
           source=dict(NO_LIMIT, doc="former core warning 0.85 (no source) - value removed")),
        _c("C-HERTZ-VALID", "Hertz validity a/rho_eq", "contact.hertzValidity", "<="),
        _c("C-HERTZ", "Hertz contact pressure vs material allowable", "contact.hertzMax", "<=",
           gate="C-HERTZ-VALID", material="sigmaHlim",
           source=dict(NO_LIMIT, label="material allowable (gear-analogy, A-AC1) / S - enter values")),
        _c("C-CAV-HEAD", "Cavitation (available head) speed margin", "cavitation.speedRatio", ">="),
        _c("C-CAV-VOID", "Peak void fraction", "ports.voidMax", "<=",
           source=dict(NO_LIMIT, doc="former core warning 0.005 (no source) - value removed")),
        _c("C-PORT-V-IN", "Inlet port velocity", "ports.inletVelocity", "<=",
           source=dict(NO_LIMIT, doc="former core warning 2 m/s (no source) - value removed")),
        _c("C-PORT-V-OUT", "Outlet port velocity", "ports.outletVelocity", "<="),
        _c("C-ETA-V", "Volumetric efficiency", "efficiency.volumetric", ">=",
           source=dict(NO_LIMIT, doc="former core warning leakage > 10 % (no source) - value removed")),
        _c("C-ETA-M", "Mechanical efficiency", "efficiency.mechanical", ">="),
        _c("C-RIPPLE", "Kinematic flow ripple", "ripple.kinematic", "<="),
        _c("C-RIPPLE-PORT", "Delivered flow ripple", "ripple.port", "<="),
        _c("C-TIP-SPEED", "Inner rotor tip speed", "geometry.tipSpeed", "<=",
           source=dict(NO_LIMIT, doc="candidate: Gamez-Montero et al. (15 m/s quoted in code comment; clause "
                                     "not verified) - former core check, value removed")),
        _c("C-WALL-OUTER", "Outer rotor wall thickness ratio", "geometry.outerWallRatio", ">=",
           source=dict(NO_LIMIT, doc="former core warning 0.1 R (no source) - value removed")),
        _c("C-WALL-INNER", "Inner rotor wall thickness ratio", "geometry.innerWallRatio", ">=",
           source=dict(NO_LIMIT, doc="former core warning 0.15 innerRoot (no source) - value removed")),
        _c("C-TRAPPED", "Trapped-volume change", "ports.trappedVolumeSwing", "<=",
           source=dict(NO_LIMIT, doc="former core warning 2 % (no source) - value removed")),
        _c("C-P-OVERSHOOT", "Pressure overshoot", "ports.pressureOvershoot", "<=",
           source=dict(NO_LIMIT, doc="former core warning 0.2 (no source) - value removed")),
        _c("C-BACKLASH", "Tip-to-tip gap", "backlash.tipToTipGap", "range"),
    ]


def _profile(pid, name, description, basis, authority_note, criteria):
    return {"id": pid, "name": name, "description": description, "basis": basis, "version": PROFILE_SET_VERSION,
            "authorityNote": authority_note,
            "source": {"label": "software template - contains no authority limit values", "verified": False},
            "criteria": criteria}


def profiles() -> dict:
    iso = _base_criteria()
    for c in iso:
        if c["comparison"] != "true":
            c["source"] = dict(NO_LIMIT, label="no verified ISO limit value - enter from the document you apply")
    for c in iso:
        if c["id"] in ("C-ETA-V", "C-ETA-M"):
            c["source"]["doc"] = "ISO 4409 (presentation of measured efficiency; gives no limit)"
        if c["id"].startswith("C-RIPPLE"):
            c["source"]["doc"] = "ISO 10767-1 (measurement method; gives no limit)"
    cls = _base_criteria()
    for c in cls:
        if c["comparison"] != "true":
            c["source"] = dict(NO_LIMIT, label="class rule value - enter rule, edition and clause")
    return {p["id"]: p for p in (
        _profile("generic", "Generic engineering", "All criteria, no limit values. Not tied to any authority.",
                 "company-default", "Not tied to any authority.", _base_criteria()),
        _profile("iso-based", "ISO-based", "Same criteria; only internal checks are pre-set. No ISO document read "
                 "gives a numeric gerotor limit, so all limits are user entries.", "standard",
                 "Avoids implying ISO compliance.", iso),
        _profile("class-society", "Class society (marine)", "Shell for class rules; enter authority, rule "
                 "edition and every value.", "standard", "Enter society, rule document and edition.", cls),
        _profile("customer-defined", "Customer-defined", "Empty; add criteria (customCriteria) from the "
                 "customer specification.", "customer", "Enter customer specification reference.", []),
    )}


DEFAULT = {"schemaVersion": CRITERIA_SCHEMA_VERSION, "activeProfileId": "generic",
           "authority": {"name": None, "document": None, "edition": None},
           "materials": {"inner": None, "outer": None}, "overrides": [], "customCriteria": []}


def catalogue() -> dict:
    """Payload of GET /api/criteria/profiles."""
    return {"schemaVersion": CRITERIA_SCHEMA_VERSION, "profileSetVersion": PROFILE_SET_VERSION,
            "profiles": list(profiles().values()), "materials": [dict(v, id=k) for k, v in MATERIALS.items()],
            "quantities": [{"key": k, "title": t, "unit": u, "kind": kd, "from": d}
                           for k, (t, u, kd, d) in QUANTITIES.items()],
            "comparisons": ["<=", ">=", "range", "true"], "default": copy.deepcopy(DEFAULT),
            "overrideFields": {"criterion": ["limit", "safetyFactor", "enabled", "source"],
                               "material": list(MATERIAL_FIELDS)},
            "statement": STATEMENT}


# ---- effective set ------------------------------------------------------------------------------
def effective(ac: dict | None) -> dict:
    """Template + customCriteria + overrides -> effective criteria/materials (+ issues, hash)."""
    ac = dict(copy.deepcopy(DEFAULT), **copy.deepcopy(ac or {}))
    profs = profiles()
    issues = []
    pid = ac.get("activeProfileId") or "generic"
    if pid not in profs:
        issues.append(f"unknown profile '{pid}'")
    prof = profs.get(pid) or {"id": pid, "name": pid, "version": None, "basis": None, "criteria": []}
    crit = {c["id"]: c for c in prof["criteria"]}
    for c in ac.get("customCriteria") or []:
        q = QUANTITIES.get(c.get("quantity"))
        row = {"title": c.get("id"), "comparison": "<=", "unit": q[1] if q else c.get("unit"), "limit": None,
               "safetyFactor": None, "enabled": True, "gate": None, "materialDependent": False,
               "loadCases": ("all" if q and q[2] == "case" else "n/a"),
               "source": dict(NO_LIMIT, label="customer-defined")}
        row.update(copy.deepcopy(c))
        row["custom"] = True
        crit[row["id"]] = row
    mats = copy.deepcopy(MATERIALS)
    overridden = {}
    for i, o in enumerate(ac.get("overrides") or []):
        tgt, oid, field = o.get("target", "criterion"), o.get("id"), o.get("field")
        pool = crit if tgt == "criterion" else mats if tgt == "material" else None
        if pool is None or oid not in pool:
            issues.append(f"override #{i}: unknown {tgt} '{oid}'")
            continue
        row = pool[oid]
        if field not in (row if tgt == "material" else ("limit", "safetyFactor", "enabled", "source")):
            issues.append(f"override #{i}: field '{field}' cannot be overridden")
            continue
        unit = o.get("unit")
        want = row.get("unit")
        if field == "limit" and unit not in (None, want):
            row["unitMismatch"] = f"override unit '{unit}' != criterion unit '{want}'"
        elif field == "sigmaHlim" and unit not in (None, want):
            row["unitMismatch"] = f"override unit '{unit}' != material unit '{want}'"
        old = row.get(field)
        row[field] = copy.deepcopy(o.get("value"))
        overridden.setdefault((tgt, oid), []).append({"field": field, "oldValue": old, "newValue": o.get("value"),
                                                      "unit": unit, "reason": o.get("reason"), "user": o.get("user"),
                                                      "timestamp": o.get("timestamp")})
    for (tgt, oid), rows in overridden.items():
        (crit if tgt == "criterion" else mats)[oid]["overrides"] = rows
    sel = ac.get("materials") or {}
    eff = {"profileId": pid, "profileName": prof["name"], "profileVersion": prof.get("version"),
           "basis": prof.get("basis"), "authority": ac.get("authority"),
           "materials": {"inner": sel.get("inner"), "outer": sel.get("outer")},
           "materialLibrary": mats, "criteria": list(crit.values())}
    eff["hash"] = sha256(eff)
    eff["issues"] = issues
    return eff


# ---- quantity extraction --------------------------------------------------------------------------
def _num(x):
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) else None


def quantity_values(key: str, results: dict, design: dict | None = None) -> list[tuple[str, float | bool | None]]:
    """[(load case, value in QUANTITIES unit)] from calc.run output (raw or to_json'd)."""
    ops = results.get("operating") or []
    cases = [(r.get("name"), r) for r in ops] or [("design point", None)]
    geo, con, por, fr = (results.get(k) or {} for k in ("geometry", "contact", "ports", "friction"))
    d = design or results.get("design") or {}
    if key == "geometry.valid":
        return [("n/a", bool(results.get("valid")))]
    if key == "geometry.noUndercut":
        rm, rp, c = _num(geo.get("rhoMin")), _num(d.get("rp")), _num(d.get("c"))
        return [("n/a", (rp + c) < rm if None not in (rm, rp, c) else None)]
    if key == "geometry.tipSharpness":
        rm, rp, c = _num(geo.get("rhoMin")), _num(d.get("rp")), _num(d.get("c"))
        return [("n/a", (rp + c) / rm if None not in (rm, rp, c) and rm else None)]
    if key == "ripple.kinematic":
        return [("n/a", _num(geo.get("ripple")))]
    if key == "geometry.outerWallRatio":
        ok = all(_num(d.get(k)) for k in ("OD", "R")) and _num(d.get("Rv")) is not None
        return [("n/a", (d["OD"] / 2 - d["Rv"]) / d["R"] if ok else None)]
    if key == "geometry.innerWallRatio":
        ok = _num(d.get("innerRoot")) and _num(d.get("bore")) is not None
        return [("n/a", (d["innerRoot"] - d["bore"] / 2) / d["innerRoot"] if ok else None)]
    if key == "ports.trappedVolumeSwing":
        return [("n/a", None)]
    if key == "ports.pressureOvershoot":
        sim = por.get("sim") or {}
        pmax, pd_, ps = _num(por.get("pMaxBar")), _num(sim.get("pD")), _num(sim.get("pS"))
        return [("design point", (pmax * 1e5 - pd_) / max(pd_ - ps, 1e4)
                 if None not in (pmax, pd_, ps) else None)]
    if key.startswith("backlash."):
        return [("n/a", _num((results.get("backlash") or {}).get(key.split(".", 1)[1])))]
    out = []
    for name, r in cases:
        r = r or {}
        rpm = _num(r.get("rpm")) if r else _num(d.get("rpm"))
        if key == "geometry.tipSpeed":
            ts, rd = _num(geo.get("tipSpeed")), _num(d.get("rpm"))
            v = ts if not r else (ts * rpm / rd if ts is not None and rd and rpm is not None else None)
        elif key == "contact.hertzMax":
            v = _num(r.get("hertz")) if r else _num(con.get("pmaxMax"))
            v = v * 1e-6 if v is not None else None
        elif key == "contact.hertzValidity":
            pm, es = (_num(r.get("hertz")) if r else _num(con.get("pmaxMax"))), _num(con.get("Es"))
            v = 2 * pm / es if pm is not None and es else None
        elif key == "cavitation.speedRatio":
            lim = _num(((results.get("cavitation") or {}).get("gds") or {}).get("rpm"))
            v = lim / rpm if lim is not None and rpm else None
        elif key == "ports.voidMax":
            v = _num(r.get("voidMax")) if r else _num(por.get("voidMax"))
        elif key == "ports.inletVelocity":
            area, cc = _num((por.get("suction") or {}).get("area")), _num(geo.get("cc") or d.get("cc"))
            fill = d.get("fillS") or 1
            v = cc * rpm / 1000 * 1000 / (60 * area * fill) if area and cc and rpm is not None else (
                _num(por.get("inletVelocity")) if not r else None)
        elif key == "ports.outletVelocity":
            area, q = _num((por.get("delivery") or {}).get("area")), (_num(r.get("flowLpm")) if r
                                                                      else _num(por.get("flowLpm")))
            v = q * 1000 / (60 * area * (d.get("fillD") or 1)) if area and q is not None else None
        elif key == "efficiency.volumetric":
            v = _num(r.get("etaV")) if r else _num(fr.get("etaV"))
        elif key == "efficiency.mechanical":
            v = _num(r.get("etaM")) if r else _num(fr.get("etaM"))
        elif key == "ripple.port":
            v = _num(r.get("ripple")) if r else _num(por.get("ripple"))
        else:
            return []
        out.append((name, v))
    return out


# ---- core checks with unsourced thresholds (owner rule no-unexplained-numbers) -----------------------
NEUTRALIZED_CHECKS = {
    "High tip speed": "C-TIP-SPEED", "Tip speed": "C-TIP-SPEED",
    "Thin outer rotor wall": "C-WALL-OUTER", "Outer rotor wall": "C-WALL-OUTER",
    "Thin inner rotor wall": "C-WALL-INNER", "Inner rotor wall": "C-WALL-INNER",
    "Trapped volume change": "C-TRAPPED", "Sharp inner rotor tips": "C-TIP-SHARP",
    "High inlet port velocity": "C-PORT-V-IN", "Inlet port velocity": "C-PORT-V-IN",
    "Volumetric efficiency": "C-ETA-V",
    "Pressure overshoot": "C-P-OVERSHOOT", "Pressure peaks": "C-P-OVERSHOOT",
    "Cavitation / incomplete filling": "C-CAV-VOID", "Brief cavitation at port edges": "C-CAV-VOID",
    "No cavitation": "C-CAV-VOID",
}


def neutralize_checks(checks):
    """Replace core verdicts that rest on unsourced thresholds by level "info" NOT EVALUATED rows
    pointing at the criterion that now owns the limit (core kept unchanged for JS parity)."""
    out = []
    for c in checks or []:
        cid = NEUTRALIZED_CHECKS.get(c.get("title"))
        if cid is None:
            out.append(c)
            continue
        if c.get("title") == "Sharp inner rotor tips":  # rp + c < rhoMin still holds (no undercut)
            out.append({"level": "ok", "title": "No undercut", "detail": ""})
        out.append({"level": "info", "title": f"{c['title']} - NOT EVALUATED", "criterion": cid,
                    "coreLevel": c.get("level"),
                    "detail": f"threshold had no documented source; evaluate with acceptance criterion {cid}"})
    return out


# ---- evaluation ------------------------------------------------------------------------------------
def _limit_of(c, mats, sel):
    lim = c.get("limit")
    if isinstance(lim, dict) and "fromMaterial" in lim:
        field = lim["fromMaterial"]
        ids = [m for m in (sel.get("inner"), sel.get("outer")) if m]
        if not ids:
            return None, "no material selected (settings.acceptanceCriteria.materials)"
        vals = []
        for m in ids:
            row = mats.get(m)
            if row is None:
                return None, f"unknown material '{m}'"
            if row.get("unitMismatch"):
                return None, row["unitMismatch"]
            if _num(row.get(field)) is None:
                return None, f"material '{m}' {field} is empty"
            vals.append(float(row[field]))
        return min(vals), f"min {field} of {', '.join(ids)}"
    return lim, None


def _check(comp, x, lim, sf):
    """(passed, margin, allowable) or raise ValueError for an unusable limit."""
    s = 1.0 if sf is None else float(sf)
    if s <= 0:
        raise ValueError("safety factor must be > 0")
    if comp == "true":
        return bool(x) is True, None, True
    if comp == "range":
        lo, hi = (_num((lim or {}).get("min")), _num((lim or {}).get("max"))) if isinstance(lim, dict) else (None, None)
        if lo is None or hi is None or hi <= lo:
            raise ValueError("range limit needs {min, max} with max > min")
        return lo <= x <= hi, min(x - lo, hi - x) / (hi - lo), {"min": lo, "max": hi}
    lim = _num(lim)
    if lim is None:
        raise ValueError("limit is not a number")
    if comp == "<=":
        a = lim / s
        return x <= a, ((a - x) / a if a else None), a
    if comp == ">=":
        a = lim * s
        return x >= a, ((x - a) / a if a else None), a
    raise ValueError(f"unknown comparison '{comp}'")


def evaluate(ac: dict | None, results: dict, design: dict | None = None) -> dict:
    """Evaluate the effective criteria against calc results. Deterministic."""
    eff = effective(ac)
    mats, sel = eff["materialLibrary"], eff["materials"]
    rows, status = [], {}
    order = sorted(eff["criteria"], key=lambda c: 1 if c.get("gate") else 0)  # gates first
    for c in order:
        q = QUANTITIES.get(c.get("quantity"))
        row = {"id": c["id"], "title": c.get("title"), "quantity": c.get("quantity"),
               "quantityTitle": q[0] if q else None, "unit": c.get("unit"), "comparison": c.get("comparison"),
               "limit": c.get("limit"), "safetyFactor": c.get("safetyFactor"), "allowable": None,
               "value": None, "margin": None, "marginPct": None, "governingCase": None, "cases": [],
               "status": NE, "reason": None, "source": c.get("source"), "enabled": bool(c.get("enabled", True)),
               "gate": c.get("gate"), "overridden": bool(c.get("overrides")), "overrides": c.get("overrides", []),
               "materialDependent": bool(c.get("materialDependent")), "custom": bool(c.get("custom"))}
        rows.append(row)

        def ne(why):
            row["reason"] = why
            status[c["id"]] = NE
        if not row["enabled"]:
            ne("disabled"); continue
        if q is None:
            ne(f"unknown quantity '{c.get('quantity')}'"); continue
        if c.get("unitMismatch"):
            ne(c["unitMismatch"]); continue
        if c.get("gate") and status.get(c["gate"]) != PASS:
            ne(f"gate {c['gate']} is {status.get(c['gate'], NE)}"); continue
        lim, note = (True, None) if c.get("comparison") == "true" else _limit_of(c, mats, sel)
        if lim is None:
            ne(note or "no limit entered"); continue
        vals = quantity_values(c["quantity"], results, design)
        good = [(n, x) for n, x in vals if x is not None]
        if not good:
            ne("quantity not available in results"); continue
        try:
            checks = [(n, x) + _check(c["comparison"], x, lim, c.get("safetyFactor")) for n, x in good]
        except ValueError as exc:
            ne(str(exc)); continue
        row["cases"] = [{"case": n, "value": x, "status": PASS if ok else FAIL, "margin": m}
                        for n, x, ok, m, _a in checks]
        gov = min(checks, key=lambda t: (t[2], t[3] if t[3] is not None else math.inf))
        row.update(value=gov[1], governingCase=gov[0], allowable=gov[4], margin=gov[3],
                   marginPct=None if gov[3] is None else 100 * gov[3], limitNote=note)
        missing = [n for n, x in vals if x is None]
        if missing and gov[2]:
            ne(f"quantity missing for case(s) {', '.join(map(str, missing))}"); continue
        status[c["id"]] = row["status"] = PASS if gov[2] else FAIL
    rows.sort(key=lambda r: [c["id"] for c in eff["criteria"]].index(r["id"]))
    enabled = [r for r in rows if r["enabled"]]
    counts = {k: sum(r["status"] == k for r in enabled) for k in (PASS, FAIL, NE)}
    counts["disabled"] = len(rows) - len(enabled)
    overall = FAIL if counts[FAIL] else PASS if enabled and counts[PASS] == len(enabled) else "INCOMPLETE"
    over = []
    for c in eff["criteria"]:
        over += [dict(o, target="criterion", id=c["id"]) for o in c.get("overrides", [])]
    for mid, m in mats.items():
        over += [dict(o, target="material", id=mid) for o in m.get("overrides", [])]
    return {"evaluated": True, "schemaVersion": CRITERIA_SCHEMA_VERSION, "profileId": eff["profileId"],
            "profileName": eff["profileName"], "profileVersion": eff["profileVersion"], "basis": eff["basis"],
            "authority": eff["authority"], "materials": eff["materials"],
            "materialLibrary": [dict(v, id=k) for k, v in mats.items() if k in (sel.get("inner"), sel.get("outer"))],
            "criteriaHash": eff["hash"], "overall": overall, "counts": counts, "criteria": rows,
            "overrides": over, "issues": eff["issues"], "assumptions": ["A-AC1"], "statement": STATEMENT}
