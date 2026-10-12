// Recovery stores text only for unsaved documents; clean files reopen from disk.
export function snapshotSession({ docs, active, root, untitled, discardUnsaved = false }) {
  const documents = docs.filter((d) => !d.page && !d.readOnly && !(discardUnsaved && !d.path && d.buffer.dirty)).map((d) => {
    d.recoveryId ||= crypto.randomUUID();
    const dirty = !discardUnsaved && d.buffer.dirty;
    return { id: d.recoveryId, path: d.path, name: d.name, dirty,
      text: dirty || !d.path ? d.buffer.getText() : null,
      lang: d.lang, indent: d.indent, view: d.view, mtime: d.mtime };
  });
  return { schemaVersion: 1, root, untitled, active: documents.find((d) => d.id === active?.recoveryId)?.id || documents.at(-1)?.id || null, documents };
}
export function restoredView(view, buffer) {
  const pos = (p) => buffer.clampPos({ line: Number.isFinite(p?.line) ? Math.trunc(p.line) : 0, col: Number.isFinite(p?.col) ? Math.trunc(p.col) : 0 });
  const scroll = (n) => Number.isFinite(n) ? Math.max(0, n) : 0;
  const sels = Array.isArray(view?.sels) ? view.sels.slice(0, 1000).map((s) => ({ anchor: pos(s.anchor), head: pos(s.head) })) : null;
  return { anchor: pos(view?.anchor), head: pos(view?.head), sels,
    main: Math.max(0, Math.min(sels?.length - 1 || 0, Number.isInteger(view?.main) ? view.main : 0)),
    scrollTop: scroll(view?.scrollTop), scrollLeft: scroll(view?.scrollLeft) };
}
