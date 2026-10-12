// Quick-pick palette used for commands, file open, go-to-line and generic pickers.

import { el, highlight, escapeHtml } from './util.js';

export class Palette {
  constructor(overlay) {
    this.overlay = overlay;
    this.cfg = null;
    this.items = [];
    this.index = 0;
    this.seq = 0;
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.close(); });
  }

  get isOpen() { return !this.overlay.hidden && !!this.cfg; }

  // cfg: { placeholder, value, provider(query) -> items | Promise<items>, accept(item, query), hint(query), onClose }
  // item: { label, detail, keys, indices, data }
  show(cfg) {
    this.close(true);
    this.cfg = cfg;
    this.prevFocus = document.activeElement;
    this.overlay.hidden = false;
    this.overlay.replaceChildren();
    const box = el('div', { class: 'palette', role: 'dialog', 'aria-label': cfg.placeholder || 'Palette' });
    this.input = el('input', { type: 'text', placeholder: cfg.placeholder || '', spellcheck: 'false', 'aria-label': cfg.placeholder || 'Search' });
    this.input.value = cfg.value || '';
    this.hintEl = el('div', { class: 'p-hint', hidden: true });
    this.listEl = el('div', { class: 'p-list', role: 'listbox' });
    box.append(el('div', { class: 'field-pill' }, this.input), this.hintEl, this.listEl);
    this.overlay.append(box);
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.listEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const row = e.target.closest('.p-item');
      if (row) this.accept(+row.dataset.i);
    });
    this.listEl.addEventListener('mousemove', (e) => {
      const row = e.target.closest('.p-item');
      if (row && +row.dataset.i !== this.index) { this.index = +row.dataset.i; this.paintSelection(false); }
    });
    this.input.focus();
    if (cfg.value) this.input.setSelectionRange(cfg.value.length, cfg.value.length);
    this.refresh();
  }

  close(silent = false) {
    if (!this.cfg) return;
    const cfg = this.cfg;
    this.cfg = null;
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
    if (!silent) {
      cfg.onClose?.();
      if (this.prevFocus && document.contains(this.prevFocus)) this.prevFocus.focus?.();
    }
  }

  async refresh() {
    const cfg = this.cfg;
    if (!cfg) return;
    const q = this.input.value;
    const seq = ++this.seq;
    const hint = cfg.hint?.(q);
    this.hintEl.hidden = !hint;
    this.hintEl.textContent = hint || '';
    const items = await cfg.provider(q);
    if (seq !== this.seq || !this.cfg) return;
    this.items = items.slice(0, 120);
    this.index = 0;
    this.paint();
  }

  paint() {
    const frag = document.createDocumentFragment();
    if (!this.items.length) {
      frag.append(el('div', { class: 'p-empty' }, this.cfg.empty || 'No matching results'));
    }
    this.items.forEach((it, i) => {
      const row = el('div', { class: 'p-item' + (i === this.index ? ' sel' : ''), role: 'option', 'data-i': String(i) });
      if (it.icon) row.append(el('img', { class: 'fi', src: it.icon, alt: '', draggable: 'false' }));
      row.append(el('span', { class: 'pl', html: it.indices ? highlight(it.label, it.indices) : escapeHtml(it.label) }));
      if (it.detail) row.append(el('span', { class: 'pd' }, '\u200E' + it.detail));
      if (it.keys) row.append(el('kbd', { class: 'pk' }, it.keys));
      frag.append(row);
    });
    this.listEl.replaceChildren(frag);
  }

  paintSelection(scroll = true) {
    this.listEl.querySelectorAll('.p-item').forEach((n, i) => n.classList.toggle('sel', i === this.index));
    if (scroll) this.listEl.querySelector('.p-item.sel')?.scrollIntoView({ block: 'nearest' });
  }

  onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (this.items.length) { this.index = (this.index + 1) % this.items.length; this.paintSelection(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (this.items.length) { this.index = (this.index - 1 + this.items.length) % this.items.length; this.paintSelection(); } }
    else if (e.key === 'Enter') { e.preventDefault(); this.accept(this.index); }
    else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'Tab') e.preventDefault();
  }

  accept(i) {
    const cfg = this.cfg;
    if (!cfg) return;
    const item = this.items[i];
    const q = this.input.value;
    if (!item && !cfg.acceptEmpty) return;
    // Close without the cancel callback, run the accept callback, and only then report "closed".
    // (Closing first used to fire onClose before accept, so pick()/prompt() always resolved as cancelled.)
    this.close(true);
    cfg.accept(item, q);
    if (!this.cfg) {
      cfg.onClose?.();
      if (this.prevFocus && document.contains(this.prevFocus)) this.prevFocus.focus?.();
    }
  }

  // Promise helpers
  pick(items, placeholder) {
    return new Promise((resolve) => {
      let done = false;
      this.show({
        placeholder,
        provider: (q) => items.map((it) => ({ ...it, ...(q ? { indices: fuzzyIdx(q, it.label) } : {}) }))
          .filter((it) => !q || it.indices)
          .sort((a, b) => 0),
        accept: (item) => { done = true; resolve(item); },
        onClose: () => { if (!done) resolve(null); },
      });
    });
  }

  prompt(placeholder, value = '') {
    return new Promise((resolve) => {
      let done = false;
      this.show({
        placeholder, value, acceptEmpty: true,
        provider: () => [],
        empty: 'Press Enter to confirm, Esc to cancel',
        accept: (_item, q) => { done = true; resolve(q); },
        onClose: () => { if (!done) resolve(null); },
      });
    });
  }
}

function fuzzyIdx(q, text) {
  const t = text.toLowerCase(), s = q.toLowerCase();
  const idx = [];
  let ti = 0;
  for (const ch of s) {
    const f = t.indexOf(ch, ti);
    if (f < 0) return null;
    idx.push(f);
    ti = f + 1;
  }
  return idx;
}
