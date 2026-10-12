// Selection algebra for multi-cursor editing. Pure functions over {anchor, head} pairs with {line, col} positions.

export const cmpPos = (a, b) => (a.line - b.line) || (a.col - b.col);
export const eqPos = (a, b) => a.line === b.line && a.col === b.col;
export const clonePos = (p) => ({ line: p.line, col: p.col });

export const startOf = (s) => (cmpPos(s.anchor, s.head) <= 0 ? s.anchor : s.head);
export const endOf = (s) => (cmpPos(s.anchor, s.head) <= 0 ? s.head : s.anchor);
export const isEmpty = (s) => eqPos(s.anchor, s.head);

// Sort selections by position and merge any that overlap or touch.
// Returns { sels, main } where `main` is the merged selection that absorbed the original main one.
export function normalize(sels, main) {
  const sorted = [...sels].sort((a, b) => cmpPos(startOf(a), startOf(b)) || cmpPos(endOf(a), endOf(b)));
  const out = [];
  let newMain = null;
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && cmpPos(startOf(s), endOf(last)) <= 0) {
      // Overlapping (or touching): extend `last` to cover both, keeping the direction of the earlier selection.
      const end = cmpPos(endOf(s), endOf(last)) > 0 ? endOf(s) : endOf(last);
      const start = startOf(last);
      const forward = cmpPos(last.anchor, last.head) <= 0;
      last.anchor = clonePos(forward ? start : end);
      last.head = clonePos(forward ? end : start);
      if (s === main) newMain = last;
      continue;
    }
    out.push(s);
    if (s === main) newMain = s;
  }
  return { sels: out, main: newMain || out[out.length - 1] };
}

// Where does position `p` end up after the text in [oldStart, oldEnd) is replaced by text ending at newEnd?
// Only valid for positions at or after oldEnd (positions before the edit never move).
export function shiftAfter(p, oldEnd, newEnd) {
  return {
    line: p.line + (newEnd.line - oldEnd.line),
    col: p.line === oldEnd.line ? newEnd.col + (p.col - oldEnd.col) : p.col,
  };
}

// Merge line ranges [from, to] that overlap or are adjacent.
export function mergeLineRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}
