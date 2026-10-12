import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import git from '../src/main/git.js';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' } });
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sunlight-git-')));
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const call = (m, dir, ...args) => git.call(m, dir, args);

// Make the commits made by the service work without a global identity.
process.env.GIT_AUTHOR_NAME = 'T'; process.env.GIT_AUTHOR_EMAIL = 't@t';
process.env.GIT_COMMITTER_NAME = 'T'; process.env.GIT_COMMITTER_EMAIL = 't@t';

test('parseStatus handles branch headers, renames, unmerged, untracked, ignored', () => {
  const text = [
    '# branch.oid abc123', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb src/a b.js',
    '2 R. N... 100644 100644 100644 aaa bbb R100 new.js', 'old.js',
    'u UU N... 100644 100644 100644 100644 a b c conflict.js',
    '? untracked.txt', '! node_modules/',
  ].join('\0') + '\0';
  const s = git.parseStatus(text);
  assert.equal(s.branch, 'main'); assert.equal(s.upstream, 'origin/main'); assert.equal(s.ahead, 2); assert.equal(s.behind, 1);
  assert.deepEqual(s.entries.map((e) => [e.kind, e.path]), [['changed', 'src/a b.js'], ['renamed', 'new.js'], ['unmerged', 'conflict.js'], ['untracked', 'untracked.txt'], ['ignored', 'node_modules/']]);
  assert.equal(s.entries[1].orig, 'old.js');
  assert.equal(git.parseStatus('# branch.head (detached)\0').detached, true);
});

test('non-repo folders are reported, init creates a repo', async () => {
  const dir = tmp();
  const i = await call('info', dir);
  assert.equal(i.available, true); assert.equal(i.isRepo, false);
  await call('init', dir);
  const j = await call('info', dir);
  assert.equal(j.isRepo, true); assert.equal(j.root, dir);
});

test('status, stage, unstage, commit, head text, discard', async () => {
  const dir = tmp();
  sh(dir, 'init', '-q', '-b', 'main');
  write(dir, 'a.txt', 'one\n'); write(dir, 'sub/b.txt', 'bee\n'); write(dir, '.gitignore', 'ignored.log\n');
  let s = await call('status', dir);
  assert.equal(s.branch, 'main'); assert.equal(s.hasCommits, false);
  assert.ok(s.entries.some((e) => e.path === 'a.txt' && e.kind === 'untracked'));
  await call('stage', dir, ['a.txt', 'sub/b.txt', '.gitignore']);
  s = await call('status', dir);
  assert.ok(s.entries.find((e) => e.path === 'a.txt').x === 'A');
  await call('unstage', dir, ['sub/b.txt']);               // no HEAD yet: must still work
  s = await call('status', dir);
  assert.equal(s.entries.find((e) => e.path === 'sub/b.txt').kind, 'untracked');
  await call('stage', dir, []);
  await assert.rejects(call('commit', dir, '   '), /commit message/i);
  await call('commit', dir, 'first commit\n\nbody');
  s = await call('status', dir);
  assert.equal(s.hasCommits, true); assert.equal(s.entries.filter((e) => e.kind !== 'ignored').length, 0);
  assert.match(sh(dir, 'log', '-1', '--format=%B'), /first commit\n\nbody/);

  write(dir, 'a.txt', 'one\ntwo\n'); write(dir, 'ignored.log', 'x'); write(dir, 'new.txt', 'n');
  s = await call('status', dir);
  assert.equal(s.entries.find((e) => e.path === 'a.txt').y, 'M');
  assert.ok(s.entries.some((e) => e.path === 'ignored.log' && e.kind === 'ignored'));
  assert.equal((await call('headText', dir, 'a.txt')).text, 'one\n');
  assert.equal(await call('headText', dir, 'new.txt'), null);
  await call('stage', dir, ['a.txt']);
  await call('unstage', dir, ['a.txt']);                   // with HEAD
  assert.equal((await call('status', dir)).entries.find((e) => e.path === 'a.txt').x, '.');
  await call('discard', dir, { tracked: ['a.txt'], untracked: ['new.txt'] });
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\n');
  assert.equal(fs.existsSync(path.join(dir, 'new.txt')), false);
  await call('commit', dir, 'amended message', { amend: true });
  assert.equal(sh(dir, 'log', '-1', '--format=%s').trim(), 'amended message');
  assert.equal(sh(dir, 'rev-list', '--count', 'HEAD').trim(), '1');
});

test('unicode and spaced file names round-trip', async () => {
  const dir = tmp();
  sh(dir, 'init', '-q', '-b', 'main');
  write(dir, 'my file ünï.txt', 'x');
  const s = await call('status', dir);
  assert.ok(s.entries.some((e) => e.path === 'my file ünï.txt'), JSON.stringify(s.entries));
  await call('stage', dir, ['my file ünï.txt']);
  await call('commit', dir, 'u');
  write(dir, 'my file ünï.txt', 'xy');
  assert.match(await call('diff', dir, 'my file ünï.txt'), /\+xy/);
});

test('diff: working, staged and untracked', async () => {
  const dir = tmp();
  sh(dir, 'init', '-q', '-b', 'main');
  write(dir, 'f.txt', 'a\nb\nc\n');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-qm', 'init');
  write(dir, 'f.txt', 'a\nB\nc\n');
  assert.match(await call('diff', dir, 'f.txt'), /-b\n\+B/);
  sh(dir, 'add', 'f.txt');
  assert.equal(await call('diff', dir, 'f.txt'), '');
  assert.match(await call('diff', dir, 'f.txt', { staged: true }), /-b\n\+B/);
  write(dir, 'u.txt', 'hello\n');
  assert.match(await call('diff', dir, 'u.txt', { untracked: true }), /\+hello/);
});

test('branches, create, checkout, delete', async () => {
  const dir = tmp();
  sh(dir, 'init', '-q', '-b', 'main');
  write(dir, 'f', '1'); sh(dir, 'add', '-A'); sh(dir, 'commit', '-qm', 'one');
  await call('createBranch', dir, 'feature/x');
  let b = await call('branches', dir);
  assert.deepEqual(b.filter((x) => x.current).map((x) => x.name), ['feature/x']);
  await call('checkout', dir, 'main');
  assert.equal((await call('status', dir)).branch, 'main');
  await assert.rejects(call('checkout', dir, '--orphan'), /Invalid name/);
  await assert.rejects(call('checkout', dir, 'nope'), /did not match|pathspec|invalid reference/i);
  await call('deleteBranch', dir, 'feature/x');
  assert.deepEqual((await call('branches', dir)).map((x) => x.name), ['main']);
});

test('path traversal and bad refs are rejected', async () => {
  const dir = tmp();
  sh(dir, 'init', '-q', '-b', 'main');
  await assert.rejects(call('stage', dir, ['../outside']), /Invalid path/);
  await assert.rejects(call('stage', dir, ['/etc/passwd']), /Invalid path/);
  await assert.rejects(call('show', dir, 'HEAD; rm -rf /'), /Invalid commit/);
  await assert.rejects(git.call('rm-rf', dir, []), /Unknown git method/);
});

test('log, show, blame (committed, uncommitted and with unsaved contents)', async () => {
  const dir = tmp();
  sh(dir, 'init', '-q', '-b', 'main');
  write(dir, 'f.txt', 'l1\nl2\n'); sh(dir, 'add', '-A'); sh(dir, 'commit', '-qm', 'first');
  write(dir, 'f.txt', 'l1\nl2\nl3\n'); sh(dir, 'add', '-A'); sh(dir, 'commit', '-qm', 'second');
  const l = await call('log', dir, {});
  assert.deepEqual(l.map((c) => c.subject), ['second', 'first']);
  assert.equal(l[0].author, 'T');
  assert.match(await call('show', dir, l[0].sha), /\+l3/);
  assert.equal((await call('log', dir, { file: 'f.txt' })).length, 2);
  const b1 = await call('blame', dir, 'f.txt', 1);
  assert.equal(b1.summary, 'first'); assert.equal(b1.uncommitted, false);
  assert.equal((await call('blame', dir, 'f.txt', 3)).summary, 'second');
  const live = await call('blame', dir, 'f.txt', 2, 'l1\nNEW\nl2\nl3\n');
  assert.equal(live.uncommitted, true);
  assert.equal(await call('blame', dir, 'missing.txt', 1), null);
  const empty = tmp(); sh(empty, 'init', '-q'); assert.deepEqual(await call('log', empty, {}), []);
});

test('remote: ahead/behind, push (sets upstream), fetch, pull, stash', async () => {
  const root = tmp();
  const bare = path.join(root, 'remote.git');
  sh(root, 'init', '-q', '--bare', '-b', 'main', 'remote.git');
  const a = path.join(root, 'a');
  sh(root, 'clone', '-q', bare, 'a');
  sh(a, 'checkout', '-q', '-b', 'main');
  write(a, 'f.txt', '1\n'); sh(a, 'add', '-A'); sh(a, 'commit', '-qm', 'one');
  assert.match(await call('push', a), /Pushed/);        // no upstream yet: sets it
  let s = await call('status', a);
  assert.equal(s.upstream, 'origin/main'); assert.equal(s.ahead, 0);
  write(a, 'f.txt', '1\n2\n'); sh(a, 'commit', '-qam', 'two');
  s = await call('status', a); assert.equal(s.ahead, 1);
  await call('push', a);
  // second clone makes a commit; first fetches and sees "behind"
  const b = path.join(root, 'b');
  sh(root, 'clone', '-q', bare, 'b');
  write(b, 'g.txt', 'g\n'); sh(b, 'add', '-A'); sh(b, 'commit', '-qm', 'from b'); sh(b, 'push', '-q');
  await call('fetch', a);
  s = await call('status', a); assert.equal(s.behind, 1);
  await call('pull', a);
  s = await call('status', a); assert.equal(s.behind, 0); assert.ok(fs.existsSync(path.join(a, 'g.txt')));
  // stash round trip includes untracked files
  write(a, 'f.txt', 'dirty\n'); write(a, 'tmp.txt', 'u');
  await call('stash', a, 'wip');
  assert.equal((await call('status', a)).entries.filter((e) => e.kind !== 'ignored').length, 0);
  await call('stashPop', a);
  assert.equal(fs.readFileSync(path.join(a, 'f.txt'), 'utf8'), 'dirty\n');
  // no remote
  const lone = tmp(); sh(lone, 'init', '-q', '-b', 'main'); write(lone, 'x', '1'); sh(lone, 'add', '-A'); sh(lone, 'commit', '-qm', 'x');
  await assert.rejects(call('push', lone), /No remote/);
});

test('git missing from PATH is reported clearly', async () => {
  const saved = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    const dir = tmp();
    const i = await git.info(dir);
    assert.equal(i.available, false);
    assert.match(i.error, /Git was not found/);
  } finally { process.env.PATH = saved; }
});
