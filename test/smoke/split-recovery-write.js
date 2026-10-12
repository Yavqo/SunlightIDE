(async () => {
  const w = window.__sunlight, api = window.sunlight;
  await w.setRoot(DEMO);
  await api.fs.writeFile(DEMO + '/edited.txt', Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'));
  await api.fs.writeFile(DEMO + '/clean.txt', 'another file');
  await w.openFile(DEMO + '/edited.txt');
  w.splitEditor();
  const right = w.groups.groups[1], left = w.groups.groups[0];
  await w.openFile(DEMO + '/clean.txt');
  w.newUntitled(); w.editor.typeText('right draft\nsecond line');
  w.editor.setSel({ line: 1, col: 3 }, { line: 1, col: 3 });
  w.focusPane(left);
  w.editor.edit({ line: 0, col: 0 }, { line: 0, col: 6 }, 'left recovered edit');
  w.editor.setSel({ line: 7, col: 4 }, { line: 7, col: 4 }); w.editor.scroller.scrollTop = 300;
  w.focusPane(right); w.setSplitRatio(0.62);
  await w.checkpointSession();
  await api.fs.writeFile(DEMO + '/recovery-ready', 'ready');
  return new Promise(() => {});
})();
