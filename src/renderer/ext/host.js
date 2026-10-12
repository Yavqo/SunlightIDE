// Extension host. Runs each extension in its own sandboxed Web Worker and serves its API requests.
//
// Security model
//  - The worker has no DOM, no Node, no file system, and the page's CSP blocks all network access from it.
//  - The worker is untrusted: every message is validated here, the method must be in API_TABLE, and the
//    extension must have declared the permission that method needs in its manifest.
//  - A worker that stops answering is terminated; one that floods the host with requests is terminated.

const MAX_TEXT = 5 * 1024 * 1024;
const COMMAND_TIMEOUT = 30000;
const ACTIVATE_TIMEOUT = 8000;
const MAX_REQUESTS_PER_SECOND = 2000;

// method -> required permission (null = always allowed)
const API_TABLE = {
  'commands.execute': null,
  'window.showMessage': null,
  'window.showInput': null,
  'window.showPick': null,
  'statusBar.setItem': null,
  'statusBar.removeItem': null,
  'editor.getActive': 'editor.read',
  'editor.getText': 'editor.read',
  'editor.getLine': 'editor.read',
  'editor.getSelections': 'editor.read',
  'editor.replaceSelections': 'editor.write',
  'editor.insertText': 'editor.write',
  'editor.setText': 'editor.write',
  'editor.replaceRange': 'editor.write',
  'editor.setSelections': 'editor.write',
  'workspace.getFolder': 'workspace.read',
  'workspace.readFile': 'workspace.read',
  'workspace.listFiles': 'workspace.read',
  'workspace.writeFile': 'workspace.write',
  'storage.get': 'storage',
  'storage.set': 'storage',
  'storage.delete': 'storage',
  'storage.keys': 'storage',
};

const EVENTS = ['activeFileChanged', 'fileOpened', 'fileSaved', 'selectionChanged', 'textChanged'];

const isPos = (p) => p && Number.isInteger(p.line) && Number.isInteger(p.col) && p.line >= 0 && p.col >= 0;
const bad = (msg) => { throw new Error(msg); };

export class ExtensionHost {
  // deps: { api, toast(msg, {error}), input({prompt,value,placeholder}), pick(items, placeholder),
  //         editor: EditorAdapter (see app.js), root(): string|null, onChange() }
  constructor(deps) {
    this.d = deps;
    this.api = deps.api;
    this.exts = new Map();      // id -> { info, manifest, source, enabled, worker, state }
    this.commands = new Map();  // fullId -> { extId, local, title, category }
    this.keybindings = [];      // { key, parsed, extId, local, full }
    this.themes = [];           // { extId, id, label, type, colors, tokens }
    this.snippets = [];         // { extId, language, snippets }
    this.statusItems = new Map(); // `${extId}:${id}` -> item
    this.logLines = [];
    this.bootSource = '';
    this.seq = 1;
    this.commandTimeout = deps.commandTimeout || COMMAND_TIMEOUT;
  }

  // ---- loading ----
  async start() {
    this.bootSource = await this.api.ext('bootSource');
    await this.reload();
  }

  async reload() {
    for (const id of [...this.exts.keys()]) this.deactivate(id, 'reloading');
    this.exts.clear(); this.commands.clear(); this.keybindings = []; this.themes = []; this.snippets = [];
    this.statusItems.clear();
    const list = await this.api.ext('list');
    for (const e of list) {
      if (!e.manifest) { this.log(e.id, 'error', `Not loaded: ${e.errors.join(' ')}`); this.exts.set(e.id, { info: e, manifest: null, enabled: false, invalid: true }); continue; }
      const rec = { info: e, manifest: e.manifest, source: e.source, enabled: e.enabled, worker: null, state: 'inactive', subs: new Set(), ready: null };
      this.exts.set(e.id, rec);
      if (!e.enabled) continue;
      this.register(rec);
    }
    this.d.onChange?.();
    // activate extensions that asked to start immediately
    for (const rec of this.exts.values()) {
      if (rec.enabled && rec.manifest && rec.manifest.main && rec.manifest.activationEvents.includes('onStartup')) this.activate(rec.manifest.id).catch(() => {});
    }
  }

  // Declarative contributions are registered even before the extension's code is loaded.
  register(rec) {
    const m = rec.manifest;
    for (const c of m.contributes.commands) this.commands.set(`${m.id}.${c.id}`, { extId: m.id, local: c.id, title: c.title, category: c.category });
    for (const k of m.contributes.keybindings) this.keybindings.push({ key: k.key, parsed: parseKey(k.key), extId: m.id, local: k.command, full: `${m.id}.${k.command}` });
    for (const t of m.contributes.themes) this.themes.push({ extId: m.id, ...t, key: `${m.id}:${t.id}` });
    for (const s of m.contributes.snippets) this.snippets.push({ extId: m.id, ...s });
  }

  get(id) { return this.exts.get(id) || null; }

  // ---- logging ----
  log(extId, level, text) {
    this.logLines.push(`${new Date().toLocaleTimeString()} [${extId}] ${level}: ${text}`);
    if (this.logLines.length > 2000) this.logLines.splice(0, this.logLines.length - 2000);
  }

  // ---- activation ----
  activate(id) {
    const rec = this.exts.get(id);
    if (!rec || !rec.enabled || !rec.manifest) return Promise.reject(new Error(`"${id}" is not available.`));
    if (!rec.manifest.main) return Promise.resolve();
    if (rec.ready) return rec.ready;
    rec.state = 'starting';
    rec.ready = (async () => {
      const code = await this.api.ext('loadMain', id);
      const info = { id, version: rec.manifest.version, apiVersion: rec.manifest.apiVersion };
      const boot = this.bootSource.split('__SUNLIGHT_INFO__').join(JSON.stringify(info));
      const prefix = `${boot}\n;try {\n`;
      const lineOffset = prefix.split('\n').length - 1;
      const source = `${prefix}${code}\n} catch (e) { self.postMessage({ t: 'fatal', e: String((e && e.stack) || e) }); }\nself.postMessage({ t: 'ready' });\n`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (err) => { if (settled) return; settled = true; clearTimeout(timer); URL.revokeObjectURL(url); err ? reject(err) : resolve(); };
        const worker = new Worker(url, { name: id });
        rec.worker = worker;
        rec.requests = 0; rec.windowStart = Date.now(); rec.messages = 0; rec.pending = new Map();
        const timer = setTimeout(() => { finish(new Error('The extension did not start in time.')); this.deactivate(id, 'start timeout'); }, ACTIVATE_TIMEOUT);
        worker.onmessage = (ev) => {
          const d = ev.data;
          if (!d || typeof d !== 'object') return;
          if (d.t === 'ready') { rec.state = 'active'; this.log(id, 'info', 'Activated.'); finish(); this.d.onChange?.(); return; }
          if (d.t === 'fatal') { this.log(id, 'error', `Failed to start: ${d.e}`); finish(new Error(String(d.e).split('\n')[0])); this.deactivate(id, 'failed'); return; }
          this.onWorkerMessage(rec, d);
        };
        worker.onerror = (ev) => {
          ev.preventDefault?.();
          const line = ev.lineno ? ` (line ${Math.max(1, ev.lineno - lineOffset)})` : '';
          const msg = `${ev.message || 'Script error'}${line}`;
          this.log(id, 'error', msg);
          if (!settled) { finish(new Error(msg)); this.deactivate(id, 'error'); }
        };
      });
    })().catch((err) => {
      rec.ready = null; rec.state = 'failed';
      this.d.toast(`Extension "${rec.manifest.name}" failed to start: ${err.message}`, { error: true });
      throw err;
    });
    return rec.ready;
  }

  deactivate(id, why = '') {
    const rec = this.exts.get(id);
    if (!rec) return;
    if (rec.worker) { try { rec.worker.terminate(); } catch { /* gone */ } }
    rec.worker = null; rec.ready = null;
    if (rec.state !== 'failed') rec.state = 'inactive';
    for (const p of (rec.pending || new Map()).values()) p.reject(new Error(`The extension was stopped${why ? ` (${why})` : ''}.`));
    rec.pending = new Map();
    rec.subs = new Set();
    for (const k of [...this.statusItems.keys()]) if (k.startsWith(id + ':')) this.statusItems.delete(k);
    if (why) this.log(id, 'info', `Stopped (${why}).`);
    this.d.onChange?.();
  }

  // ---- running commands ----
  async runCommand(fullId, args = []) {
    const c = this.commands.get(fullId);
    if (!c) throw new Error(`Unknown extension command "${fullId}".`);
    const rec = this.exts.get(c.extId);
    await this.activate(c.extId);
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        rec.pending.delete(id);
        this.d.toast(`"${c.title}" is not responding, so ${rec.manifest.name} was stopped.`, { error: true });
        this.deactivate(c.extId, 'command timed out');
        reject(new Error('The command timed out.'));
      }, this.commandTimeout);
      rec.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      try { rec.worker.postMessage({ t: 'cmd', id, name: c.local, args: sanitizeArgs(args) }); } catch (err) { clearTimeout(timer); rec.pending.delete(id); reject(err); }
    });
  }

  // Called by the app when a language is activated, to start extensions with onLanguage events.
  onLanguage(lang) {
    for (const rec of this.exts.values()) {
      if (rec.enabled && rec.manifest && rec.manifest.main && rec.state === 'inactive' && rec.manifest.activationEvents.includes(`onLanguage:${lang}`)) this.activate(rec.manifest.id).catch(() => {});
    }
  }

  // ---- events from the app to extensions ----
  emit(name, data) {
    if (!EVENTS.includes(name)) return;
    for (const rec of this.exts.values()) {
      if (rec.worker && rec.subs && rec.subs.has(name)) { try { rec.worker.postMessage({ t: 'event', name, data }); } catch { /* worker gone */ } }
    }
  }

  // ---- messages from workers (untrusted) ----
  onWorkerMessage(rec, d) {
    const id = rec.manifest.id;
    const now = Date.now();
    if (now - rec.windowStart > 1000) { rec.windowStart = now; rec.messages = 0; }
    if (++rec.messages > MAX_REQUESTS_PER_SECOND) {
      this.d.toast(`${rec.manifest.name} sent too many requests and was stopped.`, { error: true });
      this.deactivate(id, 'flooding the host');
      return;
    }
    switch (d.t) {
      case 'req': this.handleRequest(rec, d); break;
      case 'cres': {
        const p = rec.pending.get(d.id);
        if (!p) break;
        rec.pending.delete(d.id);
        if (d.ok) p.resolve(d.v); else p.reject(new Error(String(d.e || 'The command failed.')));
        break;
      }
      case 'reg': break; // the manifest decides which commands exist; registration is informational
      case 'sub': if (typeof d.name === 'string' && EVENTS.includes(d.name) && rec.manifest.permissions.includes('editor.read')) rec.subs.add(d.name); break;
      case 'log': this.log(id, ['log', 'info', 'warn', 'error', 'debug'].includes(d.level) ? d.level : 'log', String(d.text || '').slice(0, 2000)); break;
      default: break; // ignore anything else
    }
  }

  async handleRequest(rec, d) {
    const id = rec.manifest.id;
    const reply = (ok, v, e) => { try { rec.worker && rec.worker.postMessage({ t: 'res', id: d.id, ok, v, e }); } catch { /* worker gone */ } };
    try {
      if (!Number.isInteger(d.id) || typeof d.m !== 'string' || !Array.isArray(d.a) || d.a.length > 8) throw new Error('Malformed request.');
      if (!Object.prototype.hasOwnProperty.call(API_TABLE, d.m)) throw new Error(`Unknown API method "${d.m}".`);
      const perm = API_TABLE[d.m];
      if (perm && !rec.manifest.permissions.includes(perm)) throw new Error(`${d.m} needs the "${perm}" permission. Declare it in manifest.json under "permissions".`);
      const v = await this.dispatch(rec, d.m, d.a);
      reply(true, v === undefined ? null : v);
    } catch (err) {
      this.log(id, 'warn', `${d.m}: ${err.message}`);
      reply(false, undefined, err.message);
    }
  }

  // The API implementation. Arguments are untrusted and are validated before use.
  async dispatch(rec, method, a) {
    const id = rec.manifest.id;
    const ed = this.d.editor;
    switch (method) {
      case 'commands.execute': {
        const target = typeof a[0] === 'string' ? a[0] : bad('command id must be a string');
        const full = this.commands.has(target) ? target : `${id}.${target}`;
        if (!this.commands.has(full)) bad(`Unknown command "${target}".`);
        return this.runCommand(full, Array.isArray(a[1]) ? a[1] : []);
      }
      case 'window.showMessage': {
        const now = Date.now();
        rec.toasts = (rec.toasts || []).filter((t) => now - t < 10000);
        if (rec.toasts.length >= 5) return null; // rate limit
        rec.toasts.push(now);
        const opts = a[1] && typeof a[1] === 'object' ? a[1] : {};
        this.d.toast(`${rec.manifest.name}: ${String(a[0]).slice(0, 300)}`, { error: opts.type === 'error' });
        return null;
      }
      case 'window.showInput': {
        const o = a[0] && typeof a[0] === 'object' ? a[0] : {};
        const r = await this.d.input({ prompt: String(o.prompt || rec.manifest.name).slice(0, 120), value: String(o.value || '').slice(0, 500) });
        return r === null ? null : String(r);
      }
      case 'window.showPick': {
        if (!Array.isArray(a[0]) || a[0].length > 500) bad('items must be an array of at most 500 entries');
        const items = a[0].map((it, i) => {
          if (typeof it === 'string') return { label: it.slice(0, 200), value: it, index: i };
          if (!it || typeof it.label !== 'string') bad('each pick item needs a label');
          return { label: it.label.slice(0, 200), detail: typeof it.detail === 'string' ? it.detail.slice(0, 200) : '', value: it.value === undefined ? it.label : it.value, index: i };
        });
        const o = a[1] && typeof a[1] === 'object' ? a[1] : {};
        const r = await this.d.pick(items, String(o.placeholder || rec.manifest.name).slice(0, 120));
        return r ? { label: r.label, value: r.value, index: r.index } : null;
      }
      case 'statusBar.setItem': {
        const key = typeof a[0] === 'string' && /^[\w.-]{1,40}$/.test(a[0]) ? a[0] : bad('status item id must be 1-40 letters, digits, dots, dashes');
        const o = a[1] && typeof a[1] === 'object' ? a[1] : {};
        const item = { extId: id, id: key, text: String(o.text || '').slice(0, 60), tooltip: String(o.tooltip || '').slice(0, 200), command: typeof o.command === 'string' && o.command ? `${id}.${o.command}` : '' };
        if (this.statusItems.size > 200) bad('too many status bar items');
        this.statusItems.set(`${id}:${key}`, item);
        this.d.onChange?.();
        return null;
      }
      case 'statusBar.removeItem': { this.statusItems.delete(`${id}:${String(a[0])}`); this.d.onChange?.(); return null; }

      case 'editor.getActive': return ed.info();
      case 'editor.getText': return ed.text();
      case 'editor.getLine': { if (!Number.isInteger(a[0]) || a[0] < 0) bad('line must be a non-negative integer'); return ed.line(a[0]); }
      case 'editor.getSelections': return ed.selections();
      case 'editor.replaceSelections': {
        const v = a[0];
        const texts = Array.isArray(v) ? v : [v];
        if (!texts.every((t) => typeof t === 'string' && t.length <= MAX_TEXT)) bad('replacement must be a string or an array of strings');
        return ed.replaceSelections(texts);
      }
      case 'editor.insertText': { if (typeof a[0] !== 'string' || a[0].length > MAX_TEXT) bad('text must be a string'); return ed.replaceSelections([a[0]]); }
      case 'editor.setText': { if (typeof a[0] !== 'string' || a[0].length > MAX_TEXT) bad('text must be a string'); return ed.setText(a[0]); }
      case 'editor.replaceRange': {
        const r = a[0];
        if (!r || !isPos(r.start) || !isPos(r.end)) bad('range must be { start: {line, col}, end: {line, col} }');
        if (typeof a[1] !== 'string' || a[1].length > MAX_TEXT) bad('text must be a string');
        return ed.replaceRange(r.start, r.end, a[1]);
      }
      case 'editor.setSelections': {
        if (!Array.isArray(a[0]) || !a[0].length || a[0].length > 10000 || !a[0].every((s) => s && isPos(s.anchor) && isPos(s.head))) bad('selections must be [{ anchor: {line, col}, head: {line, col} }]');
        return ed.setSelections(a[0]);
      }

      case 'workspace.getFolder': return this.d.root() || null;
      case 'workspace.readFile': return this.workspaceFile(a[0], 'read');
      case 'workspace.writeFile': {
        if (typeof a[1] !== 'string' || a[1].length > MAX_TEXT) bad('text must be a string');
        return this.workspaceFile(a[0], 'write', a[1]);
      }
      case 'workspace.listFiles': {
        const root = this.d.root() || bad('No folder is open.');
        const files = await this.api.fs.listFiles(root);
        const o = a[0] && typeof a[0] === 'object' ? a[0] : {};
        const ext = typeof o.extension === 'string' ? o.extension.toLowerCase() : '';
        return files.filter((f) => !ext || f.toLowerCase().endsWith(ext)).slice(0, 5000);
      }

      case 'storage.get': return (await this.api.ext('storageGet', id))[String(a[0])];
      case 'storage.keys': return Object.keys(await this.api.ext('storageGet', id));
      case 'storage.set': case 'storage.delete': {
        const data = await this.api.ext('storageGet', id);
        const key = String(a[0]);
        if (key === '__proto__') bad('invalid key');
        if (method === 'storage.set') { let v; try { v = JSON.parse(JSON.stringify(a[1] === undefined ? null : a[1])); } catch { bad('value must be JSON-serialisable'); } data[key] = v; } else delete data[key];
        await this.api.ext('storageSet', id, data);
        return null;
      }
      default: return bad(`Unknown API method "${method}".`);
    }
  }

  // Paths are relative to the open folder and must stay inside it.
  async workspaceFile(rel, mode, text) {
    const root = this.d.root() || bad('No folder is open.');
    if (typeof rel !== 'string' || !rel || rel.length > 300 || rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.split(/[\\/]/).includes('..') || rel.includes('\0')) bad('path must be relative to the open folder and may not contain ".."');
    const full = `${root.replace(/\/+$/, '')}/${rel.replace(/\\/g, '/')}`;
    if (mode === 'read') {
      const r = await this.api.fs.readFile(full);
      if (r.binary) bad('binary files cannot be read');
      if (r.tooLarge) bad('the file is too large');
      if (r.text.length > MAX_TEXT) bad('the file is too large');
      return r.text;
    }
    const dir = full.slice(0, full.lastIndexOf('/'));
    if (dir.length > root.length) await this.api.fs.createDir(dir);
    await this.api.fs.writeFile(full, text);
    return null;
  }

  // ---- key bindings ----
  matchKey(e, isMac) {
    for (const k of this.keybindings) if (keyMatches(k.parsed, e, isMac) && this.commands.has(k.full)) return k.full;
    return null;
  }
}

function sanitizeArgs(args) {
  try { return JSON.parse(JSON.stringify(args)); } catch { return []; }
}

export function parseKey(spec) {
  const parts = spec.split('+');
  const key = parts.pop();
  const mods = new Set(parts);
  return { key: normaliseKey(key), mod: mods.has('Mod'), ctrl: mods.has('Ctrl'), alt: mods.has('Alt'), shift: mods.has('Shift') };
}

const KEY_NAMES = { Up: 'arrowup', Down: 'arrowdown', Left: 'arrowleft', Right: 'arrowright', Space: ' ', Esc: 'escape', Escape: 'escape', Enter: 'enter', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown' };
function normaliseKey(k) { return KEY_NAMES[k] || k.toLowerCase(); }

export function keyMatches(p, e, isMac) {
  const wantMeta = isMac ? p.mod : false;
  const wantCtrl = p.ctrl || (!isMac && p.mod);
  if (!!e.metaKey !== wantMeta || !!e.ctrlKey !== wantCtrl || !!e.altKey !== p.alt || !!e.shiftKey !== p.shift) return false;
  // Alt changes the produced character on macOS (Option+H gives a dotless-i), so compare the physical key too.
  const typed = e.key.toLowerCase();
  if (typed === p.key) return true;
  const code = (e.code || '').toLowerCase();
  return code === `key${p.key}` || code === `digit${p.key}`;
}
