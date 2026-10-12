import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import m from '../src/main/ext-manifest.js';
import { renderMarkdown } from '../src/renderer/ui/markdown.js';
import { PERMISSION_TEXT } from '../src/renderer/ui/extensions.js';

const docs = fs.readFileSync(new URL('../docs/extensions.md', import.meta.url), 'utf8');
const blocks = [...docs.matchAll(/```(\w+)?\r?\n([\s\S]*?)```/g)].map((x) => ({ lang: x[1] || '', code: x[2] }));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('every JavaScript example in the guide at least parses', () => {
  const js = blocks.filter((b) => b.lang === 'js');
  assert.ok(js.length >= 5, `found ${js.length} js blocks`);
  for (const b of js) assert.doesNotThrow(() => new AsyncFunction('sunlight', 'console', b.code), b.code.slice(0, 80));
});

test('every JSON example is valid JSON, and the full manifests pass the real validator', () => {
  const json = blocks.filter((b) => b.lang === 'json');
  assert.ok(json.length >= 6);
  let manifests = 0;
  for (const b of json) {
    let value;
    const text = b.code.trim();
    try { value = JSON.parse(text.startsWith('{') ? text : `{${text}}`); } catch (e) { assert.fail(`invalid JSON in docs: ${e.message}\n${text.slice(0, 200)}`); }
    if (value.id && value.name && value.version && value.main) {                 // a complete manifest
      const r = m.validate(value);
      assert.ok(r.ok, `manifest example is invalid: ${r.errors.join('; ')}`);
      manifests++;
    } else if (value.contributes) {                                               // a fragment: validate it in a minimal manifest
      const r = m.validate({ id: 'a.b', name: 'x', version: '1.0.0', main: 'index.js', ...value });
      assert.ok(r.ok, `contribution example is invalid: ${r.errors.join('; ')}\n${text.slice(0, 200)}`);
    }
  }
  assert.ok(manifests >= 1);
});

test('every permission the code knows is documented, and vice versa', () => {
  for (const p of Object.keys(m.PERMISSIONS)) assert.ok(docs.includes('`' + p + '`'), `permission ${p} is not documented`);
  for (const p of [...docs.matchAll(/\| `((?:editor|workspace)\.\w+|storage)` \|/g)].map((x) => x[1])) assert.ok(m.PERMISSIONS[p], `docs mention unknown permission ${p}`);
  assert.deepEqual(Object.keys(PERMISSION_TEXT).sort(), Object.keys(m.PERMISSIONS).sort());
  for (const [k, v] of Object.entries(m.PERMISSIONS)) assert.equal(PERMISSION_TEXT[k], v, `the store shows different wording for ${k}`);
});

test('theme colour and token names in the guide are exactly the supported ones', () => {
  for (const name of Object.keys(m.THEME_COLORS)) assert.ok(docs.includes('`' + name + '`'), `colour ${name} is not documented`);
  for (const t of m.THEME_TOKENS) assert.ok(new RegExp('`' + t + '`[\\s.,]').test(docs), `token ${t} is not documented`);
});

test('documented limits match the implementation', async () => {
  const { LIMITS } = (await import('../src/main/extensions.js')).default;
  assert.match(docs, /20 MB, 500 files/); assert.equal(LIMITS.total, 20 * 1024 * 1024); assert.equal(LIMITS.files, 500);
  assert.match(docs, /`index\.js` \| 1 MB/); assert.equal(LIMITS.main, 1024 * 1024);
  assert.match(docs, /Storage \| 1 MB/); assert.equal(LIMITS.storage, 1024 * 1024);
  assert.match(docs, /Command run time \| 30 seconds/);
  const host = fs.readFileSync(new URL('../src/renderer/ext/host.js', import.meta.url), 'utf8');
  assert.match(host, /COMMAND_TIMEOUT = 30000/);
  assert.match(host, /MAX_TEXT = 5 \* 1024 \* 1024/);
});

test('the guide renders without raw HTML leaking through and every heading has an id', () => {
  const r = renderMarkdown(docs, { trusted: true });
  assert.ok(r.headings.length >= 30);
  assert.ok(r.headings.every((h) => h.id));
  assert.equal(new Set(r.headings.map((h) => h.id)).size, r.headings.length, 'heading ids are unique');
  assert.ok(!/<script/i.test(r.html));
  // every in-page anchor resolves
  const ids = new Set(r.headings.map((h) => h.id));
  for (const [, id] of r.html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(id), `broken anchor #${id}`);
});

test('bundled sample extensions: each is valid and its code registers exactly the commands it declares', () => {
  const root = new URL('../extensions/store/', import.meta.url);
  const dirs = fs.readdirSync(root).filter((d) => fs.statSync(new URL(d, root)).isDirectory());
  assert.ok(dirs.length >= 8);
  for (const d of dirs) {
    const manifest = JSON.parse(fs.readFileSync(new URL(`${d}/manifest.json`, root), 'utf8'));
    const r = m.validate(manifest);
    assert.ok(r.ok, `${d}: ${r.errors.join('; ')}`);
    assert.equal(manifest.id, d, 'folder name equals the id');
    assert.ok(fs.existsSync(new URL(`${d}/README.md`, root)), `${d} has a README`);
    if (manifest.icon) assert.ok(fs.existsSync(new URL(`${d}/${manifest.icon}`, root)), `${d} icon exists`);
    if (!manifest.main) continue;
    // Run the real code against a recording stub of the API.
    const registered = new Set();
    const noop = () => Promise.resolve(null);
    const api = { commands: { register: (id, fn) => { assert.equal(typeof fn, 'function'); registered.add(id); }, execute: noop },
      window: { showMessage: noop, showInput: noop, showPick: noop }, statusBar: { setItem: noop, removeItem: noop },
      editor: { getActive: () => Promise.resolve(null), getText: () => Promise.resolve(''), getLine: noop, getSelections: () => Promise.resolve([]), replaceSelections: noop, insertText: noop, setText: noop, replaceRange: noop, setSelections: noop },
      workspace: { getFolder: noop, readFile: noop, writeFile: noop, listFiles: () => Promise.resolve([]) }, storage: { get: noop, set: noop, delete: noop, keys: noop },
      events: { on: () => ({ dispose() {} }) } };
    const code = fs.readFileSync(new URL(`${d}/index.js`, root), 'utf8');
    vm.runInNewContext(code, { sunlight: api, console, setTimeout, clearTimeout, self: { crypto: globalThis.crypto }, Intl, JSON, Date, Math, Promise });
    const declared = new Set(manifest.contributes.commands.map((c) => c.id));
    assert.deepEqual([...registered].sort(), [...declared].sort(), `${d}: registered commands match the manifest`);
  }
});
