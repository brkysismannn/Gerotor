"""Oil properties vs temperature (port of js/fluid.js).

Kinematic viscosity - ASTM D341 (Ubbelohde-Walther):
    log10(log10(nu + 0.7)) = A - B log10(T[K])     (nu in cSt, valid for nu >= 2 cSt)
Two points -> exact A, B; three or more -> least squares in Walther coordinates.
Density - linear thermal expansion rho(T) = rho15 (1 - 6.5e-4 (T - 15)).
Units: nu in cSt (mm^2/s), T in deg C, rho in kg/m^3. Use ``nu_si = nu * 1e-6`` for m^2/s.

Source status of the library (owner rule no-unexplained-numbers, company/memory/oil-library-sourcing):
every OILS row carries ``source[q]`` for q in nu40, nu100, rho15 with status
    "standard"   ISO VG nu40 = grade midpoint of ISO 3448 (clause not verified),
    "cited"      transcribed from a supplier datasheet in References/Oil-Datasheets/sources.md,
    "unsourced"  typical value without a source (all other values today).
A calculation that uses a row with an unsourced value is NOT FOR CERTIFICATION (api/calc.oil_check).
``load_sources`` reads sources.md (Markdown table: key | quantity | value | unit | file | page);
``apply_sources`` replaces the "unsourced" tag (and the value) by the cited datasheet value.
"""
from __future__ import annotations

import math
import pathlib

OILS = {
    "vg10": dict(group="Hydraulic (ISO VG)", label="ISO VG 10 (HLP 10)", nu40=10, nu100=2.6, rho15=850),
    "vg15": dict(group="Hydraulic (ISO VG)", label="ISO VG 15 (HLP 15)", nu40=15, nu100=3.5, rho15=860),
    "vg22": dict(group="Hydraulic (ISO VG)", label="ISO VG 22 (HLP 22)", nu40=22, nu100=4.3, rho15=865),
    "vg32": dict(group="Hydraulic (ISO VG)", label="ISO VG 32 (HLP 32)", nu40=32, nu100=5.4, rho15=870),
    "vg46": dict(group="Hydraulic (ISO VG)", label="ISO VG 46 (HLP 46)", nu40=46, nu100=6.8, rho15=875),
    "vg68": dict(group="Hydraulic (ISO VG)", label="ISO VG 68 (HLP 68)", nu40=68, nu100=8.7, rho15=880),
    "vg100": dict(group="Hydraulic (ISO VG)", label="ISO VG 100 (HLP 100)", nu40=100, nu100=11.1, rho15=885),
    "hvlp32": dict(group="Hydraulic (ISO VG)", label="HVLP 32, VI ≈ 164", nu40=32.7, nu100=6.63, rho15=847),
    "sae0w20": dict(group="Engine oil (SAE)", label="SAE 0W-20 (44 / 8.5 cSt)", nu40=44, nu100=8.5, rho15=845),
    "sae0w30": dict(group="Engine oil (SAE)", label="SAE 0W-30 (72 / 12 cSt)", nu40=72, nu100=12, rho15=850),
    "sae5w20": dict(group="Engine oil (SAE)", label="SAE 5W-20 (43 / 8 cSt)", nu40=43, nu100=8, rho15=850),
    "sae5w30": dict(group="Engine oil (SAE)", label="SAE 5W-30 (62 / 10 cSt)", nu40=62, nu100=10, rho15=855),
    "sae5w40": dict(group="Engine oil (SAE)", label="SAE 5W-40 (85 / 14 cSt)", nu40=85, nu100=14, rho15=855),
    "sae10w30": dict(group="Engine oil (SAE)", label="SAE 10W-30 (77 / 11 cSt)", nu40=77, nu100=11, rho15=865),
    "sae10w40": dict(group="Engine oil (SAE)", label="SAE 10W-40 (82 / 15 cSt)", nu40=82, nu100=15, rho15=865),
    "sae15w40": dict(group="Engine oil (SAE)", label="SAE 15W-40 (123 / 16 cSt)", nu40=123, nu100=16, rho15=875),
    "sae20w50": dict(group="Engine oil (SAE)", label="SAE 20W-50 (114 / 20 cSt)", nu40=114, nu100=20, rho15=880),
    "sae25w40": dict(group="Engine oil (SAE)", label="SAE 25W-40 (145 / 15 cSt)", nu40=145, nu100=15, rho15=880),
    "atf": dict(group="Other", label="ATF (Dexron type)", nu40=34, nu100=7.4, rho15=860),
    "mil23699": dict(group="Other", label="MIL-PRF-23699 turbine oil", nu40=25, nu100=5.0, rho15=1000),
    "mil5606": dict(group="Other", label="MIL-PRF-5606 aviation hydraulic", nu40=14, nu100=5.2, rho15=860),
}

QUANTITIES = ("nu40", "nu100", "rho15")
_UNIT_FACTOR = {"nu40": {"cst": 1.0, "mm2/s": 1.0, "mm^2/s": 1.0, "mm\u00b2/s": 1.0},
                "nu100": {"cst": 1.0, "mm2/s": 1.0, "mm^2/s": 1.0, "mm\u00b2/s": 1.0},
                "rho15": {"kg/m3": 1.0, "kg/m^3": 1.0, "kg/m\u00b3": 1.0, "g/cm3": 1000.0, "g/cm^3": 1000.0,
                          "g/cm\u00b3": 1000.0, "g/ml": 1000.0, "kg/l": 1000.0}}  # SI definitions


def _tag_library():
    for key, o in OILS.items():
        o["source"] = {q: {"status": "unsourced", "ref": None} for q in QUANTITIES}
        o["flags"] = []
        if o["group"] == "Hydraulic (ISO VG)" and key.startswith("vg"):
            o["source"]["nu40"] = {"status": "standard",
                                   "ref": "ISO 3448 viscosity grade: ISO VG %s = midpoint kinematic viscosity at "
                                          "40 C [cSt] (clause not verified)" % key[2:]}
    OILS["mil23699"]["flags"].append(
        "suspicious: rho15 = 1000 kg/m^3 for MIL-PRF-23699 is unverified (it equals the density of water); "
        "check against a product datasheet before use")


_tag_library()

_ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCES_MD = next((d / "References" / "Oil-Datasheets" / "sources.md" for d in (_ROOT.parent, _ROOT)
                   if (d / "References" / "Oil-Datasheets").is_dir()),
                  _ROOT.parent / "References" / "Oil-Datasheets" / "sources.md")


def load_sources(path=None) -> list[dict]:
    """Rows of the sources.md table (key, quantity, value, unit, file, page); [] if the file is absent.

    Header and separator rows are skipped; rows with a non-numeric value are returned with
    ``error`` so that a transcription mistake is visible instead of silently ignored."""
    path = pathlib.Path(path) if path is not None else SOURCES_MD
    if not path.is_file():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 6 or cells[0].lower() == "key" or set("".join(cells)) <= set("-: "):
            continue
        key, qty, val, unit, file, page = cells[:6]
        row = {"key": key, "quantity": qty, "unit": unit, "file": file, "page": page}
        try:
            row["value"] = float(val.replace(",", "."))
        except ValueError:
            row["error"] = f"value {val!r} is not a number"
        rows.append(row)
    return rows


def apply_sources(rows, oils=None) -> dict:
    """Replace "unsourced" tags (and values) of ``oils`` (default OILS) by the cited datasheet rows.

    Returns {"applied": [...], "ignored": [...]}; ignored = unknown key / quantity / unit or bad value."""
    oils = OILS if oils is None else oils
    applied, ignored = [], []
    for r in rows:
        o, q = oils.get(r.get("key")), r.get("quantity")
        f = _UNIT_FACTOR.get(q, {}).get((r.get("unit") or "").lower())
        if o is None or q not in QUANTITIES or f is None or "error" in r:
            ignored.append(dict(r, reason=r.get("error") or "unknown key, quantity or unit"))
            continue
        v = r["value"] * f
        prev = o[q]
        o[q] = v
        o["source"][q] = {"status": "cited", "ref": f"{r['file']}, p. {r['page']}", "file": r["file"],
                          "page": r["page"], "replacedValue": prev if prev != v else None}
        if q == "rho15":
            o["flags"] = [x for x in o["flags"] if "rho15" not in x]
        applied.append(r)
    return {"applied": applied, "ignored": ignored}


SOURCES_APPLIED = apply_sources(load_sources())


def oil_source_status(key) -> dict:
    """{key, label, unsourced[], standard[], cited[], flags[]} of an OILS row (None if unknown)."""
    o = OILS.get(key)
    if not o:
        return None
    by = {st: [q for q in QUANTITIES if o["source"][q]["status"] == st] for st in ("unsourced", "standard", "cited")}
    return {"key": key, "label": o["label"], **by, "flags": list(o["flags"]),
            "sources": {q: dict(o["source"][q]) for q in QUANTITIES}}


NU_MIN = 2.0  # lower validity limit of the 0.7 form [cSt]


def _Z(nu):
    return math.log10(math.log10(nu + 0.7))


def _X(tC):
    return math.log10(tC + 273.15)


def viscosity_from_fit(fit, tC):
    return 10 ** (10 ** (fit["A"] - fit["B"] * _X(tC))) - 0.7


def walther_fit_points(points):
    """Walther fit through [(tC, nu), ...]: exact for two, least squares for more. None if degenerate."""
    pts = [(t, nu) for t, nu in points
           if t is not None and math.isfinite(t) and nu is not None and nu > 0 and t > -273.15]
    if len(pts) < 2:
        return None
    n = len(pts)
    sx = sz = sxx = sxz = 0.0
    for t, nu in pts:
        x, z = _X(t), _Z(nu)
        sx += x; sz += z; sxx += x * x; sxz += x * z
    den = n * sxx - sx * sx
    if not (abs(den) > 1e-14):
        return None
    B = -(n * sxz - sx * sz) / den
    A = (sz + B * sx) / n
    ss = sum((viscosity_from_fit({"A": A, "B": B}, t) / nu - 1) ** 2 for t, nu in pts)
    return {"A": A, "B": B, "rms": math.sqrt(ss / n), "tMin": min(q[0] for q in pts),
            "tMax": max(q[0] for q in pts), "n": n}


def walther_fit(nu40, nu100):
    return walther_fit_points([(40, nu40), (100, nu100)])


def viscosity_at(nu40, nu100, tC):
    """Kinematic viscosity [cSt] at tC from the 40/100 deg C datasheet values."""
    return viscosity_from_fit(walther_fit(nu40, nu100), tC)


def density_at(rho15, tC):
    return rho15 * (1 - 6.5e-4 * (tC - 15))


def oil_properties(key, tC):
    o = OILS.get(key)
    if not o:
        return None
    return {"nu": viscosity_at(o["nu40"], o["nu100"], tC), "rho": density_at(o["rho15"], tC),
            "label": o["label"], "fit": walther_fit(o["nu40"], o["nu100"]),
            "source": {q: o["source"][q]["status"] for q in QUANTITIES}}


def user_oil(p, tC):
    """User oil from datasheet points uT1/uNu1, uT2/uNu2 (+ optional uT3/uNu3 if uNu3 > 0), uRho15."""
    pts = [(p.get("uT1"), p.get("uNu1")), (p.get("uT2"), p.get("uNu2"))]
    if (p.get("uNu3") or 0) > 0:
        pts.append((p.get("uT3"), p.get("uNu3")))
    fit = walther_fit_points(pts)
    if not fit:
        return {"error": "Enter viscosities at two different temperatures."}
    nu = viscosity_from_fit(fit, tC)
    notes = []
    if tC < fit["tMin"] - 1e-9 or tC > fit["tMax"] + 1e-9:
        notes.append(f"extrapolated outside the datasheet range {fit['tMin']}...{fit['tMax']} C")
    if nu < NU_MIN:
        notes.append(f"nu < {NU_MIN} cSt: outside the ASTM D341 (0.7) range")
    if fit["n"] > 2 and fit["rms"] > 0.05:
        notes.append(f"datasheet points deviate {100 * fit['rms']:.0f} % rms from one Walther line")
    if not (fit["B"] > 0):
        notes.append("viscosity does not fall with temperature - check the inputs")
    return {"nu": nu, "rho": density_at(p.get("uRho15"), tC), "fit": fit, "notes": notes, "points": pts}
