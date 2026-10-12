// Renders build/icon.png (1024px) from the sun mark. Run with: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const html = `<!doctype html><body style="margin:0;background:transparent">
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect x="40" y="40" width="944" height="944" rx="214" fill="#0064E0"/>
  <g transform="translate(512 512)" stroke="#fff" stroke-width="46" stroke-linecap="round" fill="none">
    <circle r="150" fill="#fff" stroke="none"/>
    <path d="M0-262v-88M0 262v88M-262 0h-88M262 0h88M-185-185l-62-62M185 185l62 62M-185 185l-62 62M185-185l62-62"/>
  </g>
</svg></body>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: false } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.writeFileSync(out, img.toPNG());
  console.log('wrote', out, img.getSize());
  app.quit();
});
