// File and folder icons (Material Icon Theme, MIT). Lookup mirrors VS Code: exact file name, then the
// longest matching extension ("a.test.ts" -> "test.ts" -> "ts"), then the default icon.

import manifest from '../icons/manifest.js';

const url = (id) => `icons/${id}.svg`;
const isLight = () => document.documentElement.dataset.theme !== 'dark';

export function fileIconUrl(name) {
  const lower = name.toLowerCase();
  const light = isLight() ? manifest.light : null;
  const byName = (light && light.names[lower]) || manifest.names[lower];
  if (byName) return url(byName);
  const parts = lower.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.');
    const id = (light && light.ext[ext]) || manifest.ext[ext];
    if (id) return url(id);
  }
  return url((light && light.file) || manifest.file);
}

export function folderIconUrl(name, open = false, isRoot = false) {
  const lower = name.toLowerCase();
  if (isRoot) return url(open ? manifest.rootOpen : manifest.root);
  const light = isLight() ? manifest.light : null;
  const table = open ? manifest.foldersOpen : manifest.folders;
  const id = (light && !open && light.folders[lower]) || table[lower];
  if (id) return url(id);
  return url(open ? manifest.folderOpen : (light && light.folder) || manifest.folder);
}

export const imgTag = (src, cls = '') => `<img class="fi ${cls}" src="${src}" alt="" draggable="false">`;
export const fileIconHtml = (name, cls) => imgTag(fileIconUrl(name), cls);
export const folderIconHtml = (name, open, cls) => imgTag(folderIconUrl(name, open), cls);
