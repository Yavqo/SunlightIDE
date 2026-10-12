'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Every call returns the unwrapped value or throws, so the renderer can use plain async/await.
const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

const listen = (channel, fn) => {
  const handler = (_e, ...args) => fn(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('sunlight', {
  settings: { get: () => call('settings:get'), set: (p) => call('settings:set', p) },
  session: {
    get: () => call('session:get'), save: (snapshot, options) => call('session:save', snapshot, options),
    flush: (snapshot, options) => { const r = ipcRenderer.sendSync('session:flush', snapshot, options); if (!r.ok) throw new Error(r.error); return r.value; },
  },
  state: { get: () => call('state:get'), set: (p) => call('state:set', p) },
  info: () => call('app:info'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  dialog: {
    openFolder: () => call('dialog:openFolder'),
    openFiles: () => call('dialog:openFiles'),
    saveAs: (suggested) => call('dialog:saveAs', suggested),
    confirm: (opts) => call('dialog:confirm', opts),
  },
  fs: {
    readDir: (d) => call('fs:readDir', d),
    readFile: (f) => call('fs:readFile', f),
    writeFile: (f, t) => call('fs:writeFile', f, t),
    mtime: (f) => call('fs:mtime', f),
    isDir: (p) => call('fs:isDir', p),
    createFile: (f) => call('fs:createFile', f),
    createDir: (d) => call('fs:createDir', d),
    rename: (a, b) => call('fs:rename', a, b),
    trash: (p) => call('fs:trash', p),
    reveal: (p) => call('fs:reveal', p),
    listFiles: (root) => call('fs:listFiles', root),
    watch: (root) => call('fs:watch', root),
    onChanged: (fn) => listen('fs:changed', fn),
  },
  language: (method, request) => call('language:run', method, request),
  git: (method, dir, ...args) => call('git:run', method, dir, ...args),
  ext: (method, ...args) => call('ext:run', method, ...args),
  pickFile: (filters) => call('dialog:pickFile', filters),
  saveFile: (suggested, filters) => call('dialog:saveFile', suggested, filters),
  search: {
    run: (root, q, opts) => call('search:run', root, q, opts),
    cancel: () => call('search:cancel'),
  },
  pty: {
    create: (id, opts) => call('pty:create', id, opts),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => call('pty:kill', id),
    onData: (fn) => listen('pty:data', fn),
    onExit: (fn) => listen('pty:exit', fn),
  },
  app: {
    onMenu: (fn) => listen('menu', fn),
    onRequestClose: (fn) => listen('app:request-close', fn),
    confirmClose: () => ipcRenderer.send('app:confirm-close'),
    setTitle: (t) => ipcRenderer.send('app:title', t),
    setTheme: (t) => ipcRenderer.send('app:theme', t),
  },
});
