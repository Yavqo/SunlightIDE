(async () => {
  const w = window.__sunlight;
  const out = { checks: {}, errors: [] };
  const check = (n, ok, x) => { out.checks[n] = ok ? 'ok' : `FAIL ${JSON.stringify(x ?? '')}`; };
  window.addEventListener('error', (e) => out.errors.push(e.message));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 8000) => { for (let i = 0; i < ms / 50; i++) { let v; try { v = fn(); } catch { v = false; } if (v) return v; await wait(50); } try { return fn(); } catch { return false; } };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const git = w.git;
  const api = window.sunlight;
  const row = (suffix) => $(`#tree [data-path$="${suffix}"]`);

  await w.setRoot(DEMO);
  check('detects the repository', await waitFor(() => git.isRepo && git.status.branch === 'main'), git.status);
  const g = git.groups();
  check('staged group', g.staged.length === 1 && g.staged[0].path === 'style.css', g.staged.map((e) => e.path));
  const names = g.changes.map((e) => e.path).sort();
  check('changes group', ['README.md', 'app.js', 'new.txt', 'src/view.js'].every((n) => names.includes(n)), names);
  check('ignored file is not listed', !names.includes('ignored.log'), names);

  // ---- explorer decorations ----
  await w.explorer.load(DEMO + '/src'); w.explorer.expanded.add(DEMO + '/src'); w.explorer.render();
  check('modified file coloured + M badge', row('/app.js')?.classList.contains('g-modified') && row('/app.js').querySelector('.gbadge')?.textContent === 'M', row('/app.js')?.className);
  check('untracked file coloured + U badge', row('/new.txt')?.classList.contains('g-untracked') && row('/new.txt').querySelector('.gbadge')?.textContent === 'U');
  check('staged-added/modified file shows', row('/style.css')?.className.includes('g-'), row('/style.css')?.className);
  check('folder with changes gets a marker', row('/src')?.classList.contains('g-modified') && !!row('/src').querySelector('.gdot'), row('/src')?.className);
  check('ignored file dimmed', row('/ignored.log')?.classList.contains('g-ignored'), row('/ignored.log')?.className);
  const badge = $('.view-btn[data-view="git"] .badge');
  check('activity badge shows change count', badge && !badge.hidden && Number(badge.textContent) >= 5, badge?.textContent);
  check('status bar shows branch and dirty mark', /main\*/.test($('#statusbar').textContent), $('#statusbar').textContent.slice(0, 60));

  // ---- gutter markers ----
  await w.openFile(DEMO + '/app.js');
  const e = w.editor;
  await waitFor(() => { e.render(); return $$('.gn.gm-mod').length > 0; });
  e.render();
  const mod = $$('.gn.gm-mod').map((n) => +n.dataset.l), add = $$('.gn.gm-add').map((n) => +n.dataset.l), del = $$('.gn.gm-del').map((n) => +n.dataset.l);
  check('modified line marked', mod.includes(0), mod);
  check('added lines marked', add.length >= 2, add);
  check('deleted lines marked', del.length >= 1, del);
  // live markers while typing
  const before = $$('.gn.gm-add').length;
  e.setSel({ line: 20, col: 0 }, { line: 20, col: 0 });
  e.typeText('\n');
  await waitFor(() => { e.render(); return $$('.gn.gm-add').length > before; });
  check('new line gets an added marker as you type', $$('.gn.gm-add').length > before, [before, $$('.gn.gm-add').length]);
  e.undo();
  await waitFor(() => { e.render(); return $$('.gn.gm-add').length === before; });
  check('marker disappears after undo', $$('.gn.gm-add').length === before);

  // ---- blame ----
  e.setSel({ line: 5, col: 0 }, { line: 5, col: 0 });
  check('inline blame in status bar', await waitFor(() => /Tester, .*initial import/.test($('#statusbar .blame')?.textContent || '')), $('#statusbar .blame')?.textContent);
  e.setSel({ line: 11, col: 0 }, { line: 11, col: 0 });
  check('uncommitted line says so', await waitFor(() => /Not committed yet/.test($('#statusbar .blame')?.textContent || '')), $('#statusbar .blame')?.textContent);

  // ---- source control panel ----
  w.runCommand('show-git');
  await wait(150);
  check('panel visible', !$('#panel-git').hidden && $('#panel-explorer').hidden);
  const sections = $$('#panel-git .gp-sec-head').map((n) => n.querySelector('.gp-sec-title').textContent);
  check('panel sections', sections.includes('Staged Changes') && sections.includes('Changes'), sections);
  check('panel shows branch', /main/.test($('#panel-git .gp-branch').textContent), $('#panel-git .gp-branch').textContent);
  const rows = $$('#panel-git .gp-row');
  check('panel rows for each change', rows.length >= 6, rows.length);
  const commitBtn = $('#panel-git .gp-go');
  check('commit disabled without a message', commitBtn.disabled);

  // open a diff by clicking a row
  $$('#panel-git .gp-row').find((r) => r.dataset.path === 'app.js' && r.dataset.group === 'changes').click();
  check('diff tab opens', await waitFor(() => w.S.active?.diffOf?.path === 'app.js'), w.S.active?.name);
  const diffText = w.S.active.buffer.getText();
  check('diff content is a unified diff', /^@@ /m.test(diffText) && /^-\/\/ Sunlight demo/m.test(diffText) && /^\+\/\/ Sunlight demo: CHANGED/m.test(diffText), diffText.slice(0, 200));
  check('diff tab is read-only and highlighted', w.S.active.readOnly && e.readOnly && w.S.active.lang === 'diff');
  e.render();
  check('diff lines are coloured', $$('.t-add').length > 0 && $$('.t-del').length > 0 && $$('.t-hunk').length > 0);
  const lenBefore = w.S.active.buffer.getText().length;
  e.setSel({ line: 0, col: 0 }, { line: 0, col: 0 });
  e.typeText('xyz');
  e.deleteSelection();
  check('read-only diff ignores typing', w.S.active.buffer.getText().length === lenBefore);
  check('diff tab uses the file icon', !!$('.tab.active .ticon img'));

  // ---- stage / unstage through the panel ----
  const stageBtn = () => $$('#panel-git .gp-row').find((r) => r.dataset.path === 'new.txt' && r.dataset.group === 'changes')?.querySelector('[data-a="stage"]');
  stageBtn().click();
  check('staging moves the file to Staged', await waitFor(() => git.groups().staged.some((x) => x.path === 'new.txt')), git.groups().staged.map((x) => x.path));
  check('panel re-rendered', await waitFor(() => $$('#panel-git .gp-row').some((r) => r.dataset.path === 'new.txt' && r.dataset.group === 'staged')));
  $$('#panel-git .gp-row').find((r) => r.dataset.path === 'new.txt' && r.dataset.group === 'staged').querySelector('[data-a="unstage"]').click();
  check('unstaging moves it back', await waitFor(() => !git.groups().staged.some((x) => x.path === 'new.txt') && git.groups().changes.some((x) => x.path === 'new.txt')));
  // the open diff tab follows the repository state
  await w.openDiff(git.groups().changes.find((x) => x.path === 'src/view.js'), 'changes');
  const viewDiff = w.S.active;
  await gitStageAndCheck();
  async function gitStageAndCheck() {
    await api.git('stage', git.dir, ['src/view.js']);
    await git.refresh();
    check('open diff tab refreshes after staging', await waitFor(() => /No changes to show/.test(viewDiff.buffer.getText())), viewDiff.buffer.getText().slice(0, 120));
    await api.git('unstage', git.dir, ['src/view.js']);
    await git.refresh();
  }

  // ---- commit ----
  await api.git('stage', git.dir, []);                      // everything
  await git.refresh();
  const msg = $('#panel-git textarea');
  msg.value = 'Smoke test commit\n\nSecond paragraph';
  msg.dispatchEvent(new Event('input'));
  check('commit enabled with message and staged files', !$('#panel-git .gp-go').disabled);
  $('#panel-git .gp-go').click();
  check('commit clears the working tree', await waitFor(() => git.count === 0 && git.status.entries.every((x) => x.kind === 'ignored')), git.groups());
  const log = await api.git('log', git.dir, {});
  check('commit is in the history with its message', log[0].subject === 'Smoke test commit' && log.length === 2, log.map((c) => c.subject));
  check('message box is cleared', msg.value === '');
  check('badge hidden when clean', await waitFor(() => $('.view-btn[data-view="git"] .badge').hidden));
  check('panel shows clean state', await waitFor(() => !!$('#panel-git .gp-clean')));
  check('status bar no longer dirty', await waitFor(() => !/main\*/.test($('#statusbar').textContent)));
  check('explorer decorations cleared', await waitFor(() => !row('/app.js')?.className.includes('g-modified')), row('/app.js')?.className);
  await w.openFile(DEMO + '/app.js');
  await wait(300); e.render();
  check('gutter markers cleared after commit', $$('.gn.gm-mod, .gn.gm-add, .gn.gm-del').length === 0, $$('.gn.gm-mod, .gn.gm-add, .gn.gm-del').length);
  check('deleted file stays deleted in the tree', !row('/README.md'));

  // ---- branches ----
  w.runCommand('git-create-branch');
  await wait(200);
  const pin = $('.palette input');
  pin.value = 'feature/smoke';
  pin.dispatchEvent(new Event('input'));
  pin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check('create branch switches to it', await waitFor(() => git.status.branch === 'feature/smoke'), git.status.branch);
  check('status bar shows the new branch', await waitFor(() => /feature\/smoke/.test($('#statusbar').textContent)));
  w.pickBranch();
  await wait(300);
  const items = $$('.p-item .pl').map((n) => n.textContent);
  check('branch picker lists branches', items.includes('main') && items.some((t) => /Create new branch/.test(t)), items);
  [...$$('.p-item')].find((n) => n.querySelector('.pl').textContent === 'main').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  check('picking a branch checks it out', await waitFor(() => git.status.branch === 'main'), git.status.branch);

  // ---- file edits flow through to status ----
  await w.openFile(DEMO + '/app.js');
  e.setSel({ line: 0, col: 0 }, { line: 0, col: 0 });
  e.typeText('// edit\n');
  await w.save(w.S.active);
  check('saving a file shows it as modified', await waitFor(() => git.byPath.get('app.js')?.cls === 'modified'), [...git.byPath.keys()]);
  check('tab coloured as modified', await waitFor(() => $('.tab.active')?.classList.contains('g-modified')), $('.tab.active')?.className);
  const hist = await (async () => { w.runCommand('git-file-history'); await wait(500); return $$('.p-item .pl').map((n) => n.textContent); })();
  check('file history lists commits', hist.length >= 1 && hist.includes('initial import'), hist);
  $('.palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check('opening a commit shows its patch', await waitFor(() => w.S.active?.readOnly && /^commit [0-9a-f]{40}/m.test(w.S.active.buffer.getText())), w.S.active?.name);

  // ---- opening a sub-folder of the repository ----
  await w.setRoot(DEMO + '/src');
  check('sub-folder is detected with a path prefix', await waitFor(() => git.isRepo && git.status.prefix === 'src'), git.status?.prefix);
  await api.fs.writeFile(DEMO + '/src/view.js', 'export const changed = true;\n');
  await git.refresh();
  check('decorations map through the prefix', git.decor(DEMO + '/src/view.js', false)?.cls === 'modified', git.decor(DEMO + '/src/view.js', false));
  check('toRel / toAbs round trip', git.toRel(DEMO + '/src/view.js') === 'src/view.js' && git.toAbs('src/view.js') === DEMO + '/src/view.js');
  check('files outside the opened folder are ignored', git.toRel(DEMO + '/app.js') === null);
  await api.git('discard', git.dir, { tracked: ['src/view.js'], untracked: [] });

  // ---- a folder that is not a repository ----
  const parent = DEMO.replace(/\/demo$/, '');
  await w.setRoot(parent);
  check('non-repo folder is reported', await waitFor(() => git.status && git.status.isRepo === false && git.status.available !== false), git.status);
  w.runCommand('show-git');
  await wait(150);
  const initBtn = $('#panel-git [data-a="init"]');
  check('panel offers to initialise', !!initBtn && /not a Git repository/.test($('#panel-git .gp-empty').textContent), $('#panel-git').textContent.slice(0, 120));
  check('commands explain when there is no repo', (w.runCommand('git-push'), await waitFor(() => [...document.querySelectorAll('.toast')].some((t) => /not a Git repository/.test(t.textContent)))));
  initBtn.click();
  check('initialising creates a repository', await waitFor(() => git.isRepo), git.status);
  check('panel switches to the commit view', await waitFor(() => !!$('#panel-git .gp-commit') && !$('#panel-git .gp-commit').hidden));

  out.failed = Object.entries(out.checks).filter(([, v]) => v !== 'ok');
  out.passed = Object.values(out.checks).filter((v) => v === 'ok').length;
  delete out.checks;
  return out;
})();
