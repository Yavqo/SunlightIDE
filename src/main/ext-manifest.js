'use strict';
// Extension manifest validation. Pure functions, shared by the installer and the tests.
// An extension is a folder with a manifest.json; see docs/extensions.md for the full reference.

const API_VERSION = 1;

const PERMISSIONS = {
  'editor.read': 'Read the text, selections and language of the file you are editing',
  'editor.write': 'Change the text of the file you are editing',
  'workspace.read': 'Read files inside the folder you have open',
  'workspace.write': 'Create and change files inside the folder you have open',
  storage: 'Remember small amounts of data between sessions',
};

// Friendly colour names an extension theme may set, mapped to the CSS variables they control.
const THEME_COLORS = {
  background: ['--bg'],
  sidebar: ['--bg-side'],
  foreground: ['--fg'],
  mutedForeground: ['--fg-muted'],
  accent: ['--link', '--y-blue', '--y-blue-hover', '--y-blue-focus'],
  border: ['--line'],
  editorBackground: ['--editor-bg'],
  editorForeground: ['--editor-fg'],
  selection: ['--selection'],
  lineHighlight: ['--curline'],
  gutterForeground: ['--gutter-fg'],
  terminalBackground: ['--term-bg'],
};
const THEME_TOKENS = ['kw', 'str', 'num', 'com', 'fn', 'typ', 'op', 'tag', 'attr', 'prop', 'var', 'hd', 'em', 'link'];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,38}\.[a-z0-9][a-z0-9-]{0,38}$/;
const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const LOCAL_ID_RE = /^[A-Za-z][\w.-]{0,63}$/;
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
const KEY_RE = /^(?:(?:Mod|Ctrl|Alt|Shift)\+)+(?:[A-Za-z0-9]|F\d{1,2}|Enter|Tab|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Backspace|Delete|Escape|[\[\]\\/;',.=\-`])$|^F\d{1,2}$/;
const ACTIVATION_RE = /^(onStartup|onCommand:[A-Za-z][\w.-]{0,63}|onLanguage:[a-z][a-z0-9+-]{0,29})$/;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;

function safeRelPath(p, exts) {
  if (typeof p !== 'string' || !p || p.length > 120) return false;
  if (p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p) || p.split(/[\\/]/).includes('..') || p.includes('\0')) return false;
  return !exts || exts.some((e) => p.toLowerCase().endsWith(e));
}

function validate(raw) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  if (!isObj(raw)) return { ok: false, errors: ['manifest.json must contain a JSON object.'], warnings, manifest: null };

  const m = {};
  if (!isStr(raw.id, 80) || !ID_RE.test(raw.id)) err('"id" must look like "publisher.name" (lowercase letters, digits and dashes).');
  else m.id = raw.id;
  if (!isStr(raw.name, 60)) err('"name" is required (1-60 characters).'); else m.name = raw.name;
  if (typeof raw.version !== 'string' || !SEMVER_RE.test(raw.version)) err('"version" must be like 1.0.0.'); else m.version = raw.version;
  m.description = typeof raw.description === 'string' ? raw.description.slice(0, 300) : '';
  if (raw.description !== undefined && typeof raw.description !== 'string') err('"description" must be a string.');
  m.publisher = isStr(raw.publisher, 60) ? raw.publisher : (m.id ? m.id.split('.')[0] : '');
  m.categories = Array.isArray(raw.categories) ? raw.categories.filter((c) => isStr(c, 30)).slice(0, 5) : [];
  for (const k of ['homepage', 'repository']) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] === 'string' && /^https:\/\/[^\s]{3,200}$/.test(raw[k])) m[k] = raw[k]; else err(`"${k}" must be an https:// URL.`);
  }

  const api = raw.apiVersion === undefined ? 1 : raw.apiVersion;
  if (!Number.isInteger(api) || api < 1) err('"apiVersion" must be a positive integer.');
  else if (api > API_VERSION) err(`This extension needs extension API version ${api}, but SunlightIDE provides ${API_VERSION}. Update SunlightIDE.`);
  m.apiVersion = api;

  if (raw.main !== undefined) {
    if (!safeRelPath(raw.main, ['.js'])) err('"main" must be a relative path to a .js file inside the extension.'); else m.main = raw.main.replace(/\\/g, '/');
  }
  if (raw.icon !== undefined) {
    if (!safeRelPath(raw.icon, ['.png', '.svg'])) err('"icon" must be a relative path to a .png or .svg file inside the extension.'); else m.icon = raw.icon.replace(/\\/g, '/');
  }

  // permissions
  m.permissions = [];
  if (raw.permissions !== undefined) {
    if (!Array.isArray(raw.permissions)) err('"permissions" must be an array.');
    else for (const p of raw.permissions) {
      if (!Object.prototype.hasOwnProperty.call(PERMISSIONS, p)) err(`Unknown permission "${p}". Known: ${Object.keys(PERMISSIONS).join(', ')}.`);
      else if (!m.permissions.includes(p)) m.permissions.push(p);
    }
  }

  // contributions
  const c = isObj(raw.contributes) ? raw.contributes : {};
  if (raw.contributes !== undefined && !isObj(raw.contributes)) err('"contributes" must be an object.');
  for (const k of Object.keys(c)) if (!['commands', 'keybindings', 'themes', 'snippets'].includes(k)) warnings.push(`Unknown contribution "${k}" is ignored.`);
  m.contributes = { commands: [], keybindings: [], themes: [], snippets: [] };

  if (c.commands !== undefined) {
    if (!Array.isArray(c.commands) || c.commands.length > 100) err('"contributes.commands" must be an array of at most 100 commands.');
    else for (const cmd of c.commands) {
      if (!isObj(cmd) || !LOCAL_ID_RE.test(cmd.id || '') || !isStr(cmd.title, 80)) { err('Each command needs an "id" (letters, digits, dots, dashes) and a "title".'); continue; }
      if (m.contributes.commands.some((x) => x.id === cmd.id)) { err(`Duplicate command id "${cmd.id}".`); continue; }
      m.contributes.commands.push({ id: cmd.id, title: cmd.title, category: isStr(cmd.category, 40) ? cmd.category : '' });
    }
  }
  if (c.keybindings !== undefined) {
    if (!Array.isArray(c.keybindings) || c.keybindings.length > 50) err('"contributes.keybindings" must be an array of at most 50 entries.');
    else for (const kb of c.keybindings) {
      if (!isObj(kb) || typeof kb.key !== 'string' || !KEY_RE.test(kb.key)) { err(`Invalid keybinding "${kb && kb.key}". Use Mod/Ctrl/Alt/Shift plus a key, e.g. "Mod+Shift+K".`); continue; }
      if (!/(Mod|Ctrl|Alt)\+/.test(kb.key) && !/^F\d{1,2}$/.test(kb.key)) { err(`Keybinding "${kb.key}" needs Mod, Ctrl or Alt so it can't break typing.`); continue; }
      if (!m.contributes.commands.some((x) => x.id === kb.command)) { err(`Keybinding "${kb.key}" refers to unknown command "${kb.command}".`); continue; }
      m.contributes.keybindings.push({ key: kb.key, command: kb.command });
    }
  }
  if (c.themes !== undefined) {
    if (!Array.isArray(c.themes) || c.themes.length > 10) err('"contributes.themes" must be an array of at most 10 themes.');
    else for (const t of c.themes) {
      if (!isObj(t) || !LOCAL_ID_RE.test(t.id || '') || !isStr(t.label, 60) || !['light', 'dark'].includes(t.type)) { err('Each theme needs "id", "label" and "type" ("light" or "dark").'); continue; }
      const theme = { id: t.id, label: t.label, type: t.type, colors: {}, tokens: {} };
      for (const [k, v] of Object.entries(isObj(t.colors) ? t.colors : {})) {
        if (!THEME_COLORS[k]) err(`Theme "${t.id}": unknown colour "${k}". Known: ${Object.keys(THEME_COLORS).join(', ')}.`);
        else if (typeof v !== 'string' || !COLOR_RE.test(v)) err(`Theme "${t.id}": "${k}" must be a #hex, rgb(), rgba() or hsl() colour.`);
        else theme.colors[k] = v;
      }
      for (const [k, v] of Object.entries(isObj(t.tokens) ? t.tokens : {})) {
        if (!THEME_TOKENS.includes(k)) err(`Theme "${t.id}": unknown token colour "${k}". Known: ${THEME_TOKENS.join(', ')}.`);
        else if (typeof v !== 'string' || !COLOR_RE.test(v)) err(`Theme "${t.id}": token "${k}" must be a colour.`);
        else theme.tokens[k] = v;
      }
      m.contributes.themes.push(theme);
    }
  }
  if (c.snippets !== undefined) {
    if (!Array.isArray(c.snippets) || c.snippets.length > 30) err('"contributes.snippets" must be an array of at most 30 groups.');
    else {
      let total = 0;
      for (const g of c.snippets) {
        if (!isObj(g) || typeof g.language !== 'string' || !/^[a-z][a-z0-9+-]{0,29}$/.test(g.language) || !isObj(g.snippets)) { err('Each snippet group needs a "language" and a "snippets" object.'); continue; }
        const out = {};
        for (const [trigger, s] of Object.entries(g.snippets)) {
          if (!/^[A-Za-z_][\w-]{0,30}$/.test(trigger)) { err(`Snippet trigger "${trigger}" must be letters, digits, _ or -.`); continue; }
          const body = isObj(s) ? s.body : s;
          if (typeof body !== 'string' || !body || body.length > 4000) { err(`Snippet "${trigger}" needs a "body" string (max 4000 characters).`); continue; }
          out[trigger] = { body, description: isObj(s) && typeof s.description === 'string' ? s.description.slice(0, 100) : '' };
          if (++total > 300) { err('An extension can contribute at most 300 snippets.'); break; }
        }
        m.contributes.snippets.push({ language: g.language, snippets: out });
      }
    }
  }

  // activation
  if (raw.activationEvents !== undefined) {
    if (!Array.isArray(raw.activationEvents)) err('"activationEvents" must be an array.');
    else {
      m.activationEvents = [];
      for (const a of raw.activationEvents) {
        if (typeof a !== 'string' || !ACTIVATION_RE.test(a)) { err(`Invalid activation event "${a}". Use onStartup, onCommand:<id> or onLanguage:<language>.`); continue; }
        if (a.startsWith('onCommand:') && !m.contributes.commands.some((x) => x.id === a.slice(10))) warnings.push(`"${a}" refers to a command that is not declared.`);
        m.activationEvents.push(a);
      }
    }
  }
  if (!m.activationEvents) m.activationEvents = ['onStartup'];

  // consistency
  if (m.contributes.commands.length && !m.main) err('Commands need a "main" file that registers them.');
  if (!m.main && !m.contributes.themes.length && !m.contributes.snippets.length) err('This extension contributes nothing: add "main", "themes" or "snippets".');
  if (m.main && raw.permissions === undefined) warnings.push('No "permissions" declared. The extension can show messages but cannot read or edit files.');

  return { ok: errors.length === 0, errors, warnings, manifest: errors.length ? null : m };
}

// Compare x.y.z versions: negative if a < b.
function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

module.exports = { validate, compareVersions, API_VERSION, PERMISSIONS, THEME_COLORS, THEME_TOKENS, ID_RE };
