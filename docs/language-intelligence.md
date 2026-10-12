# Language intelligence

JavaScript, TypeScript, JSX, TSX, MJS and CJS files have built-in language intelligence.
Open a project folder and a source file; no server installation is needed.

- Type a member access such as `person.` to see semantic completions. Ctrl+Space
  requests suggestions explicitly. Tab or Enter accepts a suggestion; Escape dismisses it.
- Hover over a symbol to see its type and JSDoc. The command palette also offers
  **Language: Show Hover** for the current caret.
- Type and syntax errors appear as dotted underlines. Hover for the message, or use
  **Language: Show Problems in Current File** to navigate the diagnostics.
- Press **F12**, or choose **Language: Go to Definition**, to open a declaration.
  If a symbol has multiple definitions, choose one from the palette.
- Press **F2**, or choose **Language: Rename Symbol**, and enter a new identifier.
  References are updated across the project. Affected files open as unsaved buffers;
  review them and save when ready. Each file's changes can be undone in that editor.

The engine uses the bundled TypeScript 6 language service in a background worker.
It reads `tsconfig.json` or `jsconfig.json`, resolves imports and installed type
packages, and analyzes unsaved open documents. With no project configuration it
checks JavaScript and TypeScript using modern ECMAScript defaults and strict type
checking. Diagnostics cover the active file and are refreshed after a short pause
in typing. Completion respects the existing Suggestions setting.

This first implementation supports JavaScript and TypeScript, rather than a general
LSP server marketplace. Automatic import edits, quick fixes, and signature help are
not included. Rename accepts ASCII identifiers. Large workspaces initially index
up to 3,000 source files; imported files are resolved as needed. Language requests
limit open-buffer content to 10 MB and time out after 20 seconds.
