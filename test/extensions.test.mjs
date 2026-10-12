import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import ext from '../src/main/extensions.js';
import zip from '../src/main/zip.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sunlight-ext-')));
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const manifest = (o = {}) => ({ id: 'acme.hello', name: 'Hello', version: '1.0.0', main: 'index.js', permissions: ['editor.read'], contributes: { commands: [{ id: 'run', title: 'Run' }] }, ...o });
const makeExt = (dir, o = {}, code = "sunlight.commands.register('run', () => {});") => { write(dir, 'manifest.json', JSON.stringify(manifest(o))); write(dir, 'index.js', code); write(dir, 'README.md', '# Hello\n\nreadme text'); return dir; };
const mgr = (bundled) => { const data = tmp(); return { m: new ext.ExtensionManager({ dataDir: data, bundledDir: bundled || path.join(data, 'none') }), data }; };

test('install from folder, list, read code/readme, enable/disable, uninstall', async () => {
  const { m } = mgr();
  const src = makeExt(path.join(tmp(), 'src'));
  write(src, 'node_modules/junk/x.js', 'x'); write(src, '.git/config', 'x');
  const installed = m.installFromFolder(src);
  assert.equal(installed.id, 'acme.hello');
  const list = m.list();
  assert.equal(list.length, 1); assert.equal(list[0].source, 'installed'); assert.equal(list[0].enabled, true);
  assert.ok(!fs.existsSync(path.join(list[0].dir, 'node_modules')) && !fs.existsSync(path.join(list[0].dir, '.git')), 'junk folders are not copied');
  assert.match(m.loadMain('acme.hello'), /register/);
  assert.match(m.readme('acme.hello'), /readme text/);
  m.setEnabled('acme.hello', false);
  assert.equal(m.find('acme.hello').enabled, false);
  m.setEnabled('acme.hello', true);
  assert.equal(m.find('acme.hello').enabled, true);
  m.uninstall('acme.hello');
  assert.equal(m.list().length, 0);
  assert.throws(() => m.uninstall('acme.hello'), /not installed/);
  assert.throws(() => m.setEnabled('nope.nope', true), /not installed/);
});

test('invalid extensions are refused and leave nothing behind', () => {
  const { m, data } = mgr();
  const bad = path.join(tmp(), 'bad'); write(bad, 'manifest.json', '{"id":"x"}');
  assert.throws(() => m.installFromFolder(bad), /Invalid extension/);
  const nomain = makeExt(path.join(tmp(), 'nomain')); fs.rmSync(path.join(nomain, 'index.js'));
  assert.throws(() => m.installFromFolder(nomain), /does not exist/);
  const notjson = path.join(tmp(), 'nj'); write(notjson, 'manifest.json', '{oops');
  assert.throws(() => m.installFromFolder(notjson), /could not be read/);
  const left = fs.existsSync(path.join(data, 'extensions')) ? fs.readdirSync(path.join(data, 'extensions')) : [];
  assert.deepEqual(left, [], 'no staged temp folders remain');
});

test('symlinks are not followed when installing or reading code', () => {
  const { m } = mgr();
  const secret = path.join(tmp(), 'secret.txt'); fs.writeFileSync(secret, 'TOP SECRET');
  const src = makeExt(path.join(tmp(), 'src'));
  fs.symlinkSync(secret, path.join(src, 'leak.txt'));
  m.installFromFolder(src);
  assert.ok(!fs.existsSync(path.join(m.find('acme.hello').dir, 'leak.txt')), 'symlink skipped');
  // A dev extension whose main file is a symlink pointing outside is rejected.
  const dev = path.join(tmp(), 'dev'); write(dev, 'manifest.json', JSON.stringify(manifest({ id: 'acme.dev' }))); fs.symlinkSync(secret, path.join(dev, 'index.js'));
  assert.throws(() => m.addDev(dev), /regular file inside/);
});

test('install from zip, with and without a wrapping folder; zip-slip is blocked', () => {
  const { m } = mgr();
  const files = [{ name: 'manifest.json', data: JSON.stringify(manifest()) }, { name: 'index.js', data: 'x' }];
  assert.equal(m.installFromBuffer(zip.writeZip(files)).id, 'acme.hello');
  m.uninstall('acme.hello');
  const wrapped = files.map((f) => ({ name: 'hello-1.0.0/' + f.name, data: f.data }));
  assert.equal(m.installFromBuffer(zip.writeZip(wrapped)).id, 'acme.hello');
  assert.throws(() => m.installFromBuffer(zip.writeZip([...files, { name: '../../evil.txt', data: 'x' }])), /unsafe path/);
  assert.throws(() => m.installFromBuffer(zip.writeZip([{ name: 'index.js', data: 'x' }])), /Invalid extension/);
  assert.throws(() => m.installFromBuffer(zip.writeZip([])), /empty|valid zip/);
  assert.equal(m.list().length, 1);
});

test('dev extensions load in place, conflict with installed ones, and uninstall only unlinks', () => {
  const { m } = mgr();
  const dev = makeExt(path.join(tmp(), 'dev'));
  m.addDev(dev);
  const e = m.find('acme.hello');
  assert.equal(e.source, 'dev'); assert.equal(e.dir, fs.realpathSync(dev));
  write(dev, 'index.js', '// changed'); assert.equal(m.loadMain('acme.hello'), '// changed');   // reads live from disk
  assert.throws(() => m.installFromFolder(makeExt(path.join(tmp(), 'other'))), /development folder/);
  m.uninstall('acme.hello');
  assert.ok(fs.existsSync(path.join(dev, 'manifest.json')), 'the developer folder is untouched');
  m.installFromFolder(dev);
  assert.throws(() => m.addDev(dev), /already installed/);
});

test('bundled catalog: listing, install, update available, state persists', async () => {
  const bundled = tmp();
  makeExt(path.join(bundled, 'hello'), { version: '1.0.0', categories: ['Tools'] });
  makeExt(path.join(bundled, 'other'), { id: 'acme.other', name: 'Other', contributes: { commands: [{ id: 'x', title: 'X' }] } });
  const { m, data } = mgr(bundled);
  let c = await m.catalog();
  assert.deepEqual(c.extensions.map((e) => e.id), ['acme.hello', 'acme.other']);
  assert.equal(c.extensions[0].installed, false); assert.equal(c.extensions[0].source, 'bundled');
  assert.equal(c.extensions[0].contributes.commands, 1);
  await m.install('acme.hello');
  c = await m.catalog();
  assert.equal(c.extensions[0].installed, true); assert.equal(c.extensions[0].updateAvailable, false);
  makeExt(path.join(bundled, 'hello'), { version: '1.1.0' });
  c = await m.catalog();
  assert.equal(c.extensions[0].updateAvailable, true); assert.equal(c.extensions[0].installedVersion, '1.0.0');
  await m.install('acme.hello');
  assert.equal(m.find('acme.hello').manifest.version, '1.1.0');
  await assert.rejects(m.install('nope.nothing'), /not in the store/);
  await assert.rejects(m.install('../etc'), /Invalid extension id/);
  m.setEnabled('acme.hello', false);
  const again = new ext.ExtensionManager({ dataDir: data, bundledDir: bundled });
  assert.equal(again.find('acme.hello').enabled, false, 'enabled state survives a restart');
  assert.match(m.readme('acme.other'), /readme text/, 'README of an uninstalled catalog entry');
});

test('icons become data URLs; oversized or missing icons are rejected', () => {
  const { m } = mgr();
  const dir = makeExt(path.join(tmp(), 'i'), { icon: 'icon.svg' });
  assert.throws(() => m.installFromFolder(dir), /"icon" file/);
  write(dir, 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  m.installFromFolder(dir);
  assert.match(m.icon('acme.hello'), /^data:image\/svg\+xml;base64,/);
  write(dir, 'icon.svg', 'x'.repeat(300 * 1024));
  assert.throws(() => m.installFromFolder(dir), /too large/);
});

test('storage is per-extension and size limited', () => {
  const { m } = mgr();
  assert.deepEqual(m.storageGet('acme.hello'), {});
  m.storageSet('acme.hello', { a: 1 });
  assert.deepEqual(m.storageGet('acme.hello'), { a: 1 });
  assert.throws(() => m.storageSet('acme.hello', { big: 'x'.repeat(2 * 1024 * 1024) }), /storage is full/);
  assert.throws(() => m.storageSet('../escape', {}), /Invalid extension id/);
});

test('scaffold produces a valid, installable extension; package round trips', () => {
  const { m } = mgr();
  const parent = tmp();
  const { dir, id } = m.scaffold(parent, { name: 'My Cool Tool!', publisher: 'Jane Doe' });
  assert.equal(id, 'jane-doe.my-cool-tool');
  assert.ok(fs.existsSync(path.join(dir, 'index.js')) && fs.existsSync(path.join(dir, 'README.md')));
  assert.throws(() => m.scaffold(parent, { name: 'My Cool Tool!', publisher: 'Jane Doe' }), /already exists/);
  assert.throws(() => m.scaffold(parent, { name: '!!!', publisher: 'x' }), /name/);
  m.addDev(dir);
  assert.match(m.loadMain(id), /sunlight\.commands\.register\('hello'/);
  const out = m.packageExtension(dir, path.join(parent, 'pkg.zip'));
  assert.equal(out.id, id); assert.ok(out.files >= 3);
  const m2 = mgr().m;
  assert.equal(m2.installFromZip(out.file).id, id);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(out.file)).digest('hex'), out.sha256);
});

// ---- registry over real HTTP ----
function serve(routes) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const r = routes[req.url];
      if (!r) { res.statusCode = 404; res.end('nope'); return; }
      res.setHeader('content-type', r.type || 'application/octet-stream');
      res.end(r.body);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('registry: browse, install with checksum, tampering and spoofing are rejected', async () => {
  const pkg = zip.writeZip([{ name: 'manifest.json', data: JSON.stringify(manifest({ id: 'remote.tool', name: 'Remote Tool', version: '2.0.0' })) }, { name: 'index.js', data: "sunlight.commands.register('run', () => {});" }]);
  const sha = crypto.createHash('sha256').update(pkg).digest('hex');
  const spoof = zip.writeZip([{ name: 'manifest.json', data: JSON.stringify(manifest({ id: 'someone.else' })) }, { name: 'index.js', data: 'x' }]);
  const greedy = zip.writeZip([{ name: 'manifest.json', data: JSON.stringify(manifest({ id: 'remote.greedy', version: '2.0.0', permissions: ['editor.read', 'editor.write', 'workspace.write'] })) }, { name: 'index.js', data: 'x' }]);
  const wrongVersion = zip.writeZip([{ name: 'manifest.json', data: JSON.stringify(manifest({ id: 'remote.version', version: '9.9.9' })) }, { name: 'index.js', data: 'x' }]);
  const entry = (id, url, hash) => ({ id, name: id, version: '2.0.0', description: 'd', publisher: 'p', permissions: ['editor.read', 'bogus'], downloadUrl: url, sha256: hash });
  let base;
  const routes = {};
  const s = await serve(routes); base = s.base;
  routes['/catalog.json'] = { type: 'application/json', body: JSON.stringify({ extensions: [
    entry('remote.tool', `${base}/tool.zip`, sha),
    entry('remote.tampered', `${base}/tool.zip`, 'a'.repeat(64)),
    entry('remote.spoof', `${base}/spoof.zip`, crypto.createHash('sha256').update(spoof).digest('hex')),
    entry('remote.insecure', 'http://example.com/x.zip', sha),
    entry('remote.greedy', `${base}/greedy.zip`, crypto.createHash('sha256').update(greedy).digest('hex')),
    entry('remote.version', `${base}/version.zip`, crypto.createHash('sha256').update(wrongVersion).digest('hex')),
    { id: 'BAD ID', name: 'x', version: '1.0.0', downloadUrl: `${base}/tool.zip`, sha256: sha },
    entry('remote.nohash', `${base}/tool.zip`, 'xyz'),
  ] }) };
  routes['/tool.zip'] = { body: pkg }; routes['/spoof.zip'] = { body: spoof }; routes['/greedy.zip'] = { body: greedy }; routes['/version.zip'] = { body: wrongVersion };
  try {
    const { m } = mgr();
    assert.throws(() => m.setRegistry('http://example.com/catalog.json'), /https:\/\//);
    assert.throws(() => m.setRegistry('ftp://x'), /https:\/\//);
    m.setRegistry(`${base}/catalog.json`);
    const c = await m.catalog();
    assert.equal(c.registryError, null);
    assert.deepEqual(c.extensions.map((e) => e.id).sort(), ['remote.greedy', 'remote.spoof', 'remote.tampered', 'remote.tool', 'remote.version']);
    const tool = c.extensions.find((e) => e.id === 'remote.tool');
    assert.equal(tool.source, 'registry'); assert.deepEqual(tool.permissions, ['editor.read'], 'unknown permissions are dropped');
    await m.install('remote.tool');
    assert.equal(m.find('remote.tool').manifest.version, '2.0.0');
    await assert.rejects(m.install('remote.tampered'), /checksum/);
    await assert.rejects(m.install('remote.spoof'), /contains "someone.else", not "remote.spoof"/);
    assert.equal(m.find('someone.else'), null, 'the spoofed package was removed again');
    await assert.rejects(m.install('remote.greedy'), /asks for permissions the registry did not list \(editor.write, workspace.write\)/);
    assert.equal(m.find('remote.greedy'), null, 'a package that asks for unlisted permissions is removed again');
    await assert.rejects(m.install('remote.version'), /contains "acme.hello"|version/);
    assert.equal(m.find('remote.tampered'), null);
    // registry failures are reported without breaking the catalog
    m.state.registry = `${base}/missing.json`; m._registry = { at: 0, url: '', list: [] };
    const bad = await m.catalog({ refresh: true });
    assert.match(bad.registryError, /404/); assert.ok(Array.isArray(bad.extensions));
  } finally { s.server.close(); }
});

test('registry downloads are size-limited and must stay on allowed hosts', async () => {
  const s = await serve({ '/big': { body: Buffer.alloc(3 * 1024 * 1024) }, '/ok': { body: 'x' } });
  try {
    const { m } = mgr();
    await assert.rejects(m._download(`${s.base}/big`, 1024 * 1024), /too large/);
    assert.equal((await m._download(`${s.base}/ok`, 10)).toString(), 'x');
    await assert.rejects(m._download('http://example.com/x', 10), /https/);
    await assert.rejects(m._download('file:///etc/passwd', 10), /https/);
  } finally { s.server.close(); }
});

test('rejected registry update preserves the installed version, state and storage', () => {
  const { m } = mgr();
  m.installFromFolder(makeExt(path.join(tmp(), 'original')));
  m.setEnabled('acme.hello', false);
  m.storageSet('acme.hello', { preference: 42 });
  const entry = { id: 'acme.hello', version: '2.0.0', permissions: ['editor.read'] };
  for (const override of [{ id: 'other.tool' }, { version: '9.0.0' }, { permissions: ['workspace.write'] }]) {
    const pkg = zip.writeZip([{ name: 'manifest.json', data: JSON.stringify(manifest({ version: '2.0.0', ...override })) }, { name: 'index.js', data: 'replacement' }]);
    assert.throws(() => m.installFromBufferChecked(pkg, entry));
    assert.equal(m.find('acme.hello').manifest.version, '1.0.0');
    assert.equal(m.find('acme.hello').enabled, false);
    assert.deepEqual(m.storageGet('acme.hello'), { preference: 42 });
    assert.match(m.loadMain('acme.hello'), /register/);
  }
});

test('built static registry supports remote details, themes and installation', async () => {
  const { buildRegistry } = await import('../scripts/build-registry.js').then((m) => m.default);
  const source = tmp(), output = tmp();
  makeExt(path.join(source, 'theme'), { id: 'acme.theme', main: undefined, permissions: [], contributes: { themes: [{ id: 'night', label: 'Night', type: 'dark', colors: { accent: '#123456' } }] } });
  const routes = {}, s = await serve(routes);
  try {
    const built = buildRegistry({ source, output, baseUrl: s.base });
    routes['/catalog.json'] = { body: fs.readFileSync(path.join(output, 'catalog.json')) };
    const entry = built.extensions[0];
    routes[new URL(entry.downloadUrl).pathname] = { body: fs.readFileSync(path.join(output, 'packages', path.basename(new URL(entry.downloadUrl).pathname))) };
    const { m } = mgr(); m.setRegistry(s.base + '/catalog.json');
    const catalog = await m.catalog();
    assert.equal(catalog.registryError, null);
    assert.equal(catalog.extensions[0].hasCode, false);
    assert.equal(catalog.extensions[0].contributes.themes, 1);
    assert.equal(catalog.extensions[0].features.themes[0].label, 'Night');
    assert.match(m.readme('acme.theme'), /readme text/);
    await m.install('acme.theme');
    assert.equal(m.find('acme.theme').manifest.contributes.themes.length, 1);
  } finally { s.server.close(); }
});

test('update checks cannot change the version or permissions that the user reviewed', async () => {
  const bundled = tmp();
  const dir = makeExt(path.join(bundled, 'tool'));
  const { m } = mgr(bundled);
  await m.install('acme.hello');
  makeExt(dir, { version: '2.0.0', permissions: ['editor.read', 'workspace.write'] });
  const stale = { version: '1.0.0', source: 'bundled', permissions: ['editor.read'] };
  await assert.rejects(m.install('acme.hello', stale), /listing changed/);
  await assert.rejects(m.install('acme.hello', { ...stale, version: '2.0.0' }), /listing changed/);
  assert.equal(m.find('acme.hello').manifest.version, '1.0.0');
  await m.install('acme.hello', { ...stale, version: '2.0.0', permissions: ['editor.read', 'workspace.write'] });
  assert.equal(m.find('acme.hello').manifest.version, '2.0.0');
});
