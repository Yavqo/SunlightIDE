import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorGroups } from '../src/renderer/editor/groups.js';
const doc = (id) => ({ recoveryId: id, view: { head: { line: 0, col: 0 } } });
test('split shares a document without sharing tab membership or view state', () => {
  const model = new EditorGroups(), left = model.active, right = model.split(), file = doc('a');
  model.attach(left, file); model.attach(right, file);
  left.views.set(file, { head: { line: 2, col: 1 } }); right.views.set(file, { head: { line: 8, col: 1 } });
  model.remove(right, file);
  assert.deepEqual(model.owners(file), [left]);
  assert.equal(left.views.get(file).head.line, 2);
  assert.equal(right.active, null);
});
test('moving files preserves their view and selects a neighbor in the source group', () => {
  const model = new EditorGroups(), left = model.active, right = model.split();
  const a = doc('a'), b = doc('b'); model.attach(left, a); model.attach(left, b);
  left.views.set(b, { head: { line: 8, col: 1 } });
  model.move(b, left, right);
  assert.deepEqual(left.docs, [a]); assert.equal(left.active, a);
  assert.equal(right.active, b); assert.equal(right.views.get(b).head.line, 8);
});
test('joining groups retains every tab once and the focused view', () => {
  const model = new EditorGroups(), left = model.active, right = model.split();
  const a = doc('a'), b = doc('b'); model.attach(left, a); model.attach(right, a); model.attach(right, b);
  right.views.set(b, { head: { line: 8, col: 1 } }); model.active = right;
  model.join();
  assert.deepEqual(model.groups[0].docs, [a, b]); assert.equal(model.active.active, b);
  assert.equal(model.active.views.get(b).head.line, 8);
});
test('recovery layout references shared documents once per group and excludes transient pages', () => {
  const model = new EditorGroups(), left = model.active, right = model.split();
  const a = doc('a'), page = { ...doc('page'), page: {} }; model.attach(left, a); model.attach(left, page); model.attach(right, a);
  model.active = right; model.ratio = 0.6;
  const saved = model.serialize();
  assert.deepEqual(saved.groups.map((g) => g.documents), [['a'], ['a']]);
  assert.equal(saved.activeGroup, 'right'); assert.equal(saved.ratio, 0.6);
});
