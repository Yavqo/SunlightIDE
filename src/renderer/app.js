// SunlightIDE renderer: wires the editor, explorer, tabs, palette, terminal and settings together.

import { LanguageIntelligence } from './ui/language.js';
import { EditorGroups } from './editor/groups.js';
import { snapshotSession, restoredView } from './editor/session.js';
import { Editor, Document } from './editor/editor.js';
import { languageForFile, LANGUAGE_NAMES } from './editor/tokenizer.js';
import { Explorer } from './ui/explorer.js';
import { GitState } from './ui/git.js';
import { GitPanel } from './ui/gitpanel.js';
import { ExtensionUpdateTracker } from './ext/updates.js';
import { ExtensionHost } from './ext/host.js';
import { applyExtensionTheme } from './ext/theme.js';
import { ExtensionsPanel, buildExtensionPage, hydrateIcons, avatarHtml, forgetIcons, PERMISSION_TEXT } from './ui/extensions.js';
import { buildDocsPage } from './ui/docspage.js';
import { PageHost, copyText } from './ui/pages.js';
import { setExtensionSnippets, clearExtensionSnippets } from './editor/snippets.js';
import { startOf, endOf, isEmpty } from './editor/selection.js';
import { fileIconHtml, fileIconUrl } from './ui/fileicons.js';
import { FindWidget } from './ui/findwidget.js';
import { Minimap } from './ui/minimap.js';
import { Palette } from './ui/palette.js';
import { SearchPanel } from './ui/searchpanel.js';
import { TerminalPanel } from './ui/terminal.js';
import { icon, SUN_MARK, $, $$, el, toast, basename, dirname, joinPath, relPath, fuzzy, escapeHtml, makeSash, replay, showMenu } from './ui/util.js';

let languageIntelligence;
let extensionUpdates, extensionUpdateCheck, manualUpdateCheck = false;
const api = window.sunlight;
const IS_MAC = /Mac/.test(navigator.platform);

const S = {
  root: null,
  docs: [],
  active: null,
  settings: { theme: 'system', fontSize: 13, autoSave: false, autoClose: true, completion: true, minimap: true, wordWrap: false, gitBlame: true, colorTheme: '', extensionUpdateNotifications: true },
  state: { recent: [] },
  info: {},
  untitled: 0,
  fileCache: null,
  ui: { sidebarW: 272, termH: 260, sidebar: true, terminal: false, view: 'explorer' },
};

let editor, minimap, findWidget, explorer, searchPanel, terminal, palette, git, gitPanel, extHost, extPanel, pageHost;
const bootStart = performance.now();
const groups = new EditorGroups();
let activePane = groups.active, rightPane = null, tabDrag = null;
const mru = []; // most recently activated docs

// ---------- key labels ----------
function keyLabel(combo) {
  if (!combo) return '';
  return combo.split('+').map((k) => {
    if (IS_MAC) return ({ Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃', Enter: '↩', Backspace: '⌫' })[k] || k;
    return k === 'Mod' ? 'Ctrl' : k;
  }).join(IS_MAC ? '' : '+');
}

// The active document if it is a text editor (not a page such as the store or the docs).
const textDoc = () => (S.active && !S.active.page ? S.active : null);

// ---------- commands ----------
const commands = [
  { id: 'new-file', label: 'File: New File', keys: 'Mod+N', run: () => newUntitled() },
  { id: 'open-file', label: 'File: Open File…', keys: 'Mod+O', run: () => openFileDialog() },
  { id: 'open-folder', label: 'File: Open Folder…', keys: 'Mod+Shift+O', run: () => openFolderDialog() },
  { id: 'close-folder', label: 'File: Close Folder', run: () => setRoot(null) },
  { id: 'save', label: 'File: Save', keys: 'Mod+S', run: () => textDoc() && !S.active.readOnly && save(S.active) },
  { id: 'save-as', label: 'File: Save As…', keys: 'Mod+Shift+S', run: () => textDoc() && !S.active.readOnly && saveAs(S.active) },
  { id: 'save-all', label: 'File: Save All', keys: 'Mod+Alt+S', run: () => saveAll() },
  { id: 'close-tab', label: 'File: Close Tab', keys: 'Mod+W', run: () => (S.active ? closeDoc(S.active) : requestWindowClose()) },
  { id: 'close-all', label: 'File: Close All Tabs', run: async () => { for (const d of [...S.docs]) if (!(await closeDoc(d, null, true))) break; } },
  { id: 'undo', label: 'Edit: Undo', keys: 'Mod+Z', hidden: true, run: () => textDoc() && editor.undo() },
  { id: 'redo', label: 'Edit: Redo', keys: 'Mod+Shift+Z', hidden: true, run: () => textDoc() && editor.redo() },
  { id: 'select-all', label: 'Edit: Select All', keys: 'Mod+A', hidden: true, run: () => textDoc() && editor.selectAll() },
  { id: 'find', label: 'Edit: Find', keys: 'Mod+F', run: () => textDoc() && findWidget.open() },
  { id: 'replace', label: 'Edit: Replace', keys: IS_MAC ? 'Mod+Alt+F' : 'Ctrl+H', run: () => textDoc() && findWidget.open({ replace: true }) },
  { id: 'search-in-files', label: 'Edit: Find in Files', keys: 'Mod+Shift+F', run: () => showView('search', true) },
  { id: 'toggle-comment', label: 'Edit: Toggle Line Comment', keys: 'Mod+/', run: () => textDoc() && editor.toggleComment() },
  { id: 'sort-lines', label: 'Edit: Sort Lines Ascending', run: () => transformText((t) => t.split('\n').sort((a, b) => a.localeCompare(b)).join('\n')) },
  { id: 'upper', label: 'Edit: Transform to Uppercase', run: () => transformText((t) => t.toUpperCase()) },
  { id: 'lower', label: 'Edit: Transform to Lowercase', run: () => transformText((t) => t.toLowerCase()) },
  { id: 'trim', label: 'Edit: Trim Trailing Whitespace', run: () => transformText((t) => t.replace(/[ \t]+$/gm, '')) },
  { id: 'duplicate-line', label: 'Edit: Duplicate Line Down', keys: 'Shift+Alt+↓', run: () => textDoc() && editor.duplicateLines(1) },
  { id: 'delete-line', label: 'Edit: Delete Line', keys: 'Mod+Shift+K', run: () => textDoc() && editor.deleteLines() },
  { id: 'goto-line', label: 'Go: Go to Line…', keys: 'Ctrl+G', run: () => openPalette(':') },
  { id: 'quick-open', label: 'Go: Go to File…', keys: 'Mod+P', run: () => openPalette('') },
  { id: 'split-editor', label: 'View: Split Editor', keys: 'Mod+\\', run: () => splitEditor() },
  { id: 'move-editor', label: 'View: Move Editor to Other Pane', run: () => moveEditor() },
  { id: 'focus-left-editor', label: 'View: Focus Left Editor', keys: 'Mod+1', run: () => focusPane(groups.groups[0]) },
  { id: 'focus-right-editor', label: 'View: Focus Right Editor', keys: 'Mod+2', run: () => { if (groups.groups[1]) focusPane(groups.groups[1]); } },
  { id: 'join-editors', label: 'View: Join Editors', run: () => joinEditors() },
  { id: 'next-tab', label: 'Go: Next Tab', keys: 'Ctrl+Tab', run: () => cycleTab(1) },
  { id: 'prev-tab', label: 'Go: Previous Tab', keys: 'Ctrl+Shift+Tab', run: () => cycleTab(-1) },
  { id: 'palette', label: 'View: Command Palette…', keys: 'Mod+Shift+P', hidden: true, run: () => openPalette('>') },
  { id: 'show-explorer', label: 'View: Show Explorer', keys: 'Mod+Shift+E', run: () => showView('explorer', true) },
  { id: 'toggle-sidebar', label: 'View: Toggle Sidebar', keys: 'Mod+B', run: () => setSidebar(!S.ui.sidebar) },
  { id: 'toggle-terminal', label: 'View: Toggle Terminal', keys: 'Ctrl+`', run: () => setTerminal(!S.ui.terminal) },
  { id: 'terminal-new', label: 'Terminal: New Terminal', keys: 'Ctrl+Shift+`', run: () => { if (!S.ui.terminal || !terminal.sessions.length) setTerminal(true); else terminal.newSession(); } },
  { id: 'terminal-clear', label: 'Terminal: Clear', run: () => terminal.clear() },
  { id: 'terminal-kill', label: 'Terminal: Kill Active Terminal', run: () => terminal.killActive() },
  { id: 'toggle-wrap', label: 'View: Toggle Word Wrap', keys: 'Alt+Z', run: () => updateSettings({ wordWrap: !S.settings.wordWrap }) },
  { id: 'add-next', label: 'Selection: Add Next Occurrence', keys: 'Mod+D', run: () => textDoc() && editor._selectNextOccurrence() },
  { id: 'select-occurrences', label: 'Selection: Select All Occurrences', keys: 'Mod+Shift+L', run: () => textDoc() && editor.selectAllOccurrences() },
  { id: 'cursor-above', label: 'Selection: Add Cursor Above', keys: 'Mod+Alt+↑', run: () => textDoc() && editor.addCursorVertical(-1) },
  { id: 'cursor-below', label: 'Selection: Add Cursor Below', keys: 'Mod+Alt+↓', run: () => textDoc() && editor.addCursorVertical(1) },
  { id: 'collapse-cursors', label: 'Selection: Single Cursor', keys: 'Esc', run: () => textDoc() && editor.setSel(editor.main.anchor, editor.main.head) },
  { id: 'toggle-minimap', label: 'View: Toggle Minimap', run: () => updateSettings({ minimap: !S.settings.minimap }) },
  { id: 'font-up', label: 'View: Increase Font Size', keys: 'Mod+=', run: () => updateSettings({ fontSize: Math.min(28, S.settings.fontSize + 1) }) },
  { id: 'font-down', label: 'View: Decrease Font Size', keys: 'Mod+-', run: () => updateSettings({ fontSize: Math.max(9, S.settings.fontSize - 1) }) },
  { id: 'font-reset', label: 'View: Reset Font Size', keys: 'Mod+0', run: () => updateSettings({ fontSize: 13 }) },
  { id: 'theme-light', label: 'Theme: Light', run: () => updateSettings({ theme: 'light' }) },
  { id: 'theme-dark', label: 'Theme: Dark', run: () => updateSettings({ theme: 'dark' }) },
  { id: 'theme-system', label: 'Theme: Match System', run: () => updateSettings({ theme: 'system' }) },
  { id: 'settings', label: 'Preferences: Open Settings', keys: 'Mod+,', run: () => openSettings() },
  { id: 'shortcuts', label: 'Help: Keyboard Shortcuts', run: () => openShortcuts() },
  { id: 'go-definition', label: 'Language: Go to Definition', keys: 'F12', run: () => languageIntelligence.definition() },
  { id: 'symbol-hover', label: 'Language: Show Hover', run: () => languageIntelligence.hover() },
  { id: 'rename-symbol', label: 'Language: Rename Symbol', keys: 'F2', run: () => languageIntelligence.rename() },
  { id: 'language-problems', label: 'Language: Show Problems in Current File', run: () => languageIntelligence.problems() },
  { id: 'change-language', label: 'Language: Change Language Mode', run: () => changeLanguage() },
  { id: 'change-indent', label: 'Indentation: Change Indentation', run: () => changeIndent() },
  { id: 'toggle-eol', label: 'File: Toggle Line Endings (LF / CRLF)', run: () => toggleEol() },
  { id: 'reload-file', label: 'File: Reload from Disk', run: () => S.active?.path && reloadDoc(S.active, true) },
  { id: 'reveal', label: 'File: Reveal in Finder', run: () => S.active?.path && api.fs.reveal(S.active.path) },
  { id: 'copy-path', label: 'File: Copy Path', run: () => S.active?.path && navigator.clipboard?.writeText(S.active.path).then(() => toast('Path copied')).catch(() => {}) },
  { id: 'show-ext', label: 'View: Show Extensions', keys: 'Mod+Shift+X', run: () => showView('ext', true) },
  { id: 'ext-docs', label: 'Help: Extension Developer Guide', run: () => openDocsPage() },
  { id: 'ext-create', label: 'Developer: Create Extension…', run: () => createExtension() },
  { id: 'ext-reload', label: 'Developer: Reload Extensions', run: () => reloadExtensions(true) },
  { id: 'ext-log', label: 'Developer: Show Extension Log', run: () => showExtensionLog() },
  { id: 'ext-install-folder', label: 'Developer: Install Extension from Folder…', run: () => installFromFolder() },
  { id: 'ext-package', label: 'Developer: Package Extension…', run: () => packageExtension() },
  { id: 'ext-install-zip', label: 'Extensions: Install from .zip…', run: () => installFromZip() },
  { id: 'ext-check-updates', label: 'Extensions: Check for Updates', run: () => checkExtensionUpdates(true) },
  { id: 'ext-review-updates', label: 'Extensions: Review Updates', run: () => reviewExtensionUpdates() },
  { id: 'ext-registry', label: 'Extensions: Set Registry URL…', run: () => setRegistryUrl() },
  { id: 'ext-theme', label: 'Preferences: Color Theme', run: () => pickColorTheme() },
  { id: 'show-git', label: 'View: Show Source Control', keys: 'Ctrl+Shift+G', run: () => showView('git', true) },
  { id: 'git-checkout', label: 'Git: Checkout to…', run: () => pickBranch() },
  { id: 'git-create-branch', label: 'Git: Create Branch…', run: () => createBranch() },
  { id: 'git-commit', label: 'Git: Commit…', run: () => { showView('git', true); gitPanel.focusMessage(); } },
  { id: 'git-commit-all', label: 'Git: Commit All…', run: () => commitAllPrompt() },
  { id: 'git-stage-all', label: 'Git: Stage All Changes', run: () => gitStage([]) },
  { id: 'git-unstage-all', label: 'Git: Unstage All Changes', run: () => gitUnstage([]) },
  { id: 'git-discard-all', label: 'Git: Discard All Changes…', run: () => gitDiscardAll() },
  { id: 'git-push', label: 'Git: Push', run: () => gitPush() },
  { id: 'git-pull', label: 'Git: Pull', run: () => gitPull() },
  { id: 'git-fetch', label: 'Git: Fetch', run: () => gitFetch() },
  { id: 'git-sync', label: 'Git: Sync (Pull, then Push)', run: () => gitSync() },
  { id: 'git-open-changes', label: 'Git: Open Changes for Current File', run: () => openCurrentFileDiff() },
  { id: 'git-log', label: 'Git: View Commit History…', run: () => gitLog(false) },
  { id: 'git-file-history', label: 'Git: View File History…', run: () => gitLog(true) },
  { id: 'git-stash', label: 'Git: Stash Changes', run: () => gitStash() },
  { id: 'git-stash-pop', label: 'Git: Pop Latest Stash', run: () => gitStashPop() },
  { id: 'git-init', label: 'Git: Initialize Repository', run: () => gitInit() },
  { id: 'git-refresh', label: 'Git: Refresh', run: () => git.refresh() },
  { id: 'git-toggle-blame', label: 'Git: Toggle Inline Blame', run: () => updateSettings({ gitBlame: !S.settings.gitBlame }) },
  { id: 'new-folder', label: 'Explorer: New Folder', run: () => { showView('explorer', true); explorer.startCreate('folder'); } },
  { id: 'refresh-explorer', label: 'Explorer: Refresh', run: () => { S.fileCache = null; explorer.refresh(); } },
];
const commandById = new Map(commands.map((c) => [c.id, c]));

function runCommand(id) {
  const c = commandById.get(id);
  if (c) c.run();
}

// ---------- settings and theme ----------
async function updateSettings(patch) {
  Object.assign(S.settings, patch);
  applySettings();
  try { await api.settings.set(patch); } catch (err) { toast(err.message, { error: true }); }
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function resolvedTheme() {
  return S.settings.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : S.settings.theme;
}

let lastTheme = null;
let lastExtTheme = false;
function applySettings() {
  const s = S.settings;
  const ct = extHost && extHost.themes.find((t) => t.key === s.colorTheme && extHost.get(t.extId) && extHost.get(t.extId).enabled);
  api.app.setTheme(ct ? ct.type : s.theme);
  const next = ct ? ct.type : resolvedTheme();
  const root = document.documentElement;
  if (lastTheme && lastTheme !== next) {
    root.classList.add('theme-anim');
    setTimeout(() => root.classList.remove('theme-anim'), 350);
  }
  const themeChanged = lastTheme !== null && lastTheme !== next;
  lastTheme = next;
  root.dataset.theme = next;
  applyExtensionTheme(ct || null);
  if (themeChanged || ct || lastExtTheme) { explorer?.render(); renderTabs(); }
  for (const pane of groups.groups) {
    pane.editor.setOptions({ fontSize: s.fontSize, autoClose: s.autoClose, completion: s.completion, wordWrap: s.wordWrap });
    pane.minimap.setEnabled(s.minimap); pane.minimap.refreshColors();
  }
  lastExtTheme = !!ct;
  minimap.refreshColors();
  terminal.setTheme();
  terminal.setFontSize(Math.max(10, s.fontSize - 0.5));
}
darkQuery.addEventListener('change', () => { if (S.settings.theme === 'system' && editor) applySettings(); });

// ---------- editor groups ----------
function savePaneView(pane) {
  if (!pane.editor?.doc) return;
  pane.editor.saveViewState();
  if (pane.docs.includes(pane.editor.doc)) pane.views.set(pane.editor.doc, structuredClone(pane.editor.doc.view));
}
function focusPane(pane, focus = true) {
  if (!pane?.editor || !groups.groups.includes(pane)) return;
  if (activePane !== pane) {
    savePaneView(activePane);
    activePane = groups.active = pane;
    ({ editor, minimap, findWidget, pageHost, language: languageIntelligence } = pane);
    S.active = pane.active;
    for (const g of groups.groups) g.root.classList.toggle('active-pane', g === pane);
    if (editor.doc) editor.emitCursor();
    updateStatus(); updateTitle();
    extHost?.emit('activeFileChanged', pane.active && !pane.active.page ? fileInfo(pane.active) : null);
    scheduleMarks(0); scheduleBlame(); persistSession();
  }
  if (focus) { if (pane.active?.page) pane.active._pageEl?.focus(); else editor.focus(); }
}
function setPaneDocument(pane, doc) {
  const previous = pane.editor.doc;
  savePaneView(pane);
  pane.active = doc;
  if (doc && previous !== doc) doc.view = structuredClone(pane.views.get(doc) || doc.view);
  if (previous !== doc) pane.editor.setDoc(doc);
  if (doc) pane.views.set(doc, structuredClone(doc.view));
  pane.editor.readOnly = !!doc?.readOnly;
  if (previous !== doc) pane.editor.setGutterMarks(null);
  pane.language.activate();
  if (doc?.page) { if (pane.findWidget.isOpen) pane.findWidget.close(); pane.pageHost.show(doc); }
  else pane.pageHost.hide();
  pane.welcome.hidden = !!doc;
  pane.minimap.schedule();
}
function createPane(pane, root) {
  pane.root = root; pane.area = root.querySelector('.editor-area'); pane.tabs = root.querySelector('.tabbar'); pane.welcome = root.querySelector('.welcome');
  pane.editor = new Editor(root.querySelector('.editor-host'), { fontSize: S.settings.fontSize, autoClose: S.settings.autoClose, completion: S.settings.completion, wordWrap: S.settings.wordWrap });
  pane.editor.isActiveView = () => activePane === pane;
  pane.minimap = new Minimap(pane.editor); pane.minimap.setEnabled(S.settings.minimap);
  pane.findWidget = new FindWidget(root.querySelector('.find-host'), pane.editor);
  pane.pageHost = new PageHost(root.querySelector('.page-host'));
  const paneState = { get active() { return pane.active; }, get docs() { return S.docs; }, get root() { return S.root; } };
  pane.language = new LanguageIntelligence({ editor: pane.editor, state: paneState, api, palette,
    openFile: (path, options) => { focusPane(pane, false); return openFile(path, options); }, toast, home: S.info.home });
  root.addEventListener('pointerdown', () => focusPane(pane, false), true);
  root.addEventListener('focusin', () => focusPane(pane, false));
  const actions = root.querySelector('.pane-actions');
  actions.append(el('button', { class: 'icon-btn sm', 'aria-label': 'Split editor', title: 'Split editor (⌘/Ctrl+\\)', html: icon('sidebar'), onclick: () => { focusPane(pane, false); splitEditor(); } }));
  if (pane.id === 'right') actions.append(el('button', { class: 'icon-btn sm', 'aria-label': 'Join editors', title: 'Join editors', html: icon('close'), onclick: () => joinEditors() }));
  pane.tabs.addEventListener('dragover', (e) => { if (tabDrag) e.preventDefault(); });
  pane.tabs.addEventListener('drop', (e) => { if (tabDrag && !e.target.closest('.tab')) { e.preventDefault(); moveEditor(tabDrag.doc, tabDrag.pane, pane); tabDrag = null; } });
  wireEditorEvents(pane);
}
function ensureSplit() {
  if (groups.groups[1]) return groups.groups[1];
  const pane = groups.split();
  if (rightPane) {
    Object.assign(rightPane, { docs: pane.docs, active: null, views: pane.views });
    groups.groups[1] = rightPane; rightPane.root.hidden = false;
  } else {
    rightPane = pane;
    const root = el('section', { class: 'editor-pane', id: 'pane-right', 'aria-label': 'Right editor group' });
    root.innerHTML = `<header class="pane-header"><div class="tabbar" role="tablist" aria-label="Right editor tabs"></div><div class="pane-actions"></div></header>
      <div class="editor-area"><div class="editor-host"></div><div class="page-host" hidden></div><div class="find-host"></div>
      <div class="welcome pane-empty"><div><h2>Open a file in this pane</h2><div class="welcome-actions"><button class="btn primary" data-pane-new>New file</button><button class="btn secondary" data-pane-open>Open file…</button></div></div></div></div>`;
    $('#editor-panes').append(root); createPane(pane, root);
    root.querySelector('[data-pane-new]').onclick = () => { focusPane(pane, false); newUntitled(); };
    root.querySelector('[data-pane-open]').onclick = () => { focusPane(pane, false); openFileDialog(); };
  }
  $('#editor-panes').classList.add('split'); $('#sash-editors').hidden = false;
  setSplitRatio(groups.ratio); renderTabs(); persistSession();
  return rightPane;
}
function setSplitRatio(ratio) {
  groups.ratio = Math.max(0.25, Math.min(0.75, Number(ratio) || 0.5));
  groups.groups[0].root.style.setProperty('--pane-width', `calc(${groups.ratio * 100}% - 2.5px)`);
  $('#sash-editors').setAttribute('aria-valuenow', String(Math.round(groups.ratio * 100)));
  for (const pane of groups.groups) { pane.editor.layout(); pane.editor.scheduleRender(); }
}
function splitEditor() {
  const from = activePane, doc = from.active;
  savePaneView(from);
  ensureSplit();
  const to = groups.groups.find((g) => g !== from);
  if (doc) { if (from.views.has(doc)) to.views.set(doc, structuredClone(from.views.get(doc))); activate(doc, to); }
  else focusPane(to);
}
function moveEditor(doc = S.active, from = activePane, to = null, index) {
  if (!doc) return;
  if (to !== from) ensureSplit();
  to ||= groups.groups.find((g) => g !== from);
  if (from === to) {
    const old = from.docs.indexOf(doc); if (old < 0) return;
    const target = index != null && old < index ? index - 1 : index;
    from.docs.splice(old, 1); from.docs.splice(Math.max(0, target ?? from.docs.length), 0, doc);
  } else {
    savePaneView(from); savePaneView(to);
    groups.move(doc, from, to, index);
    setPaneDocument(from, from.active);
    activate(doc, to);
  }
  renderTabs(); persistSession();
}
function joinEditors() {
  if (groups.groups.length < 2) return;
  for (const pane of groups.groups) savePaneView(pane);
  const left = groups.join(), selected = left.active;
  rightPane.editor.setDoc(null); rightPane.docs = []; rightPane.active = null; rightPane.views.clear();
  rightPane.language.activate(); rightPane.root.hidden = true;
  $('#editor-panes').classList.remove('split'); $('#sash-editors').hidden = true;
  focusPane(left, false);
  // Reattach so a view moved from the right pane takes effect even for a shared file.
  left.editor.setDoc(null);
  if (selected) activate(selected, left); else { setPaneDocument(left, null); S.active = null; renderTabs(); }
  left.editor.layout(); left.editor.scheduleRender(); persistSession();
}
function wireEditorEvents(pane) {
  const ed = pane.editor;
  let selTimer = null, textTimer = null;
  ed.on('cursor', (c) => {
    if (activePane !== pane) return;
    const lineChanged = c.line !== statusState.line; Object.assign(statusState, c); updateStatus(); if (lineChanged) scheduleBlame();
    if (extHost && !selTimer) selTimer = setTimeout(() => { selTimer = null; if (activePane === pane) extHost.emit('selectionChanged', { line: c.line, col: c.col, cursors: c.cursors }); }, 200);
    persistSession();
  });
  ed.on('scroll', () => persistSession());
  ed.on('change', (doc) => {
    if (activePane === pane) {
      clearTimeout(textTimer); textTimer = setTimeout(() => extHost?.emit('textChanged', { path: doc.path, name: doc.name, version: doc.buffer.version }), 300);
      scheduleMarks(250); if (S.blame) { S.blame = null; updateStatus(); }
    }
    if (doc.buffer.dirty !== doc._wasDirty) { doc._wasDirty = doc.buffer.dirty; renderTabs(); updateTitle(); }
    if (S.settings.autoSave && doc.path && doc.buffer.dirty) { clearTimeout(doc._autoTimer); doc._autoTimer = setTimeout(() => { if (doc.buffer.dirty) save(doc); }, 1000); }
  });
  ed.on('request', ({ type }) => {
    focusPane(pane, false);
    if (type === 'split-editor') splitEditor();
    else if (type === 'focus-left-editor') focusPane(groups.groups[0]);
    else if (type === 'focus-right-editor') { if (groups.groups[1]) focusPane(groups.groups[1]); }
    else if (type === 'go-definition') languageIntelligence.definition();
    else if (type === 'rename-symbol') languageIntelligence.rename();
    else if (type === 'find') findWidget.open();
    else if (type === 'replace') findWidget.open({ replace: true });
    else if (type === 'goto-line') openPalette(':');
    else if (type === 'search-in-files') showView('search', true);
    else if (type === 'escape' && findWidget.isOpen) findWidget.close();
  });
}

// ---------- documents ----------
function makeDoc({ path = null, name, text = '', mtime = null }) {
  const doc = new Document({ path, name: name || basename(path), text });
  doc.mtime = mtime;
  doc._wasDirty = false;
  doc.buffer.onChange(() => { if (S.docs.includes(doc) && !doc.readOnly && !doc.page) persistSession(); });
  return doc;
}

function newUntitled() {
  const doc = makeDoc({ name: `Untitled-${++S.untitled}`, text: '' });
  S.docs.push(doc);
  activate(doc);
}

async function openFile(path, { line, col, len } = {}) {
  const pane = activePane;
  let doc = S.docs.find((d) => d.path === path);
  if (!doc) {
    let r;
    const area = activePane.area;
    const busy = setTimeout(() => area.classList.add('busy'), 120);
    try { r = await api.fs.readFile(path); } catch (err) { toast(`Cannot open ${basename(path)}: ${err.message}`, { error: true }); return null; } finally { clearTimeout(busy); area.classList.remove('busy'); }
    if (r.binary) { toast(`${basename(path)} is a binary file and can't be shown in the editor.`); return null; }
    if (r.tooLarge) { toast(`${basename(path)} is too large to open (${Math.round(r.size / 1048576)} MB).`, { error: true }); return null; }
    doc = makeDoc({ path, text: r.text, mtime: r.mtime });
    S.docs.push(doc);
    extHost?.emit('fileOpened', fileInfo(doc));
  }
  activate(doc, groups.groups.includes(pane) ? pane : activePane);
  if (line != null) {
    editor.setSel({ line, col: col || 0 }, { line, col: (col || 0) + (len || 0) }, { reveal: false });
    editor.centerLine(line);
    editor.scheduleRender();
  }
  return doc;
}

async function openFileDialog() {
  let files = [];
  try { files = await api.dialog.openFiles(); } catch (err) { toast(err.message, { error: true }); }
  for (const f of files) await openFile(f);
}

async function openFolderDialog() {
  let dir;
  try { dir = await api.dialog.openFolder(); } catch (err) { toast(err.message, { error: true }); return; }
  if (dir) setRoot(dir);
}

function activate(doc, pane = activePane) {
  if (doc.page) {
    for (const owner of groups.owners(doc)) if (owner !== pane) { groups.remove(owner, doc); setPaneDocument(owner, owner.active); }
  }
  groups.attach(pane, doc);
  focusPane(pane, false);
  S.active = doc;
  const i = mru.indexOf(doc);
  if (i >= 0) mru.splice(i, 1);
  mru.unshift(doc);
  setPaneDocument(pane, doc);
  if (doc.page) {
    if (findWidget.isOpen) findWidget.close();
    editor.setGutterMarks(null);
    S.blame = null;
    pageHost.show(doc);
  } else {
    pageHost.hide();
    scheduleMarks(0);
    scheduleBlame();
  }
  extHost?.emit('activeFileChanged', doc.page ? null : fileInfo(doc));
  if (!doc.page) extHost?.onLanguage(doc.lang);
  renderTabs();
  updateStatus();
  updateTitle();
  if (doc.path) explorer.reveal(doc.path);
  explorer.setOpenFiles(S.docs.map((d) => d.path).filter(Boolean));
  if (!palette.isOpen && !doc.page) editor.focus();
  persistSession();
}

async function closeDoc(doc, pane = activePane, everywhere = false) {
  const owners = groups.owners(doc);
  pane = owners.includes(pane) ? pane : owners[0];
  if (!everywhere && owners.length > 1) {
    groups.remove(pane, doc); setPaneDocument(pane, pane.active);
    if (activePane === pane) { S.active = pane.active; if (pane.active) activate(pane.active, pane); else { renderTabs(); updateStatus(); updateTitle(); } }
    renderTabs(); persistSession(); return true;
  }
  let discarded = false;
  if (doc.buffer.dirty) {
    const choice = await api.dialog.confirm({ message: `Do you want to save the changes you made to ${doc.name}?`, detail: 'Your changes will be lost if you don\'t save them.', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2 });
    if (choice === 2) return false;
    if (choice === 0 && !(await save(doc))) return false;
    discarded = choice === 1;
  }
  clearTimeout(doc._autoTimer);
  S.docs.splice(S.docs.indexOf(doc), 1);
  if (doc.page) pageHost.drop(doc);
  const m = mru.indexOf(doc); if (m >= 0) mru.splice(m, 1);
  for (const owner of owners) { groups.remove(owner, doc); setPaneDocument(owner, owner.active); }
  S.active = activePane.active;
  if (S.active) activate(S.active, activePane);
  else { editor.setGutterMarks(null); languageIntelligence.activate(); renderTabs(); updateStatus(); updateTitle(); }
  explorer.setOpenFiles(S.docs.map((d) => d.path).filter(Boolean));
  try { await checkpointSession({ discard: discarded }); } catch { return false; }
  return true;
}

async function save(doc) {
  if (!doc.path) return saveAs(doc);
  try {
    doc.mtime = await api.fs.writeFile(doc.path, doc.buffer.getText());
  } catch (err) {
    toast(`Could not save ${doc.name}: ${err.message}`, { error: true });
    return false;
  }
  doc.buffer.markSaved();
  doc._wasDirty = false;
  doc.buffer.sealUndo();
  doc._flash = true;
  persistSession();
  extHost?.emit('fileSaved', fileInfo(doc));
  git.scheduleRefresh(200);
  renderTabs();
  updateTitle();
  return true;
}

async function saveAs(doc) {
  let target;
  try { target = await api.dialog.saveAs(doc.path || (S.root ? joinPath(S.root, doc.name) : doc.name)); } catch (err) { toast(err.message, { error: true }); return false; }
  if (!target) return false;
  const clash = S.docs.find((d) => d !== doc && d.path === target);
  if (clash) { toast(`${basename(target)} is already open in another tab. Close it first.`, { error: true }); return false; }
  doc.path = target;
  doc.name = basename(target);
  const lang = languageForFile(doc.name);
  if (lang !== doc.lang) doc.setLang(lang);
  const ok = await save(doc);
  if (ok) {
    explorer.refresh([dirname(target)]);
    S.fileCache = null;
    updateStatus();
    persistSession();
  }
  return ok;
}

async function saveAll() {
  let n = 0;
  for (const d of S.docs) if (d.buffer.dirty && (await save(d))) n++;
  if (n) toast(`Saved ${n} file${n === 1 ? '' : 's'}`);
}

async function reloadDoc(doc, announce = false) {
  if (!doc.path) return;
  let r;
  try { r = await api.fs.readFile(doc.path); } catch (err) { toast(err.message, { error: true }); return; }
  if (r.text == null) return;
  const b = doc.buffer;
  if (r.text !== b.getText()) {
    const head = { ...doc.view.head };
    const wasActive = S.active === doc;
    const sel = wasActive ? { anchor: editor.anchor, head: editor.head } : null;
    const end = { line: b.lineCount - 1, col: b.getLine(b.lineCount - 1).length };
    b.replace({ line: 0, col: 0 }, end, r.text, { record: false });
    b.undoStack.length = 0;
    b.redoStack.length = 0;
    if (wasActive) editor.setSel(sel.anchor, sel.head, { reveal: false, userMove: false });
    else doc.view.head = b.clampPos(head);
  }
  b.markSaved();
  doc.mtime = r.mtime;
  doc._wasDirty = false;
  renderTabs();
  updateTitle();
  persistSession();
  if (announce) toast(`Reloaded ${doc.name}`);
}

// Detect edits made outside the app when the window regains focus.
async function checkExternalChanges() {
  for (const doc of [...S.docs]) {
    if (!doc.path || !doc.mtime) continue;
    let m;
    try { m = await api.fs.mtime(doc.path); } catch { continue; }
    if (!m || m <= doc.mtime + 1) continue;
    if (!doc.buffer.dirty) { await reloadDoc(doc); continue; }
    const choice = await api.dialog.confirm({
      type: 'question', message: `${doc.name} changed on disk.`, detail: 'Reload it and discard your unsaved edits, or keep your version?',
      buttons: ['Keep My Version', 'Reload from Disk'], defaultId: 0, cancelId: 0,
    });
    if (choice === 1) await reloadDoc(doc); else doc.mtime = m;
  }
}

function cycleTab(dir) {
  const docs = activePane.docs;
  if (docs.length < 2) return;
  const i = docs.indexOf(S.active);
  activate(docs[(i + dir + docs.length) % docs.length]);
}

function transformText(fn) {
  if (!S.active) return;
  const b = editor.buffer;
  const whole = !editor.hasSelection();
  const [s, e] = whole
    ? [{ line: 0, col: 0 }, { line: b.lineCount - 1, col: b.getLine(b.lineCount - 1).length }]
    : editor.selRange();
  const text = b.getRange(s, e);
  const out = fn(text);
  if (out === text) return;
  const end = editor.edit(s, e, out);
  if (!whole) editor.setSel(s, end, { userMove: false });
}

// ---------- tabs ----------
function renderTabs() {
  for (const pane of groups.groups) renderPaneTabs(pane);
}
function renderPaneTabs(pane) {
  const bar = pane.tabs;
  if (!bar) return;
  const frag = document.createDocumentFragment();
  const dupNames = new Set();
  const seen = new Set();
  for (const d of S.docs) { if (seen.has(d.name)) dupNames.add(d.name); seen.add(d.name); }
  for (const doc of pane.docs) {
    const dirty = doc.buffer.dirty;
    const label = dupNames.has(doc.name) && doc.path ? `${doc.name} — ${basename(dirname(doc.path))}` : doc.name;
    const tab = el('div', {
      class: `tab${gitClass(doc)}${doc === pane.active ? ' active' : ''}${dirty ? ' dirty' : ''}${doc._tabSeen ? '' : ' enter'}${doc._flash ? ' saved' : ''}`, role: 'tab', 'aria-selected': String(doc === pane.active),
      title: doc.path || doc.name, draggable: 'true',
    });
    doc._tabSeen = true;
    doc._flash = false;
    tab.append(el('span', { class: 'ticon', html: doc.iconHtml || fileIconHtml(doc.iconName || doc.name) }), el('span', { class: 'tname' }, label));
    if (dirty) tab.append(el('span', { class: 'dot', 'aria-label': 'Unsaved changes' }));
    tab.append(el('button', { class: 'tclose', 'aria-label': `Close ${doc.name}`, html: icon('close'), onclick: (e) => { e.stopPropagation(); closeDoc(doc, pane); } }));
    tab.addEventListener('mousedown', (e) => {
      if (e.button === 1) { e.preventDefault(); closeDoc(doc, pane); }
    });
    tab.tabIndex = doc === pane.active ? 0 : -1;
    tab.addEventListener('click', () => activate(doc, pane));
    tab.addEventListener('keydown', (e) => { if (e.target !== tab) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(doc, pane); } else if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); focusPane(pane, false); cycleTab(e.key === 'ArrowLeft' ? -1 : 1); pane.tabs.querySelector('.active')?.focus(); } });
    tab.addEventListener('contextmenu', (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY, [
      { label: 'Open in Other Pane', run: () => { focusPane(pane, false); activate(doc, pane); splitEditor(); } },
      { label: 'Move to Other Pane', run: () => moveEditor(doc, pane) },
      { label: 'Close', run: () => closeDoc(doc, pane) },
    ]); });
    tab.addEventListener('dragstart', (e) => { tabDrag = { doc, pane }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', doc.name); });
    tab.addEventListener('dragover', (e) => { if (tabDrag) { e.preventDefault(); tab.classList.add('dragover'); } });
    tab.addEventListener('dragleave', () => tab.classList.remove('dragover'));
    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      tab.classList.remove('dragover');
      if (!tabDrag || (tabDrag.doc === doc && tabDrag.pane === pane)) return;
      const index = pane.docs.indexOf(doc);
      moveEditor(tabDrag.doc, tabDrag.pane, pane, index);
      tabDrag = null;
      renderTabs();
      persistSession();
    });
    tab.addEventListener('dragend', () => { tabDrag = null; });
    frag.append(tab);
  }
  bar.replaceChildren(frag);
  hydrateIcons(bar);
  bar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ---------- status bar and title ----------
const statusState = { line: 1, col: 1, selected: 0, selectedLines: 1, cursors: 1 };

function updateStatus() {
  const bar = $('#statusbar');
  const d = S.active;
  const rootName = S.root ? basename(S.root) : 'No folder open';
  const pos = statusState.cursors > 1
    ? `${statusState.cursors} cursors${statusState.selected ? ` (${statusState.selected} selected)` : ''}`
    : statusState.selected
      ? `Ln ${statusState.line}, Col ${statusState.col} (${statusState.selected} selected)`
      : `Ln ${statusState.line}, Col ${statusState.col}`;
  const indent = d ? (d.indent.insertSpaces ? `Spaces: ${d.indent.tabSize}` : `Tab Size: ${d.indent.tabSize}`) : '';
  const gs = git && git.status;
  let gitBits = '';
  if (gs && gs.isRepo) {
    const dirty = git.count > 0 ? '*' : '';
    gitBits = `<button class="sb" data-act="git-checkout" title="Switch branch">${icon('branch', 'sm')}<span>${escapeHtml(gs.branch || (gs.detached ? 'HEAD' : 'no commits'))}${dirty}</span></button>`;
    if (gs.ahead || gs.behind) gitBits += `<button class="sb" data-act="git-sync" title="Sync changes (${gs.behind} to pull, ${gs.ahead} to push)">${gs.behind ? '↓' + gs.behind + ' ' : ''}${gs.ahead ? '↑' + gs.ahead : ''}</button>`;
    if (S.blame) gitBits += `<span class="sb blame" title="${escapeHtml(S.blame.title)}">${escapeHtml(S.blame.text)}</span>`;
  }
  const extItems = extHost ? [...extHost.statusItems.entries()].map(([key, it]) => `<button class="sb ext" data-ext="${escapeHtml(key)}" title="${escapeHtml(it.tooltip || '')}">${escapeHtml(it.text)}</button>`).join('') : '';
  bar.innerHTML = `
    <button class="sb" data-act="open-folder" title="Open folder">${icon('folder', 'sm')}<span>${escapeHtml(rootName)}</span></button>
    ${gitBits}
    <span class="push"></span>
    ${extItems}
    ${d && !d.page ? `<button class="sb" data-act="goto-line" title="Go to line">${pos}</button>
    <button class="sb" data-act="change-indent" title="Change indentation">${indent}</button>
    <span class="sb">UTF-8</span>
    <button class="sb${S.settings.wordWrap ? ' on' : ''}" data-act="toggle-wrap" title="Toggle word wrap (Alt+Z)">${S.settings.wordWrap ? 'Wrap: On' : 'Wrap: Off'}</button>
    <button class="sb" data-act="toggle-eol" title="Toggle line endings">${d.buffer.eol === '\r\n' ? 'CRLF' : 'LF'}</button>
    <button class="sb" data-act="change-language" title="Change language mode">${LANGUAGE_NAMES[d.lang] || d.lang}</button>` : ''}`;
}

function updateTitle() {
  const d = S.active;
  const rootName = S.root ? basename(S.root) : '';
  const center = d ? `${rootName ? rootName + ' — ' : ''}${d.name}${d.buffer.dirty ? ' ●' : ''}` : rootName || 'SunlightIDE';
  $('#tb-title').textContent = center;
  api.app.setTitle(`${d ? d.name + (d.buffer.dirty ? ' ●' : '') + ' — ' : ''}${rootName ? rootName + ' — ' : ''}SunlightIDE`);
}

function toggleEol() {
  const d = S.active;
  if (!d) return;
  d.buffer.eol = d.buffer.eol === '\n' ? '\r\n' : '\n';
  d.buffer.version++;
  renderTabs(); updateStatus(); updateTitle(); persistSession();
}

async function changeLanguage() {
  if (!S.active) return;
  const items = Object.entries(LANGUAGE_NAMES).map(([id, label]) => ({ label, data: id }));
  const pick = await palette.pick(items, 'Select language mode');
  if (pick) {
    S.active.setLang(pick.data);
    persistSession();
    languageIntelligence.activate();
    editor.scheduleRender();
    updateStatus();
  }
}

async function changeIndent() {
  const d = S.active;
  if (!d) return;
  const pick = await palette.pick([
    { label: 'Indent Using Spaces', data: { insertSpaces: true } },
    { label: 'Indent Using Tabs', data: { insertSpaces: false } },
    { label: 'Tab Size: 2', data: { tabSize: 2 } },
    { label: 'Tab Size: 4', data: { tabSize: 4 } },
    { label: 'Tab Size: 8', data: { tabSize: 8 } },
    { label: 'Convert Indentation to Spaces', data: { convert: 'spaces' } },
    { label: 'Convert Indentation to Tabs', data: { convert: 'tabs' } },
  ], 'Select indentation');
  if (!pick) return;
  const { convert, ...rest } = pick.data;
  Object.assign(d.indent, rest);
  persistSession();
  if (convert) {
    const n = d.indent.tabSize;
    transformText((t) => t.replace(/^[ \t]+/gm, (ws) => {
      const cols = [...ws].reduce((v, ch) => (ch === '\t' ? v + n - (v % n) : v + 1), 0);
      return convert === 'spaces' ? ' '.repeat(cols) : '\t'.repeat(Math.floor(cols / n)) + ' '.repeat(cols % n);
    }));
    d.indent.insertSpaces = convert === 'spaces';
  }
  editor.applyOptions();
  editor.layout();
  editor.scheduleRender();
  updateStatus();
}

// ---------- folder / explorer ----------
async function setRoot(dir, { silent = false } = {}) {
  S.root = dir;
  S.fileCache = null;
  git.setFolder(dir);
  await explorer.setRoot(dir);
  api.fs.watch(dir).catch(() => {});
  terminal.setCwd(dir || S.info.home);
  if (dir) {
    S.state.recent = [dir, ...(S.state.recent || []).filter((r) => r !== dir)].slice(0, 8);
    showView('explorer', false);
    if (!silent && !S.ui.sidebar) setSidebar(true);
  }
  updateStatus();
  updateTitle();
  renderWelcome();
  persistSession();
}

const PANELS = { explorer: '#panel-explorer', search: '#panel-search', git: '#panel-git', ext: '#panel-ext' };

function showView(view, focus) {
  S.ui.view = view;
  $$('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view && S.ui.sidebar));
  const wasView = Object.keys(PANELS).find((k) => !$(PANELS[k]).hidden);
  for (const [k, sel] of Object.entries(PANELS)) $(sel).hidden = k !== view;
  if (wasView !== view) replay($(PANELS[view]), 'anim-fade');
  if (!S.ui.sidebar && focus) setSidebar(true);
  if (view === 'git') git.refresh();
  if (view === 'ext') extPanel.refresh();
  if (focus) {
    if (view === 'search') {
      const seed = S.active && editor.hasSelection() && !editor.getSelectionText().includes('\n') ? editor.getSelectionText() : '';
      searchPanel.focus(seed);
    } else if (view === 'git') gitPanel.focusMessage();
    else if (view === 'ext') extPanel.focusSearch();
    else if (S.root) $('#tree').focus();
  }
}

function setSidebar(on) {
  S.ui.sidebar = on;
  $('#sidebar').hidden = !on;
  if (on) replay($('#sidebar'), 'anim-side');
  $('#sash-sidebar').hidden = !on;
  $('#btn-sidebar').classList.toggle('active', on);
  $$('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === S.ui.view && on));
  persistUi();
}

function setTerminal(on) {
  S.ui.terminal = on;
  $('#terminal').hidden = !on;
  if (on) replay($('#terminal'), 'anim-up');
  $('#sash-terminal').hidden = !on;
  $('#btn-terminal').classList.toggle('active', on);
  if (on) {
    terminal.setCwd(S.root || S.info.home);
    terminal.show();
  } else if (S.active) editor.focus();
  persistUi();
}

// ---------- palette ----------
function openPalette(initial) {
  const root = S.root;
  palette.show({
    placeholder: 'Go to file, > for commands, : for line',
    value: initial,
    acceptEmpty: true,
    hint: (q) => (q.startsWith(':') ? (S.active ? `Type a line number (1–${S.active.buffer.lineCount}), optionally :column` : 'Open a file to go to a line') : q.startsWith('>') ? '' : ''),
    provider: async (q) => {
      if (q.startsWith('>')) return commandItems(q.slice(1).trim());
      if (q.startsWith(':')) return [];
      return fileItems(q, root);
    },
    accept: (item, q) => {
      if (q.startsWith(':')) {
        const m = /^:\s*(\d+)(?:\s*:\s*(\d+))?/.exec(q);
        if (m && S.active) { editor.gotoLine(Math.max(0, +m[1] - 1), m[2] ? Math.max(0, +m[2] - 1) : 0); editor.focus(); }
        return;
      }
      if (!item) return;
      if (item.run) item.run();
      else if (item.path) openFile(item.path);
    },
    onClose: () => { if (S.active) editor.focus(); },
    empty: 'No matching results',
  });
}

function commandItems(q) {
  const out = [];
  for (const c of commands) {
    if (c.hidden && !q) continue;
    const m = fuzzy(q, c.label);
    if (m) out.push({ label: c.label, keys: keyLabel(c.keys), indices: q ? m.indices : null, run: c.run, score: m.score });
  }
  if (extHost) {
    for (const [full, c] of extHost.commands) {
      const label = `${c.category ? c.category + ': ' : ''}${c.title}`;
      const m = fuzzy(q, label);
      if (!m) continue;
      const kb = extHost.keybindings.find((k) => k.full === full);
      out.push({ label, keys: kb ? keyLabel(kb.key) : '', indices: q ? m.indices : null, run: () => runExtCommand(full), score: m.score - 0.5 });
    }
  }
  if (q) out.sort((a, b) => b.score - a.score);
  return out;
}

// Folder part of a relative path for display; empty for files at the project root.
function shownDir(rel) {
  const d = dirname(rel);
  return d === rel || d === '.' || d === '/' || d === '' ? '' : d;
}

async function fileItems(q, root) {
  const items = [];
  const openRel = new Set();
  if (!q) {
    for (const d of mru) {
      if (!d.path) { items.push({ label: d.name, detail: 'unsaved', icon: fileIconUrl(d.name), run: () => activate(d) }); continue; }
      const rel = relPath(root, d.path);
      openRel.add(rel);
      items.push({ label: basename(d.path), detail: shownDir(rel), icon: fileIconUrl(basename(d.path)), path: d.path });
    }
  }
  if (!root) return items;
  if (!S.fileCache || S.fileCache.root !== root) {
    S.fileCache = { root, files: [] };
    const cache = S.fileCache;
    try { cache.files = await api.fs.listFiles(root); } catch { cache.files = []; }
  }
  const scored = [];
  for (const rel of S.fileCache.files) {
    if (openRel.has(rel)) continue;
    const m = fuzzy(q, rel);
    if (m) scored.push({ rel, m });
    if (!q && scored.length >= 60) break;
  }
  if (q) scored.sort((a, b) => b.m.score - a.m.score);
  for (const { rel, m } of scored.slice(0, 80)) {
    const name = basename(rel);
    const dir = dirname(rel);
    // Highlight inside the file name only.
    const base = rel.length - name.length;
    const idx = q ? m.indices.filter((i) => i >= base).map((i) => i - base) : null;
    items.push({ label: name, detail: shownDir(rel), indices: idx, icon: fileIconUrl(name), path: joinPath(root, rel) });
  }
  return items;
}

// ---------- dialogs ----------
function openModal(build) {
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.replaceChildren();
  const prev = document.activeElement;
  const close = () => {
    overlay.hidden = true;
    overlay.replaceChildren();
    window.removeEventListener('keydown', onKey, true);
    overlay.onmousedown = null;
    if (S.active) editor.focus(); else prev?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  window.addEventListener('keydown', onKey, true);
  overlay.onmousedown = (e) => { if (e.target === overlay) close(); };
  const box = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' });
  build(box, close);
  overlay.append(box);
  box.querySelector('button')?.focus();
}

function openSettings() {
  openModal((box, close) => {
    const s = S.settings;
    box.append(el('h2', {}, 'Settings'));
    const row = (label, desc, control) => el('div', { class: 'set-row' }, el('div', {}, el('div', { class: 'sl' }, label), el('div', { class: 'sd' }, desc)), control);
    const toggle = (key) => {
      const b = el('button', { class: 'toggle', role: 'switch', 'aria-checked': String(!!s[key]), 'aria-label': key });
      b.addEventListener('click', () => { b.setAttribute('aria-checked', String(!s[key])); updateSettings({ [key]: !s[key] }); });
      return b;
    };
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' });
    for (const [v, l] of [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]) {
      const b = el('button', { 'aria-pressed': String(s.theme === v) }, l);
      b.addEventListener('click', () => { updateSettings({ theme: v }); seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
      seg.append(b);
    }
    const out = el('output', {}, String(s.fontSize));
    const step = (d) => () => { const v = Math.max(9, Math.min(28, s.fontSize + d)); updateSettings({ fontSize: v }); out.textContent = String(v); };
    const stepper = el('div', { class: 'stepper' },
      el('button', { class: 'icon-btn sm', 'aria-label': 'Smaller', onclick: step(-1) }, '−'), out,
      el('button', { class: 'icon-btn sm', 'aria-label': 'Larger', onclick: step(1) }, '+'));
    box.append(
      row('Theme', 'Light, dark, or follow your system.', seg),
      row('Font size', 'Editor text size in pixels.', stepper),
      row('Auto save', 'Save files automatically one second after you stop typing.', toggle('autoSave')),
      row('Auto-close brackets', 'Insert the closing bracket or quote as you type.', toggle('autoClose')),
      row('Suggestions', 'Show word completions while typing.', toggle('completion')),
      row('Word wrap', 'Wrap long lines to the width of the editor.', toggle('wordWrap')),
      row('Git blame', 'Show who last changed the current line in the status bar.', toggle('gitBlame')),
      row('Extension update notifications', 'Notify when a new extension version is available. Updates are installed when you choose.', toggle('extensionUpdateNotifications')),
      row('Minimap', 'Show a zoomed-out overview of the file.', toggle('minimap')),
      el('div', { class: 'dialog-actions' }, el('button', { class: 'btn primary', onclick: close }, 'Done')),
    );
  });
}

function openShortcuts() {
  openModal((box, close) => {
    box.append(el('h2', {}, 'Keyboard shortcuts'));
    const grid = el('div', { class: 'keys-grid' });
    const group = (title, rows) => {
      grid.append(el('div', { class: 'kh' }, title));
      for (const [label, keys] of rows) grid.append(el('div', {}, label), el('div', {}, el('kbd', {}, keyLabel(keys))));
    };
    group('General', [['Command palette', 'Mod+Shift+P'], ['Go to file', 'Mod+P'], ['Find in files', 'Mod+Shift+F'], ['Toggle sidebar', 'Mod+B'], ['Toggle terminal', 'Ctrl+`'], ['Settings', 'Mod+,']]);
    group('Editing', [['Find', 'Mod+F'], ['Go to line', 'Ctrl+G'], ['Add next occurrence', 'Mod+D'], ['Select all occurrences', 'Mod+Shift+L'], ['Add cursor above / below', 'Mod+Alt+↑ / ↓'], ['Add cursor with the mouse', 'Alt+Click'], ['Box select', 'Alt+Shift+Drag'], ['Toggle word wrap', 'Alt+Z'], ['Toggle comment', 'Mod+/'], ['Move line up / down', 'Alt+↑ / ↓'], ['Duplicate line', 'Shift+Alt+↓'], ['Delete line', 'Mod+Shift+K'], ['Insert line below', 'Mod+Enter'], ['Select line', 'Mod+L'], ['Select word / next match', 'Mod+D'], ['Indent / outdent', 'Tab / Shift+Tab']]);
    group('Source control', [['Show source control', 'Ctrl+Shift+G'], ['Commit (in the message box)', 'Mod+Enter']]);
    group('Files', [['New file', 'Mod+N'], ['Save', 'Mod+S'], ['Save all', 'Mod+Alt+S'], ['Close tab', 'Mod+W']]);
    box.append(grid, el('div', { class: 'dialog-actions' }, el('button', { class: 'btn primary', onclick: close }, 'Done')));
  });
}

// ---------- welcome ----------
function renderWelcome() {
  $('#welcome-mark').innerHTML = SUN_MARK;
  const recent = (S.state.recent || []).filter((r) => r !== S.root).slice(0, 5);
  const host = $('#welcome-recent');
  host.replaceChildren();
  if (recent.length) {
    host.append(el('h2', {}, 'Recent folders'));
    for (const r of recent) {
      host.append(el('button', { class: 'recent-item', onclick: () => setRoot(r) }, el('span', { class: 'rn' }, basename(r)), el('span', { class: 'rp' }, '\u200E' + r)));
    }
  }
  const keys = $('#welcome-keys');
  keys.replaceChildren();
  for (const [label, k] of [['Command palette', 'Mod+Shift+P'], ['Go to file', 'Mod+P'], ['Find in files', 'Mod+Shift+F'], ['Toggle terminal', 'Ctrl+`']]) {
    keys.append(el('dt', {}, label), el('dd', {}, el('kbd', {}, keyLabel(k))));
  }
}

// ---------- persistence ----------
let persistTimer = null, persistMaxTimer = null;
let restoringSession = true, closingSessionSnapshot = null, recoveryError = null;
function currentSession(options = {}) {
  for (const pane of groups.groups) savePaneView(pane);
  const snapshot = snapshotSession({ docs: S.docs, active: S.active, root: S.root, untitled: S.untitled, ...options });
  snapshot.layout = groups.serialize();
  const ids = new Set(snapshot.documents.map((d) => d.id));
  for (const group of snapshot.layout.groups) {
    group.documents = group.documents.filter((id) => ids.has(id));
    group.views = group.views.filter((v) => ids.has(v.document));
    if (!ids.has(group.active)) group.active = group.documents[0] || null;
  }
  return snapshot;
}
function recoveryFailure(error) {
  if (recoveryError !== error.message) toast(`Could not checkpoint unsaved edits: ${error.message}`, { error: true, ms: 8000 });
  recoveryError = error.message;
}
async function checkpointSession({ discard = false, discardUnsaved = false } = {}) {
  clearTimeout(persistTimer); clearTimeout(persistMaxTimer);
  persistTimer = persistMaxTimer = null;
  if (restoringSession) return;
  const snapshot = closingSessionSnapshot || currentSession({ discardUnsaved });
  try {
    await api.session.save(snapshot, { discard });
    recoveryError = null;
    await api.state.set({ root: S.root, recent: S.state.recent,
      files: snapshot.documents.map((d) => d.path).filter(Boolean), active: S.active?.path || null });
  } catch (error) { recoveryFailure(error); throw error; }
}
function persistSession() {
  if (restoringSession || closingSessionSnapshot) return;
  clearTimeout(persistTimer);
  const saveCheckpoint = () => checkpointSession().catch(() => {});
  persistTimer = setTimeout(saveCheckpoint, 400);
  persistMaxTimer ||= setTimeout(saveCheckpoint, 2000);
}
function persistUi() {
  api.state.set({ ui: { sidebarW: S.ui.sidebarW, termH: S.ui.termH, sidebar: S.ui.sidebar, terminal: S.ui.terminal } }).catch(() => {});
}

// ---------- window close ----------
async function requestWindowClose() {
  let discardUnsaved = false;
  const dirty = S.docs.filter((d) => d.buffer.dirty);
  if (dirty.length) {
    const choice = await api.dialog.confirm({
      message: dirty.length === 1 ? `Do you want to save the changes you made to ${dirty[0].name}?` : `You have ${dirty.length} files with unsaved changes.`,
      detail: 'Your changes will be lost if you don\'t save them.', buttons: ['Save All', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2,
    });
    if (choice === 2) return;
    discardUnsaved = choice === 1;
    if (choice === 0) {
      for (const d of dirty) if (!(await save(d))) return;
    }
  }
  for (const doc of S.docs) clearTimeout(doc._autoTimer);
  closingSessionSnapshot = currentSession({ discardUnsaved });
  try { await checkpointSession({ discard: discardUnsaved }); }
  catch { closingSessionSnapshot = null; return; }
  terminal.dispose();
  api.app.confirmClose();
}

// ---------- git ----------
function gitClass(doc) {
  if (!doc.path || !git || !git.isRepo) return '';
  const d = git.decor(doc.path, false);
  return d ? ` g-${d.cls}` : '';
}

function onGitChange({ headChanged } = {}) {
  explorer.render();
  renderTabs();
  updateStatus();
  const badge = document.querySelector('.view-btn[data-view="git"] .badge');
  if (badge) { const n = git.count; badge.hidden = !n; badge.textContent = n > 99 ? '99+' : String(n); }
  scheduleMarks(0);
  if (headChanged) scheduleBlame();
  refreshDiffDocs();
}

let marksTimer = null, marksSeq = 0;
function scheduleMarks(delay = 250) {
  clearTimeout(marksTimer);
  marksTimer = setTimeout(updateMarks, delay);
}
async function updateMarks() {
  const seq = ++marksSeq;
  await Promise.all(groups.groups.map(async (pane) => {
    const doc = pane.active;
    if (!doc?.path || doc.page || doc.readOnly || !git.isRepo) { pane.editor.setGutterMarks(null); return; }
    const version = doc.buffer.version;
    const marks = await git.markersFor(doc.path, doc.buffer.lines).catch(() => null);
    if (seq !== marksSeq || pane.active !== doc || doc.buffer.version !== version) return;
    pane.editor.setGutterMarks(marks);
  }));
}

// Inline blame for the cursor line, shown in the status bar.
let blameTimer = null, blameSeq = 0;
function timeAgo(sec) {
  const s = Math.max(1, Math.round(Date.now() / 1000 - sec));
  const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [n, name] of units) if (s >= n) { const v = Math.floor(s / n); return `${v} ${name}${v > 1 ? 's' : ''} ago`; }
  return 'just now';
}
function scheduleBlame() {
  clearTimeout(blameTimer);
  const doc = S.active;
  if (!S.settings.gitBlame || !doc || !doc.path || doc.readOnly || !git.isRepo) { if (S.blame) { S.blame = null; updateStatus(); } return; }
  blameTimer = setTimeout(async () => {
    const rel = git.toRel(doc.path);
    const entry = rel != null ? git.byPath.get(rel) : null;
    if (rel == null || (entry && (entry.cls === 'untracked' || entry.cls === 'ignored')) || !git.status.hasCommits) { S.blame = null; updateStatus(); return; }
    const seq = ++blameSeq;
    const line = statusState.line;
    const contents = doc.buffer.dirty && doc.buffer.lines.length < 20000 ? doc.buffer.getText() : undefined;
    let b = null;
    try { b = await api.git('blame', git.dir, rel, line, contents); } catch { b = null; }
    if (seq !== blameSeq || S.active !== doc) return;
    S.blame = b ? (b.uncommitted
      ? { text: 'You · Not committed yet', title: 'This line has not been committed.' }
      : { text: `${b.author}, ${timeAgo(b.time)} · ${b.summary}`, title: `${b.author} (${new Date(b.time * 1000).toLocaleString()})\n${b.sha.slice(0, 8)} ${b.summary}` }) : null;
    updateStatus();
  }, 350);
}

function shortGitError(msg) {
  const lines = String(msg).split('\n').map((l) => l.replace(/^(error|fatal|hint|warning):\s*/i, '').trim()).filter(Boolean);
  return lines.slice(0, 3).join(' ').slice(0, 320) || 'Git command failed.';
}

function needRepo() {
  if (!S.root) { toast('Open a folder first.'); return false; }
  if (!git.available) { toast(git.error || 'Git was not found. Install Git to use source control.', { error: true }); return false; }
  if (!git.isRepo) { toast('This folder is not a Git repository. Use "Git: Initialize Repository".'); return false; }
  return true;
}

// Run a git operation with a busy indicator, error toast and a status refresh afterwards.
async function gitDo(fn, { tree = false, ok } = {}) {
  gitPanel.setBusy(true);
  try {
    const r = await fn();
    await git.refresh();
    if (tree) { S.fileCache = null; explorer.refresh(); await checkExternalChanges(); }
    if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
    return { ok: true, value: r };
  } catch (err) {
    toast(shortGitError(err.message), { error: true, ms: 7000 });
    await git.refresh().catch(() => {});
    return { ok: false };
  } finally { gitPanel.setBusy(false); }
}

const gitStage = (paths) => (needRepo() ? gitDo(() => api.git('stage', git.dir, paths)) : null);
const gitUnstage = (paths) => (needRepo() ? gitDo(() => api.git('unstage', git.dir, paths)) : null);

async function gitDiscard(entries) {
  if (!needRepo() || !entries.length) return;
  const names = entries.length === 1 ? `"${basename(entries[0].path)}"` : `${entries.length} files`;
  const untracked = entries.some((e) => e.kind === 'untracked');
  const choice = await api.dialog.confirm({
    message: `Discard changes to ${names}?`,
    detail: untracked ? 'Untracked files will be deleted permanently. Other changes cannot be recovered either.' : 'This cannot be undone.',
    buttons: ['Discard Changes', 'Cancel'], defaultId: 1, cancelId: 1,
  });
  if (choice !== 0) return;
  await gitDo(() => api.git('discard', git.dir, {
    tracked: entries.filter((e) => e.kind !== 'untracked').map((e) => e.path),
    untracked: entries.filter((e) => e.kind === 'untracked').map((e) => e.path),
  }), { tree: true });
}

async function gitDiscardAll() {
  if (!needRepo()) return;
  const g = git.groups();
  const entries = [...g.conflicts, ...g.changes];
  if (!entries.length) { toast('There are no changes to discard.'); return; }
  const seen = new Set();
  await gitDiscard(entries.filter((e) => (seen.has(e.path) ? false : seen.add(e.path))));
}

async function gitCommit(message, { amend = false } = {}) {
  if (!needRepo()) return false;
  const g = git.groups();
  const hasStaged = g.staged.length > 0;
  const hasAny = hasStaged || g.changes.length > 0;
  if (g.conflicts.length) { toast('Resolve the merge conflicts before committing.', { error: true }); return false; }
  if (!hasStaged && !amend) {
    if (!hasAny) { toast('There is nothing to commit.'); return false; }
    const choice = await api.dialog.confirm({
      type: 'question', message: 'There are no staged changes.', detail: 'Stage all changes and commit them?',
      buttons: ['Stage All & Commit', 'Cancel'], defaultId: 0, cancelId: 1,
    });
    if (choice !== 0) return false;
  }
  const r = await gitDo(async () => {
    if (!hasStaged && !amend) await api.git('stage', git.dir, []);
    return api.git('commit', git.dir, message, { amend });
  }, { ok: (line) => (line ? `Committed: ${line}` : 'Committed') });
  return r.ok;
}

async function commitAllPrompt() {
  if (!needRepo()) return;
  const msg = await palette.prompt('Commit message (stages and commits all changes)');
  if (msg && msg.trim()) {
    const r = await gitDo(async () => { await api.git('stage', git.dir, []); return api.git('commit', git.dir, msg); }, { ok: (l) => `Committed: ${l}` });
    return r.ok;
  }
}

const gitPush = () => (needRepo() ? gitDo(() => api.git('push', git.dir), { ok: (r) => r || 'Pushed' }) : null);
const gitPull = () => (needRepo() ? gitDo(() => api.git('pull', git.dir), { tree: true, ok: (r) => r || 'Up to date' }) : null);
const gitFetch = () => (needRepo() ? gitDo(() => api.git('fetch', git.dir), { ok: 'Fetched' }) : null);
async function gitSync() {
  if (!needRepo()) return;
  const r = await gitPull();
  if (r && r.ok) await gitPush();
}
const gitStash = () => (needRepo() ? gitDo(() => api.git('stash', git.dir), { tree: true, ok: (r) => r || 'Stashed' }) : null);
const gitStashPop = () => (needRepo() ? gitDo(() => api.git('stashPop', git.dir), { tree: true, ok: 'Stash applied' }) : null);

async function gitInit() {
  if (!S.root) { toast('Open a folder first.'); return; }
  const r = await gitDo(() => api.git('init', git.dir || S.root), { ok: 'Initialized empty Git repository' });
  if (r.ok) git.setFolder(S.root);
}

async function pickBranch() {
  if (!needRepo()) return;
  let list;
  try { list = await api.git('branches', git.dir); } catch (err) { toast(shortGitError(err.message), { error: true }); return; }
  const localNames = new Set(list.filter((b) => !b.remote).map((b) => b.name));
  const items = [{ label: '+ Create new branch…', data: { create: true } }];
  for (const b of list) {
    if (b.remote && localNames.has(b.name.split('/').slice(1).join('/'))) continue;
    items.push({ label: b.name, detail: `${b.current ? 'current · ' : ''}${b.remote ? 'remote · ' : ''}${b.subject || ''}`, data: b });
  }
  const pick = await palette.pick(items, 'Switch to branch');
  if (!pick) return;
  if (pick.data.create) { await createBranch(); return; }
  if (pick.data.current) return;
  const target = pick.data.remote ? pick.data.name.split('/').slice(1).join('/') : pick.data.name;
  await gitDo(() => api.git('checkout', git.dir, target), { tree: true, ok: `Switched to ${target}` });
}

async function createBranch() {
  if (!needRepo()) return;
  const name = await palette.prompt('New branch name');
  if (!name || !name.trim()) return;
  await gitDo(() => api.git('createBranch', git.dir, name.trim()), { tree: true, ok: `Created and switched to ${name.trim()}` });
}

// ---- diff tabs ----
function setDocText(doc, text) {
  const b = doc.buffer;
  if (text === b.getText()) return;
  const end = { line: b.lineCount - 1, col: b.getLine(b.lineCount - 1).length };
  b.replace({ line: 0, col: 0 }, end, text, { record: false });
  b.undoStack.length = 0; b.redoStack.length = 0;
  b.markSaved();
  doc.resetTokens();
}

async function diffTextFor(entry, group) {
  const staged = group === 'staged';
  const untracked = entry.kind === 'untracked';
  let text = await api.git('diff', git.dir, entry.path, { staged, untracked });
  if (!text.trim()) text = `No ${staged ? 'staged ' : ''}changes to show for ${entry.path}.\n`;
  return text;
}

async function openDiff(entry, group) {
  if (!needRepo()) return;
  const key = `${group === 'staged' ? 'staged' : 'work'}:${entry.path}`;
  let text;
  try { text = await diffTextFor(entry, group); } catch (err) { toast(shortGitError(err.message), { error: true }); return; }
  let doc = S.docs.find((d) => d.diffKey === key);
  if (!doc) {
    doc = makeDoc({ name: `${basename(entry.path)} (${group === 'staged' ? 'Staged' : 'Changes'})`, text });
    doc.setLang('diff');
    doc.readOnly = true;
    doc.diffKey = key;
    doc.diffOf = { path: entry.path, kind: entry.kind, group: group === 'staged' ? 'staged' : 'changes' };
    doc.iconName = basename(entry.path);
    S.docs.push(doc);
  } else setDocText(doc, text);
  activate(doc);
}

async function openCurrentFileDiff() {
  const d = S.active;
  if (!needRepo() || !d || !d.path) return;
  const rel = git.toRel(d.path);
  const entry = rel != null ? git.byPath.get(rel) : null;
  if (!entry || entry.cls === 'ignored') { toast('This file has no changes.'); return; }
  const g = git.groups();
  const inChanges = g.changes.find((e) => e.path === rel) || g.conflicts.find((e) => e.path === rel);
  await openDiff(inChanges || g.staged.find((e) => e.path === rel) || entry, inChanges ? 'changes' : 'staged');
}

// Keep open diff tabs in step with the repository.
let diffRefreshSeq = 0;
async function refreshDiffDocs() {
  const docs = S.docs.filter((d) => d.diffOf);
  if (!docs.length || !git.isRepo) return;
  const seq = ++diffRefreshSeq;
  for (const d of docs) {
    try {
      const g = git.groups()[d.diffOf.group === 'staged' ? 'staged' : 'changes'];
      const entry = g.find((e) => e.path === d.diffOf.path) || { path: d.diffOf.path, kind: d.diffOf.kind };
      const text = await diffTextFor(entry, d.diffOf.group);
      if (seq !== diffRefreshSeq) return;
      setDocText(d, text);
      if (S.active === d) editor.scheduleRender();
    } catch { /* leave the old text */ }
  }
}

async function gitLog(forFile) {
  if (!needRepo()) return;
  let rel = null;
  if (forFile) {
    rel = S.active && S.active.path ? git.toRel(S.active.path) : null;
    if (rel == null) { toast('Open a file in this repository first.'); return; }
  }
  let commits;
  try { commits = await api.git('log', git.dir, { file: rel || undefined }); } catch (err) { toast(shortGitError(err.message), { error: true }); return; }
  if (!commits.length) { toast('No commits yet.'); return; }
  const items = commits.map((c) => ({ label: c.subject || '(no message)', detail: `${c.sha} · ${c.author} · ${c.date}${c.refs ? ' · ' + c.refs : ''}`, data: c }));
  const pick = await palette.pick(items, forFile ? `History of ${basename(rel)}` : 'Commit history');
  if (!pick) return;
  let text;
  try { text = await api.git('show', git.dir, pick.data.sha); } catch (err) { toast(shortGitError(err.message), { error: true }); return; }
  const key = `commit:${pick.data.sha}`;
  let doc = S.docs.find((d) => d.diffKey === key);
  if (!doc) {
    doc = makeDoc({ name: `${pick.data.sha} ${pick.data.subject}`.slice(0, 48), text });
    doc.setLang('diff'); doc.readOnly = true; doc.diffKey = key; doc.iconName = 'commit.diff';
    S.docs.push(doc);
  }
  activate(doc);
}

function gitRowMenu(x, y, entry, group) {
  const abs = git.toAbs(entry.path);
  const items = [
    { label: 'Open Changes', run: () => openDiff(entry, group) },
    { label: 'Open File', run: () => openFile(abs) },
    '-',
    group === 'staged'
      ? { label: 'Unstage Changes', run: () => gitUnstage([entry.path]) }
      : { label: 'Stage Changes', run: () => gitStage([entry.path]) },
  ];
  if (group !== 'staged') items.push({ label: 'Discard Changes…', run: () => gitDiscard([entry]) });
  items.push('-', { label: 'Reveal in Finder', run: () => api.fs.reveal(abs) }, { label: 'Copy Path', run: () => navigator.clipboard?.writeText(abs).catch(() => {}) });
  showMenu(x, y, items);
}

// ---------- extensions ----------
function fileInfo(doc) {
  return { path: doc.path, name: doc.name, language: doc.lang };
}

// What extensions can see and do in the active text editor. Every method is reached through the host,
// which has already checked the extension's permissions and validated the arguments.
const extEditor = (() => {
  const need = () => textDoc() || (() => { throw new Error('There is no active text editor.'); })();
  const writable = () => { const d = need(); if (d.readOnly) throw new Error('The active file is read-only.'); return d; };
  const nl = (t) => t.replace(/\r\n/g, '\n');
  const sel = (s) => {
    const a = startOf(s), e = endOf(s);
    return { anchor: { line: s.anchor.line, col: s.anchor.col }, head: { line: s.head.line, col: s.head.col }, start: { line: a.line, col: a.col }, end: { line: e.line, col: e.col }, text: nl(editor.buffer.getRange(a, e)), empty: a.line === e.line && a.col === e.col };
  };
  return {
    info() {
      const d = textDoc();
      return d ? { kind: 'text', path: d.path, name: d.name, language: d.lang, lineCount: d.buffer.lineCount, dirty: d.buffer.dirty, readOnly: !!d.readOnly } : null;
    },
    text: () => nl(need().buffer.getText()),
    line: (n) => { const d = need(); if (n >= d.buffer.lineCount) throw new Error(`The file has only ${d.buffer.lineCount} lines.`); return d.buffer.getLine(n).replace(/\r$/, ''); },
    selections: () => { need(); return editor.sels.map(sel); },
    replaceSelections(texts) {
      writable();
      const n = editor.sels.length;
      if (texts.length !== 1 && texts.length !== n) throw new Error(`There are ${n} selections but ${texts.length} replacements were given.`);
      // Text that replaced a selection stays selected (so commands can be chained); a bare cursor ends up after what was inserted.
      editor.applyPlans((s, i) => {
        const text = texts.length === 1 ? texts[0] : texts[i];
        const plan = { a: startOf(s), b: endOf(s), text };
        if (!isEmpty(s)) {
          const parts = text.split('\n');
          plan.anchor = { line: 0, col: 0 };
          plan.head = { line: parts.length - 1, col: parts[parts.length - 1].length };
        }
        return plan;
      }, null);
      editor.buffer.sealUndo();
      return null;
    },
    setText(text) {
      const d = writable();
      const b = d.buffer;
      editor.edit({ line: 0, col: 0 }, { line: b.lineCount - 1, col: b.getLine(b.lineCount - 1).length }, text);
      b.sealUndo();
      return null;
    },
    replaceRange(start, end, text) {
      const d = writable();
      editor.edit(d.buffer.clampPos(start), d.buffer.clampPos(end), text);
      d.buffer.sealUndo();
      return null;
    },
    setSelections(list) {
      const d = need();
      const sels = list.map((s) => ({ anchor: d.buffer.clampPos(s.anchor), head: d.buffer.clampPos(s.head) }));
      editor.commitSels(sels, sels[sels.length - 1]);
      return null;
    },
  };
})();

function runExtCommand(full, args = []) {
  return extHost.runCommand(full, args).catch((err) => {
    if (err.message !== 'The command timed out.') toast(`${extHost.commands.get(full)?.title || 'Command'}: ${err.message}`, { error: true, ms: 6000 });
  });
}

// Called whenever extensions load, stop or change what they contribute.
function onExtChange() {
  clearExtensionSnippets();
  const byExt = new Map();
  for (const g of extHost.snippets) { if (!byExt.has(g.extId)) byExt.set(g.extId, []); byExt.get(g.extId).push({ language: g.language, snippets: g.snippets }); }
  for (const [id, groups] of byExt) setExtensionSnippets(id, groups);
  updateStatus();
}

async function reloadExtensions(announce = false) {
  forgetIcons();
  await extHost.reload();
  await extPanel.refresh();
  refreshPages();
  applySettings();
  const n = [...extHost.exts.values()].filter((e) => e.enabled && e.manifest).length;
  if (announce) toast(`Reloaded ${n} extension${n === 1 ? '' : 's'}.`);
}

function refreshPages() {
  for (const d of S.docs) if (d.page && d.pageApi && d.pageApi.refresh) d.pageApi.refresh();
}

const extItem = (id) => extPanel.installed.find((e) => e.id === id) || null;
const extEntry = (id) => extPanel.catalog.find((c) => c.id === id) || null;

async function confirmPermissions({ name, publisher, permissions, verb = 'Install', added = null, source = '' }) {
  const lines = (permissions.length ? permissions : []).map((p) => `• ${PERMISSION_TEXT[p] || p}`);
  let detail = permissions.length
    ? `${name} would be able to:\n${lines.join('\n')}`
    : `${name} needs no special permissions. It cannot read or change your files.`;
  if (added && added.length) detail = `${name} now also asks to:\n${added.map((p) => `• ${PERMISSION_TEXT[p] || p}`).join('\n')}\n\n${detail}`;
  detail += `\n\nExtensions run in a sandbox with no network access.${source ? `\nSource: ${source}` : ''}`;
  const choice = await api.dialog.confirm({
    type: 'question', message: `${verb} "${name}"${publisher ? ` by ${publisher}` : ''}?`, detail, buttons: [verb, 'Cancel'], defaultId: 0, cancelId: 1,
  });
  return choice === 0;
}

function reviewExtensionUpdates() {
  showView('ext', true);
  extPanel.showUpdates();
}

function updateNotice(entries) {
  const message = entries.length === 1 ? `${entries[0].name} ${entries[0].version} is available.` : `${entries.length} extension updates are available.`;
  toast(message, { ms: 10000, action: { label: 'Review updates', run: reviewExtensionUpdates } });
}

function checkExtensionUpdates(manual = false) {
  if (manual) manualUpdateCheck = true;
  if (extensionUpdateCheck) return extensionUpdateCheck;
  extensionUpdateCheck = (async () => {
    try {
      const result = await extPanel.refresh({ force: true });
      if (manualUpdateCheck) {
        if (result?.error) toast(`Could not check extension updates: ${result.error}`, { error: true, ms: 7000 });
        else if (extensionUpdates.updates.length) updateNotice(extensionUpdates.updates);
        else toast('All installed extensions are up to date.');
      }
      return result;
    } finally { extensionUpdateCheck = null; manualUpdateCheck = false; }
  })();
  return extensionUpdateCheck;
}

async function afterExtChange() {
  forgetIcons();
  await extHost.reload();
  await extPanel.refresh();
  refreshPages();
  applySettings();
}

async function installExtension(entry, { skipConfirm = false } = {}) {
  if (!entry) return false;
  if (!skipConfirm && !(await confirmPermissions({ name: entry.name, publisher: entry.publisher, permissions: entry.permissions, source: entry.source === 'registry' ? 'your extension registry' : 'bundled with SunlightIDE' }))) return false;
  try { await api.ext('install', entry.id, { version: entry.version, permissions: entry.permissions, source: entry.source, downloadUrl: entry.downloadUrl, sha256: entry.sha256 }); } catch (err) { toast(`Could not install ${entry.name}: ${err.message}`, { error: true, ms: 8000 }); return false; }
  await afterExtChange();
  toast(`Installed ${entry.name}.`);
  return true;
}

async function updateExtension(entry, { skipConfirm = false } = {}) {
  if (!entry) return false;
  const old = extItem(entry.id);
  const added = entry.permissions.filter((p) => !(old && old.manifest && old.manifest.permissions.includes(p)));
  if (!skipConfirm && added.length && !(await confirmPermissions({ name: entry.name, publisher: entry.publisher, permissions: entry.permissions, verb: 'Update', added }))) return false;
  try { await api.ext('install', entry.id, { version: entry.version, permissions: entry.permissions, source: entry.source, downloadUrl: entry.downloadUrl, sha256: entry.sha256 }); } catch (err) { toast(`Could not update ${entry.name}: ${err.message}`, { error: true, ms: 8000 }); return false; }
  await afterExtChange();
  toast(`Updated ${entry.name} to ${entry.version}.`);
  return true;
}

async function uninstallExtension(item, { skipConfirm = false } = {}) {
  if (!item) return false;
  const name = item.manifest ? item.manifest.name : item.id;
  if (!skipConfirm) {
    const choice = await api.dialog.confirm({
      message: `${item.source === 'dev' ? 'Remove' : 'Uninstall'} "${name}"?`,
      detail: item.source === 'dev' ? 'The folder on disk is not deleted; it just stops loading.' : 'Its settings and stored data are deleted too.',
      buttons: [item.source === 'dev' ? 'Remove' : 'Uninstall', 'Cancel'], defaultId: 1, cancelId: 1,
    });
    if (choice !== 0) return false;
  }
  try { await api.ext('uninstall', item.id); } catch (err) { toast(err.message, { error: true }); return false; }
  if (S.settings.colorTheme.startsWith(item.id + ':')) await updateSettings({ colorTheme: '' });
  await afterExtChange();
  toast(`${item.source === 'dev' ? 'Removed' : 'Uninstalled'} ${name}.`);
  return true;
}

async function toggleExtension(id, on) {
  try { await api.ext('setEnabled', id, on); } catch (err) { toast(err.message, { error: true }); return; }
  await afterExtChange();
}

async function installFromFolder() {
  let dir;
  try { dir = await api.dialog.openFolder(); } catch (err) { toast(err.message, { error: true }); return; }
  if (!dir) return;
  let m;
  try { m = await api.ext('inspectFolder', dir); } catch (err) { toast(err.message, { error: true, ms: 8000 }); return; }
  const choice = await api.dialog.confirm({
    type: 'question', message: `Add "${m.name}"?`,
    detail: `${m.permissions.length ? 'It would be able to:\n' + m.permissions.map((p) => '• ' + (PERMISSION_TEXT[p] || p)).join('\n') : 'It needs no special permissions.'}\n\n"Load for Development" runs it straight from the folder, so your edits apply after Reload Extensions. "Install a Copy" copies it into SunlightIDE.`,
    buttons: ['Load for Development', 'Install a Copy', 'Cancel'], defaultId: 0, cancelId: 2,
  });
  if (choice === 2) return;
  try { await api.ext(choice === 0 ? 'addDev' : 'installFolder', dir); } catch (err) { toast(err.message, { error: true, ms: 8000 }); return; }
  await afterExtChange();
  toast(`${choice === 0 ? 'Loaded' : 'Installed'} ${m.name}.`);
}

async function installFromZip() {
  let file;
  try { file = await api.pickFile([{ name: 'Extension', extensions: ['zip'] }]); } catch (err) { toast(err.message, { error: true }); return; }
  if (!file) return;
  let m;
  try { m = await api.ext('inspectZip', file); } catch (err) { toast(err.message, { error: true, ms: 8000 }); return; }
  if (!(await confirmPermissions({ name: m.name, publisher: m.publisher, permissions: m.permissions, source: file }))) return;
  try { await api.ext('installZip', file); } catch (err) { toast(err.message, { error: true, ms: 8000 }); return; }
  await afterExtChange();
  toast(`Installed ${m.name}.`);
}

async function createExtension() {
  const name = await palette.prompt('Extension name (for example "Line Tools")');
  if (!name || !name.trim()) return;
  const publisher = await palette.prompt('Publisher (your name or company)', 'me');
  if (!publisher || !publisher.trim()) return;
  let parent;
  try { parent = await api.dialog.openFolder(); } catch (err) { toast(err.message, { error: true }); return; }
  if (!parent) return;
  let made;
  try { made = await api.ext('scaffold', parent, { name: name.trim(), publisher: publisher.trim() }); await api.ext('addDev', made.dir); } catch (err) { toast(err.message, { error: true, ms: 8000 }); return; }
  await afterExtChange();
  await setRoot(made.dir);
  await openFile(made.dir + '/index.js');
  toast(`Created ${made.id}. Open the command palette and run "Say Hello".`, { ms: 6000 });
}

async function packageExtension() {
  let dir = S.root && extPanel.installed.some((e) => e.dir === S.root || (e.source === 'dev' && S.root.startsWith(e.dir))) ? S.root : null;
  if (!dir) {
    try { dir = await api.dialog.openFolder(); } catch (err) { toast(err.message, { error: true }); return; }
    if (!dir) return;
  }
  let m;
  try { m = await api.ext('inspectFolder', dir); } catch (err) { toast(err.message, { error: true, ms: 8000 }); return; }
  let out;
  try { out = await api.saveFile(`${dir}/../${m.id}-${m.version}.zip`.replace(/\/[^/]+\/\.\./, ''), [{ name: 'Zip archive', extensions: ['zip'] }]); } catch (err) { toast(err.message, { error: true }); return; }
  if (!out) return;
  try {
    const r = await api.ext('package', dir, out);
    toast(`Packaged ${r.files} files (${Math.round(r.bytes / 1024)} KB). SHA-256: ${r.sha256.slice(0, 16)}…`, { ms: 8000 });
    api.fs.reveal(r.file);
    navigator.clipboard?.writeText(r.sha256).catch(() => {});
  } catch (err) { toast(err.message, { error: true, ms: 8000 }); }
}

async function setRegistryUrl() {
  let current = '';
  try { current = await api.ext('getRegistry'); } catch { /* none */ }
  const url = await palette.prompt('Extension registry URL (https://…, empty to remove)', current);
  if (url === null) return;
  try { await api.ext('setRegistry', url.trim()); } catch (err) { toast(err.message, { error: true, ms: 7000 }); return; }
  await extPanel.refresh({ force: true });
  toast(url.trim() ? 'Registry saved.' : 'Registry removed.');
}

function showExtensionLog() {
  const text = extHost.logLines.length ? extHost.logLines.join('\n') : 'No extension messages yet.';
  let doc = S.docs.find((d) => d.logDoc);
  if (!doc) {
    doc = makeDoc({ name: 'Extension Log', text });
    doc.readOnly = true; doc.logDoc = true; doc.iconName = 'log.log';
    S.docs.push(doc);
  } else setDocText(doc, text);
  activate(doc);
  editor.gotoLine(doc.buffer.lineCount - 1, 0);
}

async function pickColorTheme() {
  const items = [
    { label: 'Light', detail: 'Built in', data: { theme: 'light', colorTheme: '' } },
    { label: 'Dark', detail: 'Built in', data: { theme: 'dark', colorTheme: '' } },
    { label: 'Match System', detail: 'Built in', data: { theme: 'system', colorTheme: '' } },
  ];
  for (const t of extHost.themes) {
    const rec = extHost.get(t.extId);
    if (rec && rec.enabled) items.push({ label: t.label, detail: `${t.type} · ${rec.manifest.name}`, data: { colorTheme: t.key } });
  }
  const pick = await palette.pick(items, 'Select a colour theme');
  if (pick) await updateSettings(pick.data);
}

// ---- page tabs ----
function openPage(key, { name, iconHtml, iconName, build }) {
  let doc = S.docs.find((d) => d.pageKey === key);
  if (!doc) {
    doc = makeDoc({ name, text: '' });
    doc.readOnly = true;
    doc.page = { build };
    doc.pageKey = key;
    doc.iconHtml = iconHtml;
    doc.iconName = iconName;
    S.docs.push(doc);
  }
  activate(doc);
  return doc;
}

async function openDocsPage() {
  let markdown;
  try { markdown = await api.ext('docs'); } catch (err) { toast(`The guide could not be loaded: ${err.message}`, { error: true }); return null; }
  return openPage('docs', {
    name: 'Extension Developer Guide', iconName: 'README.md',
    build: (el) => buildDocsPage(el, {
      markdown,
      hooks: {
        run: (id) => { if (commandById.has(id)) runCommand(id); else toast(`Unknown command "${id}".`, { error: true }); },
        link: (url) => window.open(url),
        copy: copyWithFeedback,
      },
    }),
  });
}

async function copyWithFeedback(text, button) {
  const ok = await copyText(text);
  if (button) { const old = button.textContent; button.textContent = ok ? 'Copied' : 'Press ⌘C'; setTimeout(() => { button.textContent = old; }, 1400); }
}

async function openExtensionPage(id) {
  if (!extPanel.catalog.length && !extPanel.installed.length) await extPanel.refresh();
  const item = extItem(id), entry = extEntry(id);
  const name = (item && item.manifest && item.manifest.name) || (entry && entry.name) || id;
  return openPage(`ext:${id}`, {
    name, iconHtml: avatarHtml(id, name, 'tiny'),
    build: (el) => buildExtensionPage(el, {
      id,
      data: async () => ({ entry: extEntry(id), item: extItem(id) }),
      currentTheme: () => S.settings.colorTheme,
      hooks: {
        install: (entry) => installExtension(entry),
        update: (entry) => updateExtension(entry),
        uninstall: (item) => uninstallExtension(item),
        toggle: (extId, on) => toggleExtension(extId, on),
        useTheme: async (key) => { await updateSettings({ colorTheme: key }); refreshPages(); },
        link: (url) => { if (/^https?:|^mailto:/.test(url)) window.open(url); },
        copy: copyWithFeedback,
      },
    }),
  });
}

// ---------- init ----------
async function init() {
  if (IS_MAC) document.body.classList.add('mac');

  const [settings, state, info, recovery] = await Promise.all([api.settings.get(), api.state.get(), api.info(), api.session.get()]);
  Object.assign(S.settings, settings);
  Object.assign(S.state, state);
  Object.assign(S.ui, state.ui || {});
  S.info = info;

  // icons
  const setIcon = (sel, name, cls) => { const n = $(sel); if (n) n.innerHTML = icon(name, cls); };
  setIcon('#btn-sidebar', 'sidebar'); setIcon('#btn-terminal', 'terminal'); setIcon('#btn-palette', 'command');
  setIcon('#tb-search-icon', 'search', 'sm'); setIcon('#btn-settings', 'settings');
  $$('.view-btn').forEach((b) => { b.innerHTML = icon({ explorer: 'files', search: 'search', git: 'branch', ext: 'puzzle' }[b.dataset.view]) + (b.dataset.view === 'git' ? '<span class="badge" hidden></span>' : ''); });
  setIcon('#ex-new-file', 'newfile', 'sm'); setIcon('#ex-new-folder', 'newfolder', 'sm');
  setIcon('#ex-refresh', 'refresh', 'sm'); setIcon('#ex-collapse', 'collapse', 'sm');

  // components
  palette = new Palette($('#overlay'));
  $('#find-host').classList.add('find-host');
  createPane(activePane, $('#pane-left'));
  ({ editor, minimap, findWidget, pageHost, language: languageIntelligence } = activePane);
  extHost = new ExtensionHost({
    api,
    toast,
    input: ({ prompt, value }) => palette.prompt(prompt, value),
    pick: async (items, placeholder) => palette.pick(items.map((it) => ({ label: it.label, detail: it.detail, data: it })), placeholder).then((r) => (r ? r.data : null)),
    editor: extEditor,
    root: () => S.root,
    onChange: () => onExtChange(),
  });
  extPanel = new ExtensionsPanel($('#panel-ext'), {
    open: (id) => openExtensionPage(id),
    install: (entry) => installExtension(entry),
    update: (entry) => updateExtension(entry),
    uninstall: (item) => uninstallExtension(item),
    toggle: (id, on) => toggleExtension(id, on),
    reload: (force) => force ? checkExtensionUpdates(true) : extPanel.refresh(),
    refreshed: (result) => extensionUpdates?.observe(result, { notifications: S.settings.extensionUpdateNotifications || manualUpdateCheck }),
    menu: (x, y) => showMenu(x, y, [
      { label: 'Check for Updates', run: () => checkExtensionUpdates(true) },
      { label: 'Review Updates', run: () => reviewExtensionUpdates() },
      '-',
      { label: 'Install from Folder…', run: () => installFromFolder() },
      { label: 'Install from .zip…', run: () => installFromZip() },
      { label: 'Set Registry URL…', run: () => setRegistryUrl() },
      '-',
      { label: 'Create Extension…', run: () => createExtension() },
      { label: 'Package Extension…', run: () => packageExtension() },
      { label: 'Reload Extensions', run: () => reloadExtensions(true) },
      { label: 'Show Extension Log', run: () => showExtensionLog() },
      '-',
      { label: 'Extension Developer Guide', run: () => openDocsPage() },
    ]),
    itemMenu: (x, y, id) => {
      const item = extItem(id);
      const items = [{ label: 'Details', run: () => openExtensionPage(id) }];
      if (item && item.manifest) {
        items.push({ label: item.enabled ? 'Disable' : 'Enable', run: () => toggleExtension(id, !item.enabled) });
        items.push({ label: item.source === 'dev' ? 'Remove' : 'Uninstall', run: () => uninstallExtension(item) });
        items.push('-', { label: 'Reveal in Finder', run: () => api.fs.reveal(item.dir) });
      }
      items.push({ label: 'Copy Extension ID', run: () => navigator.clipboard?.writeText(id).catch(() => {}) });
      showMenu(x, y, items);
    },
  });
  extensionUpdates = new ExtensionUpdateTracker({
    seen: state.extensionUpdatesSeen,
    persist: (seen) => { S.state.extensionUpdatesSeen = seen; api.state.set({ extensionUpdatesSeen: seen }).catch(() => {}); },
    notify: (updates) => { if (!manualUpdateCheck) updateNotice(updates); },
    change: (updates) => {
      const button = $('[data-view="ext"]');
      let badge = button.querySelector('.badge');
      if (!badge) { badge = el('span', { class: 'badge' }); button.append(badge); }
      badge.hidden = !updates.length; badge.textContent = String(updates.length);
      button.setAttribute('aria-label', updates.length ? `Extensions, ${updates.length} updates available` : 'Extensions');
      button.title = updates.length ? `Extensions (${updates.length} updates available)` : 'Extensions';
    },
  });
  terminal = new TerminalPanel($('#terminal'));
  terminal.onClose = () => setTerminal(false);
  git = new GitState();
  explorer = new Explorer(
    { tree: $('#tree'), title: $('#explorer-title'), empty: $('#explorer-empty') },
    {
      openFile: (p) => openFile(p),
      decor: (p, isDir) => git.decor(p, isDir),
      confirm: (o) => api.dialog.confirm(o),
      renamed: (from, to) => {
        for (const d of S.docs) {
          if (d.path === from || d.path?.startsWith(from + '/')) {
            d.path = to + d.path.slice(from.length);
            d.name = basename(d.path);
            const lang = languageForFile(d.name);
            if (lang !== d.lang) d.setLang(lang);
          }
        }
        S.fileCache = null;
        renderTabs(); updateStatus(); updateTitle(); persistSession();
      },
      deleted: (p) => {
        S.fileCache = null;
        for (const d of [...S.docs]) if ((d.path === p || d.path?.startsWith(p + '/')) && !d.buffer.dirty) closeDoc(d, null, true);
      },
    },
  );
  gitPanel = new GitPanel($('#panel-git'), git, {
    refresh: () => git.refresh(),
    stage: (paths) => gitStage(paths),
    unstage: (paths) => gitUnstage(paths),
    discard: (entries) => gitDiscard(entries),
    discardAll: () => gitDiscardAll(),
    commit: (msg, opts) => gitCommit(msg, opts),
    push: () => gitPush(),
    pull: () => gitPull(),
    init: () => gitInit(),
    branchPicker: () => pickBranch(),
    openFolder: () => openFolderDialog(),
    openDiff: (entry, group) => openDiff(entry, group),
    openFile: (entry) => openFile(git.toAbs(entry.path)),
    rowMenu: (x, y, entry, group) => gitRowMenu(x, y, entry, group),
  });
  git.onChange(onGitChange);
  searchPanel = new SearchPanel($('#panel-search'), {
    getRoot: () => S.root,
    openAt: (rel, line, col, len) => openFile(joinPath(S.root, rel), { line, col, len }),
  });

  const paneSash = $('#sash-editors');
  paneSash.setAttribute('aria-valuemin', '25'); paneSash.setAttribute('aria-valuemax', '75');
  makeSash(paneSash, { axis: 'x', min: () => $('#editor-panes').clientWidth * 0.25,
    max: () => $('#editor-panes').clientWidth * 0.75,
    get: () => groups.groups[0].root.getBoundingClientRect().width,
    set: (width) => setSplitRatio(width / $('#editor-panes').clientWidth), onDone: persistSession });
  paneSash.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) { e.preventDefault(); setSplitRatio(e.key === 'Home' ? 0.5 : groups.ratio + (e.key === 'ArrowLeft' ? -0.05 : 0.05)); persistSession(); }
  });
  paneSash.addEventListener('dblclick', () => { setSplitRatio(0.5); persistSession(); });

  // layout restore
  $('#sidebar').style.width = S.ui.sidebarW + 'px';
  $('#terminal').style.height = S.ui.termH + 'px';
  makeSash($('#sash-sidebar'), {
    axis: 'x', min: 180, max: () => window.innerWidth * 0.5, get: () => $('#sidebar').offsetWidth,
    set: (v) => { S.ui.sidebarW = v; $('#sidebar').style.width = v + 'px'; }, onDone: persistUi,
  });
  makeSash($('#sash-terminal'), {
    axis: 'y', invert: true, min: 90, max: () => window.innerHeight * 0.7, get: () => $('#terminal').offsetHeight,
    set: (v) => { S.ui.termH = v; $('#terminal').style.height = v + 'px'; }, onDone: persistUi,
  });
  setSidebar(S.ui.sidebar !== false);
  const reopenTerminal = !!S.ui.terminal; // opened after the folder is restored so the shell starts in the project
  setTerminal(false);

  // buttons
  $('#btn-sidebar').onclick = () => setSidebar(!S.ui.sidebar);
  $('#btn-terminal').onclick = () => setTerminal(!S.ui.terminal);
  $('#btn-palette').onclick = () => openPalette('>');
  $('#btn-quick').onclick = () => openPalette('');
  $('#btn-settings').onclick = () => openSettings();
  $$('.view-btn').forEach((b) => { b.onclick = () => { (S.ui.view === b.dataset.view && S.ui.sidebar) ? setSidebar(false) : showView(b.dataset.view, true); }; });
  $('#ex-new-file').onclick = () => explorer.startCreate('file');
  $('#ex-new-folder').onclick = () => explorer.startCreate('folder');
  $('#ex-refresh').onclick = () => { S.fileCache = null; explorer.refresh(); };
  $('#ex-collapse').onclick = () => explorer.collapseAll();
  $('#ex-open-folder').onclick = $('#w-open-folder').onclick = () => openFolderDialog();
  $('#w-new-file').onclick = () => newUntitled();
  $('#statusbar').addEventListener('click', (e) => {
    const x = e.target.closest('[data-ext]');
    if (x) {
      const item = extHost.statusItems.get(x.dataset.ext);
      if (item && item.command) runExtCommand(item.command);
      return;
    }
    const b = e.target.closest('[data-act]');
    if (b) runCommand(b.dataset.act);
  });

  // menu, close, focus, fs events
  api.app.onMenu((cmd) => runCommand(cmd));
  api.app.onRequestClose(requestWindowClose);
  window.addEventListener('focus', () => { checkExternalChanges(); git.refresh(); });
  api.fs.onChanged((dirs) => {
    S.fileCache = null;
    explorer.refresh(dirs);
    git.scheduleRefresh();
  });

  // drag files/folders from Finder onto the window
  window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    for (const f of e.dataTransfer.files) {
      const p = api.pathForFile(f);
      if (!p) continue;
      if (await api.fs.isDir(p)) await setRoot(p); else await openFile(p);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!$('#overlay').hidden || !(IS_MAC ? e.metaKey : e.ctrlKey)) return;
    const plain = !e.altKey && !e.shiftKey;
    const command = e.key === '\\' ? 'split-editor' : plain && e.key === '1' ? 'focus-left-editor' : plain && e.key === '2' ? 'focus-right-editor' : null;
    if (command) { e.preventDefault(); e.stopPropagation(); runCommand(command); }
  }, true);

  // Extension keyboard shortcuts. Capturing at the window means they work wherever focus is, but they are
  // skipped while a dialog is open so typing in the palette is never hijacked.
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !extHost.keybindings.length || !$('#overlay').hidden) return;
    const full = extHost.matchKey(e, IS_MAC);
    if (full) { e.preventDefault(); e.stopPropagation(); runExtCommand(full); }
  }, true);

  try { await extHost.start(); } catch (err) { console.error('extensions failed to start', err); }
  applySettings();
  renderWelcome();
  updateStatus();
  updateTitle();

  // Do not checkpoint the partially restored tab list.
  const snapshot = recovery.snapshot;
  const lastRoot = snapshot ? snapshot.root : state.root;
  if (lastRoot) {
    await setRoot(lastRoot, { silent: true });
    if (explorer.children.get(lastRoot)?.length === 0 && !(await api.fs.mtime(lastRoot))) await setRoot(null);
  } else terminal.setCwd(info.home);
  let recoveredCount = 0, changedOnDisk = 0, missingCount = 0;
  if (snapshot) {
    S.untitled = Number.isInteger(snapshot.untitled) ? Math.max(0, snapshot.untitled) : 0;
    for (const saved of snapshot.documents) {
      let disk = null;
      if (saved.path) try { disk = await api.fs.readFile(saved.path); } catch { /* missing file can still have a draft */ }
      const draft = typeof saved.text === 'string';
      if (!draft && (!disk || typeof disk.text !== 'string')) { missingCount++; continue; }
      const doc = makeDoc({ path: saved.path, name: saved.name, text: draft ? saved.text : disk.text, mtime: disk?.mtime || null });
      doc.recoveryId = saved.id;
      if (LANGUAGE_NAMES[saved.lang]) doc.setLang(saved.lang);
      if (saved.indent && [2, 4, 8].includes(saved.indent.tabSize)) doc.indent = { tabSize: saved.indent.tabSize, insertSpaces: saved.indent.insertSpaces !== false };
      doc.view = restoredView(saved.view, doc.buffer);
      if (saved.dirty) { doc.buffer.savedVersion = -1; doc._wasDirty = true; recoveredCount++; }
      if (saved.dirty && saved.path && disk && saved.mtime && Math.abs(disk.mtime - saved.mtime) > 1) changedOnDisk++;
      S.docs.push(doc);
      const draftNumber = /^Untitled-(\d+)$/.exec(doc.name);
      if (draftNumber) S.untitled = Math.max(S.untitled, Number(draftNumber[1]));
    }
    const layout = snapshot.layout;
    if (Array.isArray(layout?.groups) && layout.groups.length === 2) ensureSplit();
    const byId = new Map(S.docs.map((d) => [d.recoveryId, d]));
    for (const pane of groups.groups) {
      const savedGroup = layout?.groups?.find((g) => g.id === pane.id);
      pane.docs = savedGroup ? [...new Set((savedGroup.documents || []).map((id) => byId.get(id)).filter(Boolean))] : pane.id === 'left' ? [...S.docs] : [];
      for (const item of savedGroup?.views || []) { const doc = byId.get(item.document); if (doc) pane.views.set(doc, restoredView(item.view, doc.buffer)); }
      const selected = byId.get(savedGroup?.active) || (pane.id === 'left' ? byId.get(snapshot.active) : null) || pane.docs[0];
      if (selected && pane.docs.includes(selected)) setPaneDocument(pane, selected);
    }
    for (const doc of S.docs) if (!groups.owners(doc).length) groups.groups[0].docs.push(doc);
    if (layout) setSplitRatio(layout.ratio);
    const selectedPane = groups.groups.find((g) => g.id === layout?.activeGroup) || groups.groups[0];
    focusPane(selectedPane, false);
    if (selectedPane.active) activate(selectedPane.active, selectedPane);
    else { S.active = null; renderTabs(); }

  } else {
    for (const f of state.files || []) await openFile(f).catch(() => {});
    const selected = S.docs.find((d) => d.path === state.active);
    if (selected && selected !== S.active) activate(selected);
  }
  restoringSession = false;
  if (recovery.warning) toast(recovery.warning, { error: true, ms: 8000 });
  if (recoveredCount) toast(`Recovered unsaved edits in ${recoveredCount} tab${recoveredCount === 1 ? '' : 's'}.${changedOnDisk ? ` ${changedOnDisk} files also changed on disk; review before saving.` : ''}`, { ms: 10000 });
  if (missingCount) toast(`${missingCount} saved file${missingCount === 1 ? '' : 's'} could not be reopened.`, { ms: 8000 });
  persistSession();
  window.addEventListener('beforeunload', () => {
    if (restoringSession) return;
    clearTimeout(persistTimer); clearTimeout(persistMaxTimer);
    try { api.session.flush(closingSessionSnapshot || currentSession(), { discard: !!closingSessionSnapshot }); }
    catch (error) { console.error('Final recovery checkpoint failed', error); }
  });
  if (!S.docs.length) activePane.welcome.hidden = false;
  if (reopenTerminal) setTerminal(true);
  document.body.dataset.ready = '1';
  finishBoot();
  setTimeout(() => checkExtensionUpdates().catch(() => {}), 3000);
  const updateTimer = setInterval(() => checkExtensionUpdates().catch(() => {}), 30 * 60 * 1000);
  let lastUpdateFocus = Date.now();
  const onUpdateFocus = () => {
    if (Date.now() - lastUpdateFocus < 5 * 60 * 1000) return;
    lastUpdateFocus = Date.now(); checkExtensionUpdates().catch(() => {});
  };
  window.addEventListener('focus', onUpdateFocus);
  window.addEventListener('beforeunload', () => { clearInterval(updateTimer); window.removeEventListener('focus', onUpdateFocus); });
}

// Fade the splash once the app is ready, but never flash it for less than ~450ms.
function finishBoot() {
  const wait = Math.max(0, 450 - (performance.now() - bootStart));
  setTimeout(() => {
    $('#app').classList.add('booted');
    const splash = $('#splash');
    if (!splash) return;
    splash.classList.add('done');
    setTimeout(() => splash.remove(), 700);
  }, wait);
}

// Expose a tiny hook so automated checks can drive the app.
window.__sunlight = { S, groups, splitEditor, moveEditor, focusPane, joinEditors, setSplitRatio, checkpointSession, closeDoc, requestWindowClose, checkExtensionUpdates, get extensionUpdates() { return extensionUpdates; }, get languageIntelligence() { return languageIntelligence; }, get extHost() { return extHost; }, get extPanel() { return extPanel; }, installExtension, updateExtension, uninstallExtension, toggleExtension, openExtensionPage, openDocsPage, reloadExtensions, afterExtChange, pickColorTheme, runExtCommand, showExtensionLog, textDoc, get git() { return git; }, get gitPanel() { return gitPanel; }, openDiff, gitCommit, pickBranch, get editor() { return editor; }, get explorer() { return explorer; }, get terminal() { return terminal; }, openFile, newUntitled, runCommand, commands, setRoot, save, activate };

init().catch((err) => {
  console.error(err);
  document.getElementById('splash')?.remove();
  document.getElementById('app')?.classList.add('booted');
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;background:#fff;color:#b00;padding:16px;z-index:999;user-select:text">SunlightIDE failed to start:\n${escapeHtml(String(err.stack || err))}</pre>`);
});
