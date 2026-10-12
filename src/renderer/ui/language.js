// Language intelligence controller. All semantic analysis runs in the main-process worker.
export class LanguageIntelligence {
  constructor({ editor, state, api, palette, openFile, toast, home }) {
    Object.assign(this, { editor, state, api, palette, openFile, toast });
    this.virtualRoot = `${home}/.sunlight-language`;
    this.diagnostics = [];
    this.overlay = document.createElement('div');
    this.overlay.className = 'language-diagnostics';
    editor.sizer.append(this.overlay);
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'language-hover'; this.tooltip.hidden = true;
    editor.root.append(this.tooltip);
    editor.languageProvider = (doc, pos) => this.supported(doc) ? this.request('completion', doc, pos) : Promise.resolve([]);
    editor.on('change', () => this.schedule());
    editor.on('render', () => this.draw());
    editor.on('scroll', () => this.hideHover());
    editor.scroller.addEventListener('mousemove', (e) => {
      this.hideHover();
      if (e.buttons || !this.supported(state.active)) return;
      const pos = editor.posFromPoint(e.clientX, e.clientY);
      this.hoverTimer = setTimeout(() => this.hover(pos), 450);
    });
    editor.scroller.addEventListener('mouseleave', () => this.hideHover());
    editor.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hideHover(); });
  }
  supported(doc) { return doc && !doc.page && !doc.readOnly && ['javascript', 'typescript'].includes(doc.lang); }
  request(method, doc = this.state.active, pos = this.editor.head) {
    const root = this.state.root || this.virtualRoot;
    const fileFor = (d) => d.path || `${root}/.sunlight-${d.name}.${d.lang === 'typescript' ? 'ts' : 'js'}`;
    let offset = pos.col;
    for (let line = 0; line < pos.line; line++) offset += doc.buffer.getLine(line).length + 1;
    return this.api.language(method, { root, file: fileFor(doc), offset,
      documents: this.state.docs.filter((d) => this.supported(d)).map((d) => ({ file: fileFor(d), text: d.buffer.lines.join('\n'), version: d.buffer.version })) });
  }
  activate() { this.hideHover(); this.diagnostics = []; this.overlay.replaceChildren(); this.schedule(); }
  schedule() {
    clearTimeout(this.timer);
    const doc = this.state.active;
    this.diagnostics = []; this.overlay.replaceChildren();
    if (!this.supported(doc)) return;
    const version = doc.buffer.version;
    this.timer = setTimeout(async () => {
      try {
        const diagnostics = await this.request('diagnostics', doc);
        if (doc !== this.state.active || doc.buffer.version !== version) return;
        this.diagnostics = diagnostics; this.draw();
      } catch (error) { this.error = error.message; }
    }, 600);
  }
  draw() {
    const editor = this.editor, frag = document.createDocumentFragment();
    if (!editor.doc || !this.supported(editor.doc)) { this.overlay.replaceChildren(); return; }
    const first = editor.posFromPoint(editor.scroller.getBoundingClientRect().left, editor.scroller.getBoundingClientRect().top).line;
    const last = Math.min(editor.buffer.lineCount - 1, first + Math.ceil(editor.scroller.clientHeight / editor.lh) + 2);
    for (const d of this.diagnostics) {
      for (let line = Math.max(first, d.start.line); line <= Math.min(last, d.end.line); line++) {
        const start = line === d.start.line ? d.start.col : 0;
        const end = line === d.end.line ? d.end.col : editor.buffer.getLine(line).length;
        for (const rect of editor.rowRects(line, start, Math.max(start + 1, end), false)) {
          const mark = document.createElement('div'); mark.className = `language-squiggle ${d.severity}`;
          Object.assign(mark.style, { left: `${rect.x1}px`, top: `${rect.y + editor.lh - 3}px`, width: `${rect.w}px` });
          frag.append(mark);
        }
      }
    }
    this.overlay.replaceChildren(frag);
  }
  hideHover() { clearTimeout(this.hoverTimer); this.hoverGeneration = (this.hoverGeneration || 0) + 1; this.tooltip.hidden = true; }
  async hover(pos = this.editor.head) {
    const doc = this.state.active;
    if (!this.supported(doc)) return;
    const generation = this.hoverGeneration, version = doc.buffer.version;
    try {
      const info = await this.request('hover', doc, pos);
      if (this.state.active !== doc || doc.buffer.version !== version || generation !== this.hoverGeneration) return;
      const messages = this.diagnostics.filter((d) => pos.line >= d.start.line && pos.line <= d.end.line && (pos.line !== d.start.line || pos.col >= d.start.col) && (pos.line !== d.end.line || pos.col <= d.end.col)).map((d) => d.message);
      const text = [info?.signature, info?.documentation, ...messages].filter(Boolean).join('\n\n');
      if (!text) return;
      this.tooltip.textContent = text;
      const point = this.editor.xy(pos.line, pos.col), root = this.editor.root.getBoundingClientRect(), scroller = this.editor.scroller.getBoundingClientRect();
      this.tooltip.style.left = `${Math.max(8, Math.min(root.width - 320, scroller.left - root.left + point.x - this.editor.scroller.scrollLeft))}px`;
      this.tooltip.style.top = `${Math.max(8, Math.min(root.height - 160, scroller.top - root.top + point.y + this.editor.lh - this.editor.scroller.scrollTop))}px`;
      this.tooltip.hidden = false;
    } catch (error) { this.toast(error.message, { error: true }); }
  }
  async definition() {
    if (!this.supported(this.state.active)) return this.toast('Open a JavaScript or TypeScript file first.');
    const doc = this.state.active, version = doc.buffer.version;
    try {
      const targets = await this.request('definition');
      if (this.state.active !== doc || doc.buffer.version !== version) return;
      if (!targets.length) return this.toast('No definition found.');
      const pick = targets.length === 1 ? targets[0] : (await this.palette.pick(targets.map((t) => ({ label: `${t.file}:${t.start.line + 1}`, data: t })), 'Go to definition'))?.data;
      if (pick) await this.openFile(pick.file, { line: pick.start.line, col: pick.start.col });
    } catch (error) { this.toast(error.message, { error: true }); }
  }
  async problems() {
    if (!this.supported(this.state.active)) return this.toast('Open a JavaScript or TypeScript file first.');
    const doc = this.state.active;
    try {
      const items = await this.request('diagnostics', doc);
      if (!items.length) return this.toast('No problems in this file.');
      const choice = await this.palette.pick(items.map((d) => ({ label: `${d.start.line + 1}:${d.start.col + 1} ${d.message}`, detail: `${d.severity} TS${d.code}`, data: d })), 'Problems in current file');
      if (choice) { await this.openFile(choice.data.file, { line: choice.data.start.line, col: choice.data.start.col }); }
    } catch (error) { this.toast(error.message, { error: true }); }
  }
  async rename() {
    const doc = this.state.active;
    if (!this.supported(doc) || !doc.path) return this.toast('Save a JavaScript or TypeScript file before renaming symbols.');
    const version = doc.buffer.version, pos = { ...this.editor.head };
    try {
      const name = await this.palette.prompt('New symbol name');
      if (!name) return;
      if (!/^[$A-Z_a-z][$\w]*$/.test(name) || new Set('break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield await'.split(' ')).has(name)) return this.toast('Enter a valid identifier.', { error: true });
      if (doc.buffer.version !== version) return this.toast('The file changed. Try rename again.');
      const snapshots = new Map(this.state.docs.filter((d) => d.path).map((d) => [d.path, d.buffer.version]));
      const locations = await this.request('rename', doc, pos);
      if (doc.buffer.version !== version) throw new Error('The file changed. Try rename again.');
      const files = [...new Set(locations.map((l) => l.file))];
      // Open all affected files before changing any buffer. Edits remain unsaved and undoable.
      const docs = new Map();
      for (const file of files) {
        const d = await this.openFile(file);
        if (!d || d.readOnly) throw new Error('Cannot rename in one of the affected files.');
        docs.set(file, d);
      }
      for (const [file, d] of docs) if (snapshots.has(file) && snapshots.get(file) !== d.buffer.version) throw new Error('A file changed. Try rename again.');
      for (const l of locations) {
        if (docs.get(l.file).buffer.getRange(l.start, l.end) !== l.oldText) throw new Error('A reference changed. Try rename again.');
      }
      for (const [file, d] of docs) {
        const edits = locations.filter((l) => l.file === file).sort((a, b) => b.start.line - a.start.line || b.start.col - a.start.col);
        d.buffer.sealUndo();
        d.buffer.batch(() => {
          for (const l of edits) d.buffer.replace(l.start, l.end, l.prefix + name + l.suffix);
        });
        d.buffer.sealUndo();
      }
      await this.openFile(doc.path, { line: pos.line, col: pos.col });
      this.toast(`Renamed ${locations.length} references in ${files.length} files. Save to keep the changes.`);
    } catch (error) { this.toast(error.message, { error: true }); }
  }
}
