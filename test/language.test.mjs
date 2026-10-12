import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import language from '../src/main/language.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sunlight-language-'));
const file = path.join(root, 'main.ts');
const dep = path.join(root, 'model.ts');
fs.writeFileSync(dep, 'export const person = { name: "Ada", age: 36 };\n');
fs.writeFileSync(file, '');
const request = (text, offset = 0, documents = []) => ({ root, file, offset, documents: [{ file, text, version: text }, ...documents] });
test.after(() => { language.stop(); fs.rmSync(root, { recursive: true, force: true }); });

test('semantic completion uses imported symbols and unsaved buffers', async () => {
  const text = 'import { person } from "./model";\nperson.na';
  const result = await language.run('completion', request(text, text.length));
  assert.ok(result.some((e) => e.label === 'name'));
  const changed = await language.run('completion', request(text.replace('person.na', 'person.ni'), text.length, [{ file: dep, text: 'export const person = { nickname: "Ada" };', version: 1 }]));
  assert.ok(changed.some((e) => e.label === 'nickname'));
});
test('hover, definition, diagnostics and rename return meaningful locations', async () => {
  const text = 'import { person } from "./model";\nconst age: string = person.age;\nconsole.log(person.name);';
  const offset = text.lastIndexOf('person') + 2;
  const info = await language.run('hover', request(text, offset));
  assert.match(info.signature, /person/);
  const definitions = await language.run('definition', request(text, offset));
  assert.equal(definitions[0].file, dep);
  const diagnostics = await language.run('diagnostics', request(text));
  assert.ok(diagnostics.some((d) => d.code === 2322 && d.start.line === 1));
  const locations = await language.run('rename', request(text, offset));
  assert.ok(locations.length >= 3);
  assert.ok(locations.every((l) => l.file === file));
  const crossFile = await language.run('rename', { ...request(text), file: dep, offset: 15, documents: [...request(text).documents, { file: dep, text: fs.readFileSync(dep, 'utf8'), version: 1 }] });
  assert.ok(crossFile.some((l) => l.file === dep));
  assert.ok(crossFile.some((l) => l.file === file));
});
test('JavaScript JSDoc is checked and malformed syntax produces diagnostics', async () => {
  const js = path.join(root, 'plain.js');
  const text = '/** @type {number} */\nlet count = "wrong";\nconst broken = ;';
  const result = await language.run('diagnostics', { root, file: js, documents: [{ file: js, text, version: 1 }] });
  assert.ok(result.some((d) => d.code === 2322));
  assert.ok(result.some((d) => d.start.line === 2));
});
test('unsupported requests fail without crashing the worker', async () => {
  await assert.rejects(language.run('execute', request('')), /Unknown language request/);
  await assert.rejects(language.run('completion', {}), /Invalid language request/);
  assert.ok(Array.isArray(await language.run('diagnostics', request('const ok = 1;'))));
});

test('project configuration changes are picked up without restarting', async () => {
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { checkJs: false, allowJs: true, strict: false } }));
  const js = path.join(root, 'config.js');
  const result = await language.run('diagnostics', { root, file: js, documents: [{ file: js, text: '/** @type {number} */\nlet count = "wrong";', version: 1 }] });
  assert.ok(!result.some((d) => d.code === 2322));
});

test('reopened buffers refresh even when their editor version resets', async () => {
  const first = request('const value = { first: 1 }; value.');
  first.offset = first.documents[0].text.length; first.documents[0].version = 0;
  assert.ok((await language.run('completion', first)).some((e) => e.label === 'first'));
  const second = request('const value = { second: 1 }; value.');
  second.offset = second.documents[0].text.length; second.documents[0].version = 0;
  const entries = await language.run('completion', second);
  assert.ok(entries.some((e) => e.label === 'second'));
  assert.ok(!entries.some((e) => e.label === 'first'));
});
