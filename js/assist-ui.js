/* Design Assist dialog: requirement form → G.designAssist → results table → apply. */
(function (G) {
  'use strict';

  const $ = id => document.getElementById(id);
  const dlg = $('assistDlg'), form = $('assistForm');
  const f = (x, d) => Number.isFinite(x) ? (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d) : '—';
  let last = null;

  function readReq() {
    const req = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      req[el.name] = el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
    }
    req.Nmin = Math.round(req.Nmin); req.Nmax = Math.round(req.Nmax);
    return req;
  }

  function showDisplacement() {
    const r = readReq();
    const v = r.flow * 1000 / r.rpm / (r.volEff / 100);
    $('assistDisp').textContent = Number.isFinite(v) ? `Required theoretical displacement: ${v.toFixed(3)} cm³/rev` : '';
  }

  function renderResults(a) {
    const rows = a.results;
    $('assistStatus').innerHTML = rows.length
      ? `${rows.length} designs · objective: ${a.objectiveLabel} · ${a.evaluated} geometries evaluated (${a.feasibleCount} feasible on the coarse grid) · ${(a.ms / 1000).toFixed(1)} s`
      : `No feasible design. Rejections: ${Object.entries(a.rejected).map(([k, n]) => `${k} ${n}`).join(', ')}. Relax the limits (outer Ø, walls, bore, rp/e).`;
    const head = '<tr><th>#</th><th>N</th><th>λ</th><th>r<sub>p</sub>/e</th><th>e</th><th>R</th><th>r<sub>p</sub></th>' +
      '<th>R<sub>v</sub></th><th>Outer Ø req.</th><th>Displ.</th><th>Error</th><th>Ripple</th><th>Hertz p<sub>max</sub></th><th>Tip sharpness</th><th>Tip speed</th><th>Warnings</th><th></th></tr>';
    $('assistTable').innerHTML = rows.length ? head + rows.map((c, i) =>
      `<tr class="${i === 0 ? 'best' : ''}"><td>${i + 1}</td><td>${c.N}</td><td>${f(c.lam, 3)}</td><td>${f(c.k, 2)}</td>` +
      `<td>${f(c.e, 3)}</td><td>${f(c.R, 3)}</td><td>${f(c.rp, 3)}</td><td>${f(c.Rv, 3)}</td><td>${f(c.ODreq, 1)}</td>` +
      `<td>${f(c.cc, 3)}</td><td>${f(c.ccErr, 3)} %</td><td>${f(c.rippleFull * 100, 2)} %</td><td>${f(c.pmaxFull / 1e6, 0)} MPa</td><td>${f(c.sharp, 2)}</td>` +
      `<td>${f(c.tip, 1)} m/s</td><td>${c.checks.join(', ') || '—'}</td>` +
      `<td><button type="button" data-apply="${i}">Apply</button></td></tr>`).join('') : '';

    const gz = a.gamez;
    if (!gz.ok) { $('gamezTable').innerHTML = `<tr><td>${gz.reason}</td></tr>`; return; }
    $('gamezTable').innerHTML = `<tr><th>N</th><th>λ<sub>s</sub></th><th>e</th><th>R</th><th>S = r<sub>p</sub></th><th>wall w<sub>c</sub></th>` +
      `<th>Displ. (exact model)</th><th>Error vs target</th><th>Valid</th></tr>` +
      gz.rows.map(r => `<tr><td>${r.N}</td><td>${r.lamS}</td><td>${f(r.e, 3)}</td><td>${f(r.R, 2)}</td><td>${f(r.rp, 2)}</td>` +
        `<td>${f(r.wc, 2)}</td><td>${f(r.cc, 3)}</td><td>${f(r.ccErr, 1)} %</td><td>${r.valid ? 'yes' : 'no'}</td></tr>`).join('');
  }

  $('assistOpen').addEventListener('click', () => { showDisplacement(); dlg.showModal(); });
  $('assistClose').addEventListener('click', () => dlg.close());
  form.addEventListener('input', showDisplacement);

  $('assistRun').addEventListener('click', () => {
    $('assistStatus').textContent = 'Searching…';
    $('assistRun').disabled = true;
    setTimeout(() => {                      // let the status paint before the search blocks
      try {
        last = G.designAssist(readReq());
        renderResults(last);
      } catch (err) {
        $('assistStatus').textContent = 'Search failed: ' + err.message;
      }
      $('assistRun').disabled = false;
    }, 30);
  });

  $('reApply').addEventListener('click', () => {
    const v = n => parseFloat(form.elements[n].value);
    const out = G.reverseEngineer({ N: Math.round(v('reN')), rp: v('reRp'), Dt: v('reDt'), Dr: v('reDr'), Dl: v('reDl'), Dv: v('reDv'), b: v('reB'), OD: v('reOD') });
    const d = out.derived;
    const txt = `e = ${f(d.e, 4)} mm, R = ${f(d.R, 4)} mm, clearance c = ${f(d.c * 1000, 1)} µm, λ = ${f(d.lambda, 3)}, rp/e = ${f(d.k, 3)}, valley margin ${f(d.valleyMargin, 3)} mm.`;
    if (!out.ok) { $('reStatus').textContent = out.issues.join(' ') + ' ' + txt; return; }
    G.app.applyDesign(out.params);
    $('reStatus').textContent = 'Applied: ' + txt;
  });

  $('assistTable').addEventListener('click', ev => {
    const i = ev.target.dataset && ev.target.dataset.apply;
    if (i === undefined || !last) return;
    G.app.applyDesign(last.results[+i].params);
    dlg.close();
  });
})(window.Gerotor);
