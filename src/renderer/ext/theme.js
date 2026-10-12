// Applies an extension theme by setting whitelisted CSS variables on the document root.
// The manifest validator has already restricted names and values; this maps friendly names to variables.

// Keep in sync with THEME_COLORS in src/main/ext-manifest.js (a unit test checks they match).
export const THEME_COLOR_VARS = {
  background: ['--bg'],
  sidebar: ['--bg-side'],
  foreground: ['--fg'],
  mutedForeground: ['--fg-muted'],
  accent: ['--link', '--y-blue', '--y-blue-hover', '--y-blue-focus'],
  border: ['--line'],
  editorBackground: ['--editor-bg'],
  editorForeground: ['--editor-fg'],
  selection: ['--selection'],
  lineHighlight: ['--curline'],
  gutterForeground: ['--gutter-fg'],
  terminalBackground: ['--term-bg'],
};

let applied = [];

export function clearExtensionTheme(root = document.documentElement) {
  for (const name of applied) root.style.removeProperty(name);
  applied = [];
}

// theme: { colors, tokens } or null to restore the built-in look.
export function applyExtensionTheme(theme, root = document.documentElement) {
  clearExtensionTheme(root);
  if (!theme) return;
  const set = (name, value) => { root.style.setProperty(name, value); applied.push(name); };
  for (const [key, value] of Object.entries(theme.colors || {})) for (const v of THEME_COLOR_VARS[key] || []) set(v, value);
  if (theme.colors && theme.colors.background) set('--editor-bg', theme.colors.editorBackground || theme.colors.background);
  for (const [key, value] of Object.entries(theme.tokens || {})) set(`--t-${key}`, value);
}
