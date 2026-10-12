// Text Tools: transforms the selected text, or the whole file when nothing is selected.
// Every command is declared in manifest.json and implemented here with sunlight.commands.register().

async function transform(fn) {
  const selections = await sunlight.editor.getSelections();
  if (selections.some((s) => s.text)) {
    // One replacement per selection, applied as a single undo step. Empty cursors are left alone.
    await sunlight.editor.replaceSelections(selections.map((s) => (s.text ? fn(s.text) : s.text)));
  } else {
    await sunlight.editor.setText(fn(await sunlight.editor.getText()));
  }
}

const perLine = (fn) => (text) => fn(text.split('\n')).join('\n');

// "someValue-in_text" -> ["some", "Value", "in", "text"]
const words = (text) => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

const transforms = {
  sortAsc: perLine((l) => [...l].sort((a, b) => a.localeCompare(b))),
  sortDesc: perLine((l) => [...l].sort((a, b) => b.localeCompare(a))),
  reverseLines: perLine((l) => [...l].reverse()),
  uniqueLines: perLine((l) => [...new Set(l)]),
  trimLines: perLine((l) => l.map((x) => x.replace(/[ \t]+$/, ''))),
  camel: (t) => words(t).map((w, i) => (i ? cap(w) : w.toLowerCase())).join(''),
  pascal: (t) => words(t).map(cap).join(''),
  snake: (t) => words(t).map((w) => w.toLowerCase()).join('_'),
  kebab: (t) => words(t).map((w) => w.toLowerCase()).join('-'),
  constant: (t) => words(t).map((w) => w.toUpperCase()).join('_'),
  title: (t) => words(t).map(cap).join(' '),
  upper: (t) => t.toUpperCase(),
  lower: (t) => t.toLowerCase(),
};

for (const [id, fn] of Object.entries(transforms)) {
  sunlight.commands.register(id, () => transform(fn));
}
