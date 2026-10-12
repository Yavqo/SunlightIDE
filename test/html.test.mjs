import test from 'node:test';
import assert from 'node:assert/strict';
import { openTagStack, contextAt, tagToClose, attrsFor } from '../src/renderer/editor/html.js';

test('openTagStack ignores void, self-closing, comments and closed tags', () => {
  assert.deepEqual(openTagStack('<div><p>hi</p><br><img src="a"><span/><!-- <b> --><ul>'), ['div', 'ul']);
  assert.deepEqual(openTagStack('<div class="a>b"><a href=\'x\'>t'), ['div', 'a']);
  assert.deepEqual(openTagStack('<div><span></div>'), []);
});

test('contextAt: tag names, closing tags and attributes', () => {
  assert.deepEqual(contextAt('  <'), { type: 'open', prefix: '' });
  assert.deepEqual(contextAt('<di'), { type: 'open', prefix: 'di' });
  assert.deepEqual(contextAt('<div></'), { type: 'close', prefix: '' });
  assert.deepEqual(contextAt('<div></di'), { type: 'close', prefix: 'di' });
  const a = contextAt('<a hre');
  assert.equal(a.type, 'attr'); assert.equal(a.prefix, 'hre'); assert.equal(a.tag, 'a');
  assert.equal(contextAt('<a href="x'), null);
  assert.equal(contextAt('<a href=x'), null);
  assert.equal(contextAt('Array<str', true), null);
  assert.equal(contextAt('hello</', false).type, 'close');
  assert.equal(contextAt('hello</', true), null);
  assert.equal(contextAt('<a href="x" cl').prefix, 'cl');
});

test('tagToClose: only real container tags', () => {
  assert.equal(tagToClose('<a'), 'a');
  assert.equal(tagToClose('<div class="x"'), 'div');
  assert.equal(tagToClose('  <a href="x>y"'), 'a');
  assert.equal(tagToClose('<br'), null);
  assert.equal(tagToClose('<img src="a"'), null);
  assert.equal(tagToClose('<span/'), null);
  assert.equal(tagToClose('Array<string', true), null);
  assert.equal(tagToClose('text<b'), 'b');
  assert.equal(tagToClose('x = a < b'), null);
});

test('attrsFor puts tag-specific attributes first', () => {
  assert.equal(attrsFor('a')[0], 'href');
  assert.ok(attrsFor('div').includes('class'));
});
