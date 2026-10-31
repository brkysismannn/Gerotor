"""JSON-safe conversion of gerotor_core results (numpy -> lists, NaN/inf -> None) and hashing."""
from __future__ import annotations

import hashlib
import json
import math

import numpy as np


def to_json(x, arrays: bool = True):
    """Recursively convert to JSON types. ``arrays=False`` drops numpy arrays and long lists (> 64)."""
    if isinstance(x, dict):
        out = {}
        for k, v in x.items():
            if callable(v):
                continue
            if not arrays and _is_bulk(v):
                continue
            out[str(k)] = to_json(v, arrays)
        return out
    if isinstance(x, (list, tuple)):
        return [to_json(v, arrays) for v in x]
    if isinstance(x, np.ndarray):
        return to_json(x.tolist(), arrays)
    if isinstance(x, (np.bool_, bool)):
        return bool(x)
    if isinstance(x, (np.integer, int)):
        return int(x)
    if isinstance(x, (np.floating, float)):
        f = float(x)
        return f if math.isfinite(f) else None
    if x is None or isinstance(x, str):
        return x
    return str(x)


def _is_bulk(v) -> bool:
    return isinstance(v, np.ndarray) or (isinstance(v, (list, tuple)) and len(v) > 64)


def _jcs_number(x) -> str:
    """ECMAScript Number.prototype.toString of an IEEE double (RFC 8785 sec. 3.2.2.3).

    Python repr gives the same shortest round-trip digit string as ECMAScript; only the layout
    differs. With digits d (k of them) and decimal exponent n (value = 0.d x 10^n):
    k <= n <= 21 -> d + zeros; 0 < n <= 21 -> d[:n].d[n:]; -6 < n <= 0 -> 0.000d; else d[0].d[1:]e+-(n-1).
    """
    f = float(x)
    if not math.isfinite(f):
        raise ValueError("JCS: NaN/Infinity are not representable")
    if f == 0:
        return "0"
    sign = "-" if f < 0 else ""
    r = repr(abs(f))
    mant, _, exp = r.partition("e")
    ip, _, fp = mant.partition(".")
    digits = (ip + fp).lstrip("0")
    lead = len(ip + fp) - len((ip + fp).lstrip("0"))
    n = len(ip) - lead + (int(exp) if exp else 0)
    digits = digits.rstrip("0") or "0"
    k = len(digits)
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        out = digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return sign + out


def jcs(obj) -> str:
    """RFC 8785 JSON Canonicalization Scheme text of a JSON value.

    Keys sorted by UTF-16 code units, no whitespace, strings as ECMAScript JSON.stringify
    (non-ASCII literal, control characters escaped), numbers via ``_jcs_number`` (ints are
    treated as IEEE doubles, so 3 and 3.0 give "3"). Encode the result as UTF-8.
    """
    if obj is None:
        return "null"
    if obj is True:
        return "true"
    if obj is False:
        return "false"
    if isinstance(obj, (int, float)):
        return _jcs_number(obj)
    if isinstance(obj, str):
        return json.dumps(obj, ensure_ascii=False)
    if isinstance(obj, (list, tuple)):
        return "[" + ",".join(jcs(v) for v in obj) + "]"
    if isinstance(obj, dict):
        keys = sorted(obj, key=lambda k: str(k).encode("utf-16-be"))
        return "{" + ",".join(json.dumps(str(k), ensure_ascii=False) + ":" + jcs(obj[k]) for k in keys) + "}"
    raise TypeError(f"JCS: unsupported type {type(obj).__name__}")


def canonical(obj) -> str:
    """Canonical JSON text used for the input hash: RFC 8785 (JCS) of ``to_json(obj)``."""
    return jcs(to_json(obj))


def sha256(obj) -> str:
    """SHA-256 (hex) of the UTF-8 bytes of the JCS text."""
    return hashlib.sha256(canonical(obj).encode("utf-8")).hexdigest()
