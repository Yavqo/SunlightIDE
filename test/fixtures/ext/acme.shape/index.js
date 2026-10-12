
sunlight.commands.register('shape', () => {
  const shape = {};
  for (const [ns, obj] of Object.entries(sunlight)) {
    if (obj && typeof obj === 'object') shape[ns] = Object.keys(obj).sort(); else shape[ns] = typeof obj;
  }
  return shape;
});
