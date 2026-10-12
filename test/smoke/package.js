(async () => {
  const w = window.__sunlight, api = window.sunlight;
  const out = { passed: 0, failed: [], errors: [] };
  const check = (label, value) => { if (value) out.passed++; else out.failed.push(label); };
  const waitFor = async (fn) => { for (let i = 0; i < 200; i++) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
  window.addEventListener('error', (e) => out.errors.push(e.message));
  check('packaged app initializes', document.body.dataset.ready === '1');
  await w.setRoot(DEMO);
  await api.fs.writeFile(DEMO + '/package.ts', 'const text: string = "hello";\nconst wrong: number = text;\ntext.toUp');
  await w.openFile(DEMO + '/package.ts');
  w.editor.setSel({ line: 2, col: 9 }, { line: 2, col: 9 }); w.editor.focus(); w.editor.updateCompletion(true);
  const completions = await w.languageIntelligence.request('completion', w.S.active, { line: 2, col: 9 });
  check('packaged language worker provides semantic completion', completions.some((e) => e.label === 'toUpperCase'));
  check('packaged language worker provides diagnostics', await waitFor(() => w.languageIntelligence.diagnostics.some((d) => d.code === 2322)));
  await w.extPanel.refresh();
  check('bundled extensions are included', await waitFor(() => w.extPanel.catalog.length >= 8));
  const entry = w.extPanel.catalog.find((e) => e.id === 'sunlight.text-tools');
  if (!entry) return out;
  check('extension installs from packaged resources', await w.installExtension(entry, { skipConfirm: true }));
  check('sandboxed extension starts', await waitFor(() => w.extHost.get(entry.id)?.state === 'active'));
  let output = '';
  const unlisten = api.pty.onData((id, text) => { if (id === 'package-probe') output += text; });
  try {
    await api.pty.create('package-probe', { cwd: DEMO, cols: 80, rows: 24 });
    api.pty.write('package-probe', 'echo SUNLIGHT_PACKAGE_READY\r');
    check('packaged native terminal launches and runs a command', await waitFor(() => /(?:^|\n)SUNLIGHT_PACKAGE_READY\r?(?:\n|$)/.test(output)));
  } catch (error) { out.failed.push('packaged terminal: ' + error.message); }
  finally { await api.pty.kill('package-probe').catch(() => {}); unlisten(); }
  await w.checkpointSession();
  check('packaged recovery checkpoint works', (await api.session.get()).snapshot.documents.some((d) => d.path?.endsWith('package.ts')));
  return out;
})();
