// The Extension Developer Guide page: rendered Markdown with a searchable table of contents.

import { renderMarkdown } from './markdown.js';
import { escapeHtml } from './util.js';

// ctx: { markdown, hooks: { run(commandId), link(url), copy(text, button) } }
export function buildDocsPage(root, ctx) {
  const { html, headings } = renderMarkdown(ctx.markdown, { trusted: true });
  const toc = headings.filter((h) => h.level <= 3 && h.level >= 2);
  root.innerHTML = `
    <div class="docs">
      <aside class="docs-nav" aria-label="Contents">
        <div class="field-pill docs-search"><input type="text" placeholder="Search the guide" spellcheck="false" aria-label="Search the guide"></div>
        <nav class="docs-toc">${toc.map((h) => `<a href="#${escapeHtml(h.id)}" data-toc="${escapeHtml(h.id)}" class="lvl${h.level}">${escapeHtml(h.text)}</a>`).join('')}</nav>
        <div class="docs-empty" hidden>No sections match.</div>
      </aside>
      <article class="docs-body md">${html}</article>
    </div>`;
  const body = root.querySelector('.docs-body');
  const input = root.querySelector('input');
  const links = [...root.querySelectorAll('[data-toc]')];
  const emptyEl = root.querySelector('.docs-empty');

  // Text of each section (from its heading to the next heading of the same or higher level) for searching.
  const sections = new Map();
  const nodes = [...body.children];
  for (const h of headings) {
    const start = nodes.findIndex((n) => n.id === h.id);
    if (start < 0) continue;
    let text = '';
    for (let i = start; i < nodes.length; i++) {
      if (i > start && /^H[1-6]$/.test(nodes[i].tagName) && +nodes[i].tagName[1] <= h.level) break;
      text += ' ' + nodes[i].textContent;
    }
    sections.set(h.id, `${h.text} ${text}`.toLowerCase());
  }

  input.addEventListener('keydown', (e) => e.stopPropagation());
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const a of links) {
      const ok = !q || (sections.get(a.dataset.toc) || '').includes(q);
      a.hidden = !ok;
      if (ok) shown++;
    }
    emptyEl.hidden = shown > 0;
    if (q) { const first = links.find((a) => !a.hidden); if (first) go(first.dataset.toc); }
  });

  function go(id) {
    const target = body.querySelector(`#${CSS.escape(id)}`);
    if (target) target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  root.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) { ctx.hooks.copy(copy.closest('.md-code').querySelector('code').textContent, copy); return; }
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) go(href.slice(1));
    else if (href.startsWith('command:')) ctx.hooks.run(href.slice(8));
    else ctx.hooks.link(href);
  });

  // Highlight the section being read.
  const scroller = root;
  const onScroll = () => {
    let current = toc[0] && toc[0].id;
    const top = scroller.getBoundingClientRect().top + 90;
    for (const h of toc) { const n = body.querySelector(`#${CSS.escape(h.id)}`); if (n && n.getBoundingClientRect().top <= top) current = h.id; }
    for (const a of links) a.classList.toggle('on', a.dataset.toc === current);
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return { headings, scrollTo: go };
}
