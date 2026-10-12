(async () => {
  const w = window.__sunlight, api = window.sunlight;
  await w.setRoot(DEMO);
  const baseline = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n');
  await api.fs.writeFile(DEMO + '/clean.txt', 'clean baseline');
  await api.fs.writeFile(DEMO + '/edited.txt', baseline);
  await api.fs.writeFile(DEMO + '/deleted.txt', 'old');
  await w.openFile(DEMO + '/clean.txt');
  await w.openFile(DEMO + '/edited.txt');
  w.editor.edit({ line: 0, col: 0 }, { line: 0, col: 6 }, 'recovered edit');
  const edited = w.S.active;
  await w.openFile(DEMO + '/deleted.txt');
  w.editor.edit({ line: 0, col: 0 }, { line: 0, col: 3 }, 'recovered deleted file');
  w.newUntitled();
  w.editor.typeText('draft note\nsecond line'); w.S.active.buffer.eol = '\r\n';
  const draft = w.S.active;
  w.S.docs.splice(w.S.docs.indexOf(draft), 1); w.S.docs.unshift(draft);
  w.activate(edited);
  w.editor.setSel({ line: 7, col: 1 }, { line: 7, col: 4 });
  w.editor.sels.push({ anchor: { line: 9, col: 1 }, head: { line: 9, col: 2 } });
  w.editor.commitSels(w.editor.sels, w.editor.main);
  w.editor.scroller.scrollTop = 600;
  await w.checkpointSession();
  await api.fs.writeFile(DEMO + '/recovery-ready', 'ready');
  // The runner kills the main process here; no graceful-unload checkpoint can run.
  return new Promise(() => {});
})();
