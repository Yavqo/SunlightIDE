'use strict';
// Crash the real Electron main process after a checkpoint, then restart the same profile.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const electron = require('electron');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sunlight-recovery-smoke-'));
const demo = path.join(work, 'demo'), profile = path.join(work, 'profile');
fs.cpSync('test/fixtures/demo', demo, { recursive: true }); fs.mkdirSync(profile);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const split = process.argv.includes('--split');
let child;
function launch(script) {
  const proc = spawn(electron, ['.'], { env: { ...process.env, SUNLIGHT_USER_DATA: profile, SUNLIGHT_DEMO: demo, SUNLIGHT_SMOKE: script }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  proc.stdout.on('data', (d) => { output += d; }); proc.stderr.on('data', (d) => { output += d; });
  const done = new Promise((resolve) => proc.on('exit', () => resolve(output)));
  return { proc, done, output: () => output };
}
(async () => {
  child = launch(split ? 'test/smoke/split-recovery-write.js' : 'test/smoke/recovery-write.js');
  for (let i = 0; i < 300 && !fs.existsSync(path.join(demo, 'recovery-ready')); i++) {
    if (child.proc.exitCode !== null) throw new Error(child.output());
    await delay(100);
  }
  if (!fs.existsSync(path.join(demo, 'recovery-ready'))) throw new Error('Crash checkpoint timed out. ' + child.output());
  child.proc.kill('SIGKILL'); await child.done;
  if (!split) {
  fs.writeFileSync(path.join(demo, 'edited.txt'), 'external edit');
  fs.writeFileSync(path.join(demo, 'clean.txt'), 'new clean disk content');
  fs.unlinkSync(path.join(demo, 'deleted.txt'));
  }
  child = launch(split ? 'test/smoke/split-recovery-read.js' : 'test/smoke/recovery-read.js');
  const timer = setTimeout(() => child.proc.kill('SIGKILL'), 30000);
  const output = await child.done; clearTimeout(timer);
  const match = /SMOKE_RESULT (.*)/.exec(output);
  if (!match) throw new Error(output || 'Recovery smoke timed out.');
  const result = JSON.parse(match[1]); console.log('RECOVERY_RESULT ' + JSON.stringify(result));
  if (result.failed.length || result.errors.length) process.exitCode = 1;
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { child?.proc.kill('SIGKILL'); fs.rmSync(work, { recursive: true, force: true }); });
