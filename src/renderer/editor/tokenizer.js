// Line tokenizer with carried state (for block comments and multi-line strings).
// tokenizeLine(lang, text, state) -> { tokens: [{ s, e, t }], state }
// Token types: kw, str, num, com, fn, typ, op, tag, attr, prop, var, pun, hd, em, link, plain

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const JS_KW = words(`break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof new return super switch this throw try typeof var void while with yield let static async await of from as get set null undefined true false NaN Infinity enum implements interface package private protected public type namespace declare abstract readonly keyof satisfies`);
const PY_KW = words(`False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self match case`);
const C_KW = words(`auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename public private protected virtual new delete this nullptr true false bool using try catch throw operator explicit friend override final constexpr include define ifdef ifndef endif pragma`);
const GO_KW = words(`break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota`);
const RUST_KW = words(`as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while`);
const JAVA_KW = words(`abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record`);
const SH_KW = words(`if then else elif fi for while do done case esac in function select until return exit export local readonly unset cd echo source alias`);
const SQL_KW = words(`select from where insert into values update set delete create table drop alter add column index primary key foreign references join left right inner outer on group by order having limit offset as and or not null is in like between distinct union all case when then else end count sum avg min max`);
const RUBY_KW = words(`alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require include attr_accessor`);
const PHP_KW = words(`abstract and array as break case catch class clone const continue declare default do echo else elseif empty extends final finally fn for foreach function global if implements include instanceof interface isset namespace new null or print private protected public require return static switch throw trait true false try use var while yield`);
const SWIFT_KW = words(`associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self Self throw throws true try async await actor`);

const LANGS = {
  javascript: { kw: JS_KW, line: '//', block: ['/*', '*/'], quotes: `'"`, tpl: true, call: true, caps: true, regexLit: true },
  typescript: { kw: JS_KW, line: '//', block: ['/*', '*/'], quotes: `'"`, tpl: true, call: true, caps: true, regexLit: true },
  c: { kw: C_KW, line: '//', block: ['/*', '*/'], quotes: `'"`, call: true, caps: true, prep: true },
  java: { kw: JAVA_KW, line: '//', block: ['/*', '*/'], quotes: `'"`, call: true, caps: true },
  go: { kw: GO_KW, line: '//', block: ['/*', '*/'], quotes: `'"\``, call: true, caps: true },
  rust: { kw: RUST_KW, line: '//', block: ['/*', '*/'], quotes: `"`, call: true, caps: true },
  swift: { kw: SWIFT_KW, line: '//', block: ['/*', '*/'], quotes: `"`, call: true, caps: true },
  php: { kw: PHP_KW, line: '//', block: ['/*', '*/'], quotes: `'"`, call: true, caps: true, dollar: true },
  python: { kw: PY_KW, line: '#', quotes: `'"`, triple: true, call: true, caps: true },
  ruby: { kw: RUBY_KW, line: '#', quotes: `'"`, call: true, caps: true },
  shell: { kw: SH_KW, line: '#', quotes: `'"`, dollar: true },
  sql: { kw: SQL_KW, line: '--', block: ['/*', '*/'], quotes: `'"`, ci: true },
  json: { kw: words('true false null'), quotes: `"`, json: true },
  css: { css: true },
  html: { html: true },
  markdown: { md: true },
  yaml: { kw: words('true false null yes no'), line: '#', quotes: `'"`, yaml: true },
  toml: { kw: words('true false'), line: '#', quotes: `'"`, yaml: true },
  diff: { diff: true },
  plaintext: {},
};

const EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  c: 'c', h: 'c', cc: 'c', cpp: 'c', cxx: 'c', hpp: 'c', cs: 'c', m: 'c', mm: 'c',
  java: 'java', kt: 'java', scala: 'java', dart: 'java',
  go: 'go', rs: 'rust', swift: 'swift', php: 'php',
  py: 'python', pyw: 'python', rb: 'ruby',
  sh: 'shell', bash: 'shell', zsh: 'shell', env: 'shell',
  sql: 'sql', json: 'json', jsonc: 'json', webmanifest: 'json',
  css: 'css', scss: 'css', less: 'css',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html', svelte: 'html',
  md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'toml',
  txt: 'plaintext', diff: 'diff', patch: 'diff',
};

export function languageForFile(name = '') {
  const base = name.split('/').pop().toLowerCase();
  if (base === 'dockerfile' || base === 'makefile') return 'shell';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return EXT[ext] || 'plaintext';
}

export const LANGUAGE_NAMES = {
  javascript: 'JavaScript', typescript: 'TypeScript', c: 'C / C++', java: 'Java', go: 'Go', rust: 'Rust',
  swift: 'Swift', php: 'PHP', python: 'Python', ruby: 'Ruby', shell: 'Shell', sql: 'SQL', json: 'JSON',
  css: 'CSS', html: 'HTML', markdown: 'Markdown', yaml: 'YAML', toml: 'TOML', diff: 'Diff', plaintext: 'Plain Text',
};

export function keywordsFor(lang) {
  const l = LANGS[lang];
  return l && l.kw ? [...l.kw] : [];
}

// Block-comment wrappers for languages without a line comment.
export function commentBlock(lang) {
  if (lang === 'css') return ['/*', '*/'];
  if (lang === 'html' || lang === 'markdown') return ['<!--', '-->'];
  return null;
}

export function commentPrefix(lang) {
  const l = LANGS[lang];
  return (l && l.line) || null;
}

const isIdStart = (c) => /[A-Za-z_$ -￿]/.test(c);
const isIdPart = (c) => /[\w$ -￿]/.test(c);
const isDigit = (c) => c >= '0' && c <= '9';

// State values: 0 default, 'bc' block comment, 'tpl' JS template, 'tq"' / "tq'" python triple, 'md-fence', 'html-comment'
export function tokenizeLine(lang, text, state = 0) {
  const def = LANGS[lang] || LANGS.plaintext;
  if (def.md) return tokenizeMarkdown(text, state);
  if (def.diff) return tokenizeDiff(text);
  if (def.css) return tokenizeCss(text, state);
  if (def.html) return tokenizeHtml(text, state);

  const tokens = [];
  const n = text.length;
  let i = 0;
  const push = (s, e, t) => { if (e > s) tokens.push({ s, e, t }); };

  // Continue multi-line constructs.
  if (state === 'bc' && def.block) {
    const end = text.indexOf(def.block[1]);
    if (end < 0) { push(0, n, 'com'); return { tokens, state: 'bc' }; }
    push(0, end + def.block[1].length, 'com');
    i = end + def.block[1].length;
    state = 0;
  } else if (state === 'tpl') {
    const r = scanTemplate(text, 0);
    pushTemplate(tokens, 0, r);
    if (!r.closed) return { tokens, state: 'tpl' };
    i = r.end;
    state = 0;
  } else if (typeof state === 'string' && state.startsWith('tq')) {
    const q = state.slice(2).repeat(3);
    const end = text.indexOf(q);
    if (end < 0) { push(0, n, 'str'); return { tokens, state }; }
    push(0, end + 3, 'str');
    i = end + 3;
    state = 0;
  }

  let prevSig = ''; // last significant char for regex-literal detection
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t') { i++; continue; }

    // Line comment
    if (def.line && text.startsWith(def.line, i) && !(def.yaml && i > 0 && !/\s/.test(text[i - 1]))) {
      push(i, n, 'com');
      return { tokens, state: 0 };
    }
    // Block comment
    if (def.block && text.startsWith(def.block[0], i)) {
      const end = text.indexOf(def.block[1], i + def.block[0].length);
      if (end < 0) { push(i, n, 'com'); return { tokens, state: 'bc' }; }
      push(i, end + def.block[1].length, 'com');
      i = end + def.block[1].length;
      continue;
    }
    // Preprocessor
    if (def.prep && c === '#' && /^\s*$/.test(text.slice(0, i))) {
      push(i, n, 'kw');
      return { tokens, state: 0 };
    }
    // Python triple-quoted strings
    if (def.triple && (c === '"' || c === "'") && text.startsWith(c.repeat(3), i)) {
      const q = c.repeat(3);
      const end = text.indexOf(q, i + 3);
      if (end < 0) { push(i, n, 'str'); return { tokens, state: 'tq' + c }; }
      push(i, end + 3, 'str');
      i = end + 3;
      continue;
    }
    // Template literal
    if (def.tpl && c === '`') {
      const r = scanTemplate(text, i + 1);
      pushTemplate(tokens, i, r);
      if (!r.closed) return { tokens, state: 'tpl' };
      i = r.end;
      prevSig = '`';
      continue;
    }
    // Strings
    if (def.quotes && def.quotes.includes(c)) {
      let j = i + 1;
      while (j < n && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      j = Math.min(j + 1, n);
      let t = 'str';
      if (def.json || def.yaml) {
        // key if followed by ':'
        let k = j;
        while (k < n && text[k] === ' ') k++;
        if (text[k] === ':') t = 'prop';
      }
      push(i, j, t);
      i = j;
      prevSig = '"';
      continue;
    }
    // Regex literal (JS)
    if (def.regexLit && c === '/' && (prevSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prevSig))) {
      let j = i + 1, inClass = false;
      while (j < n) {
        const d = text[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j++;
      }
      if (j < n) {
        j++;
        while (j < n && /[a-z]/i.test(text[j])) j++;
        push(i, j, 'str');
        i = j;
        prevSig = '"';
        continue;
      }
    }
    // Shell / PHP variables
    if (def.dollar && c === '$' && i + 1 < n && (isIdStart(text[i + 1]) || text[i + 1] === '{')) {
      let j = i + 1;
      if (text[j] === '{') { while (j < n && text[j] !== '}') j++; j++; }
      else while (j < n && isIdPart(text[j])) j++;
      push(i, j, 'var');
      i = j;
      prevSig = 'a';
      continue;
    }
    // Numbers
    if (isDigit(c) || (c === '.' && isDigit(text[i + 1] || ''))) {
      let j = i;
      if (c === '0' && /[xXbBoO]/.test(text[i + 1] || '')) { j += 2; while (j < n && /[0-9a-fA-F_]/.test(text[j])) j++; }
      else {
        while (j < n && /[0-9_]/.test(text[j])) j++;
        if (text[j] === '.' && isDigit(text[j + 1] || '')) { j++; while (j < n && /[0-9_]/.test(text[j])) j++; }
        if (/[eE]/.test(text[j] || '') && /[-+\d]/.test(text[j + 1] || '')) { j += 2; while (j < n && isDigit(text[j])) j++; }
      }
      if (text[j] === 'n' || text[j] === 'f' || text[j] === 'L' || text[j] === 'u') j++;
      push(i, j, 'num');
      i = j;
      prevSig = '0';
      continue;
    }
    // Identifiers
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdPart(text[j])) j++;
      const word = text.slice(i, j);
      const key = def.ci ? word.toLowerCase() : word;
      let t = null;
      if (def.kw && def.kw.has(key)) t = 'kw';
      else {
        let k = j;
        while (k < n && text[k] === ' ') k++;
        if (def.yaml && text[k] === ':') t = 'prop';
        else if (def.call && text[k] === '(') t = 'fn';
        else if (def.caps && /^[A-Z][A-Za-z0-9_]*$/.test(word) && word.length > 1 && /[a-z]/.test(word)) t = 'typ';
        else if (text[i - 1] === '.' && prevSig === '.') t = null;
      }
      if (t) push(i, j, t);
      i = j;
      prevSig = 'a';
      continue;
    }
    // Operators / punctuation
    if (/[+\-*/%=<>!&|^~?:]/.test(c)) push(i, i + 1, 'op');
    prevSig = c;
    i++;
  }
  return { tokens, state: 0 };
}

// Emit string tokens around ${...} holes so tokens never overlap.
function pushTemplate(tokens, from, r) {
  let pos = from;
  for (const h of r.inner) {
    if (h.s > pos) tokens.push({ s: pos, e: h.s, t: 'str' });
    pos = h.e;
  }
  if (r.end > pos) tokens.push({ s: pos, e: r.end, t: 'str' });
}

// Scan a JS template literal body starting at `from`; returns end index (after closing backtick or line end).
function scanTemplate(text, from) {
  const n = text.length;
  let j = from;
  const inner = [];
  while (j < n) {
    const c = text[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') return { end: j + 1, closed: true, inner };
    if (c === '$' && text[j + 1] === '{') {
      // highlight ${...} as plain (single line, nesting depth counted)
      let depth = 1, k = j + 2;
      while (k < n && depth > 0) { if (text[k] === '{') depth++; else if (text[k] === '}') depth--; k++; }
      inner.push({ s: j, e: k, t: 'plain' });
      j = k;
      continue;
    }
    j++;
  }
  return { end: n, closed: false, inner };
}

// Unified diff: colour whole lines by their first character.
function tokenizeDiff(text) {
  const n = text.length;
  if (!n) return { tokens: [], state: 0 };
  let t = null;
  if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|commit |Author:|Date:)/.test(text)) t = 'meta';
  else if (text.startsWith('@@')) t = 'hunk';
  else if (text[0] === '+') t = 'add';
  else if (text[0] === '-') t = 'del';
  return { tokens: t ? [{ s: 0, e: n, t }] : [], state: 0 };
}

function tokenizeCss(text, state) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  const push = (s, e, t) => { if (e > s) tokens.push({ s, e, t }); };
  if (state === 'bc') {
    const end = text.indexOf('*/');
    if (end < 0) { push(0, n, 'com'); return { tokens, state: 'bc' }; }
    push(0, end + 2, 'com');
    i = end + 2;
  }
  // Heuristic: inside a declaration block if a ':' appears before ';' and the line has no '{' before it.
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) { push(i, n, 'com'); return { tokens, state: 'bc' }; }
      push(i, end + 2, 'com');
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      push(i, Math.min(j + 1, n), 'str');
      i = Math.min(j + 1, n);
      continue;
    }
    if (c === '#' && /[0-9a-fA-F]/.test(text[i + 1] || '') && /^#[0-9a-fA-F]{3,8}\b/.test(text.slice(i))) {
      const m = /^#[0-9a-fA-F]{3,8}\b/.exec(text.slice(i));
      push(i, i + m[0].length, 'num');
      i += m[0].length;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(text[i + 1] || '')) || (c === '-' && isDigit(text[i + 1] || ''))) {
      let j = i + 1;
      while (j < n && /[\d.]/.test(text[j])) j++;
      while (j < n && /[a-z%]/i.test(text[j])) j++;
      push(i, j, 'num');
      i = j;
      continue;
    }
    if (c === '@') {
      let j = i + 1;
      while (j < n && /[\w-]/.test(text[j])) j++;
      push(i, j, 'kw');
      i = j;
      continue;
    }
    if (c === '-' && text[i + 1] === '-') {
      let j = i + 2;
      while (j < n && /[\w-]/.test(text[j])) j++;
      push(i, j, 'var');
      i = j;
      continue;
    }
    if (isIdStart(c) || c === '-') {
      let j = i + 1;
      while (j < n && /[\w-]/.test(text[j])) j++;
      let k = j;
      while (k < n && text[k] === ' ') k++;
      if (text[k] === ':' && text[k + 1] !== ':' && !/^\s*[{,]/.test(text.slice(k + 1)) ) push(i, j, 'prop');
      else if (text[k] === '(') push(i, j, 'fn');
      i = j;
      continue;
    }
    if (c === '.' || c === '#') {
      let j = i + 1;
      while (j < n && /[\w-]/.test(text[j])) j++;
      push(i, j, 'typ');
      i = j;
      continue;
    }
    i++;
  }
  return { tokens, state: 0 };
}

function tokenizeHtml(text, state) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  const push = (s, e, t) => { if (e > s) tokens.push({ s, e, t }); };
  if (state === 'hc') {
    const end = text.indexOf('-->');
    if (end < 0) { push(0, n, 'com'); return { tokens, state: 'hc' }; }
    push(0, end + 3, 'com');
    i = end + 3;
  }
  while (i < n) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) { push(i, n, 'com'); return { tokens, state: 'hc' }; }
      push(i, end + 3, 'com');
      i = end + 3;
      continue;
    }
    if (text[i] === '<') {
      const m = /^<[/!?]?[A-Za-z][\w:.-]*/.exec(text.slice(i)) || /^<[/!?]/.exec(text.slice(i));
      if (m) {
        push(i, i + m[0].length, 'tag');
        i += m[0].length;
        // attributes until '>'
        while (i < n && text[i] !== '>') {
          const c = text[i];
          if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < n && text[j] !== c) j++;
            push(i, Math.min(j + 1, n), 'str');
            i = Math.min(j + 1, n);
          } else if (/[\w:@.-]/.test(c)) {
            let j = i + 1;
            while (j < n && /[\w:@.-]/.test(text[j])) j++;
            push(i, j, 'attr');
            i = j;
          } else i++;
        }
        if (i < n) { push(i, i + 1, 'tag'); i++; }
        continue;
      }
    }
    if (text[i] === '&') {
      const m = /^&#?\w+;/.exec(text.slice(i));
      if (m) { push(i, i + m[0].length, 'num'); i += m[0].length; continue; }
    }
    i++;
  }
  return { tokens, state: 0 };
}

function tokenizeMarkdown(text, state) {
  const tokens = [];
  const n = text.length;
  const push = (s, e, t) => { if (e > s) tokens.push({ s, e, t }); };
  if (/^\s*(```|~~~)/.test(text)) {
    push(0, n, 'com');
    return { tokens, state: state === 'fence' ? 0 : 'fence' };
  }
  if (state === 'fence') { push(0, n, 'str'); return { tokens, state }; }
  if (/^#{1,6}\s/.test(text)) { push(0, n, 'hd'); return { tokens, state: 0 }; }
  if (/^\s*>/.test(text)) { push(0, n, 'com'); return { tokens, state: 0 }; }
  if (/^\s*([-*+]|\d+\.)\s/.test(text)) {
    const m = /^\s*([-*+]|\d+\.)/.exec(text);
    push(m[0].length - m[1].length, m[0].length, 'kw');
  }
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]*\]\([^)]*\))/g;
  let m;
  while ((m = re.exec(text))) {
    push(m.index, m.index + m[0].length, m[1] ? 'str' : m[2] ? 'em' : 'link');
  }
  tokens.sort((a, b) => a.s - b.s);
  return { tokens, state: 0 };
}

// Bracket pairs used for matching and auto-closing.
export const PAIRS = { '(': ')', '[': ']', '{': '}' };
export const CLOSERS = { ')': '(', ']': '[', '}': '{' };
