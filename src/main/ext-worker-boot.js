// Runs first inside every extension's sandboxed Web Worker (the extension's own code is appended after it).
// It defines the global `sunlight` object. Every capability is a message to the host, which re-checks the
// extension's declared permissions: nothing in here is trusted, it only makes the API pleasant to use.
//
// The host fills in the extension's { id, version, apiVersion } where `info` is defined below.
'use strict';
(function () {
  const info = __SUNLIGHT_INFO__;
  const post = self.postMessage.bind(self);

  let nextId = 1;
  const pending = new Map();
  const commands = new Map();
  const listeners = new Map();

  function rpc(method, ...args) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      try { post({ t: 'req', id, m: method, a: args }); } catch (err) { pending.delete(id); reject(new Error('Could not send the request: ' + err.message)); }
    });
  }

  const format = (args) => args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
  const log = (level, args) => { try { post({ t: 'log', level, text: format(args).slice(0, 2000) }); } catch { /* ignore */ } };

  // Safe-to-clone result of a command (functions and DOM objects can't cross the boundary).
  const clone = (v) => { try { return JSON.parse(JSON.stringify(v === undefined ? null : v)); } catch { return null; } };

  self.addEventListener('message', async (ev) => {
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.t === 'res') {
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.ok) p.resolve(d.v); else p.reject(new Error(d.e || 'The request failed.'));
    } else if (d.t === 'cmd') {
      const fn = commands.get(d.name);
      if (!fn) { post({ t: 'cres', id: d.id, ok: false, e: `Command "${d.name}" was not registered with sunlight.commands.register().` }); return; }
      try {
        const v = await fn(...(Array.isArray(d.args) ? d.args : []));
        post({ t: 'cres', id: d.id, ok: true, v: clone(v) });
      } catch (e) {
        post({ t: 'cres', id: d.id, ok: false, e: String((e && e.message) || e) });
      }
    } else if (d.t === 'event') {
      for (const cb of listeners.get(d.name) || []) {
        try { cb(d.data); } catch (e) { log('error', ['Error in "' + d.name + '" listener:', e]); }
      }
    }
  });

  const str = (v, name) => { if (typeof v !== 'string') throw new TypeError(name + ' must be a string'); return v; };

  const api = {
    version: info.apiVersion,
    extension: Object.freeze({ id: info.id, version: info.version }),

    commands: {
      // Register the handler for a command declared in manifest.json (use the local id, e.g. "hello").
      register(id, handler) {
        str(id, 'id');
        if (typeof handler !== 'function') throw new TypeError('handler must be a function');
        commands.set(id, handler);
        post({ t: 'reg', id });
      },
      // Run one of your own commands, or another extension's by its full id ("publisher.name.command").
      execute: (id, ...args) => rpc('commands.execute', str(id, 'id'), args),
    },

    window: {
      showMessage: (text, options) => rpc('window.showMessage', String(text), options || {}),
      showInput: (options) => rpc('window.showInput', options || {}),
      showPick: (items, options) => rpc('window.showPick', items, options || {}),
    },

    statusBar: {
      setItem: (id, item) => rpc('statusBar.setItem', str(id, 'id'), item || {}),
      removeItem: (id) => rpc('statusBar.removeItem', str(id, 'id')),
    },

    editor: {
      getActive: () => rpc('editor.getActive'),
      getText: () => rpc('editor.getText'),
      getLine: (n) => rpc('editor.getLine', n),
      getSelections: () => rpc('editor.getSelections'),
      replaceSelections: (textOrArray) => rpc('editor.replaceSelections', textOrArray),
      insertText: (text) => rpc('editor.insertText', str(text, 'text')),
      setText: (text) => rpc('editor.setText', str(text, 'text')),
      replaceRange: (range, text) => rpc('editor.replaceRange', range, str(text, 'text')),
      setSelections: (selections) => rpc('editor.setSelections', selections),
    },

    workspace: {
      getFolder: () => rpc('workspace.getFolder'),
      readFile: (path) => rpc('workspace.readFile', str(path, 'path')),
      writeFile: (path, text) => rpc('workspace.writeFile', str(path, 'path'), str(text, 'text')),
      listFiles: (options) => rpc('workspace.listFiles', options || {}),
    },

    storage: {
      get: (key, fallback) => rpc('storage.get', str(key, 'key')).then((v) => (v === undefined || v === null ? fallback : v)),
      set: (key, value) => rpc('storage.set', str(key, 'key'), value),
      delete: (key) => rpc('storage.delete', str(key, 'key')),
      keys: () => rpc('storage.keys'),
    },

    events: {
      // Names: activeFileChanged, fileOpened, fileSaved, selectionChanged, textChanged. Returns { dispose() }.
      on(name, callback) {
        str(name, 'name');
        if (typeof callback !== 'function') throw new TypeError('callback must be a function');
        if (!listeners.has(name)) { listeners.set(name, new Set()); post({ t: 'sub', name }); }
        listeners.get(name).add(callback);
        return { dispose: () => listeners.get(name) && listeners.get(name).delete(callback) };
      },
    },
  };

  // Freeze the API so extension code can't swap out methods other code relies on.
  const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };
  Object.defineProperty(self, 'sunlight', { value: deepFreeze(api), enumerable: true });

  // console.* goes to the Extension Log (Developer: Show Extension Log).
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) self.console[level] = (...args) => log(level, args);
  self.addEventListener('unhandledrejection', (e) => log('error', ['Unhandled promise rejection:', e.reason]));
  self.addEventListener('error', (e) => log('error', [e.message]));

  // Second layer of defence. The page's Content-Security-Policy already forbids network access and
  // the host validates every request, but there is no reason to leave these lying around.
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'SharedWorker', 'Worker', 'WebTransport', 'RTCPeerConnection']) {
    try { Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false }); } catch { /* not configurable here */ }
  }
})();
