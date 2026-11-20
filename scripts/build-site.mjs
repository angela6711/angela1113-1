import { mkdir, copyFile, rm } from 'node:fs/promises';
const files = ['index.html', 'cloud-sync.js', 'app-integration.js', 'manifest.webmanifest', 'sw.js', 'setup.html', '想飛記帳本-手機版.html', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'google-apps-script/Code.gs', 'google-apps-script/appsscript.json'];
await rm('dist', { recursive: true, force: true });
for (const file of files) {
  await mkdir('dist/' + file.split('/').slice(0, -1).join('/'), { recursive: true });
  await copyFile(file, 'dist/' + file);
}
console.log(`Built ${files.length} public app files; spreadsheets, archives and device credentials excluded.`);
