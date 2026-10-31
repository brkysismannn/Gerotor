/*
 * Free numeric entry. Number fields are plain text inputs (type="text" inputmode="decimal" data-num) so that typing,
 * paste, select-all and both decimal separators work in every browser/locale; type="number" blocks free typing in some
 * locales and offers only spinner steps. Rules:
 *  - focus selects the whole value; ArrowUp / ArrowDown step by the step attribute (1 if "any" or missing), Enter commits;
 *  - a value is committed on Enter or blur: the browser fires "change", and before any other handler sees it the text is
 *    normalised ("3,5" -> "3.5", "1.234,5" -> "1234.5", spaces removed). Nothing is recalculated per keystroke;
 *  - G.debounce coalesces bursts of commits into one recalculation (default delay G.num.DEBOUNCE_MS).
 */
(function (G) {
  'use strict';

  // Delay after the last commit before the (expensive) recalculation runs. User-experience setting: a full analysis takes
  // 0.5-2.5 s, so repeated commits (Enter, Tab through fields, arrow-key stepping) are merged; 300 ms is within the
  // 250-400 ms range requested by the owner and is shorter than the time between two deliberate edits.
  const DEBOUNCE_MS = 300;

  // "3,5" / "3.5" / "1.234,5" / "1,234.5" / " 7 " -> canonical text with a dot, or null when it is not a number.
  function normalise(text) {
    let s = String(text).replace(/[\s ']/g, '');
    if (s === '') return '';
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc >= 0) s = s.replace(/,/g, (m, i) => (i === lc ? '.' : ''));
    return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ? s : null;
  }
  function parse(text) { const n = normalise(text); return n === null || n === '' ? NaN : parseFloat(n); }

  // Trailing-edge debounce; `timers` can be injected for tests: { set(fn, ms) -> id, clear(id) }.
  function debounce(fn, ms, timers) {
    const T = timers || { set: (f, d) => setTimeout(f, d), clear: id => clearTimeout(id) };
    let id = null;
    const d = function () { if (id !== null) T.clear(id); id = T.set(() => { id = null; fn(); }, ms); };
    d.flush = () => { if (id !== null) { T.clear(id); id = null; fn(); } };
    d.pending = () => id !== null;
    return d;
  }

  const isNum = el => el && el.tagName === 'INPUT' && el.hasAttribute('data-num');
  const editing = () => { const a = document.activeElement; return !!a && (isNum(a) || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type === 'text')); };

  if (typeof document !== 'undefined' && document.addEventListener) {
    let keepSel = null;
    document.addEventListener('focusin', ev => { if (isNum(ev.target)) { keepSel = ev.target; ev.target.select(); } }, true);
    document.addEventListener('mouseup', ev => { if (keepSel && ev.target === keepSel) { ev.preventDefault(); } keepSel = null; }, true);
    document.addEventListener('change', ev => {                       // capture: runs before the form handlers
      const el = ev.target; if (!isNum(el)) return;
      const n = normalise(el.value);
      if (n !== null) el.value = n;                                    // invalid text stays visible and is reported by validate()
    }, true);
    document.addEventListener('keydown', ev => {
      const el = ev.target; if (!isNum(el)) return;
      if (ev.key === 'Enter') { ev.preventDefault(); const v = el.value; el.blur(); el.focus(); el.select(); if (el.value !== v) el.value = v; return; }
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        const v = parse(el.value); if (!Number.isFinite(v)) return;
        ev.preventDefault();
        const st = parseFloat(el.getAttribute('step')); const stp = Number.isFinite(st) && st > 0 ? st : 1;
        let nv = v + (ev.key === 'ArrowUp' ? stp : -stp);
        const mn = el.getAttribute('min'), mx = el.getAttribute('max');
        if (mn !== null && mn !== '') nv = Math.max(nv, +mn); if (mx !== null && mx !== '') nv = Math.min(nv, +mx);
        el.value = String(+nv.toPrecision(12)); el.dispatchEvent(new Event('change', { bubbles: true })); el.select();
      }
    }, true);
  }

  G.num = { normalise, parse, debounce, editing, isNum, DEBOUNCE_MS };
  G.debounce = debounce;
})(window.Gerotor = window.Gerotor || {});
