// Soft word-wrap layout for a monospace editor.
// Splits logical lines into visual rows and maps between (line, col) and visual rows.
// Pure logic (no DOM) so it can be unit tested under Node.

const BREAK_AFTER = new Set([' ', '\t', '-', '/', '\\', ',', ';', ')', ']', '}']);
export const NO_BREAKS = Object.freeze([]);
const hangOf = new WeakMap();

export function hangCols(breaks) { return hangOf.get(breaks) || 0; }

// Visual width of `text` starting at visual column 0 (tabs expand to the next tab stop).
export function visualWidth(text, tabSize, from = 0, to = text.length) {
  let v = 0;
  for (let i = from; i < to; i++) v += text.charCodeAt(i) === 9 ? tabSize - (v % tabSize) : 1;
  return v;
}

// Compute where each continuation row begins (string indexes). Continuation rows are indented to
// match the line's leading whitespace ("hanging indent"), capped at half the width.
export function computeBreaks(text, width, tabSize) {
  if (text.length <= width && text.indexOf('\t') < 0) return NO_BREAKS;
  const lead = /^[ \t]*/.exec(text)[0];
  const hang = Math.min(visualWidth(lead, tabSize), Math.floor(width / 2));
  const breaks = [];
  let rowStart = 0, v = 0, lastOpp = -1;
  let limit = width;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const w = ch === '\t' ? tabSize - (v % tabSize) : 1;
    if (v + w > limit && i > rowStart) {
      let at = lastOpp > rowStart ? lastOpp : i;
      if (at <= rowStart) at = i;
      breaks.push(at);
      rowStart = at;
      limit = width - hang;
      v = 0;
      lastOpp = -1;
      i = at;
      continue;
    }
    v += w;
    if (BREAK_AFTER.has(ch)) lastOpp = i + 1;
    i++;
  }
  if (!breaks.length) return NO_BREAKS;
  hangOf.set(breaks, hang);
  return breaks;
}

// Index of the visual row (within its line) that contains column `col`.
// A caret exactly on a soft break belongs to the row that starts there.
export function rowInLine(breaks, col) {
  let r = 0;
  while (r < breaks.length && col >= breaks[r]) r++;
  return r;
}

export function rowRange(breaks, r, textLength) {
  return [r === 0 ? 0 : breaks[r - 1], r < breaks.length ? breaks[r] : textLength];
}

// Prefix sums of rows per line: rowIdx[line] is the first visual row of `line`; rowIdx[n] is the total.
export function buildRowIndex(counts) {
  const idx = new Int32Array(counts.length + 1);
  for (let i = 0; i < counts.length; i++) idx[i + 1] = idx[i] + counts[i];
  return idx;
}

// Which line contains visual row `row`? Binary search over the prefix sums.
export function lineOfRow(rowIdx, row) {
  const n = rowIdx.length - 1;
  if (row <= 0) return 0;
  if (row >= rowIdx[n]) return n - 1;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rowIdx[mid] <= row) lo = mid; else hi = mid - 1;
  }
  return lo;
}
