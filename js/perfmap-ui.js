/* Performance map panel: run the sweep for the current design, plot and export CSV. */
(function (G) {
  'use strict';

  const $ = id => document.getElementById(id);
  const form = $('mapForm');
  const COLORS = ['--accent', '--series2', '--series3', '--series4', '--series5', '--series6'];
  const QTY = {
    etaT: { label: 'Overall efficiency', unit: '%', f: q => 100 * q.etaT },
    etaV: { label: 'Volumetric efficiency', unit: '%', f: q => 100 * q.etaV },
    etaM: { label: 'Mechanical efficiency', unit: '%', f: q => 100 * q.etaM },
    flowLpm: { label: 'Delivered flow', unit: 'L/min', f: q => q.flowLpm },
    torque: { label: 'Shaft torque', unit: 'N·m', f: q => q.torque },
    powerIn: { label: 'Input power', unit: 'kW', f: q => q.powerIn / 1000 },
  };
  let map = null;

  function read() {
    const o = {};
    for (const el of form.elements) if (el.name) o[el.name] = parseFloat(el.value);
    o.nRpm = Math.max(2, Math.round(o.nRpm)); o.nDp = Math.max(1, Math.round(o.nDp));
    return o;
  }

  function draw() {
    if (!map) return;
    const q = QTY[$('mapQty').value];
    const series = map.pressures.map((dp, i) => ({
      ys: map.points.filter(pt => pt.dp === dp).map(q.f), color: COLORS[i % COLORS.length],
    }));
    const xMax = map.speeds[map.speeds.length - 1], xMin = map.speeds[0];
    const step = Math.pow(10, Math.floor(Math.log10((xMax - xMin) / 3 || 1)));
    const ticks = [];
    for (let v = Math.ceil(xMin / step) * step; v <= xMax + 1e-9; v += step) ticks.push(v);
    G.lineChart($('mapChart'), { xs: map.speeds, series, xMin, xMax, xTicks: ticks.slice(0, 8), xLabel: 'rpm' });
    $('mapLegend').innerHTML = map.pressures.map((dp, i) =>
      `<span><i style="border-color:var(${COLORS[i % COLORS.length]})"></i>Δp ${+dp.toFixed(1)} bar</span>`).join('') +
      `<span>${q.label} [${q.unit}]</span>`;
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
        $('mapCsv').disabled = false;
        draw();
      } catch (err) {
        $('mapStatus').textContent = 'Map failed: ' + err.message;
      }
      $('mapRun').disabled = false;
    }, 30);
  });
  $('maxRun').addEventListener('click', () => {
    const { params, res } = G.app.getState();
    if (!params || !res || !res.A) { $('maxStatus').textContent = 'The current design is not valid.'; return; }
    if (!params.portsOn) { $('maxStatus').textContent = 'Enable the port model to estimate the filling-limited speed.'; return; }
    $('maxStatus').textContent = 'Computing…';
    setTimeout(() => {
      const m = G.maxSpeed(params, res);
      const inlet = `inlet port velocity reaches 2 m/s at ${m.rpmInlet.toFixed(0)} rpm`;
      $('maxStatus').textContent = Number.isNaN(m.rpm)
        ? `Chamber void exceeds 0.5 % already at ${m.below} rpm; raise the inlet pressure or retime the suction port. ${inlet}.`
        : `Filling-limited max speed ≈ ${m.rpm.toFixed(0)} rpm${m.above ? '+' : ''} (peak void 0.5 %, Δp ${params.dp} bar, inlet ${params.pIn} bar abs); ${inlet}.`;
    }, 30);
  });
  $('mapQty').addEventListener('change', draw);
  $('mapCsv').addEventListener('click', () => {
    if (map) G.exporters.download('gerotor_performance_map.csv', G.mapCsv(map), 'text/csv');
  });
})(window.Gerotor);
