import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtensionUpdateTracker } from '../src/renderer/ext/updates.js';
const entry = (extra = {}) => ({ id: 'acme.tool', name: 'Tool', version: '2.0.0', source: 'registry', installed: true, installedSource: 'installed', updateAvailable: true, ...extra });
const result = (catalog = [entry()], extra = {}) => ({ catalog, error: null, registry: 'https://registry.example/catalog.json', ...extra });

test('notifies once per version, persists across restarts, and announces newer versions', () => {
  const notifications = [], saved = [];
  const tracker = new ExtensionUpdateTracker({ notify: (n) => notifications.push(n), persist: (n) => saved.push(n) });
  tracker.observe(result()); tracker.observe(result());
  assert.equal(notifications.length, 1);
  assert.equal(tracker.updates.length, 1);
  const restarted = new ExtensionUpdateTracker({ seen: saved.at(-1), notify: (n) => notifications.push(n) });
  restarted.observe(result()); assert.equal(notifications.length, 1);
  restarted.observe(result([entry({ version: '3.0.0' })])); assert.equal(notifications.length, 2);
});
test('muting still updates the badge but suppresses notifications', () => {
  const notifications = [], counts = [];
  const tracker = new ExtensionUpdateTracker({ notify: (n) => notifications.push(n), change: (n) => counts.push(n.length) });
  tracker.observe(result(), { notifications: false });
  assert.deepEqual(counts, [1]); assert.equal(notifications.length, 0);
  tracker.observe(result()); assert.equal(notifications.length, 1);
});
test('offline checks stay quiet and preserve known updates; successful updates clear the count', () => {
  const notifications = [], counts = [];
  const tracker = new ExtensionUpdateTracker({ notify: (n) => notifications.push(n), change: (n) => counts.push(n.length) });
  tracker.observe(result());
  tracker.observe(result([], { error: 'Offline' }));
  assert.equal(tracker.updates.length, 1); assert.equal(notifications.length, 1);
  tracker.observe(result([entry({ updateAvailable: false })]));
  assert.equal(tracker.updates.length, 0); assert.deepEqual(counts, [1, 1, 0]);
});
test('development and uninstalled extensions are excluded; changed registry is a new origin', () => {
  const notifications = [];
  const tracker = new ExtensionUpdateTracker({ notify: (n) => notifications.push(n) });
  tracker.observe(result([entry({ installedSource: 'dev' }), entry({ installed: false })]));
  assert.equal(tracker.updates.length, 0); assert.equal(notifications.length, 0);
  tracker.observe(result());
  tracker.observe(result(undefined, { registry: 'https://other.example/catalog.json' }));
  assert.equal(notifications.length, 2);
});
