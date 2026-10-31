# gerotor_core (Python computation core)

Pure-Python (numpy) port of the browser calculations in `../js/` that do not need OpenModelica.
Future backend core. Design dicts use the JS keys/units (mm, bar, rpm, cSt); physics inside is SI.

```python
from gerotor_core import design, analyse
p = design(N=7, e=3, R=30, rp=8, b=20, c=0.03, OD=80, bore=18, rpm=1500, dp=100, portsOn=True, leakOn=True)
r = analyse(p)            # r["cc"], r["ripple"], r["ports"]["portEfficiency"], r["contact"], r["mech"] ...
```

Modules: geometry, backlash, contact, leakage, ports, friction, fluid, spectrum, reverse, perfmap.

## Tests
    cd backend && python -m pytest -q

* `tests/test_js_parity.py` - every recorded output of the JS tool (4 designs, `tests/reference/*.json`)
  reproduced to relative 1e-9 (observed ~1e-13).
* `tests/test_physics.py` - literature/analytic checks mirrored from `../tests/tests.js`.

Regenerate references (runs the unmodified js/ in embedded V8, no Node needed):
    python tools/make_js_reference.py

Full inventory, simplifications and bug list: company/reports/2026-10-30-design-sim-engineer-python-core.md
