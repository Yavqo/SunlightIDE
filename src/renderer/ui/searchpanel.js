// Search-in-files sidebar panel.

import { fileIconHtml } from './fileicons.js';
import { icon, el, escapeHtml, basename, dirname } from './util.js';

export class SearchPanel {
  constructor(root, hooks) {
    this.hooks = hooks; // { getRoot(), openAt(relPath, line, col, len) }
    this.api = window.sunlight;
    this.form = root.querySelector('#search-form');
    this.input = root.querySelector('#search-input');
    this.summary = root.querySelector('#search-summary');
    this.results = root.querySelector('#search-results');
    this.opts = { caseSensitive: false, wholeWord: false, regex: false };
    this.timer = null;
    this.seq = 0;

    const map = { 's-case': 'caseSensitive', 's-word': 'wholeWord', 's-regex': 'regex' };
    for (const [id, key] of Object.entries(map)) {
      const b = root.querySelector('#' + id);
      b.addEventListener('click', () => {
        this.opts[key] = !this.opts[key];
        b.setAttribute('aria-pressed', String(this.opts[key]));
        this.run();
      });
    }
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.run(); });
    this.input.addEventListener('input', () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), 250); });
    this.results.addEventListener('click', (e) => {
      const hit = e.target.closest('.sr-hit');
      if (hit) { this.hooks.openAt(hit.dataset.file, +hit.dataset.line, +hit.dataset.col, +hit.dataset.len); return; }
      const file = e.target.closest('.sr-file');
      if (file) this.hooks.openAt(file.dataset.file, 0, 0, 0);
    });
  }

  focus(seed) {
    if (seed) this.input.value = seed;
    this.input.focus();
    this.input.select();
    if (seed) this.run();
  }

  async run() {
    const root = this.hooks.getRoot();
    const q = this.input.value;
    const seq = ++this.seq;
    if (!q) { this.form.classList.remove('busy'); this.api.search.cancel(); this.summary.textContent = ''; this.results.replaceChildren(); return; }
    if (!root) { this.summary.textContent = 'Open a folder to search.'; this.results.replaceChildren(); return; }
    this.summary.textContent = 'Searching…';
    this.form.classList.add('busy');
    let res;
    try { res = await this.api.search.run(root, q, this.opts); } catch (err) { this.form.classList.remove('busy'); this.summary.textContent = err.message; return; }
    if (seq === this.seq) this.form.classList.remove('busy');
    if (seq !== this.seq || res.cancelled) return;
    if (res.error) { this.summary.textContent = res.error; this.results.replaceChildren(); return; }
    this.render(res, q);
  }

  render(res, q) {
    const { results } = res;
    if (!results.length) {
      this.summary.textContent = 'No results found.';
      this.results.replaceChildren();
      return;
    }
    const files = new Map();
    for (const r of results) {
      if (!files.has(r.file)) files.set(r.file, []);
      files.get(r.file).push(r);
    }
    this.summary.textContent = `${results.length}${res.truncated ? '+' : ''} result${results.length === 1 ? '' : 's'} in ${files.size} file${files.size === 1 ? '' : 's'}`;
    const frag = document.createDocumentFragment();
    for (const [file, hits] of files) {
      const dir = dirname(file);
      frag.append(el('div', { class: 'sr-file', 'data-file': file, title: file, html:
        `${fileIconHtml(basename(file))}<span>${escapeHtml(basename(file))}</span><span class="cnt">${hits.length}</span>` }));
      for (const h of hits.slice(0, 200)) {
        const t = h.text;
        const lead = t.length - t.trimStart().length;
        const text = t.slice(lead);
        const s = h.col - lead, e = s + h.len;
        const html = s >= 0 ? `${escapeHtml(text.slice(Math.max(0, s - 20), s))}<mark>${escapeHtml(text.slice(s, e))}</mark>${escapeHtml(text.slice(e, e + 120))}` : escapeHtml(text);
        frag.append(el('div', { class: 'sr-hit', 'data-file': file, 'data-line': h.line, 'data-col': h.col, 'data-len': h.len, title: `${file}:${h.line + 1}`, html }));
      }
    }
    this.results.replaceChildren(frag);
  }
}
