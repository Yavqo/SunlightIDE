'use strict';
// Minimal ZIP reader/writer (stored + deflate). Written to be strict about untrusted archives:
// no encryption, no zip64, bounded sizes, CRC-checked, and unsafe paths are rejected.

const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function safeEntryName(name) {
  const n = name.replace(/\\/g, '/');
  if (!n || n.includes('\0') || n.startsWith('/') || /^[A-Za-z]:/.test(n)) return null;
  const parts = n.split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length || parts.includes('..')) return null;
  return parts.join('/');
}

// Returns [{ name, data }] for regular files. Throws on anything suspicious.
function readZip(buf, { maxFiles = 500, maxFileSize = 5 * 1024 * 1024, maxTotal = 20 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Not a valid zip file.');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid zip file (no end-of-archive record).');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (count === 0xFFFF || off === 0xFFFFFFFF) throw new Error('Zip64 archives are not supported.');
  if (count > maxFiles) throw new Error(`The archive has too many files (${count}; the limit is ${maxFiles}).`);
  const out = [];
  const seen = new Set();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new Error('The zip file is corrupted (bad directory entry).');
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const extAttr = buf.readUInt32LE(off + 38);
    const lho = buf.readUInt32LE(off + 42);
    const rawName = buf.toString('utf8', off + 46, off + 46 + nlen);
    off += 46 + nlen + xlen + clen;
    if (rawName.endsWith('/')) continue; // directory
    if (flags & 1) throw new Error('Encrypted zip files are not supported.');
    if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF) throw new Error('Zip64 entries are not supported.');
    if (((extAttr >>> 16) & 0o170000) === 0o120000) throw new Error(`The archive contains a symbolic link (${rawName}), which is not allowed.`);
    const name = safeEntryName(rawName);
    if (!name) throw new Error(`The archive contains an unsafe path: "${rawName}".`);
    if (seen.has(name)) throw new Error(`The archive contains "${name}" twice.`);
    seen.add(name);
    if (usize > maxFileSize) throw new Error(`"${name}" is too large (limit ${Math.round(maxFileSize / 1048576)} MB).`);
    total += usize;
    if (total > maxTotal) throw new Error('The archive is too large when extracted.');
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('The zip file is corrupted (bad file header).');
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    if (start + csize > buf.length) throw new Error('The zip file is truncated.');
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try { data = zlib.inflateRawSync(raw, { maxOutputLength: usize + 1 }); } catch { throw new Error(`"${name}" could not be decompressed (corrupt or larger than declared).`); }
    } else throw new Error(`"${name}" uses an unsupported compression method (${method}).`);
    if (data.length !== usize) throw new Error(`"${name}" has the wrong size.`);
    if (crc32(data) !== crc) throw new Error(`"${name}" failed its checksum (the file is corrupted).`);
    out.push({ name, data });
  }
  return out;
}

// files: [{ name, data: Buffer|string }]
function writeZip(files, { deflate = true } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = deflate && data.length > 0 ? zlib.deflateRawSync(data) : data;
    const method = deflate && data.length > 0 ? 8 : 0;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

module.exports = { readZip, writeZip, crc32, safeEntryName };
