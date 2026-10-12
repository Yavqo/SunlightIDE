// Shared UI helpers: icons, fuzzy matching, context menu, toasts, small DOM utilities.

const ICONS = {
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 10l3 2.5L7 15M12.5 15H17"/>',
  command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
  files: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  newfile: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  newfolder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  collapse: '<path d="M4 9l4-4 4 4M4 15l4 4 4-4" transform="translate(4 0)"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M6 14l6-6 6 6"/>',
  down: '<path d="M6 10l6 6 6-6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  clear: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  replace: '<path d="M4 7h11l-3-3M20 17H9l3 3"/>',
  puzzle: '<path d="M10 4.5a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h-1.5a2 2 0 1 0 0 4H18v3a1 1 0 0 1-1 1h-3v-1.5a2 2 0 1 0-4 0V18H7a1 1 0 0 1-1-1v-3h1.5a2 2 0 1 0 0-4H6V7a1 1 0 0 1 1-1h3z"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  branch: '<circle cx="6" cy="5.5" r="2.3"/><circle cx="6" cy="18.5" r="2.3"/><circle cx="18" cy="8.5" r="2.3"/><path d="M6 7.8v8.4M18 10.8c0 4.2-5.6 3.4-10.4 6.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  undo: '<path d="M9 8L4.5 12.5 9 17M5 12.5h9a5 5 0 0 1 5 5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export const SUN_MARK = `<svg viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" aria-hidden="true">
  <circle cx="36" cy="36" r="13" fill="currentColor" stroke="none"/>
  <path d="M36 8v8M36 56v8M8 36h8M56 36h8M16.2 16.2l5.7 5.7M50.1 50.1l5.7 5.7M16.2 55.8l5.7-5.7M50.1 21.9l5.7-5.7"/></svg>`;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function basename(p) { return p.split(/[\\/]/).filter(Boolean).pop() || p; }
export function dirname(p) { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i <= 0 ? p.slice(0, i + 1) || '/' : p.slice(0, i); }
export function joinPath(a, b) { return a.replace(/[\\/]+$/, '') + '/' + b; }
export function relPath(root, p) { return root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p; }

// Subsequence fuzzy match. Returns { score, indices } or null.
export function fuzzy(query, text) {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase(), t = text.toLowerCase();
  const indices = [];
  let ti = 0, score = 0, prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found < 0) return null;
    indices.push(found);
    score += 1;
    if (found === prev + 1) score += 4;
    if (found === 0 || /[\s/\\_.-]/.test(text[found - 1])) score += 6;
    else if (text[found] !== t[found] && text[found - 1] === t[found - 1]) score += 3;
    score -= Math.min(3, (found - ti) * 0.2);
    prev = found;
    ti = found + 1;
  }
  const base = text.lastIndexOf('/');
  if (indices[0] > base) score += 8; // match inside the file name
  score -= text.length * 0.02;
  return { score, indices };
}

export function highlight(text, indices) {
  if (!indices || !indices.length) return escapeHtml(text);
  const set = new Set(indices);
  let out = '', open = false;
  for (let i = 0; i < text.length; i++) {
    const on = set.has(i);
    if (on && !open) { out += '<b>'; open = true; }
    if (!on && open) { out += '</b>'; open = false; }
    out += escapeHtml(text[i]);
  }
  return open ? out + '</b>' : out;
}

// ---- toasts ----
export function toast(message, { error = false, ms = 3200, action = null } = {}) {
  const host = document.getElementById('toasts');
  const t = el('div', { class: 'toast' + (error ? ' error' : ''), role: error ? 'alert' : 'status' }, message);
  if (action) t.append(el('button', { class: 'btn secondary sm', onclick: () => { t.remove(); action.run(); } }, action.label));
  host.append(t);
  setTimeout(() => t.remove(), ms);
}

// ---- context menu ----
let ctxCleanup = null;
export function closeMenu() { ctxCleanup?.(); ctxCleanup = null; }

export function showMenu(x, y, items) {
  closeMenu();
  const root = document.getElementById('menu-root');
  const menu = el('div', { class: 'ctx', role: 'menu' });
  for (const it of items) {
    if (it === '-') { menu.append(el('hr')); continue; }
    const b = el('button', { role: 'menuitem', onclick: () => { closeMenu(); it.run(); } },
      el('span', {}, it.label), it.hint ? el('span', { class: 'sc' }, it.hint) : null);
    menu.append(b);
  }
  root.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  const onDown = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  setTimeout(() => { window.addEventListener('mousedown', onDown, true); window.addEventListener('keydown', onKey, true); });
  window.addEventListener('blur', closeMenu, { once: true });
  ctxCleanup = () => {
    menu.remove();
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
  };
  menu.querySelector('button')?.focus();
}

// ---- sashes (drag to resize) ----
export function makeSash(sash, { axis, get, set, min, max, invert = false, onDone }) {
  sash.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const start = axis === 'x' ? e.clientX : e.clientY;
    const startSize = get();
    sash.classList.add('drag');
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    const move = (ev) => {
      const d = (axis === 'x' ? ev.clientX : ev.clientY) - start;
      set(Math.max(typeof min === 'function' ? min() : min, Math.min(typeof max === 'function' ? max() : max, startSize + (invert ? -d : d))));
    };
    const up = () => {
      sash.classList.remove('drag');
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onDone?.();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

// Restart a CSS animation class on an element.
export function replay(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}
