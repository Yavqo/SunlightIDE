// Language snippets for the completion popup. `$0` marks where the caret lands, `\t` is one indent level.
// Other tab stops ($1, ${1:name}) are flattened to their placeholder text.

const JS = {
  log: ['console.log($0)', 'Log to the console'],
  fn: ['function ${1:name}($2) {\n\t$0\n}', 'Function declaration'],
  afn: ['async function ${1:name}($2) {\n\t$0\n}', 'Async function'],
  arrow: ['const ${1:name} = ($2) => {\n\t$0\n}', 'Arrow function'],
  if: ['if (${1:condition}) {\n\t$0\n}', 'If statement'],
  ifelse: ['if (${1:condition}) {\n\t$0\n} else {\n\t\n}', 'If / else'],
  for: ['for (let ${1:i} = 0; $1 < ${2:length}; $1++) {\n\t$0\n}', 'For loop'],
  forof: ['for (const ${1:item} of ${2:items}) {\n\t$0\n}', 'For…of loop'],
  foreach: ['${1:items}.forEach((${2:item}) => {\n\t$0\n})', 'forEach'],
  try: ['try {\n\t$0\n} catch (${1:err}) {\n\t\n}', 'Try / catch'],
  class: ['class ${1:Name} {\n\tconstructor($2) {\n\t\t$0\n\t}\n}', 'Class'],
  switch: ['switch (${1:value}) {\n\tcase ${2:x}:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}', 'Switch'],
  imp: ["import { $0 } from '${1:module}'", 'Import'],
  timeout: ['setTimeout(() => {\n\t$0\n}, ${1:1000})', 'setTimeout'],
  prom: ['new Promise((resolve, reject) => {\n\t$0\n})', 'Promise'],
};

const PY = {
  def: ['def ${1:name}($2):\n\t$0', 'Function'],
  class: ['class ${1:Name}:\n\tdef __init__(self$2):\n\t\t$0', 'Class'],
  if: ['if ${1:condition}:\n\t$0', 'If statement'],
  ifelse: ['if ${1:condition}:\n\t$0\nelse:\n\t', 'If / else'],
  for: ['for ${1:item} in ${2:items}:\n\t$0', 'For loop'],
  while: ['while ${1:condition}:\n\t$0', 'While loop'],
  try: ['try:\n\t$0\nexcept ${1:Exception} as e:\n\t', 'Try / except'],
  with: ["with open(${1:path}) as ${2:f}:\n\t$0", 'With open'],
  main: ["if __name__ == '__main__':\n\t$0", 'Main guard'],
  print: ['print($0)', 'Print'],
};

const GO = {
  func: ['func ${1:name}($2) {\n\t$0\n}', 'Function'],
  main: ['func main() {\n\t$0\n}', 'Main'],
  iferr: ['if err != nil {\n\treturn $0err\n}', 'Error check'],
  for: ['for ${1:i} := 0; $1 < ${2:n}; $1++ {\n\t$0\n}', 'For loop'],
  forr: ['for ${1:_}, ${2:v} := range ${3:items} {\n\t$0\n}', 'Range loop'],
  struct: ['type ${1:Name} struct {\n\t$0\n}', 'Struct'],
};

const C = {
  main: ['int main(int argc, char **argv) {\n\t$0\n\treturn 0;\n}', 'Main'],
  for: ['for (int ${1:i} = 0; $1 < ${2:n}; $1++) {\n\t$0\n}', 'For loop'],
  if: ['if (${1:condition}) {\n\t$0\n}', 'If statement'],
  while: ['while (${1:condition}) {\n\t$0\n}', 'While loop'],
  struct: ['struct ${1:Name} {\n\t$0\n};', 'Struct'],
};

const SH = {
  if: ['if [ ${1:condition} ]; then\n\t$0\nfi', 'If'],
  for: ['for ${1:i} in ${2:list}; do\n\t$0\ndone', 'For loop'],
  while: ['while ${1:condition}; do\n\t$0\ndone', 'While loop'],
  func: ['${1:name}() {\n\t$0\n}', 'Function'],
};

const HTML = {
  html5: ['<!doctype html>\n<html lang="en">\n<head>\n\t<meta charset="utf-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1">\n\t<title>${1:Document}</title>\n</head>\n<body>\n\t$0\n</body>\n</html>', 'HTML5 page'],
  link: ['<link rel="stylesheet" href="$0">', 'Stylesheet link'],
  script: ['<script src="$0"></script>', 'Script tag'],
  div: ['<div class="$1">$0</div>', 'Div'],
  a: ['<a href="$1">$0</a>', 'Anchor'],
  img: ['<img src="$1" alt="$0">', 'Image'],
};

const CSS = {
  media: ['@media (max-width: ${1:767px}) {\n\t$0\n}', 'Media query'],
  flex: ['display: flex;\nalign-items: center;\njustify-content: $0;', 'Flex row'],
  grid: ['display: grid;\ngrid-template-columns: $0;', 'Grid'],
  var: ['var(--$0)', 'CSS variable'],
};

export const SNIPPETS = {
  javascript: JS, typescript: JS, python: PY, go: GO, c: C, java: C, rust: {
    fn: ['fn ${1:name}($2) {\n\t$0\n}', 'Function'],
    main: ['fn main() {\n\t$0\n}', 'Main'],
    for: ['for ${1:item} in ${2:items} {\n\t$0\n}', 'For loop'],
    match: ['match ${1:value} {\n\t$0\n}', 'Match'],
    struct: ['struct ${1:Name} {\n\t$0\n}', 'Struct'],
  },
  shell: SH, html: HTML, css: CSS,
};

// Snippets contributed by extensions: extension id -> [{ language, snippets: { trigger: { body, description } } }].
const EXT_SNIPPETS = new Map();

export function setExtensionSnippets(extId, groups) {
  if (groups && groups.length) EXT_SNIPPETS.set(extId, groups); else EXT_SNIPPETS.delete(extId);
}

export function clearExtensionSnippets() { EXT_SNIPPETS.clear(); }

// Built-in snippets for a language merged with those from extensions: trigger -> [body, description].
// A built-in snippet wins when an extension reuses its trigger, so extensions can't silently change core behaviour.
export function snippetsFor(lang) {
  const out = {};
  for (const groups of EXT_SNIPPETS.values()) {
    for (const g of groups) {
      if (g.language !== lang) continue;
      for (const [trigger, s] of Object.entries(g.snippets)) out[trigger] = [s.body, s.description || 'Snippet'];
    }
  }
  return { ...out, ...(SNIPPETS[lang] || {}) };
}

// Expand a snippet body for insertion at a line with the given indent.
// Returns { text, caret: { line, col } } where caret is relative to the insertion start (line 0 = same line).
export function expandSnippet(body, indentUnit, lineIndent) {
  let text = body
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\t/g, indentUnit)
    .replace(/\n/g, '\n' + lineIndent);
  let marker = text.indexOf('$0');
  if (marker >= 0) text = text.slice(0, marker) + text.slice(marker + 2);
  else marker = text.length;
  text = text.replace(/\$\d+/g, '');
  const before = text.slice(0, marker).replace(/\$\d+/g, '');
  const lines = before.split('\n');
  return { text, caret: { line: lines.length - 1, col: lines[lines.length - 1].length } };
}
