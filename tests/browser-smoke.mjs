// Optional browser check: requires Chromium and Python 3; no Google credentials used.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(join(tmpdir(), 'fly-ledger-browser-'));
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
  assert.equal(await evaluate("Boolean(document.querySelector('#cloud-url') && document.querySelector('#cloud-key'))"), true);
  await evaluate("startOwn()");
  const saved = await evaluate("(async()=>{const ok=await mutate('saveTransaction',{type:'expense',amount:14900,category:'餐飲',date:today,note:'瀏覽器離線測試',payment:'現金'});render();return ok})()");
  assert.equal(saved, true);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LOCAL_KEY)).transactions[0].amount"), 14900);
  await evaluate(`window.mockSheet=null;window.mockVersion=0;ledgerCloud.request=async(url,opts)=>{const input=JSON.parse(opts.body);if(input.action==='push'){if(input.expectedVersion!==mockVersion)return{ok:true,json:async()=>({ok:false,code:'CONFLICT',error:'conflict'})};mockSheet=input.state;mockVersion++}return{ok:true,json:async()=>({ok:true,version:mockVersion,state:mockSheet})}};ledgerCloud.configure('https://script.google.com/macros/s/browser-test/exec','a'.repeat(64));ledgerCloud.sync()`);
  assert.equal(await evaluate('ledgerCloud.status'), 'synced');
  assert.equal(await evaluate('mockSheet.transactions[0].amount'), 14900);
  assert.equal(await evaluate("document.body.textContent.includes('複製跨裝置私人連線網址')"), true);
  // A capability link must bootstrap a fresh device without sending the fragment to the server.
  const appUrl = await evaluate("(()=>{const value={url:ledgerCloud.config.url,key:ledgerCloud.config.key};ledgerCloud.disconnect();return location.origin+'/#connect='+btoa(JSON.stringify(value))})()");
  await call('Page.navigate', { url: appUrl });
  await waitFor('Boolean(window.ledgerCloud?.config)');
  assert.equal(await evaluate('location.hash'), '');
  assert.equal(await evaluate('ledgerCloud.config.key.length'), 64);
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
  const caches = await evaluate("caches.open('fly-ledger-v2-20261120-2').then(c=>c.keys()).then(keys=>keys.map(r=>r.url))");
  assert(caches.length >= 10);
  assert(caches.every(url => url.startsWith('http://127.0.0.1:4173/')));
  console.log('Browser PASS: app, settings, local save, simulated Sheets sync, private-link bootstrap, service-worker offline reload and offline edits.');
} finally {
  ws?.close(); browser.kill('SIGTERM'); server.kill('SIGTERM');
  await delay(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
}
