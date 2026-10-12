// Text buffer: an array of lines with position-based edits and an undo/redo history.
// Pure logic, no DOM, so it can be unit tested under Node.

export class Pos {
  constructor(line, col) {
    this.line = line;
    this.col = col;
  }
}

export const cmp = (a, b) => (a.line - b.line) || (a.col - b.col);
export const eq = (a, b) => a.line === b.line && a.col === b.col;

export function buildRegex(query, { caseSensitive = false, regex = false, wholeWord = false } = {}) {
  try {
    let src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) src = `\\b(?:${src})\\b`;
    return new RegExp(src, caseSensitive ? 'g' : 'gi');
  } catch { return null; }
}

export class Buffer {
  constructor(text = '') {
    this.eol = text.includes('\r\n') ? '\r\n' : '\n';
    this.lines = text.split(/\r\n|\r|\n/);
    this.version = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.savedVersion = 0;
    this.lastEditTime = 0;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get lineCount() { return this.lines.length; }
  getLine(n) { return this.lines[n] ?? ''; }
  getText() { return this.lines.join(this.eol); }
  get dirty() { return this.version !== this.savedVersion; }
  markSaved() { this.savedVersion = this.version; }

  clampPos(p) {
    const line = Math.max(0, Math.min(p.line, this.lines.length - 1));
    const col = Math.max(0, Math.min(p.col, this.lines[line].length));
    return new Pos(line, col);
  }

  getRange(a, b) {
    if (cmp(a, b) > 0) [a, b] = [b, a];
    if (a.line === b.line) return this.lines[a.line].slice(a.col, b.col);
    const out = [this.lines[a.line].slice(a.col)];
    for (let i = a.line + 1; i < b.line; i++) out.push(this.lines[i]);
    out.push(this.lines[b.line].slice(0, b.col));
    return out.join('\n');
  }

  // Replace [a, b) with text. Returns the position at the end of the inserted text.
  // `record` false is used by undo/redo replays. `cursorBefore` is stored for undo.
  replace(a, b, text, opts = {}) {
    if (cmp(a, b) > 0) [a, b] = [b, a];
    a = this.clampPos(a);
    b = this.clampPos(b);
    const removed = this.getRange(a, b);
    const ins = text.split(/\r\n|\r|\n/);
    const head = this.lines[a.line].slice(0, a.col);
    const tail = this.lines[b.line].slice(b.col);
    let end;
    if (ins.length === 1) {
      this.lines.splice(a.line, b.line - a.line + 1, head + ins[0] + tail);
      end = new Pos(a.line, a.col + ins[0].length);
    } else {
      const mid = ins.slice();
      mid[0] = head + mid[0];
      const last = mid.length - 1;
      end = new Pos(a.line + last, mid[last].length);
      mid[last] += tail;
      this.lines.splice(a.line, b.line - a.line + 1, ...mid);
    }
    this.version++;
    if (opts.record !== false) {
      this._record({ at: a, removed, inserted: text.replace(/\r\n|\r/g, '\n'), selBefore: opts.selBefore, selAfter: opts.selAfter });
    }
    const change = { start: a, oldEnd: b, newEnd: end, removed, inserted: text };
    for (const fn of this.listeners) fn(change);
    return end;
  }

  // Group edits made close in time/with the same tag into one undo step.
  _record(entry) {
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    this.redoStack.length = 0;
    if (this._batch) {
      this._batch.edits.push(entry);
      return;
    }
    const mergeable = top && !top.sealed && now - this.lastEditTime < 700 && top.edits.length < 200
      && top.tag && top.tag === this.nextTag;
    if (mergeable) top.edits.push(entry);
    else this.undoStack.push({ edits: [entry], tag: this.nextTag, sealed: false, selBefore: entry.selBefore });
    this.lastEditTime = now;
  }

  // Run several edits as a single undo step. With a `tag` ("type", "del"), consecutive batches with the
  // same tag are merged into one step until the user pauses or moves the cursor.
  batch(fn, selBefore, tag) {
    if (this._batch) return fn();
    this._batch = { edits: [] };
    try { fn(); } finally {
      const b = this._batch;
      this._batch = null;
      if (b.edits.length) {
        const top = this.undoStack[this.undoStack.length - 1];
        const now = Date.now();
        if (tag && top && top.batchTag === tag && !top.sealed && now - this.lastEditTime < 700 && top.edits.length < 400) {
          top.edits.push(...b.edits);
        } else {
          this.undoStack.push({ edits: b.edits, sealed: !tag, batchTag: tag, selBefore: selBefore ?? b.edits[0].selBefore });
        }
        this.lastEditTime = tag ? now : 0;
      }
    }
  }

  // Remember the selection to restore when this step is redone.
  setSelAfter(sel) {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.selAfter = sel;
  }

  sealUndo() {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.sealed = true;
  }

  // Returns the cursor selection to restore, or null if nothing to undo.
  undo() {
    const step = this.undoStack.pop();
    if (!step) return null;
    let sel = null;
    for (let i = step.edits.length - 1; i >= 0; i--) {
      const e = step.edits[i];
      const end = this._endOf(e.at, e.inserted);
      this.replace(e.at, end, e.removed, { record: false });
      sel = { anchor: e.at, head: this._endOf(e.at, e.removed) };
    }
    this.redoStack.push(step);
    return step.selBefore || sel;
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return null;
    let sel = null;
    for (const e of step.edits) {
      const end = this._endOf(e.at, e.removed);
      const after = this.replace(e.at, end, e.inserted, { record: false });
      sel = { anchor: after, head: after };
    }
    step.sealed = true;
    this.undoStack.push(step);
    return step.selAfter || sel;
  }

  _endOf(at, text) {
    const parts = text.split('\n');
    if (parts.length === 1) return new Pos(at.line, at.col + parts[0].length);
    return new Pos(at.line + parts.length - 1, parts[parts.length - 1].length);
  }

  // Offset helpers for search.
  find(query, opts = {}) {
    const results = [];
    if (!query) return results;
    const re = buildRegex(query, opts);
    if (!re) return results;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        results.push({ line: i, start: m.index, end: m.index + m[0].length, text: m[0] });
        if (results.length > 20000) return results;
      }
    }
    return results;
  }
}
