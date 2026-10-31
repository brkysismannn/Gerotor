"""Parse the Eagle orbit-motor performance grids from the pypdf text dump.

Usage (from anywhere):
    python -I parse_eagle_grids.py [--write] [--check]

  --check   compare parser output with the hand-transcribed rows already in
            performance_points.csv (numeric fields) and print differences
  --write   append parsed points that are not yet in the CSV (existing rows are
            never modified) and write the skip log next to the CSV

Layout per grid: title line "<model> - X in3/rev (Y cm3/rev)", a "Pressure PSI (bar)"
header, then for each flow a flow line "gpm (L/min)", a Torque row and a Speed row.
Values map left to right onto the pressure header. A row may be shorter than the
header (not rated at higher pressures) but torque and speed counts must be equal and
never exceed the header; otherwise that flow row (or the whole grid) is SKIPPED and
logged. Alignment is never guessed.
"""
import csv
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))  # projects/Gerotor
SRC = os.path.join(ROOT, "References", "Test Products", ".text", "Eagle-Hydraulic-Motors.pdf.txt")
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "docs", "validation-products"))
CSV_PATH = os.path.join(OUT_DIR, "performance_points.csv")
LOG_PATH = os.path.join(OUT_DIR, "performance_points_skipped.log")
SRC_NAME = "Eagle-Hydraulic-Motors.pdf"
HAND_N = 209   # the first 209 data rows of performance_points.csv are the hand transcription (EBMP 36/50/80)
COLS = ["brand", "model", "displacement_cm3_rev", "flow_l_min", "pressure_drop_bar",
        "speed_rpm", "torque_Nm", "vol_eff_pct", "overall_eff_pct",
        "test_fluid_viscosity_temp", "source_file", "page", "notes"]

NUM = r"\d+(?:\.\d+)?"
PAIR = re.compile(r"(" + NUM + r")\s*\(\s*(" + NUM + r")\s*(\)?)")
TITLE = re.compile(r"^\s*([A-Z][A-Za-z0-9.]*(?:[\s\-]+[A-Za-z0-9.\-/]+)*?)\s+-\s+(" + NUM + r")\s*in3/rev\s*\(\s*(" + NUM + r")\s*cm3/rev")
PAGE = re.compile(r"^=== page (\d+) ===")
FLOW_FULL = re.compile(r"^\s*(" + NUM + r")\s*\(\s*(" + NUM + r")\s*\)?\s*(Torque.*)?$")
FLOW_GPM = re.compile(r"^\s*(" + NUM + r")\s*$")
FLOW_LPM = re.compile(r"^\s*\(\s*(" + NUM + r")\s*\)?\s*$")
GPM_TO_LPM = 3.7854
LBFFT_TO_NM = 1.35582


def fmt(x):
    s = ("%s" % x)
    return s


def norm_model(name):
    return re.sub(r"\s+", " ", name.strip())


def tokens_torque(text):
    """Return list of (lbfft, Nm|None, unbalanced) or None if unparsable."""
    toks = []
    pos = 0
    out = []
    for m in re.finditer(r"(" + NUM + r")(?:\s*\(\s*(" + NUM + r")\s*(\)?))?", text):
        out.append((float(m.group(1)), m.group(1), m.group(2), m.group(3) == "" and m.group(2) is not None))
    return out


def parse(lines):
    grids = []      # dicts
    skipped = []    # (page, model, reason)
    page = 0
    cur = None
    pending_gpm = None
    pending_flow = None   # (gpm_txt, lpm_txt)
    pending_torque = None
    for i, raw in enumerate(lines):
        line = raw.rstrip("\n")
        m = PAGE.match(line)
        if m:
            page = int(m.group(1))
            continue
        m = TITLE.match(line)
        if m:
            cur = {"model": norm_model(m.group(1)), "disp": m.group(3), "disp_in3": m.group(2),
                   "page": page, "line": i + 1, "header": None, "rows": [], "bad": []}
            grids.append(cur)
            pending_gpm = pending_flow = pending_torque = None
            continue
        if cur is None:
            continue
        if re.match(r"^\s*Pressure\s+PSI\s*\(bar\)", line):
            prs = [(a, b, c) for a, b, c in PAIR.findall(line)]
            if cur["header"] is not None and len(prs) >= 2:
                skipped.append((page, cur["model"], "SKIP GRID: second pressure header at line %d without a new title (title not recognised); rows after it not parsed" % (i + 1)))
                cur = {"model": cur["model"] + " (unrecognised)", "disp": "0", "disp_in3": "0", "page": page, "line": i + 1, "header": None, "rows": [], "bad": ["unrecognised"]}
                grids.append(cur)
                pending_gpm = pending_flow = pending_torque = None
                continue
            if cur["header"] is None and len(prs) >= 2:
                cur["header"] = [(p[0], p[1]) for p in prs]
                cur["header_line"] = i + 1
            continue
        if cur["header"] is None:
            continue
        if "Speed Continuous" in line or line.lstrip().startswith("Geometric") or "DIMENSIONS" in line:
            cur = None   # specification table after the grid: not part of it
            pending_gpm = pending_flow = pending_torque = None
            continue
        # flow line (several layouts)
        if "Torque" not in line and "Speed" not in line:
            m = FLOW_FULL.match(line)
            if m:
                pending_flow = (m.group(1), m.group(2)); pending_gpm = None
                continue
            m = FLOW_GPM.match(line)
            if m:
                pending_gpm = m.group(1); continue
            m = FLOW_LPM.match(line)
            if m and pending_gpm is not None:
                pending_flow = (pending_gpm, m.group(1)); pending_gpm = None
                continue
        m = FLOW_FULL.match(line)
        if m and m.group(3):
            pending_flow = (m.group(1), m.group(2))
            line = m.group(3)
        if "Torque" in line:
            if pending_flow is None:
                cur["bad"].append((i + 1, "torque row without a recognised flow line"))
                pending_torque = None
                continue
            body = line.split("(N", 1)[-1]
            body = body.split("•m)", 1)[-1] if "•m)" in body else body
            body = line[line.index("Torque"):]
            body = re.sub(r"^Torque\s+lbf\S*\s*\(N\S*\)", "", body)
            pending_torque = tokens_torque(body)
            pending_torque_line = i + 1
            continue
        if "Speed" in line and "(rpm)" in line:
            body = line.split("(rpm)", 1)[1]
            speeds = re.findall(NUM, body)
            if pending_flow is None or pending_torque is None:
                if pending_torque is not None:
                    cur["bad"].append((i + 1, "speed row without a recognised flow line (torque row dropped)"))
            else:
                cur["rows"].append({"flow": pending_flow, "torque": pending_torque,
                                    "speed": speeds, "line": pending_torque_line,
                                    "label": ("Max. Int." if "Int" in line.split("Speed")[0] else "")})
            pending_flow = pending_torque = None
    return grids, skipped


def build(grids, skipped):
    points = []
    for g in grids:
        hdr = g["header"]
        where = "p%s %s (line %s)" % (g["page"], g["model"], g["line"])
        if hdr is None:
            skipped.append((g["page"], g["model"], "no pressure header found"))
            continue
        if not g["rows"]:
            skipped.append((g["page"], g["model"], "no flow/torque/speed rows parsed"))
            continue
        disp = float(g["disp"])
        if any(len(r["torque"]) > len(hdr) or len(r["speed"]) > len(hdr) for r in g["rows"]):
            skipped.append((g["page"], g["model"],
                            "SKIP GRID: a row has more values than the %d header pressures" % len(hdr)))
            continue
        for lineno, why in g["bad"]:
            skipped.append((g["page"], g["model"], "SKIP ROW at source line %d: %s" % (lineno, why)))
        # Rows shorter than the header are accepted only when the left-aligned
        # (trailing pressures missing) reading is physically plausible AND fits the
        # other rows of the same grid at least as well as the right-aligned one.
        import statistics

        def ref_col(k, me):
            vals = [float(o["torque"][k][2]) for o in g["rows"]
                    if o is not me and len(o["torque"]) > k and len(o["torque"]) == len(o["speed"])
                    and all(t[2] is not None for t in o["torque"])]
            return statistics.median(vals) if len(vals) >= 3 else None

        for r in g["rows"]:
            gpm, lpm = r["flow"]
            nt, ns = len(r["torque"]), len(r["speed"])
            if nt != ns:
                skipped.append((g["page"], g["model"], "SKIP FLOW %s lpm: torque count %d != speed count %d" % (lpm, nt, ns)))
                continue
            if any(t[2] is None for t in r["torque"]):
                skipped.append((g["page"], g["model"], "SKIP FLOW %s lpm: torque value without N.m figure" % lpm))
                continue
            unverified = False
            if 0 < nt < len(hdr):
                sh = len(hdr) - nt
                dev_t, dev_l, ok = 0.0, 0.0, True
                for k in range(nt):
                    tq = float(r["torque"][k][2])
                    rt, rl = ref_col(k, r), ref_col(k + sh, r)
                    if rt is None or rl is None:
                        ok = False; break
                    dev_t = max(dev_t, abs(tq / rt - 1.0))
                    dev_l = max(dev_l, abs(tq / rl - 1.0))
                bad_phys = False
                for k in range(nt):
                    th = float(hdr[k][1]) * disp / 62.832
                    if float(r["torque"][k][2]) > 1.12 * th or float(r["speed"][k]) > 1.05 * float(lpm) * 1000.0 / disp \
                            or (k > 0 and float(r["speed"][k]) > float(r["speed"][k - 1])):
                        bad_phys = True
                if bad_phys:
                    skipped.append((g["page"], g["model"], "SKIP FLOW %s lpm: %d of %d values; left-aligned reading is physically implausible (torque/speed bound), alignment ambiguous" % (lpm, nt, len(hdr))))
                    continue
                if not ok:
                    unverified = True
                elif dev_l < dev_t and dev_t > 0.15:
                    skipped.append((g["page"], g["model"], "SKIP FLOW %s lpm: %d of %d values; right-aligned reading fits the grid better (dev %.0f%% vs %.0f%%), alignment ambiguous" % (lpm, nt, len(hdr), dev_l * 100, dev_t * 100)))
                    continue
            for k in range(nt):
                psi, bar = hdr[k]
                lbf, _, nm, unb = r["torque"][k]
                nm_f = float(nm)
                flags = ["printed: flow %s gpm; pressure %s psi; torque %s lbf-ft" % (gpm, psi, r["torque"][k][1])]
                lp = float(lpm)
                if abs(float(gpm) * GPM_TO_LPM - lp) > 0.1 * lp + 0.6:
                    flags.append("flow heading %s (%s) inconsistent between gpm and l/min; l/min value used" % (gpm, lpm))
                if abs(lbf * LBFFT_TO_NM - nm_f) > 0.03 * nm_f + 1.0:
                    flags.append("torque %s lbf-ft = %.0f Nm but %s Nm printed; Nm value kept as printed" % (r["torque"][k][1], lbf * LBFFT_TO_NM, nm))
                if unb:
                    flags.append("closing parenthesis missing in source after %s" % nm)
                th = float(bar) * disp / 62.832
                if nm_f > 1.05 * th:
                    flags.append("check: torque above theoretical %.0f Nm" % th)
                spd = float(r["speed"][k])
                if spd > 1.05 * lp * 1000.0 / disp:
                    flags.append("check: speed above flow/displacement")
                if k > 0 and spd > float(r["speed"][k - 1]):
                    flags.append("check: speed rises with pressure (source value kept)")
                if unverified:
                    flags.append("short row left-aligned (trailing pressures not rated) - no reference rows to verify")
                if r["label"]:
                    flags.append("row labelled Max. Int. Speed")
                points.append({
                    "brand": "Eagle Hydraulics", "model": g["model"],
                    "displacement_cm3_rev": g["disp"], "flow_l_min": lpm,
                    "pressure_drop_bar": bar, "speed_rpm": r["speed"][k],
                    "torque_Nm": nm, "vol_eff_pct": "", "overall_eff_pct": "",
                    "test_fluid_viscosity_temp": "not stated", "source_file": SRC_NAME,
                    "page": str(g["page"]),
                    "notes": "; ".join(flags).replace(",", " ")})
    return points


def key(p):
    return (p["model"], float(p["flow_l_min"]), float(p["pressure_drop_bar"]), p["page"])


def read_csv():
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def main():
    args = sys.argv[1:]
    with open(SRC, encoding="utf-8", errors="replace") as f:
        lines = f.read().split("\n")
    grids, skipped = parse(lines)
    points = build(grids, skipped)
    existing = read_csv()[:HAND_N]
    ex = {}
    for r in existing:
        ex[key(r)] = r
    pk = {key(p): p for p in points}

    n_hand = len(existing)
    missing = [k for k in ex if k not in pk]
    diffs = []
    for k, r in ex.items():
        if k in pk:
            for c in ("displacement_cm3_rev", "speed_rpm", "torque_Nm"):
                if float(r[c]) != float(pk[k][c]):
                    diffs.append((k, c, r[c], pk[k][c]))
    print("grids found: %d; points parsed: %d; skip log entries: %d" % (len(grids), len(points), len(skipped)))
    print("hand rows: %d; reproduced exactly: %d; not reproduced: %d; value differences: %d" % (
        n_hand, n_hand - len(missing) - len({d[0] for d in diffs}), len(missing), len(diffs)))
    for k in missing[:20]:
        print("  MISSING", k)
    for d in diffs[:20]:
        print("  DIFF", d)
    new = [p for p in points if key(p) not in ex]
    per = {}
    for p in points:
        per.setdefault(p["model"], [0, p["page"]])[0] += 1
    if "--check" in args:
        return 0 if not missing and not diffs else 1
    for s in skipped:
        print("  SKIPPED p%s %s: %s" % s)
    if "--write" in args:
        # idempotent: keep header + the hand rows, drop earlier parser output, re-append
        with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
            keep = f.read().split("\n")[:HAND_N + 1]
        with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
            f.write("\n".join(keep) + "\n")
        with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=COLS, lineterminator="\n")
            for p in new:
                w.writerow(p)
        with open(LOG_PATH, "w", encoding="utf-8") as f:
            for s in skipped:
                f.write("p%s\t%s\t%s\n" % s)
        print("appended %d new points" % len(new))
        for m, (n, pg) in per.items():
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
