
sunlight.commands.register('flood', async () => {
  for (let i = 0; i < 8000; i++) sunlight.editor.getActive();
  await new Promise((r) => setTimeout(r, 100));
  return 'survived';
});
