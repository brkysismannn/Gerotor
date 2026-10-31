"""Exceptions of gerotor_core.

``analyse`` never raises for a bad design: it returns ``res`` with ``valid=False`` and the
reasons in ``res['checks']`` (same as the JS tool). Functions that need the kinematic results
of a valid analysis (spectrum, backlash, contact, friction, ports, perfmap) raise
``InvalidDesignError`` instead of a bare KeyError / TypeError when those results are missing.
"""
from __future__ import annotations


class InvalidDesignError(ValueError):
    """Design cannot be evaluated. ``reason`` is a short text, ``checks`` the failing analysis checks."""

    def __init__(self, reason: str, checks=None):
        self.reason = reason
        self.checks = list(checks or [])
        errs = [c["title"] for c in self.checks if c.get("level") == "err"]
        super().__init__(reason + (f" (failed checks: {', '.join(errs)})" if errs else ""))


_DESIGN_KEYS = ("N", "e", "R", "rp", "c")


def require_design(p, where: str, keys=_DESIGN_KEYS) -> None:
    """Raise InvalidDesignError if p is not a dict or misses a required key."""
    if not isinstance(p, dict):
        raise InvalidDesignError(f"{where}: design must be a dict, got {type(p).__name__}")
    miss = [k for k in keys if p.get(k) is None]
    if miss:
        raise InvalidDesignError(f"{where}: design is missing {', '.join(miss)}")


def require_analysis(res, where: str, keys=("q", "M", "dt", "cc")) -> None:
    """Raise InvalidDesignError if res lacks the kinematic results (analysis aborted on an error check)."""
    if not isinstance(res, dict):
        raise InvalidDesignError(f"{where}: analysis result must be a dict, got {type(res).__name__}")
    miss = [k for k in keys if res.get(k) is None]
    if miss:
        raise InvalidDesignError(
            f"{where}: no kinematic results ({', '.join(miss)} missing) - the design is invalid",
            res.get("checks"))
