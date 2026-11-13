import fs from 'node:fs';
const path='C:/Users/USER/Desktop/1113-1/little-ledger/app/index.html';let html=fs.readFileSync(path,'utf8');
html=html.replace('<head>','<head>\n<meta name="app-version" content="1.1.0">');
html=html.replace('v1.0</span>','v1.1.0</span>');
html=html.replace('<div class="settings-list">','<div class="settings-list"><button onclick="downloadAppHtml()">${icon(\'download\')}下載最新版手機 HTML<span class="arrow">${icon(\'right\')}</span></button>');
html=html.replace('function downloadBackup(){',`function downloadAppHtml(){const link=document.createElement('a');link.href=local?'https://little-ledger-tw-1113.workspace-926599.chatgpt.site/download/xiangfei-ledger.html':'/download/xiangfei-ledger.html';link.download='想飛記帳本-手機版.html';document.body.appendChild(link);link.click();link.remove();}\nfunction downloadBackup(){`);
fs.writeFileSync(path,html);
