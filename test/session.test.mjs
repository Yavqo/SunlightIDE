import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/main/session.js';
import { snapshotSession, restoredView } from '../src/renderer/editor/session.js';
import { Document } from '../src/renderer/editor/editor.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sunlight-recovery-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const data = () => ({ schemaVersion: 1, root: null, active: 'draft', documents: [{ id: 'draft', path: null, name: 'Untitled-1', text: 'precious edits', dirty: true }] });

test('checkpoints round-trip unsaved edits, keep a valid backup, and ignore incomplete writes', () => {
  const store = new SessionStore(path.join(root, 'roundtrip'));
  assert.equal(store.load().snapshot, null);
  store.save(data());
  store.save({ ...data(), documents: [{ ...data().documents[0], text: 'new edits' }] });
  assert.equal(store.load().snapshot.documents[0].text, 'new edits');
  fs.writeFileSync(store.file + '.tmp', '{unfinished');
  assert.equal(store.load().snapshot.documents[0].text, 'new edits');
  fs.writeFileSync(store.file, '{damaged');
  assert.equal(store.load().snapshot.documents[0].text, 'precious edits');
  assert.match(store.load().warning, /previous checkpoint/);
  store.save(data());
  assert.equal(store.load().snapshot.documents[0].text, 'precious edits');
});
test('discarding clears unsaved contents from both checkpoints', () => {
  const store = new SessionStore(path.join(root, 'discard'));
  store.save(data());
  const empty = { ...data(), active: null, documents: [] };
  store.save(empty, { discard: true });
  fs.writeFileSync(store.file, '{damaged');
  assert.deepEqual(store.load().snapshot.documents, []);
});
test('invalid snapshots cannot replace a valid checkpoint', () => {
  const store = new SessionStore(path.join(root, 'validation'));
  store.save(data());
  assert.throws(() => store.save({ ...data(), documents: [{ ...data().documents[0], text: null }] }), /Missing recovery text/);
  assert.throws(() => store.save({ ...data(), root: 'relative' }), /folder/);
  assert.equal(store.load().snapshot.documents[0].text, 'precious edits');
});
test('snapshot preserves tab order, drafts, language, views and CRLF; excludes transient tabs', () => {
  const clean = new Document({ path: path.join(root, 'saved.js'), text: 'saved', name: 'saved.js' });
  const dirty = new Document({ path: path.join(root, 'modified.ts'), text: 'old', name: 'modified.ts' });
  dirty.buffer.replace({ line: 0, col: 0 }, { line: 0, col: 3 }, 'new\r\ntext'); dirty.buffer.eol = '\r\n';
  dirty.view.head = { line: 1, col: 2 };
  const draft = new Document({ name: 'Untitled-2', text: 'draft' }); draft.buffer.savedVersion = -1;
  const transient = new Document({ text: 'diff' }); transient.readOnly = true;
  const state = { docs: [clean, dirty, draft, transient], active: draft, root: null, untitled: 2 };
  const snapshot = snapshotSession(state);
  assert.equal(snapshot.documents.length, 3);
  assert.equal(snapshot.documents[0].text, null);
  assert.equal(snapshot.documents[1].text, 'new\r\ntext');
  assert.deepEqual(snapshot.documents[1].view.head, { line: 1, col: 2 });
  assert.equal(snapshot.active, draft.recoveryId);
  const discarded = snapshotSession({ ...state, discardUnsaved: true });
  assert.equal(discarded.documents.length, 2);
  assert.ok(discarded.documents.every((d) => d.text === null && !d.dirty));
});
test('restored selections and scroll values are clamped to the current file', () => {
  const doc = new Document({ text: 'abc\nx' });
  const view = restoredView({ head: { line: 99, col: 99 }, scrollTop: -1, scrollLeft: Infinity,
    sels: [{ anchor: { line: 0, col: 99 }, head: { line: 1, col: 8 } }], main: 10 }, doc.buffer);
  assert.equal(view.head.line, 1); assert.equal(view.head.col, 1);
  assert.equal(view.scrollTop, 0); assert.equal(view.scrollLeft, 0); assert.equal(view.main, 0);
});

test('malformed split layouts are rejected instead of breaking startup recovery', () => {
  const store = new SessionStore(path.join(root, 'invalid-layout'));
  store.save(data());
  const layout = { ratio: 0.5, activeGroup: 'left', groups: [{ id: 'left', documents: ['draft'], active: 'draft', views: [] }] };
  store.save({ ...data(), layout });
  assert.throws(() => store.save({ ...data(), layout: { ...layout, groups: [{ ...layout.groups[0], documents: 'not-an-array' }] } }), /editor group/);
  assert.throws(() => store.save({ ...data(), layout: { ...layout, ratio: Infinity } }), /editor layout/);
  assert.equal(store.load().snapshot.layout.activeGroup, 'left');
});
