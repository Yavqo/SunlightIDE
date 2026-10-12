(async () => {
  const w = window.__sunlight;
  const out = { checks: {}, errors: [] };
  const check = (n, ok, x) => { out.checks[n] = ok ? 'ok' : `FAIL ${JSON.stringify(x ?? '')}`; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor0 = async (fn, ms = 3000) => { for (let i = 0; i < ms / 50; i++) { if (fn()) return true; await wait(50); } return fn(); };
  const idle = async () => { for (let i = 0; i < 100 && w.terminal.running; i++) await wait(100); };
  const $ = (s) => document.querySelector(s);
  window.addEventListener('error', (e) => out.errors.push(e.message));

  check('welcome shown with no docs', !$('#welcome').hidden);
  await w.setRoot(DEMO);
  await w.openFile(DEMO + '/app.js');
  const e = w.editor;
  check('welcome hidden once file open', $('#welcome').hidden);

  // real input path: focused textarea + insertText fires genuine input events
  e.focus();
  e.setSel({ line: 0, col: 0 }, { line: 0, col: 0 });
  document.execCommand('insertText', false, 'Z');
  check('textarea input reaches buffer', e.buffer.getLine(0).startsWith('Z//'), e.buffer.getLine(0));
  check('textarea cleared after input', e.input.value === '', e.input.value);

  // real keydown dispatch on the focused textarea
  const key = (k, o = {}) => e.input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  key('Backspace');
  check('backspace deletes', e.buffer.getLine(0).startsWith('//'), e.buffer.getLine(0));
  key('End');
  check('end key', e.head.col === e.buffer.getLine(0).length, e.head);
  key('ArrowDown', { shiftKey: true });
  check('shift+down selects', e.hasSelection());
  key('a', { metaKey: true });
  check('select all', e.getSelectionText().length === e.buffer.getText().length);
  key('ArrowLeft');
  check('left collapses to start', !e.hasSelection() && e.head.line === 0 && e.head.col === 0, e.head);

  // completion popup
  e.setSel({ line: 36, col: 0 }, { line: 36, col: 0 });
  e.setSel({ line: e.buffer.lineCount - 1, col: 0 }, { line: e.buffer.lineCount - 1, col: 0 });
  for (const ch of 'TodoS') e.typeText(ch);
  check('completion opens', !!e.completion && e.completion.items.some((i) => i.label === 'TodoStore'), e.completion);
  check('ghost text previews remainder', !e.ghostEl.hidden && e.ghostEl.textContent === 'tore', [e.ghostEl.hidden, e.ghostEl.textContent]);
  key('Tab');
  check('completion accepted', e.buffer.getLine(e.head.line).endsWith('TodoStore'), e.buffer.getLine(e.head.line));
  e.undo(); e.undo();

  // snippets: expand `log`, then a multi-line `forof` with indentation
  e.setSel({ line: e.buffer.lineCount - 1, col: 0 }, { line: e.buffer.lineCount - 1, col: 0 });
  e.typeText('\n');
  for (const ch of 'log') e.typeText(ch);
  check('snippet offered', !!e.completion && e.completion.items[0].kind === 'snippet' && e.completion.items[0].label === 'log', e.completion?.items?.[0]);
  key('Tab');
  const logLine = e.buffer.getLine(e.head.line);
  check('snippet expands with caret inside', logLine === 'console.log()' && e.head.col === 12, [logLine, e.head]);
  e.setSel({ line: e.buffer.lineCount - 1, col: 99999 }, { line: e.buffer.lineCount - 1, col: 99999 });
  e.typeText('\n');
  for (const ch of 'forof') e.typeText(ch);
  key('Tab');
  const fl = e.head.line;
  check('multi-line snippet', e.buffer.getLine(fl - 0).startsWith('  ') || e.buffer.getLine(fl).startsWith('for'), e.buffer.getLine(fl));
  check('snippet body present', e.buffer.getLine(fl).startsWith('for (const item of items) {') || e.buffer.getLine(fl - 1).startsWith('for (const item of items) {'), [e.buffer.getLine(fl - 1), e.buffer.getLine(fl)]);
  e.undo();
  check('snippet undoes in one step', !e.buffer.getText().includes('for (const item') && e.buffer.getLine(e.head.line) === 'forof', e.buffer.getLine(e.head.line));
  // manual trigger with short prefix
  e.setSel({ line: e.buffer.lineCount - 1, col: 99999 }, { line: e.buffer.lineCount - 1, col: 99999 });
  e.typeText('\n');
  e.typeText('t');
  e.updateCompletion(true);
  check('ctrl+space opens with 1 char', !!e.completion, e.completion);
  key('Escape');
  check('escape dismisses', !e.completion && e.ghostEl.hidden);
  while (e.buffer.undoStack.length > 1 && e.buffer.getText().includes('console.log()')) e.undo();

  // palette
  w.runCommand('palette');
  await wait(100);
  check('palette opens', !$('#overlay').hidden && !!$('.palette'));
  const pin = $('.palette input');
  check('palette starts with ">"', pin.value === '>', pin.value);
  pin.value = '>toggle term';
  pin.dispatchEvent(new Event('input'));
  await wait(100);
  const first = $('.p-item .pl')?.textContent;
  check('palette fuzzy finds command', /Toggle Terminal/.test(first || ''), first);
  pin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('palette closes on Esc', $('#overlay').hidden);

  // quick open
  w.runCommand('quick-open');
  await wait(300);
  const qin = $('.palette input');
  qin.value = 'viewjs';
  qin.dispatchEvent(new Event('input'));
  await wait(300);
  check('quick open finds src/view.js', /view\.js/.test($('.p-item .pl')?.textContent || ''), $('.p-item .pl')?.textContent);
  qin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(300);
  check('quick open opens file', w.S.active?.name === 'view.js', w.S.active?.name);

  // pick() and prompt() must resolve with the chosen value (regression: they used to resolve as cancelled)
  await w.openFile(DEMO + '/app.js');
  w.runCommand('change-language');
  await wait(150);
  const lin = $('.palette input');
  lin.value = 'python';
  lin.dispatchEvent(new Event('input'));
  await wait(100);
  lin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check('language picker applies the choice', await waitFor0(() => w.S.active.lang === 'python'), w.S.active.lang);
  w.S.active.setLang('javascript');

  // goto line
  await w.openFile(DEMO + '/app.js');
  w.runCommand('goto-line');
  await wait(100);
  const gin = $('.palette input');
  gin.value = ':12';
  gin.dispatchEvent(new Event('input'));
  gin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(100);
  check('goto line moves caret', e.head.line === 11, e.head);

  // explorer: create file inline
  await w.explorer.startCreate('file');
  const rin = $('#tree input.rename');
  check('inline create input shown', !!rin);
  rin.value = 'created-by-test.txt';
  rin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(500);
  check('created file opens in tab', w.S.active?.name === 'created-by-test.txt', w.S.active?.name);
  check('created file listed in tree', !!document.querySelector('[data-path$="created-by-test.txt"]'));

  // search in files
  w.runCommand('search-in-files');
  await wait(100);
  const sin = $('#search-input');
  sin.value = 'TodoStore';
  sin.dispatchEvent(new Event('input'));
  await wait(1200);
  check('search shows hits', document.querySelectorAll('.sr-hit').length >= 2, document.querySelectorAll('.sr-hit').length);
  document.querySelector('.sr-hit')?.click();
  await wait(400);
  check('search hit opens file at match', w.S.active?.name === 'app.js' && w.editor.hasSelection(), w.S.active?.name);

  // mouse: click, double-click word, triple-click line, drag select
  await w.openFile(DEMO + '/app.js');
  e.scroller.scrollTop = 0; e.scroller.scrollLeft = 0;
  e.render();
  const at = (line, col) => {
    const r = e.scroller.getBoundingClientRect();
    return { clientX: r.left + 12 + col * e.charW + 1, clientY: r.top + line * e.lh - e.scroller.scrollTop + e.lh / 2 };
  };
  const mouse = (type, line, col, o = {}) => (type === 'mousedown' ? e.scroller : window).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...at(line, col), ...o }));
  mouse('mousedown', 7, 0); mouse('mouseup', 7, 0);
  check('click places caret at col 0', e.head.line === 7 && e.head.col === 0, e.head);
  mouse('mousedown', 5, 8); mouse('mouseup', 5, 8);
  check('click mid-line', e.head.line === 5 && e.head.col === 8, e.head);
  mouse('mousedown', 5, 8, { detail: 2 }); mouse('mouseup', 5, 8);
  check('double-click selects word', e.getSelectionText() === 'TodoStore', e.getSelectionText());
  mouse('mousedown', 3, 4, { detail: 3 }); mouse('mouseup', 3, 4);
  check('triple-click selects line', e.getSelectionText() === e.buffer.getLine(3) + '\n', e.getSelectionText());
  mouse('mousedown', 8, 2); mouse('mousemove', 9, 6); mouse('mouseup', 9, 6);
  check('drag selects range', e.anchor.line === 8 && e.anchor.col === 2 && e.head.line === 9 && e.head.col === 6, [e.anchor, e.head]);
  mouse('mousedown', 12, 0); mouse('mouseup', 12, 0);
  mouse('mousedown', 14, 5, { shiftKey: true }); mouse('mouseup', 14, 5);
  check('shift-click extends', e.anchor.line === 12 && e.head.line === 14 && e.head.col === 5, [e.anchor, e.head]);
  mouse('mousedown', 9999, 0); mouse('mouseup', 9999, 0);
  check('click below last line clamps', e.head.line === e.buffer.lineCount - 1, e.head);

  // settings dialog + theme
  w.runCommand('settings');
  await wait(100);
  check('settings dialog opens', !!$('.dialog'));
  document.querySelectorAll('.seg button')[1].click();
  await wait(100);
  check('dark theme applied', document.documentElement.dataset.theme === 'dark');
  document.querySelectorAll('.seg button')[0].click();
  check('light theme applied', document.documentElement.dataset.theme === 'light');

  // terminal: real PTY session
  const waitFor = async (fn, ms = 12000) => { for (let i = 0; i < ms / 100; i++) { if (fn()) return true; await wait(100); } return false; };
  w.runCommand('toggle-terminal');
  const t = w.terminal;
  check('terminal session created', await waitFor(() => t.sessions.length === 1 && t.active), t.sessions.length);
  await waitFor(() => t.bufferText().trim().length > 0, 15000);
  t.sendText('echo SUNLIGHT_$((20+22))\r');
  check('shell executes commands', await waitFor(() => /^SUNLIGHT_42/m.test(t.bufferText())), t.bufferText().slice(-200));
  t.sendText('tty\r');
  check('session is a real tty', await waitFor(() => /\/dev\/ttys?\d+|\/dev\/pts\/\d+/.test(t.bufferText())), t.bufferText().slice(-200));
  t.sendText('cd src && pwd\r');
  check('cd persists in session', await waitFor(() => /^\/.*\/src$/m.test(t.bufferText())), t.bufferText().slice(-200));
  t.sendText('read -r name; echo GOT_$name\r');
  await wait(300);
  t.sendText('sunlight\r');
  check('interactive input works', await waitFor(() => /^GOT_sunlight/m.test(t.bufferText())), t.bufferText().slice(-200));
  t.sendText('stty size\r');
  const dims = `${t.active.term.rows} ${t.active.term.cols}`;
  check('pty size matches terminal', await waitFor(() => new RegExp(`^${dims}$`, 'm').test(t.bufferText())), [dims, t.bufferText().slice(-120)]);
  t.sendText('printf "\\033[31mRED\\033[0m\\n"\r');
  await waitFor(() => /RED/.test(t.bufferText()));
  check('ANSI output rendered as text (no raw escapes)', /^RED$/m.test(t.bufferText()), t.bufferText().slice(-120));

  // second session, switching, killing
  await t.newSession();
  check('second session', t.sessions.length === 2 && t.active === t.sessions[1], t.sessions.length);
  check('session tabs rendered', document.querySelectorAll('.tterm').length === 2);
  t.activate(t.sessions[0]);
  check('switch session', t.active === t.sessions[0]);
  t.sendText('exit\r');
  check('exit closes session', await waitFor(() => t.sessions.length === 1), t.sessions.length);
  t.killActive();
  check('last session closes panel', await waitFor(() => w.S.ui.terminal === false && $('#terminal').hidden), [w.S.ui.terminal, $('#terminal').hidden]);

  out.failed = Object.entries(out.checks).filter(([, v]) => v !== 'ok');
  out.passed = Object.values(out.checks).filter((v) => v === 'ok').length;
  delete out.checks;
  return out;
})();
