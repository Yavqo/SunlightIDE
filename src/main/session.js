'use strict';
const fs = require('fs');
const path = require('path');
const MAX_BYTES = 128 * 1024 * 1024;
function validate(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.documents) || snapshot.documents.length > 1000) throw new Error('Invalid recovery snapshot.');
  if (snapshot.root !== null && !path.isAbsolute(snapshot.root || '')) throw new Error('Invalid recovery folder.');
  const ids = new Set();
  for (const doc of snapshot.documents) {
    if (!doc || typeof doc.id !== 'string' || !doc.id || ids.has(doc.id) || typeof doc.name !== 'string' || typeof doc.dirty !== 'boolean') throw new Error('Invalid recovery document.');
    if (doc.path !== null && !path.isAbsolute(doc.path || '')) throw new Error('Invalid recovery path.');
    if (doc.text !== null && typeof doc.text !== 'string') throw new Error('Invalid recovery text.');
    if ((doc.dirty || !doc.path) && typeof doc.text !== 'string') throw new Error('Missing recovery text.');
    ids.add(doc.id);
  }
  if (snapshot.layout != null) {
    const layout = snapshot.layout;
    if (!Array.isArray(layout.groups) || ![1, 2].includes(layout.groups.length) || !Number.isFinite(layout.ratio) || layout.ratio < 0.25 || layout.ratio > 0.75) throw new Error('Invalid editor layout.');
    const groupIds = new Set();
    for (const group of layout.groups) {
      if (!group || !['left', 'right'].includes(group.id) || groupIds.has(group.id) || !Array.isArray(group.documents) || !Array.isArray(group.views)) throw new Error('Invalid editor group.');
      if (group.documents.some((id) => !ids.has(id)) || group.views.some((v) => !v || !ids.has(v.document)) || (group.active !== null && !group.documents.includes(group.active))) throw new Error('Invalid editor group document.');
      groupIds.add(group.id);
    }
    if (!groupIds.has('left') || !groupIds.has(layout.activeGroup)) throw new Error('Invalid active editor group.');
  }
  return snapshot;
}
class SessionStore {
  constructor(dir) { this.dir = dir; this.file = path.join(dir, 'session.json'); this.backup = path.join(dir, 'session.previous.json'); }
  read(file) {
    if (fs.statSync(file).size > MAX_BYTES) throw new Error('Recovery snapshot exceeds 128 MB.');
    return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  load() {
    let error;
    try { return { snapshot: this.read(this.file), warning: null }; } catch (err) { error = err; }
    try { return { snapshot: this.read(this.backup), warning: 'Recovered the previous checkpoint because the latest recovery file could not be read.' }; }
    catch { return { snapshot: null, warning: error.code === 'ENOENT' ? null : 'The recovery files could not be read. Your saved files are unaffected.' }; }
  }
  save(snapshot, { discard = false } = {}) {
    validate(snapshot);
    const text = JSON.stringify(snapshot);
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Session recovery exceeds 128 MB. Save or close large drafts to resume checkpoints.');
    fs.mkdirSync(this.dir, { recursive: true });
    // Keep the last valid checkpoint when the current file is corrupt.
    let valid = false;
    try { this.read(this.file); valid = true; } catch { /* first save or damaged file */ }
    if (discard) {
      const backupFd = fs.openSync(this.backup + '.tmp', 'w', 0o600);
      try { fs.writeFileSync(backupFd, text); fs.fsyncSync(backupFd); } finally { fs.closeSync(backupFd); }
      fs.renameSync(this.backup + '.tmp', this.backup);
    } else if (valid) {
      fs.copyFileSync(this.file, this.backup + '.tmp');
      fs.chmodSync(this.backup + '.tmp', 0o600);
      fs.renameSync(this.backup + '.tmp', this.backup);
    }
    const fd = fs.openSync(this.file + '.tmp', 'w', 0o600);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(this.file + '.tmp', this.file);
    return true;
  }
}
module.exports = { SessionStore, validate, MAX_BYTES };
