/*
 * OpenModelica panel: export the current design and the case table (speeds × pressures of the Charts
 * range) as a Modelica package; "Open in OpenModelica" sends it to the local server (tools/serve.ps1,
 * POST /api/modelica), which writes modelica/<name>/ and starts OMEdit. Without the server the files
 * can be downloaded.
 */
(function (G) {
  'use strict';

  const $ = id => document.getElementById(id);
  const status = t => { $('omStatus').textContent = t; };

  function range() {
    const f = $('mapForm'), v = n => parseFloat(f.elements[n].value);
    return { rpmMin: v('rpmMin'), rpmMax: v('rpmMax'), nRpm: Math.round(v('nRpm')), dpMin: v('dpMin'), dpMax: v('dpMax'), nDp: Math.round(v('nDp')) };
  }

  function build() {
    const { params, res } = G.app.getState();
    if (!params || !res || !res.A) { status('The current design is not valid.'); return null; }
    if (!(params.rpm > 0)) { status('Set a shaft speed > 0.'); return null; }
    const name = 'Gerotor_N' + params.N + '_e' + String(params.e).replace('.', 'p');
    return { params, res, out: G.modelica.exportModelica(params, res, Object.assign({ name }, range())) };
  }

  $('omOpen').addEventListener('click', async () => {
    const b = build();
    if (!b) return;
    status('Writing the model and starting OMEdit…');
    try {
      const r = await fetch('/api/modelica', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Gerotor-Request': '1' },
        body: JSON.stringify({ name: b.out.name, files: b.out.files, open: true, check: true }),
      });
      if (!r.ok) throw new Error('server answered ' + r.status);
      const j = await r.json();
      const chk = j.check ? (/Check of .* completed successfully/.test(j.check) ? ' Model check passed.' : ' Model check: ' + j.check.slice(0, 300)) : '';
      status(j.opened ? `Opened ${b.out.name}.mo in OMEdit (files in ${j.dir}).${chk}`
        : `Files written to ${j.dir}; ${j.error || 'OMEdit not started'}.${chk}`);
    } catch (err) {
      status('Local server not available (' + err.message + '). Use "Download .mo" and open the file in OMEdit, ' +
        'or start tools/serve.ps1 and open the tool from http://localhost.');
    }
  });

  $('omDownload').addEventListener('click', () => {
    const b = build();
    if (!b) return;
    for (const [fname, text] of Object.entries(b.out.files)) G.exporters.download(fname, text, 'text/plain');
    status(`Downloaded ${Object.keys(b.out.files).join(', ')}. In OMEdit: File → Open Model/Library File, then simulate ${b.out.name}.Examples.PumpSystem; run cases.mos with omc for the case table.`);
  });

  // GT-style case setup table: parameters as rows, cases as columns.
  $('omCases').addEventListener('click', () => {
    const { params, res } = G.app.getState();
    if (!params || !res || !res.A) { status('The current design is not valid.'); return; }
    const list = G.modelica.cases(params, res, range());
    const p = params;
    const rows = [
      ['Case label', '', cs => cs.label],
      ['DesiredPressureDrop', 'bar', cs => +cs.dp.toFixed(3)],
      ['ExpectedFlow', 'L/min', cs => cs.qExpLpm.toFixed(3), true],
      ['OutletRestrictArea', 'mm²', cs => (cs.A * 1e6).toFixed(4), true],
      ['RPM', 'rpm', cs => cs.rpm.toFixed(0)],
      ['Fluid', '', () => p.oil === 'user' ? 'datasheet oil' : (G.OILS[p.oil] ? G.OILS[p.oil].label : 'custom')],
      ['Tip_Clearance', 'µm', () => +(p.c * 1000).toFixed(1)],
      ['Temperature', '°C', () => p.oil === 'custom' ? '—' : p.oilT],
      ['Axial_Clearance_Each_Side', 'µm', () => +(p.axialClr * 1000 / (G.singleSided(p) ? 1 : 2)).toFixed(1)],
      ['fluid_density', 'kg/m³', () => +p.rho.toFixed(1)],
      ['fluid_viscosity', 'cSt', () => +p.nu.toFixed(3)],
      ['Radial_Clearance', 'µm', () => +(p.odClr / 2 * 1000).toFixed(1)],
      ['Coefficient_Friction', '', () => p.faceMu],
      ['Rotor_Diameter', 'mm', () => p.OD],
      ['Rotor_Width', 'mm', () => p.b],
      ['shaft_bearing_clearance', 'µm', () => +(p.jbClr * 1000).toFixed(1)],
      ['shaft_bearing_length', 'mm', () => p.jbLen],
      ['Shadow_Port_Enable', '', () => (p.shadow ? 1 : 0)],
    ];
    const head = '<tr><th>Parameter</th><th>Unit</th>' + list.map((_, i) => `<th>Case ${i + 1}</th>`).join('') + '</tr>';
    const body = rows.map(([n, u, f, hl]) => `<tr${hl ? ' class="hl"' : ''}><td>${n}</td><td>${u}</td>` + list.map(cs => `<td>${f(cs)}</td>`).join('') + '</tr>').join('');
    $('caseTable').innerHTML = head + body;
    $('casesDlg').showModal();
  });
  $('casesClose').addEventListener('click', () => $('casesDlg').close());
})(window.Gerotor);
