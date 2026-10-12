'use strict';
const { Worker } = require('worker_threads');
const path = require('path');
let worker, sequence = 0;
const pending = new Map();
function stop(reason = 'Language service stopped.') {
  const old = worker; worker = null;
  for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error(reason)); }
  pending.clear();
  old?.terminate();
}
function run(method, request) {
  if (!worker) {
    const current = worker = new Worker(path.join(__dirname, 'language-worker.js').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'));
    current.on('message', ({ id, value, error }) => {
      const p = pending.get(id); if (!p) return;
      pending.delete(id); clearTimeout(p.timer);
      if (error) p.reject(new Error(error)); else p.resolve(value);
    });
    current.on('error', (error) => { if (worker === current) stop(error.message); });
    current.on('exit', () => { if (worker === current) stop(); });
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => stop('Language service timed out. Try again.'), 20000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, method, request });
  });
}
module.exports = { run, stop };
