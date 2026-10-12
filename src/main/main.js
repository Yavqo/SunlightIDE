'use strict';
// SunlightIDE main process: window, native menu, filesystem, search and terminal services.

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const git = require('./git');
const language = require('./language');
const { SessionStore } = require('./session');
const { ExtensionManager } = require('./extensions');

const IS_MAC = process.platform === 'darwin';
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '.next', 'dist', 'build', '.cache', '__pycache__', '.venv', 'target', '.idea', '.gradle']);
const MAX_FILE_BYTES = 30 * 1024 * 1024;

let win = null;
let forceClose = false;
let watcher = null;
let searchToken = 0;
const ptys = new Map();
let extensions = null; // created once the app is ready (needs the user-data path)

// ---------- persisted settings and state ----------
const userFile = (name) => path.join(app.getPath('userData'), name);
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(userFile(name), 'utf8')); } catch { return fallback; }
}
function writeJson(name, data) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(userFile(name), JSON.stringify(data, null, 2));
  } catch (err) { console.error('write failed', name, err.message); }
}

const DEFAULT_SETTINGS = {
  theme: 'system', fontSize: 13, autoSave: false, autoClose: true, completion: true, minimap: true, wordWrap: false, gitBlame: true, colorTheme: '', extensionUpdateNotifications: true,
};

// ---------- window ----------
function createWindow() {
  const state = readJson('window.json', {});
  win = new BrowserWindow({
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    width: state.width || 1440,
    height: state.height || 900,
    x: state.x, y: state.y,
    minWidth: 720, minHeight: 480,
    show: false,
    backgroundColor: '#FFFFFF',
    title: 'SunlightIDE',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.on('close', (e) => {
    saveWindowState();
    if (forceClose) return;
    e.preventDefault();
    win.webContents.send('app:request-close');
  });
  win.on('closed', () => { win = null; stopWatching(); killAllPtys(); });

  // Keep navigation inside the app; open external links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });

  if (process.env.SUNLIGHT_SMOKE) runSmoke();
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  writeJson('window.json', { ...b, maximized: win.isMaximized() });
}

// ---------- menu ----------
function send(cmd, arg) { if (win && !win.isDestroyed()) win.webContents.send('menu', cmd, arg); }

function buildMenu() {
  const item = (label, cmd, accelerator, extra = {}) => ({ label, accelerator, click: () => send(cmd), ...extra });
  // registerAccelerator:false shows the shortcut but lets the editor see the keystroke itself.
  const soft = (label, cmd, accelerator) => item(label, cmd, accelerator, { registerAccelerator: false });
  const template = [
    ...(IS_MAC ? [{
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' },
        item('Settings…', 'settings', 'Cmd+,'),
        { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        item('New File', 'new-file', 'CmdOrCtrl+N'),
        { type: 'separator' },
        item('Open File…', 'open-file', 'CmdOrCtrl+O'),
        item('Open Folder…', 'open-folder', 'CmdOrCtrl+Shift+O'),
        item('Close Folder', 'close-folder'),
        { type: 'separator' },
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As…', 'save-as', 'CmdOrCtrl+Shift+S'),
        item('Save All', 'save-all', 'CmdOrCtrl+Alt+S'),
        { type: 'separator' },
        item('Close Tab', 'close-tab', 'CmdOrCtrl+W'),
        ...(IS_MAC ? [] : [{ type: 'separator' }, item('Settings…', 'settings', 'Ctrl+,'), { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        soft('Undo', 'undo', 'CmdOrCtrl+Z'),
        soft('Redo', 'redo', IS_MAC ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        soft('Select All', 'select-all', 'CmdOrCtrl+A'),
        { type: 'separator' },
        soft('Find', 'find', 'CmdOrCtrl+F'),
        soft('Replace', 'replace', IS_MAC ? 'Cmd+Alt+F' : 'Ctrl+H'),
        item('Find in Files', 'search-in-files', 'CmdOrCtrl+Shift+F'),
        { type: 'separator' },
        soft('Toggle Line Comment', 'toggle-comment', 'CmdOrCtrl+/'),
        { type: 'separator' },
        soft('Add Next Occurrence', 'add-next', 'CmdOrCtrl+D'),
        soft('Select All Occurrences', 'select-occurrences', 'CmdOrCtrl+Shift+L'),
        soft('Add Cursor Above', 'cursor-above', 'CmdOrCtrl+Alt+Up'),
        soft('Add Cursor Below', 'cursor-below', 'CmdOrCtrl+Alt+Down'),
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Command Palette…', 'palette', 'CmdOrCtrl+Shift+P'),
        { type: 'separator' },
        item('Explorer', 'show-explorer', 'CmdOrCtrl+Shift+E'),
        item('Toggle Sidebar', 'toggle-sidebar', 'CmdOrCtrl+B'),
        item('Toggle Terminal', 'toggle-terminal', 'Ctrl+`'),
        item('Toggle Minimap', 'toggle-minimap'),
        item('Toggle Word Wrap', 'toggle-wrap', 'Alt+Z'),
        item('Source Control', 'show-git', 'Ctrl+Shift+G'),
        item('Extensions', 'show-ext', 'CmdOrCtrl+Shift+X'),
        { type: 'separator' },
        item('Increase Font Size', 'font-up', 'CmdOrCtrl+='),
        item('Decrease Font Size', 'font-down', 'CmdOrCtrl+-'),
        item('Reset Font Size', 'font-reset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        { label: 'Theme', submenu: [
          item('Light', 'theme-light'), item('Dark', 'theme-dark'), item('Match System', 'theme-system'),
        ] },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        item('Go to File…', 'quick-open', 'CmdOrCtrl+P'),
        soft('Go to Line…', 'goto-line', 'Ctrl+G'),
        { type: 'separator' },
        item('Next Tab', 'next-tab', 'Ctrl+Tab'),
        item('Previous Tab', 'prev-tab', 'Ctrl+Shift+Tab'),
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        item('Toggle Terminal', 'toggle-terminal'),
        item('New Terminal', 'terminal-new', 'Ctrl+Shift+`'),
        item('Clear Terminal', 'terminal-clear'),
        item('Kill Terminal', 'terminal-kill'),
      ],
    },
    { label: 'Window', role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        item('Extension Developer Guide', 'ext-docs'),
        item('Keyboard Shortcuts', 'shortcuts'),
        { type: 'separator' },
        { label: 'Reveal Settings File', click: () => shell.showItemInFolder(userFile('settings.json')) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- filesystem ----------
function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

async function readDir(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name === '.DS_Store' || e.name === '.git') continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = (await fsp.stat(path.join(dir, e.name))).isDirectory(); } catch { /* broken link */ } }
    out.push({ name: e.name, path: path.join(dir, e.name), isDir });
  }
  out.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return out;
}

async function listFiles(root, limit = 40000) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < limit) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) files.push(path.relative(root, full));
    }
  }
  return files.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

async function searchFiles(root, query, opts, token) {
  const results = [];
  let re;
  try {
    let src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (opts.wholeWord) src = `\\b(?:${src})\\b`;
    re = new RegExp(src, opts.caseSensitive ? 'g' : 'gi');
  } catch { return { results, error: 'Invalid regular expression' }; }
  const files = await listFiles(root, 20000);
  let filesWithHits = 0;
  for (let f = 0; f < files.length; f++) {
    if (token !== searchToken) return { results, cancelled: true };
    const rel = files[f];
    const full = path.join(root, rel);
    let buf;
    try {
      const st = await fsp.stat(full);
      if (st.size > 2 * 1024 * 1024) continue;
      buf = await fsp.readFile(full);
    } catch { continue; }
    if (isBinary(buf)) continue;
    const lines = buf.toString('utf8').split(/\r\n|\r|\n/);
    let hit = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 4000) continue;
      re.lastIndex = 0;
      let m;
      let perLine = 0;
      while ((m = re.exec(line)) && perLine < 20) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        hit = true;
        perLine++;
        results.push({ file: rel, line: i, col: m.index, len: m[0].length, text: line.slice(0, 300) });
        if (results.length >= 3000) return { results, truncated: true, files: filesWithHits + 1 };
      }
    }
    if (hit) filesWithHits++;
    if (f % 50 === 0) await new Promise((r) => setImmediate(r));
  }
  return { results, files: filesWithHits };
}

function startWatching(root) {
  stopWatching();
  try {
    let timer = null;
    const dirs = new Set();
    watcher = fs.watch(root, { recursive: true }, (_evt, filename) => {
      if (!filename) return;
      const parts = filename.split(path.sep);
      if (parts.some((p) => IGNORED_DIRS.has(p))) return;
      dirs.add(path.dirname(path.join(root, filename)));
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (win && !win.isDestroyed()) win.webContents.send('fs:changed', [...dirs]);
        dirs.clear();
      }, 250);
    });
    watcher.on('error', () => {});
  } catch { /* recursive watch unsupported on this platform */ }
}

function stopWatching() {
  if (watcher) { try { watcher.close(); } catch { /* noop */ } watcher = null; }
}

// ---------- terminal (real PTY) ----------
// Environment for shells: drop variables injected by npm/Electron launchers.
function shellEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(npm_|ELECTRON_|SUNLIGHT_)/i.test(k) || k === 'NODE_ENV' || k === 'INIT_CWD') continue;
    env[k] = v;
  }
  return env;
}

let ptyModule = null;
function loadPty() {
  if (!ptyModule) ptyModule = require('@lydell/node-pty');
  return ptyModule;
}

function createPty(sender, id, { cols, rows, cwd }) {
  const isWin = process.platform === 'win32';
  const shellPath = isWin ? (process.env.ComSpec || 'powershell.exe') : (process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash'));
  let dir = cwd;
  try { if (!dir || !fs.statSync(dir).isDirectory()) dir = os.homedir(); } catch { dir = os.homedir(); }
  const proc = loadPty().spawn(shellPath, isWin ? [] : ['-l'], {
    name: 'xterm-256color',
    cols: Math.max(2, cols | 0 || 80),
    rows: Math.max(1, rows | 0 || 24),
    cwd: dir,
    env: { ...shellEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'SunlightIDE', LANG: process.env.LANG || 'en_US.UTF-8' },
  });
  // Batch output so a flood (e.g. `cat bigfile`) doesn't swamp IPC.
  let pending = '';
  let timer = null;
  const flush = () => {
    timer = null;
    if (pending && !sender.isDestroyed()) sender.send('pty:data', id, pending);
    pending = '';
  };
  proc.onData((d) => {
    pending += d;
    if (pending.length > 65536) { clearTimeout(timer); flush(); } else if (!timer) timer = setTimeout(flush, 6);
  });
  proc.onExit(({ exitCode, signal }) => {
    clearTimeout(timer);
    flush();
    ptys.delete(id);
    if (!sender.isDestroyed()) sender.send('pty:exit', id, exitCode, signal);
  });
  ptys.set(id, proc);
  return { pid: proc.pid, shell: path.basename(shellPath) };
}

function killPty(id) {
  const p = ptys.get(id);
  if (!p) return;
  ptys.delete(id);
  try { p.kill(); } catch { /* already gone */ }
}

function killAllPtys() {
  for (const id of [...ptys.keys()]) killPty(id);
}

// ---------- IPC ----------
function registerIpc() {
  const handle = (name, fn) => ipcMain.handle(name, async (e, ...args) => {
    try { return { ok: true, value: await fn(e, ...args) }; } catch (err) { return { ok: false, error: err.message }; }
  });

  handle('language:run', (_e, method, request) => language.run(method, request));
  handle('settings:get', () => ({ ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) }));
  handle('settings:set', (_e, patch) => {
    const next = { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}), ...patch };
    writeJson('settings.json', next);
    return next;
  });
  const session = new SessionStore(app.getPath('userData'));
  handle('session:get', () => session.load());
  handle('session:save', (_e, snapshot, options) => session.save(snapshot, options));
  ipcMain.on('session:flush', (e, snapshot, options) => {
    try { e.returnValue = { ok: true, value: session.save(snapshot, options) }; }
    catch (err) { e.returnValue = { ok: false, error: err.message }; }
  });
  handle('state:get', () => readJson('state.json', {}));
  handle('state:set', (_e, patch) => { const next = { ...readJson('state.json', {}), ...patch }; writeJson('state.json', next); return next; });
  handle('app:info', () => ({
    version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
    platform: process.platform, home: os.homedir(), systemDark: nativeTheme.shouldUseDarkColors,
  }));

  handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('dialog:openFiles', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  handle('dialog:saveAs', async (_e, suggested) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: suggested });
    return r.canceled ? null : r.filePath;
  });
  handle('dialog:confirm', async (_e, opts) => {
    const r = await dialog.showMessageBox(win, {
      type: opts.type || 'warning', message: opts.message, detail: opts.detail,
      buttons: opts.buttons, defaultId: opts.defaultId ?? 0, cancelId: opts.cancelId ?? opts.buttons.length - 1, noLink: true,
    });
    return r.response;
  });

  handle('fs:readDir', (_e, dir) => readDir(dir));
  handle('fs:readFile', async (_e, file) => {
    const st = await fsp.stat(file);
    if (st.size > MAX_FILE_BYTES) return { tooLarge: true, size: st.size };
    const buf = await fsp.readFile(file);
    if (isBinary(buf)) return { binary: true, size: st.size };
    return { text: buf.toString('utf8'), mtime: st.mtimeMs, size: st.size };
  });
  handle('fs:writeFile', async (_e, file, text) => {
    await fsp.writeFile(file, text, 'utf8');
    return (await fsp.stat(file)).mtimeMs;
  });
  handle('fs:mtime', async (_e, file) => {
    try { return (await fsp.stat(file)).mtimeMs; } catch { return null; }
  });
  handle('fs:isDir', async (_e, p) => {
    try { return (await fsp.stat(p)).isDirectory(); } catch { return false; }
  });
  handle('fs:createFile', async (_e, file) => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, '', { flag: 'wx' });
    return file;
  });
  handle('fs:createDir', async (_e, dir) => { await fsp.mkdir(dir, { recursive: true }); return dir; });
  handle('fs:rename', async (_e, from, to) => {
    if (fs.existsSync(to)) throw new Error(`"${path.basename(to)}" already exists`);
    await fsp.rename(from, to);
    return to;
  });
  handle('fs:trash', async (_e, target) => { await shell.trashItem(target); return true; });
  handle('fs:reveal', (_e, target) => { shell.showItemInFolder(target); return true; });
  handle('fs:listFiles', (_e, root) => listFiles(root));
  handle('fs:watch', (_e, root) => { root ? startWatching(root) : stopWatching(); return true; });

  handle('ext:run', async (_e, method, ...args) => {
    const m = extensions;
    const methods = {
      bootSource: () => fs.readFileSync(path.join(__dirname, 'ext-worker-boot.js'), 'utf8'),
      docs: () => fs.readFileSync(path.join(app.getAppPath(), 'docs', 'extensions.md'), 'utf8'),
      list: () => m.list(),
      catalog: (o) => m.catalog(o || {}),
      install: (id, reviewed) => m.install(id, reviewed),
      inspectFolder: (dir) => m.inspectFolder(dir),
      inspectZip: (file) => m.inspectZip(file),
      installFolder: (dir) => m.installFromFolder(dir),
      installZip: (file) => m.installFromZip(file),
      addDev: (dir) => m.addDev(dir),
      uninstall: (id) => m.uninstall(id),
      setEnabled: (id, on) => m.setEnabled(id, !!on),
      loadMain: (id) => m.loadMain(id),
      readme: (id) => m.readme(id),
      icon: (id) => m.icon(id),
      storageGet: (id) => m.storageGet(id),
      storageSet: (id, obj) => m.storageSet(id, obj),
      scaffold: (parent, o) => m.scaffold(parent, o || {}),
      package: (dir, out) => m.packageExtension(dir, out),
      getRegistry: () => m.getRegistry(),
      setRegistry: (url) => m.setRegistry(url),
    };
    if (!Object.prototype.hasOwnProperty.call(methods, method)) throw new Error(`Unknown extension method: ${method}`);
    return methods[method](...args);
  });

  handle('dialog:pickFile', async (_e, filters) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: Array.isArray(filters) ? filters : undefined });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('dialog:saveFile', async (_e, suggested, filters) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: suggested, filters: Array.isArray(filters) ? filters : undefined });
    return r.canceled ? null : r.filePath;
  });

  handle('git:run', (_e, method, dir, ...args) => git.call(method, dir, args));

  handle('search:run', async (_e, root, query, opts) => {
    const token = ++searchToken;
    return searchFiles(root, query, opts || {}, token);
  });
  handle('search:cancel', () => { searchToken++; return true; });

  handle('pty:create', (e, id, opts) => createPty(e.sender, id, opts || {}));
  ipcMain.on('pty:write', (_e, id, data) => { try { ptys.get(id)?.write(data); } catch { /* exited */ } });
  ipcMain.on('pty:resize', (_e, id, cols, rows) => { try { ptys.get(id)?.resize(Math.max(2, cols | 0), Math.max(1, rows | 0)); } catch { /* exited */ } });
  handle('pty:kill', (_e, id) => { killPty(id); return true; });

  ipcMain.on('app:confirm-close', () => { forceClose = true; if (win) win.close(); });
  ipcMain.on('app:title', (_e, title) => { if (win && !win.isDestroyed()) win.setTitle(title); });
  ipcMain.on('app:theme', (_e, theme) => { nativeTheme.themeSource = theme; });
}

// ---------- smoke test hook (used by automated checks only) ----------
function runSmoke() {
  const script = `const DEMO = ${JSON.stringify(process.env.SUNLIGHT_DEMO || '')};\nconst EXTFIX = ${JSON.stringify(process.env.SUNLIGHT_EXT_FIXTURES || '')};\n` + fs.readFileSync(process.env.SUNLIGHT_SMOKE, 'utf8');
  win.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, Number(process.env.SUNLIGHT_SMOKE_DELAY) || 800));
    try {
      const result = await win.webContents.executeJavaScript(script, true);
      console.log('SMOKE_RESULT ' + JSON.stringify(result));
    } catch (err) {
      console.log('SMOKE_ERROR ' + err.message + '\n' + String(err.stack || '').split('\n').slice(0, 4).join('\n'));
    }
    if (process.env.SUNLIGHT_SHOT) {
      await new Promise((r) => setTimeout(r, 400));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.SUNLIGHT_SHOT, img.toPNG());
    }
    forceClose = true;
    app.quit();
  });
}

app.setName('SunlightIDE');
if (process.env.SUNLIGHT_USER_DATA) app.setPath('userData', process.env.SUNLIGHT_USER_DATA);
app.whenReady().then(() => {
  extensions = new ExtensionManager({ dataDir: app.getPath('userData'), bundledDir: path.join(app.getAppPath(), 'extensions', 'store') });
  if (IS_MAC && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png')); } catch { /* icon is optional */ }
  }
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { forceClose = false; createWindow(); } });
});
app.on('window-all-closed', () => { if (!IS_MAC || process.env.SUNLIGHT_SMOKE) app.quit(); });
app.on('before-quit', () => { forceClose = true; });

app.on('will-quit', () => language.stop());
