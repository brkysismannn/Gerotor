/* Canvas renderer for the gerotor assembly (world units mm, y up). */
(function (G) {
  'use strict';

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.view = { scale: 1, cx: 0, cy: 0 };   // cx, cy: world point at canvas centre
      this.fitted = false;
      this.bindInteraction();
    }

    setModel(p, res) {
      this.p = p;
      this.res = res;
      const L = G.lobeLimits(p);
      this.L = L;
      this.innerPts = G.innerProfile(p, Math.max(720, (p.N - 1) * 160), p.rp + p.c);
      this.outerPts = G.outerProfile(p, 90, 30, L);
      this.trochoidPts = G.trochoidCurve(p, 720);
      if (!this.fitted) this.fit();
    }

    fit() {
      if (!this.p) return;
      const r = Math.max(this.p.OD / 2, this.p.Rv + this.p.e) * 1.08;
      const { width, height } = this.size();
      if (!(width > 0 && height > 0)) return;   // not laid out yet; retried on resize
      this.view = { scale: Math.min(width, height) / (2 * r), cx: 0, cy: 0 };
      this.fitted = true;
    }

    size() {
      const r = this.canvas.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = this.size();
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.dpr = dpr;
    }

    toWorld(px, py) {
      const { width, height } = this.size(), v = this.view;
      return [(px - width / 2) / v.scale + v.cx, -(py - height / 2) / v.scale + v.cy];
    }

    bindInteraction() {
      const c = this.canvas;
      c.addEventListener('wheel', ev => {
        ev.preventDefault();
        const rect = c.getBoundingClientRect();
        const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
        const before = this.toWorld(px, py);
        this.view.scale *= Math.exp(-ev.deltaY * 0.0015);
        const after = this.toWorld(px, py);
        this.view.cx += before[0] - after[0];
        this.view.cy += before[1] - after[1];
        this.onChange && this.onChange();
      }, { passive: false });

      let drag = null;
      c.addEventListener('pointerdown', ev => {
        drag = { x: ev.clientX, y: ev.clientY, cx: this.view.cx, cy: this.view.cy };
        c.setPointerCapture(ev.pointerId);
      });
      c.addEventListener('pointermove', ev => {
        if (!drag) return;
        this.view.cx = drag.cx - (ev.clientX - drag.x) / this.view.scale;
        this.view.cy = drag.cy + (ev.clientY - drag.y) / this.view.scale;
        this.onChange && this.onChange();
      });
      const end = () => { drag = null; };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      c.addEventListener('dblclick', () => { this.fit(); this.onChange && this.onChange(); });
    }

    draw(t, opts) {
      const ctx = this.ctx, p = this.p;
      if (!p) return;
      const dpr = this.dpr || 1, { width, height } = this.size(), v = this.view;
      const col = {
        bg: cssVar('--canvas-bg'),
        outer: cssVar('--outer-fill'),
        inner: cssVar('--inner-fill'),
        stroke: cssVar('--rotor-stroke'),
        suction: cssVar('--suction'),
        discharge: cssVar('--discharge'),
        guide: cssVar('--guide'),
        contact: cssVar('--contact'),
        warn: cssVar('--warn'),
        suctionDot: cssVar('--oil-in') || '#1f6fd6',
        dischargeDot: cssVar('--oil-out') || '#e0761c',
      };

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = col.bg;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      const s = v.scale * dpr;
      ctx.setTransform(s, 0, 0, -s, (width / 2 - v.cx * v.scale) * dpr, (height / 2 + v.cy * v.scale) * dpr);
      const px = 1 / v.scale;   // one CSS pixel in world units

      const a1 = G.innerAngle(p, t);
      const C1 = [p.e, 0];

      // Outer rotor body.
      ctx.beginPath();
      ctx.arc(0, 0, p.OD / 2, 0, G.TAU);
      this.polyPath(this.outerPts.map(q => G.rot(q, t)));
      ctx.fillStyle = col.outer;
      ctx.fill('evenodd');
      ctx.lineWidth = 1.2 * px;
      ctx.strokeStyle = col.stroke;
      ctx.stroke();

      // Chambers.
      if (opts.chambers && this.res && this.res.A) {
        const res = this.res;
        for (let k = 0; k < p.N; k++) {
          const tk = t + G.TAU * k / p.N;
          const ch = G.chamber(p, tk, this.L, 40, 14);
          const j = Math.round(((tk % G.TAU) + G.TAU) % G.TAU / res.dt) % res.M;
          const d = res.dA[j];
          ctx.beginPath();
          this.polyPath(ch.polygon);
          if (res.ports && res.ports.As) {
            // Colour by actual port connection.
            const tol = 1e-4 * res.Amax, s = res.ports.As[j] > tol, dl = res.ports.Ad[j] > tol;
            ctx.fillStyle = s && dl ? col.warn : (s ? col.suction : (dl ? col.discharge : col.guide));
          } else {
            ctx.fillStyle = Math.abs(d) < 1e-9 ? col.guide : (d < 0 ? col.discharge : col.suction);
          }
          ctx.globalAlpha = 0.55;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // Oil flow: particles entering through the suction port and leaving through the delivery port,
      // carried with the chambers (outer-rotor rotation), clipped to the chambers.
      if (opts.flow && this.res && this.res.ports && this.res.ports.suction) this.drawOil(t, px, col);
      else this.particles = [];

      // Inner rotor body.
      ctx.beginPath();
      this.polyPath(this.innerPts.map(q => G.add(G.rot(q, a1), C1)));
      if (p.bore > 0) {
        ctx.moveTo(p.e + p.bore / 2, 0);
        ctx.arc(p.e, 0, p.bore / 2, 0, G.TAU, true);
      }
      ctx.fillStyle = col.inner;
      ctx.fill('evenodd');
      ctx.lineWidth = 1.2 * px;
      ctx.strokeStyle = col.stroke;
      ctx.stroke();

      // Guides.
      ctx.lineWidth = 1 * px;
      ctx.strokeStyle = col.guide;
      ctx.setLineDash([6 * px, 4 * px]);
      if (opts.pitch) {
        ctx.beginPath(); ctx.arc(0, 0, p.pitchOuter, 0, G.TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.e, 0, p.pitchInner, 0, G.TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, p.R, 0, G.TAU); ctx.stroke();
      }
      if (opts.trochoid) {
        ctx.beginPath();
        this.polyPath(this.trochoidPts.map(q => G.add(G.rot(q, a1), C1)));
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Port plate outlines (fixed in the housing).
      if (opts.ports && this.res && this.res.ports && this.res.ports.suction) {
        const pr = this.res.ports;
        for (const [port, c] of [[pr.suction, col.suction], [pr.delivery, col.discharge]]) {
          ctx.beginPath();
          this.polyPath(port.outline);
          for (const g of port.grooves || []) this.polyPath(g.outline);
          ctx.globalAlpha = 0.12; ctx.fillStyle = c; ctx.fill(); ctx.globalAlpha = 1;
          ctx.setLineDash([5 * px, 3 * px]);
          ctx.lineWidth = 1.6 * px; ctx.strokeStyle = c; ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.lineWidth = 1 * px;
        ctx.strokeStyle = col.guide;
      }

      // Line of centres and centre marks.
      ctx.beginPath();
      ctx.moveTo(-p.OD / 2, 0); ctx.lineTo(p.OD / 2, 0);
      ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
      this.cross(0, 0, 6 * px, col.stroke);
      this.cross(p.e, 0, 6 * px, col.stroke);

      // Contact points.
      if (opts.contacts) {
        ctx.fillStyle = col.contact;
        for (let k = 0; k < p.N; k++) {
          const ch = G.chamber(p, t + G.TAU * k / p.N, this.L, 2, 2);
          const c = ch.contacts[0];
          ctx.beginPath(); ctx.arc(c[0], c[1], 3.2 * px, 0, G.TAU); ctx.fill();
        }
      }
    }

    drawOil(t, px, col) {
      const ctx = this.ctx, p = this.p, pr = this.res.ports;
      if (!this.particles) this.particles = [];
      let dt = this.lastT === undefined ? 0 : t - this.lastT;
      if (Math.abs(dt) > 0.5) dt = 0;                      // jump (slider / reset): no motion
      this.lastT = t;
      const inside = (pt, poly) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[i], b = poly[j];
          if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
        }
        return c;
      };
      const spawn = (port, kind, n) => {
        const ro = p.portRo, ri = Math.max(0.3 * ro, p.innerRoot - p.e);
        for (let i = 0, tries = 0; i < n && tries < 8 * n; tries++) {
          const a = port.a0 + Math.random() * (port.a1 - port.a0);
          const r = Math.sqrt(ri * ri + Math.random() * (ro * ro - ri * ri));
          const q = [r * Math.cos(a), r * Math.sin(a)];
          if (!inside(q, port.outline)) continue;
          this.particles.push({ r, a, kind, life: kind === 's' ? 1 : 0.9, v: 0.6 + 0.8 * Math.random() });
          i++;
        }
      };
      if (dt > 0) {
        const n = Math.min(40, Math.round(900 * dt));
        spawn(pr.suction, 's', n);
        spawn(pr.delivery, 'd', Math.round(n * 0.7));
      }
      // Advance: carried with the chambers; suction particles drift outward (filling), delivery particles fade fast.
      for (const q of this.particles) {
        q.a += dt * q.v;
        if (q.kind === 's') { q.life -= dt * 0.55; q.r += dt * 0.6; } else { q.life -= dt * 1.3; q.r -= dt * 0.4; }
      }
      this.particles = this.particles.filter(q => q.life > 0).slice(-2500);
      // Clip to the chambers (cavity between the rotors) and draw.
      ctx.save();
      ctx.beginPath();
      for (let k = 0; k < p.N; k++) this.polyPath(G.chamber(p, t + G.TAU * k / p.N, this.L, 24, 10).polygon);
      ctx.clip();
      const rad = 1.5 * px;
      for (const kind of ['s', 'd']) {
        ctx.fillStyle = kind === 's' ? col.suctionDot : col.dischargeDot;
        for (const q of this.particles) {
          if (q.kind !== kind) continue;
          ctx.globalAlpha = Math.max(0, Math.min(1, q.life)) * 0.9;
          ctx.beginPath(); ctx.arc(q.r * Math.cos(q.a), q.r * Math.sin(q.a), rad, 0, G.TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    polyPath(pts) {
      const ctx = this.ctx;
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
    }

    cross(x, y, r, color) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }

  G.Renderer = Renderer;
})(window.Gerotor);
