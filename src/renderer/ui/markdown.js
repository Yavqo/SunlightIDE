// A small, safe Markdown renderer for the docs page and extension READMEs.
//  - All text is HTML-escaped; raw HTML in the source is shown as text, never interpreted.
//  - Links may only use http(s), mailto and #anchors. `command:` links (which run an IDE command) are
//    only honoured when `trusted` is set, which is the case for our own documentation and never for READMEs.
//  - Code blocks are syntax highlighted with the editor's own tokenizer.

import { tokenizeLine } from '../editor/tokenizer.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LANG_ALIASES = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', md: 'markdown', yml: 'yaml', htm: 'html', xml: 'html', jsonc: 'json', rs: 'rust', golang: 'go' };

export function highlightCode(code, lang) {
  const l = LANG_ALIASES[lang] || lang || 'plaintext';
  let state = 0;
  return code.split('\n').map((line) => {
    if (line.length > 2000) return esc(line);
    const r = tokenizeLine(l, line, state);
    state = r.state;
    let html = '', pos = 0;
    for (const t of r.tokens) {
      if (t.s > pos) html += esc(line.slice(pos, t.s));
      html += `<span class="t-${t.t}">${esc(line.slice(t.s, t.e))}</span>`;
      pos = t.e;
    }
    return html + esc(line.slice(pos));
  }).join('\n');
}

function slugify(text) {
  return text.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
}

function safeUrl(url, trusted) {
  const u = url.trim();
  if (/^https?:\/\/[^\s]+$/i.test(u) || /^mailto:[^\s]+$/i.test(u) || /^#[\w-]*$/.test(u)) return u;
  if (trusted && /^command:[\w.-]+$/.test(u)) return u;
  return null;
}

// Inline formatting. `text` is raw Markdown; the result is safe HTML.
export function renderInline(text, trusted = false) {
  const codes = [];
  let s = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _t, code) => { codes.push(`<code>${esc(code.trim())}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  const links = [];
  s = s.replace(/!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, label, url) => {
    if (m.startsWith('!')) { links.push(`<span class="md-img">${esc(label || 'image')}</span>`); return `\u0001${links.length - 1}\u0001`; }
    const safe = safeUrl(url, trusted);
    const inner = label;
    if (!safe) { links.push(esc(label)); return `\u0001${links.length - 1}\u0001`; }
    links.push(`<a href="${esc(safe)}" data-md-link rel="noopener noreferrer">\u0002${inner}\u0002</a>`);
    return `\u0001${links.length - 1}\u0001`;
  });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w])__([^_]+)__(?!\w)/g, '$1<strong>$2</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => links[+i].replace(/\u0002([\s\S]*?)\u0002/g, (_m, label) => renderInlineLabel(label)));
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
}

// Link labels are plain text with optional `code`/bold, escaped once.
function renderInlineLabel(label) {
  return esc(label).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

const isFence = (l) => /^\s*(```+|~~~+)/.test(l);
const isHr = (l) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
const isHeading = (l) => /^#{1,6}\s+\S/.test(l);
const isQuote = (l) => /^\s*>/.test(l);
const listMarker = (l) => /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

export function renderMarkdown(src, { trusted = false, headingIds = true } = {}) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  const usedIds = new Map();
  const out = [];
  let i = 0;

  const uniqueId = (text) => {
    const base = slugify(text);
    const n = usedIds.get(base) || 0;
    usedIds.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };

  function renderList(startIdx, baseIndent) {
    const first = listMarker(lines[startIdx]);
    const ordered = /\d/.test(first[2]);
    const items = [];
    let idx = startIdx;
    while (idx < lines.length) {
      const m = listMarker(lines[idx]);
      if (!m || m[1].length < baseIndent) break;
      if (m[1].length > baseIndent) break; // belongs to a nested list, handled below
      if (/\d/.test(m[2]) !== ordered) break;
      let text = m[3];
      idx++;
      let nested = '';
      const cont = [];
      while (idx < lines.length) {
        const l = lines[idx];
        if (!l.trim()) {
          // A blank line continues the list only when the next non-blank line is indented or another item.
          const next = lines.slice(idx + 1).find((x) => x.trim());
          if (next && (listMarker(next) && listMarker(next)[1].length >= baseIndent || /^\s{2,}\S/.test(next))) { idx++; continue; }
          break;
        }
        const lm = listMarker(l);
        if (lm && lm[1].length > baseIndent) { const r = renderList(idx, lm[1].length); nested += r.html; idx = r.next; continue; }
        if (lm && lm[1].length <= baseIndent) break;
        if (/^\s{2,}\S/.test(l) && !isFence(l)) { cont.push(l.trim()); idx++; continue; }
        if (isFence(l) && /^\s{2,}/.test(l)) {
          const r = renderFence(idx, true);
          nested += r.html; idx = r.next; continue;
        }
        break;
      }
      if (cont.length) text += ' ' + cont.join(' ');
      let task = '';
      const t = /^\[( |x|X)\]\s+(.*)$/.exec(text);
      if (t) { task = `<input type="checkbox" disabled${t[1] !== ' ' ? ' checked' : ''}> `; text = t[2]; }
      items.push(`<li>${task}${renderInline(text, trusted)}${nested}</li>`);
    }
    const tag = ordered ? 'ol' : 'ul';
    return { html: `<${tag}>${items.join('')}</${tag}>`, next: idx };
  }

  function renderFence(idx, indented = false) {
    const m = /^(\s*)(```+|~~~+)\s*([\w+#.-]*)[^\n]*$/.exec(lines[idx]);
    const fence = m[2];
    const lang = (m[3] || '').toLowerCase();
    const indent = m[1].length;
    const code = [];
    let j = idx + 1;
    while (j < lines.length && !new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(lines[j])) { code.push(indent ? lines[j].replace(new RegExp(`^ {0,${indent}}`), '') : lines[j]); j++; }
    const body = code.join('\n');
    const label = lang || 'text';
    return {
      html: `<div class="md-code"><div class="md-code-head"><span>${esc(label)}</span><button type="button" class="md-copy" data-copy aria-label="Copy code">Copy</button></div><pre><code>${highlightCode(body, lang)}</code></pre></div>`,
      next: j + 1,
    };
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (isFence(line)) { const r = renderFence(i); out.push(r.html); i = r.next; continue; }

    if (isHeading(line)) {
      const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      const level = m[1].length;
      const plain = m[2].replace(/[`*_]/g, '');
      const id = headingIds ? uniqueId(plain) : '';
      headings.push({ level, text: plain, id });
      out.push(`<h${level}${id ? ` id="${esc(id)}"` : ''}>${renderInline(m[2], trusted)}</h${level}>`);
      i++; continue;
    }

    if (isHr(line)) { out.push('<hr>'); i++; continue; }

    if (isQuote(line)) {
      const block = [];
      while (i < lines.length && isQuote(lines[i])) { block.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      let kind = '';
      const first = block[0] || '';
      const k = /^\*\*(Note|Tip|Warning|Important|Security)\*\*[:.]?\s*/i.exec(first) || /^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*/i.exec(first);
      if (k) kind = ` md-${k[1].toLowerCase() === 'security' ? 'warning' : k[1].toLowerCase()}`;
      out.push(`<blockquote class="md-quote${kind}">${renderMarkdown(block.join('\n'), { trusted, headingIds: false }).html}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++; }
      const cell = (tag, c, n) => `<${tag}${aligns[n] ? ` style="text-align:${aligns[n]}"` : ''}>${renderInline(c, trusted)}</${tag}>`;
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c, n) => cell('th', c, n)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, n) => cell('td', r[n] || '', n)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const lm = listMarker(line);
    if (lm) { const r = renderList(i, lm[1].length); out.push(r.html); i = r.next; continue; }

    // paragraph
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !isFence(lines[i]) && !isHeading(lines[i]) && !isHr(lines[i]) && !isQuote(lines[i]) && !listMarker(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) { para.push(lines[i].trim()); i++; }
    out.push(`<p>${renderInline(para.join(' '), trusted)}</p>`);
  }
  return { html: out.join('\n'), headings };
}
