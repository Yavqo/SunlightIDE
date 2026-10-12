'use strict';
// Build a static HTTPS registry from reviewed extension folders.
const fs = require('fs');
const path = require('path');
const { ExtensionManager, allowedUrl } = require('../src/main/extensions');
function buildRegistry({ source, output, baseUrl }) {
  if (!allowedUrl(baseUrl)) throw new Error('Use an HTTPS base URL (HTTP is allowed for localhost).');
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const manager = new ExtensionManager({ dataDir: output, bundledDir: source });
  const entries = [];
  const ids = new Set();
  fs.mkdirSync(path.join(output, 'packages'), { recursive: true });
  for (const dirent of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
    const dir = path.join(source, dirent.name);
    const manifest = manager.inspectFolder(dir);
    if (ids.has(manifest.id)) throw new Error(`Duplicate extension id: ${manifest.id}`);
    ids.add(manifest.id);
    const filename = `${manifest.id}-${manifest.version}.zip`;
    const result = manager.packageExtension(dir, path.join(output, 'packages', filename));
    if (result.bytes > 10 * 1024 * 1024) throw new Error(`${manifest.id} exceeds the client package limit of 10 MB.`);
    const readmeName = fs.readdirSync(dir).find((name) => /^readme(\.md)?$/i.test(name));
    const readme = readmeName ? fs.readFileSync(path.join(dir, readmeName), 'utf8') : '';
    entries.push({ ...manifest, main: manifest.main || null, icon: undefined, readme,
      downloadUrl: new URL(`packages/${filename}`, base).href, sha256: result.sha256 });
  }
  const catalog = { schemaVersion: 1, extensions: entries };
  const text = JSON.stringify(catalog, null, 2) + '\n';
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Registry exceeds the client limit of 2 MB.');
  fs.writeFileSync(path.join(output, 'catalog.json.tmp'), text);
  fs.renameSync(path.join(output, 'catalog.json.tmp'), path.join(output, 'catalog.json'));
  return catalog;
}
if (require.main === module) {
  const [baseUrl, source = 'extensions/store', output = 'build/registry'] = process.argv.slice(2);
  try {
    const catalog = buildRegistry({ baseUrl: baseUrl || '', source: path.resolve(source), output: path.resolve(output) });
    console.log(`Built ${catalog.extensions.length} extensions in ${path.resolve(output)}. Upload this directory to ${baseUrl}`);
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
module.exports = { buildRegistry };
