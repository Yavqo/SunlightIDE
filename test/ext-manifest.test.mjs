import test from 'node:test';
import assert from 'node:assert/strict';
import m from '../src/main/ext-manifest.js';

const base = (extra = {}) => ({ id: 'acme.hello', name: 'Hello', version: '1.0.0', main: 'index.js', permissions: ['editor.read'], ...extra });
const errs = (raw) => m.validate(raw).errors.join(' | ');

test('a minimal valid manifest is normalised', () => {
  const r = m.validate(base({ description: 'x', contributes: { commands: [{ id: 'run', title: 'Run' }], keybindings: [{ key: 'Mod+Shift+H', command: 'run' }] } }));
  assert.equal(r.ok, true, r.errors.join());
  assert.equal(r.manifest.publisher, 'acme');
  assert.deepEqual(r.manifest.activationEvents, ['onStartup']);
  assert.equal(r.manifest.contributes.commands[0].category, '');
});

test('id, version and name rules', () => {
  for (const id of ['Hello', 'a.b.c', 'nopublisher', 'UP.case', '../x.y', 'a b.c']) assert.match(errs(base({ id })), /"id"/, id);
  assert.match(errs(base({ version: '1.0' })), /version/);
  assert.match(errs(base({ name: '' })), /"name"/);
  assert.match(errs([]), /JSON object/);
});

test('paths cannot escape the extension folder', () => {
  for (const main of ['../x.js', '/abs/x.js', 'C:\\x.js', 'a/../../x.js', 'x.txt']) assert.match(errs(base({ main })), /"main"/, main);
  assert.match(errs(base({ icon: '../icon.png' })), /"icon"/);
  assert.equal(m.validate(base({ icon: 'assets/icon.svg' })).ok, true);
});

test('permissions must be known', () => {
  assert.match(errs(base({ permissions: ['root'] })), /Unknown permission/);
  assert.match(errs(base({ permissions: 'editor.read' })), /array/);
  assert.deepEqual(m.validate(base({ permissions: ['editor.read', 'editor.read', 'storage'] })).manifest.permissions, ['editor.read', 'storage']);
});

test('commands and keybindings are cross-checked', () => {
  assert.match(errs(base({ contributes: { commands: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] } })), /Duplicate/);
  assert.match(errs(base({ contributes: { commands: [{ id: 'bad id', title: 'A' }] } })), /command needs/);
  assert.match(errs(base({ contributes: { keybindings: [{ key: 'Mod+K', command: 'nope' }] } })), /unknown command/);
  const c = { commands: [{ id: 'a', title: 'A' }] };
  assert.match(errs(base({ contributes: { ...c, keybindings: [{ key: 'K', command: 'a' }] } })), /Invalid keybinding/);
  assert.match(errs(base({ contributes: { ...c, keybindings: [{ key: 'Shift+K', command: 'a' }] } })), /needs Mod, Ctrl or Alt/);
  assert.equal(m.validate(base({ contributes: { ...c, keybindings: [{ key: 'F9', command: 'a' }, { key: 'Alt+Shift+Up', command: 'a' }] } })).ok, true);
  assert.match(errs({ id: 'a.b', name: 'x', version: '1.0.0', contributes: { commands: [{ id: 'a', title: 'A' }] } }), /need a "main"/);
});

test('themes: only whitelisted colour names and safe colour values', () => {
  const t = (colors, tokens) => base({ main: undefined, contributes: { themes: [{ id: 't', label: 'T', type: 'dark', colors, tokens }] } });
  assert.equal(m.validate(t({ editorBackground: '#101010', accent: 'rgba(0, 100, 224, 0.5)', foreground: 'hsl(210, 20%, 90%)' }, { kw: '#fff' })).ok, true);
  assert.match(errs(t({ editorBackground: 'url(http://evil)' })), /must be a #hex/);
  assert.match(errs(t({ editorBackground: 'red; background: url(x)' })), /must be a #hex/);
  assert.match(errs(t({ '--evil': '#fff' })), /unknown colour/);
  assert.match(errs(t({}, { nope: '#fff' })), /unknown token/);
  assert.match(errs(base({ main: undefined, contributes: { themes: [{ id: 't', label: 'T', type: 'purple' }] } })), /"type"/);
});

test('snippets are validated', () => {
  const s = (g) => base({ main: undefined, contributes: { snippets: g } });
  assert.equal(m.validate(s([{ language: 'javascript', snippets: { log: { body: 'console.log($0)', description: 'log' }, raw: 'x $0' } }])).ok, true);
  assert.match(errs(s([{ language: 'JS!', snippets: {} }])), /language/);
  assert.match(errs(s([{ language: 'python', snippets: { 'bad trigger': { body: 'x' } } }])), /trigger/);
  assert.match(errs(s([{ language: 'python', snippets: { x: { body: 'y'.repeat(5000) } } }])), /body/);
});

test('activation events and API version', () => {
  assert.match(errs(base({ activationEvents: ['onEverything'] })), /Invalid activation/);
  assert.equal(m.validate(base({ activationEvents: ['onLanguage:python'] })).ok, true);
  assert.match(errs(base({ apiVersion: 99 })), /API version 99/);
  assert.match(errs({ id: 'a.b', name: 'x', version: '1.0.0' }), /contributes nothing/);
  assert.match(errs(base({ homepage: 'http://insecure' })), /https/);
});

test('version comparison', () => {
  assert.ok(m.compareVersions('1.2.0', '1.10.0') < 0);
  assert.ok(m.compareVersions('2.0.0', '1.99.99') > 0);
  assert.equal(m.compareVersions('1.0.0', '1.0.0'), 0);
});
