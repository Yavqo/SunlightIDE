// Line diff (Myers' O(ND) algorithm) used for the editor's change markers.
// Pure logic, no DOM. diffLines(a, b) returns hunks describing how to turn `a` into `b`:
//   { os, oe, ns, ne }  =  a[os..oe) was replaced by b[ns..ne)

export function diffLines(a, b, { maxD = 1500 } = {}) {
  let ps = 0;
  const minLen = Math.min(a.length, b.length);
  while (ps < minLen && a[ps] === b[ps]) ps++;
  let as = a.length, bs = b.length;
  while (as > ps && bs > ps && a[as - 1] === b[bs - 1]) { as--; bs--; }
  const A = a.slice(ps, as), B = b.slice(ps, bs);
  if (!A.length && !B.length) return [];
  if (!A.length || !B.length) return [{ os: ps, oe: ps + A.length, ns: ps, ne: ps + B.length }];
  const edits = myers(A, B, maxD);
  if (!edits) return [{ os: ps, oe: ps + A.length, ns: ps, ne: ps + B.length }]; // too different: one big hunk
  const { del, ins } = edits;
  const hunks = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && !del[i] && !ins[j]) { i++; j++; continue; }
    const os = i, ns = j;
    while (i < A.length && del[i]) i++;
    while (j < B.length && ins[j]) j++;
    hunks.push({ os: ps + os, oe: ps + i, ns: ps + ns, ne: ps + j });
  }
  return hunks;
}

function myers(A, B, maxD) {
  const N = A.length, M = B.length;
  const MAX = Math.min(N + M, maxD);
  const off = MAX + 1;
  const V = new Int32Array(2 * MAX + 3);
  const trace = [];
  for (let d = 0; d <= MAX; d++) {
    trace.push(V.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && V[k - 1 + off] < V[k + 1 + off])) x = V[k + 1 + off];
      else x = V[k - 1 + off] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      V[k + off] = x;
      if (x >= N && y >= M) return backtrack(trace, N, M, d, off);
    }
  }
  return null;
}

function backtrack(trace, N, M, D, off) {
  const del = new Uint8Array(N), ins = new Uint8Array(M);
  let x = N, y = M;
  for (let d = D; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && v[k - 1 + off] < v[k + 1 + off]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[prevK + off];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; }
    if (down) ins[prevY] = 1; else del[prevX] = 1;
    x = prevX; y = prevY;
  }
  return { del, ins };
}

// Convert hunks into per-line markers for the new text:
//   lines: Map(lineIndex -> 'add' | 'mod'),  dels: Set(lineIndex)  (lines were removed just above that line;
//   an index equal to the line count means "after the last line").
export function markersFromHunks(hunks) {
  const lines = new Map();
  const dels = new Set();
  for (const h of hunks) {
    if (h.ne === h.ns) dels.add(h.ns);
    else {
      const kind = h.oe === h.os ? 'add' : 'mod';
      for (let l = h.ns; l < h.ne; l++) lines.set(l, kind);
    }
  }
  return { lines, dels };
}

// Apply hunks to `a` to rebuild `b` (used by tests to prove the diff is correct).
export function applyHunks(a, b, hunks) {
  const out = [];
  let i = 0;
  for (const h of hunks) {
    while (i < h.os) out.push(a[i++]);
    for (let j = h.ns; j < h.ne; j++) out.push(b[j]);
    i = h.oe;
  }
  while (i < a.length) out.push(a[i++]);
  return out;
}
