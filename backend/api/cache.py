"""Bounded LRU cache of calc.run results.

Key = SHA-256 of the canonical JSON of {inputs, modules, code version}, where inputs are the
hashed project keys (design, operatingPoints, settings, measured; metadata/results excluded)
and code version = {api, gerotor_core, git}. Changing the code (version or commit) therefore
never returns stale results. Values are the raw calc.run dicts and are shared: callers must
not mutate them (to_json copies). Thread-safe (uvicorn runs sync endpoints in a thread pool).
"""
from __future__ import annotations

import collections
import threading

from . import calc
from .serialize import sha256

MAXSIZE = 32
_LOCK = threading.Lock()
_DATA: "collections.OrderedDict[str, dict]" = collections.OrderedDict()
stats = {"hits": 0, "misses": 0}


def code_version() -> dict:
    from .report import software  # late import (report imports cache)
    sw = software()
    return {k: sw[k] for k in ("api", "gerotor_core", "git")}


def key(body: dict, modules) -> str:
    if isinstance(body, dict) and "design" in body:
        inputs = {k: body.get(k) for k in ("design", "operatingPoints", "settings", "measured")
                  if body.get(k) not in (None, [], {})}
    else:
        inputs = {"bare": body}
    return sha256({"inputs": inputs, "modules": list(modules) if modules else None, "code": code_version()})


def cached_run(body: dict, modules=None) -> dict:
    k = key(body, modules)
    with _LOCK:
        if k in _DATA:
            _DATA.move_to_end(k)
            stats["hits"] += 1
            return _DATA[k]
    out = calc.run(body, modules)  # exceptions are not cached
    with _LOCK:
        stats["misses"] += 1
        _DATA[k] = out
        _DATA.move_to_end(k)
        while len(_DATA) > MAXSIZE:
            _DATA.popitem(last=False)
    return out


def clear():
    with _LOCK:
        _DATA.clear()
        stats.update(hits=0, misses=0)


def info() -> dict:
    with _LOCK:
        return {"size": len(_DATA), "maxsize": MAXSIZE, **stats}
