// Source Control sidebar panel: branch, commit box and the lists of staged / changed files.

import { icon, el, escapeHtml, basename, dirname } from './util.js';
import { fileIconHtml } from './fileicons.js';
import { letterFor } from './git.js';

const TITLES = { conflicts: 'Merge Conflicts', staged: 'Staged Changes', changes: 'Changes' };

export class GitPanel {
  constructor(root, git, hooks) {
    this.root = root;
    this.git = git;
    this.hooks = hooks;
    this.collapsed = new Set();
    this.busy = false;
    root.innerHTML = `
      <div class="panel-head">
        <span class="panel-title">Source Control</span>
        <span class="panel-actions always">
          <button class="icon-btn sm" data-a="refresh" aria-label="Refresh" title="Refresh">${icon('refresh', 'sm')}</button>
          <button class="icon-btn sm" data-a="pull" aria-label="Pull" title="Pull">${icon('down', 'sm')}</button>
          <button class="icon-btn sm" data-a="push" aria-label="Push" title="Push">${icon('up', 'sm')}</button>
        </span>
      </div>
      <div class="gp-body">
        <button class="gp-branch" data-a="branch" title="Switch branch"></button>
        <div class="gp-commit">
          <textarea rows="1" placeholder="Message (⌘↩ to commit)" aria-label="Commit message" spellcheck="true"></textarea>
          <div class="gp-commit-row">
            <button class="btn primary sm gp-go" data-a="commit">${icon('check', 'sm')}<span>Commit</span></button>
            <button class="chip-toggle gp-amend" data-a="amend" aria-pressed="false" title="Replace the last commit">Amend</button>
          </div>
        </div>
        <div class="gp-list" tabindex="0"></div>
        <div class="gp-empty" hidden></div>
      </div>`;
    this.branchEl = root.querySelector('.gp-branch');
    this.msg = root.querySelector('textarea');
    this.goBtn = root.querySelector('.gp-go');
    this.amendBtn = root.querySelector('.gp-amend');
    this.listEl = root.querySelector('.gp-list');
    this.emptyEl = root.querySelector('.gp-empty');
    this.commitBox = root.querySelector('.gp-commit');
    this.amend = false;

    this.msg.addEventListener('input', () => { this.autosize(); this.updateButtons(); });
    this.msg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.commit(); }
      e.stopPropagation();
    });
    root.addEventListener('click', (e) => this.onClick(e));
    this.listEl.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.gp-row');
      if (row) { e.preventDefault(); this.hooks.rowMenu(e.clientX, e.clientY, this.entryOf(row), row.dataset.group); }
    });
    git.onChange(() => this.render());
    this.render();
  }

  autosize() {
    this.msg.style.height = 'auto';
    this.msg.style.height = Math.min(140, this.msg.scrollHeight) + 'px';
    this.msg.style.overflowY = this.msg.scrollHeight > 140 ? 'auto' : 'hidden';
  }

  setBusy(on) {
    this.busy = on;
    this.root.classList.toggle('busy', on);
    this.updateButtons();
  }

  focusMessage() { this.msg.focus(); }

  entryOf(row) {
    const g = this.git.groups()[row.dataset.group];
    return g && g.find((e) => e.path === row.dataset.path);
  }

  updateButtons() {
    const g = this.git.groups();
    const hasChanges = g.staged.length + g.changes.length + g.conflicts.length > 0;
    const msgOk = this.msg.value.trim().length > 0;
    this.goBtn.disabled = this.busy || !(msgOk && (hasChanges || this.amend));
    this.goBtn.querySelector('span').textContent = this.amend ? 'Amend' : g.staged.length || !hasChanges ? 'Commit' : 'Commit all';
    this.amendBtn.setAttribute('aria-pressed', String(this.amend));
  }

  async commit() {
    if (this.goBtn.disabled) return;
    const message = this.msg.value;
    const ok = await this.hooks.commit(message, { amend: this.amend });
    if (ok) { this.msg.value = ''; this.amend = false; this.autosize(); this.updateButtons(); }
  }

  onClick(e) {
    const act = e.target.closest('[data-a]');
    if (act && !act.closest('.gp-row')) {
      const a = act.dataset.a;
      if (a === 'commit') this.commit();
      else if (a === 'amend') { this.amend = !this.amend; this.updateButtons(); }
      else if (a === 'branch') this.hooks.branchPicker();
      else if (a === 'refresh') this.hooks.refresh();
      else if (a === 'pull') this.hooks.pull();
      else if (a === 'push') this.hooks.push();
      else if (a === 'init') this.hooks.init();
      else if (a === 'open-folder') this.hooks.openFolder();
      else if (a === 'stage-all') this.hooks.stage([]);
      else if (a === 'unstage-all') this.hooks.unstage([]);
      else if (a === 'discard-all') this.hooks.discardAll();
      return;
    }
    const head = e.target.closest('.gp-sec-head');
    if (head && !e.target.closest('button')) {
      const k = head.dataset.group;
      if (this.collapsed.has(k)) this.collapsed.delete(k); else this.collapsed.add(k);
      this.render();
      return;
    }
    const row = e.target.closest('.gp-row');
    if (!row) return;
    const entry = this.entryOf(row);
    if (!entry) return;
    const btn = e.target.closest('button[data-a]');
    const group = row.dataset.group;
    if (btn) {
      const a = btn.dataset.a;
      if (a === 'stage') this.hooks.stage([entry.path]);
      else if (a === 'unstage') this.hooks.unstage([entry.path]);
      else if (a === 'discard') this.hooks.discard([entry]);
      else if (a === 'open') this.hooks.openFile(entry);
      return;
    }
    this.hooks.openDiff(entry, group);
  }

  render() {
    const s = this.git.status;
    const showBody = (...parts) => { this.commitBox.hidden = !parts.includes('commit'); this.branchEl.hidden = !parts.includes('branch'); this.listEl.hidden = !parts.includes('list'); this.emptyEl.hidden = !parts.includes('empty'); };
    if (!this.git.dir) {
      showBody('empty');
      this.emptyEl.innerHTML = '<p>Open a folder to use source control.</p><button class="btn primary" data-a="open-folder">Open folder</button>';
      return;
    }
    if (s && s.available === false) {
      showBody('empty');
      this.emptyEl.innerHTML = `<p>${escapeHtml(this.git.error || 'Git was not found. Install Git to use source control.')}</p>`;
      return;
    }
    if (!s) { showBody('empty'); this.emptyEl.innerHTML = '<p class="muted">Checking repository…</p>'; return; }
    if (!s.isRepo) {
      showBody('empty');
      this.emptyEl.innerHTML = '<p>This folder is not a Git repository yet.</p><button class="btn primary" data-a="init">Initialize repository</button>';
      return;
    }
    showBody('branch', 'commit', 'list');
    const sync = [s.ahead ? `↑${s.ahead}` : '', s.behind ? `↓${s.behind}` : ''].filter(Boolean).join(' ');
    this.branchEl.innerHTML = `${icon('branch', 'sm')}<span class="bn">${escapeHtml(s.branch || (s.detached ? 'detached HEAD' : 'no commits yet'))}</span>${sync ? `<span class="sync">${sync}</span>` : ''}<span class="chev">${icon('down', 'sm')}</span>`;

    const g = this.git.groups();
    const frag = document.createDocumentFragment();
    let any = false;
    for (const key of ['conflicts', 'staged', 'changes']) {
      const list = g[key];
      if (!list.length) continue;
      any = true;
      const open = !this.collapsed.has(key);
      const head = el('div', { class: 'gp-sec-head', 'data-group': key, role: 'button', 'aria-expanded': String(open) });
      head.innerHTML = `<span class="gp-chev${open ? ' open' : ''}">${icon('chevron', 'sm')}</span><span class="gp-sec-title">${TITLES[key]}</span><span class="gp-count">${list.length}</span><span class="gp-sec-actions">${
        key === 'staged' ? `<button class="icon-btn sm" data-a="unstage-all" aria-label="Unstage all" title="Unstage all">${icon('minus', 'sm')}</button>`
          : key === 'changes' ? `<button class="icon-btn sm" data-a="discard-all" aria-label="Discard all changes" title="Discard all changes">${icon('undo', 'sm')}</button><button class="icon-btn sm" data-a="stage-all" aria-label="Stage all" title="Stage all">${icon('plus', 'sm')}</button>` : ''}</span>`;
      frag.append(head);
      if (!open) continue;
      for (const e of list) {
        const name = basename(e.path);
        const dir = dirname(e.path);
        const staged = key === 'staged';
        const row = el('div', { class: `gp-row g-${e.cls}`, 'data-group': key, 'data-path': e.path, title: e.path + (e.orig ? ` (renamed from ${e.orig})` : '') });
        row.innerHTML = `${fileIconHtml(name)}<span class="gp-name">${escapeHtml(name)}</span><span class="gp-dir">${dir && dir !== '.' && dir !== '/' ? escapeHtml(dir) : ''}</span>
          <span class="gp-acts">
            <button class="icon-btn sm" data-a="open" aria-label="Open file" title="Open file">${icon('file', 'sm')}</button>
            ${staged ? `<button class="icon-btn sm" data-a="unstage" aria-label="Unstage" title="Unstage">${icon('minus', 'sm')}</button>`
              : `<button class="icon-btn sm" data-a="discard" aria-label="Discard changes" title="Discard changes">${icon('undo', 'sm')}</button><button class="icon-btn sm" data-a="stage" aria-label="Stage" title="Stage">${icon('plus', 'sm')}</button>`}
          </span><span class="gp-letter">${letterFor(e, staged)}</span>`;
        frag.append(row);
      }
    }
    if (!any) {
      frag.append(el('div', { class: 'gp-clean', html: `${icon('check')}<span>No changes. Working tree is clean.</span>` }));
    }
    this.listEl.replaceChildren(frag);
    this.updateButtons();
  }
}
