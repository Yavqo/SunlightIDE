// Word Count: a status bar item that follows the file you are editing.
// Shows how to use events (activeFileChanged, textChanged) and the status bar API.

function measure(text) {
  const words = (text.match(/\S+/g) || []).length;
  return { words, chars: text.length, lines: text.split('\n').length, minutes: Math.max(1, Math.round(words / 230)) };
}

async function update() {
  const file = await sunlight.editor.getActive();
  if (!file || file.kind !== 'text') {
    await sunlight.statusBar.removeItem('count');
    return;
  }
  const m = measure(await sunlight.editor.getText());
  await sunlight.statusBar.setItem('count', {
    text: `${m.words.toLocaleString()} word${m.words === 1 ? '' : 's'}`,
    tooltip: `${m.lines.toLocaleString()} lines, ${m.chars.toLocaleString()} characters. Click for details.`,
    command: 'stats', // the local id of a command declared in manifest.json
  });
}

// Typing fires textChanged often, so wait until the user pauses.
let timer;
const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 250); };

sunlight.events.on('activeFileChanged', schedule);
sunlight.events.on('textChanged', schedule);

sunlight.commands.register('stats', async () => {
  const file = await sunlight.editor.getActive();
  if (!file) { sunlight.window.showMessage('Open a file first.'); return; }
  const m = measure(await sunlight.editor.getText());
  sunlight.window.showMessage(`${file.name}: ${m.lines} lines, ${m.words} words, ${m.chars} characters, about ${m.minutes} min to read`);
});

schedule();
