import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, markersFromHunks, applyHunks } from '../src/renderer/editor/diff.js';

const L = (s) => (s === '' ? [] : s.split(''));

test('identical and empty inputs', () => {
  assert.deepEqual(diffLines(L('abc'), L('abc')), []);
  assert.deepEqual(diffLines([], []), []);
  assert.deepEqual(diffLines([], L('ab')), [{ os: 0, oe: 0, ns: 0, ne: 2 }]);
  assert.deepEqual(diffLines(L('ab'), []), [{ os: 0, oe: 2, ns: 0, ne: 0 }]);
});

test('single insert, delete and modify hunks', () => {
  assert.deepEqual(diffLines(L('abc'), L('abXc')), [{ os: 2, oe: 2, ns: 2, ne: 3 }]);
  assert.deepEqual(diffLines(L('abXc'), L('abc')), [{ os: 2, oe: 3, ns: 2, ne: 2 }]);
  assert.deepEqual(diffLines(L('abc'), L('aXc')), [{ os: 1, oe: 2, ns: 1, ne: 2 }]);
});

test('markers: add, mod and deleted-above', () => {
  const a = L('abcdef'), b = L('aXcdefG');
  const m = markersFromHunks(diffLines(a, b));
  assert.equal(m.lines.get(1), 'mod'); assert.equal(m.lines.get(6), 'add');
  const d = markersFromHunks(diffLines(L('abcd'), L('abd')));
  assert.deepEqual([...d.dels], [2]); assert.equal(d.lines.size, 0);
  const end = markersFromHunks(diffLines(L('abc'), L('ab')));
  assert.deepEqual([...end.dels], [2]);   // after the last line (index === line count)
});

test('fuzz: applying the hunks always rebuilds the new text', () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let t = 0; t < 400; t++) {
    const a = Array.from({ length: rnd(40) }, () => String.fromCharCode(97 + rnd(5)));
    const b = a.slice();
    for (let e = rnd(8); e > 0; e--) {
      const op = rnd(3), at = rnd(b.length + 1);
      if (op === 0) b.splice(at, 0, String.fromCharCode(97 + rnd(5)));
      else if (op === 1) b.splice(at, 1);
      else if (b.length) b[at % b.length] = String.fromCharCode(97 + rnd(5));
    }
    const h = diffLines(a, b);
    assert.deepEqual(applyHunks(a, b, h), b, `case ${t}: ${a.join('')} -> ${b.join('')}`);
    for (let i = 1; i < h.length; i++) assert.ok(h[i].os >= h[i - 1].oe && h[i].ns >= h[i - 1].ne, 'hunks ordered and disjoint');
  }
});

test('minimal for simple edits (does not report the whole file)', () => {
  const a = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
  const b = a.slice(); b[2500] = 'changed'; b.splice(4000, 0, 'inserted');
  const h = diffLines(a, b);
  assert.equal(h.length, 2);
});

test('very different large inputs fall back to one hunk quickly', () => {
  const a = Array.from({ length: 6000 }, (_, i) => `a${i}`), b = Array.from({ length: 6000 }, (_, i) => `b${i}`);
  const t0 = Date.now();
  const h = diffLines(a, b, { maxD: 300 });
  assert.equal(h.length, 1);
  assert.ok(Date.now() - t0 < 1500);
});
