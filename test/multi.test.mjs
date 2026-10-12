import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, shiftAfter, mergeLineRanges } from '../src/renderer/editor/selection.js';
import { computeBreaks, rowInLine, rowRange, buildRowIndex, lineOfRow, hangCols, NO_BREAKS } from '../src/renderer/editor/wrap.js';

const S = (al, ac, hl, hc) => ({ anchor: { line: al, col: ac }, head: { line: hl, col: hc } });

test('normalize sorts and merges overlapping/touching selections', () => {
  const a = S(2, 0, 2, 3), b = S(0, 1, 0, 1), c = S(2, 2, 2, 6), d = S(5, 0, 5, 0);
  const { sels, main } = normalize([a, b, c, d], c);
  assert.equal(sels.length, 3);
  assert.deepEqual(sels[0].head, { line: 0, col: 1 });
  assert.deepEqual([sels[1].anchor.col, sels[1].head.col], [0, 6]);
  assert.equal(main, sels[1]);
  const dup = normalize([S(1, 1, 1, 1), S(1, 1, 1, 1)], null);
  assert.equal(dup.sels.length, 1);
});

test('normalize keeps backwards selections backwards', () => {
  const { sels } = normalize([S(0, 5, 0, 1), S(0, 3, 0, 8)], null);
  assert.equal(sels.length, 1);
  assert.deepEqual([sels[0].anchor.col, sels[0].head.col], [1, 8].reverse().reverse() && sels[0].anchor.col < sels[0].head.col ? [1, 8] : [8, 1]);
});

test('shiftAfter moves later positions through an edit', () => {
  // replace (0,2)-(0,4) with "ABCDE" (same line): later col on that line shifts by +3
  assert.deepEqual(shiftAfter({ line: 0, col: 10 }, { line: 0, col: 4 }, { line: 0, col: 7 }), { line: 0, col: 13 });
  // inserting a newline: text after becomes the next line
  assert.deepEqual(shiftAfter({ line: 0, col: 10 }, { line: 0, col: 4 }, { line: 1, col: 2 }), { line: 1, col: 8 });
  // later lines only shift by the line delta
  assert.deepEqual(shiftAfter({ line: 3, col: 9 }, { line: 0, col: 4 }, { line: 2, col: 0 }), { line: 5, col: 9 });
});

test('mergeLineRanges joins adjacent and overlapping blocks', () => {
  assert.deepEqual(mergeLineRanges([[5, 6], [1, 2], [3, 3], [9, 9]]), [[1, 3], [5, 6], [9, 9]]);
});

test('computeBreaks: short lines are not wrapped', () => {
  assert.equal(computeBreaks('hello world', 20, 4), NO_BREAKS);
});

test('computeBreaks: wraps at word boundaries, never exceeding the width', () => {
  const text = 'the quick brown fox jumps over the lazy dog';
  const br = computeBreaks(text, 16, 4);
  assert.ok(br.length >= 2);
  let start = 0;
  for (const b of [...br, text.length]) {
    assert.ok(b - start <= 16, `row too wide: "${text.slice(start, b)}"`);
    start = b;
  }
  assert.equal(text.slice(0, br[0]), 'the quick brown ');
});

test('computeBreaks: hard-breaks a long unbroken token and keeps progress', () => {
  const br = computeBreaks('x'.repeat(50), 10, 4);
  assert.deepEqual([...br], [10, 20, 30, 40]);
  assert.deepEqual([...computeBreaks('abc', 1, 4)], [1, 2]);
});

test('computeBreaks: hanging indent for continuation rows', () => {
  const text = '    ' + 'word '.repeat(12);
  const br = computeBreaks(text, 24, 4);
  assert.equal(hangCols(br), 4);
  // continuation rows have width 24 - 4
  let start = br[0];
  for (const b of [...br.slice(1), text.length]) { assert.ok(b - start <= 20); start = b; }
});

test('row mapping and lineOfRow', () => {
  const br = computeBreaks('aaaa bbbb cccc dddd', 10, 4);
  assert.equal(rowInLine(br, 0), 0);
  assert.equal(rowInLine(br, br[0]), 1);
  assert.deepEqual(rowRange(br, 0, 19), [0, br[0]]);
  const idx = buildRowIndex([1, 3, 1, 2]);
  assert.deepEqual([...idx], [0, 1, 4, 5, 7]);
  assert.deepEqual([0, 1, 3, 4, 5, 6, 99].map((r) => lineOfRow(idx, r)), [0, 1, 1, 2, 3, 3, 3]);
});
