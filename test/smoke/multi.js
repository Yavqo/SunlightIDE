(async () => {
  const w = window.__sunlight;
  const out = { checks: {}, errors: [] };
  const check = (n, ok, x) => { out.checks[n] = ok ? 'ok' : `FAIL ${JSON.stringify(x ?? '')}`; };
  window.addEventListener('error', (e) => out.errors.push(e.message));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { for (let i = 0; i < ms / 50; i++) { if (fn()) return true; await wait(50); } return fn(); };
  const ensureFocus = async () => { await waitFor(() => { e.focus(); return e.focused; }, 2000); };
  const P = (line, col) => ({ line, col });
  w.newUntitled();
  const e = w.editor;
  w.S.active.setLang('javascript');
  e.focus();
  const key = (k, o = {}) => e.input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const type = (t) => { for (const ch of t) e.typeText(ch); };
  const setText = (t) => { e.setSel(P(0, 0), P(e.buffer.lineCount - 1, 99999)); e.deleteSelection(); e.edit(P(0, 0), P(0, 0), t); e.setSel(P(0, 0), P(0, 0)); };
  const text = () => e.buffer.getText();
  const carets = () => e.sels.map((s) => `${s.head.line}:${s.head.col}`).join(' ');

  // ---- add cursors below, type, undo ----
  setText('one\ntwo\nthree\nfour');
  e.addCursorVertical(1); e.addCursorVertical(1);
  check('add cursor below x2', e.sels.length === 3, carets());
  type('X');
  check('typing hits every cursor', text() === 'Xone\nXtwo\nXthree\nfour', text());
  check('cursors advance together', carets() === '0:1 1:1 2:1', carets());
  e.undo();
  check('undo is a single step for all cursors', text() === 'one\ntwo\nthree\nfour' && e.sels.length === 3, [text(), e.sels.length]);
  e.redo();
  check('redo restores text and cursors', text() === 'Xone\nXtwo\nXthree\nfour' && e.sels.length === 3, [text(), e.sels.length]);
  key('Backspace');
  check('backspace on every cursor', text() === 'one\ntwo\nthree\nfour', text());
  key('Escape');
  check('escape collapses to one cursor', e.sels.length === 1);

  // ---- Cmd+D flow ----
  setText('foo bar foo baz foo');
  e.setSel(P(0, 1), P(0, 1));
  e._selectNextOccurrence();
  check('first Cmd+D selects the word', e.getSelectionText() === 'foo' && e.sels.length === 1);
  e._selectNextOccurrence(); e._selectNextOccurrence();
  check('Cmd+D adds next occurrences', e.sels.length === 3, e.sels.length);
  e._selectNextOccurrence();
  check('Cmd+D stops when all are selected', e.sels.length === 3, e.sels.length);
  type('qux');
  check('typing replaces every selection', text() === 'qux bar qux baz qux', text());
  check('cursors end after each insert', carets() === '0:3 0:11 0:19', carets());
  e.undo();
  check('undo restores all three selections', text() === 'foo bar foo baz foo' && e.sels.length === 3 && e.getSelectionText() === 'foo', [text(), e.sels.length]);

  // ---- select all occurrences ----
  setText('a.b a.b\nxa.b\na.b');
  e.setSel(P(0, 0), P(0, 3));
  e.selectAllOccurrences();
  check('select all occurrences', e.sels.length === 4, e.sels.length);
  key('Delete');
  check('delete across all', text() === ' \nx\n', JSON.stringify(text()));

  // ---- newline / tab / auto-close per cursor ----
  setText('f(\ng(');
  e.setSel(P(0, 2), P(0, 2));
  e.addCursorVertical(1);
  e.sels.forEach((s) => { s.head = P(s.head.line, 2); s.anchor = P(s.anchor.line, 2); });
  type('1');
  check('multi type digits', text() === 'f(1\ng(1', text());
  setText('{\n{');
  e.setSel(P(0, 1), P(0, 1)); e.addCursorVertical(1);
  key('Enter');
  check('enter indents at each cursor', text() === '{\n' + e.indentUnit + '\n{\n' + e.indentUnit, JSON.stringify(text()));
  check('cursors on the new lines', carets() === `1:${e.indentUnit.length} 3:${e.indentUnit.length}`, carets());
  setText('a\nb\nc');
  e.setSel(P(0, 0), P(0, 0)); e.addCursorVertical(1); e.addCursorVertical(1);
  key('Tab');
  check('tab inserts at every cursor', text() === `${e.indentUnit}a\n${e.indentUnit}b\n${e.indentUnit}c`, JSON.stringify(text()));
  key('Tab', { shiftKey: true });
  check('shift+tab outdents every line', text() === 'a\nb\nc', JSON.stringify(text()));
  setText('(a)\n(b)');
  e.setSel(P(0, 0), P(0, 3)); e.sels.push({ anchor: P(1, 0), head: P(1, 3) }); e.commitSels(e.sels, e.main);
  type('[');
  check('wrap each selection in brackets', text() === '[(a)]\n[(b)]', text());

  // ---- line commands across cursors ----
  setText('a\nb\nc\nd\ne');
  e.setSel(P(0, 0), P(0, 0)); e.sels.push({ anchor: P(2, 0), head: P(2, 0) }); e.commitSels(e.sels, e.main);
  e.toggleComment();
  check('comment toggles on both lines', text() === '// a\nb\n// c\nd\ne', JSON.stringify(text()));
  e.toggleComment();
  check('comment toggles off', text() === 'a\nb\nc\nd\ne', JSON.stringify(text()));
  e.moveLines(1);
  check('move lines down for each block', text() === 'b\na\nd\nc\ne', JSON.stringify(text()));
  check('cursors follow moved lines', carets() === '1:0 3:0', carets());
  e.duplicateLines(1);
  check('duplicate each block', text() === 'b\na\na\nd\nc\nc\ne', JSON.stringify(text()));
  e.deleteLines();
  check('delete each line', text() === 'b\na\nd\nc\ne' || text().split('\n').length === 5, JSON.stringify(text()));

  // ---- clipboard: copy joins, paste distributes ----
  setText('x\ny\nz');
  e.setSel(P(0, 0), P(0, 1)); e.sels.push({ anchor: P(2, 0), head: P(2, 1) }); e.commitSels(e.sels, e.main);
  check('clipboard text joins selections', e.clipboardText() === 'x\nz', e.clipboardText());
  const pasteEvt = (txt) => { const dt = new DataTransfer(); dt.setData('text/plain', txt); e.input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); };
  pasteEvt('1\n2');
  check('paste spreads lines over cursors', text() === '1\ny\n2', JSON.stringify(text()));
  setText('a\nb');
  e.setSel(P(0, 1), P(0, 1)); e.addCursorVertical(1);
  pasteEvt('Q');
  check('paste repeats single text', text() === 'aQ\nbQ', JSON.stringify(text()));

  // ---- mouse: alt+click add/remove, alt+shift+drag column ----
  setText('0123456789\n0123456789\n0123456789\n0123456789');
  e.scroller.scrollTop = 0; e.scroller.scrollLeft = 0; e.render();
  const at = (line, col) => { const r = e.scroller.getBoundingClientRect(); return { clientX: r.left + 12 + col * e.charW + 1, clientY: r.top + line * e.lh - e.scroller.scrollTop + e.lh / 2 }; };
  const mouse = (type, line, col, o = {}) => (type === 'mousedown' ? e.scroller : window).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...at(line, col), ...o }));
  mouse('mousedown', 0, 2); mouse('mouseup', 0, 2);
  mouse('mousedown', 2, 5, { altKey: true }); mouse('mouseup', 2, 5, { altKey: true });
  check('alt+click adds a cursor', e.sels.length === 2 && carets() === '0:2 2:5', carets());
  mouse('mousedown', 2, 5, { altKey: true }); mouse('mouseup', 2, 5, { altKey: true });
  check('alt+click on a cursor removes it', e.sels.length === 1 && carets() === '0:2', carets());
  mouse('mousedown', 1, 3, { altKey: true }); mouse('mousemove', 1, 6, { altKey: true }); mouse('mouseup', 1, 6, { altKey: true });
  check('alt+click+drag selects a range as a second selection', e.sels.length === 2 && e.getSelectionText() === '345', [e.sels.length, e.getSelectionText()]);
  mouse('mousedown', 0, 2); mouse('mouseup', 0, 2);
  mouse('mousedown', 0, 2, { altKey: true, shiftKey: true }); mouse('mousemove', 3, 5, { altKey: true, shiftKey: true }); mouse('mouseup', 3, 5, { altKey: true, shiftKey: true });
  check('column select spans 4 lines', e.sels.length === 4 && e.sels.every((s) => s.anchor.col === 2 && s.head.col === 5), carets());
  key('Delete');
  check('deleting a column removes the block', text() === '0156789\n0156789\n0156789\n0156789', JSON.stringify(text()));
  e.setSel(P(0, 0), P(0, 0));

  // ---- status event reports cursors ----
  let info = null; e.on('cursor', (c) => { info = c; });
  await ensureFocus();
  e.addCursorVertical(1); e.addCursorVertical(1);
  check('cursor event reports count', info && info.cursors === 3, info);
  e.render();
  check('extra cursors drawn', e.cursorsEl.children.length === 2, e.cursorsEl.children.length);
  e.setSel(P(0, 0), P(0, 0));
  e.render();
  check('single cursor draws none extra', e.cursorsEl.children.length === 0);

  // =================== word wrap ===================
  const long = ('lorem ipsum dolor sit amet consectetur ').repeat(14).trim();
  setText(`short line\n${long}\n    indented ${long}\nend`);
  e.setSel(P(0, 0), P(0, 0));
  e.setOptions({ wordWrap: true });
  await waitFor(() => e.wrap && Number.isFinite(e.wrapCols));
  e.render();
  check('wrap enabled', e.wrap && e.wrapCols < long.length && Number.isFinite(e.wrapCols), e.wrapCols);
  check('long line takes several rows', e.rowsInLine(1) >= 3, e.rowsInLine(1));
  check('short line is one row', e.rowsInLine(0) === 1 && e.rowsInLine(3) === 1);
  check('total rows exceed line count', e.totalRows > e.buffer.lineCount, [e.totalRows, e.buffer.lineCount]);
  check('no horizontal overflow', e.scroller.scrollWidth <= e.scroller.clientWidth + 1, [e.scroller.scrollWidth, e.scroller.clientWidth]);
  check('rendered row elements', e.linesEl.querySelectorAll('.vr').length >= e.rowsInLine(1) + e.rowsInLine(2), e.linesEl.querySelectorAll('.vr').length);
  check('gutter has one number per line', e.gutterInner.children.length === 4 && e.gutterInner.children[1].offsetHeight >= 3 * e.lh - 1, [e.gutterInner.children.length, e.gutterInner.children[1]?.offsetHeight]);
  check('wrapped text keeps every character', [...e.linesEl.querySelectorAll('.ln')][1].textContent === long);
  const hang = e.breaksOf(2);
  check('hanging indent on indented line', e.rowsInLine(2) >= 3 && e.linesEl.querySelectorAll('.ln')[2].querySelectorAll('.vr')[1].style.paddingLeft !== '', hang.length);

  // geometry: position <-> pixels round trip across rows
  const br = e.breaksOf(1);
  const p1 = e.xy(1, 5), p2 = e.xy(1, br[0] + 3), p3 = e.xy(1, br[1] + 2);
  check('caret moves down a row after a soft break', p2.y === p1.y + e.lh && p3.y === p1.y + 2 * e.lh, [p1.y, p2.y, p3.y]);
  const r = e.scroller.getBoundingClientRect();
  const hit = (pt) => e.posFromPoint(r.left + pt.x + 1, r.top + pt.y + e.lh / 2 - e.scroller.scrollTop);
  for (const col of [0, 5, br[0] + 3, br[1] + 2, long.length - 3]) {
    const q = hit(e.xy(1, col));
    if (q.line !== 1 || q.col !== col) { check(`round trip col ${col}`, false, [q, col]); break; }
  }
  check('xy <-> point round trips', !Object.keys(out.checks).some((k) => k.startsWith('round trip') && out.checks[k] !== 'ok'));

  // keyboard: Down moves by visual row, not by line
  e.setSel(P(1, 5), P(1, 5));
  key('ArrowDown');
  check('ArrowDown stays on the line (next row)', e.head.line === 1 && e.head.col > br[0] - 1 && e.head.col >= br[0], e.head);
  const colAfter = e.head.col;
  key('ArrowUp');
  check('ArrowUp returns to the same column', e.head.line === 1 && e.head.col === 5, e.head);
  e.setSel(P(1, 5), P(1, 5));
  for (let i = 0; i < e.rowsInLine(1); i++) key('ArrowDown');
  check('Down past the last row enters the next line', e.head.line === 2, e.head);

  // selection across wrapped rows -> one rect per row
  e.setSel(P(1, 2), P(1, br[1] + 4));
  e.render();
  check('selection draws a rect per row', e.selEl.children.length === 3, e.selEl.children.length);
  // find highlights wrap too
  e.setFind({ query: 'consectetur', caseSensitive: true }, { jump: false });
  e.render();
  check('find highlights render with wrap', e.findEl.children.length >= 14, e.findEl.children.length);
  e.clearFind();

  // editing inside a wrapped line re-flows
  const rowsBefore = e.rowsInLine(1);
  e.setSel(P(1, 0), P(1, 0));
  type('x'.repeat(200));
  check('rows grow after inserting', e.rowsInLine(1) > rowsBefore, [rowsBefore, e.rowsInLine(1)]);
  check('row index stays consistent', e.rowOfLine(2) === e.rowOfLine(1) + e.rowsInLine(1) && e.rowOfLine(3) === e.rowOfLine(2) + e.rowsInLine(2));
  e.undo();
  check('undo shrinks rows back', e.rowsInLine(1) === rowsBefore, e.rowsInLine(1));

  // multi-cursor + wrap together
  await ensureFocus();
  e.setSel(P(0, 2), P(0, 2)); e.addCursorVertical(1);
  e.render();
  check('multi-cursor works while wrapped', e.sels.length === 2 && e.cursorsEl.children.length === 1);
  e.setSel(P(0, 0), P(0, 0));

  // resize reflows
  const colsBefore = e.wrapCols;
  document.querySelector('#sidebar').style.width = '520px';
  await waitFor(() => e.wrapCols < colsBefore);
  check('narrower editor wraps at fewer columns', e.wrapCols < colsBefore, [colsBefore, e.wrapCols]);
  check('rows recomputed for new width', e.totalRows > 0 && e.rowsInLine(1) > rowsBefore);
  document.querySelector('#sidebar').style.width = '';

  // wrap through scrolling: last line reachable
  e.gotoLine(3, 0);
  await wait(100);
  e.render();
  check('last line renders after goto', [...e.gutterInner.children].some((n) => n.dataset.l === '3'));
  // toggling wrap off restores line-per-row
  e.setOptions({ wordWrap: false });
  await wait(150);
  e.render();
  check('wrap off: one row per line again', !e.wrap && e.totalRows === e.buffer.lineCount && e.rowsInLine(1) === 1, [e.totalRows, e.buffer.lineCount]);
  check('wrap off: horizontal scroll returns', e.scroller.scrollWidth > e.scroller.clientWidth, [e.scroller.scrollWidth, e.scroller.clientWidth]);

  // setting via command
  w.runCommand('toggle-wrap');
  await wait(300);
  check('toggle-wrap command turns wrap on', e.wrap === true && w.S.settings.wordWrap === true);
  w.runCommand('toggle-wrap');
  await wait(300);
  check('toggle-wrap command turns wrap off', e.wrap === false);

  // large document with wrap enabled
  const big = Array.from({ length: 30000 }, (_, i) => `const value${i} = ${i}; // ${'word '.repeat(i % 40)}`).join('\n');
  setText(big);
  const t0 = performance.now();
  e.setOptions({ wordWrap: true });
  await wait(100);
  e.gotoLine(29000, 0);
  e.render();
  const ms = Math.round(performance.now() - t0);
  out.bigWrapMs = ms;
  check('30k lines wrap under 3s', ms < 3000 && e.totalRows >= e.buffer.lineCount, ms);
  e.setOptions({ wordWrap: false });

  out.errors = out.errors.slice(0, 5);
  out.failed = Object.entries(out.checks).filter(([, v]) => v !== 'ok');
  out.passed = Object.values(out.checks).filter((v) => v === 'ok').length;
  delete out.checks;
  return out;
})();
