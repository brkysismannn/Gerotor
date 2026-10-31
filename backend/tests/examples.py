"""EXAMPLE INPUTS for the test suite - not recommendations, not defaults of the software.

The backend has no default inputs (owner rule no-unexplained-numbers, audit C01-C03). Tests that
need a complete design use the values below. They are the inputs of the JS test suite
(frontend tests.js BASE), reproduced here so that the JS parity references stay comparable:

    fluid       rho 860 kg/m^3, bulk 1400 MPa, Cd 0.7, nu 30 cSt, pVap 0.2 bar(a), pIn 1 bar(a)
    clearances  axialClr 0.05, odClr 0.15, jbClr 0.04 mm (diametral), jbLen 0 mm
    friction    faceMu 0.08
    operating   rpm 1000, dp 10 bar
    geometry    c 0, RvClear 0.1, bore 0 mm; OD = 2 (R + 2e) + 20 mm (JS test rule)
    material    Ein = Eout 210 GPa, nuIn = nuOut 0.3 (the JS contact.js fallback values)

None of these has a literature source; they only define test designs.
"""
import gerotor_core

EXAMPLE_INPUTS = dict(
    c=0, RvAuto=True, RvClear=0.1, bore=0, rpm=1000, dp=10, portsOn=False,
    portRoAuto=True, portRiAuto=True, sucStart=0, sucEnd=0, delStart=0, delEnd=0,
    gSucStart=0, gSucEnd=0, gDelStart=0, gDelEnd=0, grooveW=1,
    doubleFill=False, pIn=1, pVap=0.2, rho=860, bulk=1400, Cd=0.7,
    nu=30, leakOn=False, axialClr=0.05, shaftVent=True,
    odClr=0.15, jbLen=0, jbClr=0.04, faceSupport="balanced", faceMu=0.08,
)
# Rotor material of the JS reference designs (contact.js fallback 210 GPa / 0.3, example only).
EXAMPLE_MATERIAL = dict(Ein=210, nuIn=0.3, Eout=210, nuOut=0.3)


def design(**kw):
    """Example design: EXAMPLE_INPUTS + EXAMPLE_MATERIAL + overrides; OD by the JS test rule."""
    p = dict(EXAMPLE_INPUTS, **EXAMPLE_MATERIAL)
    p.update(kw)
    if p.get("OD") is None:
        p["OD"] = 2 * (p["R"] + 2 * p["e"]) + 20
    return gerotor_core.design(**p)
