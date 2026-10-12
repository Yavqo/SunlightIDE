# Workspace Stats

Counts the lines of code in the folder you have open and shows the biggest file types.

Run **Workspace: Count Lines of Code** from the command palette.

It demonstrates the `sunlight.workspace` API: `getFolder()`, `listFiles()` and `readFile()`. Paths are always relative to the open folder, and the extension cannot read anything outside it.

## Permissions

- **Read files inside the folder you have open.**
