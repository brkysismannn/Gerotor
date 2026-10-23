/* UI wiring: parameters -> analysis -> view, charts, export. */
(function (G) {
  'use strict';

  const DEFAULTS = {
    N: 7, e: 3, R: 30, rp: 8, c: 0.03, Rv: 28, RvAuto: true, RvClear: 0.5, fillet: 0,
    b: 20, OD: 80, bore: 18, rpm: 1500, dp: 100,
    portsOn: true, portRo: 28, portRoAuto: true, portRi: 19, portRiAuto: true,
    sucStart: 0, sucEnd: 0, delStart: 0, delEnd: 0, dblIn: false, dblOut: false, shadow: true, outletVol: 0,
    gSucStart: 0, gSucEnd: 0, gDelStart: 0, gDelEnd: 0, grooveW: 1, grooveD: 0, portFillet: 0,
    pIn: 1, pVap: 0.2, rho: 860, bulk: 1400, Cd: 0.7, nu: 30,
    leakOn: true, axialClr: 0.05, shaftVent: true, tipGapModel: 'backlash',
    Ein: 210, nuIn: 0.3, Eout: 210, nuOut: 0.3,
    odClr: 0.15, jbLen: 0, jbClr: 0.04, faceMu: 0.08,
    oil: 'custom', oilT: 40,
    uT1: 40, uNu1: 32, uT2: 100, uNu2: 5.4, uT3: 0, uNu3: 0, uRho15: 870,
  };
  const STORE_KEY = 'gerotor.params.v1';
  const DEG = 180 / Math.PI;

  const $ = id => document.getElementById(id);
  const form = $('params');
  const renderer = new G.Renderer($('view'));

  let params = null, res = null;
  let innerDeg = 0, playing = true, last = performance.now();

  // ------------------------------------------------------------- params

  function readForm() {
    const p = {};
    for (const key of Object.keys(DEFAULTS)) {
      const el = form.elements[key];
      p[key] = el.type === 'checkbox' ? el.checked : (el.tagName === 'SELECT' ? el.value : parseFloat(el.value));
    }
    p.N = Math.round(p.N);
    return p;
  }

  function writeForm(p) {
    for (const key of Object.keys(DEFAULTS)) {
      const el = form.elements[key];
      if (!el || p[key] === undefined) continue;
      if (el.type === 'checkbox') el.checked = !!p[key]; else el.value = p[key];
    }
  }

  function store(p) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (_) { /* storage unavailable */ }
  }

  // Older parameter files: doubleFill / faceSupport / portLayout → porting checkboxes.
  function migrate(s) {
    if (s && !('dblIn' in s)) {
      let layout = s.portLayout;
      if (!layout && ('doubleFill' in s || 'faceSupport' in s)) layout = s.doubleFill ? 'double' : (s.faceSupport === 'single' ? 'single' : 'shadow');
      if (layout) Object.assign(s, { dblIn: layout === 'double', dblOut: layout === 'double', shadow: layout === 'shadow' });
      delete s.portLayout;
    }
    return s;
  }

  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && typeof s === 'object') return Object.assign({}, DEFAULTS, migrate(s));
    } catch (_) { /* ignore */ }
    return Object.assign({}, DEFAULTS);
  }

  // ν(T) curve of the selected oil (log axis), datasheet points and the operating temperature.
  function drawOilCurve(oil, tC) {
    const box = $('oilCurve');
    box.hidden = !(oil && oil.fit);
    if (box.hidden) return;
    const pts = oil.points || [];
    const tLo = Math.min(-20, tC - 10, ...pts.map(q => q[0] - 10));
    const tHi = Math.max(120, tC + 10, ...pts.map(q => q[0] + 10));
    const xs = [];
    for (let t = tLo; t <= tHi + 1e-9; t += (tHi - tLo) / 120) xs.push(t);
    const ys = xs.map(t => Math.max(G.viscosityFromFit(oil.fit, t), 0.5));
    const step = tHi - tLo > 150 ? 40 : 20, ticks = [];
    for (let t = Math.ceil(tLo / step) * step; t <= tHi; t += step) ticks.push(t);
    G.lineChart($('oilChart'), { xs, ys, xMin: tLo, xMax: tHi, xTicks: ticks, xLabel: '°C', yLog: true,
      marker: [tC, oil.nu], points: pts.filter(q => q[1] > 0) });
    const notes = (oil.notes || []).length ? ' · ⚠ ' + oil.notes.join('; ') : '';
    $('oilNote').textContent = `ν(${tC} °C) = ${oil.nu.toFixed(2)} cSt, ρ = ${oil.rho.toFixed(0)} kg/m³ · ` +
      `Walther A = ${oil.fit.A.toFixed(4)}, B = ${oil.fit.B.toFixed(4)}` + notes;
  }

  // ------------------------------------------------------------- compute

  function recompute() {
    // Oil preset: viscosity and density from temperature (js/fluid.js).
    // User oil: ASTM D341 line through the datasheet points.
    const oilKey = form.elements.oil.value, oilT = parseFloat(form.elements.oilT.value);
    const oil = oilKey === 'user' ? G.userOil(readForm(), oilT)
      : oilKey !== 'custom' ? G.oilProperties(oilKey, oilT) : null;
    const oilOk = !!(oil && Number.isFinite(oil.nu) && oil.nu > 0);
    form.elements.nu.disabled = form.elements.rho.disabled = oilOk;
    form.elements.oilT.disabled = !oil;
    $('userOil').hidden = oilKey !== 'user';
    if (oilOk) {
      form.elements.nu.value = oil.nu.toFixed(2);
      form.elements.rho.value = oil.rho.toFixed(0);
    }
    drawOilCurve(oil, oilT);
    const raw = readForm();
    if (Object.values(raw).some(v => typeof v === 'number' && !Number.isFinite(v))) return;
    store(raw);
    params = G.derive(raw);
    form.elements.Rv.disabled = raw.RvAuto;
    form.elements.RvClear.disabled = !raw.RvAuto;
    if (raw.RvAuto) form.elements.Rv.value = params.Rv.toFixed(3);
    form.elements.portRo.disabled = raw.portRoAuto;
    form.elements.portRi.disabled = raw.portRiAuto;
    if (raw.portRoAuto) form.elements.portRo.value = params.portRo.toFixed(3);
    if (raw.portRiAuto) form.elements.portRi.value = params.portRi.toFixed(3);

    res = G.analyse(params);
    const drawable = res.A !== undefined;
    if (drawable) renderer.setModel(params, res);
    updateMetrics();
    updateChecks();
    drawCharts();
    drawView();
  }

  function f(x, d) { return Number.isFinite(x) ? x.toFixed(d) : '—'; }

  function updateMetrics() {
    const p = params, ok = res && res.A;
    const m = [
      ['Displacement', ok ? f(res.cc, 3) + ' cm³/rev' : '—', true],
      ['Theoretical flow', ok ? f(res.flowLpm, 2) + ' L/min' : '—', true],
      ['Flow ripple', ok ? f(res.ripple * 100, 2) + ' %' : '—'],
      ['Ideal torque', ok ? f(res.torque, 2) + ' N·m' : '—'],
      ['Hydraulic power', ok ? f(res.power, 2) + ' kW' : '—'],
      ['λ = R / (N·e)', f(p.lambda, 3)],
    ];
    const pr = ok && res.ports;
    if (pr && pr.sim) {
      m.push(
        ['Delivery flow (port model)', f(pr.flowLpm, 2) + ' L/min'],
        [params.leakOn ? 'Volumetric efficiency' : 'Port timing efficiency', f(pr.portEfficiency * 100, 1) + ' %', params.leakOn],
        ['Flow ripple (port model)', f(pr.ripple * 100, 2) + ' %'],
        ['Chamber pressure min / max', f(pr.pMinBar, 2) + ' / ' + f(pr.pMaxBar, 1) + ' bar'],
      );
      if (pr.outlet) m.push(['Outlet pressure ripple', f(pr.outlet.rippleRel * 100, 2) + ' % of Δp (' + f(pr.outlet.ripplePa / 1e5, 2) + ' bar p-p)']);
      if (params.leakOn && pr.leak) {
        const lpm = q => f(q * 6e4, 3);
        m.push(['Leak flows: tip (gross) / bore drain / lands', `${lpm(pr.leak.tip)} / ${lpm(pr.leak.bore)} / ${lpm(pr.leak.land)} L/min`]);
      }
    }
    if (pr && pr.suction) {
      m.push(['Inlet port velocity', f(pr.inletVelocity, 2) + ' m/s']);
    }
    if (ok) m.push(['Inner tip speed', f(res.tipSpeed, 2) + ' m/s']);
    if (ok) {
      const tool = G.innerToolDiameter(p);
      m.push(['Max tool Ø to cut inner rotor', Number.isFinite(tool.diameter) ? f(tool.diameter, 2) + ' mm' : 'no concave region']);
    }
    if (pr && pr.suction && G.gdsCavitationLimits) {
      const cav = G.gdsCavitationLimits(p, res);
      m.push(['Max speed to avoid cavitation (GDS criteria)', f(cav.rpm, 0) + ' rpm (' + cav.basis + ')']);
    }
    const ct = ok && res.contact;
    if (ct) {
      m.push(
        ['Shaft torque mean / ripple', f(ct.torqueMean, 2) + ' N·m / ' + f(ct.torqueRipple * 100, 1) + ' %'],
        ['Shaft side load mean / max', f(ct.shaftLoadMean, 0) + ' / ' + f(ct.shaftLoadMax, 0) + ' N at ' + f(ct.shaftLoadAngle, 1) + '°'],
        ['Contact force max', f(ct.Fmax, 0) + ' N'],
        ['Hertz pressure max', f(ct.pmaxMax / 1e6, 0) + ' MPa'],
        ['Sliding speed max', f(ct.vsMax, 3) + ' m/s'],
        ['Wear factor (p·v) max', f(ct.wrpfMax / 1e6, 1) + ' MPa·m/s'],
      );
    }
    if (ok && p.rpm > 0 && G.rippleSpectrum) {
      const sp = G.rippleSpectrum(p, res);
      const fmtTop = list => list.map(h => `${f(h.f, 0)} Hz ${f(h.amp, 2)}%`).join(', ');
      m.push(['Tooth-pass frequency', f(sp.kin.toothPass, 1) + ' Hz']);
      m.push(['Ripple harmonics (kinematic)', fmtTop(sp.kinTop.slice(0, 2))]);
      if (sp.portTop) m.push(['Ripple harmonics (port model)', fmtTop(sp.portTop.slice(0, 2))]);
    }
    const me = ok && res.mech;
    if (me) {
      m.push(
        ['Shaft torque incl. losses', f(me.Mshaft, 2) + ' N·m'],
        ['Mechanical / overall efficiency', f(me.etaM * 100, 1) + ' / ' + f(me.etaT * 100, 1) + ' %', true],
        ['Input power', f(me.powerIn / 1000, 3) + ' kW'],
        ['Losses: OD / outer faces / inner faces / ports', [me.MoutRad * (p.N - 1) / p.N, me.MoutLat * (p.N - 1) / p.N, me.MinLat, me.Mports].map(x => f(x, 3)).join(' / ') + ' N·m'],
        ...(me.single ? [['Floor friction (single-sided, μ ' + f(p.faceMu, 2) + ')', f(me.MoutFloor * (p.N - 1) / p.N + me.MinFloor, 3) + ' N·m']] : []),
      );
    }
    $('metrics').innerHTML = m.map(([k, v, big]) => `<dt>${k}</dt><dd${big ? ' class="big"' : ''}>${v}</dd>`).join('');

    const d = [
      ['Inner rotor teeth', String(p.N - 1)],
      ['Inner rotor tip Ø', f(2 * p.innerTip, 3) + ' mm'],
      ['Inner rotor root Ø', f(2 * p.innerRoot, 3) + ' mm'],
      ['Outer lobe tip Ø', f(2 * p.outerTip, 3) + ' mm'],
      ['Outer valley Ø', f(2 * p.Rv, 3) + ' mm'],
      ['Pitch Ø (inner / outer)', f(2 * p.pitchInner, 2) + ' / ' + f(2 * p.pitchOuter, 2)],
      ['Trochoid ρmin', ok ? f(res.rhoMin, 3) + ' mm' : '—'],
      ['Chamber area min / max', ok ? f(res.Amin, 2) + ' / ' + f(res.Amax, 2) + ' mm²' : '—'],
      ['Chamber volume min / max (with c)', ok ? f(res.AminActual * p.b, 2) + ' / ' + f(res.AmaxActual * p.b, 1) + ' mm³' : '—'],
      ['Max. contact angle', ok ? f(res.psiContactMax * DEG, 1) + '°' : '—'],
    ];
    const bl = ok && res.backlash;
    if (bl) {
      d.push(
        ['Backlash angle (min / max)', f(bl.deltaMin * DEG * 60, 2) + ' / ' + f(bl.deltaMax * DEG * 60, 2) + ' arcmin'],
        ['Outer rotor speed pulsation', f(bl.speedPulsation * 100, 3) + ' %'],
        ['Tip-to-tip gap at max volume', f(bl.tipToTipGap * 1000, 1) + ' µm'],
      );
    }
    if (pr && pr.suction) {
      const a = x => f(((x * DEG) % 360 + 360) % 360, 1) + '°';
      d.push(
        ['Suction port', a(pr.suction.a0) + ' → ' + a(pr.suction.a1)],
        ['Delivery port', a(pr.delivery.a0) + ' → ' + a(pr.delivery.a1)],
        ['Port radii (outer / inner)', f(p.portRo, 2) + ' / ' + f(p.portRi, 2) + ' mm'],
        ['Port area (each)', f(pr.suction.area, 1) + ' mm²'],
      );
    }
    $('dims').innerHTML = d.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }

  function updateChecks() {
    const order = { err: 0, warn: 1, info: 2, ok: 3 };
    const items = res.checks.slice().sort((a, b) => order[a.level] - order[b.level]);
    $('checks').innerHTML = items.map(c =>
      `<li class="${c.level}"><b>${c.title}</b><span>${c.detail}</span></li>`).join('');
  }

  // ------------------------------------------------------------- view

  function outerAngle() { return innerDeg / DEG * (params.N - 1) / params.N; }

  function viewOpts() {
    return {
      chambers: $('optChambers').checked,
      ports: $('optPorts').checked,
      contacts: $('optContacts').checked,
      pitch: $('optPitch').checked,
      trochoid: $('optTrochoid').checked,
    };
  }

  function drawView() {
    if (!res || !res.A) {
      const ctx = renderer.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, renderer.canvas.width, renderer.canvas.height);
      return;
    }
    renderer.draw(outerAngle(), viewOpts());
    $('angleOut').textContent = innerDeg.toFixed(1) + '°';
    $('angle').value = innerDeg;
    drawMarkers();
  }

  let chartData = null;

  function drawCharts() {
    chartData = null;
    const charts = ['areaChart', 'pressureChart', 'flowChart'];
    for (const id of charts) {
      const c = $(id); c.getContext('2d').clearRect(0, 0, c.width, c.height);
    }
    $('areaLegend').innerHTML = $('flowLegend').innerHTML = '';
    if (!res || !res.A) return;

    const { A, q, M, dt } = res, N = params.N, pr = res.ports;
    const hasPorts = !!(pr && pr.As), hasSim = !!(pr && pr.sim);
    // Housing-angle series for chamber 0 (housing angle = t + pi/N).
    const hx = [], hy = [], hs = [], hd = [], hp = [];
    for (let i = 0; i <= 720; i++) {
      const deg = i / 2;
      const j = Math.round(((deg / DEG - res.chamberOffset) / dt % M + M) % M) % M;
      hx.push(deg); hy.push(A[j]);
      if (hasPorts) { hs.push(pr.As[j]); hd.push(pr.Ad[j]); }
      if (hasSim) hp.push(pr.sim.P[j] / 1e5);
    }
    // Delivery flow over one inner-shaft revolution, normalised by the kinematic mean.
    let mean = 0; for (const v of q) mean += v; mean /= M;
    const qTheo = res.cc * 1e-6 * params.rpm / 60;
    const fx = [], fy = [], fp = [];
    for (let i = 0; i <= 720; i++) {
      const deg = i / 2, j = Math.round(deg / DEG * (N - 1) / N / dt) % M;
      fx.push(deg); fy.push(q[j] / mean);
      if (hasSim) fp.push(pr.Qout[j] / qTheo);
    }
    chartData = { hx, hy, hs, hd, hp, fx, fy, fp, hasPorts, hasSim };

    const legend = items => items.map(([c, l, dash]) =>
      `<span><i class="${dash ? 'dash' : ''}" style="border-color:var(${c})"></i>${l}</span>`).join('');
    if (hasPorts) $('areaLegend').innerHTML = legend([['--accent', 'Chamber area'], ['--suction', 'Open to suction', true], ['--discharge', 'Open to delivery', true]]);
    if (hasSim) $('flowLegend').innerHTML = legend([['--accent', 'Kinematic'], ['--series2', 'Port model', true]]);
    drawMarkers();
  }

  function drawMarkers() {
    if (!chartData) return;
    const t = outerAngle();
    const h = (((t + res.chamberOffset) * DEG) % 360 + 360) % 360;
    const cd = chartData, hj = Math.round(h * 2) % 720;
    const ticks = [0, 90, 180, 270, 360];
    const areaSeries = [{ ys: cd.hy }];
    if (cd.hasPorts) areaSeries.push({ ys: cd.hs, color: '--suction', dash: true }, { ys: cd.hd, color: '--discharge', dash: true });
    G.lineChart($('areaChart'), {
      xs: cd.hx, series: areaSeries, xMin: 0, xMax: 360,
      xTicks: ticks, xLabel: '°', yFromZero: true, marker: [h, cd.hy[hj]],
    });
    if (cd.hasSim) {
      G.lineChart($('pressureChart'), {
        xs: cd.hx, series: [{ ys: cd.hp }], xMin: 0, xMax: 360,
        xTicks: ticks, xLabel: '°', yFromZero: true, marker: [h, cd.hp[hj]],
      });
    }
    const fi = Math.round(innerDeg * 2);
    const flowSeries = [{ ys: cd.fy }];
    if (cd.hasSim) flowSeries.push({ ys: cd.fp, color: '--series2', dash: true });
    G.lineChart($('flowChart'), {
      xs: cd.fx, series: flowSeries, xMin: 0, xMax: 360,
      xTicks: ticks, xLabel: '°', refY: 1, marker: [innerDeg, cd.fy[fi]],
    });
  }

  // Charts redraw at most ~15 fps during animation.
  let lastChart = 0;
  function tick(now) {
    const dtS = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing && params) {
      innerDeg = (innerDeg + dtS * parseFloat($('speed').value)) % 360;
      if (res && res.A) {
        renderer.draw(outerAngle(), viewOpts());
        $('angleOut').textContent = innerDeg.toFixed(1) + '°';
        $('angle').value = innerDeg;
        if (now - lastChart > 66) { drawMarkers(); lastChart = now; }
      }
    }
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------- events

  let pending = false;
  form.addEventListener('input', () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; recompute(); });
  });

  $('resetBtn').addEventListener('click', () => {
    writeForm(DEFAULTS); renderer.fitted = false; recompute();
  });

  $('saveBtn').addEventListener('click', () => {
    G.exporters.download('gerotor.json', JSON.stringify(readForm(), null, 2) + '\n', 'application/json');
  });

  $('loadInput').addEventListener('change', ev => {
    const file = ev.target.files[0];
    if (!file) return;
    file.text().then(txt => {
      try {
        writeForm(Object.assign({}, DEFAULTS, migrate(JSON.parse(txt))));
        renderer.fitted = false;
        recompute();
      } catch (err) {
        alert('Could not read JSON: ' + err.message);
      }
      ev.target.value = '';
    });
  });

  $('playBtn').addEventListener('click', () => {
    playing = !playing;
    $('playBtn').textContent = playing ? '❚❚' : '▶';
    last = performance.now();
  });

  $('angle').addEventListener('input', ev => {
    innerDeg = parseFloat(ev.target.value);
    drawView();
  });
  $('speed').addEventListener('input', ev => { $('speedOut').textContent = ev.target.value + '°/s'; });
  for (const id of ['optChambers', 'optPorts', 'optContacts', 'optPitch', 'optTrochoid']) {
    $(id).addEventListener('change', drawView);
  }

  document.querySelectorAll('[data-export]').forEach(btn => btn.addEventListener('click', () => {
    if (!params || !res || !res.A) return;
    const kind = btn.dataset.export, scope = $('exportScope').value;
    if (!res.valid && !confirm('The design has failing checks. Export anyway?')) return;
    const name = `gerotor_N${params.N}_${scope}.${kind}`;
    const types = { dxf: 'application/dxf', svg: 'image/svg+xml', csv: 'text/csv' };
    if (scope === 'ports' && !(res.ports && res.ports.suction)) { alert('Enable the port model to export the port plate.'); return; }
    G.exporters.download(name, G.exporters[kind](params, scope, res), types[kind]);
  }));

  $('pdfBtn').addEventListener('click', () => {
    if (!params || !res || !res.A) return;
    if (!res.valid && !confirm('The design has failing checks. Export anyway?')) return;
    const scope = $('exportScope').value;
    if (scope === 'ports' && !(res.ports && res.ports.suction)) { alert('Enable the port model to draw the port plate.'); return; }
    G.exporters.download(`gerotor_N${params.N}_${scope}_drawing.pdf`, G.drawing.drawingFor(params, res, scope), 'application/pdf');
  });
  $('stepBtn').addEventListener('click', () => {
    if (!params || !res || !res.A) return;
    if (!res.valid && !confirm('The design has failing checks. Export anyway?')) return;
    const scope = $('exportScope').value === 'ports' ? 'assembly' : $('exportScope').value;
    G.exporters.download(`gerotor_N${params.N}_${scope}.step`, G.step.stepFile(params, res, { scope }), 'model/step');
  });

  $('themeToggle').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('gerotor.theme', root.dataset.theme); } catch (_) { /* ignore */ }
    drawCharts(); drawView();
  });
  try {
    const th = localStorage.getItem('gerotor.theme');
    if (th) document.documentElement.dataset.theme = th;
  } catch (_) { /* ignore */ }

  // Hook for other panels (Design Assist): load a set of parameters into the form.
  G.app = {
    getState() { return { params, res }; },
    applyDesign(values) {
      writeForm(Object.assign(readForm(), values));
      renderer.fitted = false;
      recompute();
    },
  };

  renderer.onChange = drawView;
  const ro = new ResizeObserver(() => {
    renderer.resize();
    if (!renderer.fitted) renderer.fit();
    drawCharts(); drawView();
  });
  ro.observe(renderer.canvas);
  renderer.resize();

  // Fluid library → <select name="oil"> (grouped).
  (function fillOilList() {
    const sel = form.elements.oil, groups = {};
    for (const [key, o] of Object.entries(G.OILS)) {
      if (!groups[o.group]) { groups[o.group] = document.createElement('optgroup'); groups[o.group].label = o.group; sel.appendChild(groups[o.group]); }
      const opt = document.createElement('option');
      opt.value = key; opt.textContent = o.label;
      groups[o.group].appendChild(opt);
    }
  })();

  writeForm(restore());
  recompute();
  requestAnimationFrame(tick);
})(window.Gerotor);
