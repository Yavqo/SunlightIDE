// The SunlightIDE editing surface: a virtualized, DOM-based code editor written from scratch.
// Owns rendering, input, selection, search highlighting, bracket matching and completion.
// It never touches the filesystem; the app layer feeds it Document objects.

import { Buffer, Pos, cmp, eq, buildRegex } from './buffer.js';
import { snippetsFor, expandSnippet } from './snippets.js';
import { HTML_TAGS, BOOLEAN_ATTRS, attrsFor, openTagStack, contextAt, tagToClose } from './html.js';
import { normalize, shiftAfter, mergeLineRanges, startOf, endOf, isEmpty, eqPos } from './selection.js';
import { computeBreaks, rowInLine, rowRange, buildRowIndex, lineOfRow, hangCols, visualWidth, NO_BREAKS } from './wrap.js';
import { tokenizeLine, languageForFile, keywordsFor, commentPrefix, commentBlock, PAIRS, CLOSERS } from './tokenizer.js';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const OVERSCAN = 6;
const QUOTES = `'"\``;
const PAD_X = 12;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const P = (line, col) => new Pos(line, col);
const copyPos = (p) => new Pos(p.line, p.col);
const clone = (p) => ({ line: p.line, col: p.col });
const relEnd = (str) => { const parts = str.split('\n'); return { line: parts.length - 1, col: parts[parts.length - 1].length }; };

function charClass(c) {
  if (c === undefined) return 0;
  if (/\s/.test(c)) return 1;
  if (/[\w$]/.test(c)) return 2;
  return 3;
}

function detectIndent(text) {
  const lines = text.split('\n', 400);
  let tabs = 0, spaces = 0;
  const diffs = new Map();
  let prev = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    if (l[0] === '\t') { tabs++; continue; }
    const m = /^ +/.exec(l);
    const n = m ? m[0].length : 0;
    if (n) { spaces++; const d = Math.abs(n - prev); if (d > 0 && d <= 8) diffs.set(d, (diffs.get(d) || 0) + 1); }
    prev = n;
  }
  if (tabs > spaces) return { insertSpaces: false, tabSize: 4 };
  let best = 0, size = 4;
  for (const [d, c] of diffs) if (c > best && (d === 2 || d === 4 || d === 8)) { best = c; size = d; }
  return { insertSpaces: true, tabSize: size };
}

// A document is a buffer plus per-file editor state (language, caret, scroll, token cache).
export class Document {
  constructor({ path = null, name = 'Untitled', text = '', lang } = {}) {
    this.path = path;
    this.name = name;
    this.buffer = new Buffer(text);
    this.lang = lang || languageForFile(name);
    this.indent = detectIndent(text);
    this.view = { scrollTop: 0, scrollLeft: 0, anchor: P(0, 0), head: P(0, 0), sels: null, main: 0 };
    this.mtime = null;
    this.resetTokens();
    this.buffer.onChange((c) => {
      this.tok.valid = Math.min(this.tok.valid, c.start.line);
    });
    this.wordsVersion = -1;
    this.words = new Set();
  }

  resetTokens() {
    this.tok = { valid: 0, states: [0], lines: [] };
  }

  setLang(lang) {
    this.lang = lang;
    this.resetTokens();
  }

  tokens(line) {
    const c = this.tok;
    const b = this.buffer;
    while (c.valid <= line && c.valid < b.lineCount) {
      const i = c.valid;
      const state = c.states[i] ?? 0;
      const text = b.getLine(i);
      const r = text.length > 20000 ? { tokens: [], state } : tokenizeLine(this.lang, text, state);
      c.lines[i] = r.tokens;
      c.states[i + 1] = r.state;
      c.valid = i + 1;
    }
    return c.lines[line] || [];
  }

  // Words used in the document, for completion. Cached per buffer version.
  collectWords() {
    if (this.wordsVersion === this.buffer.version) return this.words;
    const set = new Set(keywordsFor(this.lang));
    const re = /[A-Za-z_$][\w$]{2,}/g;
    const lines = this.buffer.lines;
    const limit = Math.min(lines.length, 30000);
    for (let i = 0; i < limit; i++) {
      const l = lines[i];
      if (l.length > 2000) continue;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(l))) set.add(m[0]);
    }
    this.words = set;
    this.wordsVersion = this.buffer.version;
    return set;
  }
}

export class Editor {
  constructor(parent, opts = {}) {
    this.opts = { fontSize: 13, lineHeightRatio: 1.62, tabSize: 4, autoClose: true, wordWrap: false, ...opts };
    this.doc = null;
    // Selections are kept sorted and non-overlapping. `main` is the one that drives scrolling,
    // completion and the status bar; `anchor`/`head` always refer to it.
    this.main = { anchor: P(0, 0), head: P(0, 0) };
    this.sels = [this.main];
    this.focused = false;
    this.composing = false;
    this.handlers = {};
    this.matches = [];
    this.matchIndex = -1;
    this.findOpts = null;
    this.completion = null;
    this.rafPending = false;
    this.readOnly = false;
    this.marks = { lines: new Map(), dels: new Set() };
    // soft wrap
    this.wrap = false;
    this.wrapCols = Infinity;
    this.brk = [];
    this.rowIdx = null;
    this.totalRows = 0;
    this.rowsDirty = true;
    this._wrapKey = '';
    this._build(parent);
    this.measure();
    this._bind();
  }

  get anchor() { return this.main.anchor; }
  set anchor(v) { this.main.anchor = v; }
  get head() { return this.main.head; }
  set head(v) { this.main.head = v; }
  get goalV() { return this.main.goalV ?? null; }
  set goalV(v) { this.main.goalV = v; }

  // --- tiny event emitter ---
  on(evt, fn) { (this.handlers[evt] ||= []).push(fn); return this; }
  emit(evt, data) { for (const fn of this.handlers[evt] || []) fn(data); }

  _build(parent) {
    this.root = document.createElement('div');
    this.root.className = 'ed';
    this.root.innerHTML = `
      <div class="ed-gutter"><div class="ed-gutter-inner"></div></div>
      <div class="ed-scroller" tabindex="-1">
        <div class="ed-sizer">
          <div class="ed-curline"></div>
          <div class="ed-layer ed-find"></div>
          <div class="ed-layer ed-sel"></div>
          <div class="ed-lines"></div>
          <div class="ed-layer ed-brackets"></div>
          <div class="ed-ghost" hidden></div>
          <div class="ed-layer ed-cursors"></div>
          <div class="ed-cursor"></div>
        </div>
      </div>
      <textarea class="ed-input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="Editor input"></textarea>
      <div class="ed-complete" hidden></div>
      <div class="ed-empty" hidden></div>`;
    parent.appendChild(this.root);
    const q = (s) => this.root.querySelector(s);
    this.gutter = q('.ed-gutter');
    this.gutterInner = q('.ed-gutter-inner');
    this.scroller = q('.ed-scroller');
    this.sizer = q('.ed-sizer');
    this.curLineEl = q('.ed-curline');
    this.findEl = q('.ed-find');
    this.selEl = q('.ed-sel');
    this.linesEl = q('.ed-lines');
    this.bracketEl = q('.ed-brackets');
    this.cursorEl = q('.ed-cursor');
    this.cursorsEl = q('.ed-cursors');
    this.ghostEl = q('.ed-ghost');
    this.input = q('.ed-input');
    this.completeEl = q('.ed-complete');
    this.emptyEl = q('.ed-empty');
    this.applyOptions();
  }

  applyOptions() {
    const o = this.opts;
    this.lh = Math.round(o.fontSize * o.lineHeightRatio);
    this.wrap = !!o.wordWrap;
    const s = this.root.style;
    s.setProperty('--ed-font-size', o.fontSize + 'px');
    s.setProperty('--ed-lh', this.lh + 'px');
    s.setProperty('--ed-tab', String(this.doc ? this.doc.indent.tabSize : o.tabSize));
    this.root.classList.toggle('wrap', this.wrap);
  }

  setOptions(patch) {
    Object.assign(this.opts, patch);
    this.applyOptions();
    this.measure();
    this.layout();
    this.scheduleRender();
  }

  // Measure the monospace character width with a probe element.
  measure() {
    const probe = document.createElement('span');
    probe.className = 'ed-probe';
    probe.textContent = 'M'.repeat(100);
    this.sizer.appendChild(probe);
    this.charW = probe.getBoundingClientRect().width / 100 || 8;
    probe.remove();
  }

  get tabSize() { return this.doc ? this.doc.indent.tabSize : this.opts.tabSize; }
  get indentUnit() { return !this.doc || this.doc.indent.insertSpaces ? ' '.repeat(this.tabSize) : '\t'; }
  get buffer() { return this.doc.buffer; }

  // --- document attach/detach ---
  setDoc(doc) {
    if (this.doc) this.saveViewState();
    this.unsub?.();
    this.doc = doc;
    this.closeCompletion();
    this.matches = [];
    this.matchIndex = -1;
    this.brk = [];
    this.rowsDirty = true;
    this._wrapKey = '';
    this.emptyEl.hidden = !!doc;
    this.root.classList.toggle('no-doc', !doc);
    if (doc) { this.scroller.classList.remove('fade'); void this.scroller.offsetWidth; this.scroller.classList.add('fade'); this.gutter.classList.remove('fade'); void this.gutter.offsetWidth; this.gutter.classList.add('fade'); }
    if (!doc) { this.scheduleRender(); return; }
    this.root.style.setProperty('--ed-tab', String(doc.indent.tabSize));
    this.unsub = doc.buffer.onChange((c) => this._onBufferChange(c));
    const v = doc.view;
    if (v.sels && v.sels.length) {
      const list = v.sels.map((s) => ({ anchor: clone(s.anchor), head: clone(s.head) }));
      this.sels = list;
      this.main = list[v.main] || list[0];
      this.commitSels(list, this.main, { reveal: false, sealUndo: false, quiet: true });
    } else {
      this.main = { anchor: copyPos(v.anchor), head: copyPos(v.head) };
      this.sels = [this.main];
    }
    this.longest = 0;
    for (const l of doc.buffer.lines) if (l.length > this.longest) this.longest = l.length;
    this.layout();
    this.scroller.scrollTop = v.scrollTop;
    this.scroller.scrollLeft = v.scrollLeft;
    if (this.findOpts) this.recomputeMatches(false);
    this.scheduleRender();
    this.emitCursor();
  }

  saveViewState() {
    if (!this.doc) return;
    this.doc.view = {
      scrollTop: this.scroller.scrollTop, scrollLeft: this.scroller.scrollLeft,
      anchor: copyPos(this.anchor), head: copyPos(this.head),
      sels: this.sels.map((s) => ({ anchor: clone(s.anchor), head: clone(s.head) })), main: this.sels.indexOf(this.main),
    };
  }

  focus() { this.input.focus({ preventScroll: true }); }

  // Change markers for the gutter: lines -> 'add' | 'mod', dels -> line indexes with removed lines above.
  setGutterMarks(marks) {
    this.marks = marks || { lines: new Map(), dels: new Set() };
    this.scheduleRender();
  }

  _onBufferChange(c) {
    // A second view of this buffer keeps its own caret, transformed by edits from the focused view.
    if (this.isActiveView && !this.isActiveView()) {
      const main = this.sels.indexOf(this.main);
      const transform = (p) => this.buffer.clampPos(cmp(p, c.start) < 0 ? p : cmp(p, c.oldEnd) >= 0 ? shiftAfter(p, c.oldEnd, c.newEnd) : c.newEnd);
      this.sels = this.sels.map((s) => ({ anchor: transform(s.anchor), head: transform(s.head) }));
      this.main = this.sels[main] || this.sels[0];
      this.closeCompletion();
    }
    const text = c.inserted.split(/\r\n|\r|\n/);
    for (let i = 0; i < text.length; i++) {
      const len = this.buffer.getLine(c.start.line + i).length;
      if (len > this.longest) this.longest = len;
    }
    // keep the per-line wrap cache aligned with the buffer's lines
    if (this.wrap) {
      const oldN = c.oldEnd.line - c.start.line + 1, newN = c.newEnd.line - c.start.line + 1;
      if (oldN > 3000 || newN > 3000) this.brk = [];
      else if (this.brk.length > c.start.line) this.brk.splice(c.start.line, oldN, ...new Array(newN).fill(undefined));
    }
    this.rowsDirty = true;
    this.layout();
    if (this.findOpts) {
      clearTimeout(this._findTimer);
      this._findTimer = setTimeout(() => this.recomputeMatches(false), 120);
    }
    this.emit('change', this.doc);
    this.scheduleRender();
  }

  // --- soft wrap geometry ---
  // With wrapping off, "row" == "line" and none of the tables below are used.
  breaksOf(line) {
    if (!this.wrap) return NO_BREAKS;
    let b = this.brk[line];
    if (!b) { b = computeBreaks(this.buffer.getLine(line), this.wrapCols, this.tabSize); this.brk[line] = b; }
    return b;
  }

  ensureRows() {
    if (!this.rowsDirty || !this.doc) return;
    const n = this.buffer.lineCount;
    this._builtWrap = this.wrap;
    if (!this.wrap) { this.rowIdx = null; this.totalRows = n; } else {
      const counts = new Array(n);
      for (let i = 0; i < n; i++) counts[i] = this.breaksOf(i).length + 1;
      this.rowIdx = buildRowIndex(counts);
      this.totalRows = this.rowIdx[n];
    }
    this.rowsDirty = false;
  }

  rowOfLine(line) { this.ensureRows(); return this.wrap ? this.rowIdx[Math.min(line, this.rowIdx.length - 1)] : line; }
  lineOfRowN(row) { this.ensureRows(); return this.wrap ? lineOfRow(this.rowIdx, row) : clamp(row, 0, this.buffer.lineCount - 1); }
  rowsInLine(line) { return this.wrap ? this.breaksOf(line).length + 1 : 1; }

  // Recompute the wrap width; if it changed, rebuild the layout while keeping the top line in place.
  updateWrap() {
    const cols = this.wrap ? Math.max(12, Math.floor((this.scroller.clientWidth - PAD_X - 20) / this.charW)) : Infinity;
    const key = `${this.wrap}|${cols}|${this.tabSize}`;
    if (key === this._wrapKey) return;
    const hadKey = this._wrapKey !== '';
    let topLine = 0;
    if (hadKey && this.doc) {
      // Use the layout the current scroll position was measured in (it may differ from the new mode).
      const row = Math.floor(this.scroller.scrollTop / this.lh);
      topLine = this._builtWrap && this.rowIdx ? lineOfRow(this.rowIdx, row) : clamp(row, 0, this.buffer.lineCount - 1);
    }
    this._wrapKey = key;
    this.wrapCols = cols;
    this.brk = [];
    this.rowsDirty = true;
    if (hadKey && this.doc) {
      this.ensureRows();
      this.scroller.scrollTop = this.rowOfLine(topLine) * this.lh;
      this.scroller.scrollLeft = 0;
    }
  }

  layout() {
    if (!this.doc) return;
    this.updateWrap();
    this.ensureRows();
    const n = this.buffer.lineCount;
    const digits = Math.max(3, String(n).length);
    this.gutterW = Math.round(digits * this.charW + 36);
    this.root.style.setProperty('--ed-gutter-w', this.gutterW + 'px');
    this.sizer.style.height = this.totalRows * this.lh + this.scroller.clientHeight * 0.5 + 'px';
    this.sizer.style.width = this.wrap ? '' : PAD_X + this.longest * this.charW + 80 + 'px';
  }

  // First and last logical lines currently in view.
  visibleLines() {
    const st = this.scroller.scrollTop, vh = this.scroller.clientHeight;
    return [this.lineOfRowN(Math.floor(st / this.lh)), this.lineOfRowN(Math.ceil((st + vh) / this.lh))];
  }

  // --- coordinate helpers ---
  vcol(text, col) {
    if (!text.includes('\t')) return col;
    const t = this.tabSize;
    let v = 0;
    for (let i = 0; i < col; i++) v += text.charCodeAt(i) === 9 ? t - (v % t) : 1;
    return v;
  }

  colFromV(text, target) {
    if (target <= 0) return 0;
    if (!text.includes('\t')) return Math.min(text.length, Math.round(target));
    const t = this.tabSize;
    let v = 0;
    for (let i = 0; i < text.length; i++) {
      const w = text.charCodeAt(i) === 9 ? t - (v % t) : 1;
      if (target < v + w / 2) return i;
      v += w;
    }
    return text.length;
  }

  // Pixel position (inside the sizer) of a text position.
  xy(line, col) {
    const text = this.buffer.getLine(line);
    if (!this.wrap) return { x: PAD_X + this.vcol(text, col) * this.charW, y: line * this.lh };
    const br = this.breaksOf(line);
    const r = rowInLine(br, col);
    const rs = r ? br[r - 1] : 0;
    return {
      x: PAD_X + (r ? hangCols(br) * this.charW : 0) + visualWidth(text, this.tabSize, rs, col) * this.charW,
      y: (this.rowOfLine(line) + r) * this.lh,
    };
  }

  xOf(line, col) { return this.xy(line, col).x; }

  // Visual row of a position and its visual column within that row (hanging indent included).
  rowAndVcol(p) {
    const text = this.buffer.getLine(p.line);
    const br = this.breaksOf(p.line);
    const r = rowInLine(br, p.col);
    const rs = r ? br[r - 1] : 0;
    return { row: this.rowOfLine(p.line) + r, v: (r ? hangCols(br) : 0) + visualWidth(text, this.tabSize, rs, p.col) };
  }

  // Text position for a visual row and visual column.
  posFromRowV(row, v) {
    const line = this.lineOfRowN(row);
    const text = this.buffer.getLine(line);
    const br = this.breaksOf(line);
    const r = clamp(row - this.rowOfLine(line), 0, br.length);
    const [rs, re] = rowRange(br, r, text.length);
    let col = rs + this.colFromV(text.slice(rs, re), v - (r ? hangCols(br) : 0));
    if (r < br.length) col = Math.min(col, Math.max(rs, re - 1)); // never land on the next row's start
    return P(line, col);
  }

  posFromPoint(clientX, clientY) {
    const r = this.scroller.getBoundingClientRect();
    const y = clientY - r.top + this.scroller.scrollTop;
    const x = clientX - r.left + this.scroller.scrollLeft - PAD_X;
    this.ensureRows();
    const row = clamp(Math.floor(y / this.lh), 0, this.totalRows - 1);
    return this.posFromRowV(row, x / this.charW);
  }

  // --- rendering ---
  scheduleRender() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => { this.rafPending = false; this.render(); });
  }

  // HTML for text[rs, re) of a line with syntax colours, clipped to the range.
  rangeHtml(i, rs, re) {
    const text = this.buffer.getLine(i);
    if (rs >= re) return '';
    const toks = this.doc.tokens(i);
    let html = '', pos = rs;
    for (const t of toks) {
      if (t.e <= rs) continue;
      if (t.s >= re) break;
      const s = Math.max(t.s, rs), e = Math.min(t.e, re);
      if (s > pos) html += esc(text.slice(pos, s));
      html += `<span class="t-${t.t}">${esc(text.slice(s, e))}</span>`;
      pos = e;
    }
    if (pos < re) html += esc(text.slice(pos, re));
    return html;
  }

  render() {
    if (!this.doc) {
      this.linesEl.innerHTML = '';
      this.gutterInner.innerHTML = '';
      for (const el of [this.selEl, this.findEl, this.bracketEl, this.cursorsEl]) el.innerHTML = '';
      this.cursorEl.style.display = 'none';
      this.curLineEl.style.display = 'none';
      return;
    }
    this.ensureRows();
    const lh = this.lh, cw = this.charW;
    const st = this.scroller.scrollTop, vh = this.scroller.clientHeight;
    const firstRow = Math.max(0, Math.floor(st / lh) - OVERSCAN);
    const lastRow = Math.min(this.totalRows - 1, Math.ceil((st + vh) / lh) + OVERSCAN);
    const first = this.lineOfRowN(firstRow), last = this.lineOfRowN(lastRow);
    this.first = first; this.last = last;

    let html = '', nums = '';
    const curLine = this.head.line;
    const lastIdx = this.buffer.lineCount - 1;
    const mk = (i) => {
      let c = '';
      const kind = this.marks.lines.get(i);
      if (kind) c += ` gm-${kind}`;
      if (this.marks.dels.has(i)) c += ' gm-del';
      if (i === lastIdx && this.marks.dels.has(i + 1)) c += ' gm-del-end';
      return c;
    };
    for (let i = first; i <= last; i++) {
      const len = this.buffer.getLine(i).length;
      const rows = this.rowsInLine(i);
      if (rows === 1) {
        html += `<div class="ln">${this.rangeHtml(i, 0, len)}</div>`;
        nums += `<div class="gn${i === curLine ? ' cur' : ''}${mk(i)}" data-l="${i}">${i + 1}</div>`;
      } else {
        const br = this.breaksOf(i), hang = hangCols(br) * cw;
        let inner = '';
        for (let r = 0; r < rows; r++) {
          const [rs, re] = rowRange(br, r, len);
          inner += `<div class="vr"${r ? ` style="padding-left:${hang}px"` : ''}>${this.rangeHtml(i, rs, re)}</div>`;
        }
        html += `<div class="ln">${inner}</div>`;
        nums += `<div class="gn${i === curLine ? ' cur' : ''}${mk(i)}" data-l="${i}" style="height:${rows * lh}px">${i + 1}</div>`;
      }
    }
    const top = this.rowOfLine(first) * lh;
    this.linesEl.style.transform = `translate(${PAD_X}px, ${top}px)`;
    this.linesEl.innerHTML = html;
    this.gutterInner.style.transform = `translateY(${top - st}px)`;
    this.gutterInner.innerHTML = nums;

    this.renderOverlays(first, last);
    this.emit('render', { first, last });
    this.root.classList.toggle('focused', this.focused);
  }

  // Highlight rectangles for text [c1, c2) of one line, one per visual row it touches.
  // `nl` extends the last row slightly to show that the selection includes the line break.
  rowRects(line, c1, c2, nl) {
    const text = this.buffer.getLine(line);
    const br = this.breaksOf(line);
    const cw = this.charW, lh = this.lh, tab = this.tabSize;
    const base = this.rowOfLine(line);
    const out = [];
    const rows = br.length + 1;
    for (let r = 0; r < rows; r++) {
      const [rs, re] = rowRange(br, r, text.length);
      const lastRow = r === rows - 1;
      const s = Math.max(c1, rs), e = Math.min(c2, re);
      if (!(s < e || (lastRow && nl))) continue;
      const off = PAD_X + (r ? hangCols(br) * cw : 0);
      const x1 = off + visualWidth(text, tab, rs, Math.min(s, re)) * cw;
      let x2 = off + visualWidth(text, tab, rs, Math.max(Math.min(e, re), Math.min(s, re))) * cw;
      if (lastRow && nl) x2 += cw * 0.6;
      out.push({ y: (base + r) * lh, x1, w: Math.max(2, x2 - x1) });
    }
    return out;
  }

  renderOverlays(first, last) {
    const lh = this.lh, cw = this.charW;
    const rect = (r, cls = '') => `<div class="r${cls}" style="top:${r.y}px;left:${r.x1}px;width:${r.w}px"></div>`;

    // Current line (main cursor only)
    const mainEmpty = isEmpty(this.main);
    this.curLineEl.style.display = mainEmpty && this.sels.length === 1 ? 'block' : 'none';
    this.curLineEl.style.top = this.rowOfLine(this.head.line) * lh + 'px';
    this.curLineEl.style.height = this.rowsInLine(this.head.line) * lh + 'px';

    // Selections
    let sel = '';
    for (const s of this.sels) {
      if (isEmpty(s)) continue;
      const a = startOf(s), e = endOf(s);
      if (e.line < first || a.line > last) continue;
      for (let i = Math.max(first, a.line); i <= Math.min(last, e.line); i++) {
        const len = this.buffer.getLine(i).length;
        for (const r of this.rowRects(i, i === a.line ? a.col : 0, i === e.line ? e.col : len, i < e.line)) sel += rect(r);
      }
    }
    this.selEl.innerHTML = sel;

    // Find matches
    let f = '';
    if (this.matches.length) {
      for (let k = 0; k < this.matches.length; k++) {
        const m = this.matches[k];
        if (m.line < first) continue;
        if (m.line > last) break;
        for (const r of this.rowRects(m.line, m.start, m.end, false)) f += rect(r, k === this.matchIndex ? ' active' : '');
      }
    }
    this.findEl.innerHTML = f;

    // Bracket match
    let br = '';
    const pair = this.sels.length === 1 ? this.matchBracket() : null;
    if (pair) {
      for (const p of pair) {
        if (p.line < first || p.line > last) continue;
        for (const r of this.rowRects(p.line, p.col, p.col + 1, false)) br += rect({ ...r, w: cw });
      }
    }
    this.bracketEl.innerHTML = br;

    // Cursors: the main one has its own element (used for the smooth glide), the rest share a layer.
    const { x: cx, y: cy } = this.xy(this.head.line, this.head.col);
    this.cursorEl.style.display = this.focused ? 'block' : 'none';
    this.cursorEl.style.transform = `translate(${cx}px, ${cy}px)`;
    let extra = '';
    if (this.focused && this.sels.length > 1) {
      for (const s of this.sels) {
        if (s === this.main || s.head.line < first || s.head.line > last) continue;
        const p = this.xy(s.head.line, s.head.col);
        extra += `<div class="xc" style="transform:translate(${p.x}px,${p.y}px)"></div>`;
      }
    }
    this.cursorsEl.innerHTML = extra;

    // Keep the hidden textarea at the caret so IME popups appear in the right place.
    const rect0 = this.scroller.getBoundingClientRect();
    this.input.style.left = rect0.left - this.root.getBoundingClientRect().left + cx - this.scroller.scrollLeft + 'px';
    this.input.style.top = rect0.top - this.root.getBoundingClientRect().top + cy - this.scroller.scrollTop + 'px';
    if (this.completion) { this.positionCompletion(); this.renderGhost(); }
  }

  matchBracket() {
    const b = this.buffer;
    const { line, col } = this.head;
    const text = b.getLine(line);
    let idx = -1;
    const isB = (c) => c && (PAIRS[c] || CLOSERS[c]);
    if (col > 0 && isB(text[col - 1])) idx = col - 1;
    else if (isB(text[col])) idx = col;
    if (idx < 0) return null;
    const ch = text[idx];
    const open = PAIRS[ch] ? ch : CLOSERS[ch];
    const close = PAIRS[open];
    const fwd = !!PAIRS[ch];
    let depth = 0, l = line, c = idx, budget = 40000;
    while (budget-- > 0) {
      const x = b.getLine(l)[c];
      if (x === open) depth += fwd ? 1 : -1;
      else if (x === close) depth += fwd ? -1 : 1;
      if (depth === 0) return [P(line, idx), P(l, c)];
      if (fwd) {
        c++;
        while (c >= b.getLine(l).length) {
          l++; c = 0;
          if (l >= b.lineCount) return null;
          if (b.getLine(l).length) break;
        }
      } else {
        c--;
        while (c < 0) {
          l--;
          if (l < 0) return null;
          c = b.getLine(l).length - 1;
        }
      }
    }
    return null;
  }

  // --- selection ---
  selRange() {
    return cmp(this.anchor, this.head) <= 0 ? [copyPos(this.anchor), copyPos(this.head)] : [copyPos(this.head), copyPos(this.anchor)];
  }

  hasSelection() { return !eq(this.anchor, this.head); }

  getSelectionText() {
    const [s, e] = this.selRange();
    return this.buffer.getRange(s, e);
  }

  snapshot() {
    return {
      anchor: copyPos(this.anchor), head: copyPos(this.head),
      sels: this.sels.map((s) => ({ anchor: clone(s.anchor), head: clone(s.head) })), main: this.sels.indexOf(this.main),
    };
  }

  restoreSnapshot(snap) {
    if (snap.sels && snap.sels.length) {
      const list = snap.sels.map((s) => ({ anchor: clone(s.anchor), head: clone(s.head) }));
      this.commitSels(list, list[snap.main] || list[list.length - 1], { sealUndo: false });
    } else this.setSel(snap.anchor, snap.head, { userMove: false });
  }

  // Replace the selection list. Selections are sorted, clamped and merged where they overlap.
  commitSels(list, main, { reveal = true, sealUndo = true, quiet = false } = {}) {
    const b = this.buffer;
    for (const s of list) { s.anchor = b.clampPos(s.anchor); s.head = b.clampPos(s.head); }
    const n = normalize(list, main);
    this.sels = n.sels;
    this.main = n.main;
    if (quiet) return;
    if (sealUndo) b.sealUndo();
    if (reveal) this.revealCaret();
    this.restartBlink();
    this.scheduleRender();
    this.emitCursor();
  }

  // Collapse to a single selection.
  setSel(anchor, head, { reveal = true, keepGoal = false, userMove = true } = {}) {
    const goal = keepGoal ? this.main.goalV : undefined;
    this.main = { anchor: this.buffer.clampPos(anchor), head: this.buffer.clampPos(head) };
    if (goal != null) this.main.goalV = goal;
    this.sels = [this.main];
    if (userMove) this.buffer.sealUndo();
    if (reveal) this.revealCaret();
    this.restartBlink();
    this.scheduleRender();
    this.emitCursor();
  }

  restartBlink() {
    for (const el of [this.cursorEl, this.cursorsEl]) {
      el.classList.remove('blink');
      void el.offsetWidth;
      el.classList.add('blink');
    }
  }

  emitCursor() {
    const [s, e] = this.selRange();
    const v = this.rowAndVcol(this.head);
    this.emit('cursor', {
      line: this.head.line + 1,
      col: this.vcol(this.buffer.getLine(this.head.line), this.head.col) + 1,
      selected: this.sels.reduce((n, x) => n + (isEmpty(x) ? 0 : this.buffer.getRange(startOf(x), endOf(x)).length), 0),
      selectedLines: e.line - s.line + 1,
      cursors: this.sels.length,
      row: v.row,
    });
  }

  revealCaret() {
    const sc = this.scroller, lh = this.lh;
    const { x, y } = this.xy(this.head.line, this.head.col);
    if (y < sc.scrollTop) sc.scrollTop = y;
    else if (y + lh > sc.scrollTop + sc.clientHeight) sc.scrollTop = y + lh - sc.clientHeight;
    if (this.wrap) return;
    const margin = 40;
    if (x - margin < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - margin - 40);
    else if (x + margin > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = x + margin - sc.clientWidth;
  }

  centerLine(line) {
    const sc = this.scroller;
    sc.scrollTop = Math.max(0, this.rowOfLine(line) * this.lh - sc.clientHeight / 2 + this.lh);
  }

  gotoLine(line, col = 0) {
    const p = this.buffer.clampPos(P(line, col));
    this.setSel(p, p, { reveal: false });
    this.centerLine(p.line);
    this.scheduleRender();
  }

  // --- editing primitives ---
  // Single-range edit; collapses to one cursor at the end of the inserted text.
  edit(a, b, text, tag = null) {
    if (this.readOnly) return a;
    const selBefore = this.snapshot();
    this.buffer.nextTag = tag;
    const end = this.buffer.replace(a, b, text, { selBefore });
    this.setSel(end, end, { userMove: false });
    this.buffer.setSelAfter(this.snapshot());
    return end;
  }

  // Run a multi-step edit as one undo step, restoring the selection on undo.
  batch(fn) {
    const selBefore = this.snapshot();
    this.buffer.nextTag = null;
    this.buffer.batch(fn, selBefore);
  }

  // Apply one planned edit per selection, as a single undo step.
  // plan = { a, b, text, anchor?, head? }  (anchor/head are positions relative to `a`)
  //      | { move: { anchor, head } }      (just move this selection)
  //      | null                            (leave this selection alone)
  // Edits are applied last-to-first so earlier positions stay valid; the resulting
  // selections are shifted through each later edit.
  applyPlans(fn, tag = null) {
    if (this.readOnly) return false;
    const sels = this.sels, n = sels.length;
    const plans = sels.map((s, i) => fn(s, i));
    if (plans.every((p) => !p)) return false;
    let prevEnd = null;
    for (const p of plans) {
      if (!p || p.move) continue;
      if (prevEnd && cmp(p.a, prevEnd) < 0) { p.a = prevEnd; if (cmp(p.b, p.a) < 0) p.b = p.a; }
      prevEnd = p.b;
    }
    const selBefore = this.snapshot();
    const results = new Array(n);
    const run = () => {
      for (let i = n - 1; i >= 0; i--) {
        const plan = plans[i], s = sels[i];
        if (!plan) { results[i] = { anchor: clone(s.anchor), head: clone(s.head) }; continue; }
        if (plan.move) { results[i] = { anchor: clone(plan.move.anchor), head: clone(plan.move.head) }; continue; }
        this.buffer.nextTag = n > 1 ? null : tag;
        const end = this.buffer.replace(plan.a, plan.b, plan.text, n > 1 ? {} : { selBefore });
        const abs = (rel) => (rel ? (rel.line === 0 ? { line: plan.a.line, col: plan.a.col + rel.col } : { line: plan.a.line + rel.line, col: rel.col }) : clone(end));
        results[i] = { anchor: abs(plan.anchor), head: abs(plan.head) };
        for (let k = i + 1; k < n; k++) {
          results[k].anchor = shiftAfter(results[k].anchor, plan.b, end);
          results[k].head = shiftAfter(results[k].head, plan.b, end);
        }
      }
    };
    if (n > 1) this.buffer.batch(run, selBefore, tag); else run();
    const mainIdx = sels.indexOf(this.main);
    this.commitSels(results, results[Math.max(0, mainIdx)], { sealUndo: false });
    if (plans.some((p) => p && !p.move)) this.buffer.setSelAfter(this.snapshot());
    return true;
  }

  selectAll() {
    const b = this.buffer;
    this.setSel(P(0, 0), P(b.lineCount - 1, b.getLine(b.lineCount - 1).length));
  }

  deleteSelection() {
    if (!this.sels.some((s) => !isEmpty(s))) return false;
    this.applyPlans((s) => (isEmpty(s) ? null : { a: startOf(s), b: endOf(s), text: '' }), 'del');
    return true;
  }

  // Work out what typing `text` does for one selection (a plan for applyPlans).
  planType(s, text) {
    const b = this.buffer;
    const a = startOf(s), e = endOf(s);
    const sel = !isEmpty(s);
    if (text.length === 1) {
      const line = b.getLine(a.line);
      const next = line[a.col];
      const prev = line[a.col - 1];
      const isQuote = QUOTES.includes(text);
      if (!sel && this.tagMode() && this.opts.autoClose) {
        const before = line.slice(0, a.col);
        if (text === '>') {
          const name = tagToClose(before, this.strictTags());
          if (name && !line.slice(a.col).startsWith(`</${name}`)) return { a, b: a, text: `></${name}>`, anchor: { line: 0, col: 1 }, head: { line: 0, col: 1 } };
        } else if (text === '/' && (this.strictTags() ? /(^|[^\w$.)\]])<$/ : /<$/).test(before)) {
          const top = this.openTags(a).pop();
          if (top) return { a, b: a, text: `/${top}>` };
        }
      }
      if (!sel && (CLOSERS[text] || isQuote) && next === text) {
        const p = P(a.line, a.col + 1);
        return { move: { anchor: p, head: p } };
      }
      if (this.opts.autoClose && sel && (PAIRS[text] || (isQuote && this.quoteOk()))) {
        const close = PAIRS[text] || text;
        const inner = b.getRange(a, e);
        return { a, b: e, text: text + inner + close, anchor: { line: 0, col: 1 }, head: relEnd(text + inner) };
      }
      if (this.opts.autoClose && !sel) {
        const nextOk = next === undefined || /[\s)\]}>,;:.]/.test(next);
        if (PAIRS[text] && nextOk) return { a, b: a, text: text + PAIRS[text], anchor: { line: 0, col: 1 }, head: { line: 0, col: 1 } };
        if (isQuote && this.quoteOk() && nextOk && !(prev && /[\w$]/.test(prev)) && prev !== text) {
          return { a, b: a, text: text + text, anchor: { line: 0, col: 1 }, head: { line: 0, col: 1 } };
        }
      }
      // Auto-dedent a closing bracket typed on an otherwise blank line.
      if (!sel && CLOSERS[text] && /^\s+$/.test(line.slice(0, a.col)) && a.col >= this.indentUnit.length) {
        const unit = this.indentUnit.length;
        const cut = line.slice(0, a.col).endsWith(this.indentUnit) ? unit : 1;
        return { a: P(a.line, a.col - cut), b: a, text };
      }
    }
    return { a, b: e, text };
  }

  typeText(text) {
    if (this.readOnly || !text) return;
    this.applyPlans((s) => this.planType(s, text), 'type');
    this.afterType(text);
  }

  quoteOk() { return this.doc.lang !== 'markdown' && this.doc.lang !== 'plaintext'; }

  afterType(text) {
    if (this.sels.length > 1) { this.closeCompletion(); return; }
    if (this.tagMode() && (text === '<' || text === ' ' || text === '/' || (text.length === 1 && /[\w$:-]/.test(text)))) this.updateCompletion(text === '<' || text === ' ' ? 'tag' : false);
    else if (text === '.') this.updateCompletion(true);
    else if (text.length === 1 && /[\w$]/.test(text)) this.updateCompletion();
    else this.closeCompletion();
  }

  planNewline(s) {
    const b = this.buffer;
    const a = startOf(s), e = endOf(s);
    const line = b.getLine(a.line);
    const before = line.slice(0, a.col);
    const after = b.getLine(e.line).slice(e.col);
    const indent = /^[ \t]*/.exec(line)[0].slice(0, a.col);
    const trimmed = before.trimEnd();
    const tagOpen = this.tagMode() && /<[A-Za-z][^<>]*[^/<>]>$|<[A-Za-z]>$/.test(trimmed) && !/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b[^<>]*>$/i.test(trimmed);
    const opens = /[{[(]$/.test(trimmed) || (this.doc.lang === 'python' && trimmed.endsWith(':')) || tagOpen;
    const extra = opens ? this.indentUnit : '';
    const closes = opens && (tagOpen ? after.startsWith('</') : PAIRS[trimmed[trimmed.length - 1]] === after[0]);
    if (closes) {
      const rel = { line: 1, col: (indent + extra).length };
      return { a, b: e, text: '\n' + indent + extra + '\n' + indent, anchor: rel, head: rel };
    }
    return { a, b: e, text: '\n' + indent + extra };
  }

  newline() {
    this.applyPlans((s) => this.planNewline(s), null);
    this.buffer.sealUndo();
    this.closeCompletion();
  }

  // Line ranges covered by the selections, merged where they touch. A selection that ends at column 0
  // does not include that last line.
  _lineBlocks() {
    return mergeLineRanges(this.sels.map((s) => {
      const a = startOf(s), e = endOf(s);
      return [a.line, e.col === 0 && e.line > a.line ? e.line - 1 : e.line];
    }));
  }

  // Apply single-line edits as one undo step and keep every cursor where it belongs.
  // fn receives rep(line, at, deleteCount, insertText).
  _withLineEdits(fn) {
    const b = this.buffer;
    const edits = [];
    const selBefore = this.snapshot();
    b.nextTag = null;
    b.batch(() => fn((line, at, del, ins) => {
      b.replace(P(line, at), P(line, at + del), ins, {});
      edits.push({ line, at, del, ins: ins.length });
    }), selBefore);
    if (!edits.length) return;
    const fix = (p) => {
      for (const e of edits) {
        if (e.line !== p.line) continue;
        if (p.col >= e.at + e.del) p.col += e.ins - e.del;
        else if (p.col > e.at) p.col = e.at;
      }
    };
    for (const s of this.sels) { fix(s.anchor); fix(s.head); }
    this.commitSels(this.sels, this.main, { sealUndo: false });
    b.setSelAfter(this.snapshot());
  }

  indentSelection(dir) {
    if (this.readOnly) return;
    const b = this.buffer;
    const unit = this.indentUnit;
    const blocks = this._lineBlocks();
    this._withLineEdits((rep) => {
      for (const [from, to] of blocks) {
        for (let i = from; i <= to; i++) {
          const text = b.getLine(i);
          if (dir > 0) {
            if (!text.length && from !== to) continue;
            rep(i, 0, 0, unit);
          } else {
            let n = 0;
            if (text[0] === '\t') n = 1;
            else while (n < unit.length && text[n] === ' ') n++;
            if (n) rep(i, 0, n, '');
          }
        }
      }
    });
  }

  insertTab(shift) {
    if (shift) { this.indentSelection(-1); return; }
    if (this.sels.some((s) => startOf(s).line !== endOf(s).line)) { this.indentSelection(1); return; }
    const spaces = this.doc.indent.insertSpaces;
    this.applyPlans((s) => {
      const a = startOf(s), e = endOf(s);
      if (!spaces) return { a, b: e, text: '\t' };
      const v = this.vcol(this.buffer.getLine(a.line), a.col);
      return { a, b: e, text: ' '.repeat(this.tabSize - (v % this.tabSize)) };
    }, 'type');
  }

  toggleComment() {
    if (this.readOnly) return;
    const lang = this.doc.lang;
    const prefix = commentPrefix(lang);
    const wrapPair = commentBlock(lang);
    if (!prefix && !wrapPair) return;
    const b = this.buffer;
    const blocks = this._lineBlocks();
    const isCommented = (t) => (prefix ? t.trimStart().startsWith(prefix)
      : t.trimStart().startsWith(wrapPair[0]) && t.trimEnd().endsWith(wrapPair[1]));
    const all = [];
    for (const [f, t] of blocks) for (let i = f; i <= t; i++) if (b.getLine(i).trim()) all.push(i);
    if (!all.length) return;
    const uncomment = all.every((i) => isCommented(b.getLine(i)));
    this._withLineEdits((rep) => {
      for (const [from, to] of blocks) {
        const lines = [];
        for (let i = from; i <= to; i++) if (b.getLine(i).trim()) lines.push(i);
        if (!lines.length) continue;
        const minIndent = Math.min(...lines.map((i) => /^[ \t]*/.exec(b.getLine(i))[0].length));
        for (const i of lines) {
          const t = b.getLine(i);
          if (prefix) {
            if (uncomment) {
              const at = t.indexOf(prefix);
              rep(i, at, prefix.length + (t[at + prefix.length] === ' ' ? 1 : 0), '');
            } else rep(i, minIndent, 0, prefix + ' ');
          } else if (uncomment) {
            const at = t.indexOf(wrapPair[0]);
            const endAt = t.lastIndexOf(wrapPair[1]);
            const tail = wrapPair[1].length + (t[endAt - 1] === ' ' ? 1 : 0);
            rep(i, endAt - (tail - wrapPair[1].length), tail, '');
            rep(i, at, wrapPair[0].length + (t[at + wrapPair[0].length] === ' ' ? 1 : 0), '');
          } else {
            rep(i, t.length, 0, ' ' + wrapPair[1]);
            rep(i, minIndent, 0, wrapPair[0] + ' ');
          }
        }
      }
    });
  }

  moveLines(dir) {
    if (this.readOnly) return;
    const b = this.buffer;
    const blocks = this._lineBlocks().filter(([f, t]) => !(dir < 0 && f === 0) && !(dir > 0 && t >= b.lineCount - 1));
    if (!blocks.length) return;
    const selBefore = this.snapshot();
    b.nextTag = null;
    b.batch(() => {
      for (const [from, to] of (dir < 0 ? blocks : [...blocks].reverse())) {
        const block = b.getRange(P(from, 0), P(to, b.getLine(to).length));
        if (dir < 0) {
          const above = b.getLine(from - 1);
          b.replace(P(from - 1, 0), P(to, b.getLine(to).length), block + '\n' + above, {});
        } else {
          const below = b.getLine(to + 1);
          b.replace(P(from, 0), P(to + 1, below.length), below + '\n' + block, {});
        }
      }
    }, selBefore);
    for (const s of this.sels) for (const p of [s.anchor, s.head]) if (blocks.some(([f, t]) => p.line >= f && p.line <= t)) p.line += dir;
    this.commitSels(this.sels, this.main, { sealUndo: false });
    b.setSelAfter(this.snapshot());
  }

  duplicateLines(dir) {
    if (this.readOnly) return;
    const b = this.buffer;
    const blocks = this._lineBlocks();
    const selBefore = this.snapshot();
    let acc = 0;
    const offsets = blocks.map(([f, t]) => { const o = acc; acc += t - f + 1; return o; });
    const blockOf = (line) => blocks.findIndex(([f, t]) => line >= f && line <= t);
    const moves = [];
    for (const s of this.sels) for (const p of [s.anchor, s.head]) moves.push([p, blockOf(p.line)]);
    b.nextTag = null;
    b.batch(() => {
      for (const [from, to] of [...blocks].reverse()) {
        const text = b.getRange(P(from, 0), P(to, b.getLine(to).length));
        b.replace(P(to, b.getLine(to).length), P(to, b.getLine(to).length), '\n' + text, {});
      }
    }, selBefore);
    for (const [p, k] of moves) {
      if (k < 0) continue;
      p.line += offsets[k] + (dir > 0 ? blocks[k][1] - blocks[k][0] + 1 : 0);
    }
    this.commitSels(this.sels, this.main, { sealUndo: false });
    b.setSelAfter(this.snapshot());
  }

  deleteLines() {
    if (this.readOnly) return;
    const b = this.buffer;
    const blocks = this._lineBlocks();
    const cols = blocks.map(([f, t]) => {
      const s = this.sels.find((x) => endOf(x).line >= f && startOf(x).line <= t);
      return s ? s.head.col : 0;
    });
    const selBefore = this.snapshot();
    b.nextTag = null;
    b.batch(() => {
      for (const [from, to] of [...blocks].reverse()) {
        if (to < b.lineCount - 1) b.replace(P(from, 0), P(to + 1, 0), '', {});
        else if (from > 0) b.replace(P(from - 1, b.getLine(from - 1).length), P(to, b.getLine(to).length), '', {});
        else b.replace(P(0, 0), P(to, b.getLine(to).length), '', {});
      }
    }, selBefore);
    let removed = 0;
    const out = blocks.map(([f, t], k) => {
      const p = b.clampPos(P(f - removed, cols[k]));
      removed += t - f + 1;
      return { anchor: clone(p), head: clone(p) };
    });
    this.commitSels(out, out[out.length - 1], { sealUndo: false });
    b.setSelAfter(this.snapshot());
  }

  insertLine(above) {
    if (this.readOnly) return;
    const b = this.buffer;
    const lines = [...new Set(this.sels.map((s) => endOf(s).line))].sort((x, y) => x - y);
    const indents = lines.map((l) => /^[ \t]*/.exec(b.getLine(l))[0]);
    const selBefore = this.snapshot();
    b.nextTag = null;
    b.batch(() => {
      for (let k = lines.length - 1; k >= 0; k--) {
        const line = lines[k], indent = indents[k];
        if (above) b.replace(P(line, 0), P(line, 0), indent + '\n', {});
        else b.replace(P(line, b.getLine(line).length), P(line, b.getLine(line).length), '\n' + indent, {});
      }
    }, selBefore);
    const out = lines.map((l, k) => {
      const p = P((above ? l : l + 1) + k, indents[k].length);
      return { anchor: clone(p), head: clone(p) };
    });
    this.commitSels(out, out[out.length - 1], { sealUndo: false });
    b.setSelAfter(this.snapshot());
  }

  selectLine() {
    const b = this.buffer;
    const out = this.sels.map((s) => {
      const a = startOf(s), e = endOf(s);
      const endLine = e.col === 0 && e.line > a.line ? e.line - 1 : e.line;
      const end = endLine + 1 < b.lineCount ? P(endLine + 1, 0) : P(endLine, b.getLine(endLine).length);
      return { anchor: P(a.line, 0), head: end };
    });
    this.commitSels(out, out[this.sels.indexOf(this.main)]);
  }

  undo() {
    const sel = this.buffer.undo();
    if (sel) this.restoreSnapshot(sel);
    this.closeCompletion();
  }

  redo() {
    const sel = this.buffer.redo();
    if (sel) this.restoreSnapshot(sel);
  }

  // --- movement ---
  stepLeft(p) {
    if (p.col > 0) {
      const t = this.buffer.getLine(p.line);
      const low = t.charCodeAt(p.col - 1);
      return P(p.line, p.col - (low >= 0xDC00 && low <= 0xDFFF && p.col >= 2 ? 2 : 1));
    }
    return p.line > 0 ? P(p.line - 1, this.buffer.getLine(p.line - 1).length) : p;
  }

  stepRight(p) {
    const t = this.buffer.getLine(p.line);
    if (p.col < t.length) {
      const hi = t.charCodeAt(p.col);
      return P(p.line, p.col + (hi >= 0xD800 && hi <= 0xDBFF ? 2 : 1));
    }
    return p.line < this.buffer.lineCount - 1 ? P(p.line + 1, 0) : p;
  }

  wordLeft(p) {
    if (p.col === 0) return this.stepLeft(p);
    const t = this.buffer.getLine(p.line);
    let i = p.col;
    while (i > 0 && charClass(t[i - 1]) === 1) i--;
    const cls = charClass(t[i - 1]);
    while (i > 0 && charClass(t[i - 1]) === cls) i--;
    return P(p.line, i);
  }

  wordRight(p) {
    const t = this.buffer.getLine(p.line);
    if (p.col >= t.length) return this.stepRight(p);
    let i = p.col;
    const cls = charClass(t[i]);
    if (cls !== 1) while (i < t.length && charClass(t[i]) === cls) i++;
    while (i < t.length && charClass(t[i]) === 1) i++;
    return P(p.line, i);
  }

  smartHome(p) {
    const t = this.buffer.getLine(p.line);
    const first = /^[ \t]*/.exec(t)[0].length;
    return P(p.line, p.col === first || p.col === 0 ? (p.col === first ? 0 : first) : first);
  }

  // Move every selection. fn(sel) returns the new head position, or { line, col, collapse: true }
  // to collapse the selection to that position.
  moveEach(fn, extend) {
    const out = this.sels.map((s) => {
      const r = fn(s);
      const pos = { line: r.line, col: r.col };
      return { anchor: r.collapse || !extend ? clone(pos) : clone(s.anchor), head: pos };
    });
    this.commitSels(out, out[this.sels.indexOf(this.main)]);
  }

  // Target for moving one visual row up/down, keeping the horizontal "goal" column.
  verticalTarget(p, dir, goal) {
    this.ensureRows();
    const { row, v } = this.rowAndVcol(p);
    const g = goal ?? v;
    const r2 = row + dir;
    if (r2 < 0) return { pos: P(0, 0), goal: g, edge: true };
    if (r2 >= this.totalRows) { const b = this.buffer; return { pos: P(b.lineCount - 1, b.getLine(b.lineCount - 1).length), goal: g, edge: true }; }
    return { pos: this.posFromRowV(r2, g), goal: g };
  }

  moveVertical(delta, extend) {
    const out = this.sels.map((s) => {
      const t = this.verticalTarget(s.head, delta, s.goalV);
      return { anchor: extend ? clone(s.anchor) : clone(t.pos), head: clone(t.pos), goalV: t.goal };
    });
    this.commitSels(out, out[this.sels.indexOf(this.main)]);
  }

  move(target, extend) {
    this.setSel(extend ? this.anchor : target, target);
  }

  // --- multi-cursor ---
  // Add a cursor above or below every existing cursor.
  addCursorVertical(dir) {
    const added = [];
    for (const s of this.sels) {
      const t = this.verticalTarget(s.head, dir, s.goalV);
      if (t.edge) continue;
      added.push({ anchor: clone(t.pos), head: clone(t.pos), goalV: t.goal });
    }
    if (!added.length) return;
    this.commitSels([...this.sels, ...added], dir < 0 ? added[0] : added[added.length - 1]);
  }

  addCursorAt(p) {
    const hit = this.sels.findIndex((s) => (isEmpty(s) ? eqPos(s.head, p) : cmp(p, startOf(s)) >= 0 && cmp(p, endOf(s)) <= 0));
    if (hit >= 0) {
      if (this.sels.length === 1) return null;
      const rest = this.sels.filter((_, i) => i !== hit);
      this.commitSels(rest, rest[rest.length - 1]);
      return null;
    }
    const ns = { anchor: clone(p), head: clone(p) };
    this.commitSels([...this.sels, ns], ns);
    return ns;
  }

  // Cmd+D: select the word under the cursor, then add the next occurrence of the selection.
  _selectNextOccurrence() {
    if (isEmpty(this.main)) {
      const [a, b] = this.wordAt(this.head);
      if (!eq(a, b)) { this.main.anchor = a; this.main.head = b; this.commitSels(this.sels, this.main); }
      return;
    }
    const text = this.getSelectionText();
    if (text.includes('\n')) return;
    const matches = this.buffer.find(text, { caseSensitive: true });
    if (matches.length < 2) return;
    const e = endOf(this.main);
    const from = matches.findIndex((m) => m.line > e.line || (m.line === e.line && m.start >= e.col));
    const taken = (m) => this.sels.some((s) => !isEmpty(s) && startOf(s).line === m.line && startOf(s).col === m.start);
    for (let k = 0; k < matches.length; k++) {
      const m = matches[(Math.max(from, 0) + k) % matches.length];
      if (taken(m)) continue;
      const ns = { anchor: P(m.line, m.start), head: P(m.line, m.end) };
      this.commitSels([...this.sels, ns], ns);
      return;
    }
  }

  // Cmd+Shift+L: select every occurrence of the current selection (or word).
  selectAllOccurrences() {
    let text = '';
    if (isEmpty(this.main)) {
      const [a, b] = this.wordAt(this.head);
      if (eq(a, b)) return;
      text = this.buffer.getRange(a, b);
    } else text = this.getSelectionText();
    if (!text || text.includes('\n')) return;
    const matches = this.buffer.find(text, { caseSensitive: true }).slice(0, 5000);
    if (!matches.length) return;
    const list = matches.map((m) => ({ anchor: P(m.line, m.start), head: P(m.line, m.end) }));
    const e = this.head;
    const near = list.find((s) => cmp(endOf(s), e) >= 0) || list[0];
    this.commitSels(list, near);
  }

  // --- word at position (double-click) ---
  wordAt(p) {
    const t = this.buffer.getLine(p.line);
    let a = p.col, b = p.col;
    const cls = charClass(t[Math.min(p.col, t.length - 1)]);
    if (cls === 0) return [p, p];
    while (a > 0 && charClass(t[a - 1]) === cls) a--;
    while (b < t.length && charClass(t[b]) === cls) b++;
    return [P(p.line, a), P(p.line, b)];
  }

  // --- search ---
  setFind(opts, { jump = true } = {}) {
    this.findOpts = opts && opts.query ? { ...opts } : null;
    this.recomputeMatches(jump);
  }

  clearFind() { this.setFind(null); }

  recomputeMatches(jump) {
    if (!this.doc) return;
    if (!this.findOpts) {
      this.matches = [];
      this.matchIndex = -1;
    } else {
      this.matches = this.buffer.find(this.findOpts.query, this.findOpts);
      const [s] = this.selRange();
      let idx = this.matches.findIndex((m) => m.line > s.line || (m.line === s.line && m.start >= s.col));
      if (idx < 0) idx = this.matches.length ? 0 : -1;
      this.matchIndex = idx;
      if (jump && idx >= 0) this.selectMatch(idx);
    }
    this.emit('find', { count: this.matches.length, index: this.matchIndex });
    this.scheduleRender();
  }

  selectMatch(idx) {
    const m = this.matches[idx];
    if (!m) return;
    this.matchIndex = idx;
    this.setSel(P(m.line, m.start), P(m.line, m.end), { reveal: false });
    const sc = this.scroller;
    const { x, y } = this.xy(m.line, m.end);
    if (y < sc.scrollTop + this.lh * 2 || y > sc.scrollTop + sc.clientHeight - this.lh * 3) this.centerLine(m.line);
    if (!this.wrap) {
      if (x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - sc.clientWidth + 120;
      else if (x < sc.scrollLeft) sc.scrollLeft = 0;
    }
    this.emit('find', { count: this.matches.length, index: idx });
  }

  findNext(dir = 1) {
    if (!this.matches.length) return;
    const n = this.matches.length;
    this.selectMatch(((this.matchIndex < 0 ? (dir > 0 ? -1 : 0) : this.matchIndex) + dir + n) % n);
  }

  _replacementFor(m, repl) {
    if (!this.findOpts.regex) return repl;
    const re = buildRegex(this.findOpts.query, { ...this.findOpts });
    if (!re) return repl;
    return m.text.replace(new RegExp(re.source, re.flags.replace('g', '')), repl);
  }

  replaceCurrent(repl) {
    if (this.readOnly || !this.findOpts || this.matchIndex < 0) return;
    const m = this.matches[this.matchIndex];
    const [s, e] = this.selRange();
    if (!(s.line === m.line && s.col === m.start && e.col === m.end && e.line === m.line)) { this.selectMatch(this.matchIndex); return; }
    this.edit(P(m.line, m.start), P(m.line, m.end), this._replacementFor(m, repl));
    this.recomputeMatches(false);
    const idx = this.matches.findIndex((x) => x.line > m.line || (x.line === m.line && x.start >= m.start));
    if (this.matches.length) this.selectMatch(idx < 0 ? 0 : idx);
  }

  replaceAll(repl) {
    if (this.readOnly || !this.findOpts || !this.matches.length) return 0;
    const list = this.matches.slice();
    this.batch(() => {
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        this.buffer.nextTag = null;
        this.buffer.replace(P(m.line, m.start), P(m.line, m.end), this._replacementFor(m, repl), {});
      }
    });
    this.recomputeMatches(false);
    return list.length;
  }

  // --- completion ---
  currentPrefix() {
    const t = this.buffer.getLine(this.head.line);
    let i = this.head.col;
    while (i > 0 && /[\w$]/.test(t[i - 1])) i--;
    return t.slice(i, this.head.col);
  }

  // Tag intelligence applies to markup files and JSX/TSX.
  tagMode() {
    return this.doc.lang === 'html' || /\.(jsx|tsx)$/i.test(this.doc.name || '');
  }

  // JSX/TSX share '<' with comparisons and generics, so tags must not be glued to an identifier there.
  strictTags() { return this.doc.lang !== 'html'; }

  // Tags still open at `pos` (default: the main caret).
  openTags(pos = this.head) {
    const b = this.buffer, end = pos.line;
    const parts = [];
    for (let i = Math.max(0, end - 4000); i < end; i++) parts.push(b.getLine(i));
    parts.push(b.getLine(end).slice(0, pos.col));
    return openTagStack(parts.join('\n'));
  }

  // Suggestions for tag names, closing tags and attributes; null when the caret isn't in a tag.
  tagSuggestions() {
    const before = this.buffer.getLine(this.head.line).slice(0, this.head.col);
    const ctx = contextAt(before, this.strictTags());
    if (!ctx) return null;
    const lower = ctx.prefix.toLowerCase();
    let items = [];
    if (ctx.type === 'close') {
      const seen = new Set();
      for (const name of this.openTags().reverse()) {
        if (!seen.has(name) && name.toLowerCase().startsWith(lower)) { seen.add(name); items.push({ label: name, kind: 'closing tag', closing: true }); }
      }
    } else if (ctx.type === 'open') {
      const used = new Set();
      for (const name of this.openTags()) used.add(name);
      const names = [...new Set([...HTML_TAGS, ...used])];
      for (const name of names) if (name.toLowerCase().startsWith(lower) && name !== ctx.prefix) items.push({ label: name, kind: 'tag' });
    } else {
      for (const name of attrsFor(ctx.tag)) {
        if (!name.toLowerCase().startsWith(lower) || name === ctx.prefix) continue;
        if (new RegExp(`\\s${name.replace(/[-]/g, '\\-')}(=|\\s|$)`).test(ctx.seg)) continue; // already present
        const bool = BOOLEAN_ATTRS.has(name);
        const body = bool ? name : name.endsWith('-') ? name + '$0' : `${name}="$0"`;
        items.push({ label: name, kind: 'attribute', body, detail: bool ? '' : '' });
      }
    }
    return { prefix: ctx.prefix, items, type: ctx.type };
  }

  // Build suggestions: language snippets first when they match, then words from the document.
  // `force` (Ctrl+Space) opens the list even with a short prefix.
  updateCompletion(force = false) {
    clearTimeout(this.languageCompletionTimer);
    this.updateLocalCompletion(force);
    if (!this.languageProvider || !this.doc || this.sels.length > 1 || this.hasSelection() || (!this.opts.completion && !force)) return;
    if (this.tagMode() && this.tagSuggestions()) return;
    const doc = this.doc, version = this.buffer.version, line = this.head.line, col = this.head.col;
    const prefix = this.currentPrefix();
    if (!force && !prefix && this.buffer.getLine(line)[col - 1] !== '.') return;
    const request = this.languageRequest = (this.languageRequest || 0) + 1;
    this.languageCompletionTimer = setTimeout(() => {
      if (this.languageRequest !== request || this.doc !== doc || this.buffer.version !== version) return;
      this.languageProvider(doc, { line, col }).then((items) => {
        if (!items?.length || this.languageRequest !== request || this.doc !== doc || this.buffer.version !== version || this.head.line !== line || this.head.col !== col || !this.focused) return;
        const local = this.completion?.items || [];
        const names = new Set(items.map((i) => i.label));
        this.completion = { items: [...items, ...local.filter((i) => !names.has(i.label))].slice(0, 30), index: 0, prefix };
        this.renderCompletion();
      }).catch(() => {});
    }, force ? 0 : 120);
  }

  updateLocalCompletion(force = false) {
    if (this.sels.length > 1 || this.hasSelection() || (!this.opts.completion && !force)) return this.closeCompletion();
    if (this.tagMode()) {
      const t = this.tagSuggestions();
      if (t) {
        if (!t.items.length || (t.type === 'attr' && !t.prefix && !force)) return this.closeCompletion();
        this.completion = { items: t.items.slice(0, 8), index: 0, prefix: t.prefix };
        return this.renderCompletion();
      }
      if (force === 'tag') return this.closeCompletion();
    }
    const prefix = this.currentPrefix();
    if (prefix.length < (force ? 1 : 2) && !(force && prefix.length === 0)) return this.closeCompletion();
    const lower = prefix.toLowerCase();
    const items = [];
    const snippets = snippetsFor(this.doc.lang);
    for (const [trigger, [body, detail]] of Object.entries(snippets)) {
      if (trigger.startsWith(lower) && (prefix.length >= 2 || force || trigger === lower)) {
        items.push({ label: trigger, kind: 'snippet', body, detail });
      }
    }
    const keywords = new Set(keywordsFor(this.doc.lang));
    const words = [];
    for (const w of this.doc.collectWords()) {
      if (w === prefix || w.length <= prefix.length) continue;
      if (w.toLowerCase().startsWith(lower)) words.push(w);
    }
    words.sort((a, b) => (a.startsWith(prefix) ? 0 : 1) - (b.startsWith(prefix) ? 0 : 1) || a.length - b.length || a.localeCompare(b));
    for (const w of words) items.push({ label: w, kind: keywords.has(w) ? 'keyword' : 'word' });
    if (!items.length) return this.closeCompletion();
    this.completion = { items: items.slice(0, 8), index: 0, prefix };
    this.renderCompletion();
  }

  renderCompletion() {
    const c = this.completion;
    this.completeEl.hidden = false;
    this.completeEl.innerHTML = c.items.map((it, i) => {
      const n = c.prefix.length;
      const matched = it.label.toLowerCase().startsWith(c.prefix.toLowerCase());
      const label = matched ? `<b>${esc(it.label.slice(0, n))}</b>${esc(it.label.slice(n))}` : esc(it.label);
      const detail = it.detail ? `<span class="cd">${esc(it.detail)}</span>` : '';
      return `<div class="ci${i === c.index ? ' sel' : ''}" data-i="${i}"><span class="cl">${label}</span>${detail}<span class="ck">${it.kind}</span></div>`;
    }).join('') + '<div class="cf"><kbd>Tab</kbd> accept <kbd>Esc</kbd> dismiss</div>';
    this.positionCompletion();
    this.renderGhost();
  }

  // Faded inline preview of the selected word suggestion, shown after the caret.
  renderGhost() {
    const c = this.completion;
    const g = this.ghostEl;
    const it = c && c.items[c.index];
    const rest = it ? this.buffer.getLine(this.head.line).slice(this.head.col) : '';
    if (!it || it.body != null || !it.label.startsWith(c.prefix) || /[\w$]/.test(rest[0] || '')) { g.hidden = true; return; }
    g.hidden = false;
    g.textContent = it.label.slice(c.prefix.length);
    const { x, y } = this.xy(this.head.line, this.head.col);
    g.style.transform = `translate(${x}px, ${y}px)`;
  }

  positionCompletion() {
    const rootR = this.root.getBoundingClientRect(), scR = this.scroller.getBoundingClientRect();
    const { x: cx, y: cy } = this.xy(this.head.line, this.head.col);
    const x = scR.left - rootR.left + cx - this.scroller.scrollLeft - this.currentPrefix().length * this.charW;
    const y = scR.top - rootR.top + cy + this.lh - this.scroller.scrollTop;
    const flip = y + 260 > rootR.height;
    this.completeEl.style.left = Math.max(4, x) + 'px';
    this.completeEl.style.top = (flip ? y - this.lh - this.completeEl.offsetHeight : y) + 'px';
  }

  closeCompletion() {
    clearTimeout(this.languageCompletionTimer);
    this.languageRequest = (this.languageRequest || 0) + 1;
    if (!this.completion) return;
    this.completion = null;
    this.completeEl.hidden = true;
    this.ghostEl.hidden = true;
  }

  acceptCompletion() {
    const c = this.completion;
    if (!c) return false;
    const it = c.items[c.index];
    const start = P(this.head.line, this.head.col - c.prefix.length);
    this.closeCompletion();
    if (it.closing) {
      const next = this.buffer.getLine(this.head.line)[this.head.col];
      this.edit(start, this.head, it.label + (next === '>' ? '' : '>'));
    } else if (it.body != null) {
      const lineIndent = /^[ \t]*/.exec(this.buffer.getLine(start.line))[0];
      const { text, caret } = expandSnippet(it.body, this.indentUnit, lineIndent);
      const sel = this.snapshot();
      this.buffer.nextTag = null;
      this.buffer.replace(start, this.head, text, { selBefore: sel });
      const p = caret.line === 0 ? P(start.line, start.col + caret.col) : P(start.line + caret.line, caret.col);
      this.setSel(p, p, { userMove: false });
      this.buffer.sealUndo();
      this.buffer.setSelAfter(this.snapshot());
    } else {
      this.edit(start, this.head, it.label);
    }
    return true;
  }

  // --- input wiring ---
  _bind() {
    const ta = this.input;

    ta.addEventListener('focus', () => { this.focused = true; this.root.classList.add('focused'); this.restartBlink(); this.scheduleRender(); });
    ta.addEventListener('blur', () => { this.focused = false; this.root.classList.remove('focused'); this.closeCompletion(); this.scheduleRender(); });

    ta.addEventListener('keydown', (e) => this._onKey(e));
    ta.addEventListener('compositionstart', () => { this.composing = true; });
    ta.addEventListener('compositionend', () => {
      this.composing = false;
      const v = ta.value; ta.value = '';
      if (v) this.typeText(v);
    });
    ta.addEventListener('input', () => {
      if (this.composing) return;
      const v = ta.value; ta.value = '';
      if (v) this.typeText(v);
    });
    ta.addEventListener('copy', (e) => {
      if (!this.doc) return;
      e.clipboardData.setData('text/plain', this.clipboardText());
      e.preventDefault();
    });
    ta.addEventListener('cut', (e) => {
      if (!this.doc || this.readOnly) return;
      if (this.sels.some((s) => isEmpty(s))) this.selectLine();
      e.clipboardData.setData('text/plain', this.clipboardText());
      e.preventDefault();
      this.deleteSelection();
    });
    ta.addEventListener('paste', (e) => {
      if (!this.doc || this.readOnly) return;
      const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
      e.preventDefault();
      if (!text) return;
      this.buffer.sealUndo();
      // With as many lines on the clipboard as cursors, give each cursor its own line.
      const parts = text.split('\n');
      const spread = this.sels.length > 1 && parts.length === this.sels.length;
      this.applyPlans((s, i) => ({ a: startOf(s), b: endOf(s), text: spread ? parts[i] : text }), null);
      this.buffer.sealUndo();
      this.closeCompletion();
    });

    this.scroller.addEventListener('scroll', () => { this.scheduleRender(); this.emit('scroll'); });
    new ResizeObserver(() => { this.layout(); this.scheduleRender(); }).observe(this.scroller);

    this.scroller.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.gutter.addEventListener('mousedown', (e) => {
      if (!this.doc) return;
      e.preventDefault();
      const el = e.target.closest('.gn');
      if (!el) return;
      const l = +el.dataset.l;
      const b = this.buffer;
      this.setSel(P(l, 0), l + 1 < b.lineCount ? P(l + 1, 0) : P(l, b.getLine(l).length));
      this.focus();
    });
    this.gutter.addEventListener('wheel', (e) => { this.scroller.scrollTop += e.deltaY; }, { passive: true });

    this.completeEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const el = e.target.closest('.ci');
      if (!el || !this.completion) return;
      this.completion.index = +el.dataset.i;
      this.acceptCompletion();
      this.focus();
    });
  }

  // Text for the clipboard: each selection (or the whole line for empty cursors), one per line.
  clipboardText() {
    const b = this.buffer;
    if (this.sels.length === 1) {
      return this.hasSelection() ? this.getSelectionText() : b.getLine(this.head.line) + '\n';
    }
    return this.sels.map((s) => (isEmpty(s) ? b.getLine(s.head.line) : b.getRange(startOf(s), endOf(s)))).join('\n');
  }

  _onMouseDown(e) {
    if (!this.doc || e.button !== 0) return;
    e.preventDefault();
    this.focus();
    const p = this.posFromPoint(e.clientX, e.clientY);
    const detail = e.detail;
    this.closeCompletion();

    // Alt+Shift+drag: column (box) selection
    if (e.altKey && e.shiftKey) {
      const r = this.scroller.getBoundingClientRect();
      const vAt = (cx) => (cx - r.left + this.scroller.scrollLeft - PAD_X) / this.charW;
      this._dragMode = { kind: 'column', line: p.line, v: vAt(e.clientX), vAt };
      this._columnSelect(e, p);
    } else if (e.altKey && detail <= 1) {
      // Alt+click adds (or removes) a cursor; dragging extends the new one.
      const ns = this.addCursorAt(p);
      this._dragMode = ns ? { kind: 'add' } : { kind: 'none' };
    } else if (detail === 2) {
      const [a, b] = this.wordAt(p);
      this.setSel(a, b);
      this._dragMode = { kind: 'word', a, b };
    } else if (detail >= 3) {
      const b = this.buffer;
      this.setSel(P(p.line, 0), p.line + 1 < b.lineCount ? P(p.line + 1, 0) : P(p.line, b.getLine(p.line).length));
      this._dragMode = { kind: 'line', line: p.line };
    } else {
      if (e.shiftKey) this.setSel(this.anchor, p);
      else this.setSel(p, p);
      this._dragMode = { kind: 'char' };
    }
    const move = (ev) => {
      const q = this.posFromPoint(ev.clientX, ev.clientY);
      const m = this._dragMode;
      if (m.kind === 'char') this.setSel(this.anchor, q, { reveal: false });
      else if (m.kind === 'add') { this.main.head = this.buffer.clampPos(q); this.commitSels(this.sels, this.main, { reveal: false }); }
      else if (m.kind === 'column') this._columnSelect(ev, q);
      else if (m.kind === 'word') {
        const [a, b] = this.wordAt(q);
        if (cmp(q, m.a) < 0) this.setSel(m.b, a, { reveal: false });
        else this.setSel(m.a, b, { reveal: false });
      } else if (m.kind === 'line') {
        const b = this.buffer;
        const lo = Math.min(m.line, q.line), hi = Math.max(m.line, q.line);
        const end = hi + 1 < b.lineCount ? P(hi + 1, 0) : P(hi, b.getLine(hi).length);
        if (q.line < m.line) this.setSel(end, P(lo, 0), { reveal: false });
        else this.setSel(P(lo, 0), end, { reveal: false });
      }
      // autoscroll while dragging outside the viewport
      const r = this.scroller.getBoundingClientRect();
      if (ev.clientY < r.top) this.scroller.scrollTop -= Math.min(40, r.top - ev.clientY);
      else if (ev.clientY > r.bottom) this.scroller.scrollTop += Math.min(40, ev.clientY - r.bottom);
      if (!this.wrap) {
        if (ev.clientX < r.left) this.scroller.scrollLeft -= 20;
        else if (ev.clientX > r.right) this.scroller.scrollLeft += 20;
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      clearInterval(timer);
    };
    const timer = setInterval(() => { if (this._lastMove) move(this._lastMove); }, 50);
    const track = (ev) => { this._lastMove = ev; move(ev); };
    window.addEventListener('mousemove', track);
    window.addEventListener('mouseup', () => { window.removeEventListener('mousemove', track); this._lastMove = null; up(); }, { once: true });
  }

  // Box selection: one selection per line between the drag start and the pointer, at the same visual columns.
  _columnSelect(ev, q) {
    const m = this._dragMode;
    const v2 = m.vAt(ev.clientX);
    const b = this.buffer;
    const lo = Math.min(m.line, q.line), hi = Math.max(m.line, q.line);
    const list = [];
    for (let l = lo; l <= hi; l++) {
      const text = b.getLine(l);
      list.push({ anchor: P(l, this.colFromV(text, m.v)), head: P(l, this.colFromV(text, v2)) });
    }
    this.commitSels(list, q.line >= m.line ? list[list.length - 1] : list[0], { reveal: false });
  }

  _onKey(e) {
    if (!this.doc || this.composing) return;
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    const alt = e.altKey, shift = e.shiftKey;
    const key = e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };

    if (!mod && !alt && !shift && (key === 'F12' || key === 'F2')) {
      handled(); this.emit('request', { type: key === 'F12' ? 'go-definition' : 'rename-symbol' }); return;
    }

    // Completion popup keys
    if (this.completion) {
      const c = this.completion;
      if (key === 'ArrowDown') { handled(); c.index = (c.index + 1) % c.items.length; this.renderCompletion(); return; }
      if (key === 'ArrowUp') { handled(); c.index = (c.index - 1 + c.items.length) % c.items.length; this.renderCompletion(); return; }
      if (key === 'Enter' || key === 'Tab') { handled(); this.acceptCompletion(); return; }
      if (key === 'Escape') { handled(); this.closeCompletion(); return; }
    }

    if ((e.ctrlKey && key === ' ') || (mod && !alt && !shift && key.toLowerCase() === 'i')) { handled(); this.updateCompletion(true); return; }

    // Cmd+Alt+Up/Down (Ctrl+Alt on other platforms): add a cursor above / below
    if (mod && alt && (key === 'ArrowUp' || key === 'ArrowDown')) { handled(); this.addCursorVertical(key === 'ArrowUp' ? -1 : 1); return; }

    if (mod && !alt) {
      switch (key.toLowerCase()) {
        case 'a': handled(); this.selectAll(); return;
        case 'z': handled(); shift ? this.redo() : this.undo(); return;
        case 'y': if (!IS_MAC) { handled(); this.redo(); return; } break;
        case '/': handled(); this.toggleComment(); return;
        case 'f': handled(); this.emit('request', { type: shift ? 'search-in-files' : 'find' }); return;
        case 'h': if (!IS_MAC) { handled(); this.emit('request', { type: 'replace' }); return; } break;
        case 'g': handled(); this.emit('request', { type: 'goto-line' }); return;
        case 'l': handled(); if (shift) this.selectAllOccurrences(); else this.selectLine(); return;
        case 'k': if (shift) { handled(); this.deleteLines(); return; } break;
        case 'enter': handled(); this.insertLine(shift); return;
        case ']': handled(); this.indentSelection(1); return;
        case '[': handled(); this.indentSelection(-1); return;
        case 'd': handled(); this._selectNextOccurrence(); return;
        default: break;
      }
    }
    if (IS_MAC && mod && key.toLowerCase() === 'h') { handled(); this.emit('request', { type: 'replace' }); return; }

    if (alt && !mod && (key === 'ArrowUp' || key === 'ArrowDown')) {
      handled();
      if (shift) this.duplicateLines(key === 'ArrowDown' ? 1 : -1);
      else this.moveLines(key === 'ArrowUp' ? -1 : 1);
      return;
    }

    const lastLine = () => { const b = this.buffer; return P(b.lineCount - 1, b.getLine(b.lineCount - 1).length); };
    switch (key) {
      case 'ArrowLeft':
        handled();
        this.moveEach((s) => ((!shift && !alt && !mod && !isEmpty(s)) ? { ...startOf(s), collapse: true }
          : mod ? this.smartHome(s.head) : alt ? this.wordLeft(s.head) : this.stepLeft(s.head)), shift);
        return;
      case 'ArrowRight':
        handled();
        this.moveEach((s) => ((!shift && !alt && !mod && !isEmpty(s)) ? { ...endOf(s), collapse: true }
          : mod ? P(s.head.line, this.buffer.getLine(s.head.line).length) : alt ? this.wordRight(s.head) : this.stepRight(s.head)), shift);
        return;
      case 'ArrowUp':
        handled();
        if (mod) this.moveEach(() => P(0, 0), shift); else this.moveVertical(-1, shift);
        return;
      case 'ArrowDown':
        handled();
        if (mod) this.moveEach(() => lastLine(), shift); else this.moveVertical(1, shift);
        return;
      case 'Home': handled(); this.moveEach((s) => (mod ? P(0, 0) : this.smartHome(s.head)), shift); return;
      case 'End': handled(); this.moveEach((s) => (mod ? lastLine() : P(s.head.line, this.buffer.getLine(s.head.line).length)), shift); return;
      case 'PageUp': case 'PageDown': {
        handled();
        const n = Math.max(1, Math.floor(this.scroller.clientHeight / this.lh) - 1);
        this.scroller.scrollTop += (key === 'PageUp' ? -n : n) * this.lh;
        this.moveVertical(key === 'PageUp' ? -n : n, shift);
        return;
      }
      case 'Backspace': handled(); this._backspace(mod, alt); return;
      case 'Delete': handled(); this._deleteForward(mod, alt); return;
      case 'Enter': handled(); this.newline(); return;
      case 'Tab': handled(); this.insertTab(shift); return;
      case 'Escape':
        if (this.sels.length > 1) { handled(); this.setSel(this.main.anchor, this.main.head); } else if (this.hasSelection()) { handled(); this.setSel(this.head, this.head); }
        this.emit('request', { type: 'escape' });
        return;
      default: break;
    }
  }

  _backspace(mod, alt) {
    const b = this.buffer;
    this.applyPlans((s) => {
      if (!isEmpty(s)) return { a: startOf(s), b: endOf(s), text: '' };
      const h = s.head;
      let from;
      if (mod) from = h.col === 0 ? this.stepLeft(h) : P(h.line, 0);
      else if (alt) from = this.wordLeft(h);
      else {
        const text = b.getLine(h.line);
        const prev = text[h.col - 1], next = text[h.col];
        if (this.opts.autoClose && prev && next && (PAIRS[prev] === next || (QUOTES.includes(prev) && prev === next))) {
          return { a: P(h.line, h.col - 1), b: P(h.line, h.col + 1), text: '' };
        }
        from = this.stepLeft(h);
      }
      return eq(from, h) ? null : { a: from, b: h, text: '' };
    }, 'del');
    if (this.completion) this.updateCompletion();
  }

  _deleteForward(mod, alt) {
    const b = this.buffer;
    this.applyPlans((s) => {
      if (!isEmpty(s)) return { a: startOf(s), b: endOf(s), text: '' };
      const h = s.head;
      const text = b.getLine(h.line);
      let to;
      if (mod) to = h.col >= text.length ? this.stepRight(h) : P(h.line, text.length);
      else if (alt) to = this.wordRight(h);
      else to = this.stepRight(h);
      return eq(to, h) ? null : { a: h, b: to, text: '' };
    }, 'del');
  }
}
