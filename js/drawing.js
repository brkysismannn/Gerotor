/*
 * Technical drawing as a vector PDF (no dependencies): A3 landscape sheet with border and title block,
 * front views of the outer and inner rotor and of the assembly, side views with the rotor width,
 * diameter dimensions, centre lines, a parameter table and notes. The profiles are the exact model
 * profiles (js/geometry.js) as fine polylines; the coordinate data are in the DXF / CSV exports.
 *
 * PDF: one page, uncompressed content stream, standard Helvetica (WinAnsiEncoding, no embedding).
 */
(function (G) {
  'use strict';

  const MM = 72 / 25.4;                       // pt per mm
  const SHEET = { w: 420, h: 297 };           // A3 landscape [mm]
  const SCALES = [10, 5, 4, 2.5, 2, 1, 1 / 2, 1 / 2.5, 1 / 4, 1 / 5, 1 / 10];
  const scaleLabel = s => s >= 1 ? `${+s.toFixed(2)}:1` : `1:${+(1 / s).toFixed(2)}`;
  const f2 = x => (Math.round(x * 1000) / 1000).toString();

  // ------------------------------------------------------------------ PDF page builder (mm units)

  function Page() {
    const ops = [];
    const n = v => (Math.round(v * MM * 100) / 100).toString();
    const api = {
      ops,
      width(w) { ops.push(`${(w * MM).toFixed(3)} w`); return api; },
      dash(on, off) { ops.push(on ? `[${n(on)} ${n(off)}] 0 d` : '[] 0 d'); return api; },
      gray(g) { ops.push(`${g} G ${g} g`); return api; },
      line(x1, y1, x2, y2) { ops.push(`${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`); return api; },
      poly(pts, closed, fill) {
        if (pts.length < 2) return api;
        ops.push(`${n(pts[0][0])} ${n(pts[0][1])} m` + pts.slice(1).map(q => ` ${n(q[0])} ${n(q[1])} l`).join('') + (closed ? ' h' : '') + (fill ? ' f' : ' S'));
        return api;
      },
      rect(x, y, w, h) { ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re S`); return api; },
      circle(cx, cy, r) {
        const k = 0.5522847498 * r, P = (x, y) => `${n(x)} ${n(y)}`;
        ops.push(`${P(cx + r, cy)} m ${P(cx + r, cy + k)} ${P(cx + k, cy + r)} ${P(cx, cy + r)} c ` +
          `${P(cx - k, cy + r)} ${P(cx - r, cy + k)} ${P(cx - r, cy)} c ${P(cx - r, cy - k)} ${P(cx - k, cy - r)} ${P(cx, cy - r)} c ` +
          `${P(cx + k, cy - r)} ${P(cx + r, cy - k)} ${P(cx + r, cy)} c S`);
        return api;
      },
      text(x, y, size, str, align, bold) {
        const w = textWidth(str, size);
        const dx = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
        ops.push(`BT /${bold ? 'F2' : 'F1'} ${(size * MM).toFixed(2)} Tf ${n(x + dx)} ${n(y)} Td (${pdfString(str)}) Tj ET`);
        return api;
      },
      arrow(x, y, ang, len) {                 // filled arrow head with its tip at (x, y), pointing along ang
        const a = 0.35, b = [Math.cos(ang), Math.sin(ang)];
        const p1 = [x - len * b[0] + len * a * b[1], y - len * b[1] - len * a * b[0]];
        const p2 = [x - len * b[0] - len * a * b[1], y - len * b[1] + len * a * b[0]];
        ops.push(`${n(x)} ${n(y)} m ${n(p1[0])} ${n(p1[1])} l ${n(p2[0])} ${n(p2[1])} l h f`);
        return api;
      },
    };
    return api;
  }

  // Approximate Helvetica advance widths (per 1 unit font size) for alignment.
  function textWidth(s, size) {
    let w = 0;
    for (const ch of s) w += /[il.,:;|!'Ø]/.test(ch) ? 0.28 : /[mwMW]/.test(ch) ? 0.83 : /[A-Z0-9]/.test(ch) ? 0.64 : /\s/.test(ch) ? 0.28 : 0.52;
    return w * size;
  }

  // WinAnsi string with PDF escapes (Ø ° ± µ · × are in WinAnsi; others replaced).
  function pdfString(s) {
    const map = { 'λ': 'lambda', 'η': 'eta', 'Δ': 'd', 'ν': 'nu', 'ρ': 'rho', '−': '-', '–': '-', '—': '-', '…': '...', '≈': '~', '→': '->', '₁': '1', '₂': '2' };
    let out = '';
    for (const ch of s.replace(/[ληΔνρ−–—…≈→₁₂]/g, c => map[c])) {
      const code = ch.charCodeAt(0);
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else if (code < 32) continue;
      else if (code < 128) out += ch;
      else if (code < 256) out += '\\' + code.toString(8).padStart(3, '0');
      else out += '?';
    }
    return out;
  }

  // Assemble a single-page PDF (A3 landscape) from content operators.
  function pdfBytes(contentOps, info) {
    const W = (SHEET.w * MM).toFixed(2), H = (SHEET.h * MM).toFixed(2);
    const content = contentOps.join('\n');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      `<< /Title (${pdfString(info.title)}) /Creator (Gerotor Design Tool) /Producer (Gerotor Design Tool) >>`,
    ];
    let s = '%PDF-1.4\n%âãÏÓ\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = s.length;
    s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xFF;
    return bytes;
  }

  // ------------------------------------------------------------------ drawing helpers

  // Diameter dimension through the view centre (cx, cy) at angle ang; r in sheet mm.
  function diaDim(pg, cx, cy, r, ang, label, opts) {
    opts = opts || {};
    const u = [Math.cos(ang), Math.sin(ang)], ext = opts.ext || 10;
    const a = [cx - r * u[0], cy - r * u[1]], b = [cx + r * u[0], cy + r * u[1]];
    const e = [b[0] + ext * u[0], b[1] + ext * u[1]];
    pg.width(0.18).line(a[0], a[1], e[0], e[1]);
    pg.arrow(a[0], a[1], ang + Math.PI, 2.6).arrow(b[0], b[1], ang, 2.6);
    const right = u[0] >= 0;
    pg.line(e[0], e[1], e[0] + (right ? 1 : -1) * (textWidth(label, 3.2) + 2), e[1]);
    pg.text(e[0] + (right ? 1 : -1) * 1, e[1] + 0.8, 3.2, label, right ? 'left' : 'right');
  }

  // Linear dimension between two points (sheet mm) offset by d along the normal.
  function linDim(pg, p1, p2, d, label) {
    const t = [p2[0] - p1[0], p2[1] - p1[1]], L = Math.hypot(t[0], t[1]), u = [t[0] / L, t[1] / L], nrm = [-u[1], u[0]];
    const q1 = [p1[0] + d * nrm[0], p1[1] + d * nrm[1]], q2 = [p2[0] + d * nrm[0], p2[1] + d * nrm[1]];
    const s = Math.sign(d);
    pg.width(0.18).line(p1[0] + s * nrm[0], p1[1] + s * nrm[1], q1[0] + s * 1.5 * nrm[0], q1[1] + s * 1.5 * nrm[1]);
    pg.line(p2[0] + s * nrm[0], p2[1] + s * nrm[1], q2[0] + s * 1.5 * nrm[0], q2[1] + s * 1.5 * nrm[1]);
    pg.line(q1[0], q1[1], q2[0], q2[1]);
    const ang = Math.atan2(u[1], u[0]);
    pg.arrow(q1[0], q1[1], ang + Math.PI, 2.6).arrow(q2[0], q2[1], ang, 2.6);
    const m = [(q1[0] + q2[0]) / 2 + s * 1.2 * nrm[0], (q1[1] + q2[1]) / 2 + s * 1.2 * nrm[1]];
    if (Math.abs(u[0]) > 0.5) pg.text(m[0], m[1] + (s > 0 ? 0 : -3.2), 3.2, label, 'center');
    else pg.text(m[0] + (s > 0 ? -1 : 1), m[1] - 1.2, 3.2, label, s > 0 ? 'right' : 'left');
  }

  function centreCross(pg, cx, cy, r) {
    pg.width(0.13).dash(6, 1.5);
    pg.line(cx - r, cy, cx + r, cy).line(cx, cy - r, cx, cy + r);
    pg.dash(0);
  }

  // ------------------------------------------------------------------ the sheet

  function technicalDrawing(p, res, meta) {
    meta = meta || {};
    const pg = Page();
    const W = SHEET.w, H = SHEET.h;
    const date = meta.date || new Date().toISOString().slice(0, 10);

    // Frame (10 mm margin, 20 mm left binding edge).
    pg.width(0.7).rect(20, 10, W - 30, H - 20);
    pg.width(0.25);

    // Scale: largest standard scale with the outer rotor fitting a 115 mm view.
    const S = SCALES.find(s => p.OD * s <= 115) || SCALES[SCALES.length - 1];
    const sc = (pts, cx, cy) => pts.map(q => [cx + q[0] * S, cy + q[1] * S]);

    // ---- View A: outer rotor
    const vy = H - 10 - 16 - p.OD * S / 2;         // view centre height: views aligned to the top
    const A = [85, vy];
    const outer = G.outerProfile(p, 90, 40);
    pg.width(0.5).circle(A[0], A[1], p.OD / 2 * S).poly(sc(outer, A[0], A[1]), true);
    centreCross(pg, A[0], A[1], p.OD / 2 * S + 5);
    pg.width(0.13).dash(4, 1.2).circle(A[0], A[1], p.R * S).dash(0);
    diaDim(pg, A[0], A[1], p.OD / 2 * S, Math.PI / 4, 'Ø' + f2(p.OD));
    diaDim(pg, A[0], A[1], p.Rv * S, 3 * Math.PI / 4 + 0.15, 'Ø' + f2(2 * p.Rv), { ext: 22 });
    diaDim(pg, A[0], A[1], p.outerTip * S, -Math.PI / 2 - Math.PI / p.N, 'Ø' + f2(2 * p.outerTip), { ext: 30 });
    pg.text(A[0], A[1] - p.OD / 2 * S - 16, 4, `A  OUTER ROTOR  (${p.N} lobes)`, 'center', true);
    pg.text(A[0], A[1] - p.OD / 2 * S - 21, 3, `Lobe radius R${f2(p.rp)} on Ø${f2(2 * p.R)}` + (p.fillet > 0 ? `, fillets R${f2(p.fillet)}` : ''), 'center');

    // ---- View B: inner rotor
    const B = [215, vy];
    const inner = G.innerProfile(p, Math.max(720, (p.N - 1) * 180), p.rp + p.c);
    pg.width(0.5).poly(sc(inner, B[0], B[1]), true);
    if (p.bore > 0) pg.circle(B[0], B[1], p.bore / 2 * S);
    centreCross(pg, B[0], B[1], p.innerTip * S + 5);
    diaDim(pg, B[0], B[1], p.innerTip * S, Math.PI / 4 - 0.1, 'Ø' + f2(2 * p.innerTip));
    diaDim(pg, B[0], B[1], p.innerRoot * S, 3 * Math.PI / 4, 'Ø' + f2(2 * p.innerRoot), { ext: 18 });
    if (p.bore > 0) diaDim(pg, B[0], B[1], p.bore / 2 * S, -Math.PI / 4, 'Ø' + f2(p.bore), { ext: p.innerTip * S - p.bore / 2 * S + 8 });
    pg.text(B[0], B[1] - p.OD / 2 * S - 16, 4, `B  INNER ROTOR  (${p.N - 1} teeth)`, 'center', true);
    pg.text(B[0], B[1] - p.OD / 2 * S - 21, 3, `Trochoid R${f2(p.R)}, e ${f2(p.e)}, offset rp + c = ${f2(p.rp + p.c)}`, 'center');

    // ---- Side views (rotor width)
    const sideY = vy, sx = 318;
    const hO = p.OD * S, wB = p.b * S;
    pg.width(0.5).rect(sx, sideY - hO / 2, wB, hO);
    pg.width(0.13).dash(6, 1.5).line(sx - 4, sideY, sx + wB + 4, sideY).dash(0);
    linDim(pg, [sx, sideY + hO / 2], [sx + wB, sideY + hO / 2], 8, f2(p.b));
    const sx2 = sx + wB + 22, hI = 2 * p.innerTip * S;
    pg.width(0.5).rect(sx2, sideY - hI / 2, wB, hI);
    if (p.bore > 0) { pg.width(0.25).dash(2, 1).line(sx2, sideY + p.bore / 2 * S, sx2 + wB, sideY + p.bore / 2 * S).line(sx2, sideY - p.bore / 2 * S, sx2 + wB, sideY - p.bore / 2 * S).dash(0); }
    pg.width(0.13).dash(6, 1.5).line(sx2 - 4, sideY, sx2 + wB + 4, sideY).dash(0);
    linDim(pg, [sx2, sideY + hI / 2], [sx2 + wB, sideY + hI / 2], 8, f2(p.b));
    pg.text(sx + wB / 2, sideY - hO / 2 - 8, 3.2, 'A', 'center', true);
    pg.text(sx2 + wB / 2, sideY - hO / 2 - 8, 3.2, 'B', 'center', true);

    // ---- View C: assembly (smaller), bottom left
    const Sc = S * 0.6, C = [85, 62];
    const scC = (pts, dx) => pts.map(q => [C[0] + (q[0] + dx) * Sc, C[1] + q[1] * Sc]);
    pg.width(0.35).circle(C[0], C[1], p.OD / 2 * Sc).poly(scC(outer, 0), true).poly(scC(inner, p.e), true);
    if (p.bore > 0) pg.circle(C[0] + p.e * Sc, C[1], p.bore / 2 * Sc);
    centreCross(pg, C[0], C[1], p.OD / 2 * Sc + 4);
    pg.width(0.13).dash(6, 1.5).line(C[0] + p.e * Sc, C[1] - 6, C[0] + p.e * Sc, C[1] + p.OD / 2 * Sc + 6).dash(0);
    linDim(pg, [C[0], C[1] + p.OD / 2 * Sc + 3], [C[0] + p.e * Sc, C[1] + p.OD / 2 * Sc + 3], 4, 'e = ' + f2(p.e));
    pg.text(C[0], C[1] - p.OD / 2 * Sc - 8, 4, `C  ASSEMBLY  (scale ${scaleLabel(Sc)})`, 'center', true);

    // ---- Parameter table (middle bottom)
    const rows = [
      ['Outer rotor lobes N', String(p.N)], ['Inner rotor teeth', String(p.N - 1)], ['Eccentricity e', f2(p.e) + ' mm'],
      ['Lobe centre radius R', f2(p.R) + ' mm'], ['Lobe radius rp', f2(p.rp) + ' mm'], ['Profile clearance c', f2(p.c) + ' mm'],
      ['Outer valley radius Rv', f2(p.Rv) + ' mm'], ['Rotor width b', f2(p.b) + ' mm'], ['lambda = R/(N e)', p.lambda.toFixed(4)],
      ['Displacement', res.cc.toFixed(3) + ' cm³/rev'], ['Max tool Ø (inner rotor)', Number.isFinite(G.innerToolDiameter(p).diameter) ? f2(G.innerToolDiameter(p).diameter) + ' mm' : '-'],
    ];
    const tx = 148, ty = 100, rh = 5.2, cw = [52, 34];
    pg.width(0.35).rect(tx, ty - rows.length * rh, cw[0] + cw[1], rows.length * rh + rh);
    pg.text(tx + 2, ty + 1.4, 3.4, 'PROFILE DATA', 'left', true);
    pg.width(0.18).line(tx, ty, tx + cw[0] + cw[1], ty);
    rows.forEach((r, i) => {
      const y = ty - (i + 1) * rh;
      pg.line(tx, y, tx + cw[0] + cw[1], y);
      pg.text(tx + 2, y + 1.5, 3, r[0]).text(tx + cw[0] + cw[1] - 2, y + 1.5, 3, r[1], 'right');
    });
    pg.line(tx + cw[0], ty, tx + cw[0], ty - rows.length * rh);

    // ---- Notes
    const notes = [
      'NOTES',
      '1. Rotor profiles: exact model profiles; coordinates in the DXF / CSV export (same file set).',
      '2. Inner profile = trochoid offset by rp + c (profile clearance included).',
      `3. General tolerances ISO 2768-mK unless stated; profile and width tolerances per application.`,
      `4. Material: ${meta.material || 'sintered steel / steel'}; E = ${p.Ein || 210} / ${p.Eout || 210} GPa.`,
      '5. Break all sharp edges 0.2 x 45°.',
    ];
    notes.forEach((t, i) => pg.text(256, 100 - i * 5, i ? 3 : 3.4, t, 'left', i === 0));

    // ---- Title block (bottom right, 170 × 40 mm)
    const bx = W - 10 - 170, by = 10;
    pg.width(0.5).rect(bx, by, 170, 40);
    pg.width(0.25).line(bx, by + 20, bx + 170, by + 20).line(bx + 100, by, bx + 100, by + 40).line(bx + 100, by + 10, bx + 170, by + 10).line(bx + 100, by + 30, bx + 170, by + 30).line(bx + 135, by, bx + 135, by + 20);
    pg.text(bx + 3, by + 32, 5, meta.title || `GEROTOR SET N${p.N} / ${p.N - 1}`, 'left', true);
    pg.text(bx + 3, by + 24, 3.2, `Displacement ${res.cc.toFixed(3)} cm³/rev, OD ${f2(p.OD)}, b ${f2(p.b)} mm`);
    pg.text(bx + 3, by + 13, 3, 'Gerotor Design Tool');
    pg.text(bx + 3, by + 7, 3, `Drawing no. ${meta.number || 'GRT-' + p.N + '-' + String(Math.round(p.e * 1000))}`);
    pg.text(bx + 103, by + 33, 2.6, 'Scale').text(bx + 103, by + 22.5, 2.6, 'Date').text(bx + 103, by + 13, 2.6, 'Units').text(bx + 138, by + 13, 2.6, 'Sheet').text(bx + 103, by + 3, 2.6, 'Format').text(bx + 138, by + 3, 2.6, 'Projection');
    pg.text(bx + 120, by + 33, 4, scaleLabel(S), 'left', true).text(bx + 115, by + 22.5, 3.4, date).text(bx + 115, by + 13, 3.4, 'mm').text(bx + 150, by + 13, 3.4, '1 / 1').text(bx + 115, by + 3, 3.4, 'A3').text(bx + 155, by + 3, 3.4, 'ISO E');
    pg.text(bx + 103, by + 26, 2.4, '');

    return pdfBytes(pg.ops, { title: meta.title || `Gerotor N${p.N}` });
  }

  // ------------------------------------------------------------------ shared sheet elements

  function table(pg, x, yTop, title, rows, cw) {
    const rh = 5.2, w = cw[0] + cw[1];
    pg.width(0.35).rect(x, yTop - rows.length * rh, w, rows.length * rh + rh);
    pg.text(x + 2, yTop + 1.4, 3.4, title, 'left', true);
    pg.width(0.18).line(x, yTop, x + w, yTop);
    rows.forEach((r, i) => {
      const y = yTop - (i + 1) * rh;
      pg.line(x, y, x + w, y);
      pg.text(x + 2, y + 1.5, 3, r[0]).text(x + w - 2, y + 1.5, 3, r[1], 'right');
    });
    pg.line(x + cw[0], yTop, x + cw[0], yTop - rows.length * rh);
    return yTop - rows.length * rh;
  }

  function notesBlock(pg, x, y, lines) {
    pg.text(x, y, 3.4, 'NOTES', 'left', true);
    lines.forEach((t, i) => pg.text(x, y - 5 * (i + 1), 3, `${i + 1}. ${t}`));
  }

  function titleBlock(pg, p, meta, S, title, sub, number) {
    const W = SHEET.w, bx = W - 10 - 170, by = 10, date = meta.date || new Date().toISOString().slice(0, 10);
    pg.width(0.5).rect(bx, by, 170, 40);
    pg.width(0.25).line(bx, by + 20, bx + 170, by + 20).line(bx + 100, by, bx + 100, by + 40).line(bx + 100, by + 10, bx + 170, by + 10).line(bx + 100, by + 30, bx + 170, by + 30).line(bx + 135, by, bx + 135, by + 20);
    pg.text(bx + 3, by + 32, 5, title, 'left', true);
    pg.text(bx + 3, by + 24, 3.2, sub);
    pg.text(bx + 3, by + 13, 3, 'Gerotor Design Tool');
    pg.text(bx + 3, by + 7, 3, `Drawing no. ${number}`);
    pg.text(bx + 103, by + 33, 2.6, 'Scale').text(bx + 103, by + 22.5, 2.6, 'Date').text(bx + 103, by + 13, 2.6, 'Units').text(bx + 138, by + 13, 2.6, 'Sheet').text(bx + 103, by + 3, 2.6, 'Format').text(bx + 138, by + 3, 2.6, 'Projection');
    pg.text(bx + 120, by + 33, 4, scaleLabel(S), 'left', true).text(bx + 115, by + 22.5, 3.4, date).text(bx + 115, by + 13, 3.4, 'mm').text(bx + 150, by + 13, 3.4, '1 / 1').text(bx + 115, by + 3, 3.4, 'A3').text(bx + 155, by + 3, 3.4, 'ISO E');
  }

  const drawingNo = (p, suffix) => `GRT-${p.N}-${Math.round(p.e * 1000)}-${suffix}`;
  const deg = a => (a * 180 / Math.PI);
  const fdeg = a => (Math.round(deg(a) * 100) / 100).toFixed(2) + '°';

  // Side view of a rotor (rectangle width b × height h) with the width dimension.
  function sideView(pg, x, cy, h, b, S, borePairs) {
    pg.width(0.5).rect(x, cy - h / 2, b * S, h);
    (borePairs || []).forEach(r => pg.width(0.25).dash(2, 1).line(x, cy + r, x + b * S, cy + r).line(x, cy - r, x + b * S, cy - r).dash(0));
    pg.width(0.13).dash(6, 1.5).line(x - 4, cy, x + b * S + 4, cy).dash(0);
    linDim(pg, [x, cy + h / 2], [x + b * S, cy + h / 2], 8, f2(b));
  }

  // ------------------------------------------------------------------ single-part sheets

  /*
   * scope 'outer' | 'inner' | 'ports': one part per A3 sheet, main view at the largest standard scale
   * fitting 175 mm, side view, data table, notes, title block.
   */
  function partDrawing(p, res, scope, meta) {
    meta = meta || {};
    const pg = Page(), W = SHEET.w, H = SHEET.h;
    pg.width(0.7).rect(20, 10, W - 30, H - 20);
    const size = scope === 'inner' ? 2 * p.innerTip : p.OD;
    const S = SCALES.find(s => size * s <= 175) || SCALES[SCALES.length - 1];
    const M = [125, H - 10 - 22 - size * S / 2];             // main view centre
    const sc = (pts, dx) => pts.map(q => [M[0] + (q[0] + (dx || 0)) * S, M[1] + q[1] * S]);
    const tool = G.innerToolDiameter(p).diameter;

    if (scope === 'outer') {
      const outer = G.outerProfile(p, 120, 60);
      pg.width(0.5).circle(M[0], M[1], p.OD / 2 * S).poly(sc(outer), true);
      centreCross(pg, M[0], M[1], p.OD / 2 * S + 6);
      pg.width(0.13).dash(4, 1.2).circle(M[0], M[1], p.R * S).dash(0);
      diaDim(pg, M[0], M[1], p.OD / 2 * S, Math.PI / 4, 'Ø' + f2(p.OD));
      diaDim(pg, M[0], M[1], p.Rv * S, 3 * Math.PI / 4 + 0.15, 'Ø' + f2(2 * p.Rv), { ext: 30 });
      diaDim(pg, M[0], M[1], p.outerTip * S, -Math.PI / 2 - Math.PI / p.N, 'Ø' + f2(2 * p.outerTip), { ext: 40 });
      // Lobe radius and lobe-centre circle callouts on lobe 0.
      const C0 = [M[0] + p.R * S, M[1]];
      pg.width(0.18).line(C0[0], C0[1], C0[0] - p.rp * S * Math.cos(0.5), C0[1] + p.rp * S * Math.sin(0.5)).arrow(C0[0] - p.rp * S * Math.cos(0.5), C0[1] + p.rp * S * Math.sin(0.5), Math.PI - 0.5, 2.6);
      pg.text(C0[0] + 2, C0[1] + 3, 3.2, `R${f2(p.rp)} (${p.N}x)`);
      pg.text(M[0] - p.R * S * 0.7, M[1] - p.R * S * 0.75, 3, `Ø${f2(2 * p.R)} lobe centres`, 'center');
      if (p.fillet > 0) pg.text(M[0], M[1] + p.OD / 2 * S + 12, 3.2, `Fillets R${f2(p.fillet)} between lobes and valley (${2 * p.N}x)`, 'center');
      pg.text(M[0], M[1] - p.OD / 2 * S - 12, 4, `OUTER ROTOR  ${p.N} lobes  (scale ${scaleLabel(S)})`, 'center', true);
      sideView(pg, M[0] + size * S / 2 + 22, M[1], p.OD * S, p.b, S);
      const end = table(pg, 300, H - 30, 'OUTER ROTOR DATA', [
        ['Number of lobes N', String(p.N)], ['Outside diameter', 'Ø' + f2(p.OD)], ['Lobe centre circle', 'Ø' + f2(2 * p.R)],
        ['Lobe radius rp', f2(p.rp)], ['Lobe tip diameter', 'Ø' + f2(2 * p.outerTip)], ['Valley (root) diameter', 'Ø' + f2(2 * p.Rv)],
        ['Fillet radius', p.fillet > 0 ? f2(p.fillet) : 'none'], ['Width b', f2(p.b)], ['Mating inner rotor e', f2(p.e)],
      ], [62, 46]);
      notesBlock(pg, 30, 62, [
        'Profile: N circular lobes R' + f2(p.rp) + ' on Ø' + f2(2 * p.R) + ', valley arc Ø' + f2(2 * p.Rv) + '; exact (STEP / DXF).',
        'General tolerances ISO 2768-mK; profile, OD and width tolerances per application.',
        `Material: ${meta.material || 'sintered steel / steel'}.`, 'Break all sharp edges 0.2 x 45°.']);
      titleBlock(pg, p, meta, S, `OUTER ROTOR N${p.N}`, `Gerotor set N${p.N}/${p.N - 1}, e ${f2(p.e)}, b ${f2(p.b)} mm`, drawingNo(p, 'OR'));
      void end;
    } else if (scope === 'inner') {
      const inner = G.innerProfile(p, Math.max(1440, (p.N - 1) * 300), p.rp + p.c);
      pg.width(0.5).poly(sc(inner), true);
      if (p.bore > 0) pg.circle(M[0], M[1], p.bore / 2 * S);
      centreCross(pg, M[0], M[1], p.innerTip * S + 6);
      pg.width(0.13).dash(4, 1.2).circle(M[0], M[1], (p.N - 1) * p.e * S).dash(0);
      diaDim(pg, M[0], M[1], p.innerTip * S, Math.PI / 4 - 0.1, 'Ø' + f2(2 * p.innerTip));
      diaDim(pg, M[0], M[1], p.innerRoot * S, 3 * Math.PI / 4, 'Ø' + f2(2 * p.innerRoot), { ext: 26 });
      if (p.bore > 0) diaDim(pg, M[0], M[1], p.bore / 2 * S, -Math.PI / 4, 'Ø' + f2(p.bore), { ext: p.innerTip * S - p.bore / 2 * S + 10 });
      pg.text(M[0] - p.innerTip * S * 0.55, M[1] - p.innerTip * S * 0.95, 3, `Ø${f2(2 * (p.N - 1) * p.e)} pitch circle`, 'center');
      pg.text(M[0], M[1] - p.innerTip * S - 14, 4, `INNER ROTOR  ${p.N - 1} teeth  (scale ${scaleLabel(S)})`, 'center', true);
      sideView(pg, M[0] + size * S / 2 + 22, M[1], 2 * p.innerTip * S, p.b, S, p.bore > 0 ? [p.bore / 2 * S] : []);
      table(pg, 300, H - 30, 'INNER ROTOR DATA', [
        ['Number of teeth', String(p.N - 1)], ['Tip diameter', 'Ø' + f2(2 * p.innerTip)], ['Root diameter', 'Ø' + f2(2 * p.innerRoot)],
        ['Bore', p.bore > 0 ? 'Ø' + f2(p.bore) : '-'], ['Width b', f2(p.b)], ['Generating trochoid R', f2(p.R)],
        ['Eccentricity e', f2(p.e)], ['Offset rp + c', f2(p.rp + p.c)], ['Pitch circle (N-1)e', 'Ø' + f2(2 * (p.N - 1) * p.e)],
        ['Max tool Ø (concave root)', Number.isFinite(tool) ? f2(tool) : 'no limit'],
      ], [62, 46]);
      notesBlock(pg, 30, 62, [
        `Profile: epitrochoid R ${f2(p.R)}, e ${f2(p.e)}, N ${p.N}, offset inward by rp + c = ${f2(p.rp + p.c)}; coordinates in DXF / CSV, exact B-spline in STEP.`,
        'Profile clearance c = ' + f2(p.c) + ' mm is included in the offset.',
        'General tolerances ISO 2768-mK; profile, bore and width tolerances per application.',
        `Material: ${meta.material || 'sintered steel / steel'}. Break all sharp edges 0.2 x 45°.`]);
      titleBlock(pg, p, meta, S, `INNER ROTOR N${p.N - 1}`, `Gerotor set N${p.N}/${p.N - 1}, e ${f2(p.e)}, b ${f2(p.b)} mm`, drawingNo(p, 'IR'));
    } else {
      portSheet(pg, p, res, M, S, meta);
    }
    return pdfBytes(pg.ops, { title: meta.title || `Gerotor N${p.N} ${scope}` });
  }

  /*
   * Port plate sheet: kidney ports (filleted, with grooves) in the housing frame, outer rotor centre O2
   * and inner rotor centre O1, port edge angles (chain lines from O2), outer port radius about O2, inner
   * port radius about O1, rotor outline for reference, data table.
   */
  function portSheet(pg, p, res, M, S, meta) {
    const H = SHEET.h, pr = res.ports;
    if (!pr || !pr.suction) {
      pg.text(125, H / 2, 5, 'Port model off: enable the ports to draw the port plate.', 'center', true);
      titleBlock(pg, p, meta, S, 'PORT PLATE', 'no ports', drawingNo(p, 'PP'));
      return;
    }
    const sc = pts => pts.map(q => [M[0] + q[0] * S, M[1] + q[1] * S]);
    // Reference: rotor bore / OD (thin chain), rotor envelope.
    pg.width(0.13).dash(6, 1.5).circle(M[0], M[1], p.OD / 2 * S).dash(0);
    // Ports.
    pg.width(0.5).poly(sc(pr.suction.outline), true).poly(sc(pr.delivery.outline), true);
    for (const g of [...(pr.suction.grooves || []), ...(pr.delivery.grooves || [])]) pg.width(0.35).poly(sc(g.outline), true);
    // Centres O2 (origin) and O1 (e, 0), line of centres.
    centreCross(pg, M[0], M[1], p.OD / 2 * S + 6);
    const O1 = [M[0] + p.e * S, M[1]];
    pg.width(0.13).dash(6, 1.5).line(O1[0], O1[1] - 6, O1[0], O1[1] + 6).dash(0);
    pg.text(M[0] - 2, M[1] + 2, 3, 'O2', 'right').text(O1[0] + 2, O1[1] + 2, 3, 'O1');
    pg.width(0.13).dash(6, 1.5).line(O1[0], O1[1], O1[0], M[1] + p.OD / 2 * S + 2).dash(0);
    linDim(pg, [M[0], M[1] + p.OD / 2 * S + 2], [O1[0], M[1] + p.OD / 2 * S + 2], 6, 'e = ' + f2(p.e));
    // Edge angles: chain lines from O2 to beyond the outer radius, labelled.
    const edges = [['S1', pr.suction.a0], ['S2', pr.suction.a1], ['D1', pr.delivery.a0], ['D2', pr.delivery.a1]];
    const rl = (p.portRo + 8) * S;
    for (const [lab, a] of edges) {
      const ex = M[0] + rl * Math.cos(a), ey = M[1] + rl * Math.sin(a);
      pg.width(0.13).dash(6, 1.5).line(M[0], M[1], ex, ey).dash(0);
      const right = Math.cos(a) >= 0;
      pg.text(ex + (right ? 1.5 : -1.5), ey + (Math.sin(a) >= 0 ? 1 : -3.5), 3.2, `${lab} ${fdeg(((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))}`, right ? 'left' : 'right');
    }
    // Outer port radius about O2 (dimension inside the suction port), inner port radius about O1.
    const am = 0.5 * (pr.suction.a0 + pr.suction.a1);
    pg.width(0.18).line(M[0], M[1], M[0] + p.portRo * S * Math.cos(am), M[1] + p.portRo * S * Math.sin(am)).arrow(M[0] + p.portRo * S * Math.cos(am), M[1] + p.portRo * S * Math.sin(am), am, 2.6);
    pg.text(M[0] + p.portRo * S * 0.55 * Math.cos(am) + 2, M[1] + p.portRo * S * 0.55 * Math.sin(am), 3.2, `R${f2(p.portRo)} (O2)`);
    if (p.portRi > 0) {
      const ad = 0.5 * (pr.delivery.a0 + pr.delivery.a1), u = [Math.cos(ad), Math.sin(ad)];
      // Point on the inner arc about O1 in direction ad from O1.
      const T = [O1[0] + p.portRi * S * u[0], O1[1] + p.portRi * S * u[1]];
      pg.width(0.18).line(O1[0], O1[1], T[0], T[1]).arrow(T[0], T[1], ad, 2.6);
      pg.text(O1[0] + p.portRi * S * 0.5 * u[0] + 2, O1[1] + p.portRi * S * 0.5 * u[1] - 3, 3.2, `R${f2(p.portRi)} (O1)`);
    }
    pg.text(M[0], M[1] - p.OD / 2 * S - 10, 4, `PORT PLATE  (scale ${scaleLabel(S)})`, 'center', true);
    pg.text(M[0], M[1] - p.OD / 2 * S - 15, 3, 'Suction (inlet) port upper, delivery (outlet) port lower; rotation CCW; chain circle = rotor OD', 'center');

    const depth = p.b * (p.fillD > 1 || p.fillS > 1 ? 0.5 : 1);
    const ports = [p.dblIn ? 'in 2 faces' : 'in 1 face', p.dblOut ? 'out 2 faces' : 'out 1 face', p.shadow ? 'shadow' : ''].filter(Boolean).join(', ');
    const g = (pr.suction.grooves || []).concat(pr.delivery.grooves || []);
    table(pg, 300, H - 30, 'PORT DATA', [
      ['Suction start S1', fdeg(pr.suction.a0)], ['Suction end S2', fdeg(pr.suction.a1)],
      ['Delivery start D1', fdeg(pr.delivery.a0)], ['Delivery end D2', fdeg(pr.delivery.a1)],
      ['Outer port radius (O2)', f2(p.portRo)], ['Inner port radius (O1)', p.portRi > 0 ? f2(p.portRi) : '-'],
      ['Corner radii', p.portFillet > 0 ? f2(p.portFillet) : 'sharp'],
      ['Suction / delivery area', `${pr.suction.area.toFixed(1)} / ${pr.delivery.area.toFixed(1)} mm²`],
      ['Port depth (as GDS)', f2(depth)], ['Arrangement', ports],
      ['Grooves', g.length ? `${g.length}x ${f2(p.grooveW)} wide${p.grooveD > 0 ? ', ' + f2(p.grooveD) + ' deep' : ''}` : 'none'],
      ['Timing offsets S/S/D/D', [p.sucStart, p.sucEnd, p.delStart, p.delEnd].map(v => (v || 0) + '°').join(' ')],
    ], [58, 50]);
    notesBlock(pg, 30, 62, [
      'Angles from the line of centres O2 → O1 (3 o\'clock), positive CCW = direction of rotation.',
      'Port edges are radial lines from O2; outer arc about O2, inner arc about O1 (inner rotor root).',
      'Theoretical edges from the chamber extent at min / max volume plus the timing offsets.',
      'General tolerances ISO 2768-mK.']);
    titleBlock(pg, p, meta, S, 'PORT PLATE', `Gerotor set N${p.N}/${p.N - 1}, e ${f2(p.e)}; displacement ${res.cc.toFixed(3)} cm³/rev`, drawingNo(p, 'PP'));
  }

  // Drawing for an export scope: 'assembly' (overview sheet), 'outer', 'inner', 'ports'.
  function drawingFor(p, res, scope, meta) {
    return scope === 'outer' || scope === 'inner' || scope === 'ports'
      ? partDrawing(p, res, scope, meta) : technicalDrawing(p, res, meta);
  }

  G.drawing = { technicalDrawing, partDrawing, drawingFor, pdfBytes, pdfString, Page, SHEET, scaleLabel };
})(window.Gerotor);
