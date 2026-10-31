"""Parser validation: reproduces the 209 hand-transcribed Eagle points exactly."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import parse_eagle_grids as P  # noqa: E402


def _points():
    lines = open(P.SRC, encoding="utf-8", errors="replace").read().split("\n")
    grids, skipped = P.parse(lines)
    return P.build(grids, skipped), skipped


def test_reproduces_hand_points():
    pts, _ = _points()
    pk = {P.key(p): p for p in pts}
    hand = P.read_csv()[:P.HAND_N]
    assert len(hand) == 209
    for r in hand:
        q = pk[P.key(r)]
        for c in ("displacement_cm3_rev", "speed_rpm", "torque_Nm"):
            assert float(r[c]) == float(q[c]), (P.key(r), c)


def test_every_point_has_source_and_page():
    pts, _ = _points()
    assert len(pts) > 5000
    assert all(p["source_file"] and p["page"] for p in pts)


def test_csv_is_rectangular():
    rows = P.read_csv()
    assert all(None not in r and len(r) == len(P.COLS) for r in rows)