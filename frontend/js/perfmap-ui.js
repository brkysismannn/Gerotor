/*
 * Charts panel (as in Gerotor Design Studio): sweep the pump performance range (speeds × delivery
 * pressures) for the current design, then show the ticked charts as cards — x axis = delivery
 * pressure with one line per speed; contact stress over the outer-rotor rotation, one line per
 * pressure at the highest speed. Export to Excel (.xlsx) or CSV.
 */
(function (G) {
  'use strict';

  const $ = id => document.getElementById(id);
  const form = $('mapForm');
  const COLORS = ['--accent', '--series2', '--series3', '--series4', '--series5', '--series6', '--warn', '--contact'];
  const QTY = {
    flow: { label: 'Pump flow', unit: 'L/min', f: q => q.flowLpm },
    power: { label: 'Drive power', unit: 'kW', f: q => q.powerIn / 1000 },
    torque: { label: 'Drive torque', unit: 'N·m', f: q => q.torque },
    etaV: { label: 'Volumetric efficiency', unit: '%', f: q => 100 * q.etaV },
    etaM: { label: 'Mechanical efficiency', unit: '%', f: q => 100 * q.etaM },
    etaT: { label: 'Overall efficiency', unit: '%', f: q => 100 * q.etaT },
    ripple: { label: 'Outlet pressure ripple', unit: '% of Δp', f: q => 100 * q.pRipple },
  };
  let map = null;

  function read() {
    const o = {};
    for (const el of form.elements) if (el.name) o[el.name] = parseFloat(el.value);
    o.nRpm = Math.max(1, Math.round(o.nRpm)); o.nDp = Math.max(1, Math.round(o.nDp));
    return o;
  }

  const picked = () => [...$('chartPick').querySelectorAll('input:checked')].map(i => i.value);

  function ticksFor(a, b, n) {
    if (!(b > a)) return [a];
    const raw = (b - a) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
    const t = [];
    for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) t.push(+v.toFixed(6));
    return t;
  }

  function card(title, unit) {
    const el = document.createElement('div');
    el.className = 'chart-card';
    el.innerHTML = `<h3>${title} <small>${unit}</small></h3><canvas class="chart"></canvas><div class="chart-legend"></div>`;
    $('chartGrid').appendChild(el);
    return { canvas: el.querySelector('canvas'), legend: el.querySelector('.chart-legend') };
  }

  const legendHtml = (labels, title) => labels.map((l, i) =>
    `<span><i style="border-color:var(${COLORS[i % COLORS.length]})"></i>${l}</span>`).join('') + (title ? `<span>${title}</span>` : '');

  function drawAll() {
    if (!map) return;
    $('chartGrid').innerHTML = '';
    const pr = map.pressures, sp = map.speeds;
    for (const key of picked()) {
      if (key === 'stress') {
        const c = card('Hertz contact stress', 'MPa · outer rotor rotation, one lobe, ' + sp[sp.length - 1].toFixed(0) + ' rpm');
        const pts = map.points.filter(q => q.rpm === sp[sp.length - 1] && q.stressCurve);
        if (!pts.length) { c.legend.textContent = 'No contact load (Δp = 0).'; continue; }
        // Show the engagement span of the lobe (+ margin).
        const ang = pts[0].stressCurve.ang;
        let lo = Infinity, hi = -Infinity;
        for (const q of pts) q.stressCurve.pm.forEach((v, i) => { if (v > 0) { lo = Math.min(lo, ang[i]); hi = Math.max(hi, ang[i]); } });
        const i0 = ang.findIndex(a => a >= lo - 10), i1 = ang.length - 1 - [...ang].reverse().findIndex(a => a <= hi + 10);
        const xs = ang.slice(Math.max(0, i0), i1 + 1);
        G.lineChart(c.canvas, {
          xs, xMin: xs[0], xMax: xs[xs.length - 1], xTicks: ticksFor(xs[0], xs[xs.length - 1], 6), xLabel: '°', yFromZero: true,
          series: pts.map((q, i) => ({ ys: q.stressCurve.pm.slice(Math.max(0, i0), i1 + 1).map(v => v / 1e6), color: COLORS[i % COLORS.length] })),
        });
        c.legend.innerHTML = legendHtml(pts.map(q => 'Δp ' + +q.dp.toFixed(1) + ' bar'), 'Delivery pressure');
        continue;
      }
      const q = QTY[key];
      const c = card(q.label, q.unit + ' · delivery pressure');
      if (pr.length < 2) { c.legend.textContent = 'Needs at least two pressure points.'; continue; }
      G.lineChart(c.canvas, {
        xs: pr, xMin: pr[0], xMax: pr[pr.length - 1], xTicks: ticksFor(pr[0], pr[pr.length - 1], 5), xLabel: 'bar',
        series: sp.map((n, i) => ({ ys: map.points.filter(pt => pt.rpm === n).map(q.f), color: COLORS[i % COLORS.length] })),
        yFromZero: key === 'flow' || key === 'power' || key === 'torque',
      });
      c.legend.innerHTML = legendHtml(sp.map(n => n.toFixed(0) + ' rpm'), 'Pump speed');
    }
  }

  function workbook() {
    const sheets = [{ name: 'Operating points', rows: [G.MAP_COLS, ...map.points.map(G.mapRow)] }];
    for (const key of Object.keys(QTY)) {
      const q = QTY[key];
      sheets.push({ name: q.label, rows: [['Δp [bar] \\ speed [rpm]', ...map.speeds],
        ...map.pressures.map(dp => [dp, ...map.speeds.map(n => q.f(map.points.find(pt => pt.rpm === n && pt.dp === dp)))])] });
    }
    const top = map.points.filter(q => q.rpm === map.speeds[map.speeds.length - 1] && q.stressCurve);
    if (top.length) {
      sheets.push({ name: 'Contact stress', rows: [['outer rotation [°]', ...top.map(q => `p_max [MPa] at Δp ${q.dp} bar`)],
        ...top[0].stressCurve.ang.map((a, i) => [a, ...top.map(q => q.stressCurve.pm[i] / 1e6)])] });
    }
    return G.xlsx.workbook(sheets);
  }

  $('mapRun').addEventListener('click', () => {
    const { params, res } = G.app.getState();
    if (!params || !res || !res.A) { $('mapStatus').textContent = 'The current design is not valid.'; return; }
    $('mapStatus').textContent = 'Computing…';
    $('mapRun').disabled = true;
    setTimeout(() => {
      try {
        map = G.performanceMap(params, res, read());
        $('mapStatus').textContent = `${map.points.length} operating points · ${(map.ms / 1000).toFixed(1)} s` +
          (params.portsOn ? '' : ' · port model off: η_v = 1');
        $('mapCsv').disabled = $('mapXlsx').disabled = false;
        $('chartsInfo').textContent = `${map.points.length} operating points`;
        $('chartsDlg').showModal();
        drawAll();
      } catch (err) {
        $('mapStatus').textContent = 'Charts failed: ' + err.message;
      }
      $('mapRun').disabled = false;
    }, 30);
  });
  $('chartsClose').addEventListener('click', () => $('chartsDlg').close());
  $('chartPick').addEventListener('change', () => { if ($('chartsDlg').open) drawAll(); });
  $('mapCsv').addEventListener('click', () => {
    if (map) G.exporters.download('gerotor_performance.csv', G.mapCsv(map), 'text/csv');
  });
  $('mapXlsx').addEventListener('click', () => {
    if (map) G.exporters.download('gerotor_performance.xlsx', workbook(),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  $('maxRun').addEventListener('click', () => {
    const { params, res } = G.app.getState();
    if (!params || !res || !res.A) { $('maxStatus').textContent = 'The current design is not valid.'; return; }
    if (!params.portsOn) { $('maxStatus').textContent = 'Enable the port model to estimate the filling-limited speed.'; return; }
    $('maxStatus').textContent = 'Computing…';
    setTimeout(() => {
      const m = G.maxSpeed(params, res);
      const inlet = `inlet port velocity reaches 2 m/s at ${m.rpmInlet.toFixed(0)} rpm; ` +
        `GDS criteria: ${m.gds.rpm.toFixed(0)} rpm (${m.gds.basis}; tip ${m.gds.rpmTip.toFixed(0)}, gallery ${m.gds.rpmGallery.toFixed(0)} rpm)`;
      $('maxStatus').textContent = Number.isNaN(m.rpm)
        ? `Chamber void exceeds 0.5 % already at ${m.below} rpm; raise the inlet pressure or retime the suction port. ${inlet}.`
        : `Filling-limited max speed ≈ ${m.rpm.toFixed(0)} rpm${m.above ? '+' : ''} (peak void 0.5 %, Δp ${params.dp} bar, inlet ${params.pIn} bar abs); ${inlet}.`;
    }, 30);
  });

  G.chartsUi = { workbook: () => map && workbook(), drawAll };
})(window.Gerotor);
