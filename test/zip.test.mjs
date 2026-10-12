import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import zip from '../src/main/zip.js';

const files = [
  { name: 'manifest.json', data: '{"a":1}' },
  { name: 'src/deep/index.js', data: 'console.log("hi");\n'.repeat(200) },
  { name: 'empty.txt', data: '' },
  { name: 'ünï/çode.txt', data: 'unicode name' },
];

test('round trip with deflate and stored entries', () => {
  for (const deflate of [true, false]) {
    const out = zip.readZip(zip.writeZip(files, { deflate }));
    assert.deepEqual(out.map((f) => f.name), files.map((f) => f.name));
    assert.deepEqual(out.map((f) => f.data.toString()), files.map((f) => f.data));
  }
  assert.ok(zip.writeZip(files).length < zip.writeZip(files, { deflate: false }).length, 'deflate compresses');
});

test('crc32 matches the reference value', () => {
  assert.equal(zip.crc32(Buffer.from('123456789')), 0xCBF43926);
  assert.equal(zip.crc32(zlib.gunzipSync(zlib.gzipSync(Buffer.from('x')))), zip.crc32(Buffer.from('x')));
});

test('unsafe entry names are rejected (zip-slip)', () => {
  for (const name of ['../evil.js', 'a/../../evil.js', '/etc/passwd', 'C:\\x.js', '..\\evil.js', 'ok/../../x']) {
    assert.throws(() => zip.readZip(zip.writeZip([{ name, data: 'x' }])), /unsafe path/, name);
  }
  assert.equal(zip.safeEntryName('a//b/./c'), 'a/b/c');
});

test('duplicate names, bad data and truncation are rejected', () => {
  assert.throws(() => zip.readZip(zip.writeZip([{ name: 'a', data: '1' }, { name: 'a', data: '2' }])), /twice/);
  const good = zip.writeZip([{ name: 'a.txt', data: 'hello world hello world' }], { deflate: false });
  const bad = Buffer.from(good);
  bad[30 + 'a.txt'.length] ^= 0xFF; // flip a data byte
  assert.throws(() => zip.readZip(bad), /checksum/);
  assert.throws(() => zip.readZip(good.subarray(0, 40)), /valid zip/);
  assert.throws(() => zip.readZip(Buffer.from('not a zip file at all, definitely')), /valid zip/);
  assert.throws(() => zip.readZip(Buffer.alloc(10)), /valid zip/);
});

test('limits: file count, per-file size, total size, zip bombs', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.txt`, data: 'x' }));
  assert.throws(() => zip.readZip(zip.writeZip(many), { maxFiles: 10 }), /too many files/);
  assert.throws(() => zip.readZip(zip.writeZip([{ name: 'big.bin', data: Buffer.alloc(3000) }]), { maxFileSize: 1000 }), /too large/);
  assert.throws(() => zip.readZip(zip.writeZip([{ name: 'a', data: Buffer.alloc(800) }, { name: 'b', data: Buffer.alloc(800) }]), { maxTotal: 1000 }), /too large when extracted/);
  // A header that lies about the uncompressed size must not be trusted: 10 MB of zeros declared as 100 bytes.
  const bomb = zip.writeZip([{ name: 'z.bin', data: Buffer.alloc(10 * 1024 * 1024) }]);
  const eocd = bomb.length - 22; const cd = bomb.readUInt32LE(eocd + 16);
  const lying = Buffer.from(bomb);
  lying.writeUInt32LE(100, cd + 24);
  const lho = lying.readUInt32LE(cd + 42); lying.writeUInt32LE(100, lho + 22);
  assert.throws(() => zip.readZip(lying), /decompressed|wrong size/);
});

test('symlinks and encryption are refused', () => {
  const z = Buffer.from(zip.writeZip([{ name: 'link', data: '/etc/passwd' }], { deflate: false }));
  const cd = z.readUInt32LE(z.length - 22 + 16);
  z.writeUInt32LE((0o120777 << 16) >>> 0, cd + 38);
  assert.throws(() => zip.readZip(z), /symbolic link/);
  const e = Buffer.from(zip.writeZip([{ name: 'a', data: 'x' }], { deflate: false }));
  e.writeUInt16LE(e.readUInt16LE(e.readUInt32LE(e.length - 22 + 16) + 8) | 1, e.readUInt32LE(e.length - 22 + 16) + 8);
  assert.throws(() => zip.readZip(e), /Encrypted/);
});
