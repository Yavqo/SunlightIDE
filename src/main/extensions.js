'use strict';
// Extension manager: installs, lists, enables and removes extensions, and reads what the renderer's
// extension host needs (code, README, icon). Nothing here runs extension code.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validate, compareVersions, PERMISSIONS, ID_RE } = require('./ext-manifest');
const { readZip, writeZip } = require('./zip');

const MB = 1024 * 1024;
const LIMITS = { files: 500, total: 20 * MB, manifest: 64 * 1024, main: 1 * MB, readme: 200 * 1024, icon: 200 * 1024, storage: 1 * MB, registryJson: 2 * MB, zip: 10 * MB };
const SKIP = new Set(['.git', '.DS_Store', 'node_modules', '.svn']);

function allowedUrl(u) {
  let url;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
}

const isInside = (parent, child) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

function readJsonFile(file, maxBytes) {
  const st = fs.statSync(file);
  if (st.size > maxBytes) throw new Error(`${path.basename(file)} is too large.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function copyDir(src, dst, budget = { files: 0, bytes: 0 }) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.isSymbolicLink()) continue;
    const from = path.join(src, e.name), to = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(from, to, budget);
    else if (e.isFile()) {
      const size = fs.statSync(from).size;
      budget.files++; budget.bytes += size;
      if (budget.files > LIMITS.files) throw new Error(`The extension has too many files (limit ${LIMITS.files}).`);
      if (budget.bytes > LIMITS.total) throw new Error('The extension is too large.');
      fs.copyFileSync(from, to);
    }
  }
}

function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 38); }

class ExtensionManager {
  constructor({ dataDir, bundledDir }) {
    this.dataDir = dataDir;
    this.dir = path.join(dataDir, 'extensions');
    this.storageDir = path.join(dataDir, 'extension-data');
    this.stateFile = path.join(dataDir, 'extensions.json');
    this.bundledDir = bundledDir;
    this.state = this._loadState();
    this._registry = { at: 0, url: '', list: [] };
  }

  // ---- state ----
  _loadState() {
    try {
      const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return {
        enabled: s && typeof s.enabled === 'object' && s.enabled ? s.enabled : {},
        dev: Array.isArray(s && s.dev) ? s.dev.filter((p) => typeof p === 'string') : [],
        registry: typeof (s && s.registry) === 'string' ? s.registry : '',
      };
    } catch { return { enabled: {}, dev: [], registry: '' }; }
  }

  _saveState() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = this.stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.stateFile);
  }

  // ---- reading extensions on disk ----
  readManifestAt(dir) {
    let raw;
    try { raw = readJsonFile(path.join(dir, 'manifest.json'), LIMITS.manifest); } catch (e) {
      return { ok: false, errors: [e.code === 'ENOENT' ? 'manifest.json was not found.' : `manifest.json could not be read: ${e.message}`], warnings: [], manifest: null };
    }
    const r = validate(raw);
    if (!r.ok) return r;
    const m = r.manifest;
    const real = fs.realpathSync(dir);
    for (const key of ['main', 'icon']) {
      if (!m[key]) continue;
      const file = path.join(dir, m[key]);
      let st;
      try { st = fs.statSync(file); } catch { r.errors.push(`"${key}" file ${m[key]} does not exist.`); continue; }
      if (!st.isFile() || !isInside(real, fs.realpathSync(file))) r.errors.push(`"${key}" must be a regular file inside the extension.`);
      else if (st.size > (key === 'main' ? LIMITS.main : LIMITS.icon)) r.errors.push(`"${key}" is too large.`);
    }
    return r.errors.length ? { ...r, ok: false, manifest: null } : r;
  }

  list() {
    const out = [];
    const add = (dir, source) => {
      const r = this.readManifestAt(dir);
      const id = r.manifest ? r.manifest.id : path.basename(dir);
      out.push({ id, dir, source, manifest: r.manifest, errors: r.errors, warnings: r.warnings, enabled: this.state.enabled[id] !== false });
    };
    try {
      for (const e of fs.readdirSync(this.dir, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.') && !e.name.endsWith('.backup')) add(path.join(this.dir, e.name), 'installed');
    } catch { /* no extensions yet */ }
    for (const d of this.state.dev) if (fs.existsSync(d)) add(d, 'dev');
    return out.sort((a, b) => (a.manifest ? a.manifest.name : a.id).localeCompare(b.manifest ? b.manifest.name : b.id));
  }

  find(id) { return this.list().find((e) => e.id === id) || null; }

  bundled() {
    const out = [];
    try {
      for (const e of fs.readdirSync(this.bundledDir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const dir = path.join(this.bundledDir, e.name);
        const r = this.readManifestAt(dir);
        if (r.ok) out.push({ manifest: r.manifest, dir });
      }
    } catch { /* no bundled extensions */ }
    return out;
  }

  // ---- catalog (what the store shows) ----
  async catalog({ refresh = false } = {}) {
    const installed = new Map(this.list().filter((e) => e.manifest).map((e) => [e.id, e]));
    const map = new Map();
    const add = (m, extra) => {
      const prev = map.get(m.id);
      if (prev && compareVersions(prev.version, m.version) >= 0) return;
      map.set(m.id, {
        id: m.id, name: m.name, version: m.version, publisher: m.publisher, description: m.description, categories: m.categories,
        permissions: m.permissions, hasCode: !!m.main, hasIcon: !!m.icon,
        contributes: { commands: m.contributes.commands.length, themes: m.contributes.themes.length, snippets: m.contributes.snippets.reduce((n, g) => n + Object.keys(g.snippets).length, 0), keybindings: m.contributes.keybindings.length },
        ...extra,
        readme: m.readme || '', features: m.contributes,
      });
    };
    for (const b of this.bundled()) add(b.manifest, { source: 'bundled' });
    let registryError = null;
    let remote = [];
    try { remote = await this.fetchRegistry({ refresh }); } catch (err) {
      registryError = err.message;
      if (this._registry.url === this.state.registry) remote = this._registry.list;
    }
    for (const e of remote) add(e, { source: 'registry', downloadUrl: e.downloadUrl, sha256: e.sha256 });
    const list = [...map.values()].map((c) => {
      const inst = installed.get(c.id);
      return { ...c, installed: !!inst, installedVersion: inst && inst.manifest.version, installedSource: inst && inst.source, enabled: inst ? inst.enabled : false, updateAvailable: !!(inst && inst.source === 'installed' && compareVersions(inst.manifest.version, c.version) < 0) };
    });
    return { extensions: list.sort((a, b) => a.name.localeCompare(b.name)), registryError, registry: this.state.registry };
  }

  // ---- registry ----
  getRegistry() { return this.state.registry; }

  setRegistry(url) {
    const u = (url || '').trim();
    if (u && !allowedUrl(u)) throw new Error('The registry URL must start with https:// (http:// is only allowed for localhost).');
    this.state.registry = u;
    this._saveState();
    this._registry = { at: 0, url: '', list: [] };
    return u;
  }

  async fetchRegistry({ refresh = false } = {}) {
    const url = this.state.registry;
    if (!url) return [];
    if (!refresh && this._registry.url === url && Date.now() - this._registry.at < 60000) return this._registry.list;
    const buf = await this._download(url, LIMITS.registryJson);
    let json;
    try { json = JSON.parse(buf.toString('utf8')); } catch { throw new Error('The registry did not return valid JSON.'); }
    const arr = Array.isArray(json) ? json : json && Array.isArray(json.extensions) ? json.extensions : null;
    if (!arr) throw new Error('The registry must contain an "extensions" array.');
    const list = [];
    for (const e of arr.slice(0, 500)) {
      if (!e || typeof e !== 'object' || !ID_RE.test(e.id || '') || typeof e.version !== 'string' || !allowedUrl(e.downloadUrl || '') || !/^[a-f0-9]{64}$/.test(e.sha256 || '')) continue;
      list.push({
        id: e.id, name: String(e.name || e.id).slice(0, 60), version: e.version, publisher: String(e.publisher || e.id.split('.')[0]).slice(0, 60),
        description: String(e.description || '').slice(0, 300), categories: Array.isArray(e.categories) ? e.categories.filter((c) => typeof c === 'string').slice(0, 5) : [],
        permissions: (Array.isArray(e.permissions) ? e.permissions : []).filter((p) => PERMISSIONS[p]),
        main: e.main === null ? undefined : 'index.js', icon: undefined, downloadUrl: e.downloadUrl, sha256: e.sha256,
        readme: typeof e.readme === 'string' ? e.readme.slice(0, LIMITS.readme) : '',
        contributes: validate({ ...e, main: e.main === null ? undefined : 'index.js' }).manifest?.contributes || { commands: [], keybindings: [], themes: [], snippets: [] },
      });
    }
    this._registry = { at: Date.now(), url, list };
    return list;
  }

  async _download(url, maxBytes, timeoutMs = 15000) {
    if (!allowedUrl(url)) throw new Error('Downloads must use https:// (or http://localhost).');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'SunlightIDE' } });
      if (!allowedUrl(res.url || url)) throw new Error('The download was redirected to an insecure address.');
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > maxBytes) throw new Error('The download is too large.');
      const chunks = [];
      let size = 0;
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('The download is too large.');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'The download timed out.' : e.message || String(e));
    } finally { clearTimeout(timer); }
  }

  // ---- installing ----
  _tmpDir() {
    fs.mkdirSync(this.dir, { recursive: true });
    return fs.mkdtempSync(path.join(this.dir, '.tmp-'));
  }

  // Validate a staged folder and move it into place.
  _finalize(tmp, expected = null) {
    try {
      const r = this.readManifestAt(tmp);
      if (!r.ok) throw new Error(`Invalid extension: ${r.errors.join(' ')}`);
      const m = r.manifest;
      if (expected) {
        if (m.id !== expected.id) throw new Error(`The package contains "${m.id}", not "${expected.id}".`);
        if (m.version !== expected.version) throw new Error(`The package is version ${m.version}, but the registry listed ${expected.version}.`);
        const extra = m.permissions.filter((p) => !expected.permissions.includes(p));
        if (extra.length) throw new Error(`The package asks for permissions the registry did not list (${extra.join(', ')}), so it was not installed.`);
      }
      if (this.state.dev.some((d) => this.readManifestAt(d).manifest?.id === m.id)) throw new Error(`"${m.id}" is loaded from a development folder. Remove that first.`);
      const dest = path.join(this.dir, m.id);
      const backup = dest + '.backup';
      fs.rmSync(backup, { recursive: true, force: true });
      const exists = fs.existsSync(dest);
      if (exists) fs.renameSync(dest, backup);
      try { fs.renameSync(tmp, dest); }
      catch (err) { if (exists) fs.renameSync(backup, dest); throw err; }
      fs.rmSync(backup, { recursive: true, force: true });
      return m;
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
  }

  // Look inside a folder or zip without installing it, so the user can review the permissions first.
  inspectFolder(dir) {
    const r = this.readManifestAt(fs.realpathSync(dir));
    if (!r.ok) throw new Error(`Invalid extension: ${r.errors.join(' ')}`);
    return r.manifest;
  }

  inspectZip(file) {
    const st = fs.statSync(file);
    if (st.size > LIMITS.zip) throw new Error('The zip file is too large.');
    const entries = readZip(fs.readFileSync(file), { maxFiles: LIMITS.files, maxTotal: LIMITS.total });
    const e = entries.find((x) => x.name === 'manifest.json' || /^[^/]+\/manifest\.json$/.test(x.name));
    if (!e) throw new Error('The archive has no manifest.json.');
    let raw;
    try { raw = JSON.parse(e.data.toString('utf8')); } catch { throw new Error('manifest.json in the archive is not valid JSON.'); }
    const r = validate(raw);
    if (!r.ok) throw new Error(`Invalid extension: ${r.errors.join(' ')}`);
    return r.manifest;
  }

  installFromFolder(src, expected = null) {
    const real = fs.realpathSync(src);
    if (!fs.statSync(real).isDirectory()) throw new Error('Choose a folder.');
    const tmp = this._tmpDir();
    try { copyDir(real, tmp); } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
    return this._finalize(tmp, expected);
  }

  installFromBuffer(buf, expected = null) {
    const entries = readZip(buf, { maxFiles: LIMITS.files, maxTotal: LIMITS.total });
    if (!entries.length) throw new Error('The archive is empty.');
    // Zips made from a folder usually wrap everything in one top-level directory.
    let strip = '';
    if (!entries.some((e) => e.name === 'manifest.json')) {
      const first = entries[0].name.split('/')[0];
      if (entries.every((e) => e.name.startsWith(first + '/')) && entries.some((e) => e.name === `${first}/manifest.json`)) strip = first + '/';
    }
    const tmp = this._tmpDir();
    try {
      for (const e of entries) {
        const rel = strip ? e.name.slice(strip.length) : e.name;
        const dest = path.join(tmp, rel);
        if (!isInside(tmp, dest)) throw new Error(`Unsafe path in archive: ${e.name}`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, e.data);
      }
    } catch (err) { fs.rmSync(tmp, { recursive: true, force: true }); throw err; }
    return this._finalize(tmp, expected);
  }

  installFromZip(file) {
    const st = fs.statSync(file);
    if (st.size > LIMITS.zip) throw new Error('The zip file is too large.');
    return this.installFromBuffer(fs.readFileSync(file));
  }

  async install(id, reviewed = null) {
    if (!ID_RE.test(id || '')) throw new Error('Invalid extension id.');
    const { extensions } = await this.catalog();
    const entry = extensions.find((e) => e.id === id);
    if (!entry) throw new Error(`"${id}" is not in the store.`);
    if (reviewed && (entry.version !== reviewed.version || entry.source !== reviewed.source || entry.sha256 !== reviewed.sha256 || entry.downloadUrl !== reviewed.downloadUrl || !Array.isArray(reviewed.permissions) || entry.permissions.some((p) => !reviewed.permissions.includes(p)))) {
      throw new Error('The store listing changed. Refresh and review the extension again before installing.');
    }
    if (entry.source === 'bundled') {
      const b = this.bundled().find((x) => x.manifest.id === id);
      return this.installFromFolder(b.dir, entry);
    }
    const buf = await this._download(entry.downloadUrl, LIMITS.zip, 60000);
    const sum = crypto.createHash('sha256').update(buf).digest('hex');
    if (sum !== entry.sha256) throw new Error('The download does not match its published checksum, so it was not installed.');
    const m = this.installFromBufferChecked(buf, entry);
    return m;
  }

  // A registry listing is what the user saw before installing, so the package must match it exactly:
  // same id and version, and no permission that wasn't advertised.
  installFromBufferChecked(buf, entry) {
    return this.installFromBuffer(buf, entry);
  }

  addDev(dir) {
    const real = fs.realpathSync(dir);
    const r = this.readManifestAt(real);
    if (!r.ok) throw new Error(`Invalid extension: ${r.errors.join(' ')}`);
    const existing = this.find(r.manifest.id);
    if (existing && existing.source === 'installed') throw new Error(`"${r.manifest.id}" is already installed. Uninstall it first, or change the id.`);
    if (!this.state.dev.includes(real)) { this.state.dev.push(real); this._saveState(); }
    return r.manifest;
  }

  uninstall(id) {
    const ext = this.find(id);
    if (!ext) throw new Error(`"${id}" is not installed.`);
    if (ext.source === 'dev') this.state.dev = this.state.dev.filter((d) => d !== ext.dir);
    else fs.rmSync(ext.dir, { recursive: true, force: true });
    delete this.state.enabled[id];
    this._saveState();
    fs.rmSync(path.join(this.storageDir, `${id}.json`), { force: true });
    return true;
  }

  setEnabled(id, on) {
    if (!this.find(id)) throw new Error(`"${id}" is not installed.`);
    if (on) delete this.state.enabled[id]; else this.state.enabled[id] = false;
    this._saveState();
    return !!on;
  }

  // ---- what the host needs ----
  loadMain(id) {
    const ext = this.find(id);
    if (!ext || !ext.manifest) throw new Error(`"${id}" is not installed or invalid.`);
    if (!ext.manifest.main) return '';
    const real = fs.realpathSync(ext.dir);
    const file = fs.realpathSync(path.join(ext.dir, ext.manifest.main));
    if (!isInside(real, file)) throw new Error('The main file is outside the extension.');
    return fs.readFileSync(file, 'utf8');
  }

  _dirFor(id) {
    const ext = this.find(id);
    if (ext) return ext.dir;
    const b = this.bundled().find((x) => x.manifest.id === id);
    return b ? b.dir : null;
  }

  readme(id) {
    const dir = this._dirFor(id);
    if (!dir) return this._registry.list.find((e) => e.id === id)?.readme || '';
    const name = fs.readdirSync(dir).find((f) => /^readme(\.md)?$/i.test(f));
    if (!name) return '';
    const file = path.join(dir, name);
    if (fs.statSync(file).size > LIMITS.readme) return '(The README is too large to display.)';
    return fs.readFileSync(file, 'utf8');
  }

  icon(id) {
    const dir = this._dirFor(id);
    if (!dir) return null;
    const r = this.readManifestAt(dir);
    if (!r.manifest || !r.manifest.icon) return null;
    const file = path.join(dir, r.manifest.icon);
    const buf = fs.readFileSync(file);
    const mime = file.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  // ---- per-extension storage ----
  storageGet(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.storageDir, `${id}.json`), 'utf8')); } catch { return {}; }
  }

  storageSet(id, obj) {
    if (!ID_RE.test(id)) throw new Error('Invalid extension id.');
    const text = JSON.stringify(obj);
    if (Buffer.byteLength(text) > LIMITS.storage) throw new Error('Extension storage is full (1 MB limit).');
    fs.mkdirSync(this.storageDir, { recursive: true });
    fs.writeFileSync(path.join(this.storageDir, `${id}.json`), text);
    return true;
  }

  // ---- developer tools ----
  scaffold(parent, { name, publisher }) {
    const title = String(name || '').trim();
    const pub = slug(publisher || 'me');
    const nm = slug(title);
    if (!title || !nm) throw new Error('Enter a name for the extension.');
    if (!pub) throw new Error('Enter a publisher name.');
    const id = `${pub}.${nm}`;
    if (!ID_RE.test(id)) throw new Error(`"${id}" is not a valid extension id.`);
    const dir = path.join(parent, nm);
    if (fs.existsSync(dir)) throw new Error(`"${nm}" already exists in that folder.`);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = {
      id, name: title, version: '0.1.0', publisher: publisher || pub, description: `${title}: a SunlightIDE extension.`,
      main: 'index.js', permissions: ['editor.read', 'editor.write'],
      contributes: {
        commands: [{ id: 'hello', title: 'Say Hello', category: title }, { id: 'shout', title: 'Shout Selection', category: title }],
        keybindings: [{ key: 'Mod+Alt+H', command: 'hello' }],
      },
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'index.js'), `// ${title}: the entry point of your extension.
// It runs in a sandboxed worker. The global \`sunlight\` object is the whole API.
// Read the guide: Help > Extension Developer Guide.

sunlight.commands.register('hello', async () => {
  const file = await sunlight.editor.getActive();
  sunlight.window.showMessage(file ? \`Hello from \${file.name}!\` : 'Hello! Open a file to see more.');
});

sunlight.commands.register('shout', async () => {
  const selections = await sunlight.editor.getSelections();
  if (!selections.some((s) => s.text)) {
    sunlight.window.showMessage('Select some text first.');
    return;
  }
  await sunlight.editor.replaceSelections(selections.map((s) => s.text.toUpperCase()));
});
`);
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${title}

${title} is a SunlightIDE extension.

## Commands

- **Say Hello** (\`Mod+Alt+H\`): shows a greeting.
- **Shout Selection**: turns the selected text into upper case.

## Develop

Press \`Cmd+Shift+P\`, run **Developer: Reload Extensions** after every change.
`);
    const check = this.readManifestAt(dir);
    if (!check.ok) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error(`Template is invalid: ${check.errors.join(' ')}`); }
    return { dir, id };
  }

  // Zip an extension folder so it can be shared or published.
  packageExtension(dir, outFile) {
    const real = fs.realpathSync(dir);
    const r = this.readManifestAt(real);
    if (!r.ok) throw new Error(`Invalid extension: ${r.errors.join(' ')}`);
    const names = listFiles(real).filter((n) => !n.endsWith('.zip'));
    if (names.length > LIMITS.files) throw new Error('Too many files to package.');
    let total = 0;
    const files = names.map((n) => { const data = fs.readFileSync(path.join(real, n)); total += data.length; return { name: n, data }; });
    if (total > LIMITS.total) throw new Error('The extension is too large to package.');
    const buf = writeZip(files);
    const file = outFile || path.join(path.dirname(real), `${r.manifest.id}-${r.manifest.version}.zip`);
    fs.writeFileSync(file, buf);
    return { file, files: files.length, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), id: r.manifest.id };
  }
}

module.exports = { ExtensionManager, allowedUrl, LIMITS, copyDir, slug };
