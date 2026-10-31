"""Structured calculation-report dataset (layout is done by the frontend).

Deterministic: for the same inputs and software the dataset is identical except ``generated``
(UTC timestamp). Bulk arrays (profiles, time series) are dropped; the frontend gets them from
/api/calc when it needs plots.
"""
from __future__ import annotations

import datetime as _dt
import functools
import inspect
import platform
import subprocess
import pathlib

import numpy as np

import gerotor_core

from . import cache, calc
from . import methods as _methods
from .methods import ASSUMPTION_REGISTRY, METHODS
from .project import input_hash
from .serialize import to_json

API_VERSION = "0.2.0"
REPORT_FORMAT = "gerotor-report/1"
_ROOT = pathlib.Path(__file__).resolve().parents[2]

# backward-compatible view: id -> (name, switch, statement); registry lives in api.methods
ASSUMPTIONS = {k: (a["name"], a["switch"], a["statement"]) for k, a in ASSUMPTION_REGISTRY.items()}

@functools.lru_cache(maxsize=1)
def git_hash() -> str:
    for cwd in (_ROOT, _ROOT.parent):
        try:
            r = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=cwd, capture_output=True,
                               text=True, timeout=5)
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            pass
    return "unknown"


def software() -> dict:
    return {"api": API_VERSION, "gerotor_core": gerotor_core.__version__, "git": git_hash(),
            "python": platform.python_version(), "numpy": np.__version__}


@functools.lru_cache(maxsize=1)
def methods() -> list[dict]:
    """Report 'methods' section from the explicit registry api.methods.METHODS."""
    rows = []
    for key, m in METHODS.items():
        mod = m["module"]
        doc = inspect.getdoc(mod) or ""
        rows.append({"id": key, "module": mod.__name__, "method": m["method"],
                     "summary": doc.splitlines()[0] if doc else "", "equations": list(m["equations"]),
                     "sources": [dict(x) for x in m["sources"]],
                     "references": [x["ref"] for x in m["sources"]],
                     "assumptions": list(m["assumptions"]), "description": doc,
                     "functions": {f: inspect.getdoc(getattr(mod, f)) or "" for f in m["functions"]}})
    return rows


def _checks(checks):
    out = {"errors": [], "warnings": [], "info": []}
    for c in checks or []:
        lvl = c.get("level")
        out["errors" if lvl == "err" else "warnings" if lvl == "warn" else "info"].append(to_json(c))
    return out


def build(body: dict, now: _dt.datetime | None = None) -> dict:
    """Report dataset for a project / calc request. Raises InvalidDesignError like calc.run."""
    inputs, s, v, ops, measured = calc.split_request(body)
    results = cache.cached_run(body, None)
    meta = body.get("metadata") or {}
    assumptions = to_json(_methods.assumptions(v, calc.VARIANT_DEFAULTS))
    hashed = {k: body.get(k) for k in ("design", "fluid", "operatingPoints", "settings", "measured")} if "design" in body \
        else {"design": inputs}
    res = {k: to_json(results[k], arrays=False) for k in calc.MODULES if k in results}
    for k in ("ports", "backlash"):
        if res.get(k):
            res[k].pop("sim", None)
    return {
        "format": REPORT_FORMAT,
        "generated": (now or _dt.datetime.now(_dt.timezone.utc)).isoformat(timespec="seconds"),
        "software": software(),
        "inputHash": input_hash(hashed),
        "metadata": to_json(meta),
        "inputs": {"design": to_json(inputs), "derivedDesign": to_json(results["design"], arrays=False),
                   "operatingPoints": to_json(ops), "settings": to_json(s), "measured": to_json(measured)},
        "results": res,
        "checks": _checks(results.get("checks")),
        "valid": results.get("valid"),
        "assumptions": assumptions,
        "methods": methods(),
        "acceptanceCriteria": dict(to_json(s.get("acceptanceCriteria")), evaluated=False,
                                   note="placeholder - criteria not evaluated (authority pending)"),
        "units": {"length": "mm", "pressure_inputs": "bar", "speed": "rpm", "viscosity": "cSt",
                  "results": "SI unless the key says otherwise (flowLpm, pMaxBar, cc in cm^3/rev)"},
    }
