
sunlight.commands.register('run', async () => {
  const out = {};
  const attempt = async (name, fn) => { try { out[name] = 'ALLOWED:' + JSON.stringify(await fn()); } catch (e) { out[name] = 'rejected: ' + e.message; } };
  await attempt('dotdot', () => sunlight.workspace.readFile('../outside.txt'));
  await attempt('nested dotdot', () => sunlight.workspace.readFile('src/../../outside.txt'));
  await attempt('absolute', () => sunlight.workspace.readFile('/etc/passwd'));
  await attempt('windows drive', () => sunlight.workspace.readFile('C:\\Windows\\win.ini'));
  await attempt('write dotdot', () => sunlight.workspace.writeFile('../escaped.txt', 'x'));
  await attempt('write absolute', () => sunlight.workspace.writeFile('/tmp/escaped.txt', 'x'));
  await attempt('nul byte', () => sunlight.workspace.readFile('a\0b'));
  await attempt('missing file', () => sunlight.workspace.readFile('does-not-exist.txt'));
  await attempt('read ok', async () => (await sunlight.workspace.readFile('style.css')).length > 10);
  await attempt('write ok', () => sunlight.workspace.writeFile('ext-out/deep/new.txt', 'created by extension'));
  await attempt('read back', () => sunlight.workspace.readFile('ext-out/deep/new.txt'));
  await attempt('list', async () => (await sunlight.workspace.listFiles({ extension: '.css' })));
  return out;
});
