// Copies the xterm.js terminal emulator into src/renderer/vendor so the sandboxed renderer can load it
// under a strict CSP (script-src 'self'). Runs automatically after `npm install`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'renderer', 'vendor');
const files = [
  ['@xterm/xterm/lib/xterm.mjs', 'xterm.mjs'],
  ['@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['@xterm/addon-fit/lib/addon-fit.mjs', 'addon-fit.mjs'],
];
fs.mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  const src = path.join(root, 'node_modules', from);
  if (!fs.existsSync(src)) { console.error(`vendor: missing ${from}; run npm install`); process.exitCode = 1; continue; }
  fs.copyFileSync(src, path.join(out, to));
}
console.log('vendor: copied', files.map((f) => f[1]).join(', '));
