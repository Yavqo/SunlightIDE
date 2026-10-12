
sunlight.commands.register('fail', () => { throw new Error('sync failure'); });
sunlight.commands.register('failAsync', async () => { await null; throw new Error('async failure'); });
sunlight.commands.register('returnsFunction', () => ({ ok: 1, fn() {} , date: new Date(0) }));
