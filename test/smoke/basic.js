// Runs inside the renderer via SUNLIGHT_SMOKE. Exercises real editor code paths and returns a report.
(async () => {
  const w = window.__sunlight;
  const ed = () => w.editor;
  const out = { checks: {}, errors: [] };
  const check = (name, ok, extra) => { out.checks[name] = ok ? 'ok' : `FAIL ${JSON.stringify(extra ?? '')}`; };
  window.addEventListener('error', (e) => out.errors.push(e.message));

  await w.setRoot(DEMO);
  await w.openFile(DEMO + '/app.js');
  const e = ed();
  const b = () => e.buffer;
  const P = (line, col) => ({ line, col });
  const typeChars = (t) => { for (const ch of t) e.typeText(ch); };
  const key = (k, opts = {}) => e.input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

  e.render();
  check('doc loaded', b().lineCount > 30, b().lineCount);
  check('explorer lists files', w.explorer.visibleRows().length >= 5, w.explorer.visibleRows().length);
  check('rendered lines', e.linesEl.children.length > 10, e.linesEl.children.length);
  check('tokens colored', e.linesEl.querySelectorAll('.t-kw').length > 3);
  check('indent detected', e.doc.indent.insertSpaces && e.doc.indent.tabSize === 2, e.doc.indent);

  // typing + auto close + overtype
  e.setSel(P(0, 0), P(0, 0));
  key('Enter');
  e.setSel(P(0, 0), P(0, 0));
  typeChars('foo(');
  check('auto-close paren', b().getLine(0) === 'foo()', b().getLine(0));
  e.typeText(')');
  check('overtype closer', b().getLine(0) === 'foo()' && e.head.col === 5, [b().getLine(0), e.head.col]);

  // undo restores
  const before = b().getText();
  e.undo();
  check('undo changes text', b().getText() !== before);
  e.redo();
  check('redo restores text', b().getText() === before);

  // newline auto-indent between braces
  e.setSel(P(0, 0), P(b().lineCount - 1, 0));
  e.deleteSelection();
  typeChars('function f() {');
  check('brace auto-closed', b().getLine(0) === 'function f() {}', b().getLine(0));
  key('Enter');
  check('enter between braces', b().getLine(1) === '  ' && b().getLine(2) === '}', [b().getLine(1), b().getLine(2)]);
  check('caret indented', e.head.line === 1 && e.head.col === 2, e.head);
  e.typeText('x');
  e.undo();
  check('typing undo step', b().getLine(1) === '  ', b().getLine(1));

  // toggle comment
  e.setSel(P(1, 0), P(1, 2));
  typeChars('return 1');
  e.toggleComment();
  check('comment on', b().getLine(1).trimStart().startsWith('// '), b().getLine(1));
  e.toggleComment();
  check('comment off', !b().getLine(1).includes('//'), b().getLine(1));

  // move & duplicate lines
  const l1 = b().getLine(1);
  e.setSel(P(1, 3), P(1, 3));
  e.moveLines(-1);
  check('move line up', b().getLine(0) === l1 && e.head.line === 0, [b().getLine(0), e.head.line]);
  e.duplicateLines(1);
  check('duplicate line', b().getLine(0) === b().getLine(1));

  // find / replace all
  e.setFind({ query: 'return', caseSensitive: false, wholeWord: false, regex: false }, { jump: true });
  check('find matches', e.matches.length >= 2, e.matches.length);
  const n = e.replaceAll('yield');
  check('replace all', n >= 2 && !b().getText().includes('return'), n);
  e.clearFind();

  // switch to another file keeps state per doc
  e.setSel(P(0, 0), P(0, 0));
  const docA = e.doc;
  await w.openFile(DEMO + '/index.html');
  e.render();
  check('html tokens', e.linesEl.querySelectorAll('.t-tag').length > 3);
  await w.openFile(DEMO + '/src/util.py');
  e.render();
  check('python tokens', e.linesEl.querySelectorAll('.t-kw').length > 3 && e.linesEl.querySelectorAll('.t-str').length > 1);
  w.activate(docA);
  check('doc switch preserves buffer', e.doc === docA && b().getLine(0).length > 0);

  // selection geometry
  e.setSel(P(0, 0), P(2, 1));
  e.render();
  check('selection rects', e.selEl.children.length === 3, e.selEl.children.length);

  // save to disk (to a scratch copy)
  await w.openFile(DEMO + '/README.md');
  e.setSel(P(0, 0), P(0, 0));
  e.typeText('X');
  const doc = w.S.active;
  check('dirty after edit', doc.buffer.dirty);
  await w.save(doc);
  check('clean after save', !doc.buffer.dirty);

  // large document performance
  const big = Array.from({ length: 60000 }, (_, i) => `const v${i} = ${i} + "x"; // line ${i}`).join('\n');
  w.newUntitled();
  const bd = w.S.active;
  bd.setLang('javascript');
  const t0 = performance.now();
  e.edit(P(0, 0), P(0, 0), big);
  e.setSel(P(59000, 0), P(59000, 0));
  e.render();
  const ms = Math.round(performance.now() - t0);
  check('60k-line doc under 1500ms', ms < 1500, ms);
  out.bigDocMs = ms;
  e.gotoLine(0, 0);
  e.setSel(P(0, 0), P(0, 0));

  out.errors = out.errors.slice(0, 5);
  out.failed = Object.entries(out.checks).filter(([, v]) => v !== 'ok');
  out.passed = Object.values(out.checks).filter((v) => v === 'ok').length;
  delete out.checks;
  return out;
})();
