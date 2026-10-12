// Page tabs: tabs that show a DOM view (the extension store pages, the docs) instead of an editor.

export class PageHost {
  constructor(el) { this.el = el; this.el.hidden = true; }

  show(doc) {
    for (const c of this.el.children) c.hidden = true;
    if (!doc._pageEl) {
      const wrap = document.createElement('div');
      wrap.className = 'page';
      wrap.tabIndex = -1;
      this.el.append(wrap);
      doc._pageEl = wrap;
      try { doc.pageApi = doc.page.build(wrap, doc) || {}; } catch (err) {
        wrap.textContent = `This page could not be shown: ${err.message}`;
      }
    }
    if (doc._pageEl.parentElement !== this.el) this.el.append(doc._pageEl);
    doc._pageEl.hidden = false;
    this.el.hidden = false;
    doc._pageEl.focus({ preventScroll: true });
  }

  hide() { this.el.hidden = true; }

  drop(doc) {
    if (doc._pageEl) { doc._pageEl.remove(); doc._pageEl = null; }
  }
}

// Copy text to the clipboard, falling back to a temporary textarea when the async API is unavailable.
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
