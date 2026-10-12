import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer, Pos } from '../src/renderer/editor/buffer.js';
import { tokenizeLine, languageForFile } from '../src/renderer/editor/tokenizer.js';

test('insert, multi-line insert and delete', () => {
  const b = new Buffer('hello\nworld');
  b.replace(new Pos(0, 5), new Pos(0, 5), ' there');
  assert.equal(b.getText(), 'hello there\nworld');
  const end = b.replace(new Pos(0, 5), new Pos(0, 11), '\nA\nB');
  assert.deepEqual([end.line, end.col], [2, 1]);
  assert.equal(b.getText(), 'hello\nA\nB\nworld');
  b.replace(new Pos(0, 3), new Pos(3, 2), '');
  assert.equal(b.getText(), 'helrld');
});

test('undo/redo restores text, merges typing', () => {
  const b = new Buffer('');
  b.nextTag = 'type';
  for (const ch of 'abc') b.replace(new Pos(0, b.getLine(0).length), new Pos(0, b.getLine(0).length), ch);
  assert.equal(b.undoStack.length, 1);
  b.undo();
  assert.equal(b.getText(), '');
  b.redo();
  assert.equal(b.getText(), 'abc');
});

test('batch is one undo step', () => {
  const b = new Buffer('a\nb\nc');
  b.batch(() => {
    b.replace(new Pos(2, 0), new Pos(2, 1), 'C');
    b.replace(new Pos(0, 0), new Pos(0, 1), 'A');
  });
  assert.equal(b.getText(), 'A\nb\nC');
  b.undo();
  assert.equal(b.getText(), 'a\nb\nc');
});

test('CRLF preserved on getText', () => {
  const b = new Buffer('a\r\nb');
  assert.equal(b.lineCount, 2);
  assert.equal(b.getText(), 'a\r\nb');
});

test('find supports regex, case and whole word', () => {
  const b = new Buffer('Foo foo food\nfoo');
  assert.equal(b.find('foo').length, 4);
  assert.equal(b.find('foo', { caseSensitive: true }).length, 3);
  assert.equal(b.find('foo', { wholeWord: true }).length, 3);
  assert.equal(b.find('fo+d', { regex: true }).length, 1);
});

test('tokenizer: block comment and template state carry across lines', () => {
  let r = tokenizeLine('javascript', 'a /* x', 0);
  assert.equal(r.state, 'bc');
  r = tokenizeLine('javascript', 'y */ let z = 1', r.state);
  assert.equal(r.state, 0);
  assert.deepEqual(r.tokens.map((t) => t.t), ['com', 'kw', 'op', 'num']);
  r = tokenizeLine('javascript', 'const s = `a ${b}', 0);
  assert.equal(r.state, 'tpl');
  r = tokenizeLine('javascript', 'tail` + 1', r.state);
  assert.equal(r.state, 0);
});

test('tokenizer: tokens never overlap', () => {
  for (const [lang, src] of [['javascript', 'x = `a${1}b${2}c`; // hi'], ['python', 'def f(x): return "a" # c'], ['css', 'a.b { color: #fff; margin: 0 }'], ['html', '<div class="a">hi &amp;</div>']]) {
    const { tokens } = tokenizeLine(lang, src, 0);
    let last = 0;
    for (const t of tokens) { assert.ok(t.s >= last, `${lang} overlap`); last = t.e; }
  }
});

test('language detection', () => {
  assert.equal(languageForFile('/a/b/x.tsx'), 'typescript');
  assert.equal(languageForFile('Dockerfile'), 'shell');
  assert.equal(languageForFile('notes.unknown'), 'plaintext');
});
