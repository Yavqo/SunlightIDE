'use strict';
// Git service. Everything goes through the real `git` executable with explicit argument arrays
// (never a shell string), so file names and branch names can't inject commands.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function gitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(npm_|ELECTRON_|SUNLIGHT_)/i.test(k) || k === 'NODE_ENV' || k === 'INIT_CWD') continue;
    env[k] = v;
  }
  // Never block waiting for a password or an editor; failures surface as errors instead.
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_EDITOR = 'true';
  env.GIT_MERGE_AUTOEDIT = 'no';
  env.GCM_INTERACTIVE = 'never';
  return env;
}

function run(cwd, args, { input, timeout = 30000, okCodes = [0], lock = false } = {}) {
  return new Promise((resolve, reject) => {
    const full = [...(lock ? [] : ['--no-optional-locks']), '-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args];
    let child;
    try { child = spawn('git', full, { cwd, env: gitEnv() }); } catch (err) { reject(err); return; }
    const out = [], err = [];
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      reject(new Error(`git ${args[0]} timed out`));
    }, timeout);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? Object.assign(new Error('Git was not found. Install Git to use source control.'), { code: 'ENOGIT' }) : e);
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (okCodes.includes(code)) resolve({ code, stdout, stderr });
      else reject(Object.assign(new Error((stderr || stdout || `git exited with code ${code}`).trim()), { code }));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input == null ? undefined : input);
  });
}

// ---- repo discovery ----
const rootCache = new Map();

async function info(dir) {
  let opened;
  try { opened = fs.realpathSync(dir); } catch { return { available: true, isRepo: false }; }
  const hit = rootCache.get(opened);
  if (hit && Date.now() - hit.at < 4000) return hit.value;
  let value;
  try {
    const r = await run(opened, ['rev-parse', '--show-toplevel']);
    const root = r.stdout.trim();
    value = { available: true, isRepo: !!root, root, opened, prefix: path.relative(root, opened).split(path.sep).join('/') };
  } catch (err) {
    if (err.code === 'ENOGIT') value = { available: false, isRepo: false, error: err.message };
    else value = { available: true, isRepo: false };
  }
  rootCache.set(opened, { at: Date.now(), value });
  return value;
}

async function repo(dir) {
  const i = await info(dir);
  if (!i.available) throw new Error(i.error || 'Git is not available.');
  if (!i.isRepo) throw new Error('This folder is not a Git repository.');
  return i;
}

function cleanRel(p) {
  if (typeof p !== 'string' || !p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) throw new Error(`Invalid path: ${p}`);
  return p.split(path.sep).join('/');
}
function cleanRefName(n) {
  if (typeof n !== 'string' || !n.trim() || n.startsWith('-') || /[\0\n]/.test(n)) throw new Error(`Invalid name: ${n}`);
  return n.trim();
}

// Serialise operations that write to the repository (index.lock conflicts otherwise).
const queues = new Map();
function serial(root, fn) {
  const prev = queues.get(root) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(root, next.catch(() => {}));
  return next;
}

// ---- status ----
// Parses `git status --porcelain=v2 --branch -z`.
function parseStatus(text) {
  const out = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, detached: false, entries: [] };
  const tok = text.split('\0');
  for (let i = 0; i < tok.length; i++) {
    const t = tok[i];
    if (!t) continue;
    if (t[0] === '#') {
      const [, key, ...rest] = t.split(' ');
      const val = rest.join(' ');
      if (key === 'branch.head') { out.branch = val === '(detached)' ? null : val; out.detached = val === '(detached)'; }
      else if (key === 'branch.oid') out.oid = val === '(initial)' ? null : val;
      else if (key === 'branch.upstream') out.upstream = val;
      else if (key === 'branch.ab') { const m = /\+(\d+) -(\d+)/.exec(val); if (m) { out.ahead = +m[1]; out.behind = +m[2]; } }
    } else if (t[0] === '1') {
      const p = t.split(' ');
      out.entries.push({ kind: 'changed', x: p[1][0], y: p[1][1], path: p.slice(8).join(' ') });
    } else if (t[0] === '2') {
      const p = t.split(' ');
      out.entries.push({ kind: 'renamed', x: p[1][0], y: p[1][1], path: p.slice(9).join(' '), orig: tok[++i] });
    } else if (t[0] === 'u') {
      const p = t.split(' ');
      out.entries.push({ kind: 'unmerged', x: p[1][0], y: p[1][1], path: p.slice(10).join(' ') });
    } else if (t[0] === '?') out.entries.push({ kind: 'untracked', x: '.', y: '?', path: t.slice(2) });
    else if (t[0] === '!') out.entries.push({ kind: 'ignored', x: '.', y: '!', path: t.slice(2) });
  }
  return out;
}

async function status(dir) {
  const i = await info(dir);
  if (!i.available || !i.isRepo) return { ...i, entries: [] };
  const r = await run(i.root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignored=matching']);
  const s = parseStatus(r.stdout);
  if (s.entries.length > 8000) s.entries.length = 8000; // keep the UI responsive in huge repos
  return { ...i, ...s, hasCommits: !!s.oid };
}

// ---- operations ----
async function headText(dir, rel) {
  const i = await repo(dir);
  try {
    const r = await run(i.root, ['show', `HEAD:${cleanRel(rel)}`]);
    if (r.stdout.includes('\0')) return { binary: true };
    return { text: r.stdout };
  } catch { return null; }
}

async function stage(dir, files) {
  const i = await repo(dir);
  return serial(i.root, () => run(i.root, files && files.length ? ['add', '--', ...files.map(cleanRel)] : ['add', '-A'], { lock: true }));
}

async function unstage(dir, files) {
  const i = await repo(dir);
  const hasHead = await run(i.root, ['rev-parse', '--verify', '-q', 'HEAD'], { okCodes: [0, 1] }).then((r) => r.code === 0);
  const paths = files && files.length ? files.map(cleanRel) : ['.'];
  return serial(i.root, () => run(i.root, hasHead ? ['restore', '--staged', '--', ...paths] : ['rm', '--cached', '-r', '-q', '--', ...paths], { lock: true }));
}

async function discard(dir, { tracked = [], untracked = [] } = {}) {
  const i = await repo(dir);
  return serial(i.root, async () => {
    if (tracked.length) await run(i.root, ['restore', '--', ...tracked.map(cleanRel)], { lock: true });
    if (untracked.length) await run(i.root, ['clean', '-f', '--', ...untracked.map(cleanRel)], { lock: true });
  });
}

async function commit(dir, message, { amend = false, all = false } = {}) {
  const i = await repo(dir);
  const msg = (message || '').trim();
  if (!msg && !amend) throw new Error('Enter a commit message.');
  const args = ['commit', ...(all ? ['-a'] : []), ...(amend ? ['--amend'] : []), ...(msg ? ['-F', '-'] : ['--no-edit'])];
  const r = await serial(i.root, () => run(i.root, args, { input: msg || undefined, lock: true, timeout: 60000 }));
  return r.stdout.trim().split('\n')[0];
}

async function remotes(root) {
  const r = await run(root, ['remote']);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function push(dir) {
  const i = await repo(dir);
  const s = await status(dir);
  return serial(i.root, async () => {
    if (!s.upstream) {
      const rs = await remotes(i.root);
      if (!rs.length) throw new Error('No remote repository is configured. Add one with: git remote add origin <url>');
      const remote = rs.includes('origin') ? 'origin' : rs[0];
      const r = await run(i.root, ['push', '-u', remote, 'HEAD'], { lock: true, timeout: 120000 });
      return `Pushed to ${remote}`;
    }
    await run(i.root, ['push'], { lock: true, timeout: 120000 });
    return 'Pushed';
  });
}

async function pull(dir) {
  const i = await repo(dir);
  return serial(i.root, async () => (await run(i.root, ['pull', '--no-edit'], { lock: true, timeout: 120000 })).stdout.trim().split('\n').pop());
}

async function fetch(dir) {
  const i = await repo(dir);
  return serial(i.root, () => run(i.root, ['fetch', '--all', '--prune'], { lock: true, timeout: 120000 }));
}

async function branches(dir) {
  const i = await repo(dir);
  const fmt = '%(refname)%00%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(objectname:short)%00%(subject)';
  const r = await run(i.root, ['for-each-ref', `--format=${fmt}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes']);
  const out = [];
  for (const line of r.stdout.split('\n')) {
    if (!line) continue;
    const [ref, name, head, upstream, sha, subject] = line.split('\0');
    if (ref.endsWith('/HEAD')) continue;
    out.push({ name, remote: ref.startsWith('refs/remotes/'), current: head === '*', upstream, sha, subject });
  }
  return out;
}

async function checkout(dir, name) {
  const i = await repo(dir);
  const n = cleanRefName(name);
  return serial(i.root, () => run(i.root, ['checkout', n, '--'], { lock: true }));
}

async function createBranch(dir, name, startPoint) {
  const i = await repo(dir);
  const args = ['checkout', '-b', cleanRefName(name)];
  if (startPoint) args.push(cleanRefName(startPoint));
  return serial(i.root, () => run(i.root, args, { lock: true }));
}

async function deleteBranch(dir, name, force = false) {
  const i = await repo(dir);
  return serial(i.root, () => run(i.root, ['branch', force ? '-D' : '-d', cleanRefName(name)], { lock: true }));
}

async function stash(dir, message) {
  const i = await repo(dir);
  return serial(i.root, async () => (await run(i.root, ['stash', 'push', '-u', ...(message ? ['-m', message] : [])], { lock: true })).stdout.trim());
}

async function stashPop(dir) {
  const i = await repo(dir);
  return serial(i.root, async () => (await run(i.root, ['stash', 'pop'], { lock: true })).stdout.trim().split('\n')[0]);
}

async function log(dir, { file, n = 200 } = {}) {
  const i = await repo(dir);
  const fmt = '%h%x00%an%x00%ad%x00%s%x00%D';
  const args = ['log', `-n${Math.min(1000, n | 0 || 200)}`, '--date=short', `--pretty=format:${fmt}`];
  if (file) args.push('--follow', '--', cleanRel(file));
  let r;
  try { r = await run(i.root, args); } catch (err) { if (/does not have any commits/.test(err.message)) return []; throw err; }
  return r.stdout.split('\n').filter(Boolean).map((l) => { const [sha, author, date, subject, refs] = l.split('\0'); return { sha, author, date, subject, refs }; });
}

async function show(dir, sha) {
  const i = await repo(dir);
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) throw new Error('Invalid commit id.');
  return (await run(i.root, ['show', '--stat', '--patch', '--no-color', sha])).stdout;
}

async function diff(dir, rel, { staged = false, untracked = false } = {}) {
  const i = await repo(dir);
  const f = cleanRel(rel);
  if (untracked) return (await run(i.root, ['diff', '--no-index', '--no-color', '--', '/dev/null', f], { okCodes: [0, 1] })).stdout;
  return (await run(i.root, ['diff', '--no-color', '-U3', ...(staged ? ['--cached'] : []), '--', f])).stdout;
}

async function blame(dir, rel, line, contents) {
  const i = await repo(dir);
  const n = Math.max(1, line | 0);
  const args = ['blame', '--porcelain', '-L', `${n},${n}`];
  if (contents != null) args.push('--contents', '-');
  args.push('--', cleanRel(rel));
  let r;
  try { r = await run(i.root, args, { input: contents == null ? undefined : contents }); } catch { return null; }
  const lines = r.stdout.split('\n');
  const sha = (lines[0] || '').split(' ')[0];
  const get = (k) => (lines.find((l) => l.startsWith(k + ' ')) || '').slice(k.length + 1);
  return { sha, uncommitted: /^0+$/.test(sha), author: get('author'), time: +get('author-time') || 0, summary: get('summary') };
}

async function init(dir) {
  rootCache.clear();
  await run(dir, ['init'], { lock: true });
  rootCache.clear();
  return true;
}

const methods = { info, status, headText, stage, unstage, discard, commit, push, pull, fetch, branches, checkout, createBranch, deleteBranch, stash, stashPop, log, show, diff, blame, init };

async function call(method, dir, args = []) {
  if (!Object.prototype.hasOwnProperty.call(methods, method)) throw new Error(`Unknown git method: ${method}`);
  if (typeof dir !== 'string' || !dir) throw new Error('No folder is open.');
  const r = await methods[method](dir, ...args);
  return r === undefined ? null : r;
}

module.exports = { call, parseStatus, info, status, methods, run };
