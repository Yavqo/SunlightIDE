# Extension Developer Guide

Extensions add commands, themes, snippets and status bar items to SunlightIDE. This guide takes you from an empty folder to a published extension, and then documents every part of the extension API.

> **Note** This guide describes extension API version **1**. An extension declares the version it needs with `"apiVersion"` in its manifest, and SunlightIDE refuses to load extensions that need a newer one.

## Quick start

You can have a working extension in about two minutes.

1. Run **[Developer: Create Extension…](command:ext-create)** from the command palette (`Cmd+Shift+P`). Give it a name and a publisher.
2. SunlightIDE creates the folder, loads it as a *development extension* and opens it as your workspace.
3. Open the palette again and run **Say Hello**. A message appears in the corner. Press `Mod+Alt+H` for the same thing.
4. Open `index.js`, change the greeting, save, then run **[Developer: Reload Extensions](command:ext-reload)**. Run **Say Hello** again to see your change.
5. Run **[Developer: Package Extension…](command:ext-package)** to produce a `.zip` you can share.

The folder you just created looks like this:

```text
my-extension/
  manifest.json   what the extension is and what it contributes
  index.js        your code (optional: themes and snippets need none)
  README.md       shown on the extension's page in the store
  icon.svg        optional, 128 x 128 recommended
```

> **Tip** Open **[Developer: Show Extension Log](command:ext-log)** whenever something doesn't work. Everything your code prints with `console.log`, every error, and every refused API call ends up there.

## How extensions run

Extensions are untrusted code, so SunlightIDE runs each one in its own **sandboxed Web Worker**.

- The worker has **no access to the page, the file system, Node.js or the network**. `fetch`, `XMLHttpRequest` and `WebSocket` are blocked, both by the browser's Content Security Policy and by SunlightIDE removing them.
- The only way out is the global `sunlight` object. Each call becomes a message that SunlightIDE validates before acting on it.
- Calls that read or change your files need a **permission** that the extension declared in its manifest, and that you accepted when you installed it.
- An extension that stops responding is stopped after 30 seconds, and one that floods the editor with requests is stopped immediately.

Because it is a worker, you write ordinary modern JavaScript: `async`/`await`, `Map`, `JSON`, `setTimeout`, `Intl`, regular expressions. There is no `require` and no `import` of other files, so keep an extension in one `index.js` (up to 1 MB).

## The manifest

`manifest.json` is the only required file. This one uses most of the fields:

```json
{
  "id": "acme.line-tools",
  "name": "Line Tools",
  "version": "1.2.0",
  "publisher": "Acme",
  "description": "Sort and reverse lines.",
  "icon": "icon.svg",
  "categories": ["Text Tools"],
  "apiVersion": 1,
  "main": "index.js",
  "activationEvents": ["onCommand:sort"],
  "permissions": ["editor.read", "editor.write"],
  "contributes": {
    "commands": [
      { "id": "sort", "title": "Sort Lines", "category": "Lines" }
    ],
    "keybindings": [
      { "key": "Mod+Alt+S", "command": "sort" }
    ]
  }
}
```

| Field | Required | Description |
|---|---|---|
| `id` | yes | `publisher.name`, lowercase letters, digits and dashes. Must be unique. |
| `name` | yes | Display name, up to 60 characters. |
| `version` | yes | `major.minor.patch`, for example `1.0.0`. |
| `publisher` | no | Display name of the publisher. Defaults to the first part of the id. |
| `description` | no | One sentence, up to 300 characters. |
| `icon` | no | Relative path to a `.png` or `.svg` (up to 200 KB). |
| `categories` | no | Up to five labels such as `Themes`, `Snippets`, `Formatters`. |
| `homepage`, `repository` | no | `https://` links shown on the extension page. |
| `apiVersion` | no | Extension API version needed. Defaults to `1`. |
| `main` | for code | Relative path to your JavaScript file. |
| `activationEvents` | no | When to start the code. Defaults to `["onStartup"]`. |
| `permissions` | no | What the code may do. Defaults to nothing. |
| `contributes` | no | Commands, keybindings, themes and snippets. |

An extension must contribute something: either code (`main`) or at least one theme or snippet group. Commands need a `main` file to run them.

## Activation events

Code only starts when it is needed, which keeps the editor fast.

| Event | Starts the extension... |
|---|---|
| `onStartup` | when SunlightIDE starts (the default) |
| `onCommand:<id>` | the first time that command runs |
| `onLanguage:<language>` | the first time a file in that language becomes active |

Commands always start their extension, even without an `onCommand` event. Use `onStartup` only when you need to react to events straight away, as the Word Count extension does.

## Contribution points

### Commands

A command is something the user can run from the command palette. Declare it in the manifest, and register its handler in your code with the same local id.

```json
"contributes": {
  "commands": [{ "id": "hello", "title": "Say Hello", "category": "Greetings" }]
}
```

```js
sunlight.commands.register('hello', async () => {
  sunlight.window.showMessage('Hello!');
});
```

In the palette the command appears as **Greetings: Say Hello**. Internally its full id is `<extension id>.<local id>`, for example `acme.greeter.hello`, so extensions can never collide with each other or with built-in commands.

### Keybindings

```json
"keybindings": [{ "key": "Mod+Shift+H", "command": "hello" }]
```

- `Mod` is `Cmd` on macOS and `Ctrl` elsewhere. `Ctrl`, `Alt` and `Shift` are also available.
- The key can be a letter or digit, `F1`–`F12`, `Enter`, `Tab`, `Space`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `PageUp`, `PageDown`, `Backspace`, `Delete`, `Escape` or one of ``[ ] \ / ; ' , . = - ` ``.
- A binding needs `Mod`, `Ctrl` or `Alt` (or be a function key) so it can never interfere with typing.
- If two extensions bind the same key, the one loaded first wins. Built-in shortcuts handled by the menu cannot be overridden.

### Themes

A theme is a set of colours. It needs no code and no permissions.

```json
"contributes": {
  "themes": [{
    "id": "midnight",
    "label": "Midnight",
    "type": "dark",
    "colors": { "editorBackground": "#0A0F1E", "accent": "#7AA2FF" },
    "tokens": { "kw": "#C792EA", "str": "#C3E88D" }
  }]
}
```

`type` is `"dark"` or `"light"` and decides which built-in theme the colours are layered on, so you only have to set what you want to change. Pick a theme with **[Preferences: Color Theme](command:ext-theme)**.

| `colors` name | What it colours |
|---|---|
| `background` | The window and tab bar |
| `sidebar` | The sidebar and status bar |
| `foreground`, `mutedForeground` | Text and secondary text |
| `accent` | Buttons, links, focus and the caret |
| `border` | Dividers and outlines |
| `editorBackground`, `editorForeground` | The editor |
| `selection`, `lineHighlight` | Selected text and the current line |
| `gutterForeground` | Line numbers |
| `terminalBackground` | The terminal |

`tokens` colours the syntax: `kw` keywords, `str` strings, `num` numbers, `com` comments, `fn` functions, `typ` types, `op` operators, `tag` HTML tags, `attr` attributes, `prop` properties, `var` variables, `hd` Markdown headings, `em` emphasis and `link`.

Values must be `#hex`, `rgb()`, `rgba()` or `hsl()` colours. Anything else, such as a `url(...)`, is rejected, so a theme can never load content.

### Snippets

```json
"contributes": {
  "snippets": [{
    "language": "javascript",
    "snippets": {
      "fetchjson": {
        "body": "const response = await fetch(${1:url});\nconst ${2:data} = await response.json();$0",
        "description": "fetch() and parse JSON"
      }
    }
  }]
}
```

Snippets appear in the suggestion list as you type their trigger, and **Tab** inserts them.

- `$0` marks where the caret ends up.
- `${1:name}` inserts the placeholder text `name`.
- Use `\n` for a new line and `\t` for one level of indentation. Indentation of following lines is matched to the line you are on.

The `language` is one of: `javascript`, `typescript`, `python`, `html`, `css`, `json`, `markdown`, `yaml`, `toml`, `shell`, `sql`, `go`, `rust`, `java`, `c`, `swift`, `php`, `ruby`, `diff` or `plaintext`. Built-in snippets win if an extension reuses their trigger.

## Permissions

Declare only what you need. The user sees the list before installing.

| Permission | Allows |
|---|---|
| `editor.read` | Reading the text, selections and language of the active file, and listening to editor events |
| `editor.write` | Changing the text of the active file |
| `workspace.read` | Listing and reading files inside the folder that is open |
| `workspace.write` | Creating and changing files inside the folder that is open |
| `storage` | Remembering up to 1 MB of data between sessions |

Showing messages, asking for input and the status bar need no permission. Calling an API without its permission rejects the promise with a message telling you which permission to add.

> **Security** Treat the permission list as part of your extension's interface. Extensions that ask for more than they use are harder to trust.

## The sunlight API

A global object named `sunlight` is available in `index.js`. Every method that talks to the editor returns a **Promise**, so use `await`.

### Positions and selections

A **position** is `{ line, col }`. Both are zero-based, and `col` counts UTF-16 code units.

A **selection** has `anchor` and `head` (where the selection started and where the caret is), `start` and `end` (in document order), `text` (the selected text) and `empty`.

### sunlight.commands

| Method | Description |
|---|---|
| `register(id, handler)` | Run `handler(...args)` when the command `id` (declared in the manifest) is invoked. May be `async`. The return value must be JSON-serialisable. |
| `execute(id, ...args)` | Run one of your commands by local id, or any extension's command by full id. Resolves with its return value. |

### sunlight.window

| Method | Description |
|---|---|
| `showMessage(text, { type })` | Show a short message. `type` is `'info'` (default) or `'error'`. At most five per ten seconds. |
| `showInput({ prompt, value })` | Ask for a line of text. Resolves with the string, or `null` if cancelled. |
| `showPick(items, { placeholder })` | Let the user choose. `items` are strings or `{ label, detail, value }`. Resolves with `{ label, value, index }`, or `null`. |

```js
const choice = await sunlight.window.showPick(
  [{ label: 'Tabs', value: 'tab' }, { label: 'Spaces', value: 'space' }],
  { placeholder: 'Indent with…' }
);
if (choice) sunlight.window.showMessage(`You picked ${choice.value}`);
```

### sunlight.statusBar

| Method | Description |
|---|---|
| `setItem(id, { text, tooltip, command })` | Create or update an item in the status bar. `command` is a local command id that runs when it is clicked. |
| `removeItem(id)` | Remove it. |

### sunlight.editor

`editor.read` permission:

| Method | Resolves with |
|---|---|
| `getActive()` | `{ kind, path, name, language, lineCount, dirty, readOnly }` for the active text file, or `null` when there is none. `path` is `null` for unsaved files. |
| `getText()` | The whole text of the active file. |
| `getLine(n)` | The text of line `n` (zero-based). |
| `getSelections()` | An array of selections, one per cursor. |

`editor.write` permission. Edits apply to every cursor and form **one undo step**:

| Method | Description |
|---|---|
| `replaceSelections(textOrArray)` | Replace each selection. Pass an array with one string per selection, or one string for all. |
| `insertText(text)` | Replace every selection with `text` (inserts at empty cursors). |
| `setText(text)` | Replace the whole file. |
| `replaceRange({ start, end }, text)` | Replace a range of positions. |
| `setSelections([{ anchor, head }])` | Move the cursors. |

Read-only tabs, such as diffs, reject edits.

### sunlight.workspace

The workspace is the folder that is open. Paths are always **relative to it** and may not contain `..`.

| Method | Permission | Description |
|---|---|---|
| `getFolder()` | `workspace.read` | The folder's path, or `null`. |
| `listFiles({ extension })` | `workspace.read` | Relative paths of files (up to 5,000), skipping `node_modules`, `.git` and similar. |
| `readFile(path)` | `workspace.read` | The text of a file up to 5 MB. Binary files are refused. |
| `writeFile(path, text)` | `workspace.write` | Create or overwrite a file, creating folders as needed. |

### sunlight.storage

Per-extension storage in a small JSON file (1 MB limit). Needs the `storage` permission.

```js
const runs = await sunlight.storage.get('runs', 0);
await sunlight.storage.set('runs', runs + 1);
```

`get(key, fallback)`, `set(key, value)`, `delete(key)` and `keys()`.

### sunlight.events

`sunlight.events.on(name, callback)` returns `{ dispose() }`. It needs `editor.read`.

| Event | Payload |
|---|---|
| `activeFileChanged` | `{ path, name, language }`, or `null` when no text file is active |
| `fileOpened` | `{ path, name, language }` |
| `fileSaved` | `{ path, name, language }` |
| `selectionChanged` | `{ line, col, cursors }` (limited to a few per second) |
| `textChanged` | `{ path, name, version }`, debounced to 300 ms |

Events don't carry the text. Call `editor.getText()` when you need it, ideally after a short pause as Word Count does.

### Other globals

- `sunlight.version` is the API version (`1`) and `sunlight.extension` is `{ id, version }`.
- `console.log`, `console.warn` and `console.error` write to the extension log.
- `setTimeout`, `setInterval`, `Promise`, `JSON` and `Intl` all work as usual.

## Cookbook

### Transform the selection

```js
sunlight.commands.register('shout', async () => {
  const selections = await sunlight.editor.getSelections();
  if (!selections.some((s) => s.text)) {
    sunlight.window.showMessage('Select some text first.');
    return;
  }
  await sunlight.editor.replaceSelections(selections.map((s) => s.text.toUpperCase()));
});
```

### Keep a status bar item up to date

```js
let timer;
const refresh = async () => {
  const file = await sunlight.editor.getActive();
  if (!file) return sunlight.statusBar.removeItem('lines');
  sunlight.statusBar.setItem('lines', { text: `${file.lineCount} lines` });
};
const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 250); };

sunlight.events.on('activeFileChanged', schedule);
sunlight.events.on('textChanged', schedule);
schedule();
```

### Read a file from the project

```js
sunlight.commands.register('todos', async () => {
  const files = await sunlight.workspace.listFiles({ extension: '.js' });
  let count = 0;
  for (const file of files.slice(0, 200)) {
    count += ((await sunlight.workspace.readFile(file)).match(/TODO/g) || []).length;
  }
  sunlight.window.showMessage(`${count} TODOs in ${files.length} files`);
});
```

### Handle errors

A rejected promise from the API throws inside your handler. If you don't catch it, the user sees a short error, and the full message is in the extension log.

```js
try {
  await sunlight.editor.setText('…');
} catch (error) {
  sunlight.window.showMessage(error.message, { type: 'error' });
}
```

## Testing and debugging

- **[Developer: Reload Extensions](command:ext-reload)** re-reads every manifest and restarts the code. Do it after each change.
- **[Developer: Show Extension Log](command:ext-log)** shows messages, warnings and errors per extension, including syntax errors with a line number.
- **[Developer: Install Extension from Folder…](command:ext-install-folder)** loads any folder in place. Edits are picked up on reload and nothing is copied.
- If a command never finishes, it is stopped after 30 seconds and the log says so.

Common mistakes:

| Symptom | Cause |
|---|---|
| "needs the `editor.read` permission" | Add the permission to `permissions` in the manifest and reload. |
| Command shows in the palette but does nothing | The id in `register()` doesn't match the manifest, or `main` is missing. |
| Keybinding does nothing | It needs `Mod`, `Ctrl` or `Alt`, and must refer to a declared command. |
| `fetch is not a function` | Extensions have no network access by design. |
| Theme looks wrong | Only the colour names listed above are accepted. Check the log for rejected values. |

## Packaging and publishing

1. Bump `version` in the manifest.
2. Run **[Developer: Package Extension…](command:ext-package)**. It validates the manifest and writes `<id>-<version>.zip`.
3. Share the zip. Anyone can install it with **[Extensions: Install from .zip…](command:ext-install-zip)**.

### Hosting your own registry

The store can also browse a registry you host. A registry is a JSON file served over HTTPS:

```json
{
  "extensions": [
    {
      "id": "acme.line-tools",
      "name": "Line Tools",
      "version": "1.2.0",
      "publisher": "Acme",
      "description": "Sort and reverse lines.",
      "categories": ["Text Tools"],
      "permissions": ["editor.read", "editor.write"],
      "downloadUrl": "https://example.com/acme.line-tools-1.2.0.zip",
      "sha256": "<the sha256 printed by Package Extension>"
    }
  ]
}
```

Point SunlightIDE at it with **[Extensions: Set Registry URL…](command:ext-registry)**. For safety:

- Downloads must use `https://` (`http://localhost` is allowed for testing).
- The download must match its `sha256`, or it is not installed.
- The package must contain exactly the advertised `id` and `version`, and may not ask for any permission the registry did not list.
- Installing always shows the permissions and asks for confirmation.

## Limits

| Limit | Value |
|---|---|
| Extension size | 20 MB, 500 files |
| `index.js` | 1 MB |
| Text passed to the editor API | 5 MB per call |
| Storage | 1 MB per extension |
| Command run time | 30 seconds |
| Messages | 5 per 10 seconds |

## What's not available yet

Extensions can't add sidebar views or custom editors, provide language intelligence such as diagnostics or completions, or run background processes. These are planned for later API versions, and the `apiVersion` field makes sure an extension written today keeps working.

### Build a publishable store

Run `npm run registry:build -- https://your-host.example/extensions/` to package
all reviewed folders in `extensions/store` and generate `build/registry/catalog.json`.
To use other folders: `npm run registry:build -- BASE_URL SOURCE_FOLDER OUTPUT_FOLDER`.
The builder validates manifests, refuses duplicate IDs, and includes checksums,
README content, permissions, and feature details for browsing before installation.
Upload the entire output folder to the HTTPS location supplied as `BASE_URL`, then
set the app's Registry URL to `BASE_URL/catalog.json`. Keep older versioned packages
on the host so clients with a cached catalog can still install them. To publish an
update, increase the manifest version, rebuild, upload packages first, and upload
`catalog.json` last. Review third-party submissions before adding their folders.

The store's filter selects installed extensions, available updates, themes,
snippets, or command tools. Bundled extensions remain available without a registry.
Failed or rejected updates keep the existing installation and stored settings.

## Update notifications

SunlightIDE checks installed extensions for newer versions shortly after startup,
every 30 minutes, and when you return to the app after at least five minutes.
It checks both bundled extensions and your configured registry. Development
extensions are excluded. Nothing is installed automatically.

A new version produces a notification with **Review updates**. The Extensions icon
also shows an update count, and the store has a review banner and an Updates filter.
Choose **Update** to install a version; new permissions must be reviewed first.
If the catalog changes after that review, installation stops and asks you to refresh.

Use **Extensions: Check for Updates** in the command palette or Extensions menu to
check immediately. Each version is announced once, including across app restarts.
Turn off **Extension update notifications** in Settings to mute automatic notices;
the update count and manual checks still work. Background connection failures stay
quiet and preserve previously known updates. Manual checks report connection errors.
