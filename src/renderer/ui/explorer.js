// File explorer tree: lazy directory loading, inline create/rename, context menu, keyboard navigation.

import { fileIconHtml, folderIconHtml } from './fileicons.js';
import { icon, el, escapeHtml, basename, dirname, joinPath, relPath, showMenu, toast } from './util.js';

export class Explorer {
  constructor({ tree, title, empty }, hooks) {
    this.tree = tree;
    this.titleEl = title;
    this.emptyEl = empty;
    this.hooks = hooks; // { openFile(path), renamed(from, to), deleted(path), confirm(opts) }
    this.api = window.sunlight;
    this.root = null;
    this.expanded = new Set();
    this.children = new Map();
    this.selected = null;
    this.openFiles = new Set();
    this.pending = null; // { kind: 'file'|'folder', parent } while creating
    this.renaming = null;
    this.revealSeq = 0;
    this.tree.hidden = true; // until a folder is opened
    this.emptyEl.hidden = false;
    this._bind();
  }

  async setRoot(root) {
    this.root = root;
    this.expanded = new Set(root ? [root] : []);
    this.children.clear();
    this.selected = null;
    this.titleEl.textContent = root ? basename(root) : 'Explorer';
    this.emptyEl.hidden = !!root;
    this.tree.hidden = !root;
    if (root) {
      // Show a skeleton only if the folder is slow to read, to avoid a flash on fast disks.
      const t = setTimeout(() => this.renderSkeleton(), 140);
      await this.load(root);
      clearTimeout(t);
      this.enter = new Set((this.children.get(root) || []).map((e) => e.path));
    }
    this.render();
  }

  renderSkeleton() {
    const widths = [62, 48, 74, 55, 68, 44, 58];
    this.tree.innerHTML = widths.map((w, i) => `<div class="row skel" style="animation-delay:${i * 80}ms"><span class="sk" style="width:${w}%"></span></div>`).join('');
  }

  async load(dir) {
    try {
      this.children.set(dir, await this.api.fs.readDir(dir));
    } catch (err) {
      this.children.set(dir, []);
      toast(`Cannot read ${basename(dir)}: ${err.message}`, { error: true });
    }
  }

  async refresh(dirs) {
    if (!this.root) return;
    const targets = (dirs ? dirs.filter((d) => this.children.has(d)) : [...this.children.keys()]);
    await Promise.all(targets.map((d) => this.load(d)));
    this.render();
  }

  setOpenFiles(paths) {
    this.openFiles = new Set(paths);
    this.render();
  }

  collapseAll() {
    this.expanded = new Set(this.root ? [this.root] : []);
    this.render();
  }

  async reveal(path) {
    if (!this.root || !path.startsWith(this.root + '/')) return;
    const seq = ++this.revealSeq;
    const parts = relPath(this.root, path).split('/');
    let cur = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = joinPath(cur, parts[i]);
      if (!this.children.has(cur)) await this.load(cur);
      this.expanded.add(cur);
    }
    if (seq !== this.revealSeq) return; // a newer reveal superseded this one
    this.selected = path;
    this.render();
    this.tree.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
  }

  // ---- rendering ----
  visibleRows() {
    const rows = [];
    const walk = (dir, depth) => {
      if (this.pending && this.pending.parent === dir) rows.push({ type: 'create', depth, dir });
      for (const e of this.children.get(dir) || []) {
        rows.push({ type: 'entry', entry: e, depth });
        if (e.isDir && this.expanded.has(e.path)) walk(e.path, depth + 1);
      }
    };
    if (this.root) walk(this.root, 0);
    return rows;
  }

  render() {
    const enter = this.enter;
    this.enter = null;
    let enterIdx = 0;
    const rows = this.visibleRows();
    this.rows = rows;
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      if (r.type === 'create') { frag.append(this.createRow(r)); continue; }
      const e = r.entry;
      const open = e.isDir && this.expanded.has(e.path);
      const cls = ['row'];
      if (e.path === this.selected) cls.push('selected');
      const dec = this.hooks.decor ? this.hooks.decor(e.path, e.isDir) : null;
      if (dec) cls.push('g-' + dec.cls);
      if (!e.isDir && this.openFiles.has(e.path)) cls.push('open-file');
      const row = el('div', { class: cls.join(' '), role: 'treeitem', 'data-path': e.path, 'data-dir': e.isDir ? '1' : '0', 'aria-expanded': e.isDir ? String(open) : false });
      row.style.paddingLeft = 6 + r.depth * 14 + 'px';
      row.innerHTML = `${icon('chevron', 'sm chev' + (open ? ' open' : '') + (e.isDir ? '' : ' none'))}${e.isDir ? folderIconHtml(e.name, open) : fileIconHtml(e.name)}<span class="name">${escapeHtml(e.name)}</span>${dec && dec.badge ? `<span class="gbadge">${dec.badge}</span>` : (dec && dec.cls !== 'ignored' && e.isDir ? '<span class="gdot"></span>' : '')}`;
      if (enter && enter.has(e.path)) { row.classList.add('enter'); row.style.animationDelay = Math.min(enterIdx++, 14) * 22 + 'ms'; }
      if (this.renaming === e.path) this.mountRename(row, e);
      frag.append(row);
    }
    this.tree.replaceChildren(frag);
    const input = this.tree.querySelector('input');
    if (input) { input.focus(); input.select(); }
  }

  createRow(r) {
    const row = el('div', { class: 'row' });
    row.style.paddingLeft = 6 + r.depth * 14 + 'px';
    row.innerHTML = `${icon('chevron', 'sm chev none')}${this.pending.kind === 'folder' ? folderIconHtml('', false) : fileIconHtml('')}`;
    const input = el('input', { class: 'rename', type: 'text', spellcheck: 'false', 'aria-label': 'New name' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.commitCreate(input.value.trim()); }
      else if (e.key === 'Escape') { this.pending = null; this.render(); this.tree.focus(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => { if (this.pending) { this.pending = null; this.render(); } });
    row.append(input);
    return row;
  }

  mountRename(row, e) {
    const name = row.querySelector('.name');
    const input = el('input', { class: 'rename', type: 'text', spellcheck: 'false', value: e.name, 'aria-label': 'Rename' });
    name.replaceWith(input);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); this.commitRename(e, input.value.trim()); }
      else if (ev.key === 'Escape') { this.renaming = null; this.render(); this.tree.focus(); }
      ev.stopPropagation();
    });
    input.addEventListener('blur', () => { if (this.renaming) { this.renaming = null; this.render(); } });
    requestAnimationFrame(() => {
      input.focus();
      const dot = e.name.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 && !e.isDir ? dot : e.name.length);
    });
  }

  // ---- actions ----
  targetDir() {
    if (!this.root) return null;
    if (!this.selected) return this.root;
    const row = this.rows?.find((r) => r.type === 'entry' && r.entry.path === this.selected);
    if (!row) return this.root;
    return row.entry.isDir ? row.entry.path : dirname(row.entry.path);
  }

  async startCreate(kind, parent = this.targetDir()) {
    if (!this.root) return;
    if (!this.children.has(parent)) await this.load(parent);
    this.expanded.add(parent);
    this.pending = { kind, parent };
    this.render();
  }

  async commitCreate(name) {
    const p = this.pending;
    this.pending = null;
    if (!name) { this.render(); return; }
    const target = joinPath(p.parent, name);
    try {
      if (p.kind === 'folder') await this.api.fs.createDir(target);
      else await this.api.fs.createFile(target);
    } catch (err) {
      toast(err.code === 'EEXIST' || /EEXIST/.test(err.message) ? `"${name}" already exists` : err.message, { error: true });
      this.render();
      return;
    }
    await this.load(p.parent);
    this.selected = target;
    if (p.kind === 'folder') this.expanded.add(target);
    this.render();
    if (p.kind === 'file') this.hooks.openFile(target);
  }

  startRename(path = this.selected) {
    if (!path || path === this.root) return;
    this.renaming = path;
    this.render();
  }

  async commitRename(entry, name) {
    this.renaming = null;
    if (!name || name === entry.name) { this.render(); return; }
    const to = joinPath(dirname(entry.path), name);
    try {
      await this.api.fs.rename(entry.path, to);
    } catch (err) {
      toast(err.message, { error: true });
      this.render();
      return;
    }
    await this.load(dirname(entry.path));
    if (this.expanded.delete(entry.path)) this.expanded.add(to);
    this.selected = to;
    this.render();
    this.hooks.renamed(entry.path, to);
  }

  async deletePath(path = this.selected) {
    if (!path || path === this.root) return;
    const choice = await this.hooks.confirm({
      message: `Move "${basename(path)}" to the Trash?`, detail: 'You can restore it from the Trash.', buttons: ['Move to Trash', 'Cancel'], defaultId: 0, cancelId: 1,
    });
    if (choice !== 0) return;
    try { await this.api.fs.trash(path); } catch (err) { toast(err.message, { error: true }); return; }
    await this.load(dirname(path));
    if (this.selected === path) this.selected = null;
    this.render();
    this.hooks.deleted(path);
  }

  // ---- events ----
  _bind() {
    const t = this.tree;
    t.addEventListener('click', (e) => {
      const row = e.target.closest('.row');
      if (!row || !row.dataset.path) return;
      this.selectRow(row, true);
    });
    t.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const row = e.target.closest('.row');
      if (row?.dataset.path) { this.selected = row.dataset.path; this.render(); }
      else this.selected = null;
      this.menuAt(e.clientX, e.clientY, row?.dataset.path || null, row?.dataset.dir === '1');
    });
    t.addEventListener('keydown', (e) => this.onKey(e));
  }

  async selectRow(row, fromClick) {
    const path = row.dataset.path;
    this.selected = path;
    if (row.dataset.dir === '1') {
      if (this.expanded.has(path)) this.expanded.delete(path);
      else {
        if (!this.children.has(path)) await this.load(path);
        this.expanded.add(path);
        this.enter = new Set((this.children.get(path) || []).map((c) => c.path));
      }
      this.render();
    } else {
      this.render();
      this.hooks.openFile(path, { fromTree: true });
    }
    if (fromClick) this.tree.focus({ preventScroll: true });
  }

  menuAt(x, y, path, isDir) {
    const root = this.root;
    if (!root) return;
    const parent = path ? (isDir ? path : dirname(path)) : root;
    const items = [
      { label: 'New File', run: () => this.startCreate('file', parent) },
      { label: 'New Folder', run: () => this.startCreate('folder', parent) },
    ];
    if (path) {
      items.push('-',
        { label: 'Rename', hint: 'F2', run: () => this.startRename(path) },
        { label: 'Move to Trash', run: () => this.deletePath(path) },
        '-',
        { label: 'Reveal in Finder', run: () => this.api.fs.reveal(path) },
        { label: 'Copy Path', run: () => navigator.clipboard?.writeText(path).catch(() => {}) },
        { label: 'Copy Relative Path', run: () => navigator.clipboard?.writeText(relPath(root, path)).catch(() => {}) });
    }
    showMenu(x, y, items);
  }

  onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    const rows = this.rows?.filter((r) => r.type === 'entry') || [];
    if (!rows.length) return;
    let i = rows.findIndex((r) => r.entry.path === this.selected);
    const cur = rows[i];
    const select = (k) => {
      k = Math.max(0, Math.min(rows.length - 1, k));
      this.selected = rows[k].entry.path;
      this.render();
      this.tree.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
    };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); select(i + 1); break;
      case 'ArrowUp': e.preventDefault(); select(i < 0 ? 0 : i - 1); break;
      case 'ArrowRight':
        if (cur?.entry.isDir) {
          e.preventDefault();
          if (!this.expanded.has(cur.entry.path)) this.selectRow(this.tree.querySelector('.row.selected'));
          else select(i + 1);
        }
        break;
      case 'ArrowLeft':
        if (cur) {
          e.preventDefault();
          if (cur.entry.isDir && this.expanded.has(cur.entry.path)) { this.expanded.delete(cur.entry.path); this.render(); }
          else {
            const pi = rows.findIndex((r) => r.entry.path === dirname(cur.entry.path));
            if (pi >= 0) select(pi);
          }
        }
        break;
      case 'Enter':
        if (cur) { e.preventDefault(); this.selectRow(this.tree.querySelector('.row.selected')); }
        break;
      case 'F2': e.preventDefault(); this.startRename(); break;
      case 'Delete': e.preventDefault(); this.deletePath(); break;
      case 'Backspace': if (e.metaKey) { e.preventDefault(); this.deletePath(); } break;
      default: break;
    }
  }
}
