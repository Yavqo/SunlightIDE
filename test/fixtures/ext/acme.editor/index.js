
const seen = [];
sunlight.events.on('activeFileChanged', (f) => seen.push(['active', f && f.name]));
sunlight.events.on('fileSaved', (f) => seen.push(['saved', f && f.name]));
sunlight.events.on('textChanged', (f) => seen.push(['text', f && f.name]));
sunlight.commands.register('info', async () => ({ active: await sunlight.editor.getActive(), line0: await sunlight.editor.getLine(0), text: await sunlight.editor.getText() }));
sunlight.commands.register('selections', async () => sunlight.editor.getSelections());
sunlight.commands.register('events', () => seen);
sunlight.commands.register('bad', async () => {
  const out = {};
  const attempt = async (name, fn) => { try { out[name] = 'ALLOWED:' + JSON.stringify(await fn()); } catch (e) { out[name] = 'rejected: ' + e.message; } };
  await attempt('count mismatch', () => sunlight.editor.replaceSelections(['a', 'b', 'c', 'd', 'e']));
  await attempt('not strings', () => sunlight.editor.replaceSelections([1, 2]));
  await attempt('bad range', () => sunlight.editor.replaceRange({ start: { line: -1, col: 0 }, end: { line: 0, col: 0 } }, 'x'));
  await attempt('range shape', () => sunlight.editor.replaceRange('nope', 'x'));
  await attempt('bad selections', () => sunlight.editor.setSelections([{ anchor: 1, head: 2 }]));
  await attempt('line type', () => sunlight.editor.getLine('0'));
  await attempt('line past end', () => sunlight.editor.getLine(99999));
  await attempt('huge text', () => sunlight.editor.setText('x'.repeat(6 * 1024 * 1024)));
  return out;
});
sunlight.commands.register('pick', () => sunlight.window.showPick([{ label: 'Alpha', value: 1 }, { label: 'Beta', value: 2 }], { placeholder: 'Choose' }));
sunlight.commands.register('ask', () => sunlight.window.showInput({ prompt: 'Name?', value: 'Ada' }));
sunlight.commands.register('write', () => sunlight.editor.insertText('should not land'));
