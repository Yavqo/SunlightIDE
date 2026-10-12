# SunlightIDE

A code editor and IDE shell built on Electron, with its **own editing engine**. No VS Code, Monaco or CodeMirror.

```bash
npm install
npm start
```

## What is ours

| Piece | File | Notes |
|---|---|---|
| Text buffer | `src/renderer/editor/buffer.js` | Line array, position-based edits, grouped undo/redo, search. Pure logic, unit tested under Node. |
| Tokenizer | `src/renderer/editor/tokenizer.js` | Hand-written, state-carrying scanner (block comments, template strings, Python triple quotes). JS/TS, C-family, Java, Go, Rust, Swift, PHP, Python, Ruby, shell, SQL, JSON, CSS, HTML, Markdown, YAML/TOML. |
| Selections, wrap | `src/renderer/editor/selection.js`, `wrap.js` | Multi-cursor selection algebra and the soft-wrap layout engine. Pure logic, unit tested. |
| Editor surface | `src/renderer/editor/editor.js` | Virtualized DOM rendering (only visible lines exist), selection, mouse and keyboard, IME-safe input, auto-close/indent, comment toggle, move/duplicate lines, bracket matching, find/replace, word completion. |
| Explorer, tabs, palette, terminal, search | `src/renderer/ui/*`, `src/renderer/app.js` | Plain ES modules, no framework. |
| Git | `src/main/git.js`, `src/renderer/ui/git*.js`, `editor/diff.js` | Uses the real `git` CLI (argument arrays, no shell). Status/stage/commit/branches/push/pull/stash/blame/log, plus our own line-diff for gutter markers. |
| Main process | `src/main/main.js` | Window, native menu, filesystem, file watching, search, PTY sessions. |

Runtime dependencies are Electron, `@lydell/node-pty` (shell sessions) and `@xterm/xterm` (terminal rendering); `npm install` copies xterm into `src/renderer/vendor` for the strict CSP. The renderer runs with `contextIsolation` and `sandbox`; all disk access goes through the typed bridge in `src/main/preload.js`.

## Features

- Tabs, dirty indicators, drag to reorder, session restore, unsaved-changes prompts, external-change detection
- File explorer with create / rename / move to Trash, live refresh on disk changes
- Quick open (`⌘P`), command palette (`⌘⇧P`), go to line (`⌃G`), find in files (`⌘⇧F`)
- In-file find and replace with case, whole-word and regex options
- Multi-cursor editing (Alt+click, ⌘D, ⌘⇧L, ⌘⌥↑/↓, Alt+Shift+drag box select) and word wrap (Alt+Z) with hanging indents
- Split editors: independent tab groups, shared file views, draggable divider and recovered layouts. See [the guide](docs/split-editors.md).
- Session recovery: restores unsaved edits, untitled drafts, tabs, selections and scroll positions after restart. See [the guide](docs/session-recovery.md).
- Extension update notifications: automatic checks, persistent per-version notification history, review actions, and a setting to mute notices.
- JavaScript/TypeScript language intelligence: semantic completion, hover documentation, diagnostics, go to definition (F12), and symbol rename (F2). See [the guide](docs/language-intelligence.md).
- Minimap, bracket matching, indentation auto-detection, CRLF/LF, language mode picker
- Git: status colours and badges in the explorer and tabs, Source Control panel (stage, unstage, discard, commit, amend), change markers in the gutter, read-only diff tabs, branch picker, push/pull/fetch/sync, stash, history, inline blame (⌃⇧G)
- Integrated terminal: a real PTY running your login shell, with multiple tabs, full-screen programs (vim, htop, REPLs), colours, resize and theming
- Light, dark and system themes; auto save; adjustable font size

## Tests

```bash
npm test        # unit tests: buffer, undo/redo, tokenizer, selections, wrap layout, diff, and the git service against real temporary repositories
npm run test:recovery # crash and restart against a temporary profile
npm run smoke   # launches the real app headlessly: input, mouse, multi-cursor, word wrap, palette, explorer, search, terminal, git
```

`npm run smoke` uses a throwaway profile and a copy of `test/fixtures/demo`, so it never touches your settings or files.

## Known limits

- **Terminal emulation is xterm.js**, not our own: writing a full VT emulator is a project by itself. The PTY comes from `@lydell/node-pty`, which ships prebuilt binaries, so there is no native rebuild step (macOS/Linux/Windows x64+arm64).
- Git covers the everyday workflow. Not included: staging individual hunks or lines, a merge-conflict resolver, interactive rebase, and credential prompts (pushes need an SSH agent or a configured credential helper, because prompts are disabled so Git can never hang the app).
- Code folding and language intelligence for languages other than JavaScript/TypeScript are not included yet.
- Monospace layout assumes one cell per character, so double-width CJK text and some emoji will not align perfectly.
- Release installers are built with electron-builder. Developer ID notarization and Windows Authenticode signing are not configured yet.

## Credits

File and folder icons are from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) (MIT, licence copied to `src/renderer/icons/`). `npm install` regenerates `src/renderer/icons` via `scripts/icons.js`. Terminal rendering is [xterm.js](https://xtermjs.org) (MIT).

## Design

UI follows the Yavqo design language: white canvas, one blue, pill buttons, flat surfaces, Plus Jakarta Sans for the interface and Geist Mono for code (both self-hosted from `src/renderer/fonts`).

## Installers

Run `npm run dist:mac` on an Apple Silicon Mac to create a `.dmg`, or
`npm run dist:win` on Windows x64 to create the setup `.exe`. Installers are written
to `dist/`. `node scripts/test-package.js` launches the packaged application with
a temporary profile and verifies language intelligence, bundled extensions, the
native terminal and recovery. The Build installers GitHub Actions workflow builds
both platforms and can attach validated installers to an existing draft release.
