// JSON Tools: format, minify, sort and validate JSON.
// "activationEvents": ["onLanguage:json"] means this only starts once you open a JSON file.

async function source() {
  const selections = await sunlight.editor.getSelections();
  if (selections.some((s) => s.text)) return { text: selections.map((s) => s.text).join('\n'), whole: false };
  return { text: await sunlight.editor.getText(), whole: true };
}

// Where did parsing stop? Newer JavaScript engines do not always say, so walk the text ourselves
// with a tiny JSON reader and report the offset of the first character that doesn't fit.
function errorOffset(text) {
  let i = 0;
  const fail = () => { throw { at: i }; };
  const ws = () => { while (' \t\r\n'.includes(text[i] || 'x')) i++; };
  function value() {
    ws();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    for (const word of ['true', 'false', 'null']) if (text.startsWith(word, i)) { i += word.length; return; }
    fail();
  }
  function object() {
    i++; ws();
    if (text[i] === '}') { i++; return; }
    for (;;) {
      ws(); if (text[i] !== '"') fail();
      string(); ws(); if (text[i] !== ':') fail();
      i++; value(); ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return; }
      fail();
    }
  }
  function array() {
    i++; ws();
    if (text[i] === ']') { i++; return; }
    for (;;) {
      value(); ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return; }
      fail();
    }
  }
  function string() {
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') { i++; return; }
      if (c === '\\') {
        if (text[i + 1] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) { i += 2; fail(); }
          i += 6;
        } else {
          if (!'"\\/bfnrt'.includes(text[i + 1] || 'x')) { i += 1; fail(); }
          i += 2;
        }
        continue;
      }
      if (c < ' ') fail();
      i++;
    }
    fail();
  }
  function number() {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) fail();
    i += m[0].length;
  }
  try { value(); ws(); if (i < text.length) fail(); } catch (e) { if (e && typeof e.at === 'number') return e.at; throw e; }
  return -1;
}

function describe(error, text) {
  const at = errorOffset(text);
  if (at < 0) return error.message;
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  const col = at - before.lastIndexOf('\n');
  const found = at >= text.length ? 'the text ends too soon' : `unexpected "${text[at]}"`;
  return `Invalid JSON at line ${line}, column ${col}: ${found}`;
}

async function apply(fn) {
  const { text, whole } = await source();
  let value;
  try { value = JSON.parse(text); } catch (e) { sunlight.window.showMessage(describe(e, text), { type: 'error' }); return; }
  const out = fn(value);
  if (whole) await sunlight.editor.setText(out + '\n'); else await sunlight.editor.replaceSelections(out);
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

sunlight.commands.register('format', () => apply((v) => JSON.stringify(v, null, 2)));
sunlight.commands.register('minify', () => apply((v) => JSON.stringify(v)));
sunlight.commands.register('sortKeys', () => apply((v) => JSON.stringify(sortKeys(v), null, 2)));
sunlight.commands.register('validate', async () => {
  const { text } = await source();
  try { JSON.parse(text); sunlight.window.showMessage('Valid JSON.'); } catch (e) { sunlight.window.showMessage(describe(e, text), { type: 'error' }); }
});
