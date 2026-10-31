/* CAD / data export: DXF (R12), SVG, CSV, JSON. */
(function (G) {
  'use strict';

  const fmt = v => (Math.abs(v) < 1e-12 ? 0 : v).toFixed(5);

  // Profiles in assembly position (outer centre at origin, inner centre at (e,0)).
  function parts(p, scope, density, res) {
    const out = [];
    const ports = res && res.ports && res.ports.suction ? res.ports : null;
    if ((scope === 'assembly' || scope === 'ports') && ports) {
      const grooves = [...(ports.suction.grooves || []), ...(ports.delivery.grooves || [])].map(g => g.outline);
      out.push({ layer: 'PORTS', loops: [ports.suction.outline, ports.delivery.outline, ...grooves], circles: [] });
    }
    if (scope === 'ports') return out;
    if (scope !== 'inner') {
      const outerPts = G.outerProfile(p, Math.round(90 * density), Math.round(40 * density));
      out.push({ layer: 'OUTER_ROTOR', loops: [outerPts], circles: [{ c: [0, 0], r: p.OD / 2 }] });
    }
    if (scope !== 'outer') {
      const dx = scope === 'inner' ? 0 : p.e;
      const n = Math.round(Math.max(720, (p.N - 1) * 180) * density);
      const innerPts = G.innerProfile(p, n, p.rp + p.c).map(q => [q[0] + dx, q[1]]);
      const circles = p.bore > 0 ? [{ c: [dx, 0], r: p.bore / 2 }] : [];
      out.push({ layer: 'INNER_ROTOR', loops: [innerPts], circles });
    }
    return out;
  }

  function dxf(p, scope, res) {
    const L = [];
    const add = (...pairs) => { for (let i = 0; i < pairs.length; i += 2) L.push(String(pairs[i]), String(pairs[i + 1])); };
    add(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 0, 'ENDSEC');
    add(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, 3);
    add(0, 'LAYER', 2, 'OUTER_ROTOR', 70, 0, 62, 5, 6, 'CONTINUOUS');
    add(0, 'LAYER', 2, 'INNER_ROTOR', 70, 0, 62, 1, 6, 'CONTINUOUS');
    add(0, 'LAYER', 2, 'PORTS', 70, 0, 62, 3, 6, 'CONTINUOUS');
    add(0, 'ENDTAB', 0, 'ENDSEC');
    add(0, 'SECTION', 2, 'ENTITIES');
    for (const part of parts(p, scope, 1, res)) {
      for (const loop of part.loops) {
        add(0, 'POLYLINE', 8, part.layer, 66, 1, 70, 1, 10, 0, 20, 0, 30, 0);
        for (const q of loop) add(0, 'VERTEX', 8, part.layer, 10, fmt(q[0]), 20, fmt(q[1]), 30, 0);
        add(0, 'SEQEND', 8, part.layer);
      }
      for (const c of part.circles) add(0, 'CIRCLE', 8, part.layer, 10, fmt(c.c[0]), 20, fmt(c.c[1]), 30, 0, 40, fmt(c.r));
    }
    add(0, 'ENDSEC', 0, 'EOF');
    return L.join('\r\n') + '\r\n';
  }

  function svg(p, scope, res) {
    const r = p.OD / 2 + p.e + 2;
    const pathOf = pts => 'M' + pts.map(q => fmt(q[0]) + ' ' + fmt(-q[1])).join(' L') + ' Z';
    const circ = c => `M${fmt(c.c[0] + c.r)} ${fmt(-c.c[1])} A${fmt(c.r)} ${fmt(c.r)} 0 1 0 ${fmt(c.c[0] - c.r)} ${fmt(-c.c[1])} A${fmt(c.r)} ${fmt(c.r)} 0 1 0 ${fmt(c.c[0] + c.r)} ${fmt(-c.c[1])} Z`;
    const colors = { OUTER_ROTOR: '#2a5db0', INNER_ROTOR: '#c0392b', PORTS: '#1b9e5a' };
    const groups = parts(p, scope, 1, res).map(part => {
      const d = part.loops.map(pathOf).concat(part.circles.map(circ)).join(' ');
      return `  <g id="${part.layer}"><path d="${d}" fill="none" fill-rule="evenodd" stroke="${colors[part.layer]}" stroke-width="0.1"/></g>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${(2 * r).toFixed(2)}mm" height="${(2 * r).toFixed(2)}mm" viewBox="${-r} ${-r} ${2 * r} ${2 * r}">
${groups.join('\n')}
</svg>
`;
  }

  function csv(p, scope, res) {
    const rows = ['part,loop,i,x_mm,y_mm'];
    for (const part of parts(p, scope, 1, res)) {
      part.loops.forEach((loop, li) => loop.forEach((q, i) => rows.push(`${part.layer},${li},${i},${fmt(q[0])},${fmt(q[1])}`)));
    }
    return rows.join('\n') + '\n';
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  G.exporters = { dxf, svg, csv, download };
})(window.Gerotor);
