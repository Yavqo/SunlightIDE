// Workspace Stats: shows the workspace.* API (it needs the "workspace.read" permission).

const TEXT = ['.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.css', '.html', '.md', '.json', '.sh', '.rb', '.php', '.swift'];

sunlight.commands.register('count', async () => {
  const folder = await sunlight.workspace.getFolder();
  if (!folder) { sunlight.window.showMessage('Open a folder first.'); return; }

  const files = (await sunlight.workspace.listFiles()).filter((f) => TEXT.some((e) => f.toLowerCase().endsWith(e)));
  const byType = {};
  let total = 0;
  for (const [i, file] of files.slice(0, 400).entries()) {
    try {
      const lines = (await sunlight.workspace.readFile(file)).split('\n').length;
      const ext = file.slice(file.lastIndexOf('.'));
      byType[ext] = (byType[ext] || 0) + lines;
      total += lines;
    } catch { /* unreadable or too large: skip it */ }
    if (i % 25 === 0) await sunlight.statusBar.setItem('progress', { text: `Counting… ${i}/${Math.min(files.length, 400)}` });
  }
  await sunlight.statusBar.removeItem('progress');

  const top = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e, n]) => `${e} ${n.toLocaleString()}`).join(' · ');
  sunlight.window.showMessage(`${total.toLocaleString()} lines in ${Math.min(files.length, 400)} files. ${top}`);
});
