// Optional browser check: requires Chromium and Python 3; no Google credentials used.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(join(tmpdir(), 'fly-ledger-browser-'));
const originalConfig = await readFile('dist/cloud-config.json');
const server = spawn('python3', ['-m', 'http.server', '4173', '--bind', '127.0.0.1', '--directory', 'dist'], { stdio: 'ignore' });
const browser = spawn('chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--remote-debugging-port=9327', '--user-data-dir=' + profile, 'http://127.0.0.1:4173/'], { stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 100; i++) { try { target = (await (await fetch('http://127.0.0.1:9327/json')).json()).find(t => t.type === 'page'); if (target) break; } catch {} await delay(100); }
  assert(target, 'browser started');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const pending = new Map(); let sequence = 0;
  ws.onmessage = event => { const data = JSON.parse(event.data); if (pending.has(data.id)) { const { resolve, reject, timer } = pending.get(data.id); clearTimeout(timer); pending.delete(data.id); data.error ? reject(Error(data.error.message)) : resolve(data.result); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(Error('Timeout: ' + method)); }, 15000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ': ' + result.result.description); return result.result.value; };
  async function waitFor(expression) { for (let i = 0; i < 100; i++) { try { if (await evaluate(expression)) return; } catch {} await delay(100); } throw Error('Readiness timeout: ' + expression); }
  await waitFor('Boolean(window.ledgerCloud && document.querySelector("#nav button"))');
  await evaluate('navigator.serviceWorker.ready.then(() => true)');
  await waitFor('Boolean(navigator.serviceWorker.controller)');
  assert.equal(await evaluate("document.body.textContent.includes('示範帳本')"), true);
  await evaluate("navigate('settings')");
  assert.equal(await evaluate("Boolean(document.querySelector('#cloud-url')) && !document.querySelector('#cloud-key')"), true);
  await waitFor("Boolean(document.querySelector('a[href=\"https://docs.google.com/spreadsheets/d/17BTKjJJPznABLK0su4HlHf5UkvCicoeFbK7aFf-tu6s/edit\"]'))");
  await evaluate("startOwn()");
  const saved = await evaluate("(async()=>{const ok=await mutate('saveTransaction',{type:'expense',amount:14900,category:'餐飲',date:today,note:'瀏覽器離線測試',payment:'現金'});render();return ok})()");
  assert.equal(saved, true);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LOCAL_KEY)).transactions[0].amount"), 14900);
  await evaluate(`window.mockSheet=null;window.mockVersion=0;ledgerCloud.request=async(url,opts)=>{const input=JSON.parse(opts.body);if(input.action==='push'){if(input.expectedVersion!==mockVersion)return{ok:true,json:async()=>({ok:false,code:'CONFLICT',error:'conflict'})};mockSheet=input.state;mockVersion++}return{ok:true,json:async()=>({ok:true,version:mockVersion,state:mockSheet})}};ledgerCloud.configure('https://script.google.com/macros/s/browser-test/exec');ledgerCloud.sync()`);
  assert.equal(await evaluate('ledgerCloud.status'), 'synced');
  assert.equal(await evaluate('mockSheet.transactions[0].amount'), 14900);
  assert.equal(await evaluate("document.body.textContent.includes('複製共用帳本網址')"), true);
  // A public connection link also works in an already open app tab.
  const appUrl = await evaluate("(()=>{const value={url:ledgerCloud.config.url};ledgerCloud.disconnect();return location.origin+'/#connect='+btoa(JSON.stringify(value))})()");
  await call('Page.navigate', { url: appUrl });
  await waitFor('Boolean(window.ledgerCloud?.config)');
  assert.equal(await evaluate('location.hash'), '');
  assert.equal(await evaluate('ledgerCloud.config.url'), 'https://script.google.com/macros/s/browser-test/exec');
  assert.equal(await evaluate("'key' in ledgerCloud.config"), false);
  await evaluate('ledgerCloud.disconnect()');
  await call('Network.enable');
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await call('Page.reload');
  await waitFor('Boolean(window.ledgerCloud && document.querySelector("#nav button"))');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LOCAL_KEY)).transactions[0].note"), '瀏覽器離線測試');
  await evaluate("navigate('records')");
  assert.equal(await evaluate("document.body.textContent.includes('瀏覽器離線測試')"), true);
  await evaluate("mutate('saveTransaction',{type:'income',amount:6200000,category:'薪水',date:today,note:'離線薪水',payment:'銀行轉帳'})");
  assert.equal(await evaluate('JSON.parse(localStorage.getItem(LOCAL_KEY)).transactions.length'), 2);
  const caches = await evaluate("caches.open('fly-ledger-v2-20261120-4').then(c=>c.keys()).then(keys=>keys.map(r=>r.url))");
  assert(caches.length >= 10);
  assert(caches.every(url => url.startsWith('http://127.0.0.1:4173/')));
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await writeFile('dist/cloud-config.json', JSON.stringify({url:'https://script.google.com/macros/s/site-shared-test/exec'}));
  await call('Page.reload');
  await waitFor("window.ledgerCloud?.config?.url === 'https://script.google.com/macros/s/site-shared-test/exec'");
  assert.equal(await evaluate('location.hash'), '');
  console.log('Browser PASS: local save, simulated Sheets sync, public link, offline reload/edits, and automatic shared configuration at the ordinary site URL.');
} finally {
  await writeFile('dist/cloud-config.json', originalConfig);
  ws?.close(); browser.kill('SIGTERM'); server.kill('SIGTERM');
  await delay(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
}
