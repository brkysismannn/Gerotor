"""Project file (schema "gerotor-project/N"): validation, migration and input hash.

Migration hook: ``MIGRATIONS[n]`` converts a version-n document to version n+1. ``migrate``
applies them in sequence up to ``CURRENT``. Version 0 = legacy un-versioned files (a bare
design dict, as saved by the old browser tool) and is wrapped into a version-1 project.
"""
from __future__ import annotations

import copy
import json
import pathlib

import jsonschema

from .serialize import sha256

SCHEMA_DIR = pathlib.Path(__file__).resolve().parents[1] / "schema"
CURRENT = 4
SCHEMA_ID = f"gerotor-project/{CURRENT}"
_SCHEMA = json.loads((SCHEMA_DIR / "project.schema.json").read_text(encoding="utf-8"))
_VALIDATOR = jsonschema.Draft202012Validator(_SCHEMA)

HASHED_KEYS = ("design", "fluid", "operatingPoints", "settings", "measured")
FLUID_KEYS = ("oil", "oilT", "nu", "rho", "bulk", "pVap")
DERIVED_DESIGN_KEYS = ("faceSupport", "doubleFill")


class ProjectError(ValueError):
    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__("; ".join(self.errors))


def version_of(doc) -> int:
    s = doc.get("schema") if isinstance(doc, dict) else None
    if isinstance(s, str) and s.startswith("gerotor-project/"):
        try:
            return int(s.split("/", 1)[1])
        except ValueError:
            pass
    return 0


def _v0_to_v1(doc: dict) -> dict:
    design = doc.get("design", doc) if isinstance(doc.get("design"), dict) else dict(doc)
    return {"schema": "gerotor-project/1",
            "metadata": {"projectName": str(doc.get("name") or "Imported design"),
                         "notes": "migrated from un-versioned design file"},
            "design": {k: v for k, v in design.items() if k not in ("name", "schema")},
            "operatingPoints": [], "settings": {}}


def _v1_to_v2(doc: dict) -> dict:
    """v1 -> v2: add metadata.scope, metadata.revisions[], metadata.signOff{author,checker,approver}.

    Existing v1 fields are kept. revision/author/modified seed the first revision row;
    author/checker/checked seed the sign-off block (dates as YYYY-MM-DD, empty if unknown).
    """
    doc = dict(doc, schema="gerotor-project/2")
    meta = dict(doc.get("metadata") or {})
    def day(x):
        return x[:10] if isinstance(x, str) and len(x) >= 10 else ""
    meta.setdefault("scope", "")
    if "revisions" not in meta:
        meta["revisions"] = ([{"rev": str(meta["revision"]), "date": day(meta.get("modified") or meta.get("created")),
                               "author": meta.get("author", ""), "description": "migrated from gerotor-project/1"}]
                             if meta.get("revision") else [])
    if "signOff" not in meta:
        meta["signOff"] = {"author": {"name": meta.get("author", ""), "date": day(meta.get("created"))},
                           "checker": {"name": meta.get("checker", ""), "date": day(meta.get("checked"))},
                           "approver": {"name": "", "date": ""}}
    doc["metadata"] = meta
    return doc


def _v2_to_v3(doc: dict) -> dict:
    """v2 -> v3: oil settings design.{oil, oilT, nu, rho, bulk, pVap} -> top-level "fluid" object;
    derived design.faceSupport / doubleFill removed and expressed by the declared porting inputs
    dblIn / dblOut / shadow (kept if present). Inverse of the core rule (geometry.derive):
        doubleFill -> dblIn = dblOut = true, shadow = false   (fill 2/2, balanced)
        balanced   -> dblIn = dblOut = false, shadow = true   (fill 1/1, balanced)
        otherwise  -> all false                                (fill 1/1, single)
    This reproduces fillS, fillD and faceSupport exactly. The input hash changes once (new
    payload layout and JCS canonicalisation); stored results become stale and must be recomputed.
    """
    doc = dict(doc, schema="gerotor-project/3")
    d = dict(doc.get("design") or {})
    fl = dict(doc.get("fluid") or {})
    for k in FLUID_KEYS + tuple(k for k in list(d) if k.startswith(("uT", "uNu")) or k == "uRho15"):
        if k in d:
            fl.setdefault(k, d.pop(k))
    fs, df = d.pop("faceSupport", None), d.pop("doubleFill", None)
    if not any(k in d for k in ("dblIn", "dblOut", "shadow")) and (fs is not None or df is not None):
        if df:
            d.update(dblIn=True, dblOut=True, shadow=False)
        else:
            d.update(dblIn=False, dblOut=False, shadow=fs == "balanced")
    doc["design"] = d
    if fl:
        doc["fluid"] = fl
    return doc


def _v3_to_v4(doc: dict) -> dict:
    """v3 -> v4: placeholder settings.acceptanceCriteria {authority, status, criteria[]} -> criteria
    model (api/criteria.py). authority string -> authority.name; old criteria rows -> customCriteria
    with profile "customer-defined" (their limits were user inputs; source text kept as label).
    Absent block stays absent (defaults apply). The input hash changes (settings are hashed).
    """
    doc = dict(doc, schema="gerotor-project/4")
    s = dict(doc.get("settings") or {})
    old = s.get("acceptanceCriteria")
    if isinstance(old, dict) and "schemaVersion" not in old:
        crit = []
        for c in old.get("criteria") or []:
            row = {k: c[k] for k in ("id", "quantity", "comparison", "limit", "unit") if k in c}
            row["source"] = {"label": str(c.get("source") or "migrated from gerotor-project/3"),
                             "doc": None, "clause": None, "verified": False}
            crit.append(row)
        s["acceptanceCriteria"] = {"schemaVersion": 1,
                                   "activeProfileId": "customer-defined" if crit else "generic",
                                   "authority": {"name": old.get("authority"), "document": None, "edition": None},
                                   "materials": {"inner": None, "outer": None}, "overrides": [],
                                   "customCriteria": crit}
        doc["settings"] = s
    return doc


MIGRATIONS = {0: _v0_to_v1, 1: _v1_to_v2, 2: _v2_to_v3, 3: _v3_to_v4}


def derived_porting(design: dict) -> dict:
    """faceSupport / doubleFill / fillS / fillD derived with the core rule (gerotor_core.geometry.derive)."""
    di, do, sh = bool(design.get("dblIn")), bool(design.get("dblOut")), bool(design.get("shadow"))
    return {"faceSupport": "balanced" if (do or sh) else "single", "doubleFill": di and do,
            "fillS": 2 if di else 1, "fillD": 2 if do else 1}


def design_units() -> dict:
    """design + fluid key -> x-unit from the schema (target unit for {value, unit} conversion)."""
    props = dict(_SCHEMA["properties"]["design"]["properties"], **_SCHEMA["properties"]["fluid"]["properties"])
    return {k: v["x-unit"] for k, v in props.items() if "x-unit" in v}


def migrate(doc: dict) -> dict:
    doc = copy.deepcopy(doc)
    v = version_of(doc)
    if v > CURRENT:
        raise ProjectError([f"project schema version {v} is newer than this software ({CURRENT})"])
    while v < CURRENT:
        doc = MIGRATIONS[v](doc)
        v += 1
    return doc


def validate(doc: dict) -> list[str]:
    """List of schema errors ('path: message'); empty if valid."""
    errs = sorted(_VALIDATOR.iter_errors(doc), key=lambda e: list(e.absolute_path))
    return [f"{'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message}" for e in errs]


def load(doc: dict) -> dict:
    """Migrate then validate; raises ProjectError."""
    doc = migrate(doc)
    errs = validate(doc)
    if errs:
        raise ProjectError(errs)
    return doc


def input_hash(doc: dict) -> str:
    """SHA-256 over the RFC 8785 (JCS) text of the calculation inputs (metadata/results excluded).

    Payload = {k: doc[k] for k in HASHED_KEYS if present and not null/empty}; values as stored
    ({value, unit} objects are hashed as written). Numbers follow ECMAScript formatting, so 3.0
    and 3 hash equal and 1e-5 is written "0.00001" - identical to the frontend (shared contract).
    """
    return sha256({k: doc.get(k) for k in HASHED_KEYS if doc.get(k) not in (None, [], {})})


def resolved_hash(resolved: dict) -> str:
    """SHA-256 (JCS) of calc.resolved_inputs: covers every value used by the calculation (converted
    units, applied settings defaults, structural switches, derived design, per-case fluid values,
    oil-library row). Reported as ``inputHash`` by /api/calc and the report; ``input_hash`` (the
    document hash shared with frontend/js/project.js) is reported as ``documentHash``."""
    return sha256({"resolved": resolved})


def results_stale(doc: dict) -> bool:
    r = doc.get("results")
    return not r or r.get("inputHash") != input_hash(doc)
