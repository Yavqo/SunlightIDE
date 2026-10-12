
const out = {};
const attempt = async (name, fn) => { try { const v = await fn(); out[name] = 'ALLOWED:' + JSON.stringify(v); } catch (e) { out[name] = 'rejected: ' + e.message; } };

sunlight.commands.register('probe', async () => {
  // 1. Privileged API calls without the permission.
  await attempt('getText', () => sunlight.editor.getText());
  await attempt('getActive', () => sunlight.editor.getActive());
  await attempt('insertText', () => sunlight.editor.insertText('pwned'));
  await attempt('getFolder', () => sunlight.workspace.getFolder());
  await attempt('readFile', () => sunlight.workspace.readFile('app.js'));
  await attempt('writeFile', () => sunlight.workspace.writeFile('pwned.txt', 'x'));
  await attempt('storage', () => sunlight.storage.set('k', 1));

  // 2. Forged protocol messages that bypass the friendly API.
  const replies = {};
  self.addEventListener('message', (e) => { if (e.data && e.data.t === 'res') replies[e.data.id] = e.data; });
  const forge = (id, m, a) => self.postMessage({ t: 'req', id, m, a });
  forge(9001, 'editor.getText', []);
  forge(9002, '__proto__', []);
  forge(9003, 'constructor', []);
  forge(9004, 'toString', []);
  forge(9005, 'fs.readFile', ['/etc/passwd']);
  forge(9006, 'workspace.readFile', ['../../etc/passwd']);
  forge(9007, 'editor.getText', 'not-an-array');
  forge('9008', 'editor.getText', []);
  await new Promise((r) => setTimeout(r, 300));
  out.forged = Object.fromEntries(Object.entries(replies).map(([id, r]) => [id, r.ok ? 'ALLOWED' : r.e]));

  // 3. What does the sandbox expose?
  out.globals = {
    document: typeof document, window: typeof window, require: typeof require, process: typeof process,
    localStorage: typeof localStorage, fetch: typeof fetch, xhr: typeof XMLHttpRequest, ws: typeof WebSocket,
    importScripts: typeof importScripts, indexedDB: typeof indexedDB, worker: typeof Worker, sendBeacon: typeof (self.navigator && self.navigator.sendBeacon),
    electron: typeof electron, sunlightHost: typeof sunlightHost,
  };
  // 4. The API object cannot be tampered with.
  try { sunlight.editor.getText = () => 'hijacked'; } catch (e) { /* frozen: strict mode throws */ }
  out.frozen = Object.isFrozen(sunlight) && Object.isFrozen(sunlight.editor);
  // 5. Try to reach the network the long way round.
  out.network = 'none';
  try { const f = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(self), 'fetch'); out.network = f ? 'prototype-has-fetch' : 'no-fetch-on-prototype'; } catch (e) { out.network = 'error'; }
  return out;
});
sunlight.commands.register('spam', async () => { for (let i = 0; i < 25; i++) await sunlight.window.showMessage('spam ' + i); return 'done'; });
