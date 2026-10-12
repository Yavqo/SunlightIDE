// In-editor find and replace widget.

import { icon, el } from './util.js';

export class FindWidget {
  constructor(host, editor) {
    this.editor = editor;
    this.opts = { caseSensitive: false, wholeWord: false, regex: false };
    this.replaceOpen = false;
    this.root = el('div', { class: 'find', role: 'search', hidden: true });
    this.root.innerHTML = `
      <div class="find-row">
        <button class="icon-btn sm twist" aria-label="Toggle replace" title="Toggle replace">${icon('chevron', 'sm')}</button>
        <div class="field-pill">
          <input class="f-q" type="text" placeholder="Find" spellcheck="false" aria-label="Find">
          <button type="button" class="chip-toggle" data-opt="caseSensitive" title="Match case" aria-pressed="false">Aa</button>
          <button type="button" class="chip-toggle" data-opt="wholeWord" title="Whole word" aria-pressed="false">ab</button>
          <button type="button" class="chip-toggle" data-opt="regex" title="Regular expression" aria-pressed="false">.*</button>
        </div>
        <span class="count" aria-live="polite"></span>
        <button class="icon-btn sm f-prev" aria-label="Previous match" title="Previous match (Shift+Enter)">${icon('up', 'sm')}</button>
        <button class="icon-btn sm f-next" aria-label="Next match" title="Next match (Enter)">${icon('down', 'sm')}</button>
        <button class="icon-btn sm f-close" aria-label="Close" title="Close (Esc)">${icon('close', 'sm')}</button>
      </div>
      <div class="find-row f-rrow" hidden>
        <span style="width:28px"></span>
        <div class="field-pill"><input class="f-r" type="text" placeholder="Replace" spellcheck="false" aria-label="Replace with"></div>
        <button class="btn sm secondary f-rone">Replace</button>
        <button class="btn sm secondary f-rall">All</button>
      </div>`;
    host.append(this.root);
    const q = (s) => this.root.querySelector(s);
    this.q = q('.f-q');
    this.r = q('.f-r');
    this.count = q('.count');
    this.rrow = q('.f-rrow');
    this.twist = q('.twist');

    this.q.addEventListener('input', () => this.search(true));
    this.q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.editor.findNext(e.shiftKey ? -1 : 1); }
    });
    this.r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.editor.replaceCurrent(this.r.value); }
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    });
    for (const b of this.root.querySelectorAll('[data-opt]')) {
      b.addEventListener('click', () => {
        const k = b.dataset.opt;
        this.opts[k] = !this.opts[k];
        b.setAttribute('aria-pressed', String(this.opts[k]));
        this.search(true);
      });
    }
    q('.f-prev').addEventListener('click', () => this.editor.findNext(-1));
    q('.f-next').addEventListener('click', () => this.editor.findNext(1));
    q('.f-close').addEventListener('click', () => this.close());
    q('.f-rone').addEventListener('click', () => this.editor.replaceCurrent(this.r.value));
    q('.f-rall').addEventListener('click', () => {
      const n = this.editor.replaceAll(this.r.value);
      this.count.textContent = n ? `${n} replaced` : '';
    });
    this.twist.addEventListener('click', () => this.setReplace(!this.replaceOpen));
    editor.on('find', ({ count, index }) => this.update(count, index));
  }

  get isOpen() { return !this.root.hidden; }

  setReplace(open) {
    this.replaceOpen = open;
    this.rrow.hidden = !open;
    this.twist.classList.toggle('open', open);
  }

  open({ replace = false } = {}) {
    const ed = this.editor;
    this.root.hidden = false;
    if (replace) this.setReplace(true);
    // Seed the query from a single-line selection.
    if (ed.hasSelection()) {
      const t = ed.getSelectionText();
      if (!t.includes('\n') && t.length < 200) this.q.value = t;
    }
    this.q.focus();
    this.q.select();
    this.search(false);
  }

  close() {
    this.root.hidden = true;
    this.editor.clearFind();
    this.editor.focus();
  }

  search(jump) {
    this.editor.setFind({ query: this.q.value, ...this.opts }, { jump });
  }

  update(count, index) {
    if (this.root.hidden) return;
    if (!this.q.value) { this.count.textContent = ''; this.count.classList.remove('none'); return; }
    this.count.classList.toggle('none', count === 0);
    this.count.textContent = count === 0 ? 'No results' : `${index + 1} of ${count >= 20000 ? '20000+' : count}`;
  }
}
