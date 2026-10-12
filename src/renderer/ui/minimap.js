// Canvas minimap: one colored bar per token, with a viewport slider you can click or drag.

const LINE_H = 3;      // css px per source line
const CHAR_W = 1.25;   // css px per source column
const TOKEN_VARS = {
  kw: '--t-kw', str: '--t-str', num: '--t-num', com: '--t-com', fn: '--t-fn', typ: '--t-typ', op: '--t-op',
  tag: '--t-tag', attr: '--t-attr', prop: '--t-prop', var: '--t-var', hd: '--t-hd', em: '--t-em', link: '--t-link', add: '--t-add', del: '--t-del', hunk: '--t-hunk', meta: '--t-meta',
};

export class Minimap {
  constructor(editor) {
    this.editor = editor;
    this.root = document.createElement('div');
    this.root.className = 'minimap';
    this.canvas = document.createElement('canvas');
    this.slider = document.createElement('div');
    this.slider.className = 'slider';
    this.root.append(this.canvas, this.slider);
    editor.root.append(this.root);
    this.colors = {};
    this.raf = 0;
    this.enabled = true;
    this.refreshColors();

    editor.on('scroll', () => this.schedule());
    editor.on('change', () => this.schedule());
    editor.on('cursor', () => {});
    new ResizeObserver(() => this.schedule()).observe(this.root);

    const jump = (e) => {
      const r = this.root.getBoundingClientRect();
      const { start } = this.geometry();
      const line = Math.floor(start + (e.clientY - r.top) / LINE_H);
      editor.centerLine(Math.max(0, Math.min(editor.buffer.lineCount - 1, line)));
    };
    this.root.addEventListener('mousedown', (e) => {
      e.preventDefault();
      jump(e);
      this.root.classList.add('drag');
      const move = (ev) => jump(ev);
      const up = () => { this.root.classList.remove('drag'); window.removeEventListener('mousemove', move); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up, { once: true });
    });
  }

  setEnabled(on) {
    this.enabled = on;
    this.root.style.display = on ? '' : 'none';
    if (on) this.schedule();
  }

  refreshColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const [k, v] of Object.entries(TOKEN_VARS)) this.colors[k] = cs.getPropertyValue(v).trim();
    this.colors.plain = cs.getPropertyValue('--editor-fg').trim();
    this.schedule();
  }

  schedule() {
    if (this.raf || !this.enabled) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  // First source line shown, given how many fit in the minimap.
  geometry() {
    const ed = this.editor;
    const h = this.root.clientHeight;
    const total = ed.doc ? ed.buffer.lineCount : 0;
    const capacity = Math.max(1, Math.floor(h / LINE_H));
    const sc = ed.scroller;
    const maxScroll = Math.max(1, sc.scrollHeight - sc.clientHeight);
    const start = total > capacity ? Math.round((sc.scrollTop / maxScroll) * (total - capacity)) : 0;
    return { start, capacity, total };
  }

  draw() {
    const ed = this.editor;
    const w = this.root.clientWidth, h = this.root.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!ed.doc) return;
    const { start, capacity, total } = this.geometry();
    const end = Math.min(total, start + capacity);
    const tabSize = ed.tabSize;
    const maxCols = Math.floor((w - 6) / CHAR_W);

    for (let i = start; i < end; i++) {
      const text = ed.buffer.getLine(i);
      if (!text.trim()) continue;
      const y = (i - start) * LINE_H;
      const toks = ed.doc.tokens(i);
      let pos = 0, col = 0;
      const bar = (from, to, color) => {
        // translate string indexes to visual columns (tabs expand)
        let x0 = col;
        for (let k = pos; k < from; k++) x0 += text.charCodeAt(k) === 9 ? tabSize - (x0 % tabSize) : 1;
        let x1 = x0;
        for (let k = from; k < to; k++) x1 += text.charCodeAt(k) === 9 ? tabSize - (x1 % tabSize) : 1;
        pos = to; col = x1;
        if (x0 >= maxCols) return;
        const startsBlank = /^\s+$/.test(text.slice(from, to));
        if (startsBlank) return;
        ctx.fillStyle = color;
        ctx.fillRect(3 + x0 * CHAR_W, y, Math.max(1, Math.min(x1, maxCols) - x0) * CHAR_W, LINE_H - 1);
      };
      ctx.globalAlpha = 0.85;
      let cursor = 0;
      for (const t of toks) {
        if (t.s > cursor) { pos = pos; bar(cursor, t.s, this.colors.plain); }
        bar(t.s, t.e, this.colors[t.t] || this.colors.plain);
        cursor = t.e;
      }
      if (cursor < text.length) bar(cursor, text.length, this.colors.plain);
      ctx.globalAlpha = 1;
    }

    // viewport slider
    const [vFirst, vLast] = ed.visibleLines();
    const first = vFirst;
    const visible = Math.max(1, vLast - vFirst);
    const top = Math.max(0, (first - start) * LINE_H);
    const height = Math.min(h - top, visible * LINE_H);
    this.slider.style.top = top + 'px';
    this.slider.style.height = Math.max(8, height) + 'px';
  }
}
