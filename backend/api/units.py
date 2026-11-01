"""Unit conversion for ``{"value": x, "unit": "..."}`` design inputs.

Each design key has a fixed target unit (``x-unit`` in schema/project.schema.json). A plain
number is taken as already in that unit. A ``{value, unit}`` object is converted to the target
unit; an unknown unit, a unit of the wrong dimension, or a unit on a key without a defined unit
raises ``UnitError`` (HTTP 422 ``InvalidUnit``).

Supported: length mm, m, um (also µm, cm); pressure bar, Pa, kPa, MPa (bar(a) = absolute bar,
same factor); speed rpm (also 1/min); kinematic viscosity cSt, mm2/s, mm^2/s, m2/s; temperature
degC, K; density kg/m3, kg/m^3; thermal expansion 1/K (= 1/degC); dimensionless "-" / "".
"""
from __future__ import annotations

# unit -> (dimension, factor to SI base, offset to SI base)  SI = factor * x + offset
UNITS = {
    "mm": ("length", 1e-3, 0.0), "m": ("length", 1.0, 0.0), "um": ("length", 1e-6, 0.0),
    "µm": ("length", 1e-6, 0.0), "cm": ("length", 1e-2, 0.0),
    "bar": ("pressure", 1e5, 0.0), "bar(a)": ("pressure", 1e5, 0.0), "Pa": ("pressure", 1.0, 0.0),
    "kPa": ("pressure", 1e3, 0.0), "MPa": ("pressure", 1e6, 0.0), "GPa": ("pressure", 1e9, 0.0),
    "rpm": ("speed", 1.0, 0.0), "1/min": ("speed", 1.0, 0.0),
    "cSt": ("kinvisc", 1e-6, 0.0), "mm2/s": ("kinvisc", 1e-6, 0.0), "mm^2/s": ("kinvisc", 1e-6, 0.0),
    "m2/s": ("kinvisc", 1.0, 0.0), "m^2/s": ("kinvisc", 1.0, 0.0),
    "degC": ("temperature", 1.0, 273.15), "K": ("temperature", 1.0, 0.0),
    "kg/m^3": ("density", 1.0, 0.0), "kg/m3": ("density", 1.0, 0.0),
    "1/K": ("thermexp", 1.0, 0.0), "1/degC": ("thermexp", 1.0, 0.0),
    "-": ("none", 1.0, 0.0), "": ("none", 1.0, 0.0),
}


class UnitError(ValueError):
    pass


def convert(value: float, unit: str, target: str) -> float:
    """Convert ``value`` [unit] to [target]; UnitError on unknown unit or dimension mismatch."""
    if unit not in UNITS:
        raise UnitError(f"unknown unit '{unit}' (supported: {', '.join(sorted(u for u in UNITS if u))})")
    if target not in UNITS:
        raise UnitError(f"no conversion defined to target unit '{target}'")
    d1, f1, o1 = UNITS[unit]
    d2, f2, o2 = UNITS[target]
    if d1 != d2:
        raise UnitError(f"unit '{unit}' ({d1}) is not compatible with '{target}' ({d2})")
    if unit == target:
        return value
    return (f1 * value + o1 - o2) / f2


def to_plain(inputs: dict, targets: dict, where: str = "design") -> dict:
    """Replace {value, unit} objects by numbers in the target unit of each key."""
    out = {}
    for k, v in inputs.items():
        if isinstance(v, dict) and "value" in v:
            val, unit = v["value"], v.get("unit")
            if unit is None:
                out[k] = val
                continue
            if not isinstance(unit, str):
                raise UnitError(f"{where}.{k}: unit must be a string")
            if k not in targets:
                raise UnitError(f"{where}.{k}: key has no defined unit, cannot convert '{unit}'")
            if not isinstance(val, (int, float)) or isinstance(val, bool):
                raise UnitError(f"{where}.{k}: value must be a number")
            try:
                c = convert(float(val), unit, targets[k])
            except UnitError as exc:
                raise UnitError(f"{where}.{k}: {exc}") from None
            out[k] = int(round(c)) if isinstance(val, int) and unit == targets[k] else c
        else:
            out[k] = v
    return out
