import test from 'node:test';
import assert from 'node:assert/strict';
import m from '../src/main/ext-manifest.js';
import { THEME_COLOR_VARS } from '../src/renderer/ext/theme.js';

test('renderer theme variable map matches the manifest validator', () => {
  assert.deepEqual(Object.keys(THEME_COLOR_VARS).sort(), Object.keys(m.THEME_COLORS).sort());
  for (const k of Object.keys(m.THEME_COLORS)) assert.deepEqual(THEME_COLOR_VARS[k], m.THEME_COLORS[k], k);
});
