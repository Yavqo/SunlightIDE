
sunlight.commands.register('run', async () => {
  const out = {};
  const attempt = async (name, fn) => { try { out[name] = 'ALLOWED:' + JSON.stringify(await fn()); } catch (e) { out[name] = 'rejected: ' + e.message; } };
  await sunlight.storage.set('count', 41);
  out.count = await sunlight.storage.get('count', 0);
  out.fallback = await sunlight.storage.get('nope', 'fallback');
  await sunlight.storage.set('nested', { a: [1, 2, { b: 3 }] });
  out.nested = await sunlight.storage.get('nested');
  out.keys = (await sunlight.storage.keys()).sort();
  await sunlight.storage.delete('count');
  out.deleted = await sunlight.storage.get('count', 'gone');
  await attempt('proto key', () => sunlight.storage.set('__proto__', { x: 1 }));
  await attempt('huge', () => sunlight.storage.set('big', 'x'.repeat(2 * 1024 * 1024)));
  await attempt('function value', () => sunlight.storage.set('fn', () => 1));
  return out;
});
