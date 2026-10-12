// Extension store: the sidebar panel and the details page of one extension.

import { icon, el, escapeHtml, showMenu } from './util.js';
import { renderMarkdown } from './markdown.js';

// Keep in sync with PERMISSIONS in src/main/ext-manifest.js (a unit test checks the keys match).
export const PERMISSION_TEXT = {
  'editor.read': 'Read the text, selections and language of the file you are editing',
  'editor.write': 'Change the text of the file you are editing',
  'workspace.read': 'Read files inside the folder you have open',
  'workspace.write': 'Create and change files inside the folder you have open',
  storage: 'Remember small amounts of data between sessions',
};

const AVATAR_COLORS = ['#0064E0', '#7C3AED', '#0E7490', '#B45309', '#2E7D32', '#455A64', '#C2410C', '#BE185D'];
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

// Small cache so each icon is read from disk once.
const iconCache = new Map();
export function loadIcon(id) {
  if (!iconCache.has(id)) iconCache.set(id, window.sunlight.ext('icon', id).catch(() => null));
  return iconCache.get(id);
}
export function forgetIcons() { iconCache.clear(); }

export function avatarHtml(id, name, cls = '') {
  const color = AVATAR_COLORS[hash(id) % AVATAR_COLORS.length];
  const initial = escapeHtml((name || id).trim().charAt(0).toUpperCase() || '?');
  return `<span class="ext-icon ext-avatar ${cls}" data-icon-for="${escapeHtml(id)}" style="background:${color}">${initial}</span>`;
}

// Replace placeholder avatars below `root` with the extension's real icon once it has loaded.
export function hydrateIcons(root) {
  for (const node of root.querySelectorAll('[data-icon-for]')) {
    const id = node.dataset.iconFor;
    loadIcon(id).then((url) => {
      if (!url || !node.isConnected) return;
      const img = document.createElement('img');
      img.className = `ext-icon ${[...node.classList].filter((c) => c !== 'ext-avatar' && c !== 'ext-icon').join(' ')}`;
      img.alt = '';
      img.draggable = false;
      img.src = url;
      node.replaceWith(img);
    });
  }
}

export function permissionList(perms) {
  if (!perms || !perms.length) return '<li class="perm-none">No special permissions. It cannot read or change your files.</li>';
  return perms.map((p) => `<li>${escapeHtml(PERMISSION_TEXT[p] || p)}</li>`).join('');
}

// ---- the sidebar panel ----
export class ExtensionsPanel {
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks; // { open(id), install(entry), update(entry), uninstall(item), toggle(id, on), menu(x, y), docs(), reload() }
    this.catalog = [];
    this.installed = [];
    this.error = null;
    this.query = '';
    this.filter = 'all';
    this.loading = true;
    root.innerHTML = `
      <div class="panel-head">
        <span class="panel-title">Extensions</span>
        <span class="panel-actions always">
          <button class="icon-btn sm" data-a="refresh" aria-label="Refresh" title="Refresh">${icon('refresh', 'sm')}</button>
          <button class="icon-btn sm" data-a="more" aria-label="More actions" title="More actions">${icon('more', 'sm')}</button>
        </span>
      </div>
      <div class="ext-body">
        <div class="field-pill ext-search"><input type="text" placeholder="Search extensions" spellcheck="false" aria-label="Search extensions"></div>
        <div class="ext-filters"><select aria-label="Filter extensions"><option value="all">All extensions</option><option value="installed">Installed</option><option value="updates">Updates</option><option value="Themes">Themes</option><option value="Snippets">Snippets</option><option value="Tools">Tools</option></select></div>
        <div class="ext-list" tabindex="0"></div>
      </div>`;
    this.input = root.querySelector('input');
    this.list = root.querySelector('.ext-list');
    root.querySelector('select').addEventListener('change', (e) => { this.filter = e.target.value; this.render(); });
    this.input.addEventListener('input', () => { this.query = this.input.value.trim().toLowerCase(); this.render(); });
    this.input.addEventListener('keydown', (e) => e.stopPropagation());
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('contextmenu', (e) => { const row = e.target.closest('.ext-item'); if (row) { e.preventDefault(); this.hooks.itemMenu(e.clientX, e.clientY, row.dataset.id); } });
    this.list.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ext-item')) { e.preventDefault(); this.hooks.open(e.target.dataset.id); }
    });
  }

  focusSearch() { this.input.focus(); this.input.select(); }

  showUpdates() {
    this.filter = 'updates';
    this.root.querySelector('select').value = 'updates';
    this.query = ''; this.input.value = '';
    this.render();
  }

  async refresh({ force = false } = {}) {
    const request = this.refreshRequest = (this.refreshRequest || 0) + 1;
    this.loading = true;
    this.render();
    try {
      const [installed, cat] = await Promise.all([window.sunlight.ext('list'), window.sunlight.ext('catalog', { refresh: force })]);
      if (request !== this.refreshRequest) return { installed: this.installed, catalog: this.catalog };
      this.installed = installed;
      this.catalog = cat.extensions;
      this.error = cat.registryError;
      this.registry = cat.registry;
    } catch (err) { if (request !== this.refreshRequest) return; this.error = err.message; }
    this.loading = false;
    this.render();
    const result = { installed: this.installed, catalog: this.catalog, error: this.error, registry: this.registry };
    this.hooks.refreshed?.(result);
    return result;
  }

  matches(text) { return !this.query || text.toLowerCase().includes(this.query); }

  render() {
    const q = this.query;
    const frag = document.createDocumentFragment();
    const byId = new Map(this.catalog.map((c) => [c.id, c]));

    const installed = this.installed.filter((e) => this.accepts(e.manifest || {}, true, !!byId.get(e.id)?.updateAvailable) && (!q || this.matches(`${e.manifest ? e.manifest.name + ' ' + e.manifest.description + ' ' + e.manifest.publisher + ' ' + e.manifest.categories.join(' ') : e.id}`)));
    const store = this.catalog.filter((c) => !c.installed && this.accepts(c, false, false) && (!q || this.matches(`${c.name} ${c.description} ${c.publisher} ${c.categories.join(' ')}`)));

    const updateCount = this.catalog.filter((c) => c.updateAvailable).length;
    if (updateCount && this.filter !== 'updates') frag.append(el('button', { class: 'ext-update-banner btn secondary sm', 'data-a': 'review-updates' }, `${updateCount} extension update${updateCount === 1 ? '' : 's'} available · Review`));
    if (this.error) frag.append(el('div', { class: 'ext-note error', html: `Could not reach the extension registry: ${escapeHtml(this.error)}` }));

    const section = (title, count, items) => {
      frag.append(el('div', { class: 'ext-sec-head', html: `<span>${title}</span><span class="gp-count">${count}</span>` }));
      for (const it of items) frag.append(it);
      if (!items.length) frag.append(el('div', { class: 'ext-empty' }, q ? 'No matches.' : title === 'Installed' ? 'Nothing installed yet.' : 'Nothing else to install.'));
    };

    if (this.filter === 'all' && !this.registry) frag.append(el('div', { class: 'ext-note' }, 'Browse bundled extensions. Add a registry from More actions for community extensions.'));
    section('Installed', installed.length, installed.map((e) => this.itemHtml(e.manifest ? {
      id: e.id, name: e.manifest.name, version: e.manifest.version, publisher: e.manifest.publisher, description: e.manifest.description,
      installed: true, enabled: e.enabled, source: e.source, updateAvailable: !!(byId.get(e.id) && byId.get(e.id).updateAvailable),
    } : { id: e.id, name: e.id, version: '', publisher: '', description: e.errors.join(' '), installed: true, enabled: false, source: e.source, broken: true })));
    if (!['installed', 'updates'].includes(this.filter)) section('Store', store.length, store.map((c) => this.itemHtml({ ...c, installed: false })));

    if (this.loading && !this.catalog.length && !this.installed.length) frag.prepend(el('div', { class: 'ext-note' }, 'Loading…'));
    this.list.replaceChildren(frag);
    hydrateIcons(this.list);
  }

  accepts(c, installed, update) {
    if (this.filter === 'installed') return installed;
    if (this.filter === 'updates') return update;
    if (this.filter === 'all') return true;
    const n = c.contributes || {};
    if (this.filter === 'Themes') return Array.isArray(n.themes) ? n.themes.length > 0 : n.themes > 0;
    if (this.filter === 'Snippets') return Array.isArray(n.snippets) ? n.snippets.length > 0 : n.snippets > 0;
    return Array.isArray(n.commands) ? n.commands.length > 0 : n.commands > 0;
  }

  itemHtml(c) {
    const badges = [];
    if (c.source === 'dev') badges.push('<span class="ext-badge dev">Development</span>');
    if (c.broken) badges.push('<span class="ext-badge bad">Invalid</span>');
    else if (c.installed && !c.enabled) badges.push('<span class="ext-badge">Disabled</span>');
    if (c.updateAvailable) badges.push('<span class="ext-badge upd">Update</span>');
    let action = '';
    if (!c.installed) action = `<button class="btn primary sm" data-a="install" data-id="${escapeHtml(c.id)}">Install</button>`;
    else if (c.updateAvailable) action = `<button class="btn outline sm" data-a="update" data-id="${escapeHtml(c.id)}">Update</button>`;
    const row = el('div', { class: 'ext-item', role: 'button', tabindex: '0', 'data-id': c.id, 'aria-label': `${c.name}${c.version ? ' ' + c.version : ''}` });
    row.innerHTML = `${avatarHtml(c.id, c.name)}
      <div class="ext-main">
        <div class="ext-title"><span class="ext-name">${escapeHtml(c.name)}</span>${c.version ? `<span class="ext-ver">${escapeHtml(c.version)}</span>` : ''}</div>
        <div class="ext-desc">${escapeHtml(c.description || '')}</div>
        <div class="ext-meta"><span>${escapeHtml(c.publisher || '')}</span>${badges.join('')}</div>
      </div>
      <div class="ext-act">${action}</div>`;
    if (c.installed && !c.enabled) row.classList.add('off');
    return row;
  }

  async onClick(e) {
    const a = e.target.closest('[data-a]');
    if (a) {
      e.stopPropagation();
      const act = a.dataset.a;
      if (act === 'review-updates') this.showUpdates();
      else if (act === 'refresh') this.hooks.reload(true);
      else if (act === 'more') { const r = a.getBoundingClientRect(); this.hooks.menu(r.left, r.bottom + 4); }
      else if (act === 'install' || act === 'update') {
        if (a.disabled) return;
        a.disabled = true;
        const label = a.textContent;
        a.textContent = act === 'install' ? 'Installing…' : 'Updating…';
        try { await this.hooks[act](this.catalog.find((c) => c.id === a.dataset.id)); }
        finally { a.disabled = false; a.textContent = label; }
      }
      return;
    }
    const row = e.target.closest('.ext-item');
    if (row) this.hooks.open(row.dataset.id);
  }
}

// ---- the details page ----
// ctx: { id, data(): Promise<{ catalog entry | null, installed item | null }>, hooks, themes(): list, currentTheme(): key }
export function buildExtensionPage(el0, ctx) {
  let tab = 'details';
  let readmeHtml = null;

  async function render() {
    const { entry, item } = await ctx.data();
    const m = item && item.manifest;
    const name = m ? m.name : entry ? entry.name : ctx.id;
    const version = m ? m.version : entry ? entry.version : '';
    const publisher = m ? m.publisher : entry ? entry.publisher : '';
    const desc = m ? m.description : entry ? entry.description : '';
    const perms = m ? m.permissions : entry ? entry.permissions : [];
    const installed = !!item;
    const update = !!(entry && entry.updateAvailable);

    if (readmeHtml === null) {
      const text = await window.sunlight.ext('readme', ctx.id).catch(() => '');
      readmeHtml = text ? renderMarkdown(text, { trusted: false }).html : `<p class="ext-empty">${escapeHtml(desc || 'This extension has no README.')}</p>`;
    }

    const actions = [];
    if (!installed) actions.push(`<button class="btn primary" data-act="install">Install</button>`);
    else {
      if (update) actions.push(`<button class="btn primary" data-act="update">Update to ${escapeHtml(entry.version)}</button>`);
      if (item.manifest) actions.push(`<button class="btn secondary" data-act="toggle">${item.enabled ? 'Disable' : 'Enable'}</button>`);
      actions.push(`<button class="btn outline" data-act="uninstall">${item.source === 'dev' ? 'Remove' : 'Uninstall'}</button>`);
    }

    const badges = [];
    if (item && item.source === 'dev') badges.push('<span class="ext-badge dev">Development</span>');
    if (installed && item.manifest && !item.enabled) badges.push('<span class="ext-badge">Disabled</span>');
    if (entry && entry.source === 'registry' && !installed) badges.push('<span class="ext-badge">From registry</span>');
    const cats = ((m && m.categories) || (entry && entry.categories) || []).map((c) => `<span class="ext-chip">${escapeHtml(c)}</span>`).join('');

    el0.innerHTML = `
      <div class="ext-page">
        <header class="ext-hero">
          ${avatarHtml(ctx.id, name, 'big')}
          <div class="ext-hero-main">
            <h1>${escapeHtml(name)} ${version ? `<span class="ext-ver">${escapeHtml(version)}</span>` : ''}</h1>
            <div class="ext-sub"><span>${escapeHtml(publisher)}</span><span class="ext-id">${escapeHtml(ctx.id)}</span>${badges.join('')}</div>
            <p>${escapeHtml(desc)}</p>
            <div class="ext-actions">${actions.join('')}</div>
            <div class="ext-chips">${cats}</div>
          </div>
        </header>
        <nav class="ext-tabs" role="tablist">
          ${['details', 'features', 'permissions'].map((t) => `<button role="tab" data-tab="${t}" aria-selected="${t === tab}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
        </nav>
        <div class="ext-tabpanel"></div>
      </div>`;
    hydrateIcons(el0);
    const panel = el0.querySelector('.ext-tabpanel');

    if (tab === 'details') panel.innerHTML = `<div class="md">${readmeHtml}</div>`;
    else if (tab === 'permissions') {
      panel.innerHTML = `<div class="md"><h2>Permissions</h2><p>${perms.length ? 'This extension asks to:' : ''}</p><ul class="perm-list">${permissionList(perms)}</ul>
        <p class="ext-note-text">Extensions run in a sandbox. They cannot access the network, run programs, or touch anything outside these permissions.</p></div>`;
    } else {
      const c = (m && m.contributes) || (entry && entry.features) || null;
      let html = '<div class="md">';
      if (c) {
        if (c.commands.length) {
          html += `<h2>Commands</h2><div class="md-table"><table><thead><tr><th>Command</th><th>Shortcut</th></tr></thead><tbody>${c.commands.map((cmd) => {
            const kb = c.keybindings.find((k) => k.command === cmd.id);
            return `<tr><td>${escapeHtml((cmd.category ? cmd.category + ': ' : '') + cmd.title)}</td><td>${kb ? `<kbd>${escapeHtml(kb.key.replace(/Mod/g, navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'))}</kbd>` : ''}</td></tr>`;
          }).join('')}</tbody></table></div>`;
        }
        if (c.themes.length) {
          html += `<h2>Colour themes</h2><div class="ext-themes">${c.themes.map((t) => `<div class="ext-theme"><span class="swatch" style="background:${escapeHtml(t.colors.editorBackground || (t.type === 'dark' ? '#0E141A' : '#FFFFFF'))};color:${escapeHtml(t.tokens.kw || t.colors.accent || '#888')}">Aa</span><div><strong>${escapeHtml(t.label)}</strong><div class="ext-sub">${t.type} theme</div></div>${installed && item.enabled ? `<button class="btn secondary sm" data-act="theme" data-theme="${escapeHtml(item.id + ':' + t.id)}">${ctx.currentTheme() === item.id + ':' + t.id ? 'Active' : 'Use this theme'}</button>` : ''}</div>`).join('')}</div>`;
        }
        if (c.snippets.length) {
          html += `<h2>Snippets</h2>${c.snippets.map((g) => `<p><strong>${escapeHtml(g.language)}</strong>: ${Object.keys(g.snippets).map((t) => `<code>${escapeHtml(t)}</code>`).join(' ')}</p>`).join('')}`;
        }
        if (!c.commands.length && !c.themes.length && !c.snippets.length) html += '<p>This extension contributes no commands, themes or snippets.</p>';
      } else if (entry) {
        const n = entry.contributes;
        html += `<p>Contributes ${n.commands} command${n.commands === 1 ? '' : 's'}, ${n.themes} theme${n.themes === 1 ? '' : 's'} and ${n.snippets} snippet${n.snippets === 1 ? '' : 's'}. Install it to see the details.</p>`;
      }
      panel.innerHTML = html + '</div>';
    }
    panel.hidden = false;
  }

  el0.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); return; }
    const b = e.target.closest('[data-act]');
    if (b) {
      const { entry, item } = await ctx.data();
      const act = b.dataset.act;
      if (act === 'install') await ctx.hooks.install(entry);
      else if (act === 'update') await ctx.hooks.update(entry);
      else if (act === 'uninstall') await ctx.hooks.uninstall(item);
      else if (act === 'toggle') await ctx.hooks.toggle(item.id, !item.enabled);
      else if (act === 'theme') await ctx.hooks.useTheme(b.dataset.theme);
      return;
    }
    const link = e.target.closest('a[data-md-link]');
    if (link) { e.preventDefault(); ctx.hooks.link(link.getAttribute('href')); }
    const copy = e.target.closest('[data-copy]');
    if (copy) ctx.hooks.copy(copy.closest('.md-code').querySelector('code').textContent, copy);
  });

  render();
  return { refresh() { readmeHtml = null; render(); }, rerender: render };
}
