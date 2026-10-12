// Insert Tools: put generated text at every cursor.
// This extension is "lazy": manifest.json lists onCommand activation events, so it only
// starts the first time one of its commands is used.

const pad = (n) => String(n).padStart(2, '0');
const now = () => new Date();
const date = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const time = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function uuid() {
  if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID();
  const b = new Uint8Array(16);
  (self.crypto ? self.crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); }));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';

// insertText() replaces every selection, so with several cursors each one gets the text.
sunlight.commands.register('date', () => sunlight.editor.insertText(date(now())));
sunlight.commands.register('time', () => sunlight.editor.insertText(time(now())));
sunlight.commands.register('dateTime', () => { const d = now(); return sunlight.editor.insertText(`${date(d)} ${time(d)}`); });
sunlight.commands.register('uuid', async () => {
  // A different UUID for each cursor: build one string per selection.
  const selections = await sunlight.editor.getSelections();
  await sunlight.editor.replaceSelections(selections.map(() => uuid()));
});
sunlight.commands.register('lorem', () => sunlight.editor.insertText(LOREM));
