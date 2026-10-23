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
