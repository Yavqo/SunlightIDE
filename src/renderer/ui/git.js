// Renderer-side git state: one status snapshot per opened folder, plus helpers to turn it into
// file/folder decorations and the groups shown in the Source Control panel.

import { diffLines, markersFromHunks } from '../editor/diff.js';

// Most significant first; used to colour a folder by what's inside it.
const PRIORITY = ['conflict', 'deleted', 'modified', 'added', 'untracked'];

export const LETTER = { conflict: '!', deleted: 'D', modified: 'M', added: 'A', untracked: 'U', renamed: 'R', ignored: '' };

// Decoration class for one status entry (working-tree state wins over staged state).
export function classify(e) {
  if (e.kind === 'unmerged') return 'conflict';
  if (e.kind === 'untracked') return 'untracked';
  if (e.kind === 'ignored') return 'ignored';
  const c = e.y !== '.' ? e.y : e.x;
  if (c === 'D') return 'deleted';
  if (c === 'A' || c === 'R' || c === 'C') return 'added';
  return 'modified';
}

export function letterFor(e, staged) {
  if (e.kind === 'unmerged') return '!';
  if (e.kind === 'untracked') return 'U';
  const c = staged ? e.x : e.y;
  return c === '.' || c === ' ' ? 'M' : c;
}

export class GitState {
  constructor() {
    this.api = window.sunlight;
    this.dir = null;
    this.status = null;
    this.error = null;
    this.listeners = new Set();
    this.byPath = new Map();
    this.dirClass = new Map();
    this.seq = 0;
    this.timer = null;
    this.heads = new Map(); // `${oid}:${rel}` -> text
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(detail) { for (const fn of this.listeners) fn(detail); }

  get isRepo() { return !!(this.status && this.status.isRepo); }
  get available() { return !this.status || this.status.available !== false; }

  setFolder(dir) {
    this.dir = dir;
    this.status = null;
    this.error = null;
    this.heads.clear();
    this.rebuild();
    if (dir) this.refresh(); else this.emit({ headChanged: true });
  }

  scheduleRefresh(ms = 400) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), ms);
  }

  async refresh() {
    if (!this.dir) return null;
    const seq = ++this.seq;
    let s;
    try { s = await this.api.git('status', this.dir); this.error = null; } catch (err) { this.error = err.message; s = { available: !/not found/i.test(err.message), isRepo: false, entries: [] }; }
    if (seq !== this.seq) return this.status;
    const prev = this.status;
    this.status = s;
    this.rebuild();
    this.emit({ headChanged: !prev || prev.oid !== s.oid || prev.branch !== s.branch || prev.isRepo !== s.isRepo });
    return s;
  }

  rebuild() {
    this.byPath.clear();
    this.dirClass.clear();
    const s = this.status;
    if (!s || !s.isRepo) return;
    for (const e of s.entries) {
      const cls = classify(e);
      this.byPath.set(e.path.replace(/\/$/, ''), { ...e, cls });
      if (cls === 'ignored') continue;
      let dir = e.path.replace(/\/$/, '');
      while (dir.includes('/')) {
        dir = dir.slice(0, dir.lastIndexOf('/'));
        const cur = this.dirClass.get(dir);
        if (!cur || PRIORITY.indexOf(cls) < PRIORITY.indexOf(cur)) this.dirClass.set(dir, cls);
      }
      // top-level changes colour the repo root
      const root = this.dirClass.get('');
      if (!root || PRIORITY.indexOf(cls) < PRIORITY.indexOf(root)) this.dirClass.set('', cls);
    }
  }

  // Path of `abs` relative to the repository root, or null when it is outside the opened folder.
  toRel(abs) {
    const s = this.status;
    if (!s || !s.isRepo || !this.dir) return null;
    const base = this.dir.replace(/\/+$/, '');
    let inner;
    if (abs === base) inner = '';
    else if (abs.startsWith(base + '/')) inner = abs.slice(base.length + 1);
    else return null;
    const prefix = s.prefix || '';
    return prefix ? (inner ? `${prefix}/${inner}` : prefix) : inner;
  }

  toAbs(rel) {
    const s = this.status;
    const prefix = s?.prefix || '';
    const inner = prefix && rel.startsWith(prefix + '/') ? rel.slice(prefix.length + 1) : rel;
    return `${this.dir.replace(/\/+$/, '')}/${inner}`;
  }

  entryFor(abs) {
    const rel = this.toRel(abs);
    if (rel == null) return null;
    return this.byPath.get(rel) || this.ignoredAncestor(rel);
  }

  // A file inside an ignored directory is ignored too (git only lists the directory).
  ignoredAncestor(rel) {
    let d = rel;
    while (d.includes('/')) {
      d = d.slice(0, d.lastIndexOf('/'));
      const e = this.byPath.get(d);
      if (e && e.cls === 'ignored') return { ...e, path: rel };
    }
    return null;
  }

  // { cls, badge } for the explorer.
  decor(abs, isDir) {
    const rel = this.toRel(abs);
    if (rel == null) return null;
    if (isDir) {
      const own = this.byPath.get(rel);
      if (own && own.cls === 'ignored') return { cls: 'ignored', badge: '' };
      const anc = this.ignoredAncestor(rel);
      if (anc) return { cls: 'ignored', badge: '' };
      const c = this.dirClass.get(rel);
      return c ? { cls: c, badge: '' } : null;
    }
    const e = this.byPath.get(rel) || this.ignoredAncestor(rel);
    if (!e) return null;
    return { cls: e.cls, badge: e.cls === 'ignored' ? '' : letterFor(e, e.y === '.') };
  }

  groups() {
    const out = { conflicts: [], staged: [], changes: [] };
    if (!this.isRepo) return out;
    for (const e of this.status.entries) {
      if (e.kind === 'ignored') continue;
      const cls = classify(e);
      if (e.kind === 'unmerged') { out.conflicts.push({ ...e, cls }); continue; }
      if (e.kind === 'untracked') { out.changes.push({ ...e, cls }); continue; }
      if (e.x !== '.') out.staged.push({ ...e, cls: classify({ ...e, y: '.' }) });
      if (e.y !== '.') out.changes.push({ ...e, cls: classify({ ...e, x: '.' }) });
    }
    const byName = (a, b) => a.path.localeCompare(b.path);
    out.conflicts.sort(byName); out.staged.sort(byName); out.changes.sort(byName);
    return out;
  }

  get count() {
    const g = this.groups();
    return new Set([...g.conflicts, ...g.staged, ...g.changes].map((e) => e.path)).size;
  }

  // ---- HEAD content and change markers for an open file ----
  async headFor(rel) {
    const s = this.status;
    const key = `${s.oid}:${rel}`;
    if (this.heads.has(key)) return this.heads.get(key);
    let r = null;
    try { r = await this.api.git('headText', this.dir, rel); } catch { r = null; }
    const val = r && r.text != null ? r.text : r && r.binary ? undefined : '';
    this.heads.set(key, val);
    if (this.heads.size > 200) this.heads.delete(this.heads.keys().next().value);
    return val;
  }

  // Markers for `lines` (the buffer) compared with HEAD, or null when the file isn't tracked here.
  async markersFor(abs, lines) {
    const rel = this.toRel(abs);
    if (rel == null || !this.isRepo) return null;
    const entry = this.byPath.get(rel);
    if ((entry && entry.cls === 'ignored') || this.ignoredAncestor(rel)) return null;
    if (lines.length > 40000) return null;
    let head;
    if (entry && entry.kind === 'untracked') head = '';
    else head = await this.headFor(rel);
    if (head === undefined) return null; // binary
    const base = head === '' ? [] : head.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    // The buffer has an extra empty last line when the file ends with a newline; HEAD text had it trimmed.
    let cur = lines;
    if (cur.length && cur[cur.length - 1] === '') cur = cur.slice(0, -1);
    return markersFromHunks(diffLines(base, cur.map((l) => l.replace(/\r$/, ''))));
  }
}
