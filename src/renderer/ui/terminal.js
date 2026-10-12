// Integrated terminal: real PTY sessions (main process) rendered with xterm.js.
// Supports multiple sessions in tabs, full-screen programs, colours, resize and theming.

import { Terminal as XTerm } from '../vendor/xterm.mjs';
import { FitAddon } from '../vendor/addon-fit.mjs';
import { icon, el } from './util.js';

const ANSI = {
  light: {
    black: '#1C2B33', red: '#C62828', green: '#0B7A3E', yellow: '#9A6700', blue: '#0064E0', magenta: '#7C3AED', cyan: '#0E7490', white: '#5D6C7B',
    brightBlack: '#7A8896', brightRed: '#E41E3F', brightGreen: '#13A055', brightYellow: '#B45309', brightBlue: '#2E7BF0', brightMagenta: '#9B5CF6', brightCyan: '#0891B2', brightWhite: '#1C2B33',
  },
  dark: {
    black: '#26323D', red: '#FF8A8A', green: '#7FD99A', yellow: '#F0B66B', blue: '#6DB2FF', magenta: '#C4A1FF', cyan: '#5CD6E0', white: '#C9D3DC',
    brightBlack: '#6B7C8C', brightRed: '#FFA3A3', brightGreen: '#9BE7B1', brightYellow: '#F7CA8E', brightBlue: '#8EC0FF', brightMagenta: '#D6BEFF', brightCyan: '#86E6EE', brightWhite: '#FFFFFF',
  },
};

export class TerminalPanel {
  constructor(root) {
    this.root = root;
    this.api = window.sunlight;
    this.sessions = [];
    this.active = null;
    this.nextId = 1;
    this.defaultCwd = null;
    this.fontSize = 12.5;
    this.onClose = null;

    root.innerHTML = `
      <div class="term-head">
        <div class="term-tabs" role="tablist" aria-label="Terminals"></div>
        <button class="icon-btn sm t-new" aria-label="New terminal" title="New terminal (Ctrl+Shift+\`)">${icon('newfile', 'sm')}</button>
        <button class="icon-btn sm t-clear" aria-label="Clear terminal" title="Clear">${icon('clear', 'sm')}</button>
        <button class="icon-btn sm t-kill" aria-label="Kill terminal" title="Kill terminal">${icon('trash', 'sm')}</button>
        <button class="icon-btn sm t-close" aria-label="Hide terminal panel" title="Hide panel">${icon('close', 'sm')}</button>
      </div>
      <div class="term-body"></div>`;
    this.tabsEl = root.querySelector('.term-tabs');
    this.body = root.querySelector('.term-body');
    root.querySelector('.t-new').addEventListener('click', () => this.newSession());
    root.querySelector('.t-clear').addEventListener('click', () => this.clear());
    root.querySelector('.t-kill').addEventListener('click', () => this.killActive());
    root.querySelector('.t-close').addEventListener('click', () => this.onClose?.());

    this.api.pty.onData((id, data) => this.byId(id)?.term.write(data));
    this.api.pty.onExit((id, code) => this.handleExit(id, code));
    new ResizeObserver(() => this.fit()).observe(this.body);
  }

  byId(id) { return this.sessions.find((s) => s.id === id); }

  // ---- lifecycle ----
  setCwd(cwd) { this.defaultCwd = cwd; }
  get running() { return false; } // kept for older callers; sessions are interactive now

  // Called when the panel becomes visible.
  show() {
    if (!this.sessions.length) this.newSession();
    else { this.fit(); this.focus(); }
  }

  async newSession(cwd = this.defaultCwd) {
    const id = this.nextId++;
    const pane = el('div', { class: 'term-pane' });
    this.body.append(pane);
    const term = new XTerm({
      fontFamily: '"Geist Mono", "SF Mono", Menlo, Monaco, monospace',
      fontSize: this.fontSize,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 8000,
      macOptionIsMeta: true,
      allowProposedApi: true,
      theme: this.themeColors(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(pane);
    const session = { id, term, fit, pane, title: '', label: 'shell', exited: false };
    this.sessions.push(session);
    this.activate(session);
    fit.fit();

    term.onData((d) => { if (!session.exited) this.api.pty.write(id, d); });
    term.onResize(({ cols, rows }) => { if (!session.exited) this.api.pty.resize(id, cols, rows); });
    term.onTitleChange((t) => { session.title = t; this.renderTabs(); });
    // Cmd/Ctrl+K clears like in most terminals; app-level shortcuts are handled by the native menu.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.key.toLowerCase() === 'k' && (e.metaKey || (e.ctrlKey && e.shiftKey))) { term.clear(); return false; }
      return true;
    });

    try {
      const info = await this.api.pty.create(id, { cols: term.cols, rows: term.rows, cwd });
      session.label = info.shell || 'shell';
    } catch (err) {
      session.exited = true;
      term.write(`\r\n\x1b[31mCould not start a shell: ${err.message}\x1b[0m\r\n`);
    }
    this.renderTabs();
    return session;
  }

  activate(session) {
    this.active = session;
    for (const s of this.sessions) s.pane.classList.toggle('on', s === session);
    this.renderTabs();
    requestAnimationFrame(() => { this.fit(); session.term.focus(); });
  }

  handleExit(id, code) {
    const s = this.byId(id);
    if (!s) return;
    s.exited = true;
    if (code === 0) this.closeSession(s);
    else {
      s.term.write(`\r\n\x1b[2m[process exited with code ${code}. Close this tab or press the + button for a new shell.]\x1b[0m\r\n`);
      this.renderTabs();
    }
  }

  closeSession(s) {
    const i = this.sessions.indexOf(s);
    if (i < 0) return;
    if (!s.exited) this.api.pty.kill(s.id).catch(() => {});
    this.sessions.splice(i, 1);
    s.term.dispose();
    s.pane.remove();
    if (!this.sessions.length) { this.active = null; this.renderTabs(); this.onClose?.(); return; }
    if (this.active === s) this.activate(this.sessions[Math.min(i, this.sessions.length - 1)]);
    else this.renderTabs();
  }

  killActive() { if (this.active) this.closeSession(this.active); }

  dispose() {
    for (const s of [...this.sessions]) this.api.pty.kill(s.id).catch(() => {});
  }

  // ---- actions ----
  focus() { this.active?.term.focus(); }
  clear() { if (this.active) { this.active.term.clear(); this.active.term.focus(); } }
  sendText(text) { if (this.active && !this.active.exited) this.api.pty.write(this.active.id, text); }

  // Visible text of the active session (used by tests and handy for debugging).
  bufferText() {
    const b = this.active?.term.buffer.active;
    if (!b) return '';
    const lines = [];
    for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
    return lines.join('\n');
  }

  fit() {
    const s = this.active;
    if (!s || !this.body.clientWidth || !this.body.clientHeight) return;
    try { s.fit.fit(); } catch { /* not laid out yet */ }
  }

  // ---- theming ----
  setFontSize(px) {
    this.fontSize = px;
    for (const s of this.sessions) s.term.options.fontSize = px;
    this.fit();
  }

  themeColors() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return {
      background: v('--term-bg') || (dark ? '#0B1015' : '#FFFFFF'),
      foreground: v('--editor-fg') || (dark ? '#DCE3EA' : '#1C2B33'),
      cursor: dark ? '#5AA2FF' : '#0064E0',
      cursorAccent: v('--term-bg'),
      selectionBackground: dark ? 'rgba(76,154,255,0.35)' : 'rgba(0,100,224,0.22)',
      ...(dark ? ANSI.dark : ANSI.light),
    };
  }

  setTheme() {
    const theme = this.themeColors();
    for (const s of this.sessions) s.term.options.theme = theme;
  }

  // ---- header ----
  renderTabs() {
    const frag = document.createDocumentFragment();
    this.sessions.forEach((s, i) => {
      const name = s.title ? s.title.replace(/^.*?[:—-]\s*/, '').slice(0, 28) || s.label : s.label;
      const tab = el('div', { class: `tterm${s === this.active ? ' active' : ''}${s.exited ? ' exited' : ''}`, role: 'tab', 'aria-selected': String(s === this.active), title: s.title || s.label });
      tab.append(el('span', { class: 'ti', html: icon('terminal', 'sm') }), el('span', {}, `${name}${this.sessions.length > 1 ? ` ${i + 1}` : ''}`));
      tab.append(el('button', { class: 'tclose', 'aria-label': 'Close terminal', html: icon('close'), onclick: (e) => { e.stopPropagation(); this.closeSession(s); } }));
      tab.addEventListener('click', () => this.activate(s));
      frag.append(tab);
    });
    this.tabsEl.replaceChildren(frag);
  }
}
