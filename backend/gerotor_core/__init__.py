"""gerotor_core - pure-Python (numpy) computation core of the Gerotor design tool.

Port of the browser modules in js/ that do not need OpenModelica. One module per domain:

    geometry  profiles, chambers, displacement, kinematic ripple, design checks
    backlash  clearance contact / backlash angle and gaps
    contact   contact force, Hertz stress, sliding velocity, shaft side load
    leakage   gap conductances, multi-chamber network, outlet ripple
    ports     port plate geometry, opening areas, single-chamber model, port analysis
    friction  viscous / Coulomb losses, efficiencies (Totaro et al. 2025)
    fluid     oil viscosity (ASTM D341) and density vs temperature
    spectrum  flow-ripple DFT
    reverse   parameters from measured diameters
    perfmap   operating points, performance map, filling-limited speed

Design dictionaries use the JS keys and units (mm, bar, rpm, cSt, GPa) so that results are
directly comparable with the browser tool; internal physics is SI (see module docstrings).
"""
from .errors import InvalidDesignError  # noqa: F401
from .geometry import analyse, derive, peak_gap_to_c, c_to_peak_gap, lambda_gamez, lambda_from_gamez  # noqa: F401
from .friction import radial_to_diametral, diametral_to_radial  # noqa: F401

DEFAULTS = dict(
    c=0, RvAuto=True, RvClear=0.1, bore=0, rpm=1000, dp=10, portsOn=False,
    portRoAuto=True, portRiAuto=True, sucStart=0, sucEnd=0, delStart=0, delEnd=0,
    gSucStart=0, gSucEnd=0, gDelStart=0, gDelEnd=0, grooveW=1,
    doubleFill=False, pIn=1, pVap=0.2, rho=860, bulk=1400, Cd=0.7,
    nu=30, leakOn=False, axialClr=0.05, shaftVent=True,
    odClr=0.15, jbLen=0, jbClr=0.04, faceSupport="balanced", faceMu=0.08,
)


def design(**kw):
    """Design dict = DEFAULTS (same as tests/tests.js BASE) + overrides, then ``derive``.

    OD defaults to 2 (R + 2e) + 20 mm as in the JS test suite.
    """
    p = dict(DEFAULTS, **kw)
    if p.get("OD") is None:
        p["OD"] = 2 * (p["R"] + 2 * p["e"]) + 20
    return derive(p)


__version__ = "0.1.0"
