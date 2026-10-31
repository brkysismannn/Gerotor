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

# No default inputs (owner rule no-unexplained-numbers, audit C01/C02): every value the models use
# is a user input. Example inputs for tests live in tests/examples.py, labelled as examples.


def design(**kw):
    """Design dict from explicit inputs, then ``derive``. No defaults are filled in.

    OD is required (it feeds the wall check, periphery leakage and outer-rotor friction); the
    former fallback OD = 2 (R + 2e) + 20 mm was a JS test convention without a source.
    """
    from .errors import require_design
    require_design(kw, "design", ("N", "e", "R", "rp", "c", "b", "OD"))
    require_design(kw, "design (valley radius)", ("RvClear",) if kw.get("RvAuto") else ("Rv",))
    return derive(dict(kw))


__version__ = "0.2.0"  # 0.2.0: no silent default inputs
