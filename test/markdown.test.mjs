import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInline, highlightCode } from '../src/renderer/ui/markdown.js';

const html = (s, o) => renderMarkdown(s, o).html;

test('headings get unique ids and are collected for a table of contents', () => {
  const r = renderMarkdown('# Title\n\n## Setup\n\n### Setup\n\n## Café & Co');
  assert.deepEqual(r.headings.map((h) => [h.level, h.id]), [[1, 'title'], [2, 'setup'], [3, 'setup-1'], [2, 'café-co']]);
  assert.match(r.html, /<h2 id="setup">Setup<\/h2>/);
});

test('raw HTML is never interpreted', () => {
  const out = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\nhi <b>x</b>');
  assert.ok(!/<script|<img|<b>/.test(out), out);
  assert.match(out, /&lt;script&gt;/);
  assert.ok(!/onerror=alert/.test(out.replace(/&lt;[^&]*&gt;/g, '')), 'handler only appears as escaped text');
});

test('links: only safe schemes; command links need trust', () => {
  const evil = html('[a](javascript:alert(1)) [b](data:text/html,x) [c](vbscript:x) [d](file:///etc/passwd)');
  assert.ok(!/href=/.test(evil), evil);
  assert.match(html('[ok](https://example.com/a?b=1) [m](mailto:a@b.c) [h](#top)'), /href="https:\/\/example.com\/a\?b=1"[\s\S]*href="mailto:a@b.c"[\s\S]*href="#top"/);
  assert.ok(!/href="command:/.test(html('[run](command:ext-reload)')), 'untrusted: no command links');
  assert.match(html('[run](command:ext-reload)', { trusted: true }), /href="command:ext-reload"/);
  const injected = html('[x" onclick="y](https://a.b) [z](https://a.b" onmouseover="q)');
  assert.ok(!/<a [^>]*\bon\w+=/.test(injected), 'no event-handler attribute can be injected: ' + injected);
  assert.ok(!/<[^>]*\s(onclick|onmouseover)=/.test(injected));
  assert.equal((renderInline('![logo](https://x/y.png)').match(/<img/g) || []).length, 0, 'images are not loaded');
});

test('inline code, bold, emphasis and snake_case words', () => {
  assert.equal(renderInline('use `a < b` and **bold** and *em*'), 'use <code>a &lt; b</code> and <strong>bold</strong> and <em>em</em>');
  assert.equal(renderInline('snake_case_name stays'), 'snake_case_name stays');
  assert.equal(renderInline('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(renderInline('`` a`b ``'), '<code>a`b</code>');
});

test('code fences are highlighted, escaped and get a copy button', () => {
  const out = html('```js\nconst x = "<b>" + 1; // hi\n```');
  assert.match(out, /class="md-code"/);
  assert.match(out, /data-copy/);
  assert.match(out, /<span class="t-kw">const<\/span>/);
  assert.match(out, /<span class="t-str">&quot;&lt;b&gt;&quot;<\/span>/);
  assert.match(out, /<span class="t-com">\/\/ hi<\/span>/);
  assert.ok(!/<b>/.test(out));
  assert.equal(highlightCode('x', 'nosuchlang'), 'x');
  assert.match(html('~~~\nplain\n~~~'), /<code>plain<\/code>/);
});

test('lists: nested, ordered, tasks, continuation and code inside items', () => {
  const out = html('- one\n  - nested a\n  - nested b\n- two\n\n1. first\n2. second\n\n- [x] done\n- [ ] todo');
  assert.match(out, /<ul><li>one<ul><li>nested a<\/li><li>nested b<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
  assert.match(out, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(out, /checkbox" disabled checked> done/);
  assert.match(html('- item\n  continued line'), /<li>item continued line<\/li>/);
  assert.match(html('1. step\n   ```js\n   run()\n   ```\n2. next'), /<ol><li>step<div class="md-code">[\s\S]*run[\s\S]*<\/li><li>next<\/li><\/ol>/);
});

test('tables with alignment, blockquote callouts, rules and paragraphs', () => {
  const t = html('| A | B |\n|:--|--:|\n| 1 | `x\\|y` |\n| 2 | 3 |');
  assert.match(t, /<th style="text-align:right">B<\/th>/);
  assert.match(t, /<td>1<\/td><td style="text-align:right"><code>x\|y<\/code><\/td>/);
  assert.match(html('> **Note** careful\n> more'), /<blockquote class="md-quote md-note">/);
  assert.match(html('> **Warning**: hot'), /md-warning/);
  assert.match(html('a\n\n---\n\nb'), /<p>a<\/p>\n<hr>\n<p>b<\/p>/);
  assert.match(html('line one\nline two'), /<p>line one line two<\/p>/);
});

test('hostile input does not hang or throw', () => {
  const t0 = Date.now();
  const nasty = ['*'.repeat(5000), '['.repeat(3000) + ']'.repeat(3000), '`'.repeat(4000), '- '.repeat(3000), '| a |\n'.repeat(3000), '> '.repeat(500) + 'x', '```\n'.repeat(1000)];
  for (const n of nasty) renderMarkdown(n);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
});
