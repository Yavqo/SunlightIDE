# Word Count

Adds a live **word count** to the status bar. Click it for lines, characters and an estimated reading time.

It is a small example of an extension that listens to editor events:

```js
sunlight.events.on('textChanged', schedule);
sunlight.statusBar.setItem('count', { text: '120 words', command: 'stats' });
```

## Permissions

- **Read the active file** to count its words.
