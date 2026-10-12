'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const executable = process.argv[2] || (process.platform === 'win32'
  ? path.resolve('dist/win-unpacked/SunlightIDE.exe')
  : path.resolve('dist/mac-arm64/SunlightIDE.app/Contents/MacOS/SunlightIDE'));
if (!fs.existsSync(executable)) throw new Error(`Packaged executable was not found: ${executable}`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunlight-package-smoke-'));
const demo = path.join(dir, 'demo'); fs.mkdirSync(demo);
const proc = spawn(executable, [], { env: { ...process.env, SUNLIGHT_USER_DATA: path.join(dir, 'profile'), SUNLIGHT_DEMO: demo,
  SUNLIGHT_SMOKE: path.resolve('test/smoke/package.js'), SUNLIGHT_SMOKE_DELAY: '2000' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
proc.stdout.on('data', (d) => { output += d; }); proc.stderr.on('data', (d) => { output += d; });
const timer = setTimeout(() => proc.kill('SIGKILL'), 60000);
proc.on('error', (err) => { console.error(err); process.exitCode = 1; });
proc.on('exit', () => {
  clearTimeout(timer);
  const match = /SMOKE_RESULT (.*)/.exec(output);
  if (!match) { console.error(output || 'Packaged application smoke test timed out.'); process.exitCode = 1; }
  else {
    const result = JSON.parse(match[1]); console.log('PACKAGE_RESULT ' + JSON.stringify(result));
    if (result.failed.length || result.errors.length) process.exitCode = 1;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
