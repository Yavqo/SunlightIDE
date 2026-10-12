(async () => {
  const w = window.__sunlight;
  const out = { checks: {}, errors: [] };
  const check = (n, ok, x) => { out.checks[n] = ok ? 'ok' : `FAIL ${JSON.stringify(x ?? '')}`; };
  window.addEventListener('error', (e) => out.errors.push(e.message));
  const type = (t) => { for (const ch of t) e.typeText(ch); };
  const key = (k, o = {}) => e.input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const P = (line, col) => ({ line, col });
  const reset = (text) => {
    e.closeCompletion();
    e.setSel(P(0, 0), P(e.buffer.lineCount - 1, 9999));
    e.deleteSelection();
    if (text) e.edit(P(0, 0), P(0, 0), text);
    e.setSel(P(e.buffer.lineCount - 1, 9999), P(e.buffer.lineCount - 1, 9999));
  };

  w.newUntitled();
  const e = w.editor;
  w.S.active.setLang('html');
  e.focus();

  // 1. '<' offers tags
  reset('');
  type('<');
  check('"<" opens tag list', !!e.completion && e.completion.items[0].kind === 'tag' && e.completion.items.some((i) => i.label === 'div'), e.completion?.items);
  type('but');
  check('tag list filters', e.completion?.items[0]?.label === 'button', e.completion?.items);
  key('Tab');
  check('Tab accepts tag name', e.buffer.getLine(0) === '<button', e.buffer.getLine(0));

  // 2. '>' auto-closes
  type('>');
  check('">" inserts closing tag', e.buffer.getLine(0) === '<button></button>' && e.head.col === 8, [e.buffer.getLine(0), e.head.col]);
  type('Go');
  check('typing goes between tags', e.buffer.getLine(0) === '<button>Go</button>');

  // 3. attributes keep working: closes with attributes present
  reset('');
  type('<a href="x.html" class="b"');
  type('>');
  check('auto-close with attributes', e.buffer.getLine(0) === '<a href="x.html" class="b"></a>', e.buffer.getLine(0));

  // 4. void elements are not closed
  reset('');
  type('<br>');
  check('void element not closed', e.buffer.getLine(0) === '<br>', e.buffer.getLine(0));
  reset('');
  type('<img src="a.png"');
  type('>');
  check('img not closed', e.buffer.getLine(0) === '<img src="a.png">', e.buffer.getLine(0));

  // 5. "</" completes nearest open tag
  reset('<div>\n  <span>hello');
  type('</');
  check('</ completes span', e.buffer.getLine(1) === '  <span>hello</span>', e.buffer.getLine(1));
  e.setSel(P(1, 9999), P(1, 9999));
  type('\n</');
  check('</ completes div next', e.buffer.getLine(2) === '</div>', e.buffer.getLine(2));

  // 6. closing-tag suggestion (when typing a partial name, e.g. after editing)
  reset('<ul>\n<li>x</li>\n</u');
  e.updateCompletion('tag');
  check('only unclosed tags offered', e.completion?.items.length === 1 && e.completion.items[0].label === 'ul' && e.completion.items[0].closing, e.completion?.items);
  key('Tab');
  check('closing suggestion completes with >', e.buffer.getLine(2) === '</ul>', e.buffer.getLine(2));

  // 7. Enter between tags indents
  reset('');
  type('<ul>');
  key('Enter');
  const u = e.indentUnit;
  check('enter between tags: 3 lines', e.buffer.lineCount === 3 && e.buffer.getLine(0) === '<ul>' && e.buffer.getLine(1) === u && e.buffer.getLine(2) === '</ul>', e.buffer.getText());
  check('caret on indented middle line', e.head.line === 1 && e.head.col === u.length, e.head);

  // 8. attribute suggestions
  reset('');
  type('<a hr');
  check('attribute suggested', e.completion?.items[0]?.label === 'href' && e.completion.items[0].kind === 'attribute', e.completion?.items);
  key('Tab');
  check('attribute inserted with quotes, caret inside', e.buffer.getLine(0) === '<a href=""' && e.head.col === 9, [e.buffer.getLine(0), e.head.col]);
  type('/x');
  type('"');
  check('closing quote overtyped', e.buffer.getLine(0) === '<a href="/x"', e.buffer.getLine(0));
  reset('<input ');
  e.updateCompletion('tag');
  check('space lists attributes', !!e.completion && e.completion.items.some((i) => i.label === 'type'), e.completion?.items);
  e.closeCompletion();
  reset('<input type="text" ');
  e.updateCompletion('tag');
  check('used attributes hidden', !e.completion?.items.some((i) => i.label === 'type'), e.completion?.items);
  e.closeCompletion();

  // 9. plain JS / generics unaffected
  await w.openFile(DEMO + '/app.js');
  e.setSel(P(e.buffer.lineCount - 1, 0), P(e.buffer.lineCount - 1, 0));
  type('const x = Array<string>');
  check('no tag logic in .js', e.buffer.getLine(e.head.line) === 'const x = Array<string>', e.buffer.getLine(e.head.line));

  out.failed = Object.entries(out.checks).filter(([, v]) => v !== 'ok');
  out.passed = Object.values(out.checks).filter((v) => v === 'ok').length;
  delete out.checks;
  return out;
})();
