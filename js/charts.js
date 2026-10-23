/* Minimal line chart on canvas. */
(function (G) {
  'use strict';

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  /*
   * opts: { xs, ys | series: [{ ys, color, dash }], xMin, xMax, xTicks, xLabel,
   *         refY, marker: [x, y], yFromZero }
   * The marker is drawn on the first series.
   */
  function lineChart(canvas, opts) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rect.width, H = rect.height;
    const pad = { l: 46, r: 10, t: 10, b: 30 };
    const text = cssVar('--text-muted'), grid = cssVar('--grid'), line = cssVar('--accent');
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px ' + cssVar('--font-mono');

    const { xs } = opts;
    const series = opts.series || [{ ys: opts.ys }];
    let yMin = Infinity, yMax = -Infinity;
    for (const s of series) for (const y of s.ys) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
    if (opts.refY !== undefined) { yMin = Math.min(yMin, opts.refY); yMax = Math.max(yMax, opts.refY); }
    if (opts.yFromZero) yMin = Math.min(0, yMin);
    const padY = (yMax - yMin) * 0.08 || Math.abs(yMax) * 0.1 || 1;
    yMin -= padY; yMax += padY;
    const xMin = opts.xMin, xMax = opts.xMax;
    const X = x => pad.l + (x - xMin) / (xMax - xMin) * (W - pad.l - pad.r);
    const Y = y => H - pad.b - (y - yMin) / (yMax - yMin) * (H - pad.t - pad.b);

    ctx.strokeStyle = grid; ctx.fillStyle = text; ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of niceTicks(yMin, yMax, 4)) {
      ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(W - pad.r, Y(v)); ctx.stroke();
      ctx.fillText(formatTick(v), pad.l - 6, Y(v));
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of opts.xTicks) {
      ctx.beginPath(); ctx.moveTo(X(v), pad.t); ctx.lineTo(X(v), H - pad.b); ctx.stroke();
      ctx.fillText(String(v), X(v), H - pad.b + 5);
    }
    if (opts.xLabel) { ctx.textAlign = 'right'; ctx.fillText(opts.xLabel, W - pad.r, H - 13); }

    if (opts.refY !== undefined) {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = text;
      ctx.beginPath(); ctx.moveTo(pad.l, Y(opts.refY)); ctx.lineTo(W - pad.r, Y(opts.refY)); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (let k = series.length - 1; k >= 0; k--) {
      const s = series[k];
      ctx.strokeStyle = s.color ? cssVar(s.color) : line;
      ctx.setLineDash(s.dash ? [5, 4] : []);
      ctx.beginPath();
      for (let i = 0; i < xs.length; i++) {
        if (i === 0) ctx.moveTo(X(xs[i]), Y(s.ys[i])); else ctx.lineTo(X(xs[i]), Y(s.ys[i]));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (opts.marker) {
      const [mx, my] = opts.marker;
      ctx.strokeStyle = text; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(mx), pad.t); ctx.lineTo(X(mx), H - pad.b); ctx.stroke();
      ctx.fillStyle = line;
      ctx.beginPath(); ctx.arc(X(mx), Y(my), 4, 0, 2 * Math.PI); ctx.fill();
    }
  }

  function formatTick(v) {
    const a = Math.abs(v);
    if (a >= 1000) return v.toFixed(0);
    if (a >= 10) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }

  G.lineChart = lineChart;
})(window.Gerotor);
